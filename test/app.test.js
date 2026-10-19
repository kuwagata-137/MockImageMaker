'use strict';
// アプリの画面（mock_v*.html）のテスト。jsdom で起動し、ボタン・キー・テスト用の窓口から動かす。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bootApp, createMainStorage, waitFor } = require('./harness');

const KEY = 'mockimagemaker.v1';
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
function key(app, target, init) {
  const KeyboardEvent = app.window.KeyboardEvent;
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
function setValue(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
const saved = (app) => JSON.parse(app.window.localStorage.getItem(KEY));
const cardNames = (app) => $$(app, '.card-name').map((e) => e.textContent);
// jsdom の中で作った配列・オブジェクトを、Node の値と比べられる形にする
const plain = (v) => JSON.parse(JSON.stringify(v));

async function boot(opts) {
  const app = bootApp(opts);
  const api = await app.api();
  return { app, api };
}

test('ブラウザで開くと、画面設計のない一覧が出る', async (t) => {
  const { app } = await boot();
  t.after(() => app.close());
  assert.match($(app, '#home-cards').textContent, /まだ画面設計がありません/);
  assert.equal(app.window.localStorage.getItem(KEY), null, '何もしなければ保存しない');
});

test('新規作成の窓で名前と作る先を聞き、白紙の画面 1 つで編集の画面を開く', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  click($(app, '[data-action="new"]'));
  const modal = await waitFor(() => $(app, '.modal'));
  click($(app, '[data-dlg="ok"]'));
  assert.match($(app, '.modal-error').textContent, /名前を書いて/, '名前が空なら閉じない');
  setValue($(app, '.modal [name=name]'), '  顧客管理アプリ  ', 'input');
  setValue($(app, '.modal .target-select'), '__other__');
  assert.equal($(app, '.modal .target-other').hidden, false, 'その他を選ぶと名前の欄が出る');
  click($(app, '[data-dlg="ok"]'));
  assert.match($(app, '.modal-error').textContent, /作る先の名前/);
  $(app, '.modal .target-other').value = '社内の受付システム';
  click($(app, '[data-dlg="ok"]'));
  await waitFor(() => api.ui.view === 'editor', { label: '編集の画面' });
  assert.ok(modal);
  const d = api.store.state.designs[0];
  assert.equal(d.name, '顧客管理アプリ');
  assert.equal(d.target, '社内の受付システム');
  assert.equal(d.screens.length, 1);
  assert.deepEqual([d.screens[0].device, d.screens[0].width, d.screens[0].height], ['pc', 1280, 800]);
  assert.deepEqual(saved(app).settings.customTargets, ['社内の受付システム'], 'その他に書いた名前が選択肢に加わる');
  assert.equal($(app, '.screen-band').textContent, '顧客管理アプリ ／ 画面 1');
  assert.ok($(app, '.screen.grid'), '編集中はマス目が見える');
});

test('その他に書いた名前が kintone などと同じなら、そちらを選んだことにする', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  assert.equal(api.resolveTargetName(' Kintone '), 'kintone');
  assert.equal(api.resolveTargetName('claude で作るアプリ'), 'claude');
  const id = api.actions.createDesign('日報アプリ', api.resolveTargetName('SALESFORCE'));
  assert.equal(api.store.state.designs.find((d) => d.id === id).target, 'salesforce');
  assert.deepEqual(plain(api.store.state.settings.customTargets), []);
});

test('一覧: 更新の新しい順に並び、名前で探せる', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const ids = ['顧客管理アプリ', '問い合わせ管理', '備品貸出アプリ'].map((n) => api.actions.createDesign(n, 'kintone'));
  api.store.commit((s) => { s.designs.forEach((d, i) => { d.updatedAt = `2026-10-0${i + 1}T00:00:00.000Z`; }); });
  assert.deepEqual(cardNames(app), ['備品貸出アプリ', '問い合わせ管理', '顧客管理アプリ']);
  setValue($(app, '#home-search'), '管理', 'input');
  assert.deepEqual(cardNames(app), ['問い合わせ管理', '顧客管理アプリ']);
  setValue($(app, '#home-search'), '日報', 'input');
  assert.match($(app, '#home-cards').textContent, /「日報」に当たる画面設計はありません/);
  assert.equal(ids.length, 3);
});

