// Mocked data and sync endpoints only. No live writes or service calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: () => resolve() }; };
let browser;
(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const requests = [], runs = [], errors = [];
    let holdSharePoint, holdStaging, holdSecondPage;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname.startsWith('/sync/') || url.pathname.startsWith('/api/'), async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST') {
        runs.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'SUCCESS', inserted: 2, updated: 0, skipped: 0, failed: 0, items: [] }) });
      }
      assert.ok(url.pathname.startsWith('/sync/data/'), 'Unexpected API request: ' + url.pathname);
      const source = url.pathname.split('/').pop(), number = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20), search = url.searchParams.get('search') || '';
      requests.push({ source, number, search, headers: request.headers() });
      if (source === 'sharepoint' && holdSharePoint) await holdSharePoint.promise;
      if (source === 'staging' && holdStaging) await holdStaging.promise;
      if (source === 'sap' && number === 2 && holdSecondPage) await holdSecondPage.promise;
      const rows = Array.from({ length: Math.min(limit, 45 - (number - 1) * limit) }, (_, i) => {
        const code = `${source.toUpperCase()}-${(number - 1) * limit + i + 1}`;
        return { whCode: code, whName: `${search ? search + '-' : ''}${code} warehouse`, address: 'Warehouse address', isActive: true };
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: rows, total: 45 }) }).catch(() => {});
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture'); localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Data UI Check' }));
    });
    const ui = process.env.MAPPING_UI_URL || 'http://127.0.0.1:5173';
    await page.goto(ui + '/warehouses');
    const table = name => page.getByRole('table', { name, exact: true });
    await table('Staging Warehouses').getByText('STAGING-1 warehouse', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'SAP', exact: true }).click();
    await table('SAP Warehouses').getByText('SAP-1 warehouse', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Staging', exact: true }).click();
    await table('Staging Warehouses').getByText('STAGING-1 warehouse', { exact: true }).waitFor();
    assert.equal(requests.filter(request => request.source === 'staging').length, 1, 'fresh cached tabs must not refetch');
    await page.getByLabel('Search', { exact: true }).pressSequentially('abc', { delay: 35 });
    await table('Staging Warehouses').getByText('abc-STAGING-1 warehouse', { exact: true }).waitFor();
    assert.equal(requests.filter(request => ['a', 'ab'].includes(request.search)).length, 0, 'typing must be debounced');
    assert.equal(requests.filter(request => request.search === 'abc').length, 1);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await table('Staging Warehouses').getByText('STAGING-1 warehouse', { exact: true }).waitFor();
    holdSharePoint = deferred();
    await page.getByRole('tab', { name: 'SharePoint', exact: true }).click();
    await page.getByRole('progressbar', { name: 'Loading SharePoint Warehouses', exact: true }).waitFor();
    assert.equal(await table('SharePoint Warehouses').getByText('STAGING-1 warehouse', { exact: true }).count(), 0, 'other-source rows must never appear under the new tab');
    await page.getByRole('tab', { name: 'SAP', exact: true }).click();
    holdSharePoint.resolve(); holdSharePoint = undefined;
    await table('SAP Warehouses').getByText('SAP-1 warehouse', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    assert.ok(requests.some(request => request.source === 'sap' && request.headers['x-refresh-data'] === '1'), 'manual refresh must bypass server cache');
    await page.screenshot({ path: path.join(os.tmpdir(), 'master-data-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('main').evaluate(main => main.scrollWidth <= main.clientWidth + 1), 'master data must not overflow on mobile');
    await page.screenshot({ path: path.join(os.tmpdir(), 'master-data-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    holdStaging = deferred();
    await page.goto(ui + '/warehouses/sync');
    await table('SAP Warehouses').getByText('SAP-1 warehouse', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Select SAP-1', exact: true }).isEnabled(), true, 'source becomes usable before the destination returns');
    await page.getByRole('progressbar', { name: 'Loading Staging Warehouses', exact: true }).waitFor();
    holdStaging.resolve(); holdStaging = undefined;
    await table('Staging Warehouses').getByText('STAGING-1 warehouse', { exact: true }).waitFor();
    const sourceCalls = requests.filter(request => request.source === 'sap').length;
    await page.getByRole('combobox', { name: /^To/ }).click();
    await page.getByRole('option', { name: 'SharePoint', exact: true }).click();
    await table('SharePoint Warehouses').getByText('SHAREPOINT-1 warehouse', { exact: true }).waitFor();
    assert.equal(requests.filter(request => request.source === 'sap').length, sourceCalls, 'destination changes must not refetch the source');
    await page.getByRole('combobox', { name: /^To/ }).click();
    await page.getByRole('option', { name: 'Staging', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select SAP-1', exact: true }).check();
    holdSecondPage = deferred();
    const sourcePanel = table('SAP Warehouses').locator('xpath=ancestor::div[contains(@class,"MuiPaper-root")][1]');
    await sourcePanel.getByRole('button', { name: 'Go to next page', exact: true }).click();
    await page.getByRole('progressbar', { name: 'Loading SAP Warehouses', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Select SAP-1', exact: true }).isDisabled(), true, 'placeholder rows must not be selectable');
    holdSecondPage.resolve(); holdSecondPage = undefined;
    await page.getByRole('checkbox', { name: 'Select SAP-21', exact: true }).check();
    await page.screenshot({ path: path.join(os.tmpdir(), 'sync-workspace-desktop.png') });
    await page.getByRole('button', { name: 'Sync 2 selected', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm Sync', exact: true }).getByRole('button', { name: 'Confirm Sync', exact: true }).click();
    const result = page.getByRole('dialog').filter({ has: page.getByText('Sync Result', { exact: true }) });
    await result.waitFor();
    assert.deepEqual(runs, [{ path: '/sync/sap-staging/warehouse/run/multiple', body: { whCodes: ['SAP-1', 'SAP-21'] } }]);
    await result.getByRole('button', { name: 'Close', exact: true }).click();
    const cachedStaging = requests.filter(request => request.source === 'staging').length;
    await page.getByRole('link', { name: 'Back to Warehouses', exact: true }).click();
    await table('Staging Warehouses').getByText('STAGING-1 warehouse', { exact: true }).waitFor();
    assert.equal(requests.filter(request => request.source === 'staging').length, cachedStaging, 'master and sync must share fresh data after sync');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Data UI: cached tabs, debounce, source isolation, forced refresh, independent sync panels, cross-page key selection, post-sync cache sharing and mobile layout passed. Screenshots saved in temp directory.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
