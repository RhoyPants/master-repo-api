require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
let created, updates, batches, failDetails, failCreate;
const prisma = {
  transactionType: { upsert: async args => ({ id: 1, code: args.where.code }) },
  auditLog: { create: async ({ data }) => { if (failCreate) throw new Error('Storage unavailable'); created = data; return { id: 42 }; }, update: async args => { updates.push(args.data); return args.data; } },
  auditTransactionItem: { createMany: async ({ data }) => { if (failDetails) throw new Error('Detail write failed'); batches.push(data); return { count: data.length }; } },
};
const id = require.resolve('../src/lib/prisma'); require.cache[id] = { id, filename: id, loaded: true, exports: { prisma } };
const { auditLegacySync } = require('../src/lib/audit-legacy-sync');
const { auditRequestContext } = require('../src/lib/audit-context');
const reset = () => { created = undefined; updates = []; batches = []; failDetails = false; failCreate = false; };
test('legacy SharePoint runs get actor attribution, counts and batched per-record details', async () => {
  reset();
  const rows = Array.from({ length: 202 }, (_, index) => ({ itemCode: `I${index}`, action: 'INSERT', status: 'SUCCESS' }));
  rows[201] = { itemCode: 'I201', action: 'UPDATE', status: 'FAILED', error: 'Rejected' };
  await new Promise((resolve, reject) => auditRequestContext({ user: { id: 7, name: 'Roe', email: 'roe@example.test' }, path: '/sync/staging-sharepoint/item/run' }, {}, async () => {
    try {
      const result = await auditLegacySync('item', async () => ({ createdCount: 201, updatedCount: 0, skippedCount: 0, failedCount: 1, totalItems: 202, items: rows }));
      assert.equal(result.runId, created.runId); assert.equal(result.status, 'PARTIAL');
      assert.equal(JSON.parse(created.details.create[0].message).name, 'Roe');
      assert.deepEqual(batches.map(batch => batch.length), [100, 100, 2]);
      assert.equal(batches[2][1].referenceKey, 'I201'); assert.equal(batches[2][1].status, 'FAILED');
      assert.equal(updates.at(-1).insertedCount, 201); assert.equal(updates.at(-1).failedCount, 1); resolve();
    } catch (error) { reject(error); }
  }));
});
test('failed operations close the run, and audit failures retain already returned sync counts', async () => {
  reset(); await assert.rejects(auditLegacySync('uom', async () => { throw new Error('Source unavailable'); }), /Source unavailable/);
  assert.equal(updates.at(-1).status, 'FAILED'); assert.match(updates.at(-1).errorMessage, /Source unavailable/);
  reset(); failDetails = true;
  await assert.rejects(auditLegacySync('item', async () => ({ inserted: 1, totalRecords: 1, items: [{ code: 'A', action: 'INSERT', status: 'SUCCESS' }] })), /Detail write failed/);
  assert.equal(updates[0].insertedCount, 1); assert.match(updates.at(-1).errorMessage, /audit recording failed/);
  reset(); failCreate = true; let writes = 0;
  await assert.rejects(auditLegacySync('item', async () => { writes++; return {}; }), /Storage unavailable/); assert.equal(writes, 0);
});
