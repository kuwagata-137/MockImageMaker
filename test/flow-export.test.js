'use strict';
// 第 8 段階の出力のテスト: PDF の「ステータスの移り方」「画面の移り方」のページと、出力の窓の「入れるページ」の 2 つのチェック（画像 q59）。
// 画面設計の名前は架空の業務（出張申請・経費精算）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
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

// 出張申請（一覧・詳細。項目 1 つ）と経費精算（精算の入力）を作る。full なら、ステータスの印（見本の操作 4 つ）と移る先を置く
async function boot(t, { full = true } = {}) {
  const xapi = fakeExportAPI();
  const app = bootApp({ exportAPI: xapi });
  const api = await app.api();
  t.after(() => app.close());
  const A = api.actions.createDesign('出張申請', 'kintone');
  const B = api.actions.createDesign('経費精算', 'kintone');
  const d = (id) => api.store.state.designs.find((x) => x.id === id);
  const a1 = d(A).screens[0].id;
  api.actions.updateScreen(A, a1, { name: '一覧' });
  const a2 = api.actions.addScreen(A, 'blank', a1);
  api.actions.updateScreen(A, a2, { name: '詳細' });
  const b1 = d(B).screens[0].id;
  api.actions.updateScreen(B, b1, { name: '精算の入力' });
  api.actions.addPart(A, a2, 'text1', { x: 40, y: 400 });
  if (full) {
    let y = 80;
    const put = (sid, type, props, label) => {
      const id = api.actions.addPart(A, sid, type, { x: 40, y: (y += 48) });
      api.actions.updatePart(A, sid, id, { ...(label ? { label } : {}), ...(props ? { props } : {}) });
    };
    put(a2, 'status');
    put(a1, 'button', { to: 'screen', screenId: a2 }, '詳細を見る');
    put(a2, 'link', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  }
  const pdfPages = () => {
    const pdf = xapi.calls.filter((c) => c[0] === 'savePdf').pop()[1];
    const doc = new app.window.DOMParser().parseFromString(pdf.html, 'text/html');
    return [...doc.querySelectorAll('body > .pg')];
  };
  return { app, api, xapi, A, B, a1, a2, b1, d, pdfPages };
}
async function exportVia(app, api, designId, init = () => {}) {
  const done = api.openExportDialog(designId);
  await tick();
  init($(app, '.modal'));
  click($(app, '[data-dlg="ok"]'));
  await tick();
  // 出力できないとき（窓に赤い文字が出て閉じない）は、窓を閉じてテストを失敗にする（待ち続けないように）
  const err = $(app, '.modal .modal-error');
  if (err && err.textContent.trim()) {
    const msg = err.textContent;
    click($(app, '[data-dlg="cancel"]'));
    await done;
    throw new Error('出力の窓が閉じない: ' + msg);
  }
  return done;
}
const pageChecks = (app) => plain($$(app, '[data-xbox="pdf"] [data-xpage]').map((x) => [x.dataset.xpage, x.checked, x.disabled]));

test('出力の窓: 「入れるページ」に「ステータスの移り方」「画面の移り方」。操作がない・移る先がないときは、外して押せなくし、理由を添える', async (t) => {
  const empty = await boot(t, { full: false });
  const done = empty.api.openExportDialog(empty.A);
  await tick();
  assert.deepEqual(pageChecks(empty.app).slice(3), [['process', false, true], ['flow', false, true]]);
  const box = $(empty.app, '[data-xbox="pdf"]').textContent;
  assert.match(box, /ステータスの移り方ステータスを進める操作がないので、出しません/);
  assert.match(box, /画面の移り方ボタン・リンクの文字の移る先がないので、出しません/);
  click($(empty.app, '[data-dlg="cancel"]'));
  await done;
  const { app, api, A } = await boot(t);
  const done2 = api.openExportDialog(A);
  await tick();
  assert.deepEqual(pageChecks(app).slice(3), [['process', true, false], ['flow', true, false]]);
  click($(app, '[data-dlg="cancel"]'));
  await done2;
});

test('PDF: 表紙 → 項目の一覧表 → ステータスの移り方 → 画面の移り方 → 画面の順（つながりの図はルックアップ・取り込みがないので出ない）。表紙の画面の一覧にも 2 つの行', async (t) => {
  const { app, api, A, pdfPages } = await boot(t);
  await exportVia(app, api, A);
  const pages = pdfPages();
  assert.deepEqual(plain(pages.map((p) => (p.querySelector('.pg-head h2') || p.querySelector('.cv-title')).textContent)),
    ['出張申請', 'データベースの項目の一覧表', 'ステータスの移り方', '画面の移り方', '1　一覧', '2　詳細']);
  assert.deepEqual(plain([...pages[0].querySelectorAll('.cv-list tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent))), [
    ['データベースの項目の一覧表', '', '2'], ['ステータスの移り方', '', '3'], ['画面の移り方', '', '4'],
    ['1　一覧', 'パソコン', '5'], ['2　詳細', 'パソコン', '6'],
  ]);
  // ステータスの移り方のページ: 左に図（上から下へ）、右に操作の一覧表（q59）
  const pp = pages[2];
  assert.match(pp.querySelector('.pg-head').textContent, /ステータス 4 つ・操作 4 つ/);
  assert.match(pp.querySelector('.xp-legend').textContent, /先へ進む操作.*前へ戻る操作/);
  assert.equal(pp.querySelectorAll('.mnode').length, 4);
  assert.ok(pp.querySelector('svg marker[id^="xp-proc-"]'), '矢印の印の id は編集の画面と重ならない頭');
  assert.equal(pp.querySelector('[id="map-inner"]'), null);
  assert.deepEqual(plain([...pp.querySelectorAll('.xp-itable thead th')].map((th) => th.textContent)), ['番号', '操作', '前のステータス → 次のステータス', '操作する人', '条件']);
  assert.deepEqual(plain([...pp.querySelectorAll('.xp-itable tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent))), [
    ['1', '申請する', '申請 → 承認待ち', '', ''], ['2', '承認する', '承認待ち → 承認済み', '', ''],
    ['3', '差し戻す', '承認待ち → 申請', '', ''], ['4', '完了にする', '承認済み → 完了', '', ''],
  ]);
  assert.match(pp.querySelector('.pg-foot').textContent, /出張申請 ／ ステータスの移り方\s*3 \/ 6/);
  // 画面の移り方のページ
  const fp = pages[3];
  assert.match(fp.querySelector('.pg-head').textContent, /画面 2 つ・移る先 2 本/);
  assert.match(fp.querySelector('.xp-legend').textContent, /ボタン.*リンクの文字.*ほかの画面設計の画面/);
  assert.equal(fp.querySelectorAll('.mnode').length, 3, '2 つの画面と、ほかの画面設計の画面 1 つ');
  assert.ok(fp.querySelector('svg marker[id^="xp-flow-"]'));
  assert.match(fp.querySelector('.pg-foot').textContent, /出張申請 ／ 画面の移り方\s*4 \/ 6/);
});

test('PDF のステータスの移り方のページ: 横の用紙は図の右に表、縦の用紙（表を右に置くと狭い）は図の下に表', async (t) => {
  const { api, A, d } = await boot(t);
  const procPage = (orient) => {
    const doc = api.exportDocument(d(A), api.store.state, { paper: 'A4', orient, cover: false, process: true });
    const box = new (require('jsdom').JSDOM)(doc.html).window.document;
    return box.querySelector('.xp-proc');
  };
  const land = procPage('landscape');
  assert.equal(land.classList.contains('stack'), false);
  assert.ok(parseFloat(land.querySelector('.xp-proc-tbl').style.width) >= 520);
  const port = procPage('portrait');
  assert.equal(port.classList.contains('stack'), true, '縦の用紙では図の下に表');
  assert.equal(port.querySelector('.xp-proc-tbl').style.width, '', '表は本文の幅いっぱい');
});

// デバッグとリリースの見直し②-2: 操作の一覧表の 1 行がページに入らず途中までになっても、断り書きが出なかった（項目の一覧表は出る）。
// jsdom では大きさを測れないので、測る関数を差し替える（本文は 1000×600、「とても長い条件」の行だけ 5000 の高さ、ほかは 20）
test('PDF のステータスの移り方のページ: 操作の一覧表の行が 1 行でもページに入らないときは「長い行は途中まで」と小見出しに書く（続きのページも）', async (t) => {
  const { app, api, A, d } = await boot(t);
  app.window.Element.prototype.getBoundingClientRect = function () {
    const [width, height] = this.classList.contains('pg-body') ? [1000, 600]
      : this.tagName === 'TR' && this.textContent.includes('とても長い条件') ? [1000, 5000] : [100, 20];
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height };
  };
  const NOTE = '長い行は途中まで（全文はアプリか HTML で見られます）';
  const subsWithLong = (k) => {
    api.store.commit((s) => {
      const it = s.designs.find((x) => x.id === A).items.find((x) => x.type === 'status');
      it.props.actions.forEach((a, i) => { a.cond = i === k ? 'とても長い条件。'.repeat(20) : ''; });
    });
    const doc = api.exportDocument(d(A), api.store.state, { paper: 'A4', orient: 'landscape', cover: false, process: true });
    const parse = (h) => new app.window.DOMParser().parseFromString(h, 'text/html');
    return doc.pages.map(parse).filter((p) => /^ステータスの移り方/.test(p.querySelector('.pg-head h2').textContent))
      .map((p) => [p.querySelector('.pg-head h2').textContent, p.querySelector('.pg-head span').textContent]);
  };
  // 1 つ目の操作が長いとき: 図の横の表（1 ページ目）がその行で切れる
  const first = subsWithLong(0);
  assert.equal(first[0][0], 'ステータスの移り方');
  assert.ok(first[0][1].endsWith('・' + NOTE), first[0][1]);
  assert.ok(first.slice(1).every(([, sub]) => !sub.includes(NOTE)), JSON.stringify(first));
  // 4 つ目の操作が長いとき: 1 ページ目には入らず、続きのページでその行が切れる
  const last = subsWithLong(3);
  assert.ok(!last[0][1].includes(NOTE), last[0][1]);
  const cont = last.filter(([h]) => h === 'ステータスの移り方（続き）');
  assert.equal(cont.length, 1, JSON.stringify(last));
  assert.equal(cont[0][1], '操作の一覧表・' + NOTE);
});

test('PDF: 「ステータスの移り方」「画面の移り方」のチェックを外すと、そのページを入れない。選んだ設定はアプリを閉じるまで覚える', async (t) => {
  const { app, api, A, pdfPages } = await boot(t);
  await exportVia(app, api, A, (m) => {
    m.querySelector('[data-xpage="process"]').checked = false;
    m.querySelector('[data-xpage="flow"]').checked = false;
  });
  const names = plain(pdfPages().map((p) => (p.querySelector('.pg-head h2') || p.querySelector('.cv-title')).textContent));
  assert.deepEqual(names, ['出張申請', 'データベースの項目の一覧表', '1　一覧', '2　詳細']);
  const done = api.openExportDialog(A);
  await tick();
  assert.deepEqual(pageChecks(app).slice(3), [['process', false, false], ['flow', false, false]]);
  click($(app, '[data-dlg="cancel"]'));
  await done;
});

test('PDF: ステータスの移り方と画面の移り方のページだけでも出力できる（画面を全部外しても）', async (t) => {
  const { app, api, A, pdfPages } = await boot(t);
  await exportVia(app, api, A, (m) => {
    m.querySelectorAll('[data-xpage]').forEach((x) => { x.checked = ['process'].includes(x.dataset.xpage); });
    m.querySelectorAll('[data-xscreen]').forEach((x) => { x.checked = false; });
  });
  assert.deepEqual(plain(pdfPages().map((p) => p.querySelector('.pg-head h2').textContent)), ['ステータスの移り方']);
});

test('AI の export_design: process・flow で 2 つのページを入れる・外す（既定は入れる。操作・移る先がなければ入れない）', async (t) => {
  const { api, A } = await boot(t);
  const call = async (tool, args = {}) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const r = await call('export_design', { design: A, format: 'pdf' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.result.process, r.result.flow, r.result.pages], [true, true, 6]);
  const off = await call('export_design', { design: A, format: 'pdf', process: false, flow: false });
  assert.deepEqual([off.result.process, off.result.flow, off.result.pages], [false, false, 4]);
  const only = await call('export_design', { design: A, format: 'pdf', cover: false, map: false, items: false, flow: false, screens: [] });
  assert.equal(only.result.pages, 1, 'ステータスの移り方のページだけ');
  const B2 = api.actions.createDesign('日報', 'その他');
  const none = await call('export_design', { design: B2, format: 'pdf' });
  assert.deepEqual([none.result.process, none.result.flow], [false, false]);
});
