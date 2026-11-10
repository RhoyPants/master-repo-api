require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
inject('../src/lib/sap', {}); inject('../src/lib/itemMaster', {});
const dates = { createdAt: new Date('2026-11-09T01:00:00Z'), updatedAt: new Date('2026-11-09T02:00:00Z') };
const row = { ...dates, id: 9, itemCode: 'I001', itemDescription: 'Item', isActive: true, category: 'I', itemClassCode: '10', itemClassName: 'CLASS', uom: 'EA', uomId: 7, leadTime: 2, isWHInventory: true, isSalesInventory: false, isPurchaseInventory: true, itemGroupName: 'GROUP', whCode: 'W1', whName: 'WAREHOUSE', address: null, itmsGrpCod: '10', initials: 'CLS', itmsGrpNam: 'CLASS', itemGroupId: 'G1', name: 'GROUP', itemClass: 'CLASS', uomCode: 'EA', uomName: 'EACH' };
const model = { findMany: async () => [row], count: async () => 1 };
inject('../src/lib/prisma', { prisma: { item: model, warehouse: model, itemClass: model, itemGroup: model, uom: model } });
test('all five staging readers retain IDs, timestamps and model columns hidden from table display', async () => {
  const readers = [
    require('../src/modules/data/item/service').getItemsFromStaging,
    require('../src/modules/data/warehouse/service').getWarehousesFromStaging,
    require('../src/modules/data/item-class/service').getItemClassFromStaging,
    require('../src/modules/data/item-group/service').getItemGroupFromStaging,
    require('../src/modules/data/uom/service').getUomFromStaging,
  ];
  for (const read of readers) {
    const result = await read({ page: 1, limit: 500 });
    for (const name of Object.keys(row)) assert.ok(Object.hasOwn(result.data[0], name), `Export lost ${name}`);
    assert.equal(result.data[0].uomId, 7); assert.equal(result.data[0].isSalesInventory, false);
    assert.equal(result.data[0].createdAt.toISOString(), dates.createdAt.toISOString());
  }
});
