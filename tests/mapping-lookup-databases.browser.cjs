// Mocked browser check; no database or SharePoint writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    const config = {
      schemaVersion: 1, module: 'item', name: 'Lookup database check',
      source: { table: 'dbo.Items', key: 'ItemCode', filters: [] },
      destination: { siteId: 'site', listId: 'list', key: 'ItemCode' },
      fields: [
        { source: 'ItemCode', target: 'ItemCode', transform: 'copy' },
        { source: 'Group', target: 'GroupName', transform: 'lookup', lookup: { table: 'dbo.ItemGroups', match: 'Code', result: 'Name' } },
      ],
    };
    const saved = [], errors = [], discovery = [], previews = [];
    let failTables = true, failColumns = true;
    const table = { id: 'dbo.ItemGroups', schema: 'dbo', name: 'ItemGroups' };
    const source = [{ name: 'ItemCode', type: 'nvarchar', nullable: false }, { name: 'Group', type: 'nvarchar', nullable: true }];
    browser = await chromium.launch({
      executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      let data = {}, status = 200;
      if (url.pathname === '/api/mappings/sharepoint') data = { defaults: [config], saved };
      else if (url.pathname === '/api/mappings/tables') data = [table, { id: 'dbo.Items', schema: 'dbo', name: 'Items' }];
      else if (url.pathname === '/api/mappings/columns') data = source;
      else if (url.pathname === '/api/mappings/sharepoint/columns') data = config.fields.map(field => ({ name: field.target, displayName: field.target, type: 'text', supported: true, readOnly: false }));
      else if (url.pathname === '/api/mappings/sharepoint/lists') data = [{ id: 'list', displayName: 'Items' }];
      else if (url.pathname.startsWith('/api/mappings/lookup/')) {
        const database = url.searchParams.get('database');
        discovery.push({ path: url.pathname, database, table: url.searchParams.get('table') });
        const tables = url.pathname.endsWith('/tables');
        if (database === 'itemmaster' && (tables ? failTables : failColumns)) {
          status = 503;
          data = { message: tables ? 'Item Master tables unavailable' : 'Item Master columns unavailable' };
        } else data = tables ? [table] : [
          { name: 'Code', type: 'nvarchar', nullable: false },
          { name: database === 'itemmaster' ? 'MasterName' : 'Name', type: 'nvarchar', nullable: true },
        ];
      } else if (url.pathname === '/api/mappings/sharepoint/preview') {
        previews.push(request.postDataJSON().config);
        data = { sampleCount: 1, rows: [{ key: 'A', source: { ItemCode: 'A', Group: 'G' }, create: { ItemCode: 'A', GroupName: 'Master group' }, update: { ItemCode: 'A', GroupName: 'Master group' } }] };
      } else if (url.pathname === '/api/mappings/sharepoint/item' && request.method() === 'PUT') {
        data = { ...request.postDataJSON(), version: saved.length + 1, updatedBy: 'test@example.test', updatedAt: new Date().toISOString() };
        saved.splice(0, saved.length, data);
      } else if (url.pathname === '/api/mappings/sharepoint/item/history') {
        const { config, ...summary } = saved[0];
        data = { versions: [summary], nextBeforeVersion: null };
      } else if (url.pathname === '/api/mappings/sharepoint/item/history/1') data = saved[0];
      else if (/\/run(?:\/|$)/.test(url.pathname)) throw new Error('Unexpected sync request');
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Lookup check', role: 'viewer' }));
    });
    await page.goto('http://127.0.0.1:5173/sharepoint-mapping');
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    const edit = page.getByRole('button', { name: 'Configure GroupName rule', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Return column', { exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const input = document.querySelector('input[value="Name"]');
      return input && !input.disabled;
    });
    assert.equal(await dialog.getByLabel('Lookup database', { exact: true }).textContent(), 'Local');
    async function choose(label, option) {
      await dialog.getByLabel(label, { exact: true }).click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    await choose('Lookup database', 'Item Master');
    await dialog.getByRole('alert').getByText('Item Master tables unavailable').waitFor();
    assert.equal(await dialog.getByLabel('Lookup database', { exact: true }).textContent(), 'Item Master');
    for (const label of ['Lookup table', 'Match source value against', 'Return column']) {
      const value = await dialog.getByLabel(label, { exact: true }).evaluate(element => element.parentElement.querySelector('input').value);
      assert.equal(value, '', label + ' must clear on database change');
    }
    failTables = false;
    await dialog.getByRole('button', { name: 'Retry tables', exact: true }).click();
    await choose('Lookup table', 'dbo.ItemGroups');
    await dialog.getByRole('alert').getByText('Item Master columns unavailable').waitFor();
    failColumns = false;
    await dialog.getByRole('button', { name: 'Retry columns', exact: true }).click();
    await choose('Match source value against', 'Code');
    await choose('Return column', 'MasterName');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
    await dialog.getByText('Master group', { exact: false }).first().waitFor();
    assert.equal(previews[0].fields[1].lookup.database, 'itemmaster');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog.getByRole('alert').getByText(/Saved version 1/).waitFor();
    assert.deepEqual(saved[0].config.fields[1].lookup, { table: 'dbo.ItemGroups', match: 'Code', result: 'MasterName', database: 'itemmaster' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await edit.click();
    assert.equal(await dialog.getByLabel('Lookup database', { exact: true }).textContent(), 'Item Master');
    assert.equal(await dialog.getByLabel('Return column', { exact: true }).textContent(), 'MasterName');
    await choose('Lookup database', 'Local');
    await choose('Lookup table', 'dbo.ItemGroups');
    await choose('Match source value against', 'Code');
    await choose('Return column', 'Name');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await dialog.getByText('Database: Item Master', { exact: true }).waitFor();
    assert.ok(discovery.some(call => call.database === 'local'));
    assert.ok(discovery.some(call => call.database === 'itemmaster' && call.table === 'dbo.ItemGroups'));
    assert.deepEqual(errors, []);
    console.log('Lookup database browser check: legacy Local, database/column reset, errors/retries, isolated schema, preview/save/reload, switching back and history passed.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
