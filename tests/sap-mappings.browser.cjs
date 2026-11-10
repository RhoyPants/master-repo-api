// Mocked API-only browser check; never writes SAP or staging records.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
require('ts-node').register({ transpileOnly: true });
const { defaultSapMappings, sapModules, parseSapConfig, buildSapPayload } = require('../src/modules/mappings/sap/domain');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    const defaults = defaultSapMappings(), saved = new Map(), versions = new Map(), errors = [], runs = [];
    let failSave = false;
    const columns = module => {
      const config = defaults.find(config => config.module === module);
      return [
        ...config.fields.map(rule => ({
          name: rule.target, type: /Inventory|IsActive/.test(rule.target) ? 'bit' : ['LeadTime', 'UOM_ID'].includes(rule.target) ? 'int' : 'nvarchar',
          nullable: ['Address', 'ItemClassCode', 'ItemClassName', 'UOM', 'UOM_ID', 'ItemGroupName'].includes(rule.target),
          readOnly: false, supported: true, hasDefault: false,
        })),
        { name: 'UpdatedAt', type: 'datetime', nullable: true, readOnly: true, supported: false, hasDefault: false },
      ];
    };
    const rows = {
      warehouse: { WhCode: 'WH1', WhName: 'WAREHOUSE', Address: null, ResolvedIsActive: true },
      'item-class': { ItmsGrpCod: '10', Initials: 'CLS', ItmsGrpNam: 'CLASS' },
      uom: { UomCode: 'EA', UomName: 'EACH' },
      item: { ItemCode: 'ITEM1', ItemDescription: 'ITEM', Category: 'I', validFor: 'Y', itemClassCode: 'CLS', itemClassName: 'CLASS', UOM: 'EA', ResolvedLeadTime: 0, NormalizedWHInventory: true, NormalizedSalesInventory: false, NormalizedPurchaseInventory: true, ItemGroupName: null },
    };
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/'), async route => {
      const request = route.request(), url = new URL(request.url()), base = '/api/mappings/sap-staging';
      if (/\/run(?:\/|$)/.test(url.pathname)) runs.push(url.pathname);
      let data = {}, status = 200;
      if (url.pathname === base) data = { saved: [...saved.values()], defaults, modules: sapModules };
      else if (url.pathname === '/api/mappings/tables') data = ['ItemClasses', 'Uoms'].map(name => ({ id: `dbo.${name}`, name, schema: 'dbo' }));
      else if (url.pathname === base + '/columns') {
        const body = request.method() === 'POST' ? request.postDataJSON() : {};
        const module = body.module || url.searchParams.get('module'), config = defaults.find(config => config.module === module);
        data = { source: (body.query?.includes('AS Code') ? ['Code', 'Name'] : [...new Set(config.fields.filter(rule => rule.source).map(rule => rule.source))]).map(name => ({ name, type: 'SAP field', nullable: true })), destination: columns(module) };
      } else if (url.pathname === base + '/test-query') {
        const query = request.postDataJSON().query;
        if (query.includes('MissingTable')) { status = 400; data = { message: 'SAP query check failed: Invalid object name MissingTable.' }; }
        else data = { columns: ['Code', 'Name'].map(name => ({ name, type: 'nvarchar(100)', nullable: false })), rows: [{ Code: 'EA', Name: 'EACH' }], sampleCount: 1, message: 'Query checked against SAP. No staging writes or configuration saves.' };
      } else if (url.pathname === base + '/preview') {
        const config = parseSapConfig(request.postDataJSON().config), row = { ...rows[config.module], Code: 'EA', Name: 'EACH' };
        const lookups = new Map([
          [JSON.stringify({ table: 'dbo.ItemClasses', match: 'Initials', result: 'ItmsGrpCod' }), new Map([['CLS', '10']])],
          [JSON.stringify({ table: 'dbo.Uoms', match: 'UomCode', result: 'Id' }), new Map([['EA', 9]])],
        ]);
        data = { sampleCount: 1, message: 'Preview does not write to staging.', rows: [{ key: row[config.source.key], source: row, create: buildSapPayload(config, row, columns(config.module), lookups, 'create'), update: buildSapPayload(config, row, columns(config.module), lookups, 'update') }] };
      } else if (request.method() === 'PUT' && url.pathname.startsWith(base)) {
        const body = request.postDataJSON(), config = parseSapConfig(body.config);
        if (failSave) { status = 409; data = { message: 'SAP mapping changed in another session.' }; }
        else {
          data = { ...body, config, version: body.version + 1, updatedBy: 'sap-editor@example.test', updatedAt: new Date().toISOString() };
          saved.set(config.module, data);
          versions.set(config.module, [...(versions.get(config.module) || []), structuredClone(data)]);
        }
      } else if (/\/history\/\d+$/.test(url.pathname)) {
        const parts = url.pathname.split('/'), version = Number(parts.pop()); parts.pop();
        data = versions.get(parts.pop()).find(row => row.version === version);
      } else if (url.pathname.endsWith('/history')) {
        const module = url.pathname.split('/').at(-2);
        data = { versions: (versions.get(module) || []).slice().reverse().map(({ config, ...row }) => row), nextBeforeVersion: null };
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'SAP Mapping Check', role: 'viewer' }));
    });
    await page.goto('http://127.0.0.1:5173/sap-mapping');
    await page.getByRole('heading', { name: 'SAP → Staging Mapping', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New mapping', exact: true }).count(), 1);
    const dialog = page.getByRole('dialog');
    for (const module of ['item', 'warehouse', 'item-class', 'uom']) {
      await page.getByLabel('Mapping', { exact: true }).click();
      assert.equal(await page.getByRole('option').count(), 4);
      await page.getByRole('option', { name: module, exact: true }).click();
      await page.getByText(/Loaded \d+ SAP source fields and \d+ staging columns/).waitFor();
      const table = page.getByRole('table', { name: 'Field mappings', exact: true });
      assert.equal(await table.locator(':scope > tbody > tr').count(), defaults.find(config => config.module === module).fields.length);
      await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
      await dialog.getByText('Preview does not write to staging.', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('columnheader', { name: 'On create', exact: true }).count(), 1);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.getByRole('button', { name: /^Source & destination/ }).click();
    assert.equal(await page.getByLabel('Staging destination table', { exact: true }).inputValue(), 'dbo.Uoms');
    const queryInput = page.getByLabel('SAP SQL query', { exact: true });
    await queryInput.fill('SELECT UomCode AS Code, UomName AS Name FROM MissingTable');
    assert.equal(await page.getByRole('button', { name: 'Save mapping', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Test query', exact: true }).click();
    await dialog.getByText(/Invalid object name MissingTable/).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const queryV1 = 'SELECT UomCode AS Code, UomName AS Name FROM OUOM';
    await queryInput.fill(queryV1);
    await page.getByRole('button', { name: 'Test query', exact: true }).click();
    await dialog.getByRole('table', { name: 'Query output columns' }).waitFor();
    assert.equal(await dialog.getByRole('table', { name: 'Query source sample' }).getByText('EACH').count(), 1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Source record key', { exact: true }).click();
    await page.getByRole('option', { name: /^Code$/ }).click();
    const sourceInputs = page.getByLabel('Source column', { exact: true });
    for (const [i, name] of ['Code', 'Name'].entries()) {
      await sourceInputs.nth(i).click();
      await page.getByRole('option', { name: new RegExp('^' + name + ' ·') }).click();
    }
    await page.getByRole('button', { name: 'Refresh query & staging columns', exact: true }).click();
    await page.getByText(/Loaded \d+ SAP source fields and \d+ staging columns/).waitFor();
    await page.getByLabel('Mapping name', { exact: true }).fill('UOM draft version');
    await page.locator('main').evaluate(main => { main.scrollTop = main.scrollHeight; });
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/Saved version 1/).waitFor();
    assert.equal(saved.get('uom').enabled, false);
    assert.equal(saved.get('uom').config.source.query, queryV1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Mapping name', { exact: true }).fill('UOM enabled version');
    const queryV2 = queryV1 + " WHERE UomCode = 'EA'";
    await queryInput.fill(queryV2);
    await page.getByRole('button', { name: 'Test query', exact: true }).click();
    await dialog.getByRole('table', { name: 'Query output columns' }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Use saved mapping for sync').check();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText(/Saving does not write records to staging/).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Run saved mapping', exact: true }).click();
    await dialog.getByText(/This writes matching source records to the staging table/).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await dialog.getByRole('heading', { name: 'UOM enabled version', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Saved SQL query', { exact: true }).inputValue(), queryV2);
    assert.equal(await dialog.getByLabel('Saved SQL query', { exact: true }).getAttribute('readonly'), '');
    assert.equal(await dialog.locator('pre').count(), 0);
    assert.equal(await dialog.getByRole('columnheader', { name: 'Staging field', exact: true }).count(), 1);
    await dialog.getByLabel('Saved version', { exact: true }).click();
    await page.getByRole('option', { name: /^v1 ·/ }).click();
    await dialog.getByRole('heading', { name: 'UOM draft version', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Saved SQL query', { exact: true }).inputValue(), queryV1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'UOM enabled version');
    assert.equal(await queryInput.inputValue(), queryV2);
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await dialog.locator('pre').textContent()), saved.get('uom').config);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    failSave = true;
    await page.getByLabel('Mapping name', { exact: true }).fill('Unsaved SAP conflict');
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByText('SAP mapping changed in another session.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'Unsaved SAP conflict');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(runs.length, 0, 'This browser check must never run a sync');
    console.log('SAP editor: query errors, alias-driven dropdowns, read-only test/preview, versioned SQL + fields, read-only v1/v2 history, conflicts and fixed destinations passed; no SAP/staging writes');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
