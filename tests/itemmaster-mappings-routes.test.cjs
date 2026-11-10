require('ts-node').register({ transpileOnly: true });
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MappingError } = require('../src/modules/mappings/domain');
const { defaultItemMasterMappings } = require('../src/modules/mappings/itemmaster/domain');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
inject('../src/modules/mappings/metadata', { sourceTables: async () => [{ id: 'catalog.Groups', schema: 'catalog', name: 'Groups' }] });
let enabled = false, missingStorage = false, executions = [], saves = [], server, base;
inject('../src/modules/mappings/itemmaster/metadata', { itemMasterSourceColumns: async table => [{ name: table || 'ItemGroupID' }], itemMasterColumns: async table => [{ name: table || 'ItemGroupID' }], itemMasterTables: async () => [{ id: 'dbo.item_classes', schema: 'dbo', name: 'item_classes' }] });
inject('../src/modules/mappings/itemmaster/service', {
  prepareItemMasterMapping: async () => ({}), previewItemMasterMapping: async () => ({ rows: [] }),
  executeItemMasterMapping: async (module, codes) => { executions.push({ module, codes }); return { module, failed: 0, mappingVersion: 1 }; },
});
inject('../src/modules/mappings/itemmaster/store', { itemMasterMappingStore: {
  savedMapping: async () => { if (missingStorage) throw { meta: { code: '208' } }; return enabled ? { enabled: true } : null; },
  savedMappings: async () => [],
  mappingHistory: async () => ({ versions: [], nextBeforeVersion: null }),
  mappingVersion: async () => { throw new MappingError('Version not found', 404); },
  saveMapping: async (config, enabled, version, actor) => { saves.push({ config, enabled, version, actor }); return { config, enabled, version: version + 1 }; },
} });
const { itemMasterMappingsRouter, configuredItemMasterSync } = require('../src/modules/mappings/itemmaster/routes');
before(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'editor@example.test' }; next(); });
  app.use('/api/mappings/itemmaster-staging', itemMasterMappingsRouter);
  app.use('/sync/itemmaster-staging', configuredItemMasterSync, (_req, res) => res.json({ builtIn: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
const request = (path, body, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('only Item Group exposed; invalid modules, versions and bindings rejected', async () => {
  const list = await (await fetch(base + '/api/mappings/itemmaster-staging')).json();
  assert.equal(list.defaults.length, 1); assert.equal(list.defaults[0].source.table, 'item_groups');
  for (const suffix of ['/INVALID!/history', '/item-group/history/0', '/item-group/history?beforeVersion=-1', '/columns?module=item']) {
    assert.equal((await fetch(base + '/api/mappings/itemmaster-staging' + suffix)).status, 400);
  }
});
test('draft and missing-storage mappings retain built-in full and aggregate syncs', async () => {
  enabled = false; executions = [];
  assert.equal((await (await request('/sync/itemmaster-staging/item-group/run', {})).json()).builtIn, true);
  missingStorage = true;
  assert.equal((await (await request('/sync/itemmaster-staging/run', {})).json()).builtIn, true);
  missingStorage = false; assert.equal(executions.length, 0);
});
test('enabled mappings route full, single, multiple and aggregate syncs correctly', async () => {
  enabled = true; executions = [];
  await request('/sync/itemmaster-staging/item-group/run', {});
  await request('/sync/itemmaster-staging/item-group/run/single', { itemGroupId: 'A' });
  await request('/sync/itemmaster-staging/item-group/run/multiple', { codes: ['B'] });
  const aggregate = await request('/sync/itemmaster-staging/run', {});
  assert.equal(aggregate.status, 202);
  assert.equal((await aggregate.json()).result.mappingVersion, 1);
  assert.deepEqual(executions.map(row => row.codes), [undefined, ['A'], ['B'], undefined]);
  assert.equal((await request('/sync/itemmaster-staging/item-group/run/multiple', { codes: [123] })).status, 400);
  assert.equal((await request('/sync/itemmaster-staging/item-group/run/single', {})).status, 400);
  assert.equal((await (await request('/sync/itemmaster-staging/item/run', {})).json()).builtIn, true);
});
test('save/enable inputs and explicit run confirmation are validated', async () => {
  const config = defaultItemMasterMappings()[0]; saves = [];
  assert.equal((await request('/api/mappings/itemmaster-staging/item-group', { config, enabled: true, version: 0 }, 'PUT')).status, 200);
  assert.equal(saves[0].actor, 'editor@example.test');
  assert.equal((await request('/api/mappings/itemmaster-staging/item-group', { config, enabled: 'yes', version: 0 }, 'PUT')).status, 400);
  assert.equal((await request('/api/mappings/itemmaster-staging/item', { config, enabled: false, version: 0 }, 'PUT')).status, 400);
  assert.equal((await request('/api/mappings/itemmaster-staging/item-group/run', { confirm: false })).status, 400);
  assert.equal(saves.length, 1);
});

test('table discovery separates source and destination databases; columns follow both selected tables', async () => {
  const tables = await (await fetch(base + '/api/mappings/itemmaster-staging/tables')).json();
  assert.equal(tables.source[0].id, 'dbo.item_classes'); assert.equal(tables.destination[0].id, 'catalog.Groups');
  const columns = await (await fetch(base + '/api/mappings/itemmaster-staging/columns?module=item-group&sourceTable=dbo.item_classes&destinationTable=catalog.Groups')).json();
  assert.equal(columns.source[0].name, 'dbo.item_classes'); assert.equal(columns.destination[0].name, 'catalog.Groups');
});

test('custom mapping IDs support save, history and independent manual run', async () => {
  const config = structuredClone(defaultItemMasterMappings()[0]);
  config.syncModule = config.module; config.module = 'custom-branch'; config.name = 'Custom branch';
  const prefix = '/api/mappings/itemmaster-staging';
  const response = await request(prefix + '/custom-branch', { config, enabled: true, version: 0 }, 'PUT');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).config.syncModule, config.syncModule);
  assert.equal((await fetch(base + prefix + '/custom-branch/history')).status, 200);
  executions = [];
  assert.equal((await request(prefix + '/custom-branch/run', { confirm: true })).status, 200);
  assert.equal(executions[0].module, 'custom-branch');
  enabled = true; executions = [];
  await request('/sync/itemmaster-staging/item-group/run', {});
  assert.equal(executions[0].module, 'item-group', 'custom mappings never replace the canonical sync mapping');
});
