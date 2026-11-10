// Download tests intercept all API traffic; no live reads or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
function parseCsv(text) {
  const records = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if (char === '\r' && text[i + 1] === '\n' && !quoted) { row.push(field); records.push(row); row = []; field = ''; i++; }
    else field += char;
  }
  return records;
}
let browser;
(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const calls = [], downloads = [], errors = [];
    let failSecondPage = false, pauseSecondPage, releaseSecondPage;
    page.on('download', download => downloads.push(download)); page.on('pageerror', error => errors.push(error.message));
    const staging = Array.from({ length: 1003 }, (_, index) => ({
      itemCode: `I${String(index + 1).padStart(4, '0')}`, itemDescription: 'Bolt, "large"\r\nNext line', isActive: index < 1002,
      category: 'I', itemClassCode: '10', itemClassName: 'CLASS', itemGroupName: 'GROUP', uom: 'EA', uomId: 7,
      leadTime: 3, isWHInventory: true, isSalesInventory: false, isPurchaseInventory: true,
      createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T02:00:00Z',
      ...(index === 1001 ? { lastPageOnlyColumn: 'included' } : {}),
    }));
    await page.route(url => url.pathname.startsWith('/sync/') || url.pathname.startsWith('/api/'), async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET', 'Exports must never submit a sync');
      const source = url.pathname.split('/').pop();
      assert.ok(url.pathname.startsWith('/sync/data/item/'));
      const number = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
      calls.push({ source, number, limit, search: url.searchParams.get('search'), status: url.searchParams.get('isActive') });
      if (limit === 500 && number === 2 && pauseSecondPage) await pauseSecondPage;
      if (limit === 500 && number === 2 && failSecondPage) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Export page unavailable' }) });
      let rows = source === 'sap' ? [{ itemCode: 'SAP-1', itemDescription: 'Bolt', leadTime: 8, isSalesInventory: false, sapHiddenColumn: 'SAP data' }] : staging;
      const active = url.searchParams.get('isActive'); if (active) rows = rows.filter(row => row.isActive === (active === 'true'));
      const search = url.searchParams.get('search'); if (search) rows = rows.filter(row => row.itemDescription.toLowerCase().includes(search.toLowerCase()));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: rows.slice((number - 1) * limit, number * limit), total: rows.length, page: number, limit }) }).catch(() => {});
    });
    await page.addInitScript(() => { localStorage.setItem('token', 'fixture'); localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Export Check' })); });
    await page.goto((process.env.MAPPING_UI_URL || 'http://127.0.0.1:5173') + '/items');
    const exportButton = () => page.getByRole('button', { name: 'Export CSV', exact: true });
    await exportButton().waitFor();
    await page.getByLabel('Search', { exact: true }).fill('Bolt');
    assert.equal(await exportButton().isDisabled(), true, 'Pending filters must settle before export');
    await page.getByRole('combobox', { name: /^Status/ }).click(); await page.getByRole('option', { name: 'Active', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton().click()]);
    assert.match(download.suggestedFilename(), /^items-staging-.*\.csv$/);
    const text = await fs.readFile(await download.path(), 'utf8'), csv = parseCsv(text);
    const headers = csv[0];
    assert.equal(csv.length, 1003, 'Export must include 1002 matching rows, not the 20 visible rows');
    for (const field of ['isActive', 'category', 'uomId', 'leadTime', 'isSalesInventory', 'isPurchaseInventory', 'createdAt', 'updatedAt', 'lastPageOnlyColumn']) assert.ok(headers.includes(field), `Missing hidden column: ${field}`);
    assert.equal(csv[1][headers.indexOf('itemDescription')], 'Bolt, "large"\r\nNext line');
    assert.equal(csv[1][headers.indexOf('isSalesInventory')], 'false');
    assert.equal(csv.at(-1)[headers.indexOf('lastPageOnlyColumn')], 'included');
    const pages = calls.filter(call => call.limit === 500);
    assert.deepEqual(pages.map(call => call.number), [1, 2, 3]); assert.ok(pages.every(call => call.search === 'Bolt' && call.status === 'true' && call.source === 'staging'));
    await page.getByText(/Exported 1,002 Staging records/).waitFor();
    await page.getByRole('tab', { name: 'SAP', exact: true }).click();
    const [sap] = await Promise.all([page.waitForEvent('download'), exportButton().click()]);
    assert.match(sap.suggestedFilename(), /^items-sap-.*\.csv$/);
    assert.ok((await fs.readFile(await sap.path(), 'utf8')).includes('sapHiddenColumn'));
    assert.equal(calls.filter(call => call.source === 'sap' && call.limit === 500).at(-1).status, null);
    await page.getByRole('tab', { name: 'Staging', exact: true }).click();
    failSecondPage = true;
    await exportButton().click(); await page.getByText('Export page unavailable', { exact: true }).waitFor();
    assert.equal(downloads.length, 2, 'A failed later page must not download a partial file'); failSecondPage = false;
    pauseSecondPage = new Promise(resolve => { releaseSecondPage = resolve; });
    await exportButton().click(); await page.getByRole('button', { name: 'Cancel export', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'SAP', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
    await page.getByText('Export canceled. No file was downloaded.', { exact: true }).waitFor();
    releaseSecondPage(); pauseSecondPage = undefined;
    assert.equal(downloads.length, 2);
    await page.screenshot({ path: path.join(os.tmpdir(), 'items-export-ui.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Master Data export: complete filtered dataset, hidden/later-page columns, CSV round-trip, selected source, errors without partial files and cancellation passed. No writes.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