test('カードの「…」から名前の変更と複製ができ、元に戻す・やり直すで戻せる', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  click($(app, `.card-more[data-id="${id}"]`));
  click($(app, `.card-menu [data-action="rename"]`));
  await waitFor(() => $(app, '.modal'));
  assert.equal($(app, '.card-menu'), null, 'メニューは閉じる');
  $(app, '.modal [name=name]').value = '顧客管理アプリ（改）';
  click($(app, '[data-dlg="ok"]'));
  await waitFor(() => cardNames(app)[0] === '顧客管理アプリ（改）', { label: '名前の変更' });
  click($(app, '.brandbar [data-action="undo"]'));
  assert.deepEqual(cardNames(app), ['顧客管理アプリ']);
  click($(app, '.brandbar [data-action="redo"]'));
  assert.deepEqual(cardNames(app), ['顧客管理アプリ（改）']);

  click($(app, `.card-more[data-id="${id}"]`));
  click($(app, `.card-menu [data-action="duplicate"]`));
  const [src, copy] = [api.store.state.designs[0], api.store.state.designs[1]];
  assert.equal(copy.name, '顧客管理アプリ（改） のコピー');
  assert.notEqual(copy.id, src.id);
  assert.notEqual(copy.screens[0].id, src.screens[0].id, '画面の id も新しくする');
  assert.equal(saved(app).designs.length, 2);
});

test('キー: 入力欄の外の Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z はアプリの元に戻す・やり直す。入力欄の中では動かない', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  api.actions.createDesign('顧客管理アプリ', 'kintone');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(api.store.state.designs.length, 0);
  key(app, app.document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
  assert.equal(api.store.state.designs.length, 1);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  key(app, app.document.body, { key: 'y', ctrlKey: true });
  assert.equal(api.store.state.designs.length, 1);
  key(app, $(app, '#home-search'), { key: 'z', ctrlKey: true });
  assert.equal(api.store.state.designs.length, 1, '入力欄の中の Ctrl+Z は文字の取り消しに任せる');
});

test('ごみ箱: 移す・戻す・完全に削除（完全に削除は戻せず、履歴も空になる）', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const a = api.actions.createDesign('顧客管理アプリ', 'kintone');
  const b = api.actions.createDesign('日報アプリ', 'claude');
  click($(app, `.card-more[data-id="${a}"]`));
  click($(app, `.card-menu [data-action="trash"]`));
  assert.deepEqual(cardNames(app), ['日報アプリ']);
  assert.match($(app, '.trash-toggle').textContent, /ごみ箱（1）/);
  click($(app, '.trash-toggle'));
  click($(app, `.trash-row [data-action="restore"][data-id="${a}"]`));
  assert.equal(cardNames(app).length, 2);
  api.actions.trashDesign(a);
  api.actions.trashDesign(b);
  click($(app, `.trash-row [data-action="delete-forever"][data-id="${a}"]`));
  await waitFor(() => $(app, '.modal'));
  click($(app, '[data-dlg="ok"]'));
  await waitFor(() => !api.store.state.designs.some((d) => d.id === a), { label: '完全に削除' });
  assert.equal(api.store.canUndo(), false, '完全に削除したら元に戻せない');
  assert.deepEqual(saved(app).designs.map((d) => d.id), [b]);
  assert.match($(app, '.trash-toggle').textContent, /ごみ箱（1）/);
});

test('画面設計を開くときと一覧へ戻るときに、元に戻すの履歴を空にする', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  assert.equal(api.store.canUndo(), true);
  click($(app, `.card-open[data-id="${id}"]`));
  assert.equal(api.ui.view, 'editor');
  assert.equal(api.store.canUndo(), false);
  api.actions.updateDesignInfo(id, { description: '顧客の連絡先を管理する' });
  assert.equal(api.store.canUndo(), true);
  click($(app, '[data-action="home"]'));
  assert.equal(api.ui.view, 'home');
  assert.equal(api.store.canUndo(), false);
});

