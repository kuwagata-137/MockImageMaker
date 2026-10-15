'use strict';
// 書き出しと受け渡し（第 5 段階）のテスト。書き出しの窓、PDF・PNG にするページ（表紙・つながりの図・項目の一覧表・画面）、
// 単体で開いて編集できる HTML（書き出し・単体で開いたとき・保存し直す）、HTML の取り込み（確かめの窓・置き換え・足す）。
// jsdom では要素の大きさを測れないので、ページの縮め方と表の分け方は tools/shoot-app.js（--only=export）と tools/check-export.js で確かめる。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bootApp, waitFor, createMainStorage, ROOT, HTML_NAME } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const STORAGE_KEY = 'mockimagemaker.v1';
// Windows の作業フォルダでは改行が CRLF になる（core.autocrlf）。HTML の解析は改行を LF にそろえるので、比べる側もそろえる
const ORIGINAL = fs.readFileSync(path.join(ROOT, HTML_NAME), 'utf8').replace(/\r\n/g, '\n');

// ── 見本（架空の業務）──
const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId) => ({ id, type: 'text1', x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const design = (id, name, target, extra = {}) => ({
  id, name, target, description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: null, revisions: [], items: [], screens: [screen('s-' + id, '一覧')], mapPos: {}, ...extra,
});
function sampleState() {
  return {
    schemaVersion: 2,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d1', '顧客管理', 'kintone', {
        description: '取引先と顧客の連絡先を管理する。',
        updatedAt: '2026-10-05T00:00:00.000Z',
        items: [
          item('i1', '顧客コード', 'text1', { required: true }),
          item('i2', '取引先コード', 'text1', { lookup: { db: { designId: 'd3', name: '取引先マスタ（古い名前）', free: false }, key: { itemId: 'b1', name: '取引先コード' }, copies: [{ from: { itemId: 'b2', name: '取引先名' }, to: { itemId: 'i3', name: '取引先名' } }] } }),
          item('i3', '取引先名', 'text1'),
          item('i4', '郵便番号', 'text1', { link: { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false } }),
        ],
        screens: [
          screen('s1', '詳細', [ipart('p1', 32, 112, 1, 'i1'), ipart('p2', 32, 200, 2, 'i2'), ipart('p3', 32, 288, 3, 'i3'), ipart('p4', 400, 112, 4, 'i4')], {
            callouts: [{ id: 'k1', x: 1300, y: 100, w: 200, h: 80, text: '取引先コードで取引先名を引く。', color: 'yellow', tip: 'arrow', target: 'p2' }],
          }),
          screen('s2', '新規登録', [ipart('p5', 32, 112, 1, 'i1')]),
        ],
      }),
      design('d2', '住所の共通項目', 'その他の作る先', { items: [item('a1', '郵便番号', 'text1', { props: { maxLen: '8' } })] }),
      design('d3', '取引先マスタ', 'kintone', { items: [item('b1', '取引先コード', 'text1'), item('b2', '取引先名', 'text1')] }),
      design('d4', '受注管理', 'kintone', {
        items: [item('e1', '顧客コード', 'text1', { lookup: { db: { designId: 'd1', name: '顧客管理', free: false }, key: { itemId: 'i1', name: '顧客コード' }, copies: [] } })],
      }),
    ],
  };
}

// 書き出しの窓口の身代わり（デスクトップ版のとき）。呼ばれた中身を calls に残す
function fakeExportAPI(result = {}) {
  const calls = [];
  return {
    calls,
    saveHtml: async (p) => { calls.push(['saveHtml', p]); return { ok: true, path: '/tmp/' + p.name, ...result }; },
    savePdf: async (p) => { calls.push(['savePdf', p]); return { ok: true, path: '/tmp/' + p.name, ...result }; },
    savePng: async (p) => { calls.push(['savePng', p]); return { ok: true, count: p.files.length, path: '/tmp/' + p.files[0].name, dir: '/tmp', ...result }; },
    openHtml: async () => { calls.push(['openHtml']); return result.openHtml || { ok: false, canceled: true }; },
  };
}

async function bootSample(t, { exportAPI = null, state = sampleState(), storage = null } = {}) {
  const app = bootApp({ exportAPI, storage, localStorage: storage ? null : { [STORAGE_KEY]: JSON.stringify(state) } });
  const api = await app.api();
  t.after(() => app.close());
  return { app, api };
}

// 書き出しの窓を開き、init(m) で窓を操作してから「書き出す…」を押す。戻り値は書き出しの結果
async function exportVia(app, api, designId, init = () => {}) {
  const done = api.openExportDialog(designId);
  await tick();
  const m = $(app, '.modal');
  assert.ok(m, '書き出しの窓が開く');
  init(m);
  click($(app, '[data-dlg="ok"]'));
  return done;
}

// 単体で開いて編集できる HTML を作る（書き出しの窓で HTML を選ぶ）
async function exportHtmlText(t, state = sampleState(), designId = 'd1') {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi, state });
  await exportVia(app, api, designId, (m) => click(m.querySelector('[data-xkind="html"]')));
  const call = xapi.calls.find((c) => c[0] === 'saveHtml');
  assert.ok(call, 'saveHtml が呼ばれる');
  return { html: call[1].html, name: call[1].name, app, api };
}

// 起動済みのアプリ（ブラウザで開いたとき）から、書き出しの窓で HTML を書き出して、その文字を返す
async function exportHtmlTextFrom(app, api, designId = 'd1') {
  const written = [];
  app.window.showSaveFilePicker = async (opts) => ({ name: opts.suggestedName, createWritable: async () => ({ write: async (s) => written.push(s), close: async () => {} }) });
  await exportVia(app, api, designId);
  return written[0];
}

async function bootStandalone(t, html) {
  const app = bootApp({ html, url: 'https://localhost/vendor/%E9%A1%A7%E5%AE%A2%E7%AE%A1%E7%90%86.html' });
  const api = await app.api();
  t.after(() => app.close());
  return { app, api };
}

