require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { defaultItemMasterMappings, parseItemMasterConfig } = require('../src/modules/mappings/itemmaster/domain');
const { normalizedKey } = require('../src/modules/mappings/domain');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let fixture;
const tx = {
  $queryRaw: async (_strings, ...values) => {
    const key = values.at(-1);
    const row = fixture.records.find(row => normalizedKey(row[fixture.config.destination.key]) === key);
    return row ? [structuredClone(row)] : [];
  },
  $executeRaw: async (strings, ...values) => {
    const sql = strings.join('?');
    fixture.writes.push({ sql, values });
    if (sql.includes('INSERT')) {
      const names = [...values[1].sql.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
      const row = Object.fromEntries(names.map((name, index) => [name, values[2].values[index]]));
      if (row[fixture.config.destination.key] === fixture.failCode) throw new Error('Simulated staging failure');
      fixture.records.push(row);
    } else {
      const key = values.at(-1);
      if (key === fixture.failCode) throw new Error('Simulated staging failure');
      const row = fixture.records.find(row => normalizedKey(row[fixture.config.destination.key]) === key);
      const names = [...values[1].sql.matchAll(/\[([^\]]+)\] = \?/g)].map(match => match[1]);
      names.forEach((name, index) => { row[name] = values[1].values[index]; });
    }
    return 1;
  },
};
const db = {
  $queryRaw: async () => fixture.records,
  $transaction: async fn => {
    const before = structuredClone(fixture.records);
    try { return await fn(tx); } catch (error) { fixture.records = before; throw error; }
  },
  transactionType: { upsert: async args => { fixture.transaction = args.where.code; return { id: 1 }; } },
  auditLog: { create: async () => { fixture.audits++; return { id: 1 }; }, update: async args => fixture.auditUpdates.push(args.data) },
  auditLogDetail: { create: async args => { if (fixture.failAuditDetail) throw new Error('Audit detail unavailable'); fixture.auditDetails.push(args.data); } },
  auditTransactionItem: { create: async args => fixture.auditItems.push(args.data) },
};
inject('../src/lib/prisma', { prisma: db });
inject('../src/modules/mappings/metadata', { loadLookups: async () => new Map() });
inject('../src/modules/mappings/itemmaster/store', { itemMasterMappingStore: { savedMapping: async () => ({ config: fixture.config, enabled: fixture.enabled, version: 4 }) } });
inject('../src/modules/mappings/itemmaster/metadata', {
  itemMasterSourceColumns: async () => fixture.sourceColumns, itemMasterColumns: async () => fixture.columns,
  itemMasterDestination: async table => ({ sql: Prisma.raw(table.split('.').map(name => `[${name}]`).join('.')) }),
  readItemMasterRows: async (_config, codes) => {
    if (fixture.gate) await fixture.gate;
    return { rows: codes ? fixture.rows.filter(row => codes.map(normalizedKey).includes(normalizedKey(row[fixture.config.source.key]))) : fixture.rows, requestedCodes: codes?.map(normalizedKey) };
  },
});
const { executeItemMasterMapping, previewItemMasterMapping } = require('../src/modules/mappings/itemmaster/service');
function reset() {
  const config = defaultItemMasterMappings()[0];
  fixture = { config, enabled: true, rows: [], records: [], writes: [], audits: 0, auditUpdates: [], auditItems: [], auditDetails: [],
    sourceColumns: ['ItemGroupID', 'Initials', 'Name', 'ItemClassCode', 'ItemClass', 'Category'].map(name => ({ name, type: 'text', nullable: false })),
    columns: config.fields.map(rule => ({ name: rule.target, type: rule.target === 'IsActive' ? 'bit' : 'nvarchar', nullable: false, supported: true, readOnly: false, hasDefault: false, maxLength: 150 })),
  };
  fixture.columns.push({ name: 'UpdatedAt', type: 'datetime', nullable: true, supported: false, readOnly: true, hasDefault: false });
}
const row = (code, name = 'GROUP') => ({ ItemGroupID: code, Initials: 'GRP', Name: name, ItemClassCode: '', ItemClass: '', Category: 'I' });