test('編集の画面: 右の欄で画面設計の情報と画面の設定を変えられる', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.openDesign(id);
  setValue($(app, '[data-field="design-name"]'), '顧客管理');
  setValue($(app, '[data-field="screen-name"]'), '新規登録');
  assert.equal($(app, '.screen-band').textContent, '顧客管理 ／ 新規登録');
  assert.match($(app, '#ed-title').textContent, /顧客管理（kintone）/);
  setValue($(app, '[data-field="design-name"]'), '   ');
  assert.equal($(app, '[data-field="design-name"]').value, '顧客管理', '空の名前は戻す');
  setValue($(app, '[data-field="design-desc"]'), '顧客の連絡先を管理する');
  setValue($(app, '#side-panel .target-select'), 'b:salesforce');
  const d = api.store.state.designs[0];
  assert.deepEqual([d.name, d.description, d.target], ['顧客管理', '顧客の連絡先を管理する', 'salesforce']);

  const radio = $(app, '[data-field="device"][value="phone"]');
  radio.checked = true;
  radio.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(api.store.state.designs[0].screens[0].width, 375);
  assert.match($(app, '.screen').getAttribute('style'), /width:375px;height:667px/);
  const box = $(app, '[data-field="screen-header"]');
  box.checked = false;
  box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal($(app, '.screen-band'), null, '帯を消せる');
  click($(app, '#tb-undo'));
  assert.ok($(app, '.screen-band'), '元に戻すで帯が戻る');
});

test('画面の高さ: 8 ドットずつ・機器の 1 画面分より低くならない・機器を変えても伸ばした分は残る', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  assert.equal(api.snapHeight(805, 'pc'), 808);
  assert.equal(api.snapHeight(500, 'pc'), 800);
  assert.equal(api.snapHeight(670, 'phone'), 667);
  assert.equal(api.snapHeight(672, 'phone'), 675);
  const sc = { device: 'pc', width: 1280, height: 1200 };
  assert.deepEqual(plain(api.changeDevice(sc, 'tablet')), { device: 'tablet', width: 768, height: 1424 });
  assert.deepEqual(plain(api.changeDevice(api.changeDevice(sc, 'tablet'), 'pc')), sc);

  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.openDesign(id);
  const handle = $(app, '[data-drag="resize"]');
  const M = app.window.MouseEvent;
  handle.dispatchEvent(new M('mousedown', { bubbles: true, button: 0, clientY: 500 }));
  app.document.dispatchEvent(new M('mousemove', { bubbles: true, clientY: 600 }));
  assert.match($(app, '.screen-size').textContent, /1280 × 904/, 'ドラッグ中も高さが見える');
  assert.equal(api.store.state.designs[0].screens[0].height, 800, 'ドラッグ中はまだ保存しない');
  app.document.dispatchEvent(new M('mouseup', { bubbles: true }));
  assert.equal(api.store.state.designs[0].screens[0].height, 904);
  assert.equal(saved(app).designs[0].screens[0].height, 904);
  handle.ownerDocument.querySelector('[data-drag="resize"]').dispatchEvent(new M('mousedown', { bubbles: true, button: 0, clientY: 500 }));
  app.document.dispatchEvent(new M('mousemove', { bubbles: true, clientY: 100 }));
  app.document.dispatchEvent(new M('mouseup', { bubbles: true }));
  assert.equal(api.store.state.designs[0].screens[0].height, 800, '1 画面分より低くはならない');
});

test('拡大縮小とモード: ボタン・キー・100% に戻す', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  api.openDesign(api.actions.createDesign('顧客管理アプリ', 'kintone'));
  click($(app, '[data-action="zoom-out"]'));
  click($(app, '[data-action="zoom-out"]'));
  assert.equal(api.ui.zoom, 0.8);
  assert.equal($(app, '#zoom-label').textContent, '80%');
  assert.match($(app, '#stage').style.transform, /scale\(0\.8\)/);
  key(app, app.document.body, { key: '+', ctrlKey: true });
  assert.equal(api.ui.zoom, 0.9);
  key(app, app.document.body, { key: '0', ctrlKey: true });
  assert.equal(api.ui.zoom, 1);
  for (let i = 0; i < 30; i++) api.runCommand('zoomIn');
  assert.equal(api.ui.zoom, 2, '200% で止まる');
  click($(app, '[data-action="mode-hand"]'));
  assert.equal(api.ui.mode, 'hand');
  assert.ok($(app, '#canvas-wrap').classList.contains('hand'));
  assert.ok($(app, '#tb-mode-hand').classList.contains('on'));
});

