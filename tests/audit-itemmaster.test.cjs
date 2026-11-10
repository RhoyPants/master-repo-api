require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let transactionCode;
const row = { ItemGroupID: 'G1', Initials: 'GROUP', Name: 'GROUP', ItemClassCode: 'CLS', ItemClass: 'CLASS', Category: 'I' };
inject('../src/lib/itemMaster', { getItemMasterPool: async () => ({ request: () => {
  const request = { input: () => request, query: async () => ({ recordset: [row] }) }; return request;
} }) });
inject('../src/lib/prisma', { prisma: {
  transactionType: { upsert: async args => { transactionCode = args.where.code; return { id: 1 }; } },
  auditLog: { create: async () => ({ id: 1 }), update: async () => ({}) }, auditLogDetail: { create: async () => ({}) }, auditTransactionItem: { create: async () => ({}) },
  itemGroup: { findUnique: async () => null, create: async args => args.data },
} });
const { runItemGroupSyncByCodes } = require('../src/modules/sync/itemMaster-staging/item-group/service');
test('selected built-in Item Master runs use the selected audit type', async () => {
  const result = await runItemGroupSyncByCodes(['G1']);
  assert.equal(transactionCode, 'IM2SDB_ITEMGROUP_SELECTED'); assert.equal(result.inserted, 1);
});
