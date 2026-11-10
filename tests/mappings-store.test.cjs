require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
let current, history, failHistory;
const config = name => ({
  schemaVersion: 1, module: 'history-check', name,
  source: { table: 'dbo.Items', key: 'ItemCode', filters: [] },
  destination: { siteId: 'site', listId: 'list', key: 'Code' },
  fields: [{ source: 'ItemCode', target: 'Code', transform: 'copy' }],
});
const query = async (strings, ...values) => {
  const sql = strings.join('?');
  if (sql.includes('TOP (21)')) return history.filter(row => row.Provider === values[0] && row.Module === values[1] && row.Version < values[2]).sort((a, b) => b.Version - a.Version).slice(0, 21);
  if (sql.includes('IntegrationMappingVersions')) return history.filter(row => row.Provider === values[0] && row.Module === values[1] && row.Version === values[2]);
  const row = current.get(`${values[0]}:${values[1]}`);
  return row ? [row] : [];
};
const tx = {
  $queryRaw: query,
  $executeRaw: async (strings, ...values) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO dbo.IntegrationMappingVersions')) {
      if (failHistory) throw new Error('History storage failed');
      history.push(structuredClone(current.get(`${values[0]}:${values[1]}`)));
    } else if (sql.includes('INSERT INTO dbo.IntegrationMappings')) {
      const key = `${values[0]}:${values[1]}`;
      if (current.has(key)) throw { meta: { code: '2627' } };
      current.set(key, { Id: 1, Provider: values[0], Module: values[1], ConfigJson: values[2], Enabled: values[3], Version: 1, UpdatedBy: values[4], UpdatedAt: new Date() });
    } else if (sql.includes('UPDATE dbo.IntegrationMappings')) {
      const key = `${values[3]}:${values[4]}`, row = current.get(key);
      if (!row || row.Version !== values[5]) return 0;
      current.set(key, { ...row, ConfigJson: values[0], Enabled: values[1], Version: row.Version + 1, UpdatedBy: values[2], UpdatedAt: new Date() });
    }
    return 1;
  },
};
const id = require.resolve('../src/lib/prisma');
require.cache[id] = { id, filename: id, loaded: true, exports: { prisma: {
  $queryRaw: query,
  $transaction: async fn => {
    const before = structuredClone({ current, history });
    try { return await fn(tx); }
    catch (error) { current = before.current; history = before.history; throw error; }
  },
} } };
const { createMappingStore, saveMapping, mappingHistory, mappingVersion } = require('../src/modules/mappings/store');
function reset() { current = new Map(); history = []; failHistory = false; }
const currentRow = () => current.get('sharepoint:history-check');
test('every save records exact config, status, editor and version without overwriting older JSON', async () => {
  reset();
  const first = await saveMapping(config('First'), false, 0, 'first@example.test');
  const second = await saveMapping(config('Second'), true, 1, 'second@example.test');
  assert.equal(first.version, 1); assert.equal(second.version, 2);
  assert.deepEqual((await mappingVersion('history-check', 1)).config, config('First'));
  assert.equal((await mappingVersion('history-check', 1)).enabled, false);
  assert.equal((await mappingVersion('history-check', 2)).updatedBy, 'second@example.test');
  assert.deepEqual((await mappingHistory('history-check')).versions.map(row => row.version), [2, 1]);
});
test('stale or duplicate saves leave both current mapping and history unchanged', async () => {
  reset();
  await saveMapping(config('First'), false, 0, 'editor');
  await assert.rejects(saveMapping(config('Stale'), true, 2, 'editor'), error => error.status === 409);
  await assert.rejects(saveMapping(config('Duplicate'), false, 0, 'editor'), error => error.status === 409);
  assert.equal(currentRow().Version, 1); assert.equal(history.length, 1);
});
test('a history write failure rolls back the mapping save instead of losing a version', async () => {
  reset();
  await saveMapping(config('First'), false, 0, 'editor');
  failHistory = true;
  await assert.rejects(saveMapping(config('Failed'), true, 1, 'editor'), /History storage failed/);
  assert.equal(currentRow().Version, 1);
  assert.equal(JSON.parse(currentRow().ConfigJson).name, 'First');
  assert.equal(history.length, 1);
});
test('history is paged newest first, excludes full JSON, and isolates modules', async () => {
  reset();
  for (let version = 0; version < 25; version++) await saveMapping(config(`Version ${version + 1}`), false, version, 'editor');
  const first = await mappingHistory('history-check');
  assert.equal(first.versions.length, 20); assert.equal(first.nextBeforeVersion, 6);
  assert.equal(first.versions[0].version, 25);
  assert.equal(first.versions[0].ConfigJson, undefined);
  assert.equal(first.versions[0].config, undefined);
  const second = await mappingHistory('history-check', first.nextBeforeVersion);
  assert.deepEqual(second.versions.map(row => row.version), [5, 4, 3, 2, 1]);
  assert.equal(second.nextBeforeVersion, null);
  assert.equal((await mappingHistory('other')).versions.length, 0);
  await assert.rejects(mappingVersion('other', 1), error => error.status === 404);
  await assert.rejects(mappingVersion('history-check', 26), error => error.status === 404);
});
test('SAP and SharePoint versions for the same module never mix', async () => {
  reset();
  const { parseConfig } = require('../src/modules/mappings/domain');
  const { defaultSapMappings, parseSapConfig } = require('../src/modules/mappings/sap/domain');
  const sp = createMappingStore('sharepoint', parseConfig), sap = createMappingStore('sap-staging', parseSapConfig);
  const spConfig = { ...config('SharePoint warehouse'), module: 'warehouse' };
  const sapConfig = defaultSapMappings().find(config => config.module === 'warehouse');
  await sp.saveMapping(spConfig, true, 0, 'sp-editor');
  await sap.saveMapping(sapConfig, false, 0, 'sap-editor');
  await sp.saveMapping({ ...spConfig, name: 'SharePoint v2' }, true, 1, 'sp-editor');
  assert.equal((await sp.savedMapping('warehouse')).version, 2);
  assert.equal((await sap.savedMapping('warehouse')).version, 1);
  assert.equal((await sap.mappingVersion('warehouse', 1)).updatedBy, 'sap-editor');
  assert.deepEqual((await sap.mappingHistory('warehouse')).versions.map(row => row.version), [1]);
  assert.equal((await sp.mappingVersion('warehouse', 1)).config.name, spConfig.name);
});
test('SQL and field mappings are immutable together; legacy SAP versions stay unchanged', async () => {
  reset();
  const { defaultSapMappings, parseSapConfig } = require('../src/modules/mappings/sap/domain');
  const sap = createMappingStore('sap-staging', parseSapConfig);
  const current = defaultSapMappings().find(config => config.module === 'uom');
  const legacy = structuredClone(current); delete legacy.source.query;
  await sap.saveMapping(legacy, false, 0, 'legacy-editor');
  await sap.saveMapping(current, true, 1, 'query-editor');
  const edited = structuredClone(current);
  edited.source.query = 'SELECT UomCode AS Code, UomName AS Name FROM OUOM';
  edited.source.key = 'Code'; edited.fields[0].source = 'Code'; edited.fields[1].source = 'Name';
  await sap.saveMapping(edited, true, 2, 'query-editor');
  assert.deepEqual((await sap.mappingVersion('uom', 1)).config, legacy);
  assert.deepEqual((await sap.mappingVersion('uom', 2)).config, current);
  assert.deepEqual((await sap.mappingVersion('uom', 3)).config, edited);
  assert.deepEqual((await sap.savedMapping('uom')).config, edited);
});

