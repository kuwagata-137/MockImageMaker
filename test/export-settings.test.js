'use strict';
// v1.04 の出力のテスト: 画面のページ（PNG は画像）に設定一覧を付けるかのチェックボックス（q164 案B。「出力するページ」の並びに置く）。
// 画面設計の出力の窓（PDF・PNG）・システム設計書の窓・AI の export_design と export_system_doc。
// jsdom では大きさを測れないので、設定一覧を次のページへ分ける画面（q138）は起きない。分けたページがなくなることは Chromium で確かめる（開発記録）。
// 画面設計の名前は架空の業務（出張申請）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { bootSystemDoc } = require('./system-doc-fixtures');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeExportAPI() {
  const calls = [];
  return {
    calls,
    saveHtml: async (p) => { calls.push(['saveHtml', p]); return { ok: true, path: '/tmp/' + p.name }; },
    savePdf: async (p) => { calls.push(['savePdf', p]); return { ok: true, path: '/tmp/' + p.name }; },
    savePng: async (p) => { calls.push(['savePng', p]); return { ok: true, count: p.files.length, path: '/tmp/x.png', dir: '/tmp' }; },
    openHtml: async () => ({ ok: false, canceled: true }),
  };
}

// 出張申請（一覧・詳細）。詳細に項目のアイテムを置き、一覧にボタンを置く（どちらの画面にも設定一覧の行がある）
async function boot(t) {
  const xapi = fakeExportAPI();
  const app = bootApp({ exportAPI: xapi });
  const api = await app.api();
  t.after(() => app.close());
  const A = api.actions.createDesign('出張申請', 'kintone');
  const d = () => api.store.state.designs.find((x) => x.id === A);
  const s1 = d().screens[0].id;
  api.actions.updateScreen(A, s1, { name: '一覧' });
  const s2 = api.actions.addScreen(A, 'blank', s1);
  api.actions.updateScreen(A, s2, { name: '詳細' });
  api.actions.addPart(A, s2, 'text1', { x: 40, y: 200 });
  const btn = api.actions.addPart(A, s1, 'button', { x: 40, y: 200 });
  api.actions.updatePart(A, s1, btn, { label: '詳細を見る' });
  const last = (kind) => xapi.calls.filter((c) => c[0] === kind).pop()[1];
  const pdfDoc = () => new app.window.DOMParser().parseFromString(last('savePdf').html, 'text/html');
  return { app, api, xapi, A, d, s1, s2, last, pdfDoc };
}
async function exportVia(app, api, designId, init = () => {}) {
  const done = api.openExportDialog(designId);
  await tick();
  init($(app, '.modal'));
  click($(app, '[data-dlg="ok"]'));
  await tick();
  return done;
}
// 表紙には見出し（.pg-head）がないので、見出しのあるページから選ぶ
const screenPages = (doc) => [...doc.querySelectorAll('body > .pg')].filter((p) => { const h = p.querySelector('.pg-head h2'); return !!h && /^\d+　/.test(h.textContent); });

test('出力の窓: 「出力するページ」の並びのいちばん後ろに「設定一覧」。既定は付ける（今までと同じ PDF）', async (t) => {
  const { app, api, A, pdfDoc } = await boot(t);
  await exportVia(app, api, A, (m) => {
    const x = m.querySelector('[data-xbox="pdf"] .xp-pages [data-xpage="settings"]');
    assert.ok(x, '設定一覧のチェックボックスがある');
    assert.equal(x.checked, true);
    assert.equal(x.disabled, false);
    assert.equal(x.closest('label').textContent, '設定一覧（画面のページに付ける表）');
    assert.equal([...m.querySelectorAll('[data-xbox="pdf"] [data-xpage]')].pop(), x, 'いちばん後ろ');
  });
  const pages = screenPages(pdfDoc());
  assert.equal(pages.length, 2);
  pages.forEach((p) => assert.ok(p.querySelector('.ptable'), '画面のページに設定一覧がある'));
});

test('出力の窓: 設定一覧を外すと、PDF の画面のページは画面と吹き出しだけ（ページの数は同じか減る）。外した設定はアプリを閉じるまで覚える', async (t) => {
  const { app, api, A, pdfDoc } = await boot(t);
  const before = api.exportDocument(api.store.state.designs.find((x) => x.id === A), api.store.state, { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true }).total;
  await exportVia(app, api, A, (m) => { m.querySelector('[data-xbox="pdf"] [data-xpage="settings"]').checked = false; });
  const doc = pdfDoc();
  const pages = screenPages(doc);
  assert.deepEqual(plain(pages.map((p) => p.querySelector('.pg-head h2').textContent)), ['1　一覧', '2　詳細']);
  pages.forEach((p) => assert.equal(p.querySelector('.ptable'), null, '設定一覧がない'));
  assert.equal(doc.body.textContent.includes('設定一覧は次のページ'), false);
  assert.ok(doc.querySelectorAll('body > .pg').length <= before);
  assert.equal(api.exportOpts.settings, false, '覚える');
  // 次に開いたときも外れている。PNG の箱のチェックボックスも同じ設定
  const again = api.openExportDialog(A);
  await tick();
  assert.equal($(app, '[data-xbox="pdf"] [data-xpage="settings"]').checked, false);
  assert.equal($(app, '[data-xbox="png"] [data-xpage="settings"]').checked, false);
  click($(app, '[data-dlg="cancel"]'));
  assert.equal(await again, null);
});