test('データの形: 読み込むときに足りない項目を補い、知らない項目は残す', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const { state, blockReason } = api.migrate({ designs: [{ id: 'd1', name: '顧客管理', extra: 'x', screens: [{ id: 's1', device: 'zzz', height: 10 }] }], future: 1 });
  assert.equal(blockReason, null);
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.future, 1);
  assert.deepEqual(plain(state.settings.customTargets), []);
  const d = state.designs[0];
  assert.equal(d.extra, 'x');
  assert.deepEqual(plain([d.target, d.description, d.trashedAt, d.revisions, d.items]), ['', '', null, [], []]);
  assert.deepEqual([d.screens[0].device, d.screens[0].width, d.screens[0].height, d.screens[0].showHeader], ['pc', 1280, 800, true]);
  assert.equal(api.migrate(null).blockReason, null);
  assert.ok(api.migrate([]).blockReason);
  assert.equal(api.migrate({ schemaVersion: 2, designs: [] }).blockReason, null);
  assert.equal(api.migrate({ schemaVersion: 3, designs: [] }).blockReason, null);
  assert.ok(api.migrate({ schemaVersion: 4, designs: [] }).blockReason, 'この版より新しいデータの形');
});

test('新しい版のデータ・壊れたデータを読んだときは、警告を出して保存しない', async (t) => {
  for (const raw of [JSON.stringify({ schemaVersion: 99, designs: [] }), '{broken']) {
    const { app, api } = await boot({ localStorage: { [KEY]: raw } });
    assert.equal($(app, '#banner').hidden, false);
    assert.match($(app, '#banner').textContent, /保存を止めています/);
    api.actions.createDesign('顧客管理アプリ', 'kintone');
    assert.equal(app.window.localStorage.getItem(KEY), raw, '元のデータを上書きしない');
    app.close();
  }
  t.diagnostic('2 通りとも確かめた');
});

test('Electron: designs.json に保存し、起動し直しても残る。アプリのメニューの命令も受ける', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  const first = await boot({ storage: st });
  const id = first.api.actions.createDesign('顧客管理アプリ', 'kintone');
  first.api.actions.renameDesign(id, '顧客管理');
  first.app.menuCommand('undo');
  assert.equal(first.api.store.state.designs[0].name, '顧客管理アプリ', 'メニューの「元に戻す」');
  first.app.menuCommand('redo');
  await first.api.store.adapter.pending;
  await st.whenIdle();
  const file = JSON.parse(fs.readFileSync(path.join(st.dataDir, 'designs.json'), 'utf8'));
  assert.equal(file.designs[0].name, '顧客管理');
  assert.equal(first.app.window.localStorage.getItem(KEY), null, 'localStorage には書かない');
  first.app.close();

  const second = await boot({ storage: st });
  t.after(() => second.app.close());
  assert.deepEqual(cardNames(second.app), ['顧客管理']);
  second.api.openDesign(id);
  second.app.menuCommand('zoomIn');
  assert.equal(second.api.ui.zoom, 1.1);
  second.app.menuCommand('goHome');
  assert.equal(second.api.ui.view, 'home');
});

test('Electron: designs.json も .bak も読めないときは、警告を出して保存しない', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  fs.mkdirSync(st.dataDir, { recursive: true });
  const file = path.join(st.dataDir, 'designs.json');
  fs.writeFileSync(file, '{broken');
  fs.writeFileSync(file + '.bak', '{broken too');
  const { app, api } = await boot({ storage: st });
  t.after(() => app.close());
  assert.equal($(app, '#banner').hidden, false);
  assert.match($(app, '#banner').textContent, /読めません.*保存を止めています/);
  api.actions.createDesign('顧客管理アプリ', 'kintone');
  await st.whenIdle();
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken', '読めないファイルを上書きしない');
});

test('Electron: designs.json が壊れていて .bak が読めるときは、知らせを出して続ける', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  fs.mkdirSync(st.dataDir, { recursive: true });
  const file = path.join(st.dataDir, 'designs.json');
  const good = { schemaVersion: 1, settings: { customTargets: [] }, designs: [{ id: 'd1', name: '日報アプリ', target: 'kintone' }] };
  fs.writeFileSync(file, '{broken');
  fs.writeFileSync(file + '.bak', JSON.stringify(good));
  const { app, api } = await boot({ storage: st });
  t.after(() => app.close());
  assert.match($(app, '#banner').textContent, /1 つ前の保存（.bak）から読み込みました/);
  assert.doesNotMatch($(app, '#banner').textContent, /保存を止めています/);
  assert.deepEqual(cardNames(app), ['日報アプリ']);
  api.actions.renameDesign('d1', '日報');
  await api.store.adapter.pending;
  await st.whenIdle();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).designs[0].name, '日報');
});

