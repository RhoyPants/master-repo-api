// Fixture API responses only. No live reads, syncs or database writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], calls = []; let failOverview = false;
    page.on('pageerror', error => errors.push(error.message));
    const run = (id, module, status, actor = { userId: 7, name: 'Roe Pantoja', email: 'roe@example.test' }) => ({ id, runId: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`, transactionTypeId: 1, transactionCode: 'SAP2SDB_ITEM', module, modulePath: 'items', flow: 'SAP → Staging', selected: false, status, actor, startedAt: '2026-11-09T01:30:00Z', endedAt: '2026-11-09T01:30:12Z', durationMs: 12000, totalRecords: 3, inserted: 1, updated: 1, skipped: 1, failed: 0, recordedItems: 3, errorMessage: null });
    const runs = [run(101, 'Items', 'SUCCESS'), { ...run(102, 'UOM', 'PARTIAL'), flow: 'Staging → SharePoint', failed: 1 }, { ...run(103, 'Warehouses', 'SUCCESS', null), recordedItems: 0, totalRecords: 15 }];
    const records = [
      { id: 1, entity: 'Item', referenceKey: 'I001', action: 'UPDATE', status: 'SUCCESS', errorMessage: null, payload: { mappingId: 'item', mappingVersion: 2, changes: [{ field: 'ItemDescription', from: 'Old name', to: 'New name' }] } },
      { id: 2, entity: 'Item', referenceKey: 'I002', action: 'INSERT', status: 'SUCCESS', errorMessage: null, payload: { values: { ItemCode: 'I002', ItemDescription: 'Example item' } } },
      { id: 3, entity: 'Item', referenceKey: 'I003', action: 'SKIP', status: 'SUCCESS', errorMessage: null, payload: { reason: 'Already current' } },
    ];
    await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/'), async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET', 'This browser check must never submit a sync');
      calls.push(url.pathname + url.search);
      let body, status = 200;
      if (url.pathname === '/api/health') body = { status: 'ok', database: 'connected' };
      else if (url.pathname === '/api/audit/overview') {
        if (failOverview) { status = 500; body = { message: 'Audit overview unavailable' }; }
        else {
          const days = Number(url.searchParams.get('days') || 7);
          body = { days, timezone: 'Asia/Manila', from: '2026-11-02T16:00:00Z', to: '2026-11-09T16:00:00Z', generatedAt: '2026-11-09T02:00:00Z', successRate: 80,
            totals: { runs: 15, success: 12, partial: 2, failed: 1, running: 0, inserted: 120, updated: 75, skipped: 240, failedRecords: 3, records: 438 },
            trend: Array.from({ length: days }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 10 - days + i)).toISOString().slice(0, 10), success: i % 3 + 1, failed: i === days - 1 ? 1 : 0, running: 0 })),
            modules: [{ module: 'Items', runs: 10, changed: 160, failed: 2 }, { module: 'UOM', runs: 5, changed: 35, failed: 1 }], recent: runs };
        }
      } else if (url.pathname === '/api/audit/types') body = [{ id: 1, code: 'SAP2SDB_ITEM', module: 'Items', flow: 'SAP → Staging', selected: false }];
      else if (url.pathname === '/api/audit/runs') {
        let list = runs;
        const filter = url.searchParams.get('status'); if (filter) list = list.filter(run => filter === 'ATTENTION' ? ['FAILED', 'PARTIAL'].includes(run.status) : run.status === filter);
        body = { data: list, total: list.length, page: 1, limit: 20 };
      } else if (/\/runs\/\d+\/items$/.test(url.pathname)) {
        const id = Number(url.pathname.split('/').at(-2)); let list = id === 103 ? [] : records;
        const search = url.searchParams.get('search'), filter = url.searchParams.get('status'), action = url.searchParams.get('action');
        if (search) list = list.filter(item => item.referenceKey.includes(search)); if (filter) list = list.filter(item => item.status === filter); if (action) list = list.filter(item => item.action === action);
        body = { data: list, total: list.length, page: 1, limit: 20 };
      } else if (/\/runs\/\d+$/.test(url.pathname)) {
        const id = Number(url.pathname.split('/').pop()); body = { ...runs.find(run => run.id === id), steps: [{ id: 5, level: 'INFO', step: 'MAPPING', message: 'Item mapping version 2; saved SQL; dbo.Items', referenceKey: null }] };
      } else throw new Error('Unexpected API request: ' + url.pathname);
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.addInitScript(() => { localStorage.setItem('token', 'fixture'); localStorage.setItem('user', JSON.stringify({ id: 7, name: 'Roe' })); });
    const ui = process.env.MAPPING_UI_URL || 'http://127.0.0.1:5173';
    await page.goto(ui + '/dashboard');
    await page.getByRole('heading', { name: 'Your sync operations, at a glance.', exact: true }).waitFor();
    await page.getByRole('figure', { name: 'Daily sync activity', exact: true }).waitFor();
    await page.getByText('80%', { exact: true }).waitFor();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'sync-dashboard-desktop.png') });
    await page.getByRole('combobox', { name: /^Period/ }).click(); await page.getByRole('option', { name: 'Last 30 days', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Daily sync activity"] a').length === 30);
    assert.ok(calls.some(call => call.includes('/overview?days=30')));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('main').evaluate(main => main.scrollWidth <= main.clientWidth + 1), 'dashboard must not overflow on mobile');
    await page.screenshot({ path: path.join(os.tmpdir(), 'sync-dashboard-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('table', { name: 'Recent sync runs', exact: true }).getByRole('link', { name: 'Items', exact: true }).click();
    const details = page.getByRole('region', { name: 'Details for run 101', exact: true });
    await details.getByText('roe@example.test', { exact: true }).waitFor();
    await details.getByRole('button', { name: 'Show details for I001', exact: true }).click();
    await details.getByRole('table', { name: 'Recorded field changes', exact: true }).getByText('Old name', { exact: true }).waitFor();
    await details.getByText('New name', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'audit-runs-desktop.png') });
    await details.getByLabel('Find record', { exact: true }).fill('I001');
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Records in this run"] tbody button').length === 1);
    await details.getByRole('combobox', { name: /^Record status/ }).click(); await page.getByRole('option', { name: 'Failed', exact: true }).click();
    await details.getByText('No recorded entries match these filters.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View run 103', exact: true }).click();
    const legacy = page.getByRole('region', { name: 'Details for run 103', exact: true });
    await legacy.getByText('Not recorded', { exact: true }).waitFor();
    await legacy.getByText(/fewer item entries/).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('main').evaluate(main => main.scrollWidth <= main.clientWidth + 1), 'audit must keep horizontal scrolling inside tables');
    await page.screenshot({ path: path.join(os.tmpdir(), 'audit-runs-mobile.png') });
    await page.goto(ui + '/dashboard'); await page.getByText('80%', { exact: true }).waitFor(); failOverview = true;
    await page.getByRole('button', { name: 'Refresh dashboard', exact: true }).click();
    await page.getByText('Audit overview unavailable Showing the last loaded overview.', { exact: false }).waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Dashboard/Audit: actual metric fixtures, period chart, deep-linked runs, initiators, field changes, record filters, legacy unknowns, errors and mobile layout passed. No writes.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