test('出力の窓: PNG にも「設定一覧」のチェックボックス。外すと画像は画面と吹き出しだけ（画像が小さくなる）', async (t) => {
  const { app, api, A, xapi, last } = await boot(t);
  await exportVia(app, api, A, (m) => { click(m.querySelector('[data-xkind="png"]')); });
  const withTable = last('savePng').files;
  assert.ok(withTable.every((f) => /class="ptable/.test(f.html)), '既定は付ける');
  await exportVia(app, api, A, (m) => {
    click(m.querySelector('[data-xkind="png"]'));
    const x = m.querySelector('[data-xbox="png"] [data-xpage="settings"]');
    assert.equal(x.closest('label').textContent, '設定一覧（画面の画像に付ける表）');
    x.checked = false;
  });
  const bare = last('savePng').files;
  assert.equal(xapi.calls.filter((c) => c[0] === 'savePng').length, 2);
  assert.ok(bare.every((f) => !/class="ptable/.test(f.html)), '設定一覧がない');
  bare.forEach((f, i) => assert.ok(f.width < withTable[i].width, `${f.name} の幅が狭くなる`));
  assert.equal(api.exportOpts.settings, false);
});

test('出力の窓: HTML を出力しても、設定一覧の覚えた設定は変わらない', async (t) => {
  const { app, api, A } = await boot(t);
  await exportVia(app, api, A, (m) => { m.querySelector('[data-xbox="pdf"] [data-xpage="settings"]').checked = false; });
  await exportVia(app, api, A, (m) => { click(m.querySelector('[data-xkind="html"]')); });
  assert.equal(api.exportOpts.settings, false);
});

test('exportDocument: settings を false にすると included.settings が false。省略は付ける', async (t) => {
  const { api, d } = await boot(t);
  const opts = { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true };
  const on = api.exportDocument(d(), api.store.state, opts);
  const off = api.exportDocument(d(), api.store.state, { ...opts, settings: false });
  assert.equal(on.included.settings, true);
  assert.equal(off.included.settings, false);
  assert.match(on.html, /class="ptable/);
  assert.doesNotMatch(off.html, /class="ptable/);
  assert.equal(off.total, on.total);
});

test('AI の export_design: settings で設定一覧を外す（PDF・PNG。既定は付ける）。返事に settings を書く', async (t) => {
  const { api, A } = await boot(t);
  const call = async (tool, args) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const pdf = await call('export_design', { design: A, format: 'pdf' });
  assert.equal(pdf.result.settings, true);
  assert.match(pdf.render.files[0].html, /class="ptable/);
  const bare = await call('export_design', { design: A, format: 'pdf', settings: false });
  assert.equal(bare.result.settings, false);
  assert.doesNotMatch(bare.render.files[0].html, /class="ptable/);
  const png = await call('export_design', { design: A, format: 'png', settings: false });
  assert.equal(png.result.settings, false);
  assert.ok(png.render.files.every((f) => !/class="ptable/.test(f.html)));
  assert.equal((await call('export_design', { design: A, format: 'png' })).result.settings, true);
});

test('システム設計書の窓: 「画面設計ごと」の並びのいちばん後ろに「設定一覧」。外すと、どの画面設計の画面のページにも設定一覧がない。覚える', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api, sysId } = await bootSystemDoc(t, { exportAPI: xapi });
  const done = api.openSystemDocDialog(sysId);
  await tick();
  const boxes = [...app.document.querySelectorAll('.modal [data-dpage]')];
  const x = boxes.pop();
  assert.equal(x.dataset.dpage, 'settings');
  assert.equal(x.checked, true);
  assert.equal(x.closest('label').textContent, '設定一覧（画面のページに付ける表）');
  x.checked = false;
  click($(app, '[data-dlg="ok"]'));
  await done;
  await new Promise((r) => setTimeout(r, 20));
  const html = xapi.calls.filter((c) => c[0] === 'savePdf').pop()[1].html;
  assert.doesNotMatch(html, /class="ptable/);
  assert.match(html, /出張申請/);
  assert.equal(api.docOpts.settings, false);
});

test('AI の export_system_doc: settings で設定一覧を外す（既定は付ける）。画面設計ごとの included に settings', async (t) => {
  const { api } = await bootSystemDoc(t);
  const call = async (tool, args) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const on = await call('export_system_doc', { system: '出張申請システム' });
  assert.ok(on.result.designs.every((r) => r.included.settings === true));
  assert.match(on.render.files[0].html, /class="ptable/);
  const off = await call('export_system_doc', { system: '出張申請システム', settings: false });
  assert.ok(off.result.designs.every((r) => r.included.settings === false));
  assert.doesNotMatch(off.render.files[0].html, /class="ptable/);
  assert.equal(off.result.pages, on.result.pages, 'jsdom では設定一覧を分けないので、ページ数は同じ');
});
