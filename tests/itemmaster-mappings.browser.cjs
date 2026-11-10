// All API/sync traffic is intercepted. No live source/staging access.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
require('ts-node').register({ transpileOnly: true });
const { defaultItemMasterMappings, itemMasterModules, parseItemMasterConfig } = require('../src/modules/mappings/itemmaster/domain');
const { buildStagingPayload } = require('../src/modules/mappings/staging-domain');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    const defaults = defaultItemMasterMappings(), versions = [], errors = [], runs = [];
    let saved, failSave = false;
    const columns = defaults[0].fields.map(rule => ({ name: rule.target, type: rule.target === 'IsActive' ? 'bit' : 'nvarchar', nullable: false, readOnly: false, supported: true, hasDefault: false }));
    columns.push({ name: 'UpdatedAt', type: 'datetime', nullable: true, readOnly: true, supported: false, hasDefault: false });
    const row = { ItemGroupID: 'G1', Initials: 'GRP', Name: 'GROUP', ItemClassCode: '', ItemClass: '', Category: 'I' };
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/'), async route => {
      const request = route.request(), url = new URL(request.url()), base = '/api/mappings/itemmaster-staging';
      let data = {}, status = 200;
      if (url.pathname === base) data = { saved: saved ? [saved] : [], defaults, modules: itemMasterModules };
      else if (url.pathname === '/api/mappings/tables') data = [];
      else if (url.pathname === base + '/tables') data = { source: [{ id: 'dbo.item_classes', schema: 'dbo', name: 'item_classes' }], destination: [{ id: 'dbo.ItemGroups', schema: 'dbo', name: 'ItemGroups' }, { id: 'archive.Groups', schema: 'archive', name: 'Groups' }] };
      else if (url.pathname === base + '/columns') data = {
        source: Object.keys(row).map(name => ({ name: url.searchParams.get('sourceTable') === 'dbo.item_classes' && name === 'ItemGroupID' ? 'code' : name, type: 'text', nullable: false })),
        destination: columns.map(column => url.searchParams.get('destinationTable') === 'archive.Groups' && column.name === 'ItemGroupID' ? { ...column, name: 'ExternalCode' } : column),
      };
      else if (url.pathname === base + '/preview') {
        const config = parseItemMasterConfig(request.postDataJSON().config);
        const previewColumns = columns.map(column => config.destination.table === 'archive.Groups' && column.name === 'ItemGroupID' ? { ...column, name: 'ExternalCode' } : column);
        const sourceRow = { ...row, code: 'G1' };
        data = { valid: true, sampleCount: 1, message: 'Preview does not write to staging.', rows: [{ key: row.ItemGroupID, source: row, create: buildStagingPayload(config, sourceRow, previewColumns, new Map(), 'create'), update: buildStagingPayload(config, sourceRow, previewColumns, new Map(), 'update') }] };
      } else if (request.method() === 'PUT' && url.pathname === base + '/item-group') {
        const body = request.postDataJSON();
        if (failSave) { status = 409; data = { message: 'This mapping changed in another session. Reload before saving.' }; }
        else {
          saved = { ...body, config: parseItemMasterConfig(body.config), version: body.version + 1, updatedBy: 'im-editor@example.test', updatedAt: new Date().toISOString() };
          versions.push(structuredClone(saved)); data = saved;
        }
      } else if (url.pathname === base + '/item-group/history') data = { versions: versions.slice().reverse().map(({ config, ...entry }) => entry), nextBeforeVersion: null };
      else if (/\/history\/\d+$/.test(url.pathname)) data = versions.find(entry => entry.version === Number(url.pathname.split('/').pop()));
      else if (url.pathname === base + '/item-group/run') {
        assert.deepEqual(request.postDataJSON(), { confirm: true });
        runs.push(url.pathname); data = { status: 'SUCCESS', inserted: 1, updated: 0, skipped: 0, failed: 0 };
      } else throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`);
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Item Master Mapping Check', role: 'viewer' }));
    });
    await page.goto((process.env.MAPPING_UI_URL || 'http://127.0.0.1:5173') + '/itemmaster-mapping');
    await page.getByRole('heading', { name: 'Item Master → Staging Mapping', exact: true }).waitFor();
    await page.getByText(/Loaded 6 Item Master source fields/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Test query', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'New mapping', exact: true }).count(), 1);
    assert.equal(await page.getByLabel('SAP SQL query', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('table', { name: 'Field mappings', exact: true }).locator(':scope > tbody > tr').count(), 7);
    await page.getByRole('button', { name: /^Source & destination/ }).click();
    assert.match(await page.getByLabel('Staging destination table', { exact: true }).innerText(), /dbo.ItemGroups/);
    assert.notEqual(await page.getByLabel('Source record key', { exact: true }).getAttribute('aria-disabled'), 'true');
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
    await dialog.getByText('Preview does not write to staging.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Mapping name', { exact: true }).fill('Item Groups draft');
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/Saved version 1/).waitFor();
    assert.equal(saved.enabled, false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Mapping name', { exact: true }).fill('Item Groups enabled');
    await page.getByLabel('Rule', { exact: true }).nth(2).click();
    await page.getByRole('option', { name: 'Trim text', exact: true }).click();
    await page.getByLabel('Use saved mapping for sync').check();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/Saving does not write records to staging/).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(saved.config.fields[2].transform, 'trim');
    assert.equal(runs.length, 0);
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Item Groups enabled', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('columnheader', { name: 'Item Master source field', exact: true }).count(), 1);
    assert.equal(await dialog.getByLabel('Saved SQL query', { exact: true }).count(), 0);
    await dialog.getByLabel('Saved version', { exact: true }).click();
    await page.getByRole('option', { name: /^v1 ·/ }).click();
    await dialog.getByRole('heading', { name: 'Item Groups draft', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'Item Groups enabled');
    await page.getByRole('button', { name: 'Run saved mapping', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(runs.length, 0);
    await page.getByRole('button', { name: 'Run saved mapping', exact: true }).click();
    await dialog.getByRole('button', { name: 'Run sync', exact: true }).click();
    await page.getByText('Sync SUCCESS: 1 created, 0 updated, 0 skipped, 0 failed.', { exact: true }).waitFor();
    assert.deepEqual(runs, ['/api/mappings/itemmaster-staging/item-group/run']);
    failSave = true;
    await page.getByLabel('Mapping name', { exact: true }).fill('Unsaved conflict');
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/This mapping changed in another session/).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'Unsaved conflict');
    failSave = false;
    await page.getByLabel('Item Master source table', { exact: true }).click();
    await page.getByRole('option', { name: 'dbo.item_classes', exact: true }).click();
    await page.getByText(/Loaded 6 Item Master source fields/).waitFor();
    await page.getByLabel('Staging destination table', { exact: true }).click();
    await page.getByRole('option', { name: 'archive.Groups', exact: true }).click();
    await page.getByText(/Loaded 6 Item Master source fields/).waitFor();
    await page.getByLabel('Source record key', { exact: true }).click();
    await page.getByRole('option', { name: 'code', exact: true }).click();
    await page.getByLabel('Staging matching key', { exact: true }).click();
    await page.getByRole('option', { name: /^ExternalCode/ }).click();
    await page.getByLabel('Source column', { exact: true }).nth(0).click();
    await page.getByRole('option', { name: /^code/ }).click();
    await page.getByLabel('Staging field', { exact: true }).nth(0).click();
    await page.getByRole('option', { name: /^ExternalCode/ }).click();
    await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
    await dialog.getByText('Preview does not write to staging.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/Saved version 3/).waitFor();
    assert.equal(saved.config.source.table, 'dbo.item_classes'); assert.equal(saved.config.source.key, 'code');
    assert.equal(saved.config.destination.table, 'archive.Groups'); assert.equal(saved.config.destination.key, 'ExternalCode');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Item Master table editor, preview, field rules, saved activation, read-only history, conflicts and mocked run routing passed; no live writes.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
