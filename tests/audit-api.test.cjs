require('ts-node').register({ transpileOnly: true });
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const captures = [];
const run = (id, legacy = false) => ({ id, runId: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`, transactionTypeId: 1, status: 'SUCCESS', startedAt: new Date('2026-11-09T01:00:00Z'), endedAt: new Date('2026-11-09T01:00:05Z'), totalRecords: 10, insertedCount: 3, updatedCount: 2, skippedCount: 5, failedCount: 0, errorMessage: null, transactionType: { code: 'SAP2SDB_ITEM' }, _count: { items: 10 }, details: legacy ? [] : [{ id: 1, step: 'ACTOR', level: 'INFO', message: JSON.stringify({ userId: 7, name: 'Roe', email: 'roe@example.test' }), referenceKey: null }, { id: 2, step: 'MAPPING', level: 'INFO', message: 'Item mapping version 2', referenceKey: null }] });
const prisma = {
  auditLog: {
    findMany: async args => { captures.push(args); return [run(1), run(2, true)]; }, count: async args => args.where?.status === 'RUNNING' ? 1 : 2,
    findUnique: async args => args.where.id === 999 ? null : run(args.where.id, args.where.id === 2),
    groupBy: async () => [{ transactionTypeId: 1, status: 'SUCCESS', _count: { _all: 2 }, _sum: { totalRecords: 10, insertedCount: 3, updatedCount: 2, skippedCount: 5, failedCount: 0 } }, { transactionTypeId: 1, status: 'PARTIAL', _count: { _all: 1 }, _sum: { totalRecords: 6, insertedCount: 1, updatedCount: 1, skippedCount: 3, failedCount: 1 } }],
  },
  transactionType: { findMany: async () => [{ id: 1, code: 'SAP2SDB_ITEM' }] },
  auditTransactionItem: { findMany: async args => { captures.push(args); return [{ id: 1, auditLogId: args.where.auditLogId, entity: 'Item', referenceKey: 'I1', action: 'UPDATE', status: 'SUCCESS', errorMessage: null, payload: JSON.stringify({ changes: [{ field: 'name', from: 'Old', to: 'New' }] }) }]; }, count: async () => 1 },
  $queryRaw: async () => [{ day: new Date('2026-11-09T00:00:00Z'), status: 'SUCCESS', runs: 2 }, { day: new Date('2026-11-09T00:00:00Z'), status: 'PARTIAL', runs: 1 }],
};
const id = require.resolve('../src/lib/prisma'); require.cache[id] = { id, filename: id, loaded: true, exports: { prisma } };
const { auditRouter } = require('../src/modules/audit/routes');
const { auditWhere, describeTransaction } = require('../src/modules/audit/service');
let server, base;
before(async () => { const app = express(); app.use('/api/audit', auditRouter); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/audit`; });
after(() => new Promise(resolve => server.close(resolve)));
test('run list/details expose recorded actors, timestamps and counts without inventing historical initiators', async () => {
  const list = await (await fetch(base + '/runs?from=2026-11-09&to=2026-11-09')).json();
  assert.equal(list.data[0].actor.name, 'Roe'); assert.equal(list.data[1].actor, null); assert.equal(list.data[0].durationMs, 5000);
  assert.equal(list.data[0].module, 'Items'); assert.equal(list.timezone, 'Asia/Manila');
  const detail = await (await fetch(base + '/runs/1')).json(); assert.equal(detail.steps.length, 1); assert.equal(detail.steps[0].step, 'MAPPING');
  assert.equal((await fetch(base + '/runs/999')).status, 404);
});
test('record pagination is scoped to its run and filters; structured changes remain readable', async () => {
  const result = await (await fetch(base + '/runs/1/items?page=2&limit=20&action=UPDATE&status=FAILED&search=I1')).json();
  assert.equal(result.data[0].payload.changes[0].to, 'New');
  assert.equal(captures.at(-1).where.auditLogId, 1); assert.equal(captures.at(-1).where.status, 'FAILED'); assert.equal(captures.at(-1).skip, 20);
});
test('dates use Philippine boundaries, attention covers partial/failed, and invalid query values are rejected', async () => {
  const where = auditWhere({ from: '2026-11-09', to: '2026-11-09', status: 'ATTENTION' });
  assert.equal(where.startedAt.gte.toISOString(), '2026-11-08T16:00:00.000Z'); assert.equal(where.startedAt.lt.toISOString(), '2026-11-09T16:00:00.000Z');
  assert.deepEqual(where.status.in, ['FAILED', 'PARTIAL']);
  for (const suffix of ['/runs?page=-1', '/runs?limit=101', '/runs?from=2026-02-30', '/runs?from=2026-11-10&to=2026-11-09', '/runs?status=BOGUS', '/runs/0', '/runs/1/items?action=DELETE', '/overview?days=8']) assert.equal((await fetch(base + suffix)).status, 400, suffix);
});
test('overview uses actual grouped counts and Manila calendar days with a completed-run denominator', async () => {
  const clock = Date.now; Date.now = () => new Date('2026-11-09T02:00:00Z').getTime();
  try {
    const data = await (await fetch(base + '/overview?days=7')).json();
    assert.equal(data.totals.runs, 3); assert.equal(data.totals.failedRecords, 1); assert.equal(data.successRate, 66.7); assert.equal(data.totals.running, 1);
    assert.equal(data.trend[0].date, '2026-11-03'); assert.equal(data.trend.at(-1).date, '2026-11-09'); assert.equal(data.trend.at(-1).failed, 1);
    assert.equal(data.modules[0].module, 'Items'); assert.equal(data.modules[0].changed, 7);
    assert.equal(describeTransaction('IM2SDB_ITEMGROUP_SELECTED').flow, 'Item Master → Staging');
    assert.equal(describeTransaction('SDB2SP_UOM').module, 'UOM');
  } finally { Date.now = clock; }
});
