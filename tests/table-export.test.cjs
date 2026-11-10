require('ts-node').register({ transpileOnly: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allColumnsCsv, collectExportRows, exportPage } = require('../../master-repo-ui/app/lib/tableExport');

test('CSV includes every field, including later-row-only fields; quoting and raw scalar values are preserved', () => {
  const csv = allColumnsCsv([
    { itemCode: 'I001', itemDescription: 'Bolt, "large"\r\nNext line', hiddenFlag: false, count: 0, empty: null },
    { itemCode: 'I002', itemDescription: '普通の項目', hiddenFlag: true, count: -5, extraColumn: 'later' },
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"itemCode","itemDescription","hiddenFlag","count","empty","extraColumn"\r\n'));
  assert.ok(csv.includes('"Bolt, ""large""\r\nNext line"'));
  assert.ok(csv.includes('"false","0","",""'));
  assert.ok(csv.includes('"普通の項目","true","-5","","later"'));
});
test('formula-like text is exported as literal text for spreadsheet applications', () => {
  const csv = allColumnsCsv([{ a: '=SUM(1,2)', b: ' +test', c: '@test', d: '\tcommand', e: '-text', numeric: -12 }]);
  for (const text of ["'=SUM(1,2)", "' +test", "'@test", "'\tcommand", "'-text"]) assert.ok(csv.includes(text));
  assert.ok(csv.includes('"-12"'));
});
test('export reads every page independently of the visible page and reports progress', async () => {
  const calls = [], progress = [];
  const data = Array.from({ length: 1003 }, (_, i) => ({ itemCode: `I${i}` }));
  const rows = await collectExportRows(async (page, limit) => {
    calls.push([page, limit]); return { rows: data.slice((page - 1) * limit, page * limit), page, limit, total: data.length };
  }, new AbortController().signal, (loaded, total) => progress.push([loaded, total]));
  assert.equal(rows.length, 1003); assert.equal(rows.at(-1).itemCode, 'I1002');
  assert.deepEqual(calls, [[1, 500], [2, 500], [3, 500]]);
  assert.deepEqual(progress, [[500, 1003], [1000, 1003], [1003, 1003]]);
});
test('empty results, nested response envelopes and backend page-size caps are handled', async () => {
  assert.equal(exportPage({ data: { data: [{ code: 'A' }], pagination: { total: 1 } } }).total, 1);
  assert.throws(() => exportPage({ data: [{ code: 'A' }] }), /complete export page/);
  const empty = await collectExportRows(async () => ({ rows: [], total: 0, limit: 500 }), new AbortController().signal, () => {});
  assert.deepEqual(empty, []);
  const calls = [];
  const result = await collectExportRows(async (page, limit) => {
    calls.push(limit); return { rows: [{ code: page }], total: 2, page, limit: 1 };
  }, new AbortController().signal, () => {});
  assert.deepEqual(calls, [500, 1]); assert.equal(result.length, 2);
});
test('changing totals, incomplete pages, read failures and cancellation never yield a partial result', async () => {
  const initial = { rows: [{ code: 1 }, { code: 2 }], total: 3, page: 1, limit: 2 };
  for (const second of [{ rows: [], total: 3, page: 2, limit: 2 }, { rows: [{ code: 3 }], total: 4, page: 2, limit: 2 }]) {
    await assert.rejects(collectExportRows(async page => page === 1 ? initial : second, new AbortController().signal, () => {}), /incomplete page/);
  }
  await assert.rejects(collectExportRows(async page => { if (page === 2) throw new Error('Source failed'); return initial; }, new AbortController().signal, () => {}), /Source failed/);
  const controller = new AbortController();
  await assert.rejects(collectExportRows(async () => { controller.abort(); return initial; }, controller.signal, () => {}), { name: 'AbortError' });
});
