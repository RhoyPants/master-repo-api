require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultItemMasterMappings } = require('../src/modules/mappings/itemmaster/domain');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const queries = [];
let records = [{ code: 'A', name: 'Class A' }, { code: 'B', name: 'Class B' }];
inject('../src/lib/itemMaster', { getItemMasterPool: async () => ({ request: () => {
  const params = {};
  const request = { input: (key, value) => { params[key] = value; return request; }, query: async sql => {
    queries.push({ sql, params });
    if (sql.includes('INFORMATION_SCHEMA.TABLES')) return { recordset: [{ schema: 'source', name: 'item_classes' }, { schema: 'dbo', name: 'users' }] };
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return { recordset: [{ name: 'code', type: 'nvarchar', nullable: 'NO' }, { name: 'name', type: 'nvarchar', nullable: 'YES' }] };
    return { recordset: records };
  } };
  return request;
} }) });
inject('../src/modules/mappings/metadata', { sourceTables: async () => [{ id: 'catalog.Groups', schema: 'catalog', name: 'Groups' }] });
let destinationParams;
inject('../src/lib/prisma', { prisma: { $queryRaw: async (_sql, ...values) => {
  destinationParams = values;
  return [{ name: 'ExternalCode', type: 'nvarchar', nullable: false, identity: false, computed: false, hasDefault: false, length: 100 }];
} } });
const { itemMasterTables, itemMasterSourceColumns, itemMasterDestination, itemMasterColumns, readItemMasterRows } = require('../src/modules/mappings/itemmaster/metadata');

test('source tables/columns come from Item Master metadata; destination schema comes from staging', async () => {
  assert.deepEqual((await itemMasterTables()).map(table => table.id), ['source.item_classes']);
  const source = await itemMasterSourceColumns('source.item_classes');
  assert.deepEqual(source.map(column => column.name), ['code', 'name']);
  assert.equal(source[1].nullable, true);
  assert.deepEqual(queries.at(-1).params, { schema: 'source', table: 'item_classes' });
  assert.equal((await itemMasterColumns('catalog.Groups'))[0].name, 'ExternalCode');
  assert.deepEqual(destinationParams, ['catalog', 'Groups']);
  assert.equal((await itemMasterDestination('catalog.Groups')).sql.sql, '[catalog].[Groups]');
});
test('selected physical source is read directly using its configured source key', async () => {
  const config = defaultItemMasterMappings()[0];
  config.source = { table: 'source.item_classes', key: 'code', filters: [] };
  config.fields = [{ source: 'code', target: 'ExternalCode', transform: 'copy' }, { source: 'name', target: 'Label', transform: 'copy' }];
  const result = await readItemMasterRows(config, [' b ']);
  assert.deepEqual(result.rows, [{ code: 'B', name: 'Class B' }]);
  assert.match(queries.at(-1).sql, /FROM \[source\]\.\[item_classes\] ORDER BY \[code\]/);
  assert.doesNotMatch(queries.at(-1).sql, /UPPER|JOIN|initials IS NOT NULL/i);
  config.fields[1].source = 'missing';
  await assert.rejects(readItemMasterRows(config), /unavailable/);
  config.fields[1].source = 'name'; records = Array(50001).fill({ code: 'A', name: 'Class A' });
  await assert.rejects(readItemMasterRows(config), /50,000/);
});
test('nonexistent, excluded and SQL-shaped identifiers cannot select source or destination tables', async () => {
  for (const table of ['dbo.users', 'dbo.Missing', 'source.item_classes; DELETE FROM dbo.Items']) {
    await assert.rejects(itemMasterSourceColumns(table), /missing or unavailable/);
    await assert.rejects(itemMasterDestination(table), /missing or unavailable/);
  }
});