// ── 書き出しの窓 ──
test('書き出しの窓: メニューバー・カードの「…」・アプリのメニューから開き、PDF・HTML・PNG を選ぶ。最初は PDF・A4 横・ページは全部', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  // カードの「…」
  click($(app, '.card-more[data-id="d1"]'));
  assert.ok($(app, '.card-menu [data-action="export-design"]'), 'カードの「…」に「書き出す…」');
  click($(app, '.card-menu [data-action="export-design"]'));
  await tick();
  assert.equal($(app, '.modal h2').textContent, '「顧客管理」を書き出す');
  assert.deepEqual($$(app, '.xp-kind').map((b) => [b.dataset.xkind, b.disabled]), [['pdf', false], ['html', false], ['png', false]]);
  assert.equal($(app, '.xp-kind.on').dataset.xkind, 'pdf');
  assert.equal($(app, '[name="xp-paper"]:checked').value, 'A4');
  assert.equal($(app, '[name="xp-orient"]:checked').value, 'landscape');
  assert.deepEqual($$(app, '[data-xbox="pdf"] [data-xpage]').map((x) => [x.dataset.xpage, x.checked, x.disabled]),
    [['cover', true, false], ['map', true, false], ['items', true, false], ['process', false, true], ['flow', false, true]], '操作も移る先もないので、ステータスの移り方と画面の移り方は押せない');
  assert.equal($$(app, '[data-xbox="pdf"] [data-xscreen]:checked').length, 2, '画面は全部選んである');
  // 札を押すと、その形の設定だけが出る
  click($(app, '[data-xkind="png"]'));
  assert.deepEqual($$(app, '[data-xbox]').map((b) => [b.dataset.xbox, b.hidden]), [['pdf', true], ['html', true], ['png', false]]);
  click($(app, '[data-dlg="cancel"]'));
  await tick();
  assert.equal($(app, '.modal'), null);
  // メニューバーとアプリのメニュー（開いている画面設計を書き出す）
  api.openDesign('d1');
  assert.ok($(app, '#toolbar [data-action="export"]'), 'メニューバーの「ファイル」に「書き出す」');
  click($(app, '#toolbar [data-action="export"]'));
  await tick();
  assert.ok($(app, '.modal .xp-kinds'), 'メニューバーから開く');
  click($(app, '[data-dlg="cancel"]'));
  await tick();
  api.runCommand('exportDialog');
  await tick();
  assert.ok($(app, '.modal .xp-kinds'), 'アプリのメニューの命令で開く');
  click($(app, '[data-dlg="cancel"]'));
});

test('書き出しの窓: つながりがない・項目がないときは、そのページのチェックを外して押せない。スライドは横だけ。選んだ設定はアプリを閉じるまで覚える', async (t) => {
  const state = sampleState();
  state.designs.push(design('d9', '日報', 'kintone'));
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi, state });
  const done = api.openExportDialog('d9');
  await tick();
  assert.deepEqual($$(app, '[data-xbox="pdf"] [data-xpage]').map((x) => [x.dataset.xpage, x.checked, x.disabled]),
    [['cover', true, false], ['map', false, true], ['items', false, true], ['process', false, true], ['flow', false, true]]);
  assert.match($(app, '[data-xbox="pdf"]').textContent, /つながりがないので、出しません/);
  click($(app, '[name="xp-paper"][value="slide"]'));
  $(app, '[name="xp-paper"][value="slide"]').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.ok($$(app, '[name="xp-orient"]').every((x) => x.disabled), 'スライドのときは向きを選べない');
  assert.equal($(app, '[name="xp-orient"]:checked').value, 'landscape');
  click($(app, '[name="xp-paper"][value="A3"]'));
  $(app, '[name="xp-paper"][value="A3"]').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  click($(app, '[name="xp-orient"][value="portrait"]'));
  click($(app, '[data-dlg="ok"]'));
  await done;
  const pdf = xapi.calls.find((c) => c[0] === 'savePdf')[1];
  assert.deepEqual([pdf.pageSize.width.toFixed(2), pdf.pageSize.height.toFixed(2)], ['11.69', '16.54'], 'A3 縦（インチ）');
  // 覚えている（項目のある画面設計を開いても、選んだ用紙と向き）
  const again = api.openExportDialog('d1');
  await tick();
  assert.equal($(app, '[name="xp-paper"]:checked').value, 'A3');
  assert.equal($(app, '[name="xp-orient"]:checked').value, 'portrait');
  assert.deepEqual($$(app, '[data-xbox="pdf"] [data-xpage]').map((x) => x.checked), [true, true, true, false, false], '押せなかったチェックは前の設定のまま');
  click($(app, '[data-dlg="cancel"]'));
  assert.equal(await again, null);
});

test('書き出しの窓: ブラウザで開いたアプリでは PDF・PNG は選べず（デスクトップ版だけ）、HTML を選んだ形で開く', async (t) => {
  const { app, api } = await bootSample(t);
  const done = api.openExportDialog('d1');
  await tick();
  assert.deepEqual($$(app, '.xp-kind').map((b) => [b.dataset.xkind, b.disabled]), [['pdf', true], ['html', false], ['png', true]]);
  assert.equal($(app, '.xp-kind.on').dataset.xkind, 'html');
  assert.match($(app, '[data-xkind="pdf"]').textContent, /デスクトップ版/);
  // ブラウザでは保存の窓（showSaveFilePicker）で書く
  const written = [];
  app.window.showSaveFilePicker = async (opts) => ({ name: opts.suggestedName, createWritable: async () => ({ write: async (s) => written.push(s), close: async () => {} }) });
  click($(app, '[data-dlg="ok"]'));
  const res = await done;
  assert.equal(res.ok, true);
  assert.equal(written.length, 1);
  assert.match(written[0], /id="mim-embedded"/);
});

