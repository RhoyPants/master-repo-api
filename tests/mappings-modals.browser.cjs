// Mocked browser regression check; no database or SharePoint writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser', 'node_modules', 'playwright-core'));
let browser;
(async () => {
  try {
    const config = {
      schemaVersion: 1, module: 'item', name: 'Item modal check',
      source: { table: 'dbo.Items', key: 'ItemCode', filters: [{ column: 'IsActive', value: false }, { column: 'Quantity', value: 0 }, { column: 'Notes', value: '' }, { column: 'Optional', value: null }] },
      destination: { siteId: 'site-test', listId: 'list-test', key: 'ItemCode' },
      fields: [
        { source: 'ItemCode', target: 'ItemCode', transform: 'copy' },
        { source: '', target: 'Title', transform: 'uuid', write: 'create' },
        { source: '', target: 'Entity', transform: 'constant', value: 'GVI' },
        { source: '', target: 'isModified', transform: 'constant', value: 0, write: 'create' },
        { source: '', target: 'isModified', transform: 'constant', value: 1, write: 'update' },
        { source: '', target: 'IsActive', transform: 'constant', value: false },
        { source: '', target: 'Notes', transform: 'constant', value: '' },
        { source: 'ItemCode', target: 'Status', transform: 'valueMap', values: { Y: 'ACTIVE', N: 'INACTIVE', NULL: null, OFF: false, ZERO: 0, EMPTY: '' }, onMissing: 'null' },
        { source: 'ItemCode', target: 'GroupCode', transform: 'lookup', lookup: { table: 'dbo.ItemGroups', match: 'Code', result: 'Name' } },
        ...['uppercase', 'lowercase', 'trim', 'number', 'boolean'].map(transform => ({ source: 'ItemCode', target: `${transform}Field`, transform })),
      ],
    };
    const saved = [], histories = [], errors = [], syncRequests = [];
    let previewRows = [{ key: 'ITEM-1', source: { ItemCode: 'ITEM-1' }, create: { ItemCode: 'ITEM-1' }, update: { ItemCode: 'ITEM-1' } }];
    let previewError = false, saveError = false, historyError = false, detailError = false, pendingResponse = Promise.resolve();
    browser = await chromium.launch({
      executablePath: process.env.MAPPING_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (/\/run(?:\/|$)/.test(url.pathname)) syncRequests.push(url.pathname);
      let data = {}, status = 200;
      if (url.pathname === '/api/mappings/sharepoint' && request.method() === 'GET') data = { defaults: [config], saved };
      else if (url.pathname === '/api/mappings/tables') data = [{ id: 'dbo.Items', schema: 'dbo', name: 'Items' }];
      else if (url.pathname === '/api/mappings/columns') data = [{ name: 'ItemCode', type: 'nvarchar', nullable: false }];
      else if (url.pathname === '/api/mappings/sharepoint/lists') data = [{ id: 'list-test', displayName: 'Test Items' }];
      else if (url.pathname === '/api/mappings/sharepoint/columns') data = [{ name: 'ItemCode', displayName: 'ItemCode', type: 'text', required: true, supported: true, readOnly: false }];
      else if (url.pathname === '/api/mappings/sharepoint/item/history') {
        if (historyError) { status = 503; data = { message: 'History storage unavailable.' }; }
        else {
          const rows = histories.filter(row => row.version < Number(url.searchParams.get('beforeVersion') || 999)).sort((a, b) => b.version - a.version);
          data = { versions: rows.slice(0, 1).map(({ config, ...row }) => row), nextBeforeVersion: rows.length > 1 ? rows[0].version : null };
        }
      } else if (/\/api\/mappings\/sharepoint\/item\/history\/\d+$/.test(url.pathname)) {
        if (detailError) { status = 500; data = { message: 'Saved version could not be loaded.' }; }
        else data = histories.find(row => row.version === Number(url.pathname.split('/').pop()));
      } else if (url.pathname === '/api/mappings/sharepoint/preview') {
        await pendingResponse;
        status = previewError ? 400 : 200;
        data = previewError ? { message: 'Source column no longer exists.' } : {
          valid: true, sampleCount: previewRows.length, rows: previewRows,
          message: previewRows.length ? 'Schema and sample values validated. Preview does not write to SharePoint.' : 'No source records match the filters.',
        };
      } else if (url.pathname === '/api/mappings/sharepoint/item' && request.method() === 'PUT') {
        await pendingResponse;
        if (saveError) { status = 409; data = { message: 'Mapping was changed by another editor.' }; }
        else {
          const body = request.postDataJSON();
          data = { module: 'item', ...body, version: body.version + 1, updatedBy: 'modal@example.test', updatedAt: new Date().toISOString() };
          saved.splice(0, saved.length, data);
          histories.push(structuredClone(data));
        }
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('token', 'fixture');
      localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Modal Check', role: 'viewer' }));
    });
    await page.goto('http://127.0.0.1:5173/sharepoint-mapping');
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    const previewButton = page.getByRole('button', { name: 'Validate & preview', exact: true });
    const saveButton = page.getByRole('button', { name: 'Save mapping', exact: true });
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    async function checkReadableHistory(snapshot) {
      await dialog.getByRole('heading', { name: snapshot.config.name, exact: true }).waitFor();
      await dialog.getByText(`v${snapshot.version} · ${snapshot.enabled ? 'Enabled' : 'Draft'}`, { exact: true }).waitFor();
      assert.equal(await dialog.locator('pre').count(), 0, 'History must not show raw JSON');
      assert.equal(await dialog.getByRole('textbox').count(), 0, 'Saved mappings are read-only');
      const table = dialog.getByRole('table', { name: 'Saved field mappings', exact: true });
      const rows = table.locator(':scope > tbody > tr');
      assert.equal(await rows.count(), snapshot.config.fields.length);
      const labels = { copy: 'Copy value', uuid: 'Generate UUID', constant: 'Fixed value', lookup: 'Table lookup', valueMap: 'Value rules', uppercase: 'Uppercase text', lowercase: 'Lowercase text', trim: 'Trim text', number: 'Convert to number', boolean: 'Convert to boolean' };
      const modes = { always: 'Create & update', create: 'Create only', update: 'Update only' };
      for (const [index, rule] of snapshot.config.fields.entries()) {
        const cells = rows.nth(index).locator(':scope > td');
        assert.equal(await cells.nth(0).textContent(), ['constant', 'uuid'].includes(rule.transform) ? 'No source needed' : rule.source);
        assert.equal(await cells.nth(1).textContent(), rule.target);
        assert.equal(await cells.nth(2).textContent(), labels[rule.transform]);
        assert.equal(await cells.nth(3).textContent(), modes[rule.write || 'always']);
        if (rule.transform === 'constant') {
          const text = await cells.nth(4).textContent();
          assert.ok(text.includes(rule.value === '' ? '(empty text)' : String(rule.value)), text);
        }
      }
      const valueRules = dialog.getByRole('table', { name: 'Value rules for Status', exact: true });
      assert.equal(await valueRules.getByRole('row').count(), 7);
      await valueRules.getByText('Empty (null)', { exact: true }).waitFor();
      await valueRules.getByText('(empty text)', { exact: true }).waitFor();
      assert.equal(await valueRules.getByText('false', { exact: true }).count(), 1);
      assert.equal(await valueRules.getByText('0', { exact: true }).count(), 1);
      await table.getByText('Table: dbo.ItemGroups', { exact: true }).waitFor();
      await table.getByText('Match column: Code', { exact: true }).waitFor();
      await table.getByText('Return column: Name', { exact: true }).waitFor();
      await table.getByText('When no match: Stop with an error', { exact: true }).waitFor();
      await table.getByText('When no match: Send empty (null)', { exact: true }).waitFor();
      const filters = dialog.getByRole('table', { name: 'Saved source filters', exact: true });
      assert.equal(await filters.getByRole('row').count(), 5);
      await filters.getByText('false', { exact: true }).waitFor();
      await filters.getByText('0', { exact: true }).waitFor();
      await filters.getByText('(empty text)', { exact: true }).waitFor();
      await filters.getByText('Is empty (null)', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'SharePoint connection details', exact: true }).click();
      await dialog.getByText(`Site ID: ${snapshot.config.destination.siteId}`, { exact: true }).waitFor();
      await dialog.getByText(`List ID: ${snapshot.config.destination.listId}`, { exact: true }).waitFor();
    }
    let release;
    pendingResponse = new Promise(resolve => { release = resolve; });
    await previewButton.click();
    await dialog.getByText('Validating schema and previewing source records...').waitFor();
    assert.equal(await close.isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    release();
    await dialog.getByText('Read-only preview · up to 5 records').waitFor();
    assert.equal(await dialog.getByRole('columnheader', { name: 'On create', exact: true }).count(), 1);
    assert.equal(await dialog.getByRole('columnheader', { name: 'On update', exact: true }).count(), 1);
    await close.click();
    assert.equal(await page.getByText('Read-only preview · up to 5 records').count(), 0);
    pendingResponse = Promise.resolve();
    previewRows = [];
    await previewButton.click();
    await dialog.getByText('No source records match the filters.').waitFor();
    await close.click();
    previewRows = [{ key: 'ITEM-2', source: { ItemCode: 'ITEM-2' }, error: 'Lookup not found for ItemClass.' }];
    await previewButton.click();
    await dialog.getByText('Lookup not found for ItemClass.').waitFor();
    await close.click();
    previewError = true;
    await previewButton.click();
    await dialog.getByRole('alert').getByText('Source column no longer exists.').waitFor();
    assert.equal(await dialog.getByText('Lookup not found for ItemClass.').count(), 0);
    await close.click();
    console.log('Preview modal: loading, dismissal guard, payloads, empty results, row errors and request errors passed');

    await page.getByLabel('Mapping name', { exact: true }).fill('Updated modal check');
    pendingResponse = new Promise(resolve => { release = resolve; });
    await saveButton.click();
    await dialog.getByText('Saving mapping configuration...').waitFor();
    assert.equal(await close.isDisabled(), true);
    release();
    await dialog.getByRole('alert').getByText(/Saved version 1/).waitFor();
    assert.equal(saved[0].enabled, false);
    await close.click();
    await page.getByText('v1 · Draft', { exact: true }).waitFor();
    assert.equal(await saveButton.isDisabled(), true);
    pendingResponse = Promise.resolve();
    await page.getByLabel('Use saved mapping for sync').check();
    await saveButton.click();
    await dialog.getByRole('alert').getByText(/The next sync uses this mapping/).waitFor();
    assert.equal(saved[0].enabled, true);
    await close.click();
    await page.getByText('v2 · Enabled', { exact: true }).waitFor();
    await page.getByLabel('Mapping name', { exact: true }).fill('Unsaved conflict check');
    saveError = true;
    await saveButton.click();
    await dialog.getByRole('alert').getByText('Mapping was changed by another editor.').waitFor();
    assert.equal(saved[0].version, 2);
    await close.click();
    assert.equal(await saveButton.isEnabled(), true);
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'Unsaved conflict check');
    historyError = true;
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await dialog.getByText('History storage unavailable.').waitFor();
    historyError = false;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await checkReadableHistory(histories[1]);
    await dialog.getByRole('button', { name: 'Load older versions', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => /Loading older versions|Load older versions/.test(button.textContent)));
    detailError = true;
    await dialog.getByLabel('Saved version', { exact: true }).click();
    await page.getByRole('option', { name: /^v1 ·/ }).click();
    await dialog.getByText('Saved version could not be loaded.').waitFor();
    assert.equal(await dialog.getByRole('table', { name: 'Saved field mappings', exact: true }).count(), 0, 'Never display another version after a detail failure');
    detailError = false;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await checkReadableHistory(histories[0]);
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'History modal must fit narrow screens');
    const fieldTable = dialog.getByRole('table', { name: 'Saved field mappings', exact: true });
    assert.ok(await fieldTable.evaluate(table => table.parentElement.scrollWidth > table.parentElement.clientWidth), 'Wide mapping tables must scroll within the modal');
    await close.click();
    assert.equal(await page.getByLabel('Mapping name', { exact: true }).inputValue(), 'Unsaved conflict check');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(syncRequests.length, 0, 'Preview and save must not trigger a sync');
    console.log('Save modal: loading, draft/enabled success, conflict errors and preserved unsaved edits passed; no runtime errors or sync requests');
    console.log('History modal: readable current/older mappings, all transformations, write modes, scalar values, lookup/value rules, filters, paging, errors, retries and mobile layout passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
