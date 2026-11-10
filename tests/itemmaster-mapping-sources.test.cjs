require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultItemMasterMappings } = require('../src/modules/mappings/itemmaster/domain');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let sql;
inject('../src/lib/itemMaster', { getItemMasterPool: async () => ({ request: () => ({ query: async text => {
  sql = text;
  return { recordset: [
    { ItemGroupID: 'a', Initials: 'GRP', Name: 'GROUP', ItemClassCode: null, ItemClass: null, Category: 'I' },
    { ItemGroupID: 'B', Initials: 'GRP2', Name: 'SECOND', ItemClassCode: 'CLS', ItemClass: 'CLASS', Category: 'S' },
  ] };
} }) }) });
inject('../src/lib/prisma', { prisma: {} });
const { readItemMasterRows, itemMasterSourceColumns } = require('../src/modules/mappings/itemmaster/metadata');

test('fixed source reader retains Item Class join, eligibility and uppercase SQL; missing classes default to empty text', async () => {
  const config = defaultItemMasterMappings()[0];
  const { rows } = await readItemMasterRows(config);
  assert.match(sql, /LEFT JOIN item_classes/i);
  assert.match(sql, /IG\.initials IS NOT NULL/i);
  assert.match(sql, /UPPER\(IG\.name\)/i);
  assert.equal(rows[0].ItemClassCode, ''); assert.equal(rows[0].ItemClass, '');
  assert.equal(rows[1].ItemClassCode, 'CLS');
  assert.deepEqual(Object.keys(rows[0]), (await itemMasterSourceColumns()).map(column => column.name));
});
test('selected records use normalized ItemGroupID, never initials, and normalize requested codes once', async () => {
  const config = defaultItemMasterMappings()[0];
  const selected = await readItemMasterRows(config, [' a ', 'A', 'GRP2']);
  assert.deepEqual(selected.requestedCodes, ['A', 'GRP2']);
  assert.deepEqual(selected.rows.map(row => row.ItemGroupID), ['a']);
});
