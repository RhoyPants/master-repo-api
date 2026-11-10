require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let queries, itemClasses, uoms, rows;
inject('../src/lib/prisma', { prisma: {
  itemClass: { findMany: async () => itemClasses },
  uom: { findMany: async () => uoms },
} });
inject('../src/lib/sap', { getSapPool: async () => ({ request: () => {
  const parameters = {};
  return { input: (name, value) => { parameters[name] = value; }, query: async sql => {
    queries.push({ sql, parameters }); return { recordset: rows };
  } };
} }) });
const { readSapRows } = require('../src/modules/mappings/sap/metadata');
const { buildItemReferenceMaps, resolveItemReferences, normalizeSapFlag } = require('../src/modules/sync/sap-staging/item/service');
function reset() { queries = []; itemClasses = [{ itmsGrpCod: '10', initials: 'CLS' }]; uoms = [{ id: 9, uomCode: 'EA' }]; rows = []; }
const item = () => ({ ItemCode: 'A', ItemDescription: 'ITEM', validFor: 'Y', Category: 'I', itemClassCode: 'cls', itemClassName: 'CLASS', UOM: 'ea', UOM_ID: 100, LeadTime: null, iswhInventory: 'Y', isSalesInventory: 'N', isPurchaseInventory: null, ItemGroupName: null });
test('full and selected Item reads reuse the existing joins, active/date filters and parameterized codes', async () => {
  reset(); rows = [item()];
  const full = await readSapRows('item');
  const selected = await readSapRows('item', [' a ']);
  for (const query of queries) {
    assert.match(query.sql, /LEFT JOIN OITB/); assert.match(query.sql, /LEFT JOIN OUOM/);
    assert.match(query.sql, /validFor = 'Y'/); assert.match(query.sql, /CreateDate >= '2026-04-22/);
  }
  assert.equal(queries[1].parameters.code0, 'A');
  assert.equal(full.rows[0].ResolvedItemClassCode, '10');
  assert.equal(full.rows[0].ResolvedUomId, 9, 'Use staging UOM ID, not SAP UomEntry');
  assert.equal(full.rows[0].ResolvedLeadTime, 0);
  assert.equal(full.rows[0].NormalizedWHInventory, true);
  assert.equal(full.rows[0].NormalizedPurchaseInventory, false);
  assert.deepEqual(selected.requestedCodes, ['A']);
});
test('Item Class reads preserve non-null initials and code-or-initials selection', async () => {
  reset(); rows = [{ ItmsGrpCod: '10', Initials: 'CLS', ItmsGrpNam: 'CLASS' }];
  await readSapRows('item-class'); await readSapRows('item-class', ['cls']);
  assert.match(queries[0].sql, /U_Initials IS NOT NULL/);
  assert.match(queries[1].sql, /OR UPPER\(ISNULL\(U_Initials/);
  assert.equal(queries[1].parameters.initials0, 'CLS');
});
test('Item description/category nulls retain legacy empty-string defaults', async () => {
  reset(); rows = [{ ...item(), ItemDescription: null, Category: null }];
  const result = await readSapRows('item');
  assert.equal(result.rows[0].ItemDescription, '');
  assert.equal(result.rows[0].Category, '');
});
test('warehouse/UOM aliases and legacy flag normalization are preserved', async () => {
  reset(); rows = [{ WhCode: 'WH', WhName: 'WAREHOUSE', Address: null, Inactive: 'N' }];
  const warehouse = await readSapRows('warehouse');
  assert.equal(warehouse.rows[0].ResolvedIsActive, true);
  assert.match(queries[0].sql, /UPPER\(StreetNo\) AS Address/);
  rows = [{ UomCode: ' ea ', UomName: ' each ' }];
  assert.deepEqual((await readSapRows('uom')).rows[0], { UomCode: 'EA', UomName: 'EACH' });
  assert.equal(normalizeSapFlag('unexpected'), false);
});
test('missing and ambiguous staging references surface in preview source errors without writes', async () => {
  reset(); rows = [{ ...item(), UOM: 'missing' }];
  assert.match((await readSapRows('item')).rows[0].sourceError, /Missing UOM/);
  rows = [item()]; itemClasses.push({ itmsGrpCod: '11', initials: 'CLS' });
  assert.match((await readSapRows('item')).rows[0].sourceError, /Ambiguous ItemClass/);
  const maps = buildItemReferenceMaps([{ itmsGrpCod: '10', initials: 'CLS' }], [{ id: 9, uomCode: 'EA' }]);
  assert.equal(resolveItemReferences({ ...item(), itemClassCode: '10' }, maps).resolvedItemClassCode, '10');
  assert.throws(() => resolveItemReferences({ ...item(), itemClassCode: 'missing' }, maps), /Missing ItemClass/);
});
test('SAP legacy reference lookups apply only to Local, not matching Item Master table names', async () => {
  reset();
  const metadata = require('../src/modules/mappings/metadata');
  const original = metadata.loadLookups;
  const { sapLookups } = require('../src/modules/mappings/sap/metadata');
  const { defaultSapMappings } = require('../src/modules/mappings/sap/domain');
  const config = defaultSapMappings().find(config => config.module === 'item');
  const lookup = { table: 'dbo.ItemClasses', match: 'Initials', result: 'ItmsGrpCod' };
  config.fields = [
    { source: 'itemClassCode', target: 'Legacy', transform: 'lookup', lookup },
    { source: 'itemClassCode', target: 'Local', transform: 'lookup', lookup: { ...lookup, database: 'local' } },
    { source: 'itemClassCode', target: 'Master', transform: 'lookup', lookup: { ...lookup, database: 'itemmaster' } },
  ];
  let generic;
  metadata.loadLookups = async ({ fields }) => {
    generic = fields;
    return new Map([[JSON.stringify(fields[0].lookup), new Map([['CLS', 'MASTER']])]]);
  };
  try {
    const indexes = await sapLookups(config);
    assert.deepEqual(generic, [config.fields[2]]);
    assert.deepEqual(config.fields.map(field => indexes.get(JSON.stringify(field.lookup)).get('CLS')), ['10', '10', 'MASTER']);
  } finally { metadata.loadLookups = original; }
});
