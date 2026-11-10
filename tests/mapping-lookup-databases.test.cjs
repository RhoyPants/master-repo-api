require('ts-node').register({ transpileOnly: true });
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
inject('../src/config/env', { env: { sharePoint: {} } });
let calls, rows, connectionError;
const tables = [
  { schema: 'dbo', name: 'ItemGroups' },
  { schema: 'dbo', name: 'Users' },
  { schema: 'dbo', name: 'AuditLogs' },
  { schema: 'dbo', name: '_prisma_migrations' },
  { schema: 'custom', name: 'Odd]Table' },
];
const columns = [
  { name: 'Code', type: 'nvarchar', nullable: 'NO' },
  { name: 'Name', type: 'nvarchar', nullable: 'YES' },
  { name: 'Odd]Column', type: 'nvarchar', nullable: 'YES' },
];
inject('../src/lib/prisma', { prisma: { $queryRaw: async query => {
  const text = query.sql ?? query.join('?');
  calls.push({ database: 'local', text });
  if (text.includes('INFORMATION_SCHEMA.TABLES')) return tables;
  if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return columns;
  return rows.local;
} } });
inject('../src/lib/itemMaster', { getItemMasterPool: async () => {
  if (connectionError) throw connectionError;
  return { request: () => {
    const params = {};
    return {
      input(name, value) { params[name] = value; return this; },
      async query(text) {
        calls.push({ database: 'itemmaster', text, params });
        if (text.includes('INFORMATION_SCHEMA.TABLES')) return { recordset: tables };
        if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return { recordset: columns };
        return { recordset: rows.itemmaster };
      },
    };
  } };
} });
const { parseConfig, transformValue } = require('../src/modules/mappings/domain');
const { lookupTables, lookupColumns, loadLookups } = require('../src/modules/mappings/metadata');
const { readItemMasterLookupRows } = require('../src/modules/mappings/itemmaster/source');
const spec = database => ({ ...(database === undefined ? {} : { database }), table: 'dbo.ItemGroups', match: 'Code', result: 'Name' });
const rule = database => ({ source: 'Group', target: 'GroupName', transform: 'lookup', lookup: spec(database) });
beforeEach(() => {
  calls = []; connectionError = undefined;
  rows = { local: [{ Code: 'GRP', Name: 'Local group' }], itemmaster: [{ Code: 'GRP', Name: 'Master group' }] };
});

