'use strict';
// システムの説明書（PDF）の窓と入口のテスト（第 10 段階の後半。q76・q77・q81_1。仕様_細かい決めごと.md の「説明書（PDF）の細かい決めごと」）。
// 入口: システムの画面のメニューバー「ファイル」の「出力」・最初の画面のシステムの「…」の「説明書を出力…」・アプリのメニューの「出力…」（命令 exportDialog）。
// 見本は架空の業務（出張申請システム・経費精算システム）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootSystemDoc } = require('./system-doc-fixtures');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
// ラジオを選んで change を起こす（窓は change で向きの押せる・押せないを決める）
const pickRadio = (el) => { el.checked = true; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); };
const PAGE_KEYS = ['systemCover', 'swimlane', 'notes', 'cover', 'map', 'items', 'process', 'flow'];

// 出力の窓口の身代わり（デスクトップ版のとき）。呼ばれた中身を calls に残す。hold なら savePdf は release() まで返事を待つ
function fakeExportAPI(result = {}, { hold = false } = {}) {
  const calls = [];
  let release = null;
  return {
    calls,
    release: (r) => release(r),
    savePdf: (p) => {
      calls.push(['savePdf', p]);
      const res = { ok: true, path: 'C:\\出力\\' + p.name, ...result };
      return hold ? new Promise((resolve) => { release = (r) => resolve(r || res); }) : Promise.resolve(res);
    },
    saveHtml: async (p) => { calls.push(['saveHtml', p]); return { ok: true, path: p.name }; },
    savePng: async (p) => { calls.push(['savePng', p]); return { ok: true, count: p.files.length, path: p.files[0].name, dir: '.' }; },
    openHtml: async () => ({ ok: false, canceled: true }),
  };
}
async function boot(t, { exportAPI = fakeExportAPI(), open = true, ...opts } = {}) {
  const b = await bootSystemDoc(t, { exportAPI, ...opts });
  const $ = (sel) => b.app.document.querySelector(sel);
  const $$ = (sel) => [...b.app.document.querySelectorAll(sel)];
  if (open) b.api.openSystem(b.sysId);
  return { ...b, xapi: exportAPI, $, $$, toast: () => $('#toast').textContent };
}
// 窓の印 [鍵, 印があるか, 押せないか]
const pageChecks = ($$) => $$('.modal [data-dpage]').map((x) => [x.dataset.dpage, x.checked, x.disabled]);

test('説明書の窓: システムの画面のメニューバーの「出力」から開く。題・ボタンの並び（「出力…」が左）・印 8 つは最初は全部。出力すると <名前>_説明書.pdf', async (t) => {
  const { app, api, $, $$, xapi, toast } = await boot(t);
  const btn = $('#toolbar [data-action="export"]');
  assert.ok(btn, 'メニューバーの「ファイル」の組に「出力」');
  assert.match(btn.closest('.rgroup').querySelector('.glabel').textContent, /ファイル/);
  click(btn);
  await tick();
  assert.equal($('.modal h2').textContent, '「出張申請システム」の説明書を出力');
  assert.deepEqual($$('.modal-actions button').map((b) => b.textContent), ['出力…', 'キャンセル']);
  assert.match($('.modal .xp-note').textContent, /入っている画面設計 2 つ（出張申請・経費精算）の画面のページは、全部入れます。/);
  assert.deepEqual(pageChecks($$), PAGE_KEYS.map((k) => [k, true, false]));
  assert.match($('.modal').textContent, /設計ノート（決めたことと理由・まだ決まっていないこと）/);
  assert.equal($('.modal [name="dp-paper"]:checked').value, 'A4');
  assert.equal($('.modal [name="dp-orient"]:checked').value, 'landscape');
  assert.equal($('.modal [data-dopen]').checked, true);
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(xapi.calls.length, 1);
  const [kind, p] = xapi.calls[0];
  assert.equal(kind, 'savePdf');
  assert.equal(p.name, '出張申請システム_説明書.pdf');
  assert.equal(p.open, true);
  assert.equal(p.pageSize.width.toFixed(3), (297 / 25.4).toFixed(3));
  assert.equal(p.pageSize.height.toFixed(3), (210 / 25.4).toFixed(3));
  assert.match(p.html, /<title>出張申請システム_説明書<\/title>/);
  assert.match(p.html, /システムの説明書/);
  assert.equal(toast(), '説明書（PDF）を出力しました（C:\\出力\\出張申請システム_説明書.pdf）。');
  void app;
});

