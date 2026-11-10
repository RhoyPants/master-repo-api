// List discovery/selection regression check with mocked API metadata; no external writes.
require('dotenv').config({ quiet: true });
require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser/node_modules/playwright-core'));
const { defaultMappings } = require('../src/modules/mappings/defaults');
let browser;
(async () => {
  try {
    const initial = defaultMappings().find(m => m.module === 'item');
    initial.destination.siteId = 'site-a'; initial.destination.listId = 'list-a';
    const sourceNames = [...new Set([initial.source.key, ...initial.source.filters.map(f => f.column), ...initial.fields.filter(f => f.source).map(f => f.source)])];
    const targetNames = [...new Set(initial.fields.map(f => f.target))];
    const saved = [], columnRequests = [], listRequests = [], syncRequests = [], errors = [];
    let lastSave, failDiscovery = false, renamed = false;
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST' && /\/run(?:\/|$)/.test(url.pathname)) syncRequests.push(url.pathname);
      let data = {};
      if (url.pathname === '/api/mappings/sharepoint' && request.method() === 'GET') data = { saved, defaults: [initial] };
      else if (url.pathname === '/api/mappings/tables') data = ['Items', 'ItemClasses', 'ItemGroups'].map(name => ({ id: `dbo.${name}`, name, schema: 'dbo' }));
      else if (url.pathname === '/api/mappings/columns') data = sourceNames.map(name => ({ name, type: 'nvarchar', nullable: true }));
      else if (url.pathname === '/api/mappings/sharepoint/lists') {
        const siteId = url.searchParams.get('siteId'); listRequests.push(siteId);
        if (failDiscovery) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'List discovery denied for test' }) });
        data = siteId === 'site-a' ? [{ id: 'list-a', displayName: 'Inventory Items' }, { id: 'list-b', displayName: renamed ? 'Vendor Master Renamed' : 'Vendor Master' }]
          : [{ id: 'list-c', displayName: 'Warehouse Directory' }];
      } else if (url.pathname === '/api/mappings/sharepoint/columns') {
        columnRequests.push(url.searchParams.get('listId'));
        data = [...targetNames, ...(url.searchParams.get('listId') === 'list-b' ? ['VendorName'] : [])].map(name => ({ name, displayName: name, type: ['LeadTime', 'iswhInventory', 'isModified'].includes(name) ? 'number' : 'text', required: false, readOnly: false, supported: true }));
      } else if (url.pathname === '/api/mappings/sharepoint/item' && request.method() === 'PUT') {
        lastSave = request.postDataJSON();
        const row = { module: 'item', config: lastSave.config, enabled: lastSave.enabled, version: lastSave.version + 1, updatedBy: 'layout@example.test', updatedAt: new Date().toISOString() };
        saved.splice(0, saved.length, row); data = row;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'List Selection Check', role: 'viewer' }));
    });
    await page.goto('http://127.0.0.1:5173/sharepoint-mapping');
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    await page.getByRole('button', { name: /^Source & destination/ }).click();
    const picker = page.getByRole('combobox', { name: 'SharePoint list', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Inventory Items'));
    assert.equal(await page.getByLabel('SharePoint list ID', { exact: true }).count(), 0);
    await picker.fill('Vendor');
    await page.getByRole('option', { name: 'Vendor Master', exact: true }).click();
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    assert.ok(columnRequests.includes('list-b'), 'List selection must reload columns automatically');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View JSON', exact: true }).click();
    let config = JSON.parse(await page.getByRole('dialog').locator('pre').textContent());
    assert.equal(config.destination.listId, 'list-b'); assert.equal(config.destination.displayName, undefined);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await page.getByText(/Saved version 1/).waitFor();
    assert.equal(lastSave.config.destination.listId, 'list-b');
    assert.equal(await page.getByRole('dialog').getByText(/Saved version 1/).count(), 1);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    console.log('Search by list name, automatic column loading and saving the selected ID passed');
    failDiscovery = true;
    await page.getByRole('button', { name: 'Refresh lists', exact: true }).click();
    await page.getByText('List discovery denied for test', { exact: true }).waitFor();
    assert.equal(await picker.inputValue(), 'Vendor Master');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View JSON', exact: true }).click();
    config = JSON.parse(await page.getByRole('dialog').locator('pre').textContent());
    assert.equal(config.destination.listId, 'list-b');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    failDiscovery = false; renamed = true;
    await page.getByRole('button', { name: 'Refresh lists', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Vendor Master Renamed'));
    console.log('Discovery errors preserve the selected ID; refreshed list names resolve without remapping');
    await page.getByLabel('SharePoint site ID', { exact: true }).fill('site-b');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.getAttribute('role') === 'combobox' && input.value === ''));
    await picker.fill('Warehouse');
    await page.getByRole('option', { name: 'Warehouse Directory', exact: true }).click();
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    assert.ok(listRequests.includes('site-b')); assert.ok(columnRequests.includes('list-c'));
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View JSON', exact: true }).click();
    config = JSON.parse(await page.getByRole('dialog').locator('pre').textContent());
    assert.equal(config.destination.siteId, 'site-b'); assert.equal(config.destination.listId, 'list-c');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(errors.length, 0, errors.join('\n')); assert.equal(syncRequests.length, 0);
    console.log('Site changes reset selection and discover the new site lists; no runtime errors or sync requests');
    await page.screenshot({ path: path.join(os.tmpdir(), 'master-repo-sharepoint-list-picker.png') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
