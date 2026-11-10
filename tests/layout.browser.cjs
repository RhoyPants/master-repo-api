// Responsive layout check with fixed API metadata; no database or SharePoint writes.
require('dotenv').config({ quiet: true });
require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.MAPPING_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'master-repo-mapping-browser/node_modules/playwright-core'));
const { defaultMappings } = require('../src/modules/mappings/defaults');
const { parseConfig } = require('../src/modules/mappings/domain');
let browser, page;
(async () => {
  try {
    const user = { id: 1, name: 'Layout Check', email: 'layout@example.test', role: 'viewer' };
    const token = 'layout-fixture';
    const defaults = defaultMappings();
    const mapping = defaults.find(m => m.module === 'item');
    for (let index = mapping.fields.length; index < 40; index++) {
      mapping.fields.push({ source: 'ItemCode', target: `ExtraField${index}`, transform: 'copy' });
    }
    const saved = [];
    const columnNames = [...new Set([mapping.source.key, ...mapping.source.filters.map(f => f.column), ...mapping.fields.filter(f => f.source).map(f => f.source)])];
    browser = await chromium.launch({ executablePath: process.env.MAPPING_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.route(url => ['/api/', '/data/', '/sync/'].some(prefix => url.pathname.startsWith(prefix)), route => {
      const url = new URL(route.request().url());
      let data = { data: [], total: 0, page: 1, limit: 20 };
      if (url.pathname === '/api/mappings/sharepoint') data = { saved, defaults };
      else if (url.pathname === '/api/mappings/sharepoint/item' && route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        data = { ...body, version: body.version + 1, updatedBy: user.email, updatedAt: new Date().toISOString() };
        saved.splice(0, saved.length, data);
      }
      else if (url.pathname === '/api/mappings/sharepoint/lists') data = defaults.map(m => ({ id: m.destination.listId, displayName: m.name }));
      else if (url.pathname === '/api/mappings/tables') data = ['Items', 'ItemClasses', 'ItemGroups'].map(name => ({ id: `dbo.${name}`, schema: 'dbo', name }));
      else if (url.pathname === '/api/mappings/columns') data = columnNames.map(name => ({ name, type: 'nvarchar', nullable: true }));
      else if (url.pathname === '/api/mappings/sharepoint/columns') data = [...new Set(mapping.fields.map(f => f.target))].map(name => ({ name, displayName: name, type: ['LeadTime', 'iswhInventory', 'isModified'].includes(name) ? 'number' : 'text', required: false, readOnly: false, supported: true }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() === 'POST' && /\/run(?:\/|$)/.test(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(({ user, token }) => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', token); }, { user, token });
    await page.goto('http://127.0.0.1:5173/sharepoint-mapping');
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'View JSON', exact: true }).count(), 0, 'Technical tools should not clutter the main toolbar');
    const measure = () => page.evaluate(() => {
      const main = document.querySelector('main');
      const header = document.querySelector('header');
      const table = document.querySelector('table[aria-label="Field mappings"]');
      const bounds = table?.parentElement.getBoundingClientRect();
      const visibleRows = table ? [...table.querySelectorAll('tbody tr')].filter(row => { const r = row.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= Math.min(bounds.bottom, innerHeight); }).length : 0;
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, headerTop: header.getBoundingClientRect().top, visibleRows };
    });
    for (const [width, height] of [[1600, 1000], [1280, 800], [900, 700], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const dimensions = await measure();
      assert.ok(dimensions.documentWidth <= width + 1, `Page overflows at ${width}px`);
      assert.ok(dimensions.mainScrollWidth <= dimensions.mainWidth + 1, `Workspace clips content at ${width}px`);
      assert.ok(dimensions.mainWidth >= width - 20, `Sidebar or width cap still consumes workspace at ${width}px`);
      assert.equal(dimensions.headerTop, 0);
      if (width >= 1280) assert.ok(dimensions.visibleRows >= 6, `Too few field rows visible at ${width}px: ${dimensions.visibleRows}`);
      console.log(`${width}×${height}: no page overflow, full-width workspace, ${dimensions.visibleRows} visible mapping rows`);
      if (width === 1280) await page.screenshot({ path: path.join(os.tmpdir(), 'master-repo-mapping-dense-1280.png') });
      const table = page.getByRole('table', { name: 'Field mappings', exact: true });
      const verticalOverflow = await table.evaluate(table => table.parentElement.scrollHeight - table.parentElement.clientHeight);
      assert.ok(verticalOverflow <= 1, `Field mappings must not have an internal vertical scrollbar at ${width}px`);
      if (width >= 900) {
        const horizontalOverflow = await table.evaluate(table => table.parentElement.scrollWidth - table.parentElement.clientWidth);
        assert.ok(horizontalOverflow <= 1, `Field mappings must not have an unnecessary horizontal scrollbar at ${width}px: ${horizontalOverflow}px overflow`);
        assert.ok(await table.evaluate(table => [...table.querySelectorAll('tbody button')].every(button => button.getBoundingClientRect().right <= table.parentElement.getBoundingClientRect().right)), 'Row actions must remain inside the table without clipping');
      }
      const tableBounds = await table.boundingBox(), addBounds = await page.getByRole('button', { name: 'Add field', exact: true }).boundingBox();
      assert.ok(addBounds.y >= tableBounds.y + tableBounds.height, 'Add field must be below all mapping rows');
      await page.locator('main').evaluate(async main => {
        main.scrollTop = main.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const mainBounds = await page.locator('main').boundingBox();
      const toolbarBounds = await page.getByRole('toolbar', { name: 'Mapping actions', exact: true }).boundingBox();
      assert.ok(Math.abs(toolbarBounds.y - mainBounds.y) <= 1, `Mapping toolbar must remain pinned below the header at ${width}px: toolbar top ${toolbarBounds.y}, workspace top ${mainBounds.y}`);
      for (const name of ['Validate & preview', 'Save mapping', 'More actions']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(bounds.y >= mainBounds.y && bounds.y + bounds.height <= mainBounds.y + mainBounds.height, `${name} must stay visible after scrolling at ${width}px`);
      }
      if (width === 1280) await page.screenshot({ path: path.join(os.tmpdir(), 'master-repo-mapping-sticky-1280.png') });
      await page.locator('main').evaluate(main => { main.scrollTop = 0; });
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    const fieldTable = page.getByRole('table', { name: 'Field mappings', exact: true });
    const rows = fieldTable.locator(':scope > tbody > tr');
    const originalRows = await rows.count();
    await page.getByRole('button', { name: 'Add field', exact: true }).click();
    assert.equal(await rows.count(), originalRows + 1);
    await rows.last().getByRole('button', { name: 'Remove field mapping', exact: true }).click();
    assert.equal(await rows.count(), originalRows);
    const editedIndex = mapping.fields.findIndex(field => field.source && field.transform === 'uppercase');
    await rows.nth(editedIndex).getByLabel('Rule', { exact: true }).click();
    await page.getByRole('option', { name: 'Trim text', exact: true }).click();
    await page.locator('main').evaluate(main => { main.scrollTop = main.scrollHeight; });
    await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
    await page.getByRole('dialog').getByText(/Saved version 1/).waitFor();
    assert.equal(saved[0].config.fields[editedIndex].transform, 'trim');
    parseConfig(saved[0].config);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    console.log('Bottom Add field, full-height table, sticky actions and saving from the bottom passed');
    await page.getByRole('button', { name: 'Configure Status rule', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByLabel('When source is').count(), 4);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Master Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Warehouses', exact: true }).click();
    await page.getByRole('heading', { name: 'Warehouses', exact: true }).waitFor();
    let dimensions = await measure();
    assert.ok(dimensions.mainScrollWidth <= dimensions.mainWidth + 1);
    await page.getByRole('button', { name: 'Mappings', exact: true }).click();
    await page.getByRole('menuitem', { name: 'SharePoint Mapping', exact: true }).click();
    await page.getByRole('heading', { name: 'SharePoint Mapping', exact: true }).waitFor();
    await page.getByText(/Loaded \d+ source columns and \d+ SharePoint columns/).waitFor();
    await page.locator('main').evaluate(main => { main.scrollTop = 500; });
    assert.equal((await measure()).headerTop, 0);
    assert.equal(errors.length, 0, errors.join('\n')); assert.equal(writes.length, 0);
    console.log('Header menus, transformation dialog, fixed header and data-page navigation passed; no syncs triggered');
  } catch (error) {
    console.error(error.message);
    if (page && !page.isClosed()) console.error({ url: page.url(), headings: await page.getByRole('heading').allTextContents(), alerts: await page.getByRole('alert').allTextContents() });
    process.exitCode = 1;
  }
  finally { if (browser) await browser.close(); }
})();
