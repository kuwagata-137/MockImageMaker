'use strict';
// v1.05: 編集の画面と 3 つの図（関連図・ステータスの流れ・画面遷移図）の手のひらツール・拡大縮小・マウスの左右のボタンの同時押しのテスト。
// 画面設計の名前は架空の業務（出張申請）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const $ = (app, sel) => app.document.querySelector(sel);
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 5));
function mouse(app, target, type, o = {}) {
  const ev = new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: 100, clientY: 100, ...o });
  target.dispatchEvent(ev);
  return ev;
}
function wheel(app, target, o = {}) {
  const ev = new app.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ...o });
  target.dispatchEvent(ev);
  return ev;
}
// 左右のボタンの同時押し（first を先に押し、もう片方を押して、両方を離す）
async function chord(app, target, first = 'left') {
  const [b1, b2] = first === 'left' ? [0, 2] : [2, 0];
  mouse(app, target, 'mousedown', { button: b1, buttons: b1 === 0 ? 1 : 2 });
  const second = mouse(app, target, 'mousedown', { button: b2, buttons: 3 });
  mouse(app, app.document, 'mouseup', { button: b2, buttons: b1 === 0 ? 1 : 2 });
  const menu = mouse(app, target, 'contextmenu', { button: 2 });
  mouse(app, app.document, 'mouseup', { button: b1, buttons: 0 });
  await tick();
  return { second, menu };
}

// 出張申請（一覧・詳細。一覧のボタンから詳細へ移る）を作り、開いた状態で起動する
async function boot(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const A = api.actions.createDesign('出張申請', 'kintone');
  const d = () => api.store.state.designs.find((x) => x.id === A);
  const a1 = d().screens[0].id;
  api.actions.updateScreen(A, a1, { name: '一覧' });
  const a2 = api.actions.addScreen(A, 'blank', a1);
  api.actions.updateScreen(A, a2, { name: '詳細' });
  const btn = api.actions.addPart(A, a1, 'button', { x: 40, y: 120 });
  api.actions.updatePart(A, a1, btn, { label: '詳細を見る', props: { to: 'screen', screenId: a2 } });
  api.openDesign(A);
  return { app, api, A, a1, a2, btn, d };
}

test('ツールバーの組「モード」「表示」: 画面と 3 つの図を開いている間は押せ、項目一覧の間は押せない', async (t) => {
  const { app, api } = await boot(t);
  const disabled = () => ['#tb-mode-select', '#tb-mode-hand', '#toolbar [data-action="zoom-in"]', '#toolbar [data-action="zoom-out"]', '#zoom-label'].map((s) => $(app, s).disabled);
  assert.deepEqual(disabled(), [false, false, false, false, false], '画面');
  for (const cmd of ['openMap', 'openProcess', 'openFlow']) {
    api.runCommand(cmd);
    assert.equal(api.isDiagramPanel(), true);
    assert.deepEqual(disabled(), [false, false, false, false, false], cmd);
  }
  api.runCommand('openItems');
  assert.equal(api.isDiagramPanel(), false);
  assert.deepEqual(disabled(), [true, true, true, true, true], '項目一覧');
});

test('3 つの図の手のひらツール: 命令 modeHand で入り、Esc で選択に戻る。何もない所のドラッグは図を動かす（ボックスは動かさない）', async (t) => {
  const { app, api, d, A } = await boot(t);
  api.runCommand('openFlow');
  assert.equal(api.runCommand('modeHand'), true);
  assert.equal(api.ui.mode, 'hand');
  assert.equal($(app, '#tb-mode-hand').classList.contains('on'), true);
  assert.equal($(app, '#db-view').classList.contains('hand'), true);
  const box = $(app, '#design-map');
  mouse(app, box, 'mousedown', { buttons: 1 });
  assert.equal(box.classList.contains('grabbing'), true, 'ドラッグの間は、つかんだ手のカーソル');
  mouse(app, app.document, 'mousemove', { buttons: 1, clientX: 60, clientY: 80 });
  mouse(app, app.document, 'mouseup');
  assert.equal(box.classList.contains('grabbing'), false);
  assert.deepEqual(plain(d().flowPos), {}, 'ボックスの位置は変えない');
  assert.equal(api.ui.designId, A);
  app.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(api.ui.mode, 'select');
  assert.equal($(app, '#db-view').classList.contains('hand'), false);
});

test('3 つの図の拡大縮小: 図の倍率 ui.mapZoom だけを変え、画面の倍率 ui.zoom は変えない。図は transform で拡大し、倍率を掛けた大きさの枠で包む', async (t) => {
  const { app, api, a1 } = await boot(t);
  const zoom0 = api.ui.zoom;
  api.runCommand('openFlow');
  const inner = () => $(app, '#design-map .map-zoom > .map-inner');
  assert.ok(inner(), '100% でも枠で包む');
  assert.equal(inner().style.transform, '');
  assert.equal(api.runCommand('zoomIn'), true);
  assert.equal(api.ui.mapZoom, 1.1);
  assert.equal(api.ui.zoom, zoom0);
  assert.equal(inner().style.transform, 'scale(1.1)');
  assert.equal(parseFloat(inner().parentNode.style.width), Math.round(parseFloat(inner().style.width) * 1.1));
  assert.equal($(app, '#zoom-label').textContent, '110%');
  api.runCommand('zoomOut');
  api.runCommand('zoomOut');
  assert.equal(api.ui.mapZoom, 0.9);
  // 図を描き直しても倍率は残る（ほかの図へ移っても同じ倍率）
  api.runCommand('openProcess');
  api.runCommand('openFlow');
  assert.equal(inner().style.transform, 'scale(0.9)');
  api.runCommand('zoomReset');
  assert.equal(api.ui.mapZoom, 1);
  assert.equal($(app, '#zoom-label').textContent, '100%');
  // 画面へ戻ると、表示は画面の倍率
  api.ui.mapZoom = 1.5;
  api.openScreen(a1);
  assert.equal(api.isDiagramPanel(), false);
  assert.equal($(app, '#zoom-label').textContent, Math.round(api.ui.zoom * 100) + '%');
});