test('説明書の窓: アプリのメニューの命令 exportDialog でも、システムの画面では説明書の窓。最初の画面のシステムの「…」に「説明書を出力…」', async (t) => {
  const { api, $, $$, sysId } = await boot(t);
  api.runCommand('exportDialog');
  await tick();
  assert.equal($('.modal h2').textContent, '「出張申請システム」の説明書を出力');
  click($('[data-dlg="cancel"]'));
  await tick();
  api.goHome();
  const more = $(`.sys-block [data-action="sys-menu"][data-id="${sysId}"]`);
  assert.match(more.title, /説明書を出力/);
  click(more);
  assert.deepEqual($$('.sys-pop [role="menuitem"]').map((b) => b.textContent), ['名前と説明を変える…', '説明書を出力…', 'ごみ箱へ移す']);
  click($('.sys-pop [data-action="sys-doc"]'));
  await tick();
  assert.equal($('.modal h2').textContent, '「出張申請システム」の説明書を出力');
  click($('[data-dlg="cancel"]'));
  await tick();
  // 最初の画面でアプリのメニューの命令が来たときは、お知らせだけ（窓を開かない）
  api.runCommand('exportDialog');
  await tick();
  assert.equal($('.modal'), null);
  assert.match($('#toast').textContent, /システムの「…」から「説明書を出力…」/);
});

test('説明書の窓: ブラウザで開いたとき（exportAPI なし）は、メニューバーの「出力」と「…」の「説明書を出力…」を出さない。命令が来たらお知らせだけ', async (t) => {
  const { api, $, $$, sysId, toast } = await boot(t, { exportAPI: null });
  assert.equal($('#toolbar [data-action="export"]'), null);
  api.runCommand('exportDialog');
  await tick();
  assert.equal($('.modal'), null);
  assert.equal(toast(), '説明書の PDF は、デスクトップ版のアプリで出力できます。');
  api.goHome();
  const more = $(`.sys-block [data-action="sys-menu"][data-id="${sysId}"]`);
  assert.doesNotMatch(more.title, /説明書/);
  click(more);
  assert.equal($('.sys-pop [data-action="sys-doc"]'), null);
  assert.equal($$('.sys-pop [role="menuitem"]').length, 2);
});

test('説明書の窓: 出せないページは印を外して押せなくし、理由を添える（作業の箱なし・設計ノートの行なし・画面設計なし）。何も選ばないと窓が閉じない', async (t) => {
  const { api, $, $$, xapi } = await boot(t, { steps: false, notes: false });
  api.runCommand('exportDialog');
  await tick();
  assert.deepEqual(pageChecks($$), [['systemCover', true, false], ['swimlane', false, true], ['notes', false, true],
    ['cover', true, false], ['map', true, false], ['items', true, false], ['process', true, false], ['flow', true, false]]);
  assert.match($('.modal').textContent, /作業の箱がないので、出しません/);
  assert.match($('.modal').textContent, /設計ノートに行がないので、出しません/);
  click($('[data-dlg="cancel"]'));
  await tick();
  // 画面設計が入っていないシステム
  const empty = api.actions.createSystem({ name: '空のシステム', description: '' });
  api.openSystem(empty);
  api.runCommand('exportDialog');
  await tick();
  assert.match($('.modal .xp-note').textContent, /このシステムには、まだ画面設計が入っていません。/);
  assert.deepEqual(pageChecks($$).slice(3).map((r) => r[2]), [true, true, true, true, true]);
  assert.match($('.modal').textContent, /このシステムには画面設計が入っていません/);
  const cover = $('.modal [data-dpage="systemCover"]');
  cover.checked = false;
  click($('[data-dlg="ok"]'));
  await tick();
  assert.ok($('.modal'), '窓は閉じない');
  assert.equal($('.modal-error').textContent, '入れるページを 1 つ以上選んでください。');
  cover.checked = true;
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(xapi.calls.length, 1, '表紙だけでも出力できる');
  assert.equal(xapi.calls[0][1].name, '空のシステム_説明書.pdf');
});