test('Item Master history is immutable and isolated from SharePoint for the same module', async () => {
  reset();
  const { defaultItemMasterMappings, parseItemMasterConfig } = require('../src/modules/mappings/itemmaster/domain');
  const { parseConfig } = require('../src/modules/mappings/domain');
  const im = createMappingStore('itemmaster-staging', parseItemMasterConfig), sp = createMappingStore('sharepoint', parseConfig);
  const initial = defaultItemMasterMappings()[0];
  await im.saveMapping(initial, false, 0, 'im-editor');
  const edited = structuredClone(initial); edited.fields.find(field => field.target === 'Name').transform = 'trim';
  await im.saveMapping(edited, true, 1, 'im-editor');
  await sp.saveMapping({ ...config('SharePoint groups'), module: 'item-group' }, true, 0, 'sp-editor');
  assert.deepEqual((await im.mappingVersion('item-group', 1)).config, initial);
  assert.deepEqual((await im.savedMapping('item-group')).config, edited);
  assert.deepEqual((await im.mappingHistory('item-group')).versions.map(row => row.version), [2, 1]);
  assert.equal((await sp.savedMapping('item-group')).version, 1);
  await assert.rejects(im.saveMapping(initial, false, 1, 'stale-editor'), error => error.status === 409);
});

test('multiple SAP and Item Master mappings retain independent versions, enable flags and snapshots', async () => {
  reset();
  const { defaultSapMappings, parseSapConfig } = require('../src/modules/mappings/sap/domain');
  const { defaultItemMasterMappings, parseItemMasterConfig } = require('../src/modules/mappings/itemmaster/domain');
  for (const [provider, parse, template] of [
    ['sap-staging', parseSapConfig, defaultSapMappings().find(config => config.module === 'uom')],
    ['itemmaster-staging', parseItemMasterConfig, defaultItemMasterMappings()[0]],
  ]) {
    const store = createMappingStore(provider, parse);
    const first = { ...structuredClone(template), module: 'branch-a', syncModule: template.module, name: 'Branch A' };
    const second = { ...structuredClone(template), module: 'branch-b', syncModule: template.module, name: 'Branch B' };
    await store.saveMapping(template, false, 0, 'editor');
    await store.saveMapping(first, true, 0, 'editor');
    await store.saveMapping(second, false, 0, 'editor');
    await store.saveMapping({ ...first, name: 'Branch A v2' }, true, 1, 'editor');
    assert.equal((await store.savedMapping('branch-a')).version, 2);
    assert.equal((await store.savedMapping('branch-b')).version, 1);
    assert.equal((await store.savedMapping(template.module)).enabled, false);
    assert.deepEqual((await store.mappingVersion('branch-a', 1)).config, first);
    assert.equal((await store.mappingVersion('branch-b', 1)).config.name, 'Branch B');
    await assert.rejects(store.saveMapping(second, true, 0, 'editor'), error => error.status === 409);
  }
});
