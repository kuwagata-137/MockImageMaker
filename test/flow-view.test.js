'use strict';
// 第 8 段階の図の画面のテスト: 左の一覧の「ステータスの移り方」「画面の移り方」から、真ん中に 2 つの図を出す（画像 q54 の案B・q55 の案A・q58）。
// 画面設計の名前は架空の業務（出張申請・経費精算）だけを使う。

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function mouseAt(app, target, type, x, y) {
  target.dispatchEvent(new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}
// 箱を (dx, dy) だけドラッグする。0, 0 なら動かさずに放す（押しただけ）
function dragNode(app, el, dx, dy) {
  mouseAt(app, el, 'mousedown', 100, 100);
  if (dx || dy) mouseAt(app, app.document, 'mousemove', 100 + dx, 100 + dy);
  mouseAt(app, app.document, 'mouseup', 100 + dx, 100 + dy);
}

// 出張申請（一覧・詳細）と経費精算（精算の入力）を作り、出張申請を開いた状態で起動する
async function boot(t) {
  const app = bootApp();
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
  let y = 80;
  const put = (did, sid, type, props, label) => {
    const id = api.actions.addPart(did, sid, type, { x: 40, y: (y += 48) });
    api.actions.updatePart(did, sid, id, { ...(label ? { label } : {}), ...(props ? { props } : {}) });
    return id;
  };
  api.openDesign(A);
  const entry = (action) => $(app, `#screen-list .db-entry[data-action="${action}"]`);
  const node = (key) => $(app, `#db-view .mnode[data-node="${key}"]`);
  const status = () => d(A).items.find((x) => x.type === 'status');
  return { app, api, A, B, a1, a2, b1, d, put, entry, node, status };
}

test('左の一覧の「ステータスの移り方」「画面の移り方」: 操作の数と移る先の数を書き、押すと真ん中に図を出す', async (t) => {
  const { app, api, A, B, a1, a2, b1, put, entry } = await boot(t);
  assert.match(entry('open-process').textContent, /ステータスの移り方\s*ステータスなし/);
  assert.match(entry('open-flow').textContent, /画面の移り方\s*移る先なし/);
  put(A, a2, 'status');
  put(A, a1, 'button', { to: 'screen', screenId: a2 }, '詳細を見る');
  put(A, a2, 'link', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  put(A, a2, 'button', { to: 'screen', screenId: 's-nai' }, 'ない画面へ'); // ない画面を指す移る先は数えない
  assert.match(entry('open-process').textContent, /操作 4 つ/);
  assert.match(entry('open-flow').textContent, /移る先 2 本/);
  // ステータスの移り方
  click(entry('open-process'));
  assert.equal(api.ui.panel, 'process');
  assert.ok(entry('open-process').classList.contains('active'));
  assert.equal($(app, '#canvas-wrap').hidden, true);
  assert.equal($(app, '#db-view').hidden, false);
  assert.match($(app, '#db-view h3').textContent, /ステータスの移り方（出張申請）/);
  assert.match($(app, '#db-view .map-head').textContent, /先へ進む操作.*前へ戻る操作/);
  assert.equal($$(app, '#db-view .map-inner[data-view="process"] .mnode').length, 4);
  assert.ok($(app, '#db-view .itable').classList.contains('wide'), '図の画面では表の幅の上限を外す');
  // 図を出している間も右の欄を出し、ステータスと操作を直せる（部品の箱は出さない）
  assert.equal($(app, '#side-panel').hidden, false);
  assert.equal($(app, '#side-box').hidden, true);
  assert.match($(app, '#side-settings .panel-title').textContent, /ステータスと操作（出張申請）/);
  assert.equal($$(app, '#side-settings [data-ps]').length, 4);
  assert.equal($(app, '#side-settings [data-action="delete-item"]'), null, '項目を消すボタンは出さない');
  // 画面の移り方
  click(entry('open-flow'));
  assert.equal(api.ui.panel, 'flow');
  assert.ok(entry('open-flow').classList.contains('active'));
  assert.match($(app, '#db-view h3').textContent, /画面の移り方（出張申請）/);
  assert.match($(app, '#db-view .map-head').textContent, /ボタン.*リンクの文字.*ほかの画面設計の画面/);
  assert.deepEqual(plain($$(app, '#db-view .map-inner[data-view="flow"] .mnode').map((n) => n.dataset.node)), ['s:' + a1, 's:' + a2, `x:${B}/${b1}`]);
  assert.ok($(app, '#db-view .itable').classList.contains('wide'));
  assert.equal($(app, '#side-panel').hidden, true, '画面の移り方の図では、つながりの図と同じく右の欄を隠す');
  // 画面の縮小画像を押すと、その画面に戻る
  click($(app, `#screen-list .sl-item[data-id="${a1}"]`));
  assert.equal(api.ui.panel, 'screen');
});

test('ステータスの移り方の図: ステータスの項目がまだないときは、図の所と右の欄に案内の文を出す', async (t) => {
  const { app, entry } = await boot(t);
  click(entry('open-process'));
  assert.match($(app, '#db-view .map-empty').textContent, /ステータスの項目がまだありません/);
  assert.equal($(app, '#side-panel').hidden, false);
  assert.match($(app, '#side-settings').textContent, /ステータスの項目がまだありません/);
});

test('命令 openProcess・openFlow とアプリのメニュー「項目」で図を開く', async (t) => {
  const { api } = await boot(t);
  assert.equal(api.runCommand('openProcess'), true);
  assert.equal(api.ui.panel, 'process');
  assert.equal(api.runCommand('openFlow'), true);
  assert.equal(api.ui.panel, 'flow');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /commandItem\('ステータスの移り方を開く', 'openProcess'\)/);
  assert.match(main, /commandItem\('画面の移り方を開く', 'openFlow'\)/);
});

test('右の欄でステータスの名前を直すと、ステータスの移り方の図の箱もすぐ変わる', async (t) => {
  const { app, A, a2, put, entry, node, status } = await boot(t);
  put(A, a2, 'status');
  click(entry('open-process'));
  const id = status().props.states[0].id;
  setValue($(app, `#side-settings [data-ps="${id}"]`), '下書き');
  assert.equal(status().props.states[0].name, '下書き');
  assert.match(node('t:' + id).textContent, /1　下書き/);
});

test('図の箱のドラッグ: ステータスの図は processPos、画面の図は flowPos に位置を覚える。「自動で並べ直す」で消す', async (t) => {
  const { app, api, A, B, a1, b1, d, put, entry, node, status } = await boot(t);
  put(A, a1, 'status');
  put(A, a1, 'link', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  click(entry('open-process'));
  const key = 't:' + status().props.states[1].id;
  const x0 = parseFloat(node(key).style.left);
  const y0 = parseFloat(node(key).style.top);
  dragNode(app, node(key), 40, 24);
  const snap = (v) => Math.round(v / 8) * 8; // 位置は 8 ドットのマス目に吸い付く
  assert.deepEqual(plain(d(A).processPos[key]), { x: snap(x0 + 40), y: snap(y0 + 24) });
  assert.equal(parseFloat(node(key).style.top), snap(y0 + 24), '描き直しても覚えた位置');
  assert.deepEqual(plain(d(A).flowPos), {}, '画面の図の位置は変えない');
  assert.deepEqual(plain(d(A).mapPos), {}, 'つながりの図の位置は変えない');
  click($(app, '#db-view [data-action="view-reset"]'));
  assert.deepEqual(plain(d(A).processPos), {});
  // 画面の移り方の図（ほかの画面設計の画面の箱も動かせる）
  click(entry('open-flow'));
  const ext = `x:${B}/${b1}`;
  const ex0 = parseFloat(node(ext).style.left);
  dragNode(app, node(ext), 80, 0);
  assert.deepEqual(plain(d(A).flowPos[ext]), { x: snap(ex0 + 80), y: parseFloat(node(ext).style.top) });
  assert.deepEqual(plain(d(A).processPos), {});
  // 元に戻す（Ctrl+Z）で位置も戻る
  api.runCommand('undo');
  assert.deepEqual(plain(d(A).flowPos), {});
});

test('図の箱を押す: 画面の図はその画面を開き、ほかの画面設計の画面はその画面設計のその画面を開く。ステータスの図は何もしない', async (t) => {
  const { app, api, A, B, a1, a2, b1, put, entry, node, status } = await boot(t);
  put(A, a2, 'status');
  const b2 = api.actions.addScreen(B, 'blank', b1);
  put(A, a1, 'button', { to: 'screen', designId: B, screenId: b2 }, '精算の一覧へ');
  click(entry('open-process'));
  dragNode(app, node('t:' + status().props.states[0].id), 0, 0);
  assert.equal(api.ui.panel, 'process');
  click(entry('open-flow'));
  dragNode(app, node('s:' + a2), 0, 0);
  assert.equal(api.ui.panel, 'screen');
  assert.equal(api.ui.screenId, a2);
  click(entry('open-flow'));
  dragNode(app, node(`x:${B}/${b2}`), 0, 0);
  assert.equal(api.currentDesign().id, B);
  assert.equal(api.ui.panel, 'screen');
  assert.equal(api.ui.screenId, b2);
});

test('前の版を見ている間: 2 つの図は見られるが、箱は動かせず、「自動で並べ直す」と右の欄は押せない', async (t) => {
  const { app, api, A, a1, a2, d, put, entry, node, status } = await boot(t);
  put(A, a2, 'status');
  put(A, a1, 'button', { to: 'screen', screenId: a2 }, '詳細を見る');
  const rev = api.actions.addRevision(A, { note: '第 1 版' });
  api.actions.updateScreen(A, a2, { name: '詳細の画面' });
  assert.ok(api.startViewRevision(rev));
  // 前の版を見ている間も、左の一覧の入口は押せる（mousedown で切り替える）
  mouseAt(app, entry('open-process'), 'mousedown', 10, 10);
  assert.equal(api.ui.panel, 'process');
  const key = 't:' + status().props.states[0].id;
  const x0 = parseFloat(node(key).style.left);
  dragNode(app, node(key), 40, 0);
  assert.equal(parseFloat(node(key).style.left), x0);
  assert.deepEqual(plain(d(A).processPos), {});
  assert.equal($(app, '#db-view [data-action="view-reset"]').disabled, true);
  assert.ok($$(app, '#side-settings [data-ps]').every((x) => x.disabled), 'ステータスの欄は押せない');
  mouseAt(app, entry('open-flow'), 'mousedown', 10, 10);
  assert.equal(api.ui.panel, 'flow');
  assert.match(node('s:' + a2).textContent, /^詳細パソコン/, '前の版の画面の名前で描く');
  assert.equal(api.runCommand('openProcess'), true);
  assert.equal(api.ui.panel, 'process', '前の版を見ている間も命令で開ける');
  assert.equal(api.store.isViewing, true);
});

// ── 見直し（第 8 段階）で見つけた不具合 ──
test('左の一覧の「画面の移り方」の数: 自分の画面を指す移る先は数えない（図にも描かず、出力の窓でも「移る先がない」と同じ）', async (t) => {
  const { a1, A, put, entry, api, d } = await boot(t);
  put(A, a1, 'button', { to: 'screen', screenId: a1 }, '自分へ');
  assert.match(entry('open-flow').textContent, /移る先なし/);
  assert.equal(api.hasFlowPage(d(A), api.store.state), false);
});