test('書き出しの窓: 画面を全部外して PNG は書き出せない。PDF もページが 1 つもなければ書き出せない', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const done = api.openExportDialog('d1');
  await tick();
  click($(app, '[data-xkind="png"]'));
  click($(app, '[data-xbox="png"] [data-xall="0"]'));
  click($(app, '[data-dlg="ok"]'));
  assert.match($(app, '.modal-error').textContent, /画面を 1 つ以上/);
  click($(app, '[data-xkind="pdf"]'));
  click($(app, '[data-xbox="pdf"] [data-xall="0"]'));
  $$(app, '[data-xbox="pdf"] [data-xpage]').forEach((x) => { x.checked = false; });
  click($(app, '[data-dlg="ok"]'));
  assert.match($(app, '.modal-error').textContent, /1 つ以上選んで/);
  click($(app, '[data-dlg="cancel"]'));
  assert.equal(await done, null);
  assert.equal(xapi.calls.length, 0);
});

// ── PDF・PNG のページ ──
test('PDF: 表紙・つながりの図・項目の一覧表・画面の順のページ。ページ番号・用紙の大きさ（@page とインチ）・書いたら開く', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const res = await exportVia(app, api, 'd1');
  assert.equal(res.ok, true);
  const pdf = xapi.calls.find((c) => c[0] === 'savePdf')[1];
  assert.equal(pdf.name, '顧客管理.pdf');
  assert.equal(pdf.open, true);
  assert.deepEqual([pdf.pageSize.width.toFixed(3), pdf.pageSize.height.toFixed(3)], ['11.693', '8.268'], 'A4 横（インチ）');
  assert.match(pdf.html, /@page\{size:297\.000mm 210\.000mm;margin:0\}/);
  assert.match(pdf.html, /<body class="xp-doc">/);
  const doc = new app.window.DOMParser().parseFromString(pdf.html, 'text/html');
  const pages = [...doc.querySelectorAll('body > .pg')];
  assert.equal(pages.length, 5, '表紙・図・表・画面 2 つ');
  assert.equal(pages[0].querySelector('.cv-title').textContent, '顧客管理');
  assert.match(pages[0].textContent, /全 5 ページ/);
  assert.match(pages[0].textContent, /まだ改訂履歴はありません/);
  assert.deepEqual([...pages[0].querySelectorAll('.cv-list tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
    [['つながりの図', '', '2'], ['データベースの項目の一覧表', '', '3'], ['1　詳細', 'パソコン', '4'], ['2　新規登録', 'パソコン', '5']]);
  assert.equal(pages[1].querySelector('.pg-head h2').textContent, 'つながりの図');
  assert.equal(pages[1].querySelectorAll('.mnode').length, 4, 'この画面設計と、直接つながる 3 つ');
  assert.equal(pages[2].querySelector('.pg-head h2').textContent, 'データベースの項目の一覧表');
  assert.deepEqual([...pages[2].querySelectorAll('.xp-itable thead th')].map((th) => th.textContent), ['項目名', '部品の種類', '設定', 'ルックアップ元・取り込み元', '置いている画面']);
  const rows = [...pages[2].querySelectorAll('.xp-itable tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent));
  assert.equal(rows.length, 4);
  assert.match(rows[1][3], /ルックアップ：取引先マスタ › 取引先コード/);
  assert.match(rows[3][3], /取り込み：住所の共通項目 › 郵便番号/);
  assert.deepEqual(rows.map((r) => r[4]), ['詳細・新規登録', '詳細', '詳細', '詳細']);
  assert.equal(pages[3].querySelector('.pg-head h2').textContent, '1　詳細');
  assert.match(pages[3].querySelector('.pg-head span').textContent, /パソコン・1280 × 800/);
  assert.deepEqual([...pages[3].querySelectorAll('.pg-foot span')].map((s) => s.textContent), ['顧客管理 ／ 1　詳細', '4 / 5']);
  assert.ok(pages[3].querySelector('.screen'), '画面');
  assert.ok(pages[3].querySelector('.callout.cc-yellow'), '吹き出し');
  assert.ok(pages[3].querySelector('.ptable'), '部品の設定の一覧表');
  assert.equal(pages[0].querySelector('.pg-foot'), null, '表紙には下の端の行を出さない');
});

test('PDF: 編集の画面だけの印（札・マス目・一覧表の案内・つまみ・選んだ印・吹き出しの範囲・押したときの動き）を出さず、矢印の印の id はページごとに別', async (t) => {
  const state = sampleState();
  // 項目を消した後に残った部品（編集の画面では札が付く）と、番号のない画面（一覧表の案内）
  state.designs[0].screens[1].parts.push({ id: 'p9', type: 'text1', x: 400, y: 112, w: 320, h: 64, no: null, labelPos: 'top', sample: '', placeholder: '', itemId: null, label: '消した項目', required: false, memo: '', props: {} });
  state.designs[0].screens.push(screen('s3', '白紙'));
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi, state });
  api.openDesign('d1');
  api.selectPart('p1'); // 編集の画面で選んでいても、書き出しには選んだ印を出さない
  await exportVia(app, api, 'd1');
  const { html } = xapi.calls.find((c) => c[0] === 'savePdf')[1];
  const body = html.slice(html.indexOf('<body'));
  for (const mark of ['class="tag', 'screen grid', 'ptable-empty', 'data-action', 'co-handle', 'class="grip', 'co-zone', 'screen-resize', 'part sel', ' sel"']) {
    assert.ok(!body.includes(mark), `書き出しに「${mark}」がない`);
  }
  const doc = new app.window.DOMParser().parseFromString(html, 'text/html');
  const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length, 'id が重ならない');
  assert.ok(!ids.some((id) => /^co-arrow-|^map-arrow-|^co-lines$|^map-inner$/.test(id)), '編集の画面と同じ id を使わない');
  assert.ok(ids.some((id) => /^p4-co-arrow-yellow$/.test(id)), '4 ページ目の吹き出しの矢印の印');
  const line = doc.querySelector('.pg:nth-of-type(4) line[marker-end]');
  assert.equal(line.getAttribute('marker-end'), 'url(#p4-co-arrow-yellow)');
  // 番号のない画面には一覧表を出さない
  const last = [...doc.querySelectorAll('body > .pg')].pop();
  assert.equal(last.querySelector('.ptable'), null);
});