test('table and key choices are configurable; SQL and inconsistent keys rejected', () => {
  reset(); assert.equal(parseItemMasterConfig(fixture.config).module, 'item-group');
  const config = structuredClone(fixture.config);
  config.source.table = 'inventory.product_groups'; config.source.key = 'group_code';
  config.destination.table = 'catalog.Groups'; config.destination.key = 'ExternalCode';
  config.fields[0] = { source: 'group_code', target: 'ExternalCode', transform: 'uppercase' };
  assert.equal(parseItemMasterConfig(config).destination.table, 'catalog.Groups');
  assert.throws(() => parseItemMasterConfig({ ...config, source: { ...config.source, query: 'SELECT 1' } }), /custom SQL/);
  assert.throws(() => parseItemMasterConfig({ ...config, destination: { table: '', key: 'ExternalCode' } }), /Choose/);
  config.fields[0].source = 'other';
  assert.throws(() => parseItemMasterConfig(config), /selected source record key/);
});
test('inserts, updates, skips, reactivates and audits exact saved mapping version', async () => {
  reset(); fixture.rows = [row('A'), row('B', 'CHANGED'), row('C'), row('D')];
  fixture.records = [{ ...row('B', 'OLD'), IsActive: true }, { ...row('C'), IsActive: true }, { ...row('D'), IsActive: false }];
  const result = await executeItemMasterMapping('item-group');
  assert.deepEqual([result.inserted, result.updated, result.skipped, result.failed], [1, 2, 1, 0]);
  assert.equal(result.module, 'itemmaster-staging'); assert.equal(result.entity, 'item-group');
  assert.equal(result.mappingVersion, 4); assert.equal(result.items[0].itemGroupId, 'A');
  assert.equal(result.items[1].changes[0].field, 'name');
  assert.equal(fixture.records.find(record => record.ItemGroupID === 'D').IsActive, true);
  assert.ok(fixture.records.find(record => record.ItemGroupID === 'B').UpdatedAt instanceof Date);
  assert.equal(fixture.records.find(record => record.ItemGroupID === 'C').UpdatedAt, undefined);
  assert.match(fixture.auditDetails[0].message, /version 4/);
  assert.equal(fixture.transaction, 'IM2SDB_ITEMGROUP');
});
test('preview is read-only and all eligible rows preflight before writes', async () => {
  reset(); fixture.rows = Array.from({ length: 8 }, (_, i) => row(String(i)));
  fixture.rows[7].Name = null;
  assert.equal((await previewItemMasterMapping(fixture.config)).sampleCount, 5);
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.audits, 0);
  await assert.rejects(executeItemMasterMapping('item-group'), /required/);
  assert.equal(fixture.writes.length, 0);
  reset(); fixture.rows = [row('a'), row(' A ')];
  await assert.rejects(executeItemMasterMapping('item-group'), /Duplicate/);
  assert.equal(fixture.writes.length, 0);
  reset(); fixture.rows = [row('A')]; fixture.records = [row('A'), row(' a ')];
  await assert.rejects(executeItemMasterMapping('item-group'), /Duplicate normalized/);
});
test('selected codes, filters and write modes are honored; filtered codes are reported missing', async () => {
  reset(); fixture.config.source.filters = [{ column: 'Category', value: 'I' }];
  fixture.rows = [row('A'), { ...row('B'), Category: 'S' }, row('C')];
  fixture.records = [{ ...row('A', 'KEEP'), IsActive: true }];
  fixture.config.fields.find(field => field.target === 'Name').write = 'create';
  const result = await executeItemMasterMapping('item-group', ['a', 'B', 'MISSING']);
  assert.equal(result.skipped, 1); assert.equal(fixture.records[0].Name, 'KEEP');
  assert.deepEqual(result.missingCodes, ['B', 'MISSING']);
  assert.equal(fixture.transaction, 'IM2SDB_ITEMGROUP_SELECTED');
  assert.equal(fixture.records.length, 1);
});
test('managed timestamps, missing columns and required fields cannot be mapped incorrectly', async () => {
  reset(); fixture.config.fields.push({ source: '', target: 'UpdatedAt', transform: 'constant', value: 'date' });
  await assert.rejects(previewItemMasterMapping(fixture.config), /managed automatically/);
  reset(); fixture.config.fields.find(field => field.target === 'Name').source = 'Missing';
  await assert.rejects(previewItemMasterMapping(fixture.config), /unavailable/);
  reset(); fixture.config.fields = fixture.config.fields.filter(field => field.target !== 'Name');
  await assert.rejects(previewItemMasterMapping(fixture.config), /Required staging field Name/);
});
test('per-record failures roll back, preserve successful records and close audit', async () => {
  reset(); fixture.rows = [row("A'; DELETE FROM ItemGroups; --"), row('B')]; fixture.failCode = 'B';
  const result = await executeItemMasterMapping('item-group');
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.inserted, 1); assert.equal(result.failed, 1);
  assert.equal(fixture.records.length, 1);
  assert.ok(!fixture.writes[0].sql.includes('DELETE'));
  assert.equal(fixture.auditUpdates.at(-1).failedCount, 1);
});
test('disabled and concurrent runs cannot write; lock releases after completion', async () => {
  reset(); fixture.enabled = false;
  await assert.rejects(executeItemMasterMapping('item-group'), /enable/);
  fixture.enabled = true; fixture.rows = [row('A')];
  let release; fixture.gate = new Promise(resolve => { release = resolve; });
  const first = executeItemMasterMapping('item-group');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(executeItemMasterMapping('item-group'), error => error.status === 409);
  release(); await first; fixture.gate = null;
  assert.equal((await executeItemMasterMapping('item-group')).skipped, 1);
});

test('execution writes the selected destination table with its chosen key and selected source IDs', async () => {
  reset();
  fixture.config.source.table = 'inventory.product_groups'; fixture.config.source.key = 'group_code';
  fixture.config.destination = { table: 'catalog.Groups', key: 'ExternalCode' };
  fixture.config.fields[0] = { source: 'group_code', target: 'ExternalCode', transform: 'uppercase' };
  fixture.sourceColumns[0].name = 'group_code'; fixture.columns[0].name = 'ExternalCode';
  fixture.rows = [{ ...row('ignored'), group_code: 'X1' }, { ...row('ignored'), group_code: 'X2' }];
  const result = await executeItemMasterMapping('item-group', ['x2']);
  assert.equal(result.inserted, 1); assert.equal(fixture.records[0].ExternalCode, 'X2');
  assert.match(fixture.writes[0].values[0].sql, /\[catalog\]\.\[Groups\]/);
  assert.match(fixture.auditDetails[0].message, /inventory.product_groups/);
});

test('custom Item Master mapping IDs run independently and appear in audit/results', async () => {
  reset(); fixture.config.module = 'groups-branch-a'; fixture.config.syncModule = 'item-group';
  fixture.rows = [row('A')];
  const result = await executeItemMasterMapping('groups-branch-a');
  assert.equal(result.mappingId, 'groups-branch-a'); assert.equal(result.entity, 'item-group');
  assert.equal(result.inserted, 1); assert.match(fixture.auditDetails[0].message, /groups-branch-a/);
});
