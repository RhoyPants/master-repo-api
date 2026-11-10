require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MappingError } = require('../src/modules/mappings/domain');
let fixture;
const inject = (relative, exports) => {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const db = {
  transactionType: { upsert: async () => ({ id: 1 }) },
  auditLog: {
    create: async () => { fixture.auditCreated++; return { id: 1 }; },
    update: async value => { fixture.auditUpdates.push(value.data); },
  },
  auditLogDetail: { create: async () => ({}) },
  auditTransactionItem: { create: async value => { fixture.auditItems.push(value.data); } },
};
inject('../src/lib/prisma', { prisma: db });
inject('../src/modules/mappings/store', { savedMapping: async () => fixture.saved });
inject('../src/modules/mappings/metadata', {
  sourceColumns: async () => [{ name: 'Code', type: 'nvarchar', nullable: false }, { name: 'Name', type: 'nvarchar', nullable: false }],
  destinationColumns: async () => [
    { name: 'ExternalKey', displayName: 'Key', type: 'text', required: true, supported: true },
    { name: 'RenamedDescription', displayName: 'Description', type: 'text', required: true, supported: true },
  ],
  loadLookups: async () => new Map(), sourceFieldNames: c => [c.source.key, ...c.fields.map(f => f.source)],
  readRows: async () => fixture.rows,
  listPath: () => 'sites/site/lists/list',
  collection: async () => {
    if (fixture.gate) await fixture.gate;
    return fixture.existing;
  },
  graph: async (path, init) => {
    fixture.writes.push({ path, ...init, body: JSON.parse(init.body) });
    if (fixture.failKey && JSON.stringify(init.body).includes(fixture.failKey)) throw new Error('Simulated write failure');
    return { id: 'created' };
  },
});
const { executeMapping, previewMapping } = require('../src/modules/mappings/service');
function reset() {
  fixture = {
    saved: { module: 'custom', enabled: true, version: 7, config: {
      schemaVersion: 1, module: 'custom', name: 'Custom table and renamed fields',
      source: { table: 'dbo.RenamedSource', key: 'Code', filters: [] }, destination: { siteId: 'site', listId: 'list', key: 'ExternalKey' },
      fields: [{ source: 'Code', target: 'ExternalKey', transform: 'uppercase' }, { source: 'Name', target: 'RenamedDescription', transform: 'copy' }],
    } }, rows: [], existing: [], writes: [], auditItems: [], auditUpdates: [], auditCreated: 0,
  };
}
test('saved configuration drives inserts, updates, skips, eTags and audit counts for arbitrary field names', async () => {
  reset();
  fixture.rows = [{ Code: 'a', Name: 'New' }, { Code: 'b', Name: 'Changed' }, { Code: 'c', Name: 'Same' }];
  fixture.existing = [
    { id: '2', eTag: 'version-2', fields: { ExternalKey: 'B', RenamedDescription: 'Old' } },
    { id: '3', fields: { ExternalKey: 'C', RenamedDescription: 'Same' } },
  ];
  const result = await executeMapping('custom');
  assert.equal(result.mappingVersion, 7);
  assert.deepEqual([result.inserted, result.updated, result.skipped, result.failed], [1, 1, 1, 0]);
  assert.deepEqual(fixture.writes[0].body, { fields: { ExternalKey: 'A', RenamedDescription: 'New' } });
  assert.equal(fixture.writes[1].headers['If-Match'], 'version-2');
  assert.deepEqual(fixture.writes[1].body, { ExternalKey: 'B', RenamedDescription: 'Changed' });
  assert.equal(fixture.auditItems.length, 3);
  assert.equal(fixture.auditUpdates.at(-1).status, 'SUCCESS');
});
test('selected-record runs never write unselected source rows and report missing keys', async () => {
  reset(); fixture.rows = [{ Code: 'A', Name: 'First' }, { Code: 'B', Name: 'Second' }];
  const result = await executeMapping('custom', [' b ', 'missing']);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].body.fields.ExternalKey, 'B');
  assert.deepEqual(result.missingCodes, ['MISSING']);
});
test('preflight rejects an invalid later row before the first write', async () => {
  reset(); fixture.rows = [{ Code: 'A', Name: 'Valid' }, { Code: 'B', Name: null }];
  await assert.rejects(executeMapping('custom'), /Description is required/);
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.auditCreated, 0);
});
test('duplicate source or SharePoint keys block all writes', async () => {
  reset(); fixture.rows = [{ Code: 'a', Name: 'One' }, { Code: 'A', Name: 'Two' }];
  await assert.rejects(executeMapping('custom'), /duplicated/); assert.equal(fixture.writes.length, 0);
  reset(); fixture.rows = [{ Code: 'a', Name: 'One' }];
  fixture.existing = [{ id: '1', fields: { ExternalKey: 'A' } }, { id: '2', fields: { ExternalKey: 'a' } }];
  await assert.rejects(executeMapping('custom'), /Duplicate SharePoint/); assert.equal(fixture.writes.length, 0);
});
test('read-only preview never calls Graph writes or creates audit runs', async () => {
  reset(); fixture.rows = [{ Code: 'A', Name: 'Preview' }];
  const result = await previewMapping(fixture.saved.config);
  assert.equal(result.sampleCount, 1); assert.equal(result.rows[0].create.ExternalKey, 'A');
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.auditCreated, 0);
});
test('partial failures are counted per row without discarding successful results', async () => {
  reset(); fixture.rows = [{ Code: 'A', Name: 'Good' }, { Code: 'B', Name: 'FAIL' }]; fixture.failKey = 'FAIL';
  const result = await executeMapping('custom');
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.inserted, 1); assert.equal(result.failed, 1);
  assert.equal(fixture.auditItems[1].status, 'FAILED');
});
test('concurrent configured runs for the same list are rejected and the lock is released', async () => {
  reset(); fixture.rows = [{ Code: 'A', Name: 'Good' }];
  let release;
  fixture.gate = new Promise(resolve => { release = resolve; });
  const first = executeMapping('custom');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(executeMapping('custom'), error => error instanceof MappingError && error.status === 409);
  release(); await first;
  fixture.gate = null; await executeMapping('custom');
});
test('disabled mappings cannot be run', async () => {
  reset(); fixture.saved.enabled = false;
  await assert.rejects(executeMapping('custom'), /Enable and save/);
  assert.equal(fixture.writes.length, 0);
});