test('PDF: 用紙は A4・A3 の縦横とスライド（16:9）。外したページは入らず、ページ番号も詰まる', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const doc = (opts) => api.exportDocument(api.store.state.designs.find((d) => d.id === 'd1'), api.store.state, { cover: true, map: true, items: true, ...opts });
  assert.deepEqual(plain(api.paperSize('A4', 'landscape')).w, 1122);
  assert.deepEqual([api.paperSize('A4', 'landscape').h, api.paperSize('A4', 'portrait').w, api.paperSize('A4', 'portrait').h], [792, 793, 1121]);
  assert.deepEqual([api.paperSize('A3', 'landscape').w, api.paperSize('A3', 'landscape').h], [1587, 1121]);
  assert.deepEqual([api.paperSize('slide', 'portrait').w, api.paperSize('slide', 'portrait').h, api.paperSize('slide').landscape], [1280, 719, true], 'スライドは横だけ');
  assert.match(doc({ paper: 'slide' }).html, /@page\{size:338\.667mm 190\.500mm;margin:0\}/);
  assert.match(doc({ paper: 'A3', orient: 'portrait' }).html, /@page\{size:297\.000mm 420\.000mm;margin:0\}/);
  const a = doc({ paper: 'A4', cover: false, map: false });
  assert.equal(a.total, 3, '表の 1 ページと画面 2 つ');
  assert.match(a.pages[0], /データベースの項目の一覧表/);
  assert.match(a.pages[2], /3 \/ 3/);
  const b = doc({ paper: 'A4', items: false, screenIds: ['s2'] });
  assert.equal(b.total, 3, '表紙・図・新規登録');
  assert.match(b.pages[0], /2　新規登録/);
  assert.ok(!b.pages[0].includes('1　詳細'), '書き出さない画面は表紙の一覧にも出さない');
});

test('PNG: 選んだ画面ごとに 1 枚。ファイルの名前は「顧客管理_01_詳細.png」で、使えない字は「_」にする', async (t) => {
  const state = sampleState();
  state.designs[0].screens[1].name = '新規/登録?';
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi, state });
  await exportVia(app, api, 'd1', (m) => click(m.querySelector('[data-xkind="png"]')));
  const { files } = xapi.calls.find((c) => c[0] === 'savePng')[1];
  assert.deepEqual(plain(files.map((f) => f.name)), ['顧客管理_01_詳細.png', '顧客管理_02_新規_登録_.png']);
  assert.ok(files.every((f) => f.width > 1280 && f.height > 800 && /<body class="xp-doc">/.test(f.html) && !f.html.slice(f.html.indexOf('<body')).includes('data-action')));
  assert.ok(files[0].html.includes('class="callout cc-yellow"'), '吹き出しも入る');
  assert.equal(api.safeFileName(' a<b>:c. '), 'a_b__c');
});

// ── HTML の書き出しと、単体で開いたとき ──
test('HTML の書き出し: アプリと同じ骨組みに、画面設計を埋め込む（script の文字はファイルと同じ。名前はほかのアプリと別）', async (t) => {
  const { html, name, api } = await exportHtmlText(t);
  assert.equal(name, '顧客管理.html');
  assert.equal(api.appScript().length > 1000, true);
  // 埋め込みの行を除き、題名を戻すと、アプリの HTML と同じになる（骨組み・style・script がファイルと同じ）
  const back = html.replace(/<script type="application\/json" id="mim-embedded">[^\n]*<\/script>\n/, '').replace('<title>顧客管理</title>', '<title>モックイメージメーカー</title>');
  assert.equal(back, ORIGINAL);
  const json = html.match(/id="mim-embedded">([^\n]*)<\/script>/)[1];
  assert.ok(!json.includes('<'), '「<」は逃がしてある');
  const payload = JSON.parse(json);
  assert.equal(payload.format, 'mockimagemaker-design');
  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.baseUpdatedAt, '2026-10-05T00:00:00.000Z');
  assert.deepEqual(payload.data.designs.map((d) => d.id), ['d1']);
  const d = payload.data.designs[0];
  assert.equal(d.items[1].lookup.db.name, '取引先マスタ', 'ルックアップ元の名前は今の名前に直す');
  assert.deepEqual(payload.peers.map((p) => [p.id, p.name, p.itemCount, p.screenCount]).sort(), [['d2', '住所の共通項目', 1, 1], ['d3', '取引先マスタ', 2, 1], ['d4', '受注管理', 1, 1]]);
  assert.deepEqual(payload.peers.find((p) => p.id === 'd4').items.map((it) => it.name), ['顧客コード'], 'この画面設計を指す項目だけを写す');
  assert.ok(!/swimlane-state|clm-data/.test(html.replace(api.appScript(), '')), 'ほかのアプリの埋め込みの名前は使わない');
});

test('アプリの script の中に、script の始まりと終わりの印・<!-- がない（書き出す HTML にそのまま入れるため）', () => {
  const start = ORIGINAL.indexOf('<script>\n') + '<script>\n'.length;
  const body = ORIGINAL.slice(start, ORIGINAL.lastIndexOf('</script>')).toLowerCase();
  for (const mark of ['</script', '<script', '<!--']) assert.equal(body.split(mark).length - 1, 0, `script の中に「${mark}」がある`);
});

test('単体で開いたとき: その画面設計の編集の画面がすぐ開き、一覧へ戻る・書き出す・取り込みは出さない。ブラウザの保存領域は使わない', async (t) => {
  const { html } = await exportHtmlText(t);
  const { app, api } = await bootStandalone(t, html);
  assert.equal(api.ui.view, 'editor');
  assert.equal(api.currentDesign().name, '顧客管理');
  assert.ok(api.standaloneInfo(), '単体で開いたときの印');
  assert.ok($(app, '#sa-bar'), '上の帯');
  assert.match($(app, '#sa-bar').textContent, /「顧客管理」の画面設計です/);
  assert.ok($(app, '#toolbar [data-action="save-html"]'));
  for (const sel of ['[data-action="home"]', '[data-action="export"]', '[data-action="import-items"]']) assert.equal($(app, sel), null, `${sel} を出さない`);
  api.runCommand('goHome');
  assert.equal(api.ui.view, 'editor', '一覧へ戻らない');
  api.runCommand('importHtml');
  api.runCommand('exportDialog');
  await tick();
  assert.equal($(app, '.modal'), null, '書き出しの窓も取り込みも開かない');
  api.actions.updateDesignInfo(api.currentDesign().id, { description: '直した説明' });
  assert.equal(app.window.localStorage.getItem(STORAGE_KEY), null, 'localStorage に書かない');
  assert.equal(api.isStandaloneDirty(), true);
  assert.match($(app, '#sa-state').textContent, /保存していない変更があります/);
});

