// All data/sync requests are mocked; this check never runs a real sync.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Mocked sync/refresh did not start')), 10000); })]); }
  finally { clearTimeout(timer); }
}
let browser, runGate, refreshGate, refreshStarted;
(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const requests = [], errors = [];
    let failing = false, refreshing = false, started;
    page.on('pageerror', error => errors.push(error.message));
    const rows = ['EA', 'BOX'].map((code, index) => ({
      code, uomCode: code, uomName: code, whCode: code, whName: code, itemCode: code, itemDescription: code,
      itmsGrpCod: String(index + 10), initials: code, itmsGrpNam: code, itemGroupId: String(index + 1),
      itemGroupName: code, name: code, description: code, isActive: true,
    }));
    await page.route(url => ['/api/', '/sync/', '/data/'].some(prefix => url.pathname.startsWith(prefix)), async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST' && /\/run(?:\/|$)/.test(url.pathname)) {
        requests.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
        started.resolve();
        await runGate.promise;
        if (failing) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated sync failure' }) });
        refreshing = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          success: true, message: 'Mocked sync completed', status: 'SUCCESS', totalRecords: 2,
          inserted: 1, updated: 0, skipped: 1, failed: 0, items: [],
        }) });
      }
      if (refreshing && url.pathname.includes('/data/')) { refreshStarted.resolve(); await refreshGate.promise; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows, pagination: { total: rows.length }, total: rows.length }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'sync-progress-fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Sync Progress Check', role: 'viewer' }));
    });
    const result = page.getByRole('dialog').filter({ has: page.getByText('Sync Result', { exact: true }) });
    const progress = page.getByRole('dialog', { name: 'Sync in progress', exact: true });
    async function run(mode = 'full', fail = false) {
      const checkboxes = page.locator('main input[type="checkbox"]');
      if (mode === 'single') await checkboxes.nth(1).check();
      if (mode === 'multiple') await checkboxes.nth(0).check();
      runGate = deferred(); refreshGate = deferred(); refreshStarted = deferred(); started = deferred();
      failing = fail; refreshing = false;
      const before = requests.length;
      await page.getByRole('button', { name: /^(Run Full Sync|Sync \d+)/ }).click();
      const confirm = page.getByRole('dialog', { name: 'Confirm Sync', exact: true });
      await confirm.getByRole('button', { name: 'Confirm Sync', exact: true }).click();
      await bounded(started.promise);
      await progress.waitFor();
      assert.equal(await progress.getByRole('progressbar').count(), 1);
      assert.match(await progress.getByRole('status').textContent(), /Syncing/);
      assert.equal(await progress.locator('[aria-busy="true"]').count(), 1);
      assert.equal(await progress.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
      const syncingButton = progress.getByRole('button', { name: 'Syncing...', exact: true });
      assert.equal(await syncingButton.isDisabled(), true);
      await syncingButton.evaluate(button => button.click());
      await page.keyboard.press('Escape');
      await page.locator('.MuiBackdrop-root').last().click({ force: true, position: { x: 5, y: 5 } });
      assert.equal(await progress.isVisible(), true);
      assert.equal(requests.length, before + 1, 'Pending sync must not be submitted twice');
      assert.ok(requests.at(-1).path.endsWith(mode === 'full' ? '/run' : `/run/${mode}`));
      if (process.env.SYNC_PROGRESS_SCREENSHOT && before === 0) await page.screenshot({ path: process.env.SYNC_PROGRESS_SCREENSHOT });
      runGate.resolve();
      if (!fail) {
        await bounded(refreshStarted.promise);
        assert.equal(await progress.isVisible(), true, 'Progress remains visible through data refresh');
        refreshGate.resolve();
      }
      await result.waitFor();
      if (fail) {
        await result.getByText('Simulated sync failure', { exact: true }).waitFor();
        assert.equal(await result.locator('.MuiAlert-standardError').count(), 1);
      } else {
        assert.equal(await result.locator('.MuiAlert-standardSuccess').count(), 1);
        assert.equal(await result.getByText('Inserted: 1', { exact: true }).count(), 1);
      }
      assert.equal(await progress.count(), 0);
      refreshing = false;
      await result.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Run Full Sync', exact: true }).isEnabled(), true);
    }
    async function choose(label, value) {
      await page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').getByRole('combobox').click();
      await page.getByRole('option', { name: value, exact: true }).click();
    }
    for (const module of ['uom', 'warehouses', 'item-class', 'items', 'item-group']) {
      await page.goto(`http://127.0.0.1:5173/${module}/sync`);
      await page.locator('main input[type="checkbox"]').nth(1).waitFor({ timeout: 10000 }).catch(error => {
        console.error('Source fixture failed to load:', module, errors, requests.at(-1));
        throw error;
      });
      await run();
    }
    await page.goto('http://127.0.0.1:5173/uom/sync');
    await page.locator('main input[type="checkbox"]').nth(1).waitFor();
    await run('single'); await run('multiple');
    await choose('To', 'SharePoint'); await choose('From', 'Staging');
    await page.locator('main input[type="checkbox"]').nth(1).waitFor();
    await run(); await run('single'); await run('multiple');
    await run('full', true); await run();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`Sync progress: ${requests.length} mocked runs passed across all five modules; full/single/multiple, both UOM flows, dismissal/duplicate guards, refresh, errors and retry verified.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    runGate?.resolve(); refreshGate?.resolve();
    if (browser) await browser.close();
  }
})();