test('lookup JSON accepts both connections and old mappings, rejecting arbitrary database values', () => {
  for (const database of [undefined, 'local', 'itemmaster']) {
    const config = {
      schemaVersion: 1, module: 'item', name: 'Items',
      source: { table: 'dbo.Items', key: 'Group', filters: [] },
      destination: { siteId: 'site', listId: 'list', key: 'GroupName' },
      fields: [rule(database)],
    };
    assert.deepEqual(parseConfig(JSON.parse(JSON.stringify(config))), config);
    for (const invalid of ['', null, false, 'other-db', {}, ['local']]) {
      assert.throws(() => parseConfig({ ...config, fields: [rule(invalid)] }), /Lookup database/);
    }
  }
});
test('table and column discovery uses only the chosen connection and filters unavailable tables', async () => {
  for (const database of [undefined, 'local', 'itemmaster']) {
    calls = [];
    assert.deepEqual((await lookupTables(database)).map(table => table.id), ['dbo.ItemGroups', 'custom.Odd]Table']);
    assert.deepEqual(await lookupColumns('dbo.ItemGroups', database), columns.map(column => ({ ...column, nullable: column.nullable === 'YES' })));
    assert.ok(calls.every(call => call.database === (database ?? 'local')));
  }
  const schemaCall = calls.find(call => call.text.includes('INFORMATION_SCHEMA.COLUMNS'));
  assert.deepEqual(schemaCall.params, { schema: 'dbo', table: 'ItemGroups' });
  assert.match(schemaCall.text, /TABLE_SCHEMA = @schema AND TABLE_NAME = @table/);
});
test('unknown database selectors are rejected before accessing either database', () => {
  for (const invalid of [null, '', 'sqlserver', ['local'], {}]) {
    assert.throws(() => lookupTables(invalid), /Lookup database/);
    assert.throws(() => lookupColumns('dbo.ItemGroups', invalid), /Lookup database/);
  }
  assert.equal(calls.length, 0);
});
test('identical table names in different databases produce independent lookup results', async () => {
  const rules = [rule(), rule('local'), rule('itemmaster')];
  const lookups = await loadLookups({ fields: [...rules, rule('itemmaster')] });
  assert.deepEqual(rules.map(field => transformValue(field, { Group: ' grp ' }, lookups)), ['Local group', 'Local group', 'Master group']);
  assert.equal(calls.filter(call => call.database === 'itemmaster' && !call.text.includes('INFORMATION_SCHEMA')).length, 1);
});
test('Item Master lookup enforces missing/ambiguous values and never falls back to local', async () => {
  const field = rule('itemmaster');
  let lookups = await loadLookups({ fields: [field] });
  assert.throws(() => transformValue(field, { Group: 'missing' }, lookups), /Lookup not found/);
  assert.equal(transformValue({ ...field, onMissing: 'null' }, { Group: 'missing' }, lookups), null);
  rows.itemmaster.push({ Code: ' grp ', Name: 'Other' });
  await assert.rejects(loadLookups({ fields: [field] }), /Ambiguous/);
  connectionError = new Error('Item Master unavailable');
  await assert.rejects(loadLookups({ fields: [field] }), /Item Master unavailable/);
  assert.ok(calls.every(call => call.database === 'itemmaster'));
});
test('Item Master lookup checks table/column metadata and quotes validated identifiers', async () => {
  await assert.rejects(readItemMasterLookupRows('dbo.Users', ['Code']), /missing or unavailable/);
  await assert.rejects(readItemMasterLookupRows('dbo.ItemGroups; DROP TABLE Items', ['Code']), /missing or unavailable/);
  await assert.rejects(readItemMasterLookupRows('dbo.ItemGroups', ['Code; DROP TABLE Items']), /column no longer exists/);
  assert.equal(calls.filter(call => !call.text.includes('INFORMATION_SCHEMA')).length, 0);
  await readItemMasterLookupRows('custom.Odd]Table', ['Code', 'Odd]Column', 'Code']);
  assert.equal(calls.at(-1).text, 'SELECT [Code], [Odd]]Column] FROM [custom].[Odd]]Table]');
});
test('real lookup loading feeds preview and create/update sync payloads, with preflight failures before writes', async () => {
  const config = {
    schemaVersion: 1, module: 'item', name: 'Item Master lookup',
    source: { table: 'dbo.ItemGroups', key: 'Code', filters: [] },
    destination: { siteId: 'site', listId: 'list', key: 'Code' },
    fields: [
      { source: 'Code', target: 'Code', transform: 'copy' },
      { ...rule('itemmaster'), source: 'Code', target: 'Name' },
    ],
  };
  const writes = [], audits = [];
  let existing = [{ id: 'existing', fields: { Code: 'GRP', Name: 'Old name' } }];
  const metadata = require('../src/modules/mappings/metadata');
  inject('../src/modules/mappings/metadata', {
    ...metadata,
    destinationColumns: async () => ['Code', 'Name'].map(name => ({ name, displayName: name, type: 'text', supported: true, readOnly: false })),
    collection: async () => existing,
    graph: async (path, init) => { writes.push({ path, ...init, body: JSON.parse(init.body) }); },
  });
  inject('../src/modules/mappings/store', { savedMapping: async () => ({ config, module: 'item', enabled: true, version: 3 }) });
  const { prisma } = require('../src/lib/prisma');
  Object.assign(prisma, {
    transactionType: { upsert: async () => ({ id: 1 }) },
    auditLog: { create: async () => { audits.push('created'); return { id: 1 }; }, update: async () => {} },
    auditLogDetail: { create: async () => {} },
    auditTransactionItem: { create: async () => {} },
  });
  const { executeMapping, previewMapping } = require('../src/modules/mappings/service');
  const preview = await previewMapping(config);
  assert.equal(preview.rows[0].create.Name, 'Master group');
  assert.equal(preview.rows[0].update.Name, 'Master group');
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
  assert.equal((await executeMapping('item')).updated, 1);
  assert.deepEqual(writes[0].body, { Code: 'GRP', Name: 'Master group' });
  assert.equal(writes[0].method, 'PATCH');
  existing = [];
  assert.equal((await executeMapping('item')).inserted, 1);
  assert.deepEqual(writes[1].body, { fields: { Code: 'GRP', Name: 'Master group' } });
  assert.equal(writes[1].method, 'POST');
  rows.itemmaster = [];
  await assert.rejects(executeMapping('item'), /Lookup not found/);
  connectionError = new Error('Item Master unavailable');
  await assert.rejects(executeMapping('item'), /Item Master unavailable/);
  assert.equal(writes.length, 2);
  assert.equal(audits.length, 2);
});
test('lookup discovery HTTP endpoints validate selectors and preserve Local defaults', async () => {
  const express = require('express');
  inject('../src/modules/mappings/sap/routes', { sapMappingsRouter: express.Router() });
  inject('../src/modules/mappings/itemmaster/routes', { itemMasterMappingsRouter: express.Router() });
  const { mappingsRouter } = require('../src/modules/mappings/routes');
  const app = express();
  app.use('/api/mappings', mappingsRouter);
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/mappings/lookup`;
  try {
    for (const database of ['', '?database=local', '?database=itemmaster']) {
      const response = await fetch(url + '/tables' + database);
      assert.equal(response.status, 200);
      assert.equal((await response.json())[0].id, 'dbo.ItemGroups');
    }
    const response = await fetch(url + '/columns?database=itemmaster&table=dbo.ItemGroups');
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].name, 'Code');
    for (const suffix of ['/tables?database=other', '/tables?database=', '/tables?database=local&database=itemmaster', '/columns?database=itemmaster', '/columns?database=itemmaster&table=dbo.Users']) {
      const response = await fetch(url + suffix);
      assert.equal(response.status, 400, suffix);
      assert.ok((await response.json()).message);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