test('単体で開いたとき: つながった項目は「元なし」にならず直せない。ルックアップ元がないので、元・探す項目は直せない形で出す。図にはほかの画面設計の箱も出る', async (t) => {
  const { html } = await exportHtmlText(t);
  const { app, api } = await bootStandalone(t, html);
  const d = api.currentDesign();
  assert.deepEqual(plain(d.items.find((it) => it.id === 'i4').link), { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false });
  api.selectPart('p4');
  assert.match($(app, '#side-settings').textContent, /から取り込んだ項目です/);
  assert.equal($(app, '#side-settings [data-action="unlink-item"]'), null, 'つながりを切るは出さない');
  assert.equal($(app, '#side-settings [data-action="open-link-source"]'), null);
  api.selectPart('p2');
  assert.ok($(app, '#side-settings .lk-ro'), 'ルックアップは直せない形');
  assert.match($(app, '#side-settings .lk-ro-list').textContent, /取引先マスタ[\s\S]*取引先コード[\s\S]*取引先名 → 取引先名/);
  assert.equal($(app, '#side-settings [data-lk="db"]'), null);
  // つながりの図: ほかの画面設計の箱は、埋め込んだ写しで出す（押しても開かない）
  const model = api.mapModel(api.store.state, d.id);
  assert.deepEqual(plain(model.nodes.map((n) => n.name)).sort(), ['住所の共通項目', '取引先マスタ', '受注管理', '顧客管理']);
  assert.equal(model.edges.length, 3, 'ルックアップ（取引先マスタ → 顧客管理・顧客管理 → 受注管理）と取り込み');
  api.runCommand('openMap');
  assert.match($(app, '#db-view .mnode[data-node="d:d4"]').textContent, /項目 1 個・画面 1/);
  assert.equal($(app, '#screen-list .db-entry[data-action="open-map"] small').textContent, '3 つとつながっている');
});

test('単体で開いたとき: 「HTML を保存」（Ctrl+S も）で、直した中身を入れた HTML を保存し直す。保存しないまま閉じようとすると止める', async (t) => {
  const { html } = await exportHtmlText(t);
  const { app, api } = await bootStandalone(t, html);
  const written = [];
  const picks = [];
  app.window.showSaveFilePicker = async (opts) => {
    picks.push(opts.suggestedName);
    return { name: opts.suggestedName, createWritable: async () => ({ write: async (s) => written.push(s), close: async () => {} }) };
  };
  const ev = new app.window.Event('beforeunload', { cancelable: true });
  app.window.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, '変えていなければ止めない');
  const sid = api.currentDesign().screens[1].id;
  api.actions.updateScreen(api.currentDesign().id, sid, { name: '新規登録（直した）' });
  const ev2 = new app.window.Event('beforeunload', { cancelable: true });
  app.window.dispatchEvent(ev2);
  assert.equal(ev2.defaultPrevented, true, '保存していない変更があれば止める');
  const key = new app.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
  app.document.body.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true, 'ブラウザの「名前を付けて保存」は止める');
  await waitFor(() => written.length === 1, { label: 'Ctrl+S で保存' });
  assert.deepEqual(picks, ['顧客管理.html'], '最初の名前は開いたファイルの名前');
  assert.match(written[0], /新規登録（直した）/);
  await waitFor(() => !api.isStandaloneDirty(), { label: '保存した印' });
  assert.match($(app, '#sa-state').textContent, /保存しました/);
  const payload = JSON.parse(written[0].match(/id="mim-embedded">([^\n]*)<\/script>/)[1]);
  assert.equal(payload.baseUpdatedAt, '2026-10-05T00:00:00.000Z', '書き出したときの更新日時を持ち回る');
  assert.equal(payload.peers.length, 3, 'ほかの画面設計の写しも持ち回る');
  // 保存し直した HTML も、単体で開ける
  const again = await bootStandalone(t, written[0]);
  assert.equal(again.api.currentDesign().screens[1].name, '新規登録（直した）');
});

test('単体で開いたとき: 名前に「</script>」を含む画面設計も、書き出して開き直せる', async (t) => {
  const state = sampleState();
  state.designs[0].name = '顧客</script><b>管理';
  state.designs[0].screens[0].name = '<!-- 詳細 -->';
  const { html } = await exportHtmlText(t, state);
  const { api } = await bootStandalone(t, html);
  assert.equal(api.currentDesign().name, '顧客</script><b>管理');
  assert.equal(api.currentDesign().screens[0].name, '<!-- 詳細 -->');
});

// ── HTML の取り込み ──
async function editedVendorHtml(t, edit) {
  const { html, app, api } = await exportHtmlText(t);
  const vendor = await bootStandalone(t, html);
  edit(vendor.api);
  const written = [];
  vendor.app.window.showSaveFilePicker = async (opts) => ({ name: opts.suggestedName, createWritable: async () => ({ write: async (s) => written.push(s), close: async () => {} }) });
  await vendor.api.saveStandalone();
  return { text: written[0], app, api };
}

