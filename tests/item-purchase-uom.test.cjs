require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let query, records, stagingRows;
inject('../src/lib/prisma', { prisma: { item: { count: async () => stagingRows.length, findMany: async () => stagingRows } } });
inject('../src/lib/sharepoint-token', { getSharePointReadToken: async () => 'fixture' });
inject('../src/lib/sap', { getSapPool: async () => ({ request: () => ({ query: async text => {
  query = text;
  return { recordset: records };
} }) }) });
const { getItemsFromSAP, getItemsFromStaging, getItemsFromSharePoint } = require('../src/modules/data/item/service');
const item = {
  ItemCode: 'ITM-001', ItemDescription: 'TEST ITEM', Category: 'I',
  itemClassCode: 'CLS', itemClassName: 'CLASS', UOM: 'PC', InventoryOUM: ' EACH\r\n ', PurchaseUOM: ' BOX\r\n ',
  LeadTime: null, iswhInventory: 'Y', isSalesInventory: 'Y', isPurchaseInventory: 'Y', ItemGroupName: 'GROUP',
};
test('SAP Item browsing returns Purchase UOM separately from inventory UOM and retains sales flags', async () => {
  records = [item];
  const result = await getItemsFromSAP({ search: 'ITM-001', page: 1, limit: 20 });
  assert.match(query, /UPPER\(itm\.BuyUnitMsr\)\s+AS PurchaseUOM/);
  assert.match(query, /itm\.InvntryUom = uom\.UomName/);
  assert.match(query, /itm\.SellItem\s+AS isSalesInventory/);
  assert.equal(result.data[0].purchaseUom, 'BOX');
  assert.equal(result.data[0].uom, 'PC');
  assert.equal(result.data[0].inventoryOUM, 'EACH');
  assert.equal(result.data[0].isSalesInventory, true);
  assert.equal(result.data[0].isPurchaseInventory, true);
  assert.equal(result.total, 1);
});
test('missing Purchase UOM stays null instead of falling back to inventory UOM', async () => {
  records = [{ ...item, PurchaseUOM: null }, { ...item, ItemCode: 'ITM-002', PurchaseUOM: '' }];
  const result = await getItemsFromSAP({ page: 1, limit: 20 });
  assert.deepEqual(result.data.map(row => row.purchaseUom), [null, null]);
  assert.deepEqual(result.data.map(row => row.uom), ['PC', 'PC']);
});
test('staging returns its actual inventory and exact decimal conversion, including zero and null', async () => {
  const { Prisma } = require('@prisma/client');
  const base = { itemCode: 'ITM-001', itemDescription: 'TEST', category: 'I', isActive: true, uom: 'PC', inventoryOUM: ' EACH\r\n ', convertionValue: new Prisma.Decimal('12.500001') };
  stagingRows = [base, { ...base, itemCode: 'ITM-002', inventoryOUM: null, convertionValue: new Prisma.Decimal(0) }, { ...base, itemCode: 'ITM-003', convertionValue: null }];
  const result = await getItemsFromStaging({});
  assert.equal(result.data[0].inventoryOUM, 'EACH');
  assert.equal(result.data[0].convertionValue.toString(), '12.500001');
  assert.equal(result.data[1].convertionValue.toString(), '0');
  assert.equal(result.data[1].inventoryOUM, null);
  assert.equal(result.data[2].convertionValue, null);
  assert.ok(result.data.every(row => !Object.hasOwn(row, 'purchaseUom')), 'Never invent a staging purchase UOM from inventory UOM');
  assert.equal(JSON.parse(JSON.stringify(result)).data[0].convertionValue, '12.500001');
});
test('SharePoint exposes optional UOM/conversion fields, preserving zero and absent values', async () => {
  const { invalidateDataReads } = require('../src/lib/data-read-cache');
  invalidateDataReads();
  const originalFetch = global.fetch;
  const fields = { ItemCode: 'ITM-001', ItemDescription: 'TEST', UOM_code: 'PC', InventoryUOM: ' EACH\r\n ', PurchaseUOM: ' BOX\r\n ', ConvertionValue: 12.5, isSalesInventory: 1 };
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ value: [
    { fields },
    { fields: { ...fields, ItemCode: 'ITM-002', ConvertionValue: 0 } },
    { fields: { ItemCode: 'ITM-003', UOM_code: 'PC' } },
  ] }) });
  try {
    const result = await getItemsFromSharePoint({});
    assert.deepEqual(result.data.map(row => row.convertionValue), [12.5, 0, null]);
    assert.deepEqual(result.data.map(row => row.inventoryOUM), ['EACH', 'EACH', null]);
    assert.deepEqual(result.data.map(row => row.purchaseUom), ['BOX', 'BOX', null]);
    assert.equal(result.data[0].isSalesInventory, true);
  } finally { global.fetch = originalFetch; invalidateDataReads(); }
});
