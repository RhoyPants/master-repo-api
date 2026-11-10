// All API requests are intercepted. No live database access or live syncs.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
require('ts-node').register({ transpileOnly: true });
const { defaultSapMappings, sapModules, parseSapConfig } = require('../src/modules/mappings/sap/domain');
const { defaultItemMasterMappings, itemMasterModules, parseItemMasterConfig } = require('../src/modules/mappings/itemmaster/domain');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    for (const provider of ['sap-staging', 'itemmaster-staging']) {
      const sap = provider === 'sap-staging';
      const defaults = sap ? defaultSapMappings() : defaultItemMasterMappings();
      const parse = sap ? parseSapConfig : parseItemMasterConfig;
      const saved = new Map(), history = new Map(), runs = [], errors = [];
      const base = '/api/mappings/' + provider;
      const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/'), async route => {
        const request = route.request(), url = new URL(request.url());
        let data = {}, status = 200;
        if (url.pathname === base) data = { saved: [...saved.values()], defaults, modules: sap ? sapModules : itemMasterModules };
        else if (url.pathname === '/api/mappings/tables') data = [];
        else if (url.pathname === base + '/tables') data = { source: [{ schema: 'dbo', name: 'item_groups', id: 'dbo.item_groups' }], destination: [{ schema: 'dbo', name: 'ItemGroups', id: 'dbo.ItemGroups' }] };
        else if (url.pathname === base + '/columns') {
          const body = request.method() === 'POST' ? request.postDataJSON() : {};
          const module = body.module || url.searchParams.get('module');
          const template = defaults.find(config => config.module === module);
          assert.ok(template, 'metadata request must use the template module, not the mapping ID');
          data = {
            source: [...new Set(template.fields.filter(field => field.source).map(field => field.source))].map(name => ({ name, type: 'text', nullable: true })),
            destination: template.fields.map(field => ({ name: field.target, type: field.target === 'IsActive' ? 'bit' : 'nvarchar', nullable: false, hasDefault: false, supported: true, readOnly: false })),
          };
        } else if (url.pathname === base + '/preview') { parse(request.postDataJSON().config); data = { rows: [], sampleCount: 0, message: 'Schema checked. No matching rows.' }; }
        else if (url.pathname === base + '/test-query') data = { columns: ['UomCode', 'UomName'].map(name => ({ name, type: 'nvarchar', nullable: false })), rows: [], sampleCount: 0, message: 'Read-only query checked.' };
        else if (request.method() === 'PUT' && url.pathname.startsWith(base + '/')) {
          const body = request.postDataJSON(), config = parse(body.config), current = saved.get(config.module);
          if ((current?.version || 0) !== body.version) { status = 409; data = { message: 'Version conflict' }; }
          else {
            data = { ...body, config, version: body.version + 1, updatedBy: 'editor@example.test', updatedAt: new Date().toISOString() };
            saved.set(config.module, structuredClone(data)); history.set(config.module, [...(history.get(config.module) || []), structuredClone(data)]);
          }
        } else if (/\/history\/\d+$/.test(url.pathname)) {
          const parts = url.pathname.split('/'), version = Number(parts.pop()); parts.pop();
          data = history.get(parts.pop()).find(entry => entry.version === version);
        } else if (url.pathname.endsWith('/history')) {
          const id = url.pathname.split('/').at(-2);
          data = { versions: (history.get(id) || []).slice().reverse().map(({ config, ...entry }) => entry), nextBeforeVersion: null };
        } else if (url.pathname.endsWith('/run')) {
          assert.deepEqual(request.postDataJSON(), { confirm: true }); runs.push(url.pathname);
          data = { status: 'SUCCESS', inserted: 0, updated: 0, skipped: 0, failed: 0 };
        } else throw new Error('Unexpected API request: ' + request.method() + ' ' + url.pathname);
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.addInitScript(() => {
        localStorage.setItem('token', 'fixture');
        localStorage.setItem('user', JSON.stringify({ id: 1, name: 'New Mapping Check' }));
      });
      const ui = process.env.MAPPING_UI_URL || 'http://127.0.0.1:5173';
      await page.goto(ui + (sap ? '/sap-mapping' : '/itemmaster-mapping'));
      await page.getByRole('button', { name: 'New mapping', exact: true }).waitFor();
      const dialog = page.getByRole('dialog');
      for (const id of ['branch-a', 'branch-b']) {
        await page.getByRole('button', { name: 'New mapping', exact: true }).click();
        await dialog.getByLabel('New mapping ID', { exact: true }).fill(id);
        await dialog.getByLabel('New mapping name', { exact: true }).fill('Mapping ' + id);
        if (sap) {
          await dialog.getByLabel('Template module', { exact: true }).click();
          await page.getByRole('option', { name: 'uom', exact: true }).click();
        }
        await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
        await page.getByText(/Loaded \d+ (SAP|Item Master) source fields/).waitFor();
        assert.equal(saved.has(id), false, 'creating a draft must not save it');
        assert.equal(await page.getByLabel('Use saved mapping for sync').isChecked(), false);
        assert.equal(await page.getByRole('button', { name: 'Run saved mapping', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
        await dialog.getByText('Schema checked. No matching rows.', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByLabel('Use saved mapping for sync').check();
        await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
        await dialog.getByText(/Saved version 1/).waitFor();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        assert.equal(saved.get(id).config.syncModule, sap ? 'uom' : 'item-group');
      }
      assert.equal(saved.size, 2); assert.equal(runs.length, 0);
      await page.getByRole('button', { name: 'New mapping', exact: true }).click();
      await dialog.getByLabel('New mapping ID', { exact: true }).fill('branch-a');
      await dialog.getByLabel('New mapping name', { exact: true }).fill('Duplicate');
      assert.equal(await dialog.getByRole('button', { name: 'Create draft', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.reload();
      await page.getByLabel('Mapping', { exact: true }).click();
      await page.getByRole('option', { name: 'branch-a', exact: true }).click();
      await page.getByText(/Loaded \d+ (SAP|Item Master) source fields/).waitFor();
      await page.getByLabel('Mapping name', { exact: true }).fill('Branch A v2');
      await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
      await dialog.getByText(/Saved version 2/).waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(saved.get('branch-b').version, 1); assert.equal(saved.get('branch-b').config.name, 'Mapping branch-b');
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Branch A v2', exact: true }).waitFor();
      await dialog.getByLabel('Saved version', { exact: true }).click();
      await page.getByRole('option', { name: /^v1 ·/ }).click();
      await dialog.getByRole('heading', { name: 'Mapping branch-a', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Run saved mapping', exact: true }).click();
      await dialog.getByRole('button', { name: 'Run sync', exact: true }).click();
      await page.getByText('Sync SUCCESS: 0 created, 0 updated, 0 skipped, 0 failed.', { exact: true }).waitFor();
      assert.deepEqual(runs, [base + '/branch-a/run']);
      assert.equal(errors.length, 0, errors.join('\n'));
      await page.close();
      console.log(provider + ': two independent mappings, duplicate ID guard, reload, versions, history and exact mocked run passed.');
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
