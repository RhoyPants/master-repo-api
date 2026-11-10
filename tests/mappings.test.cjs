require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig, validateSchema, transformValue, buildPayload, buildLookup } = require('../src/modules/mappings/domain');
const field = (source, target, transform = 'copy', extra = {}) => ({ source, target, transform, ...extra });
const config = () => ({
  schemaVersion: 1, module: 'item', name: 'Items', source: { table: 'dbo.Items', key: 'ItemCode', filters: [] },
  destination: { siteId: 'site', listId: 'list', key: 'Code' }, fields: [field('ItemCode', 'Code', 'uppercase')],
});
const source = [{ name: 'ItemCode', type: 'nvarchar', nullable: false }, { name: 'Active', type: 'bit', nullable: false }];
const destination = [{ name: 'Code', displayName: 'Renamed item code', type: 'text', required: true, readOnly: false, supported: true }];

test('uses stable internal names after a SharePoint display-name change', () => {
  const mapping = parseConfig(config());
  validateSchema(mapping, source, destination);
  assert.deepEqual(buildPayload(mapping, { ItemCode: ' itm-001 ' }, destination, new Map(), 'create'), { Code: 'ITM-001' });
});
test('blocks removed source and destination fields and read-only columns', () => {
  assert.throws(() => validateSchema(config(), [], destination), /no longer exists/);
  assert.throws(() => validateSchema(config(), source, []), /no longer exists/);
  assert.throws(() => validateSchema(config(), source, [{ ...destination[0], readOnly: true }]), /read-only/);
});
test('blocks duplicate targets but permits separate create and update values', () => {
  const mapping = config();
  mapping.fields.push(field('Active', 'Code'));
  assert.throws(() => parseConfig(mapping), /more than once/);
  mapping.fields = [field('ItemCode', 'Code'), field('', 'Flag', 'constant', { value: 0, write: 'create' }), field('', 'Flag', 'constant', { value: 1, write: 'update' })];
  parseConfig(mapping);
  const cols = [...destination, { name: 'Flag', displayName: 'Flag', type: 'number', required: false }];
  assert.equal(buildPayload(mapping, { ItemCode: 'A' }, cols, new Map(), 'create').Flag, 0);
  assert.equal(buildPayload(mapping, { ItemCode: 'A' }, cols, new Map(), 'update').Flag, 1);
});
test('matching fields must be deterministic and present on create and update', () => {
  for (const rule of [field('', 'Code', 'uuid'), field('ItemCode', 'Code', 'copy', { write: 'create' })]) {
    const mapping = config(); mapping.fields = [rule];
    assert.throws(() => parseConfig(mapping), /matching key/);
  }
  assert.throws(() => buildPayload(config(), { ItemCode: '' }, destination, new Map(), 'create'), /matching key/);
});
test('lookup is case-insensitive, rejects ambiguous names and handles missing values explicitly', () => {
  const spec = { table: 'dbo.ItemGroups', match: 'Name', result: 'Initials' };
  const index = buildLookup([{ Name: ' Tools ', Initials: 'TLS' }], 'Name', 'Initials');
  const lookups = new Map([[JSON.stringify(spec), index]]);
  const rule = field('Group', 'GroupCode', 'lookup', { lookup: spec });
  assert.equal(transformValue(rule, { Group: 'tools' }, lookups), 'TLS');
  assert.throws(() => transformValue(rule, { Group: 'missing' }, lookups), /Lookup not found/);
  assert.equal(transformValue({ ...rule, onMissing: 'null' }, { Group: 'missing' }, lookups), null);
  assert.throws(() => buildLookup([{ Name: 'Tools', Initials: 'A' }, { Name: 'TOOLS', Initials: 'B' }], 'Name', 'Initials'), /Ambiguous/);
});
test('value rules distinguish false from missing and do not silently convert invalid booleans or numbers', () => {
  const mapping = config();
  mapping.fields.push(field('Active', 'Status', 'valueMap', { values: { Y: 'ACTIVE', ' y ': 'INACTIVE' } }));
  assert.throws(() => parseConfig(mapping), /duplicate case-insensitive keys/);
  assert.equal(transformValue(field('Active', 'Status', 'valueMap', { values: { true: 'ACTIVE', false: 'INACTIVE' } }), { Active: false }, new Map()), 'INACTIVE');
  assert.equal(transformValue(field('Active', 'Flag', 'number'), { Active: false }, new Map()), 0);
  assert.equal(transformValue(field('Active', 'Flag', 'boolean'), { Active: 'N' }, new Map()), false);
  assert.throws(() => transformValue(field('Active', 'Flag', 'boolean'), { Active: 'maybe' }, new Map()), /boolean/);
  assert.throws(() => transformValue(field('Active', 'Flag', 'number'), { Active: ' ' }, new Map()), /Empty number/);
});
test('enforces SharePoint required fields, types, choices and maximum lengths', () => {
  assert.throws(() => validateSchema(config(), source, [...destination, { name: 'Title', displayName: 'Title', required: true, readOnly: false }]), /must be mapped/);
  assert.throws(() => buildPayload(config(), { ItemCode: null }, destination, new Map(), 'create'), /required/);
  assert.throws(() => buildPayload(config(), { ItemCode: 'ABC' }, [{ ...destination[0], maxLength: 2 }], new Map(), 'create'), /exceeds/);
  assert.throws(() => buildPayload(config(), { ItemCode: 'ABC' }, [{ ...destination[0], type: 'choice', choices: ['XYZ'] }], new Map(), 'create'), /allowed choice/);
  const c = config(); c.fields = [field('ItemCode', 'Code')];
  assert.throws(() => buildPayload(c, { ItemCode: '2' }, [{ ...destination[0], type: 'number' }], new Map(), 'create'), /requires a number/);
});
test('all existing module templates are valid JSON configurations', () => {
  // Environment validation must not require live credentials for pure template tests.
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'SAP_DB_SERVER', 'SAP_DB_USER', 'SAP_DB_PASSWORD', 'SAP_DB_NAME']) process.env[key] ||= 'test';
  const { defaultMappings } = require('../src/modules/mappings/defaults');
  for (const mapping of defaultMappings()) assert.equal(parseConfig(JSON.parse(JSON.stringify(mapping))).module, mapping.module);
});
