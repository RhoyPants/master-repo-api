require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sql = require('mssql');
let columns, rows, captured, cancelled, describeError;
const id = require.resolve('../src/lib/sap');
require.cache[id] = { id, filename: id, loaded: true, exports: { getSapQueryPool: async () => ({ request: () => {
  const request = new EventEmitter();
  request.input = (name, _type, value) => { captured = value; return request; };
  request.cancel = () => { cancelled = true; };
  request.query = async query => {
    if (query.includes('sp_describe_first_result_set')) { if (describeError) throw describeError; return { recordset: columns }; }
    captured = query; cancelled = false;
    for (const row of rows) { request.emit('row', row); if (cancelled) throw new sql.RequestError('Cancelled', 'ECANCEL'); }
    return {};
  };
  return request;
} }) } };
const { validateSapQuery, describeSapQuery, executeSapQuery, testSapQuery } = require('../src/modules/mappings/sap/query');
const { defaultSapMappings, parseSapConfig } = require('../src/modules/mappings/sap/domain');
const prismaId = require.resolve('../src/lib/prisma');
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: { prisma: {
  itemClass: { findMany: async () => [{ itmsGrpCod: '10', initials: 'CLS' }, { itmsGrpCod: '20', initials: 'DUP' }, { itmsGrpCod: '21', initials: 'DUP' }] },
  uom: { findMany: async () => [{ id: 9, uomCode: 'EA' }] },
} } };
const { readMappingRows, mappingSourceColumns, sapLookups } = require('../src/modules/mappings/sap/metadata');
test('SELECT aliases, CTEs, joins, computed expressions and every default query are supported', () => {
  for (const config of defaultSapMappings()) assert.match(validateSapQuery(config.source.query), /SELECT/);
  const query = "WITH x AS (SELECT UomCode AS Code FROM dbo.OUOM) SELECT x.Code, UPPER(u.UomName) AS Name FROM x JOIN OUOM u ON x.Code = u.UomCode";
  assert.match(validateSapQuery(query), /AS \[Name\]/);
  const config = defaultSapMappings().find(config => config.module === 'uom');
  config.source.query = 'SELECT UomCode AS Code, UomName AS Name FROM OUOM';
  config.source.key = 'Code'; config.fields[0].source = 'Code'; config.fields[1].source = 'Name';
  assert.equal(parseSapConfig(config).source.query, config.source.query);
});
test('writes, batches, external functions/sources and variable assignments never execute', () => {
  for (const query of [
    'DELETE FROM OUOM', 'SELECT UomCode FROM OUOM; DELETE FROM OUOM', 'SELECT UomCode INTO Copy FROM OUOM',
    "EXEC sp_executesql N'SELECT 1'", "SELECT dbo.ExternalFunction(UomCode) AS X FROM OUOM",
    "SELECT * FROM OPENROWSET('SQLNCLI', 'server', 'SELECT 1')", 'SELECT UomCode FROM OtherDatabase.dbo.OUOM',
    'SELECT @x = UomCode FROM OUOM', 'SELECT NEXT VALUE FOR dbo.Sequence AS X',
  ]) assert.throws(() => validateSapQuery(query), undefined, query);
});
test('real result metadata drives columns including empty results, unique aliases and SQL errors', async () => {
  columns = [{ name: 'Code', system_type_name: 'nvarchar(20)', is_nullable: false }, { name: 'Name', system_type_name: 'nvarchar(100)', is_nullable: true }];
  rows = [];
  const result = await testSapQuery('SELECT UomCode AS Code, UomName AS Name FROM OUOM');
  assert.deepEqual(result.columns.map(c => c.name), ['Code', 'Name']);
  assert.equal(result.columns[0].nullable, false); assert.equal(result.sampleCount, 0);
  columns[1].name = 'code';
  await assert.rejects(describeSapQuery('SELECT 1 AS Code, 2 AS code'), /Duplicate/);
  columns[1].name = null;
  await assert.rejects(describeSapQuery('SELECT 1 AS Code, 2'), /AS aliases/);
  describeError = new sql.RequestError('Invalid object name MissingTable', 'EREQUEST');
  await assert.rejects(describeSapQuery('SELECT Code FROM MissingTable'), /Invalid object name/);
  describeError = undefined;
});
test('configured source reads execute selected SQL and preserve aliases/selected-code isolation', async () => {
  const config = defaultSapMappings().find(config => config.module === 'uom');
  config.source.query = 'SELECT UomCode AS Code, UomName AS Name FROM OUOM'; config.source.key = 'Code';
  columns = ['Code', 'Name'].map(name => ({ name, system_type_name: 'nvarchar(100)', is_nullable: false }));
  rows = [{ Code: 'EA', Name: 'EACH' }, { Code: 'BOX', Name: 'BOX' }];
  assert.deepEqual((await mappingSourceColumns(config)).map(c => c.name), ['Code', 'Name']);
  const selected = await readMappingRows(config, [' ea ']);
  assert.deepEqual(selected.rows, [rows[0]]);
  assert.deepEqual(selected.requestedCodes, ['EA']);
  assert.match(captured, /AS \[Code\]/);
  const legacy = structuredClone(config); delete legacy.source.query;
  assert.deepEqual((await mappingSourceColumns(legacy)).map(c => c.name), ['UomCode', 'UomName']);
});
test('default Item lookups use staging IDs, prefer existing class codes and reject ambiguous initials', async () => {
  const config = defaultSapMappings().find(config => config.module === 'item');
  const lookups = await sapLookups(config);
  const classes = lookups.get(JSON.stringify(config.fields.find(rule => rule.target === 'ItemClassCode').lookup));
  const uoms = lookups.get(JSON.stringify(config.fields.find(rule => rule.target === 'UOM_ID').lookup));
  assert.equal(classes.get('CLS'), '10'); assert.equal(classes.get('10'), '10');
  assert.equal(classes.has('DUP'), false); assert.equal(classes.get(''), null);
  assert.equal(uoms.get('EA'), 9); assert.equal(uoms.get(''), null);
});
test('sample streaming stops at five; oversized sync queries fail instead of truncating', async () => {
  rows = Array.from({ length: 12 }, (_, i) => ({ Code: i }));
  assert.equal((await executeSapQuery('SELECT UomCode AS Code FROM OUOM', true)).length, 5);
  assert.equal(cancelled, true);
  rows = Array.from({ length: 50001 }, (_, i) => ({ Code: i }));
  await assert.rejects(executeSapQuery('SELECT UomCode AS Code FROM OUOM'), /more than 50,000/);
  assert.equal(cancelled, true);
});
