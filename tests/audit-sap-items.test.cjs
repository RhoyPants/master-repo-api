require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const source = ['A', 'B', 'C'].map(ItemCode => ({ ItemCode, ItemDescription: 'NEW', validFor: 'Y', Category: 'I', itemClassCode: 'CLS', itemClassName: 'Class', UOM: 'EA', UOM_ID: 999, LeadTime: 0, iswhInventory: 'Y', isSalesInventory: 'N', isPurchaseInventory: 'N', ItemGroupName: 'Group' }));
const existing = itemDescription => ({ itemDescription, isActive: true, category: 'I', itemClassCode: '10', itemClassName: 'Class', uom: 'EA', uomId: 9, leadTime: 0, isWHInventory: true, isSalesInventory: false, isPurchaseInventory: false, itemGroupName: 'Group' });
const items = [], logs = [], writes = [];
inject('../src/lib/sap', { getSapPool: async () => ({ request: () => ({ query: async () => ({ recordset: source }) }) }) });
inject('../src/lib/prisma', { prisma: {
  transactionType: { upsert: async () => ({ id: 1 }) },
  auditLog: { create: async args => { logs.push(args.data); return { id: 1 }; }, update: async args => { logs.push(args.data); return args.data; } },
  auditLogDetail: { create: async () => ({}) }, auditTransactionItem: { create: async args => { items.push(args.data); return args.data; } },
  itemClass: { findMany: async () => [{ itmsGrpCod: '10', initials: 'CLS' }] }, uom: { findMany: async () => [{ id: 9, uomCode: 'EA' }] },
  item: { findUnique: async args => args.where.itemCode === 'A' ? null : existing(args.where.itemCode === 'B' ? 'OLD' : 'NEW'), create: async args => { writes.push(args.data); return args.data; }, update: async args => { writes.push(args.data); return args.data; } },
} });
const { runItemSync } = require('../src/modules/sync/sap-staging/item/service');
test('built-in SAP Item sync persists created, updated and skipped record keys plus real field changes', async () => {
  const result = await runItemSync();
  assert.deepEqual([result.insertedCount, result.updatedCount, result.skippedCount, result.failedCount], [1, 1, 1, 0]);
  assert.deepEqual(items.map(item => [item.referenceKey, item.action, item.status]), [['A', 'INSERT', 'SUCCESS'], ['B', 'UPDATE', 'SUCCESS'], ['C', 'SKIP', 'SUCCESS']]);
  assert.equal(JSON.parse(items[0].payload).values.itemCode, 'A');
  assert.deepEqual(JSON.parse(items[1].payload).changes, [{ field: 'itemDescription', from: 'OLD', to: 'NEW' }]);
  assert.equal(writes.length, 2); assert.equal(logs.at(-1).status, 'SUCCESS');
});