test('取り込み: 一覧にある画面設計なら確かめの窓（今と取り込む中身の数）。置き換えると、前の中身は改訂履歴に残り、元に戻すでも戻る', async (t) => {
  const { text, app, api } = await editedVendorHtml(t, (v) => {
    const d = v.currentDesign();
    v.actions.addScreen(d.id, 'blank', d.screens[1].id);
    v.actions.updateDesignInfo(d.id, { description: 'ベンダーが直した説明' });
  });
  const done = api.importHtmlText(text);
  await tick();
  assert.equal($(app, '.modal h2').textContent, '「顧客管理」を取り込みますか？');
  const cells = $$(app, '.imp-cmp tbody tr').map((tr) => [...tr.children].map((c) => c.textContent));
  assert.deepEqual(cells.find((r) => r[0] === '画面'), ['画面', '2 つ', '3 つ']);
  assert.equal(app.document.activeElement.dataset.dlg, 'cancel', '最初はキャンセルを選んだ状態');
  assert.equal($(app, '[name="imp-how"]:checked').value, 'replace');
  click($(app, '[data-dlg="ok"]'));
  const res = await done;
  assert.equal(res.status, 'replaced');
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  assert.equal(d.description, 'ベンダーが直した説明');
  assert.equal(d.screens.length, 3);
  assert.equal(d.revisions.length, 1);
  assert.deepEqual(plain([d.revisions[0].kind, d.revisions[0].note, d.revisions[0].no]), ['import', '取り込む前の状態', null]);
  assert.equal(d.revisions[0].snapshot.description, '取引先と顧客の連絡先を管理する。', '前の中身の写し');
  assert.equal(d.revisions[0].snapshot.revisions, undefined, '写しに改訂履歴は入れない');
  assert.equal(api.revisionLabel(d), '版なし', '自動で残した行は「最新の版」に数えない');
  assert.equal(d.items.find((it) => it.id === 'i4').link.lost, false, '一覧にある元とつながったまま');
  api.store.undo();
  const back = api.store.state.designs.find((x) => x.id === 'd1');
  assert.equal(back.screens.length, 2, '元に戻すで取り込む前に戻る');
  assert.equal(back.revisions.length, 0);
});

test('取り込み: 中身が同じなら取り込まない。一覧になければ同じ id のまま足す。「別の画面設計として足す」は名前に（取り込み）を付ける', async (t) => {
  const { html, app, api } = await exportHtmlText(t);
  assert.equal((await api.importHtmlText(html)).status, 'same', '書き出したままの HTML は同じ中身');
  assert.equal($(app, '.modal'), null, '確かめの窓は出さない');
  // 別として足す
  const changed = html.replace('取引先と顧客の連絡先を管理する。', '直した説明');
  const done = api.importHtmlText(changed);
  await tick();
  click($(app, '[name="imp-how"][value="copy"]'));
  click($(app, '[data-dlg="ok"]'));
  const res = await done;
  assert.equal(res.status, 'copied');
  const copy = api.store.state.designs.find((d) => d.id === res.designId);
  assert.equal(copy.name, '顧客管理（取り込み）');
  assert.notEqual(copy.id, 'd1');
  assert.equal(copy.description, '直した説明');
  assert.equal(api.store.state.designs.find((d) => d.id === 'd1').description, '取引先と顧客の連絡先を管理する。', '今の中身はそのまま');
  // 一覧にない画面設計は、確かめずに同じ id のまま足す（元のモックがあれば、つながりも戻る）
  api.actions.deleteDesignForever('d1');
  assert.equal(api.store.state.designs.some((d) => d.id === 'd1'), false);
  const added = await api.importHtmlText(html);
  assert.equal(added.status, 'added');
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  assert.ok(d);
  assert.equal(d.items.find((it) => it.id === 'i4').link.lost, false);
  assert.equal(d.items.find((it) => it.id === 'i4').props.maxLen, '8', '元の項目の今の中身にそろう');
  assert.equal(api.store.state.designs.find((x) => x.id === 'd4').items[0].lookup.db.designId, 'd1');
});

test('取り込み: ごみ箱にあれば置き換えて一覧に戻す。書き出した後にこちらでも変えていたら、赤で知らせる', async (t) => {
  const { html, app, api } = await exportHtmlText(t);
  api.actions.updateDesignInfo('d1', { description: 'こちらで直した説明' }); // 書き出した後に変えた
  api.actions.trashDesign('d1');
  const done = api.importHtmlText(html);
  await tick();
  assert.match($(app, '.modal').textContent, /「ごみ箱」にある画面設計/);
  assert.match($(app, '.modal .warn').textContent, /こちらでも変えています/);
  click($(app, '[data-dlg="ok"]'));
  assert.equal((await done).status, 'replaced');
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  assert.equal(d.trashedAt, null);
  assert.equal(d.description, '取引先と顧客の連絡先を管理する。');
  assert.equal(d.revisions[0].snapshot.description, 'こちらで直した説明');
});

test('取り込み: このアプリの書き出しでない HTML・新しい版のアプリの書き出し・壊れたデータは、知らせて止める', async (t) => {
  const { html, app, api } = await exportHtmlText(t);
  const before = JSON.stringify(api.store.state);
  assert.equal((await api.importHtmlText('<!DOCTYPE html><html><body>ほかの HTML</body></html>')).status, 'error');
  assert.match($(app, '#toast').textContent, /モックイメージメーカーで書き出した HTML ではありません/);
  const newer = html.replace('"format":"mockimagemaker-design","schemaVersion":3', '"format":"mockimagemaker-design","schemaVersion":99');
  const r = await api.importHtmlText(newer);
  assert.equal(r.status, 'error');
  assert.match(r.error, /新しい版のアプリで書き出した HTML/);
  assert.equal((await api.importHtmlText(html.replace('id="mim-embedded">{', 'id="mim-embedded">{{'))).status, 'error');
  assert.equal((await api.importHtmlText(html.replace('"format":"mockimagemaker-design"', '"format":"swimlane-state"'))).status, 'error');
  assert.equal(JSON.stringify(api.store.state), before, '何も変えない');
});

