require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { auditRequestContext, auditActorData } = require('../src/lib/audit-context');
const actor = () => JSON.parse(auditActorData().details.create[0].message);
const request = (id, name) => ({ user: { id, name, email: `${id}@example.test` }, path: '/sync/sap-staging/item/run' });
test('actor snapshots remain isolated across overlapping async requests and are absent outside requests', async () => {
  assert.deepEqual(auditActorData(), {});
  const run = (id, name, delay) => new Promise((resolve, reject) => auditRequestContext(request(id, name), {}, async () => {
    try { await new Promise(done => setTimeout(done, delay)); resolve(actor()); } catch (error) { reject(error); }
  }));
  const [alice, bob] = await Promise.all([run(1, 'Alice', 15), run(2, 'Bob', 1)]);
  assert.equal(alice.name, 'Alice'); assert.equal(alice.userId, 1);
  assert.equal(bob.name, 'Bob'); assert.equal(bob.userId, 2);
  assert.deepEqual(auditActorData(), {});
});
test('unusual user names cannot exceed the audit detail column or produce invalid JSON', () => {
  auditRequestContext(request(3, '\u0001'.repeat(255)), {}, () => {
    const message = auditActorData().details.create[0].message;
    assert.ok(message.length <= 1000); assert.equal(JSON.parse(message).userId, 3);
  });
});
