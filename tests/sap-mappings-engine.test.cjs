require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { defaultSapMappings, parseSapConfig, buildSapPayload } = require('../src/modules/mappings/sap/domain');
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
inject('../src/modules/mappings/sap/store', { sapMappingStore: { savedMapping: async () => ({ config: fixture.config, enabled: fixture.enabled, version: 4 }) } });
inject('../src/modules/mappings/sap/metadata', {
  identifier: value => `[${value.replace(/]/g, ']]')}]`, tableSql: () => Prisma.raw('[dbo].[Warehouses]'),
  mappingSourceColumns: async () => fixture.sourceColumns, stagingColumns: async () => fixture.columns,
  sapLookups: async () => new Map([
    [JSON.stringify({ table: 'dbo.ItemClasses', match: 'Initials', result: 'ItmsGrpCod' }), new Map([['CLS', '10']])],
    [JSON.stringify({ table: 'dbo.Uoms', match: 'UomCode', result: 'Id' }), new Map([['EA', fixture.uomId ?? 9]])],
  ]),
  itemReferenceMaps: async () => fixture.references,
  readMappingRows: async (_config, codes) => {
    if (fixture.gate) await fixture.gate;
    return { rows: codes ? fixture.rows.filter(row => codes.map(normalizedKey).includes(normalizedKey(row[fixture.config.source.key])) || codes.map(normalizedKey).includes(normalizedKey(row.Initials))) : fixture.rows, requestedCodes: codes?.map(normalizedKey) };
  },
});
const { executeSapMapping, previewSapMapping } = require('../src/modules/mappings/sap/service');
function reset(module = 'warehouse') {
  const config = defaultSapMappings().find(config => config.module === module);
  fixture = {
    config, enabled: true, rows: [], records: [], writes: [], audits: 0, auditUpdates: [], auditItems: [], auditDetails: [],
    sourceColumns: config.fields.filter(rule => rule.source).map(rule => ({ name: rule.source, type: 'text', nullable: true })),
    columns: config.fields.map(rule => ({ name: rule.target, type: ['UOM_ID', 'LeadTime'].includes(rule.target) ? 'int' : rule.target.startsWith('Is') ? 'bit' : 'nvarchar', nullable: rule.target === 'Address', supported: true, readOnly: false, hasDefault: false, maxLength: 255 })),
  };
  fixture.columns.push({ name: 'UpdatedAt', type: 'datetime', nullable: true, supported: false, readOnly: true, hasDefault: false });
}
const warehouse = (code, name) => ({ WhCode: code, WhName: name, Address: null, ResolvedIsActive: true });
function resetItem() {
  reset('item');
  fixture.references = { itemClassCodeSet: new Set(['10']), uomCodeToId: new Map([['EA', 9], ['BOX', 10]]) };
  fixture.rows = [{
    ItemCode: 'A', ItemDescription: 'ITEM', Category: 'I', validFor: 'Y', itemClassCode: 'CLS', itemClassName: 'CLASS',
    UOM: 'EA', ResolvedLeadTime: 0, NormalizedWHInventory: true,
    NormalizedSalesInventory: false, NormalizedPurchaseInventory: false, ItemGroupName: 'GROUP',
  }];
}
test('Item preview/preflight reject mismatched UOM pairs and preserve insert timestamps', async () => {
  resetItem(); fixture.uomId = 10;
  assert.match((await previewSapMapping(fixture.config)).rows[0].error, /same staging UOM/);
  await assert.rejects(executeSapMapping('item'), /same staging UOM/);
  assert.equal(fixture.writes.length, 0);
  fixture.uomId = 9;
  assert.equal((await executeSapMapping('item')).inserted, 1);
  assert.ok(fixture.records[0].UpdatedAt instanceof Date);
  const timestamp = fixture.records[0].UpdatedAt.getTime();
  assert.equal((await executeSapMapping('item')).skipped, 1);
  assert.equal(fixture.records[0].UpdatedAt.getTime(), timestamp);
  fixture.config.fields.find(rule => rule.target === 'UOM_ID').write = 'create';
  await assert.rejects(previewSapMapping(fixture.config), /UOM and UOM_ID together/);
});
test('mapping audit-detail failure closes the audit without staging writes', async () => {
  reset(); fixture.rows = [warehouse('A', 'NAME')]; fixture.failAuditDetail = true;
  await assert.rejects(executeSapMapping('warehouse'), /Audit detail unavailable/);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.auditUpdates.at(-1).status, 'FAILED');
});
test('all four default mappings preserve fixed module/table/key bindings', () => {
  assert.equal(defaultSapMappings().length, 4);
  for (const config of defaultSapMappings()) parseSapConfig(config);
  const config = defaultSapMappings()[0];
  assert.throws(() => parseSapConfig({ ...config, module: 'custom' }), /supports/);
  assert.throws(() => parseSapConfig({ ...config, destination: { ...config.destination, table: 'dbo.users' } }), /existing SAP source/);
  assert.throws(() => parseSapConfig({ ...config, source: { ...config.source, key: 'OtherKey' } }), /selected query record key/);
});
test('configured runs insert, update, skip, manage timestamps and audit the saved version', async () => {
  reset();
  fixture.rows = [warehouse('A', 'NEW'), warehouse('B', 'CHANGED'), warehouse('C', 'SAME')];
  fixture.records = [{ WhCode: 'B', WhName: 'OLD', Address: null, IsActive: true }, { WhCode: 'C', WhName: 'SAME', Address: null, IsActive: true }];
  const result = await executeSapMapping('warehouse');
  assert.deepEqual([result.inserted, result.updated, result.skipped, result.failed], [1, 1, 1, 0]);
  assert.equal(result.mappingVersion, 4); assert.equal(result.items[0].whCode, 'A');
  assert.ok(fixture.records.find(row => row.WhCode === 'B').UpdatedAt instanceof Date);
  assert.equal(fixture.records.find(row => row.WhCode === 'C').UpdatedAt, undefined);
  assert.match(fixture.auditDetails[0].message, /version 4/);
  assert.equal(fixture.auditUpdates.at(-1).status, 'SUCCESS');
  assert.equal(fixture.transaction, 'SAP2SDB_WAREHOUSE');
});
test('preview is read-only, samples five and surfaces row value errors', async () => {
  reset(); fixture.rows = Array.from({ length: 8 }, (_, index) => warehouse(String(index), 'NAME'));
  fixture.rows[1].WhName = null;
  const result = await previewSapMapping(fixture.config);
  assert.equal(result.sampleCount, 5); assert.match(result.rows[1].error, /required/);
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.audits, 0);
});
test('all rows are preflighted before writes and duplicate keys block the run', async () => {
  reset(); fixture.rows = [warehouse('A', 'VALID'), warehouse('B', null)];
  await assert.rejects(executeSapMapping('warehouse'), /required/);
  assert.equal(fixture.writes.length, 0);
  reset(); fixture.rows = [warehouse('a', 'ONE'), warehouse('A', 'TWO')];
  await assert.rejects(executeSapMapping('warehouse'), /Duplicate/);
  assert.equal(fixture.writes.length, 0);
  reset(); fixture.rows = [warehouse('A', 'ONE')]; fixture.records = [warehouse('A', 'OLD'), warehouse(' a ', 'OLD')];
  await assert.rejects(executeSapMapping('warehouse'), /Duplicate normalized staging/);
});
test('selected codes and configured filters restrict writes and report missing inputs', async () => {
  reset(); fixture.config.source.filters = [{ column: 'WhName', value: 'SECOND' }];
  fixture.rows = [warehouse('A', 'FIRST'), warehouse('B', 'SECOND')];
  const result = await executeSapMapping('warehouse', ['A', 'B', 'MISSING']);
  assert.equal(result.inserted, 1); assert.equal(fixture.records[0].WhCode, 'B');
  assert.deepEqual(result.missingCodes, ['A', 'MISSING']);
  assert.equal(fixture.transaction, 'SAP2SDB_WAREHOUSE_SELECTED');
});
test('stage writes are parameterized and per-record failures preserve successful records', async () => {
  reset(); const code = "A'; DELETE FROM Warehouses; --";
  fixture.rows = [warehouse(code, 'SAFE'), warehouse('B', 'FAIL')]; fixture.failCode = 'B';
  const result = await executeSapMapping('warehouse');
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.inserted, 1); assert.equal(result.failed, 1);
  assert.equal(fixture.records[0].WhCode, code);
  assert.ok(!fixture.writes[0].sql.includes(code));
  assert.ok(fixture.writes[0].values[2].values.includes(code));
  assert.equal(fixture.auditItems[1].status, 'FAILED');
});
test('Item Class IsActive alone does not change legacy update/skip behavior', async () => {
  reset('item-class');
  fixture.rows = [{ ItmsGrpCod: '10', Initials: 'CLS', ItmsGrpNam: 'NAME' }];
  fixture.records = [{ ItmsGrpCod: '10', Initials: 'CLS', ItmsGrpNam: 'NAME', IsActive: false }];
  assert.equal((await executeSapMapping('item-class', ['CLS'])).skipped, 1);
  fixture.rows[0].ItmsGrpNam = 'CHANGED';
  assert.equal((await executeSapMapping('item-class')).updated, 1);
  assert.equal(fixture.records[0].IsActive, true);
});
test('unsupported/managed columns, missing required fields and invalid booleans/integers are rejected', async () => {
  reset();
  fixture.config.fields.push({ source: '', target: 'UpdatedAt', transform: 'constant', value: 'date' });
  await assert.rejects(previewSapMapping(fixture.config), /managed automatically/);
  reset(); fixture.config.fields = fixture.config.fields.filter(rule => rule.target !== 'WhName');
  await assert.rejects(previewSapMapping(fixture.config), /Required staging field WhName/);
  reset(); fixture.rows = [warehouse('A', 'NAME')]; fixture.rows[0].ResolvedIsActive = 'Y';
  assert.match((await previewSapMapping(fixture.config)).rows[0].error, /boolean/);
  const config = defaultSapMappings()[0]; config.fields.push({ source: 'Count', target: 'Count', transform: 'copy' });
  assert.throws(() => buildSapPayload(config, { ...warehouse('A', 'NAME'), Count: 2147483648 }, [...fixture.columns, { name: 'Count', type: 'int', nullable: false }], new Map(), 'create'), /integer range/);
});
test('disabled mappings and concurrent runs cannot write', async () => {
  reset(); fixture.enabled = false;
  await assert.rejects(executeSapMapping('warehouse'), /enable/);
  fixture.enabled = true; fixture.rows = [warehouse('A', 'NAME')];
  let release; fixture.gate = new Promise(resolve => { release = resolve; });
  const first = executeSapMapping('warehouse');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(executeSapMapping('warehouse'), error => error.status === 409);
  release(); await first; fixture.gate = null;
  assert.equal((await executeSapMapping('warehouse')).skipped, 1);
});

test('custom SAP mapping IDs execute using their template rules and report their own identity', async () => {
  reset(); fixture.config.syncModule = 'warehouse'; fixture.config.module = 'warehouse-branch-a';
  fixture.rows = [warehouse('A', 'CUSTOM')];
  const result = await executeSapMapping('warehouse-branch-a');
  assert.equal(result.mappingId, 'warehouse-branch-a'); assert.equal(result.module, 'warehouse');
  assert.equal(result.inserted, 1); assert.match(fixture.auditDetails[0].message, /warehouse-branch-a/);
  resetItem(); fixture.config.syncModule = 'item'; fixture.config.module = 'item-branch-a';
  fixture.config.fields.find(rule => rule.target === 'UOM_ID').write = 'create';
  await assert.rejects(previewSapMapping(fixture.config), /UOM and UOM_ID together/);
  const invalid = defaultSapMappings()[0]; invalid.syncModule = 'uom';
  assert.throws(() => parseSapConfig(invalid), /original mapping ID/);
});
