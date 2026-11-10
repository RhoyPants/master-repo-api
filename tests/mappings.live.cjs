// Read-only integration check against the configured database, running API and Graph.
// No SharePoint writes, source-data writes, or user creation.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const db = new PrismaClient();
const api = `http://127.0.0.1:${process.env.PORT || 8081}`;
const redact = error => {
  let text = error.message;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(key)) text = text.split(value).join('[redacted]');
  }
  return text;
};
(async () => {
  try {
    const user = await db.user.findFirst({ where: { role: { not: 'admin' } }, select: { id: true } })
      || await db.user.findFirst({ select: { id: true } });
    assert.ok(user, 'An existing signed-in user is required');
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '2m' });
    async function get(path) {
      const response = await fetch(api + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
      const body = await response.json();
      assert.equal(response.status, 200, `${path}: ${body.message || response.status}`);
      return body;
    }
    const unauthenticated = await fetch(api + '/api/mappings/sharepoint');
    assert.equal(unauthenticated.status, 401);
    console.log('Unauthenticated mapping access: blocked');
    const mappings = await get('/api/mappings/sharepoint');
    assert.equal(mappings.defaults.length, 5);
    console.log(`Mapping API: ${mappings.defaults.length} templates, ${mappings.saved.length} saved mappings`);
    const tables = await get('/api/mappings/tables');
    assert.ok(tables.length);
    assert.ok(!tables.some(t => /user|audit|integrationmapping/i.test(t.name)));
    console.log(`Source discovery: ${tables.length} eligible tables`);
    for (const mapping of mappings.defaults) {
      const source = await get('/api/mappings/columns?table=' + encodeURIComponent(mapping.source.table));
      const target = await get('/api/mappings/sharepoint/columns?' + new URLSearchParams(mapping.destination));
      console.log(`${mapping.module}: ${source.length} SQL columns, ${target.length} SharePoint columns`);
      const response = await fetch(api + '/api/mappings/sharepoint/preview', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: mapping }), signal: AbortSignal.timeout(60000),
      });
      const preview = await response.json();
      if (!response.ok) { console.log(`${mapping.module} validation: ${preview.message}`); continue; }
      const errors = preview.rows.filter(r => r.error);
      console.log(`${mapping.module} preview: ${preview.sampleCount} samples, ${errors.length} row errors`);
      if (errors.length) console.log('First validation error:', errors[0].error);
    }
  } catch (error) { console.error(redact(error)); process.exitCode = 1; }
  finally { await db.$disconnect(); }
})();
