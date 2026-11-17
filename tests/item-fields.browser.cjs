// Read/display checks with mocked APIs; never writes or runs a sync.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    const base = { itemDescription: 'Item', category: 'I', uom: 'PC', isWHInventory: true, isSalesInventory: true, isPurchaseInventory: true };
    const rows = {
      sap: [{ ...base, itemCode: 'SAP-1', inventoryOUM: 'SAP-EACH', purchaseUom: 'SAP-BOX' }, { ...base, itemCode: 'SAP-2', inventoryOUM: null, purchaseUom: null }],
      staging: [{ ...base, itemCode: 'STG-1', inventoryOUM: 'STG-EACH', convertionValue: '12.500001' }, { ...base, itemCode: 'STG-2', inventoryOUM: null, convertionValue: null }],
      sharepoint: [{ ...base, itemCode: 'SP-1', inventoryOUM: 'SP-EACH', purchaseUom: 'SP-BOX', convertionValue: 0 }, { ...base, itemCode: 'SP-2', inventoryOUM: null, purchaseUom: null, convertionValue: null }],
    };
    const expected = {
      SAP: ['SAP-EACH', 'SAP-BOX', '—'],
      Staging: ['STG-EACH', '—', '12.500001'],
      SharePoint: ['SP-EACH', 'SP-BOX', '0'],
    };
    const labels = ['Inventory UOM', 'Purchase UOM', 'Conversion Value'];
    const errors = [], writes = [];
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname.startsWith('/sync/'), async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      const source = url.pathname.split('/').pop();
      const data = rows[source] ?? [];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
    });
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.addInitScript(() => {
      localStorage.setItem('token', 'item-fields-fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Item Fields Check', role: 'viewer' }));
    });
    async function checkTable(table, source, checkEmptyRow = true) {
      await table.getByRole('columnheader', { name: 'Conversion Value', exact: true }).waitFor();
      await table.getByRole('cell', { name: source === 'SAP' ? 'SAP-1' : source === 'Staging' ? 'STG-1' : 'SP-1', exact: true }).waitFor();
      const headers = await table.locator(':scope > thead > tr > th').allTextContents();
      const body = table.locator(':scope > tbody > tr');
      for (const [index, label] of labels.entries()) {
        assert.equal(headers.filter(text => text === label).length, 1, `${source}: ${label} must appear once`);
        const column = headers.indexOf(label);
        assert.equal(await body.nth(0).locator(':scope > td').nth(column).textContent(), expected[source][index], `${source}: ${label}`);
        if (checkEmptyRow) assert.equal(await body.nth(1).locator(':scope > td').nth(column).textContent(), '—', `${source}: empty ${label}`);
      }
      assert.equal(await table.getByRole('columnheader', { name: /Sales Inventory/i }).count(), 0);
    }
    await page.goto('http://127.0.0.1:5173/items');
    for (const source of ['Staging', 'SAP', 'SharePoint']) {
      await page.getByRole('tab', { name: source, exact: true }).click();
      await checkTable(page.getByRole('table', { name: `${source} Items`, exact: true }), source);
    }
    await page.goto('http://127.0.0.1:5173/items/sync');
    await checkTable(page.getByRole('table', { name: 'SAP Items', exact: true }), 'SAP');
    await checkTable(page.getByRole('table', { name: 'Staging Items', exact: true }), 'Staging');
    async function checkConfirmation(source, code) {
      await page.getByRole('checkbox', { name: `Select ${code}`, exact: true }).check();
      await page.getByRole('button', { name: 'Sync 1 selected', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirm Sync', exact: true });
      await checkTable(dialog.getByRole('table'), source, false);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await checkConfirmation('SAP', 'SAP-1');
    async function choose(label, source) {
      await page.getByLabel(label, { exact: true }).click();
      await page.getByRole('option', { name: source, exact: true }).click();
    }
    await choose('From', 'Staging');
    await choose('To', 'SharePoint');
    await checkTable(page.getByRole('table', { name: 'Staging Items', exact: true }), 'Staging');
    await checkTable(page.getByRole('table', { name: 'SharePoint Items', exact: true }), 'SharePoint');
    await checkConfirmation('Staging', 'STG-1');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log('Item fields: all three Master Data tabs, SAP/Staging/SharePoint comparison tables, SAP/Staging confirmations, distinct UOMs, decimal precision, zero, nulls and hidden sales flag passed; no writes.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