test('説明書の窓: 選んだ設定はアプリを閉じるまで覚える（押せなかった印は前の設定のまま）。画面設計の出力の窓の設定は変わらない。スライドは横だけ', async (t) => {
  const { api, $, $$, xapi } = await boot(t);
  const before = JSON.parse(JSON.stringify(api.exportOpts));
  api.runCommand('exportDialog');
  await tick();
  pickRadio($('.modal [name="dp-paper"][value="slide"]'));
  assert.deepEqual($$('.modal [name="dp-orient"]').map((x) => [x.value, x.checked, x.disabled]), [['landscape', true, true], ['portrait', false, true]]);
  pickRadio($('.modal [name="dp-paper"][value="A3"]'));
  $('.modal [name="dp-orient"][value="portrait"]').checked = true;
  $('.modal [data-dpage="map"]').checked = false;
  $('.modal [data-dpage="notes"]').checked = false;
  $('.modal [data-dopen]').checked = false;
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  const p = xapi.calls[0][1];
  assert.equal(p.open, false);
  assert.equal(p.pageSize.width.toFixed(3), (297 / 25.4).toFixed(3), 'A3 縦');
  assert.doesNotMatch(p.html, /設計ノート<\/h2>/);
  assert.doesNotMatch(p.html, /つながりの図<\/h2>/);
  // 作業の箱を全部消したシステムで開き直す: スイムレーン図は押せないが、覚えた設定（入れる）は変わらない
  const y = api.store.state.systems.find((x) => x.name === '出張申請システム');
  for (const w of [...y.swimlane.steps]) api.actions.deleteStep(y.id, w.id);
  api.runCommand('exportDialog');
  await tick();
  assert.equal($('.modal [name="dp-paper"]:checked').value, 'A3');
  assert.equal($('.modal [name="dp-orient"]:checked').value, 'portrait');
  assert.deepEqual(pageChecks($$).map((r) => r.slice(0, 2)), [['systemCover', true], ['swimlane', false], ['notes', false], ['cover', true], ['map', false], ['items', true], ['process', true], ['flow', true]]);
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(api.docOpts.swimlane, true, '押せなかった印は前の設定のまま');
  assert.equal(api.docOpts.notes, false);
  assert.deepEqual(JSON.parse(JSON.stringify(api.exportOpts)), before, '画面設計の出力の窓の設定は変わらない');
});

test('説明書の窓: 打ちかけの文字を、窓を開く前に保存する。出力を待つ間の 2 回目の命令は窓を開かずに無視し、待ちが終わるとまた開ける', async (t) => {
  const xapi = fakeExportAPI({}, { hold: true });
  const { app, api, $, y, toast } = await boot(t, { exportAPI: xapi });
  click($('#sys-list .db-entry[data-panel="overview"]'));
  const desc = $('#sys-view [data-sy="desc"]');
  desc.focus();
  desc.value = '打ちかけの説明';
  api.runCommand('exportDialog');
  await tick();
  assert.equal(y().description, '打ちかけの説明', '窓を開く前に保存した');
  click($('[data-dlg="ok"]'));
  await tick();
  assert.equal(xapi.calls.length, 1);
  assert.equal(toast(), '説明書（PDF）を作っています…');
  api.runCommand('exportDialog');
  await tick();
  assert.equal($('.modal'), null, '待つ間は窓を開かない');
  click($('#toolbar [data-action="export"]'));
  await tick();
  assert.equal($('.modal'), null);
  xapi.release();
  await tick();
  await tick();
  assert.match(toast(), /説明書（PDF）を出力しました/);
  api.runCommand('exportDialog');
  await tick();
  assert.ok($('.modal'), '待ちが終わると、また開ける');
  void app;
});

test('説明書の窓: 窓を開いている間にシステムがごみ箱へ移ったら、出力せずに知らせる', async (t) => {
  const { api, $, xapi, sysId, toast } = await boot(t);
  api.runCommand('exportDialog');
  await tick();
  api.actions.trashSystem(sysId);
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(xapi.calls.length, 0);
  assert.equal(toast(), '「出張申請システム」がごみ箱へ移ったので、出力をやめました。');
});

test('説明書の窓: 保存の窓でキャンセルしたときは知らせない。失敗したときは「出力できませんでした」。どちらの後も、また開ける', async (t) => {
  const xapi = fakeExportAPI({ ok: false, canceled: true });
  const { api, $, toast } = await boot(t, { exportAPI: xapi });
  api.runCommand('exportDialog');
  await tick();
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(toast(), '説明書（PDF）を作っています…', 'キャンセルでは知らせを足さない');
  Object.assign(xapi, { savePdf: async (p) => { xapi.calls.push(['savePdf', p]); return { ok: false, error: '書き込めません' }; } });
  api.runCommand('exportDialog');
  await tick();
  assert.ok($('.modal'));
  click($('[data-dlg="ok"]'));
  await tick();
  await tick();
  assert.equal(toast(), '説明書（PDF）を出力できませんでした（書き込めません）。');
  api.runCommand('exportDialog');
  await tick();
  assert.ok($('.modal'));
});

test('設計ノートの右の欄: 説明書（PDF）の最後のページに、決めたことと理由と、まだ決まっていないこと（答えのある行も）が入ると書く（q80 案C）', async (t) => {
  const { $ } = await boot(t);
  click($('#sys-list .db-entry[data-panel="notes"]'));
  assert.match($('#sys-side').textContent, /決めたことと理由と、まだ決まっていないこと（答えのある行も）は、システムの説明書（PDF）の最後のページに入ります（⑤ の行は入りません）。/);
});