test('3 つの図のホイール: 選択のモードでは Ctrl＋ホイールだけ、手のひらツールではホイールだけで拡大縮小する', async (t) => {
  const { app, api } = await boot(t);
  api.runCommand('openFlow');
  const box = $(app, '#design-map');
  assert.equal(wheel(app, box).defaultPrevented, false, '選択のモードのホイールは、ふつうのスクロール');
  assert.equal(api.ui.mapZoom, 1);
  assert.equal(wheel(app, box, { ctrlKey: true }).defaultPrevented, true);
  assert.equal(api.ui.mapZoom, 1.1);
  api.runCommand('modeHand');
  wheel(app, box);
  assert.equal(api.ui.mapZoom, 1.2);
  wheel(app, box, { deltaY: 100 });
  wheel(app, box, { deltaY: 100 });
  assert.equal(api.ui.mapZoom, 1);
});

test('拡大した図のボックスのドラッグ: 動いた量を倍率で割って位置を決める', async (t) => {
  const { app, api, d, a2 } = await boot(t);
  api.runCommand('openFlow');
  for (let i = 0; i < 10; i++) api.runCommand('zoomIn');
  assert.equal(api.ui.mapZoom, 2);
  const node = () => $(app, `#design-map .mnode[data-node="s:${a2}"]`);
  const [x0, y0] = [parseFloat(node().style.left), parseFloat(node().style.top)];
  mouse(app, node(), 'mousedown', { buttons: 1 });
  mouse(app, app.document, 'mousemove', { buttons: 1, clientX: 100 + 160, clientY: 100 + 80 });
  mouse(app, app.document, 'mouseup', { clientX: 260, clientY: 180 });
  assert.deepEqual(plain(d().flowPos['s:' + a2]), { x: x0 + 80, y: y0 + 40 });
  assert.equal(api.ui.panel, 'flow', '動かしたときは、画面を開かない');
});

test('マウスの左右のボタンの同時押し: 3 つの図と編集の画面で、選択 ⇔ 手のひらツール。直後の右クリックのメニューとクリックは効かせない', async (t) => {
  const { app, api, btn, a1, a2, d } = await boot(t);
  // 画面遷移図（左を先に押す・右を先に押す）
  api.runCommand('openFlow');
  const box = $(app, '#design-map');
  let r = await chord(app, box, 'left');
  assert.equal(api.ui.mode, 'hand');
  assert.equal(r.second.defaultPrevented, true);
  assert.equal(r.menu.defaultPrevented, true, '同時押しの右クリックでは、メニューを出さない');
  assert.equal(box.classList.contains('grabbing'), false, '始めていた図のドラッグはやめる');
  r = await chord(app, box, 'right');
  assert.equal(api.ui.mode, 'select', '手のひらツールから選択へも切り替わる');
  // ボックスの上の同時押し: ボックスを動かさず、画面も開かない
  const node = $(app, `#design-map .mnode[data-node="s:${a2}"]`);
  await chord(app, node, 'left');
  assert.equal(api.ui.mode, 'hand');
  assert.equal(api.ui.panel, 'flow');
  assert.deepEqual(plain(d().flowPos), {});
  await chord(app, $(app, `#design-map .mnode[data-node="s:${a2}"]`), 'right');
  assert.equal(api.ui.mode, 'select');
  // 両方のボタンを離した後の右クリックは、今までどおり（止めない）
  assert.equal(mouse(app, box, 'contextmenu', { button: 2 }).defaultPrevented, false);
  // 編集の画面: アイテムの上で同時押しをしても、選ぶものは変えない
  api.openScreen(a1);
  assert.equal(api.ui.panel, 'screen');
  const part = $(app, `#stage .part[data-part-id="${btn}"]`);
  assert.ok(part);
  await chord(app, part, 'right');
  assert.equal(api.ui.mode, 'hand');
  assert.deepEqual(plain(api.ui.sel), [], '右を先に押す同時押しでは、アイテムを選ばない');
  assert.equal($(app, '#canvas-wrap').classList.contains('hand'), true);
  await chord(app, $(app, '#canvas-wrap'), 'left');
  assert.equal(api.ui.mode, 'select', '編集の画面でも、手のひらツールから選択へ切り替わる');
  assert.equal($(app, '#canvas-wrap').classList.contains('grabbing'), false);
  // 項目一覧では切り替えない
  api.runCommand('openItems');
  await chord(app, $(app, '#db-view'), 'left');
  assert.equal(api.ui.mode, 'select');
});