test('小さな窓: 危ない窓はキャンセルにフォーカスを置き、ボタンの上の Enter では OK にしない。後ろの画面は押せない', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.actions.trashDesign(id);
  click($(app, '.trash-toggle'));
  click($(app, '[data-action="delete-forever"]'));
  await waitFor(() => $(app, '.modal'));
  const cancel = $(app, '[data-dlg="cancel"]');
  assert.equal(app.document.activeElement, cancel, '「キャンセル」にフォーカスがある');
  key(app, cancel, { key: 'Enter' });
  assert.ok($(app, '.modal'), 'ボタンの上の Enter は窓の OK にならない');
  assert.ok(api.store.state.designs.some((d) => d.id === id));
  assert.ok($(app, '#app').hasAttribute('inert'), '後ろの画面は押せない');
  click($(app, '#app [data-action="delete-forever"]'));
  assert.equal($$(app, '.modal').length, 1, '窓は 1 つだけ');
  key(app, cancel, { key: 'Escape' });
  await waitFor(() => !$(app, '.modal'), { label: '窓が閉じる' });
  assert.equal($(app, '#app').hasAttribute('inert'), false);
  assert.ok(api.store.state.designs.some((d) => d.id === id), '完全に削除されていない');
});

test('小さな窓: ボタンは Windows の決まりで、肯定を左・取りやめを右に並べる（最初のフォーカスは並びと別に決める）', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const order = () => $$(app, '.modal .modal-actions button').map((b) => b.dataset.dlg);
  const closeDialog = async () => {
    click($(app, '.modal [data-dlg="cancel"]'));
    await waitFor(() => !$(app, '.modal'), { label: '窓が閉じる' });
  };
  // 危ない操作の窓: ［完全に削除する］［キャンセル］の並び。フォーカスはキャンセルのまま
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.actions.trashDesign(id);
  click($(app, '.trash-toggle'));
  click($(app, '[data-action="delete-forever"]'));
  await waitFor(() => $(app, '.modal'));
  assert.deepEqual(order(), ['ok', 'cancel'], '肯定が左、キャンセルが右');
  assert.equal($(app, '.modal [data-dlg="ok"]').textContent, '完全に削除する');
  assert.equal(app.document.activeElement, $(app, '.modal [data-dlg="cancel"]'), '危ない窓のフォーカスはキャンセル');
  await closeDialog();
  // ふつうの窓（画面を足す）: ［足す］［キャンセル］の並び。フォーカスは肯定のボタン
  api.actions.restoreDesign(id);
  api.openDesign(id);
  api.runCommand('addScreen');
  await waitFor(() => $(app, '.modal'));
  assert.deepEqual(order(), ['ok', 'cancel']);
  assert.equal($(app, '.modal [data-dlg="ok"]').textContent, '足す');
  assert.equal(app.document.activeElement, $(app, '.modal [data-dlg="ok"]'), 'ふつうの窓のフォーカスは肯定のボタン');
  await closeDialog();
  // 「閉じる」だけの窓（改訂履歴）: OK は隠し、閉じるにフォーカス
  api.runCommand('openRevisions');
  await waitFor(() => $(app, '.modal'));
  assert.deepEqual(order(), ['ok', 'cancel']);
  assert.equal($(app, '.modal [data-dlg="ok"]').hidden, true);
  assert.equal(app.document.activeElement, $(app, '.modal [data-dlg="cancel"]'), '「閉じる」だけの窓のフォーカスは閉じる');
  await closeDialog();
});

test('小さな窓: 名前の欄で Enter を押すと OK になる', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  click($(app, `.card-more[data-id="${id}"]`));
  click($(app, '.card-menu [data-action="rename"]'));
  await waitFor(() => $(app, '.modal'));
  const input = $(app, '.modal [name=name]');
  assert.equal(app.document.activeElement, input);
  input.value = '顧客管理';
  key(app, input, { key: 'Enter' });
  await waitFor(() => cardNames(app)[0] === '顧客管理', { label: '名前の変更' });
});

test('右の欄で打ちかけの文字は、高さのドラッグ・一覧へ戻る前に保存される', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.openDesign(id);
  const desc = $(app, '[data-field="design-desc"]');
  desc.focus();
  desc.value = '顧客の連絡先を管理する';
  const M = app.window.MouseEvent;
  $(app, '[data-drag="resize"]').dispatchEvent(new M('mousedown', { bubbles: true, button: 0, clientY: 500 }));
  app.document.dispatchEvent(new M('mousemove', { bubbles: true, clientY: 600 }));
  app.document.dispatchEvent(new M('mouseup', { bubbles: true }));
  const d = () => api.store.state.designs[0];
  assert.equal(d().description, '顧客の連絡先を管理する');
  assert.equal($(app, '[data-field="design-desc"]').value, '顧客の連絡先を管理する', '作り直した欄にも残る');
  assert.equal(d().screens[0].height, 904);

  const name = $(app, '[data-field="screen-name"]');
  name.focus();
  name.value = '新規登録';
  api.runCommand('goHome');
  assert.equal(d().screens[0].name, '新規登録');
});

