require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { cachedDataRead, invalidateDataReads, dataReadCacheLifecycle } = require('../src/lib/data-read-cache');

test('simultaneous reads share work; cached data expires and failed reads are retried', async () => {
  invalidateDataReads(); let calls = 0;
  const clock = Date.now; let now = clock(); Date.now = () => now;
  try {
    const read = async () => { calls++; return ['row']; };
    await Promise.all([cachedDataRead('one', read), cachedDataRead('one', read)]);
    assert.equal(calls, 1);
    now += 14999; await cachedDataRead('one', read); assert.equal(calls, 1);
    now += 2; await cachedDataRead('one', read); assert.equal(calls, 2);
    await assert.rejects(cachedDataRead('error', async () => { throw new Error('unavailable'); }), /unavailable/);
    assert.deepEqual(await cachedDataRead('error', read), ['row']);
  } finally { Date.now = clock; invalidateDataReads(); }
});
test('invalidating an in-flight read prevents stale data from returning to the cache', async () => {
  invalidateDataReads(); let release;
  const old = cachedDataRead('one', () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  invalidateDataReads();
  await cachedDataRead('one', async () => ['fresh']);
  release(['stale']); await old;
  assert.deepEqual(await cachedDataRead('one', async () => ['wrong']), ['fresh']);
});
test('forced refresh and sync start/finish invalidate cached reads, including failed/partial runs', async () => {
  invalidateDataReads(); let calls = 0;
  const read = () => cachedDataRead('one', async () => ++calls);
  await read();
  const response = new EventEmitter(); let next = 0;
  dataReadCacheLifecycle({ method: 'GET', path: '/sync/data/uom/sharepoint', get: () => '1' }, response, () => next++);
  assert.equal(await read(), 2);
  dataReadCacheLifecycle({ method: 'POST', path: '/api/mappings/sap-staging/branch-a/run', get: () => undefined }, response, () => next++);
  assert.equal(await read(), 3);
  response.emit('finish'); assert.equal(await read(), 4); assert.equal(next, 2);
});
test('cache keeps at most eight collections and skips oversized snapshots', async () => {
  invalidateDataReads(); let calls = 0;
  for (let i = 0; i < 9; i++) await cachedDataRead(String(i), async () => ++calls);
  await cachedDataRead('0', async () => ++calls); assert.equal(calls, 10);
  await cachedDataRead('large', async () => Array(50001).fill(null));
  assert.equal(await cachedDataRead('large', async () => 'reloaded'), 'reloaded');
});