test('取り込み: 作る先の自由な名前は選択肢に足す。最初の画面の「HTML を取り込む」とアプリのメニューから、デスクトップは開く窓で選ぶ', async (t) => {
  const state = sampleState();
  state.designs[0].target = 'Excel マクロ';
  const src = await exportHtmlText(t, state);
  const xapi = fakeExportAPI({ openHtml: { ok: true, text: src.html, name: '顧客管理.html' } });
  const storage = createMainStorage();
  t.after(() => storage.cleanup());
  const { app, api } = await bootSample(t, { exportAPI: xapi, storage });
  assert.deepEqual(plain(api.store.state.designs), []);
  assert.ok($(app, '[data-action="import-html"]'), '最初の画面の「HTML を取り込む」');
  click($(app, '[data-action="import-html"]'));
  await waitFor(() => api.store.state.designs.length === 1, { label: '取り込み' });
  assert.equal(api.store.state.designs[0].target, 'Excel マクロ');
  assert.deepEqual(plain(api.store.state.settings.customTargets), ['Excel マクロ']);
  assert.ok(xapi.calls.some((c) => c[0] === 'openHtml'));
  // 編集の画面からアプリのメニューで取り込むときは、ファイルを選んだ後に一覧へ戻ってから
  api.openDesign('d1');
  app.menuCommand('importHtml');
  await waitFor(() => xapi.calls.filter((c) => c[0] === 'openHtml').length === 2, { label: '2 回目の開く窓' });
  await waitFor(() => api.ui.view === 'home', { label: '一覧へ戻る' });
  await tick();
  assert.match($(app, '#toast').textContent, /同じ中身なので、取り込みませんでした/);
  await storage.whenIdle(); // 書き込みが済んでから片付ける
});

test('ブラウザの印刷では、アプリの画面の代わりに案内の文だけを出す（印刷用の文書は出す）', async (t) => {
  const { api } = await bootSample(t);
  const css = api.appStyle();
  assert.match(css, /@media print\{[\s\S]*body:not\(\.xp-doc\)>\*\{display:none!important\}[\s\S]*この画面は印刷できません/);
  assert.match(css, /body\.xp-doc \.pg\+\.pg\{break-before:page\}/);
});

// ── 見直しで見つかった不具合（2026-10-13）──
test('取り込み: 書き出した後に「元に戻す」で変えたときも、こちらでも変えたと赤で知らせる（更新日時でなく中身の印で比べる）', async (t) => {
  const { app, api } = await bootSample(t);
  api.actions.updateDesignInfo('d1', { description: '書き出す前に直した説明' });
  const xapi = await exportHtmlTextFrom(app, api);
  api.store.undo(); // 書き出した後に、こちらで取り消した
  const done = api.importHtmlText(xapi.replace('書き出す前に直した説明', 'ベンダーが直した説明'));
  await tick();
  assert.ok($(app, '.modal .warn'), '赤の注意が出る');
  click($(app, '[data-dlg="cancel"]'));
  assert.equal((await done).status, 'canceled');
});

test('取り込み: 1 回取り込んだ後、同じ書き出しから直し続けた HTML を取り込んでも、こちらで変えていなければ赤の注意は出ない', async (t) => {
  const { html, app, api } = await exportHtmlText(t);
  const v1 = html.replace('取引先と顧客の連絡先を管理する。', 'ベンダーの 1 回目');
  const first = api.importHtmlText(v1);
  await tick();
  click($(app, '[data-dlg="ok"]'));
  assert.equal((await first).status, 'replaced');
  const second = api.importHtmlText(v1.replace('ベンダーの 1 回目', 'ベンダーの 2 回目'));
  await tick();
  assert.ok($(app, '.modal .imp-cmp'), '確かめの窓は出る');
  assert.equal($(app, '.modal .warn'), null, 'こちらで変えていないので、赤の注意は出ない');
  click($(app, '[data-dlg="ok"]'));
  assert.equal((await second).status, 'replaced');
  api.actions.updateDesignInfo('d1', { description: 'こちらで直した' });
  const third = api.importHtmlText(v1.replace('ベンダーの 1 回目', 'ベンダーの 3 回目'));
  await tick();
  assert.ok($(app, '.modal .warn'), 'こちらで変えたら、赤の注意が出る');
  click($(app, '[data-dlg="cancel"]'));
  await third;
});

test('取り込み: 書き出した後にルックアップ元の名前を変えても、そのまま返ってきた HTML は「同じ中身」', async (t) => {
  const { html, api } = await exportHtmlText(t);
  api.actions.renameDesign('d3', '取引先の台帳');
  assert.equal((await api.importHtmlText(html)).status, 'same');
});

test('取り込み: 取り込んだ項目の元にルックアップがあり、その控えの名前が古くても、書き出したままなら「同じ中身」', async (t) => {
  const state = sampleState();
  // 住所の共通項目の郵便番号にルックアップを付け（控えの名前は古い）、顧客管理がそれを取り込んでいる
  state.designs[1].items[0].lookup = { db: { designId: 'd3', name: '取引先マスタ（古い名前）', free: false }, key: { itemId: 'b1', name: '古いコード' }, copies: [] };
  const { html, api } = await exportHtmlText(t, state);
  assert.equal((await api.importHtmlText(html)).status, 'same');
});

test('取り込み: ごみ箱にある画面設計と同じ中身なら、中身は変えずに一覧に戻す。一覧になければ、作る先はその画面設計の分だけ選択肢に足す', async (t) => {
  const { html, app, api } = await exportHtmlText(t);
  api.actions.trashDesign('d1');
  const r = await api.importHtmlText(html);
  assert.equal(r.status, 'restored');
  assert.equal(api.store.state.designs.find((d) => d.id === 'd1').trashedAt, null);
  assert.match($(app, '#toast').textContent, /ごみ箱にありました/);
  // 作る先の自由な名前（ベンダーが試しに書いた名前が入っていても、画面設計の作る先だけを足す）
  const payload = JSON.parse(html.match(/id="mim-embedded">([^\n]*)<\/script>/)[1]);
  payload.data.designs[0].id = 'd-new';
  payload.data.designs[0].target = 'Excel マクロ';
  payload.data.settings.customTargets = ['Excel マクロ', '試した作る先'];
  const text = html.replace(/id="mim-embedded">[^\n]*<\/script>/, () => `id="mim-embedded">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`);
  assert.equal((await api.importHtmlText(text)).status, 'added');
  assert.deepEqual(plain(api.store.state.settings.customTargets), ['Excel マクロ']);
});

test('取り込み: 吹き出しの id が重なった HTML でも、読み込むときに直す（片方を消しても、もう片方は残る）', async (t) => {
  const state = sampleState();
  const c = state.designs[0].screens[0].callouts[0];
  state.designs[0].screens[0].callouts.push({ ...c, x: 1300, y: 300 });
  const { api } = await bootSample(t, { state });
  const ids = api.store.state.designs[0].screens[0].callouts.map((x) => x.id);
  assert.equal(new Set(ids).size, 2);
});

test('取り込み: 編集の画面からアプリのメニューで取り込むとき、ファイルを選ばなければ編集の画面のまま', async (t) => {
  const xapi = fakeExportAPI(); // openHtml はキャンセルを返す
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  api.openDesign('d1');
  api.actions.updateDesignInfo('d1', { description: '直した' });
  api.runCommand('importHtml'); // アプリのメニューの命令と同じ
  await waitFor(() => xapi.calls.some((c) => c[0] === 'openHtml'), { label: '開く窓' });
  await tick();
  assert.equal(api.ui.view, 'editor');
  assert.equal(api.store.canUndo(), true, '元に戻すの履歴も残る');
});

test('単体で開いたとき: 関連レコード一覧の元がこの HTML にないときは、元・条件・列を直せない形で出す（列の名前は今の名前）', async (t) => {
  const state = sampleState();
  state.designs[3].items.push(item('e9', '受注日', 'date'));
  state.designs[0].screens[1].parts.push({ id: 'pr', type: 'table', x: 32, y: 200, w: 640, h: 168, no: 2, labelPos: 'top', sample: '', placeholder: '', label: '受注の履歴', required: false, memo: '', tableKind: 'related',
    props: { columns: [{ id: 'c1', ref: { itemId: 'e9', name: '受注日（古い名前）' } }], sort: '', perPage: '', limit: '5', db: { designId: 'd4', name: '受注管理', free: false }, cond: { from: { itemId: 'e1', name: '顧客コード' }, to: { itemId: 'i1', name: '顧客コード' } } },
    view: { rows: 3, samples: {}, widths: {} } });
  const { html } = await exportHtmlText(t, state);
  const { app, api } = await bootStandalone(t, html);
  click($(app, '[data-action="select-screen"][data-id="s2"]'));
  api.selectPart('pr');
  assert.ok($(app, '#side-settings .lk-ro'), '直せない形');
  assert.match($(app, '#side-settings .lk-ro-list').textContent, /受注管理[\s\S]*顧客コード ＝ 顧客コード[\s\S]*列: 受注日$/);
  for (const sel of ['[data-tb="db"]', '[data-tb="condFromName"]', '[data-tb="condFrom"]']) assert.equal($(app, `#side-settings ${sel}`), null, `${sel} を出さない`);
  const before = JSON.stringify(api.store.state);
  $(app, '#side-settings [data-pf="label"]').focus();
  api.selectPart('p5');
  assert.equal(JSON.stringify(api.store.state), before, '触っただけでは変わらない');
});

test('単体で開いたとき: ルックアップ元がない項目は部品の種類を変えられない。窓を開いている間の Ctrl+S も止める。壊れたデータでは閉じるのを止めない', async (t) => {
  const { html } = await exportHtmlText(t);
  const { app, api } = await bootStandalone(t, html);
  api.runCommand('openItems');
  click($(app, '[data-action="select-item"][data-id="i2"]'));
  assert.equal($(app, '#side-settings [data-pf="type"]'), null, '取引先コード（ルックアップ元がない）は種類を変えられない');
  click($(app, '[data-action="select-item"][data-id="i1"]'));
  assert.ok($(app, '#side-settings [data-pf="type"]'), 'ほかの項目は変えられる');
  // 窓を開いている間の Ctrl+S
  api.runCommand('addScreen');
  await tick();
  assert.ok($(app, '.modal'));
  const key = new app.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
  app.document.querySelector('.modal').dispatchEvent(key);
  assert.equal(key.defaultPrevented, true, 'ブラウザの「名前を付けて保存」を止める');
  assert.match($(app, '#toast').textContent, /窓を閉じてから保存/);
  click($(app, '[data-dlg="cancel"]'));
  // 壊れたデータ（画面設計が 0 件）
  const broken = html.replace(/"designs":\[\{[\s\S]*\}\]\},"peers"/, '"designs":[]},"peers"');
  const b = await bootStandalone(t, broken);
  assert.equal(b.api.isStandaloneDirty(), false);
  const ev = new b.app.window.Event('beforeunload', { cancelable: true });
  b.app.window.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, '閉じるのを止めない');
});

