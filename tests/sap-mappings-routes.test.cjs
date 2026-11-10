require('ts-node').register({ transpileOnly: true });
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MappingError } = require('../src/modules/mappings/domain');
const { defaultSapMappings } = require('../src/modules/mappings/sap/domain');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let enabled = false, missingStorage = false, executions = [], saves = [], server, base;
inject('../src/modules/mappings/sap/metadata', { sapSourceColumns: () => [], stagingColumns: async () => [] });
inject('../src/modules/mappings/sap/service', {
  prepareSapMapping: async () => ({}), previewSapMapping: async () => ({ rows: [] }),
  executeSapMapping: async (module, codes) => { executions.push({ module, codes }); return { module, failed: 0, mappingVersion: 1 }; },
});
inject('../src/modules/mappings/sap/store', { sapMappingStore: {
  savedMapping: async () => { if (missingStorage) throw { meta: { code: '208' } }; return enabled ? { enabled: true } : null; },
  savedMappings: async () => [],
  mappingHistory: async () => ({ versions: [], nextBeforeVersion: null }),
  mappingVersion: async () => { throw new MappingError('Version not found', 404); },
  saveMapping: async (config, enabled, version, actor) => { saves.push({ config, enabled, version, actor }); return { config, enabled, version: version + 1 }; },
} });
const { sapMappingsRouter, configuredSapSync } = require('../src/modules/mappings/sap/routes');
before(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'editor@example.test' }; next(); });
  app.use('/api/mappings/sap-staging', sapMappingsRouter);
  app.use('/sync/sap-staging', configuredSapSync, (_req, res) => res.json({ builtIn: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
const request = (path, body, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('only four modules are exposed and history inputs are validated', async () => {
  const list = await (await fetch(base + '/api/mappings/sap-staging')).json();
  assert.equal(list.defaults.length, 4);
  for (const suffix of ['/INVALID!/history', '/warehouse/history/0', '/warehouse/history/nope', '/warehouse/history?beforeVersion=-1']) {
    assert.equal((await fetch(base + '/api/mappings/sap-staging' + suffix)).status, 400);
  }
  assert.equal((await fetch(base + '/api/mappings/sap-staging/warehouse/history/999')).status, 404);
});
test('draft/missing-storage syncs retain built-in handlers', async () => {
  enabled = false; executions = [];
  assert.equal((await (await request('/sync/sap-staging/warehouse/run', {})).json()).builtIn, true);
  missingStorage = true;
  assert.equal((await (await request('/sync/sap-staging/item/run', {})).json()).builtIn, true);
  missingStorage = false;
  assert.equal(executions.length, 0);
});
test('enabled mappings intercept full/single/multiple URLs and retain item response envelope', async () => {
  enabled = true; executions = [];
  await request('/sync/sap-staging/warehouse/run', {});
  await request('/sync/sap-staging/warehouse/run/single', { whCode: 'WH' });
  await request('/sync/sap-staging/uom/run/multiple', { uomCodes: ['EA'] });
  await request('/sync/sap-staging/item-class/run/single', { code: 'CLS' });
  const item = await (await request('/sync/sap-staging/item/run/multiple', { itemCodes: ['I1'] })).json();
  assert.equal(item.success, true); assert.equal(item.data.module, 'item');
  assert.deepEqual(executions.map(row => row.codes), [undefined, ['WH'], ['EA'], ['CLS'], ['I1']]);
  assert.equal((await request('/sync/sap-staging/uom/run/multiple', { codes: [123] })).status, 400);
  assert.equal((await request('/sync/sap-staging/item/run/single', {})).status, 400);
});
test('saves enforce fixed bindings, explicit enable/version flags and editor identity', async () => {
  const config = defaultSapMappings()[0]; saves = [];
  assert.equal((await request('/api/mappings/sap-staging/warehouse', { config, enabled: false, version: 0 }, 'PUT')).status, 200);
  assert.equal(saves[0].actor, 'editor@example.test');
  assert.equal((await request('/api/mappings/sap-staging/warehouse', { config, enabled: 'yes', version: 0 }, 'PUT')).status, 400);
  assert.equal((await request('/api/mappings/sap-staging/item', { config, enabled: false, version: 0 }, 'PUT')).status, 400);
  assert.equal((await request('/api/mappings/sap-staging/warehouse/run', { confirm: false })).status, 400);
  assert.equal(saves.length, 1);
});

test('custom mapping IDs support save, history and independent manual run', async () => {
  const config = structuredClone(defaultSapMappings()[0]);
  config.syncModule = config.module; config.module = 'custom-branch'; config.name = 'Custom branch';
  const prefix = '/api/mappings/sap-staging';
  const response = await request(prefix + '/custom-branch', { config, enabled: true, version: 0 }, 'PUT');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).config.syncModule, config.syncModule);
  assert.equal((await fetch(base + prefix + '/custom-branch/history')).status, 200);
  executions = [];
  assert.equal((await request(prefix + '/custom-branch/run', { confirm: true })).status, 200);
  assert.equal(executions[0].module, 'custom-branch');
  enabled = true; executions = [];
  await request('/sync/sap-staging/warehouse/run', {});
  assert.equal(executions[0].module, 'warehouse', 'custom mappings never replace the canonical sync mapping');
});
