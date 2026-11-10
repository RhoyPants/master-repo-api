require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inject = (relative, exports) => { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; };
inject('../src/config/env', { env: { sharePoint: {
  tenantId: 'tenant', clientId: 'client', clientSecret: 'fixture',
  warehouseSiteId: 'site', warehouseListId: 'warehouse', itemClassSiteId: 'site', itemClassListId: 'classes',
  uomSiteId: 'site', uomListId: 'uom', imSiteId: 'site', imListId: 'items',
} } });
process.env.SP_IG_SITE_ID = 'site'; process.env.SP_IG_LIST_ID = 'groups';
inject('../src/lib/prisma', { prisma: {} });
inject('../src/lib/sap', { getSapPool: async () => { throw new Error('No live SAP access'); } });
inject('../src/lib/itemMaster', { getItemMasterPool: async () => { throw new Error('No live Item Master access'); } });
const { invalidateDataReads } = require('../src/lib/data-read-cache');
const { getSharePointReadToken } = require('../src/lib/sharepoint-token');
const services = [
  require('../src/modules/data/warehouse/service').getWarehousesFromSharePoint,
  require('../src/modules/data/item-class/service').getItemClassFromSharePoint,
  require('../src/modules/data/item-group/service').getItemGroupFromSharePoint,
  require('../src/modules/data/uom/service').getUomFromSharePoint,
  require('../src/modules/data/item/service').getItemsFromSharePoint,
];
test('all five SharePoint tables share one token and reuse collections across page/search requests', async () => {
  invalidateDataReads(); let tokens = 0, graph = 0;
  const originalFetch = global.fetch, originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  global.fetch = async url => {
    if (String(url).includes('login.microsoftonline.com')) { tokens++; return { ok: true, json: async () => ({ access_token: 'fixture', expires_in: 3600 }) }; }
    graph++;
    const value = ['A', 'B'].map(code => ({ fields: { Code: code, Description: code, ItemCode: code, ItemDescription: code, ItemClass_ID: code, ItemGroupID: code, ShortDescription: code, Category: 'I' } }));
    return { ok: true, json: async () => ({ value }), text: async () => JSON.stringify({ value }) };
  };
  try {
    const first = await Promise.all(services.map(read => read({ page: 1, limit: 1 })));
    assert.ok(first.every(result => result.data.length === 1));
    assert.equal(tokens, 1); assert.equal(graph, 5);
    await Promise.all(services.map(read => read({ page: 2, limit: 1, search: 'B' })));
    assert.equal(tokens, 1); assert.equal(graph, 5);
    invalidateDataReads(); await Promise.all(services.map(read => read({ page: 1, limit: 1 })));
    assert.equal(tokens, 1); assert.equal(graph, 10);
    now += 16000; await Promise.all(services.map(read => read({ page: 1, limit: 1 })));
    assert.equal(tokens, 1); assert.equal(graph, 15);
    now += 3600000; await getSharePointReadToken(); assert.equal(tokens, 2);
  } finally { global.fetch = originalFetch; Date.now = originalNow; invalidateDataReads(); }
});