test('単体で開いたとき: 作る先の「その他」に打ちかけの名前も保存に入る。保存の窓が使えないときはダウンロードにする', async (t) => {
  const { html } = await exportHtmlText(t);
  const { app, api } = await bootStandalone(t, html);
  const sel = $(app, '#side-settings .target-select');
  sel.value = '__other__';
  sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  const other = $(app, '#side-settings .target-other');
  other.focus();
  other.value = 'Access';
  const downloads = [];
  app.window.showSaveFilePicker = async () => { const e = new Error('止めてある'); e.name = 'SecurityError'; throw e; };
  app.window.URL.createObjectURL = () => 'blob:x';
  app.window.URL.revokeObjectURL = () => {};
  app.window.HTMLAnchorElement.prototype.click = function click() { downloads.push(this.download); };
  const res = await api.saveStandalone();
  assert.equal(res.ok, true);
  assert.equal(res.download, true, 'ダウンロードにした');
  assert.deepEqual(downloads, ['顧客管理.html']);
  assert.equal(api.currentDesign().target, 'Access', '打ちかけの作る先も入る');
});

test('PNG のファイルの名前: 長くても拡張子（.png）は残す', () => {
  const { safeName } = require(path.join(ROOT, 'export.js'));
  const long = 'あ'.repeat(130) + '.png';
  const s = safeName(long, 'screen.png');
  assert.ok(s.endsWith('.png'));
  assert.ok(s.length <= 120);
  assert.equal(safeName('a<b>:c?.png', 'x.png'), 'a_b__c_.png');
  assert.equal(safeName('', 'x.png'), 'x.png');
});