test('アプリのメニュー（main.js）の命令は、どれもアプリの画面の runCommand で受ける名前', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files.find((f) => f.endsWith('.html'))), 'utf8');
  const cmds = [...main.matchAll(/commandItem\('[^']+', '([A-Za-z]+)'/g)].map((m) => m[1]);
  ['selectAll', 'alignLeft', 'sameHeight', 'openItems', 'openMap', 'addItemMenu', 'importItems'].forEach((c) => assert.ok(cmds.includes(c), `メニューに ${c}`));
  const body = html.slice(html.indexOf('function runCommand('), html.indexOf('const ALIGN_COMMANDS = {'));
  const alignNames = html.match(/const ALIGN_COMMANDS = \{([\s\S]*?)\};/)[1].split(',').map((s) => s.split(':')[0].trim());
  cmds.forEach((c) => assert.ok(body.includes(`case '${c}'`) || alignNames.includes(c), `runCommand が ${c} を受ける`));
});

test('アプリのメニューから: 部品をすべて選んで揃える・項目の一覧表とつながりの図を開く・取り込む窓を開く', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  const { app, api } = await boot({ storage: st });
  t.after(() => app.close());
  const did = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(did);
  const sid = api.currentScreen().id;
  [[160, 48], [40, 160]].forEach(([x, y]) => api.actions.addPart(did, sid, 'text1', { x, y }));
  app.menuCommand('selectAll');
  assert.equal(api.ui.sel.length, 2);
  app.menuCommand('alignLeft');
  assert.deepEqual([...api.currentScreen().parts].map((p) => p.x), [160, 160], '最初に選んだもの（上から下の順の最初）に合わせる');
  app.menuCommand('openItems');
  assert.equal(api.ui.panel, 'items');
  app.menuCommand('addItemMenu');
  assert.ok($(app, '#db-view .pop-menu'), '項目を足す種類のメニュー');
  app.menuCommand('openMap');
  assert.equal(api.ui.panel, 'map');
  app.menuCommand('importItems');
  assert.ok($(app, '.modal.wide'), 'ほかのモックから取り込む窓');
  click($(app, '.modal [data-dlg="cancel"]'));
  await new Promise((r) => setTimeout(r, 0));
  // 保存が済むのを待ってから閉じる（閉じた後に保存の処理が画面を触らないように）
  await api.store.adapter.pending;
  await st.whenIdle();
});

// 第 9 段階の見直し（T9）: フォーカスが見えない radio・checkbox に残っていても、元に戻す・やり直すは効く（どの画面でも）。
// 文字の欄の中の Ctrl+Z は、今までどおりブラウザの文字の取り消しに任せる
// （編集の画面の右の欄は、押した後に描き直してフォーカスが外れることが多いので、キーを radio・checkbox の上で起こして確かめる）
test('編集の画面の右の欄: 機器（radio）・帯（checkbox）の上の Ctrl+Z・Ctrl+Y も効く。文字の欄の中の Ctrl+Z は効かせない', async (t) => {
  const { app, api } = await boot();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(id);
  const width = () => api.store.state.designs[0].screens[0].width;
  const radio = $(app, '[data-field="device"][value="phone"]');
  radio.checked = true;
  radio.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(width(), 375);
  key(app, $(app, '[data-field="device"][value="phone"]'), { key: 'z', ctrlKey: true });
  assert.equal(width(), 1280);
  key(app, $(app, '[data-field="device"][value="pc"]'), { key: 'y', ctrlKey: true });
  assert.equal(width(), 375);
  const box = $(app, '[data-field="screen-header"]');
  box.checked = false;
  box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(api.store.state.designs[0].screens[0].showHeader, false);
  key(app, $(app, '[data-field="screen-header"]'), { key: 'z', ctrlKey: true });
  assert.equal(api.store.state.designs[0].screens[0].showHeader, true);
  key(app, $(app, '[data-field="screen-name"]'), { key: 'z', ctrlKey: true });
  assert.equal(width(), 375, '文字の欄の中では元に戻さない（機器の変更が残る）');
});
