'use strict';
// 第 9 段階の前半（T6b）: スイムレーン図の上の操作（画像 q63。ビジネスダイアグラムメーカーの操作を写した）と、右の欄の作業の設定のテスト。
// 作業の箱を足す（置き場からドラッグ・置き場を押してから図を押す・何もない所のダブルクリック）・つなぐ（○＋・接続モード）・動かす（ドラッグ。v1.03 から自由な位置とガイドの吸着）・
// 直す（ダブルクリックの文字の欄・右の欄）・消す（Delete・右クリック・メニューバーの「✕ 削除」）・矢印の付け替え・全体を表示。
// jsdom では要素の位置が 0 なので、マウスの位置（clientX・clientY）が、そのまま図の中の位置（倍率 100% のとき）になる。
// 画面設計とシステムの名前は架空の業務（出張申請・社員マスタ）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const fire = (el, type, init = {}) => el.dispatchEvent(new (el.ownerDocument || el).defaultView.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
// 押す（押して放す。ブラウザと同じく click も送る）。押した時点で図が描き直されて el が外れたときは、放すのは今の文書の上
// （ブラウザでは、放したときのマウスの下の要素に届くため）
function press(el, init = {}) {
  fire(el, 'mousedown', init);
  const live = el.isConnected ? el : el.ownerDocument.body;
  fire(live, 'mouseup', init);
  fire(live, 'click', init);
}
const click = (el) => fire(el, 'click');
function setValue(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
function key(app, target, init) {
  target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name, extra = {}) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-' + id, '一覧')], mapPos: {}, processPos: {}, flowPos: {}, ...extra,
});
const system = (id, name, designIds, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds, roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
const step = (id, roleId, col, kind, text, ref = {}) => ({ id, roleId, col, kind, text, memo: '', ref: { designId: null, screenId: null, stateId: null, ...ref }, src: null });
const edge = (id, from, to, label = '') => ({ id, from, to, label });
const ROLES = [{ id: 'l-a', name: '申請者', memo: '' }, { id: 'l-b', name: '上長', memo: '' }, { id: 'l-c', name: '経理', memo: '' }];
// 出張申請の流れ（作業 8 つ・矢印 8 本）。横向きのレーンは 3 本とも太さ 130: 申請者 0〜130・上長 130〜260・経理 260〜390。
// 列は左の名前の列（136）から 80 おきのガイド線に乗る（列 0〜7 の真ん中: 216・376・616・856・1016・1176・1336・1496）
const STEPS = [
  step('w-1', 'l-a', 0, 'start', '出張が決まる'), step('w-2', 'l-a', 1, 'input', '出張申請を入力する', { designId: 'd-trip', screenId: 's-in' }),
  step('w-3', 'l-b', 2, 'decision', '申請を確かめる'), step('w-4', 'l-b', 3, 'input', '承認する'), step('w-5', 'l-a', 4, 'task', '出張に行く'),
  step('w-6', 'l-c', 5, 'task', '旅費を精算する'), step('w-7', 'l-c', 6, 'doc', '精算書を出す'), step('w-8', 'l-c', 7, 'end', '終わり'),
];
const EDGES = [
  edge('e-1', 'w-1', 'w-2'), edge('e-2', 'w-2', 'w-3'), edge('e-3', 'w-3', 'w-4', '承認'), edge('e-4', 'w-3', 'w-2', '差し戻し'),
  edge('e-5', 'w-4', 'w-5'), edge('e-6', 'w-5', 'w-6'), edge('e-7', 'w-6', 'w-7'), edge('e-8', 'w-7', 'w-8'),
];
const STATUS = {
  id: 'i-st', name: 'ステータス', type: 'status', required: false, memo: '', lookup: null, link: null,
  props: { states: [{ id: 't-a', name: '申請' }, { id: 't-b', name: '承認待ち' }, { id: 't-c', name: '承認済み' }], actions: [] },
};
function sampleState() {
  return plain({
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d-trip', '出張申請', { screens: [screen('s-in', '申請の入力'), screen('s-det', '詳細'), screen('s-list', '一覧')], items: [STATUS] }),
      design('d-emp', '社員マスタ'),
      design('d-cli', '取引先マスタ'),
    ],
    systems: [
      system('y-trip', '出張申請システム', ['d-trip', 'd-emp'], { roles: ROLES, swimlane: { steps: STEPS, edges: EDGES } }),
      system('y-exp', '経費精算システム', []),
    ],
  });
}

async function boot(t, state = sampleState(), sysId = 'y-trip') {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) } });
  t.after(() => app.close());
  const api = await app.api();
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  const S = () => api.store.state;
  if (sysId) api.openSystem(sysId);
  const sys = (id = 'y-trip') => plain(S().systems.find((y) => y.id === id) || null);
  const geom = () => { const y = S().systems.find((x) => x.id === 'y-trip'); return api.swimlaneLayout(api.swimlaneModel(S(), y), y); };
  // レーン lane の、流れの向きの位置 flow・横切る向きのレーンの中の割合 k の点（図の中の位置。jsdom では、そのままマウスの位置）
  const pt = (lane, flow, k = 0.5) => {
    const L = geom();
    const l = L.lanes[lane];
    return L.vertical ? { clientX: l.x + l.w * k, clientY: flow } : { clientX: flow, clientY: l.y + l.h * k };
  };
  // 箱の真ん中
  const center = (id) => { const b = geom().pos['w:' + id]; return { clientX: b.x + b.w / 2, clientY: b.y + b.h / 2 }; };
  return {
    app, api, $, $$, S, sys, geom, pt, center,
    node: (id) => $(`#sys-swim .mnode[data-node="w:${id}"]`),
    edgeHit: (id) => $(`#sys-swim .sw-edge[data-edge="${id}"] .sw-hit`),
    inner: () => $('#sys-swim .swim-inner'),
    step: (id) => sys().swimlane.steps.find((w) => w.id === id) || null,
    edges: () => sys().swimlane.edges.map((e) => [e.from, e.to, e.label]),
    pal: (kind) => $(`#sys-box .pal-btn[data-kind="${kind}"]`),
    toast: () => $('#toast').textContent,
    side: () => $('#sys-side').textContent,
    call: async (tool, args = {}) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' })),
  };
}
// 図の中の位置 (x, y) のマウスの値
const at = (x, y) => ({ clientX: x, clientY: y });

// ── 純関数 ──
test('ガイドの吸着（swimSnap。MPD v8.33 の 1 つのシェイプのドラッグと同じ）: 流れの向きはつながった相手・ほかの箱の真ん中・80 おきのガイド線（15 以内）、横切る向きはつながった相手かレーンの 1/4・真ん中・3/4（20 以内）。Alt と Shift の固定では吸着しない', async (t) => {
  const { api, S } = await boot(t, sampleState(), null);
  const D = api.swimDrawing(S(), S().systems[0]);
  // w-5（作業 120 × 37）の真ん中を (cx, cy) へ動かす
  const at = (cx, cy, o) => {
    const r = api.swimSnap(D, 'w:w-5', { x: cx - 60, y: cy - 18.5 }, o);
    return plain([r.x, r.y, r.flow, r.cross, r.laneIndex, r.roleId, r.guides.lane, r.guides.at, r.guides.main, r.guides.partner && r.guides.partner.o]);
  };
  assert.deepEqual(at(1099, 361.5), [1036, 339, 1096, 97.5, 2, 'l-c', 2, 357.5, 1096, null], 'ガイド線 1096 と、経理のレーンの 3/4（260 ＋ 97.5）に吸い付く');
  assert.deepEqual(at(1180, 330), [1116, 306.5, 1176, 65, 2, 'l-c', 2, 325, 1176, 'w:w-6'], 'つながった相手（w-6）の真ん中に吸い付く（流れの向きも、横切る向きも）');
  assert.deepEqual(at(1099, 361.5, { alt: true }), [1039, 343, 1099, 101.5, 2, 'l-c', null, null, null, null], 'Alt を押している間は吸着しない（ガイドも出さない）');
  assert.deepEqual(at(1099, 361.5, { axis: 'h' }), [1039, 343, 1099, 101.5, 2, 'l-c', 2, null, null, null], 'Shift で固定した間も吸着しない');
  assert.deepEqual(at(1060, 262).slice(0, 4), [1000, 262, 1060, 20.5], '箱はレーンの中に収める（縁から 2）');
  assert.equal(at(1060, 200)[5], 'l-b', '真ん中の入ったレーンの役割');
  assert.equal(at(1060, 5000)[5], 'l-c', 'レーンの外は、近いほうの端のレーン');
  assert.deepEqual([api.swimLaneAt(D.L, -40), api.swimLaneAt(D.L, 129), api.swimLaneAt(D.L, 130)], [0, 0, 1]);
});

test('○＋ を出す所（swimPlusAt）: いちばん近い箱（縁から 25 まで）の、点に向いた縁の 12 外の真ん中。遠いときは null', async (t) => {
  const { api, S } = await boot(t, sampleState(), null);
  const y = S().systems[0];
  const { pos } = api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  // w-1（始まり）は 161, 49.5 から 110 × 31。真ん中は 216, 65
  assert.deepEqual(plain(api.swimPlusAt(pos, 269, 60)), { key: 'w:w-1', side: 'right', x: 271 + 12, y: 65 });
  assert.deepEqual(plain(api.swimPlusAt(pos, 216, 45)), { key: 'w:w-1', side: 'top', x: 216, y: 49.5 - 12 });
  assert.equal(api.swimPlusAt(pos, 216, 78).side, 'bottom', '箱の中は、点に向いた縁');
  assert.equal(api.swimPlusAt(pos, 165, 65).side, 'left');
  assert.equal(api.swimPlusAt(pos, 216, 49.5 - 26), null, '縁から 26 離れると出さない');
});

test('全体を表示の倍率（swimFitZoom）: 図の幅を欄の幅に合わせる（100 分の 1 で切り捨て）。100% より大きくしない。欄の幅が分からないときは 100%', async (t) => {
  const { api } = await boot(t, sampleState(), null);
  assert.equal(api.swimFitZoom(2000, 900), 0.45);
  assert.equal(api.swimFitZoom(800, 900), 1);
  assert.equal(api.swimFitZoom(2000, 0), 1);
  assert.equal(api.swimFitZoom(100000, 900), 0.1);
});

// ── メニューバー ──
test('メニューバー: 「編集」の組（▶ 選択・→ 接続・✕ 削除）・「図の向き」（横向き・縦向き）・「配置」（工程を整列する）と「表示」の「全体を表示」。削除は選んでいるときだけ押せる。スイムレーン図のほかでは押せない', async (t) => {
  const { app, api, $, $$, node } = await boot(t);
  assert.deepEqual($$('#toolbar .glabel').map((e) => e.textContent), ['ファイル', '履歴', '編集', '図の向き', '配置', '表示']);
  assert.deepEqual(['swim-horizontal', 'swim-vertical', 'swim-arrange'].map((a) => $(`#toolbar [data-action="${a}"]`).textContent.replace(/\s+/g, '')), ['横向き', '縦向き', '⊞工程を整列する']);
  const sel = $('#toolbar [data-action="swim-select"]');
  const con = $('#toolbar [data-action="swim-connect"]');
  const del = $('#toolbar [data-action="swim-delete"]');
  assert.deepEqual([sel, con, del].map((b) => b.textContent.replace(/\s+/g, '')), ['▶選択', '→接続', '✕選んだものを削除する']);
  assert.deepEqual([sel.classList.contains('on'), con.classList.contains('on'), del.disabled], [true, false, true]);
  assert.ok($('#toolbar [data-action="zoom-fit"]'));
  assert.equal($('#toolbar [data-action="zoom-fit"]').textContent, '⊡ 全体を表示');
  press(node('w-3'));
  assert.equal(del.disabled, false);
  click(con);
  assert.equal(api.ui.swimMode, 'connect');
  assert.deepEqual([sel.classList.contains('on'), con.classList.contains('on')], [false, true]);
  assert.equal(del.disabled, true, '接続モードにすると、選ぶのをやめる');
  click(sel);
  assert.equal(api.ui.swimMode, 'select');
  click($('#sys-list .db-entry[data-panel="roles"]'));
  assert.deepEqual([sel.disabled, con.disabled, del.disabled, $('#toolbar [data-action="zoom-fit"]').disabled], [true, true, true, true]);
  assert.deepEqual(['swim-horizontal', 'swim-vertical', 'swim-arrange'].map((a) => $(`#toolbar [data-action="${a}"]`).disabled), [true, true, true]);
  void app;
});

// ── 作業の箱の置き場（右の欄の上半分）──
test('置き場: 右のパネルの上に 6 つ（始まり・作業・システムへの入力・判断・書類・終わり）を 3 列。スイムレーン図のほかと、役割がないときは出さない', async (t) => {
  const { api, $, $$ } = await boot(t);
  const box = $('#sys-box');
  assert.equal(box.hidden, false);
  assert.ok(box.classList.contains('side-box'), 'アイテム一覧と同じ置き場の作り（設定の欄に 340 を残す）');
  assert.match(box.querySelector('.panel-title').textContent, /工程 （図へドラッグして置く）/);
  assert.deepEqual($$('#sys-box .pal-btn').map((b) => [b.dataset.kind, b.textContent]),
    [['start', '始まり'], ['task', '作業'], ['input', 'システムへの\n入力'], ['decision', '判断'], ['doc', '書類'], ['end', '終わり']]);
  assert.ok($$('#sys-box .pal-btn').every((b) => b.querySelector('svg')), '絵と名前');
  assert.ok($('#sys-box .pal-grid'));
  api.openSystemPanel('roles');
  assert.equal($('#sys-box').hidden, true);
  api.openSystemPanel('swimlane');
  assert.equal($('#sys-box').hidden, false);
  api.openSystem('y-exp');
  assert.equal($('#sys-box').hidden, true);
});

test('置き場を押してから図を押す: 押した所（ガイドに吸い付く）に置いて選ぶ。列は位置から付け直す。続けて置ける。同じ項目をもう一度押す・Esc・何もない所の右クリックでやめる', async (t) => {
  const { app, api, $, pal, inner, pt, sys, step } = await boot(t);
  click(pal('decision'));
  assert.equal(api.ui.swimPal, 'decision');
  assert.ok(pal('decision').classList.contains('on'));
  assert.equal(pal('decision').getAttribute('aria-pressed'), 'true');
  assert.ok($('#sys-swim').classList.contains('armed'));
  assert.match($('#sys-box').textContent, /図を押すと「判断」を置きます/);
  // 上長のレーンの、w-5（1016）と w-6（1176）の間。流れの向きはガイド線 1096 に吸い付く
  press(inner(), pt(1, 1100));
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.kind, added.text], ['l-b', 5, 'decision', '']);
  assert.deepEqual(plain(added.pos), { horizontal: { flow: 1096, cross: 65, roleId: 'l-b', col: 5 } });
  assert.deepEqual([step('w-5').col, step('w-6').col, step('w-8').col], [4, 6, 8], '後ろの工程の列は 1 つずつずれる');
  assert.deepEqual(plain(step('w-1').pos), { horizontal: { flow: 216, cross: 65, roleId: 'l-a', col: 0 } }, 'ほかの工程も今の位置を覚える（動かないように）');
  assert.equal(api.ui.stepSel, added.id, '置いた箱を選ぶ');
  assert.equal(api.ui.swimPal, 'decision', '続けて置ける');
  press(inner(), pt(2, 1700));
  assert.equal(sys().swimlane.steps.length, 10);
  assert.deepEqual([sys().swimlane.steps.at(-1).roleId, sys().swimlane.steps.at(-1).col], ['l-c', 9]);
  // 同じ項目をもう一度押すとやめる
  click(pal('decision'));
  assert.equal(api.ui.swimPal, null);
  assert.equal(pal('decision').classList.contains('on'), false);
  press(inner(), pt(0, 1900));
  assert.equal(sys().swimlane.steps.length, 10, 'やめた後は置かない');
  // Esc でやめる
  click(pal('doc'));
  click(pal('end'));
  assert.equal(api.ui.swimPal, 'end', 'ほかの項目を押すと、その項目に変わる');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.swimPal, null);
  // 何もない所の右クリックでやめる
  click(pal('task'));
  fire(inner(), 'contextmenu', pt(0, 1900));
  assert.equal(api.ui.swimPal, null);
  assert.equal(sys().swimlane.steps.length, 10);
  // 元に戻すは 1 つずつ
  api.runCommand('undo');
  assert.equal(sys().swimlane.steps.length, 9);
});

test('置き場からドラッグして図に落とす（4 ドットより動かしたらドラッグ）。落とした所に置いて選ぶ（置く所の点線の枠とガイドを出す）。少しだけ動かしたときは置かない', async (t) => {
  const { app, api, $, pal, inner, pt, sys } = await boot(t);
  fire(pal('doc'), 'mousedown', { clientX: 0, clientY: 0 });
  fire(inner(), 'mousemove', pt(2, 1700));
  assert.ok(app.document.querySelector('.swim-ghost'), 'カーソルについてくる箱');
  const frame = $('#swim-cell');
  assert.ok(frame, '置く所の点線の枠');
  assert.deepEqual([frame.style.left, frame.style.top, frame.style.width, frame.style.height], ['1670px', '305px', '60px', '40px'], '書類（60 × 40）の真ん中が、経理のレーンの 1/4 より下の真ん中（260 ＋ 65）');
  assert.ok($('#swim-guides'), 'レーンの 1/4・真ん中・3/4 のガイド');
  fire(inner(), 'mouseup', pt(2, 1700));
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.kind], ['l-c', 8, 'doc']);
  assert.equal(api.ui.stepSel, added.id);
  assert.equal(app.document.querySelector('.swim-ghost'), null);
  assert.deepEqual([$('#swim-cell'), $('#swim-guides')], [null, null]);
  assert.equal(api.ui.swimPal, null, 'ドラッグでは、押してから置くの状態にしない');
  // 少しだけ動かしたとき
  fire(pal('doc'), 'mousedown', { clientX: 0, clientY: 0 });
  fire(inner(), 'mousemove', { clientX: 2, clientY: 1 });
  fire(inner(), 'mouseup', { clientX: 2, clientY: 1 });
  assert.equal(sys().swimlane.steps.length, 9);
  // 図の外に落としたときは置かない
  fire(pal('doc'), 'mousedown', { clientX: 0, clientY: 0 });
  fire($('#sys-list'), 'mousemove', { clientX: 300, clientY: 300 });
  fire($('#sys-list'), 'mouseup', { clientX: 300, clientY: 300 });
  assert.equal(sys().swimlane.steps.length, 9);
});

test('右のパネルの選ぶ欄（役割）を変えた直後に Ctrl+Z を押すと、元に戻す（デバッグとリリースの見直し⑤-5）', async (t) => {
  const { app, $, node, step } = await boot(t);
  press(node('w-3'));
  const role = $('#sys-side [data-sw="role"]');
  role.focus();
  setValue(role, 'l-c');
  assert.equal(step('w-3').roleId, 'l-c');
  key(app, app.document.activeElement, { key: 'z', ctrlKey: true });
  assert.equal(step('w-3').roleId, 'l-b', '選ぶ欄にフォーカスがあっても、画面の元に戻すにする');
});

test('作業の文字を打ちかけのまま置き場の箱を図へドラッグしても、打った文字は消えない（デバッグとリリースの見直し⑤-2）', async (t) => {
  const { $, pal, node, inner, step, sys, pt } = await boot(t);
  press(node('w-3'));
  const text = $('#sys-side [data-sw="text"]');
  text.focus();
  text.value = '申請の中身を確かめる';
  fire(pal('doc'), 'mousedown', { clientX: 0, clientY: 0 });
  fire(inner(), 'mousemove', pt(2, 1700));
  fire(inner(), 'mouseup', pt(2, 1700));
  assert.equal(sys().swimlane.steps.length, 9, '箱は置ける');
  assert.equal(step('w-3').text, '申請の中身を確かめる', '打ちかけの文字を保存する');
});

test('箱の上に落とす・押すと、その箱の種類を置き換える（同じ種類なら、押した所に足す）', async (t) => {
  const { api, pal, node, sys, step, center } = await boot(t);
  fire(pal('end'), 'mousedown', { clientX: 0, clientY: 0 });
  fire(node('w-5'), 'mousemove', center('w-5'));
  assert.ok(node('w-5').classList.contains('swim-replace'), '置き換える箱の印');
  fire(node('w-5'), 'mouseup', center('w-5'));
  assert.equal(step('w-5').kind, 'end');
  assert.equal(sys().swimlane.steps.length, 8);
  assert.equal(api.ui.stepSel, 'w-5');
  // 押してから箱を押す
  click(pal('decision'));
  press(node('w-6'), center('w-6'));
  assert.equal(step('w-6').kind, 'decision');
  assert.equal(sys().swimlane.steps.length, 8);
  // 同じ種類の箱の上なら、押した所に足す（箱の真ん中に吸い付くので、同じ列・同じ位置）
  press(node('w-6'), center('w-6'));
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.kind], ['l-c', step('w-6').col, 'decision']);
  assert.deepEqual(plain(added.pos.horizontal), { ...plain(step('w-6').pos.horizontal), col: step('w-6').col });
});

test('何もない所のダブルクリックで「作業」を足して選ぶ。押してから置く間は、ダブルクリックで足さない', async (t) => {
  const { api, inner, pt, sys, pal } = await boot(t);
  fire(inner(), 'dblclick', pt(1, 1100));
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.kind, added.text], ['l-b', 5, 'task', '']);
  assert.equal(api.ui.stepSel, added.id);
  click(pal('doc'));
  press(inner(), pt(0, 1900));
  fire(inner(), 'dblclick', pt(0, 1900));
  assert.equal(sys().swimlane.steps.length, 10, '押してから置くの 1 つだけ');
});

// ── つなぐ ──
test('○＋: 箱に近づくと、いちばん近い縁の外に青い ○＋（「ほかの工程と接続します」）。押してから相手のボックスを押すとつなぐ。つないだ矢印を選ぶ', async (t) => {
  const { api, $, node, inner, edges, side } = await boot(t);
  // w-2（申請者・列 1。306, 38.5 から 140 × 53）の右の縁の近く
  fire(node('w-2'), 'mousemove', at(444, 60));
  const plus = $('#swim-plus');
  assert.ok(plus);
  assert.equal(plus.title, 'ほかの工程と接続します');
  assert.deepEqual([plus.dataset.step, plus.dataset.side], ['w-2', 'right']);
  assert.deepEqual([plus.style.left, plus.style.top], [`${446 + 12 - 9}px`, `${65 - 9}px`], '縁の 12 外が真ん中（半径 9）');
  // 遠くへ動かすと消える
  fire(inner(), 'mousemove', at(400, 212));
  assert.equal($('#swim-plus'), null);
  // 押して、相手の箱を押す
  fire(node('w-2'), 'mousemove', at(444, 60));
  press($('#swim-plus'));
  assert.deepEqual(plain(api.ui.swimLink), { from: 'w-2', via: 'plus' });
  assert.ok(node('w-2').classList.contains('link-from'), '元の箱は青枠');
  assert.ok($('#sys-swim').classList.contains('linking'), '十字のカーソル');
  assert.match(side(), /「出張申請を入力する」からの接続先の工程を押します/);
  // つなぐ途中の破線
  fire(inner(), 'mousemove', at(1000, 40));
  const prev = $('#swim-prev path.sw-guide');
  assert.ok(prev);
  assert.deepEqual([prev.getAttribute('stroke'), prev.getAttribute('stroke-width'), prev.getAttribute('stroke-dasharray')], ['#3b82f6', '1.5', '6,4']);
  assert.match(prev.getAttribute('d'), /^M[0-9.]+,[0-9.]+ L[0-9.]+,[0-9.]+$/);
  assert.equal($('#swim-prev marker path').getAttribute('d'), 'M0,0 L10,5 L0,10 z', '矢印の先の形（marker）は書き換えない');
  assert.equal($('#swim-plus'), null, 'つなぐ途中は ○＋ を出さない');
  press(node('w-5'));
  assert.deepEqual(edges().at(-1), ['w-2', 'w-5', '']);
  assert.equal(api.ui.swimLink, null);
  assert.equal($('#swim-prev'), null);
  assert.equal(api.ui.edgeSel, api.store.state.systems[0].swimlane.edges.at(-1).id, 'つないだ矢印を選ぶ');
  assert.equal(api.ui.swimMode, 'select');
});

test('つなぐ: 自分への矢印は作らない（○＋ からはやめる）・同じ向きの 2 本目は断ってお知らせ・逆向きは作れる。Esc・何もない所・右クリックでやめる', async (t) => {
  const { app, api, $, node, inner, edges, toast } = await boot(t);
  const n0 = edges().length;
  // 箱の右の縁の 2 内側に乗せて、出た ○＋ を押す
  const plusFrom = (id) => {
    const nd = node(id);
    fire(nd, 'mousemove', at(parseFloat(nd.style.left) + parseFloat(nd.style.width) - 2, parseFloat(nd.style.top) + parseFloat(nd.style.height) / 2));
    press($('#swim-plus'));
  };
  plusFrom('w-1');
  press(node('w-1'));
  assert.equal(api.ui.swimLink, null, '自分のボックスを押すと、やめる');
  assert.equal(edges().length, n0);
  // 同じ向きの 2 本目
  plusFrom('w-1');
  press(node('w-2'));
  assert.equal(toast(), 'この 2 つの工程は、もう接続しています');
  assert.equal(edges().length, n0);
  assert.equal(api.ui.swimLink, null);
  // 逆向き
  plusFrom('w-2');
  press(node('w-1'));
  assert.deepEqual(edges().at(-1), ['w-2', 'w-1', '']);
  // やめ方
  plusFrom('w-4');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.swimLink, null);
  plusFrom('w-4');
  press(inner(), at(150, 380));
  assert.equal(api.ui.swimLink, null, '何もない所を押す');
  plusFrom('w-4');
  fire(inner(), 'contextmenu', at(150, 380));
  assert.equal(api.ui.swimLink, null, '何もない所の右クリック');
  assert.equal(edges().length, n0 + 1);
});

test('接続モード（→ 接続・キー c）: 元・先を順に押してつなぐ。モードは続く。接続モードの間は箱を動かせない。▶ 選択・キー v でやめる', async (t) => {
  const { app, api, $, node, inner, edges, pt, center, step } = await boot(t);
  key(app, app.document.body, { key: 'c' });
  assert.equal(api.ui.swimMode, 'connect');
  assert.ok($('#sys-swim').classList.contains('linking'));
  assert.match($('#sys-side').textContent, /接続元の工程を押してから、接続先の工程を押します/);
  // 動かそうとしても動かない（押した箱が元になる）
  fire(node('w-8'), 'mousedown', center('w-8'));
  fire(inner(), 'mousemove', pt(0, 1700));
  fire(inner(), 'mouseup', pt(0, 1700));
  assert.deepEqual([step('w-8').roleId, step('w-8').col, step('w-8').pos], ['l-c', 7, undefined]);
  assert.deepEqual(plain(api.ui.swimLink), { from: 'w-8', via: 'mode' });
  // 自分の箱を押しても待ったまま
  press(node('w-8'));
  assert.deepEqual(plain(api.ui.swimLink), { from: 'w-8', via: 'mode' });
  press(node('w-1'));
  assert.deepEqual(edges().at(-1), ['w-8', 'w-1', '']);
  assert.equal(api.ui.swimMode, 'connect', 'モードは続く');
  assert.equal(api.ui.swimLink, null);
  // 続けてつなぐ
  press(node('w-6'));
  press(node('w-8'));
  assert.deepEqual(edges().at(-1), ['w-6', 'w-8', '']);
  // 元を選んでから何もない所を押すと、元だけやめる
  press(node('w-1'));
  press(inner(), at(150, 380));
  assert.equal(api.ui.swimLink, null);
  assert.equal(api.ui.swimMode, 'connect');
  // ○＋ は出さない
  fire(node('w-2'), 'mousemove', at(444, 60));
  assert.equal($('#swim-plus'), null);
  key(app, app.document.body, { key: 'v' });
  assert.equal(api.ui.swimMode, 'select');
  assert.equal($('#sys-swim').classList.contains('linking'), false);
  // 入力欄の中の c・v はモードを変えない
  press(node('w-1'));
  key(app, $('#sys-side [data-sw="text"]'), { key: 'c' });
  assert.equal(api.ui.swimMode, 'select');
});

// ── 矢印 ──
test('矢印を押すと選ぶ（青・太く・両端にオレンジの ○）。右のパネルに「元 → 先」・文字の欄・「この矢印を消す」。文字のない線は、乗ったときと選んだ間だけ真ん中に ○', async (t) => {
  const { api, $, $$, edgeHit, edges, side } = await boot(t);
  assert.ok(!$('#sys-swim .sw-edge[data-edge="e-3"] .sw-mid'), '文字のある矢印には ○ を描かない');
  assert.ok($('#sys-swim .sw-edge[data-edge="e-1"] .sw-mid'), '文字のない矢印の真ん中の ○');
  press(edgeHit('e-3'));
  assert.equal(api.ui.edgeSel, 'e-3');
  assert.equal(api.ui.stepSel, null);
  const line = $('#sys-swim path.sw-line[data-edge="e-3"]');
  assert.ok(line.classList.contains('sel'));
  assert.deepEqual(['markerWidth', 'markerHeight', 'viewBox'].map((a) => $('#swim-arrow-s').getAttribute(a)), ['6', '4.5', '0 0 8 6'], '選んだ太い線（2）の矢印の先は、ふだんの線（1.5）と同じ大きさに縮める');
  assert.ok($('#sys-swim .sw-edge[data-edge="e-3"]').classList.contains('sel'));
  assert.equal($$('#sys-swim .sw-ends[data-edge="e-3"] .sw-end').length, 2);
  assert.ok($('#sys-swim .sw-ends[data-edge="e-3"]').classList.contains('sel'));
  // 両端の ○ は、箱より後（上）の SVG に描く（矢印の端は箱の縁にあり、半分が箱に重なるため。箱の下だと押せない）
  const over = $('#sys-swim .sw-ends[data-edge="e-3"]').ownerSVGElement;
  assert.ok(over.classList.contains('swim-over'));
  assert.ok($$('#sys-swim .mnode.sw').at(-1).compareDocumentPosition(over) & 4, '両端の ○ の SVG は箱より後');
  assert.match(side(), /矢印の設定/);
  assert.match(side(), /申請を確かめる → 承認する/);
  const label = $('#sys-side [data-sw="edge-label"]');
  assert.equal(label.value, '承認');
  setValue(label, '承認する');
  assert.deepEqual(edges()[2], ['w-3', 'w-4', '承認する']);
  assert.equal($('#sys-side [data-sw="edge-label"]'), label, '文字を直しても右のパネルを描き直さない');
  assert.equal(app$text($('#sys-swim svg')), true);
  click($('#sys-side [data-action="sys-edge-del"]'));
  assert.equal(edges().length, 7);
  assert.equal(api.ui.edgeSel, null);
  // 箱を押すと矢印を選ぶのをやめる
  press(edgeHit('e-1'));
  press($('#sys-swim .mnode[data-node="w:w-1"]'));
  assert.deepEqual([api.ui.stepSel, api.ui.edgeSel], ['w-1', null]);
});
// 図の SVG に「承認する」の文字があるか
function app$text(svg) {
  return [...svg.querySelectorAll('text')].some((x) => x.textContent === '承認する');
}

test('矢印のダブルクリックで、線の真ん中に文字の欄（Enter で確定・Esc で取りやめ）', async (t) => {
  const { app, $, edgeHit, edges } = await boot(t);
  fire(edgeHit('e-1'), 'dblclick');
  const input = $('#sys-swim .swim-edit');
  assert.ok(input);
  assert.equal(app.document.activeElement, input);
  input.value = '申請する';
  key(app, input, { key: 'Enter' });
  assert.deepEqual(edges()[0], ['w-1', 'w-2', '申請する']);
  assert.equal($('#sys-swim .swim-edit'), null);
  fire(edgeHit('e-4'), 'dblclick');
  assert.equal($('#sys-swim .swim-edit').value, '差し戻し');
  $('#sys-swim .swim-edit').value = 'やり直し';
  key(app, $('#sys-swim .swim-edit'), { key: 'Escape' });
  assert.deepEqual(edges()[3], ['w-3', 'w-2', '差し戻し']);
  assert.equal($('#sys-swim .swim-edit'), null);
});

test('矢印を消す: Delete・Backspace・ツールバーの「✕ 削除」・右クリック（その場で消す）。元に戻すで戻る', async (t) => {
  const { app, api, $, edgeHit, edges } = await boot(t);
  press(edgeHit('e-2'));
  key(app, app.document.body, { key: 'Delete' });
  assert.equal(edges().some((e) => e[0] === 'w-2' && e[1] === 'w-3'), false);
  assert.equal(api.ui.edgeSel, null);
  press(edgeHit('e-5'));
  key(app, app.document.body, { key: 'Backspace' });
  assert.equal(edges().length, 6);
  press(edgeHit('e-6'));
  click($('#toolbar [data-action="swim-delete"]'));
  assert.equal(edges().length, 5);
  fire(edgeHit('e-7'), 'contextmenu');
  assert.equal(edges().length, 4);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(edges().length, 5);
});

test('付け替え: 選んだ矢印の端のオレンジの ○ を別の箱までドラッグする。同じ向きの 2 本目は断り、自分への矢印にはしない', async (t) => {
  const { app, api, $, edgeHit, node, edges, toast } = await boot(t);
  press(edgeHit('e-1'));
  const end = (which) => $(`#sys-swim .sw-ends[data-edge="${api.ui.edgeSel}"] .sw-end[data-end="${which}"]`);
  fire(end('to'), 'mousedown');
  fire(node('w-5'), 'mousemove', { clientX: 30, clientY: 30 });
  const guide = $('#swim-prev path.sw-guide');
  assert.ok(guide, '付け替えの途中の線');
  assert.deepEqual([guide.getAttribute('stroke'), guide.getAttribute('stroke-dasharray'), guide.getAttribute('marker-end')], ['#f97316', '5,4', null], 'オレンジの破線（矢印の先なし）');
  assert.ok(node('w-5').classList.contains('relink-to'), '付け替える先の箱の印');
  fire(node('w-5'), 'mouseup', { clientX: 30, clientY: 30 });
  assert.deepEqual(edges()[0], ['w-1', 'w-5', '']);
  assert.equal(api.ui.edgeSel, 'e-1', '選んだまま');
  assert.equal($('#swim-prev'), null);
  // 元の端
  fire(end('from'), 'mousedown');
  fire(node('w-6'), 'mousemove', { clientX: 30, clientY: 30 });
  fire(node('w-6'), 'mouseup', { clientX: 30, clientY: 30 });
  assert.deepEqual(edges()[0], ['w-6', 'w-5', ''], '逆向きの矢印（w-5 → w-6）があっても付け替えられる');
  // 同じ向きの 2 本目（承認 w-3 → w-4 の先を w-2 へ。w-3 → w-2 の差し戻しがもうある）
  press(edgeHit('e-3'));
  fire(end('to'), 'mousedown');
  fire(node('w-2'), 'mousemove', { clientX: 30, clientY: 30 });
  fire(node('w-2'), 'mouseup', { clientX: 30, clientY: 30 });
  assert.equal(toast(), 'この 2 つの工程は、もう接続しています');
  assert.deepEqual(edges()[2], ['w-3', 'w-4', '承認']);
  // 自分への矢印
  fire(end('to'), 'mousedown');
  fire(node('w-3'), 'mousemove', { clientX: 30, clientY: 30 });
  fire(node('w-3'), 'mouseup', { clientX: 30, clientY: 30 });
  assert.deepEqual(edges()[2], ['w-3', 'w-4', '承認']);
  // 何もない所で放したとき
  fire(end('to'), 'mousedown');
  fire($('#sys-swim .swim-inner'), 'mousemove', { clientX: 150, clientY: 380 });
  fire($('#sys-swim .swim-inner'), 'mouseup', { clientX: 150, clientY: 380 });
  assert.deepEqual(edges()[2], ['w-3', 'w-4', '承認']);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual(edges()[0], ['w-1', 'w-5', ''], '付け替えは元に戻すの 1 回分');
});

// ── 作業の箱 ──
test('箱のダブルクリックで、箱の上に文字の欄（Enter で確定・Esc で取りやめ・ほかを押すと確定）', async (t) => {
  const { app, $, node, step, inner } = await boot(t);
  fire(node('w-4'), 'dblclick');
  const input = $('#sys-swim .swim-edit');
  assert.ok(input);
  assert.equal(input.value, '承認する');
  // 欄の幅は箱の幅か 160 の大きいほう（作業 120 の箱は 160）。箱の真ん中にそろえる
  assert.deepEqual([input.style.left, input.style.width], [`${parseFloat(node('w-4').style.left) + 60 - 80}px`, '160px']);
  input.value = '承認して返す';
  key(app, input, { key: 'Enter' });
  assert.equal(step('w-4').text, '承認して返す');
  assert.equal($('#sys-swim .mnode[data-node="w:w-4"] b').textContent, '承認して返す');
  fire(node('w-4'), 'dblclick');
  $('#sys-swim .swim-edit').value = 'やめる';
  key(app, $('#sys-swim .swim-edit'), { key: 'Escape' });
  assert.equal(step('w-4').text, '承認して返す');
  fire(node('w-5'), 'dblclick');
  $('#sys-swim .swim-edit').value = '出張する';
  press(inner(), at(150, 380));
  assert.equal(step('w-5').text, '出張する', 'ほかを押すと確定');
  assert.equal($('#sys-swim .swim-edit'), null);
});

test('箱を消す: 右クリック（その場で消す。つながる矢印も）・Delete・ツールバーの「✕ 削除」・右のパネルの「この作業を削除」。Ctrl+Z で戻る', async (t) => {
  const { app, api, $, node, sys, edges } = await boot(t);
  fire(node('w-6'), 'contextmenu');
  assert.equal(sys().swimlane.steps.some((w) => w.id === 'w-6'), false);
  assert.equal(edges().some((e) => e.includes('w-6')), false, 'つながる矢印も消す');
  assert.equal(edges().length, 6);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().swimlane.steps.length, 8);
  assert.equal(edges().length, 8);
  press(node('w-7'));
  key(app, app.document.body, { key: 'Delete' });
  assert.equal(sys().swimlane.steps.length, 7);
  assert.equal(api.ui.stepSel, null);
  press(node('w-8'));
  click($('#toolbar [data-action="swim-delete"]'));
  assert.equal(sys().swimlane.steps.length, 6);
  press(node('w-1'));
  click($('#sys-side [data-action="sys-step-del"]'));
  assert.equal(sys().swimlane.steps.length, 5);
});

test('箱のドラッグ（q146。MPD と同じ）: 箱はカーソルに付いて動き、ガイドに吸い付く（ガイドを出す）。放すと位置と役割を覚え（placeStep。元に戻すの 1 回分）、列を位置から付け直す。少しだけ動かしたときと、同じ所に戻したときは変えない', async (t) => {
  const { app, api, $, node, inner, step } = await boot(t);
  // w-5（申請者・列 4）は 956, 46.5 から 120 × 37。真ん中は 1016, 65
  fire(node('w-5'), 'mousedown', at(1016, 65));
  assert.equal(api.ui.stepSel, 'w-5', '押すと選ぶ');
  fire(inner(), 'mousemove', at(1017, 67));
  assert.equal(app.document.body.classList.contains('map-dragging'), false);
  // 経理のレーンの 3/4 の近く、ガイド線 1096 の近くへ
  fire(inner(), 'mousemove', at(1099, 361.5));
  assert.ok(app.document.body.classList.contains('map-dragging'));
  const moving = node('w-5');
  assert.deepEqual([moving.style.left, moving.style.top], ['1036px', '339px'], 'ガイド線 1096・レーンの 3/4（357.5）に吸い付く');
  assert.ok(moving.classList.contains('dragging'));
  const guides = $('#swim-guides');
  assert.ok(guides);
  assert.equal(guides.querySelector('text').textContent, '3/4', '吸い付いたレーンのガイドは青の太線と札');
  assert.ok([...guides.querySelectorAll('line')].some((l) => l.getAttribute('stroke') === '#f59e0b' && l.getAttribute('x1') === '1096'), '流れの向きに吸い付いた所は琥珀の破線');
  assert.equal(node('w-5'), moving, '描き直さない');
  assert.deepEqual([step('w-5').roleId, step('w-5').pos], ['l-a', undefined], '放すまで保存しない');
  fire(inner(), 'mouseup', at(1099, 361.5));
  assert.deepEqual([step('w-5').roleId, step('w-5').col], ['l-c', 4]);
  assert.deepEqual(plain(step('w-5').pos), { horizontal: { flow: 1096, cross: 97.5, roleId: 'l-c', col: 4 } });
  assert.deepEqual(plain(step('w-6').pos), { horizontal: { flow: 1176, cross: 65, roleId: 'l-c', col: 5 } }, 'ほかの箱も今の位置を覚える');
  assert.equal(app.document.body.classList.contains('map-dragging'), false);
  assert.equal($('#swim-guides'), null, '放すとガイドを消す');
  assert.equal(node('w-5').style.left, '1036px');
  // 同じ所に戻したときは履歴に積まない
  const undoLen = api.store.undoStack.length;
  fire(node('w-5'), 'mousedown', at(1096, 357.5));
  fire(inner(), 'mousemove', at(1126, 367.5));
  fire(inner(), 'mousemove', at(1096, 357.5));
  fire(inner(), 'mouseup', at(1096, 357.5));
  assert.equal(api.store.undoStack.length, undoLen, '同じ所に戻したときは履歴に積まない');
  // Alt を押している間は吸着しない
  fire(node('w-5'), 'mousedown', at(1096, 357.5));
  fire(inner(), 'mousemove', { ...at(1103, 327.5), altKey: true });
  assert.equal($('#swim-guides'), null, 'Alt の間はガイドも出さない');
  fire(inner(), 'mouseup', { ...at(1103, 327.5), altKey: true });
  assert.deepEqual(plain([step('w-5').pos.horizontal.flow, step('w-5').pos.horizontal.cross]), [1103, 67.5]);
  // Shift で横か縦に固定（動きの大きい向きだけ動かす。吸着しない）
  fire(node('w-5'), 'mousedown', at(1103, 327.5));
  fire(inner(), 'mousemove', { ...at(1153, 335.5), shiftKey: true });
  fire(inner(), 'mouseup', { ...at(1153, 335.5), shiftKey: true });
  assert.deepEqual(plain([step('w-5').pos.horizontal.flow, step('w-5').pos.horizontal.cross]), [1153, 67.5]);
  api.runCommand('undo');
  assert.deepEqual(plain([step('w-5').pos.horizontal.flow, step('w-5').pos.horizontal.cross]), [1103, 67.5], '元に戻すは 1 回のドラッグ分');
  api.runCommand('undo');
  api.runCommand('undo');
  assert.deepEqual([step('w-5').roleId, step('w-5').pos, step('w-1').pos], ['l-a', undefined, undefined], '最初のドラッグの前に戻る');
});

test('図の向き（q141）: 「縦向き」を押すとレーンを左から並べ、工程を上から進める（元に戻すの 1 回分）。位置は向きごとに覚え、まだ位置のない向きでは列から置く（q145）', async (t) => {
  const { app, api, $, node, inner, step, sys, geom, center } = await boot(t);
  // 横向きで w-5 を動かしておく
  fire(node('w-5'), 'mousedown', center('w-5'));
  fire(inner(), 'mousemove', at(1099, 361.5));
  fire(inner(), 'mouseup', at(1099, 361.5));
  const hz = plain(step('w-5').pos.horizontal);
  click($('#toolbar [data-action="swim-vertical"]'));
  assert.equal(sys().swimlane.orientation, 'vertical');
  assert.ok($('#sys-swim .swim-inner').classList.contains('down'));
  assert.deepEqual([$('#sys-orient-v').classList.contains('on'), $('#sys-orient-h').classList.contains('on'), $('#sys-orient-v').getAttribute('aria-pressed')], [true, false, 'true']);
  assert.equal(api.ui.sysZoom, 1, '倍率を合わせ直す（jsdom では欄の幅が分からないので 100%）');
  // 縦向きの位置はまだないので、列から置く（w-5 は経理のレーン・列 4）
  const L = geom();
  assert.deepEqual(plain(L.lanes.map((l) => [l.x, l.w])), [[0, 220], [220, 220], [440, 220]]);
  assert.deepEqual(plain([L.pos['w:w-5'].auto, L.pos['w:w-5'].flow, L.pos['w:w-5'].x]), [true, 444, 490], '列 4 の段は、名前の行 44 ＋ 80 × 5');
  assert.deepEqual(plain(step('w-5').pos.horizontal), hz, '横向きの位置は残る');
  // 縦向きで動かすと、縦向きの位置を覚える
  fire(node('w-1'), 'mousedown', center('w-1'));
  fire(inner(), 'mousemove', at(275, 124));
  fire(inner(), 'mouseup', at(275, 124));
  assert.deepEqual(plain(step('w-1').pos.vertical), { flow: 124, cross: 57, roleId: 'l-b', col: 0 }, '上長のレーンの 1/4（55）に吸い付くが、箱（幅 110）はレーンの縁から 2 より寄せない（MPD と同じ）');
  assert.deepEqual(plain(step('w-1').pos.horizontal), { flow: 216, cross: 65, roleId: 'l-a', col: 0 }, '横向きの位置は、役割が変わる前のまま');
  click($('#toolbar [data-action="swim-horizontal"]'));
  assert.equal('orientation' in sys().swimlane, false);
  assert.equal(geom().pos['w:w-1'].auto, true, '横向きで覚えた後に役割が変わった工程は、列から置く');
  assert.deepEqual(plain(geom().pos['w:w-5'].flow), 1096, '横向きの覚えた位置');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().swimlane.orientation, 'vertical', '向きの切り替えは元に戻すの 1 回分');
});

test('「⊞ 工程を整列する」: 今の向きの覚えた位置を消し、列から並べ直す（元に戻すの 1 回分）。もう並んでいるときは、そう知らせる', async (t) => {
  const { api, $, node, inner, step, sys, center, toast } = await boot(t);
  click($('#toolbar [data-action="swim-arrange"]'));
  assert.equal(toast(), '工程は、もう順番どおりに並んでいます');
  fire(node('w-5'), 'mousedown', center('w-5'));
  fire(inner(), 'mousemove', at(1099, 361.5));
  fire(inner(), 'mouseup', at(1099, 361.5));
  assert.ok(sys().swimlane.steps.every((w) => w.pos && w.pos.horizontal));
  const u0 = api.store.undoStack.length;
  click($('#toolbar [data-action="swim-arrange"]'));
  assert.equal(toast(), 'レーンを保ったまま工程順に並べました（Ctrl+Z で戻せます）');
  assert.ok(sys().swimlane.steps.every((w) => !('pos' in w)), '位置を消す');
  assert.deepEqual([step('w-5').roleId, step('w-5').col], ['l-c', 4], '役割と列はそのまま');
  assert.equal(node('w-5').style.left, '956px', '列から置き直す');
  assert.equal(api.store.undoStack.length, u0 + 1);
  api.runCommand('undo');
  assert.equal(node('w-5').style.left, '1036px');
});

// ── 右の欄（作業の設定）──
test('右のパネル: 何も選んでいないときは足し方とつなぎ方の案内。作業を選ぶと作業の設定（文字・種類・役割・使う画面とステータス・次の作業・メモ・足す・消す）', async (t) => {
  const { $, $$, node, side } = await boot(t);
  assert.match(side(), /工程を追加する/);
  assert.match(side(), /工程を接続する/);
  press(node('w-3'));
  assert.match($('#sys-side .panel-title').textContent, /工程の設定/);
  assert.equal($('#sys-side [data-sw="text"]').value, '申請を確かめる');
  assert.deepEqual($$('#sys-side [data-sw="kind"]').map((r) => [r.value, r.checked]),
    [['start', false], ['task', false], ['input', false], ['decision', true], ['doc', false], ['end', false]]);
  assert.deepEqual($$('#sys-side .sw-kinds label').map((l) => l.textContent), ['始まり', '作業', 'システムへの\n入力', '判断', '書類', '終わり']);
  assert.deepEqual($$('#sys-side [data-sw="role"] option').map((o) => [o.value, o.textContent, o.selected]), [['l-a', '申請者', false], ['l-b', '上長', true], ['l-c', '経理', false]]);
  assert.match($('#sys-side .sw-ref').textContent, /この工程で使う画面とステータス/);
  // 次の作業（矢印）: 承認（→ 承認する）と差し戻し（→ 出張申請を入力する）
  assert.deepEqual($$('#sys-side .sw-next').map((r) => [r.querySelector('.to').textContent, r.querySelector('input').value]),
    [['→ 承認する', '承認'], ['→ 出張申請を入力する', '差し戻し']]);
  const opts = $$('#sys-side [data-sw="link-to"] option').map((o) => o.textContent);
  assert.equal(opts[0], '＋ 次の工程を接続する ▾');
  assert.ok(!opts.some((o) => o.startsWith('承認する') || o.startsWith('申請を確かめる') || o.startsWith('出張申請を入力する')), '自分と、もうつないだ作業は出さない');
  assert.ok(opts.includes('出張に行く（申請者）'));
  assert.equal($('#sys-side [data-sw="memo"]').tagName, 'TEXTAREA');
  assert.equal($('#sys-side [data-action="sys-step-add"]').textContent, '＋ 作業を追加する');
  assert.equal($('#sys-side [data-action="sys-step-del"]').textContent, 'この工程を削除する');
  assert.ok($('#sys-side [data-action="sys-step-del"]').classList.contains('danger'));
});

test('右のパネルの作業の設定: 文字・種類・役割・メモを直す。文字とメモは右のパネルを描き直さない', async (t) => {
  const { api, $, node, step, geom } = await boot(t);
  press(node('w-5'));
  const text = $('#sys-side [data-sw="text"]');
  setValue(text, '  出張する  ');
  assert.equal(step('w-5').text, '出張する');
  assert.equal($('#sys-side [data-sw="text"]'), text, '描き直さない');
  assert.equal(node('w-5').querySelector('b').textContent, '出張する', '図は描き直す');
  setValue($('#sys-side [data-sw="memo"]'), '日帰りのときも');
  assert.equal(step('w-5').memo, '日帰りのときも');
  const end = $('#sys-side [data-sw="kind"][value="end"]');
  end.checked = true;
  end.dispatchEvent(new end.ownerDocument.defaultView.Event('change', { bubbles: true }));
  assert.equal(step('w-5').kind, 'end');
  assert.ok(node('w-5').classList.contains('k-end'));
  setValue($('#sys-side [data-sw="role"]'), 'l-c');
  assert.deepEqual([step('w-5').roleId, step('w-5').col], ['l-c', 4], '列はそのまま');
  assert.equal(api.ui.stepSel, 'w-5');
  assert.equal(geom().lanes.length, 3);
});

test('右のパネルの「この工程で使う画面とステータス」: 画面設計はこのシステムの画面設計。選び直すと画面とステータスは（なし）に戻る', async (t) => {
  const { $, $$, node, step } = await boot(t);
  press(node('w-2'));
  const opts = (k) => $$(`#sys-side [data-sw="${k}"] option`).map((o) => [o.value, o.textContent]);
  assert.deepEqual(opts('ref-design'), [['', '（なし）'], ['d-trip', '出張申請'], ['d-emp', '社員マスタ']]);
  assert.equal($('#sys-side [data-sw="ref-design"]').value, 'd-trip');
  assert.deepEqual(opts('ref-screen'), [['', '（なし）'], ['s-in', '申請の入力'], ['s-det', '詳細'], ['s-list', '一覧']]);
  assert.equal($('#sys-side [data-sw="ref-screen"]').value, 's-in');
  assert.deepEqual(opts('ref-state'), [['', '（なし）'], ['t-a', '申請'], ['t-b', '承認待ち'], ['t-c', '承認済み']]);
  setValue($('#sys-side [data-sw="ref-state"]'), 't-b');
  assert.deepEqual(plain(step('w-2').ref), { designId: 'd-trip', screenId: 's-in', stateId: 't-b' });
  assert.equal(node('w-2').querySelector('.ref').textContent, '画面: 申請の入力');
  setValue($('#sys-side [data-sw="ref-screen"]'), 's-det');
  assert.equal(step('w-2').ref.screenId, 's-det');
  setValue($('#sys-side [data-sw="ref-design"]'), 'd-emp');
  assert.deepEqual(plain(step('w-2').ref), { designId: 'd-emp', screenId: null, stateId: null });
  assert.deepEqual(opts('ref-screen'), [['', '（なし）'], ['s-d-emp', '一覧']]);
  assert.equal($('#sys-side [data-sw="ref-state"]').disabled, true, 'ステータスの項目のない画面設計');
  setValue($('#sys-side [data-sw="ref-design"]'), '');
  assert.deepEqual(plain(step('w-2').ref), { designId: null, screenId: null, stateId: null });
  assert.equal($('#sys-side [data-sw="ref-screen"]').disabled, true);
  assert.equal(node('w-2').querySelector('.ref'), null);
});

test('右のパネルの「この工程で使う画面とステータス」: このシステムに入っていない画面設計を指しているときも、その名前を出す', async (t) => {
  const { api, $, $$, node } = await boot(t);
  api.actions.updateStep('y-trip', 'w-1', { ref: { designId: 'd-cli', screenId: null, stateId: null } });
  press(node('w-1'));
  assert.deepEqual($$('#sys-side [data-sw="ref-design"] option').map((o) => o.textContent), ['（なし）', '出張申請', '社員マスタ', '取引先マスタ（このシステムに入っていない）']);
  assert.equal($('#sys-side [data-sw="ref-design"]').value, 'd-cli');
  api.actions.updateStep('y-trip', 'w-1', { ref: { designId: 'd-lost', screenId: null, stateId: null } });
  assert.equal($('#sys-side [data-sw="ref-design"] option:checked').textContent, '（ない画面設計）');
});

test('右のパネルの次の作業: 矢印の文字を直す・✕ で消す・「＋ 次の工程を接続する ▾」でつなぐ。「＋ 作業を追加する」は同じ役割のいちばん右の次の列', async (t) => {
  const { api, $, $$, node, edges, sys } = await boot(t);
  press(node('w-3'));
  setValue($$('#sys-side .sw-next input')[1], '差し戻す');
  assert.deepEqual(edges()[3], ['w-3', 'w-2', '差し戻す']);
  click($$('#sys-side .sw-next [data-action="sys-edge-del"]')[1]);
  assert.equal(edges().some((e) => e[0] === 'w-3' && e[1] === 'w-2'), false);
  assert.equal(api.ui.stepSel, 'w-3', '作業を選んだまま');
  setValue($('#sys-side [data-sw="link-to"]'), 'w-8');
  assert.deepEqual(edges().at(-1), ['w-3', 'w-8', '']);
  assert.deepEqual($$('#sys-side .sw-next .to').map((x) => x.textContent), ['→ 承認する', '→ 終わり']);
  assert.equal($('#sys-side [data-sw="link-to"]').value, '');
  // ＋ 作業を足す（上長の帯のいちばん右は列 3 → 列 4）
  click($('#sys-side [data-action="sys-step-add"]'));
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.kind], ['l-b', 4, 'task']);
  assert.equal(api.ui.stepSel, added.id);
});

test('打ちかけの文字: ほかの箱を押す・命令・AI が書く前に、選んでいた作業へ保存する。AI が書いた後も、打っていた欄にフォーカスを戻す', async (t) => {
  const { app, api, $, node, step, call } = await boot(t);
  press(node('w-4'));
  const text = $('#sys-side [data-sw="text"]');
  text.focus();
  text.value = '承認して返す'; // change は起こさない
  press(node('w-5'));
  assert.equal(step('w-4').text, '承認して返す');
  assert.equal(step('w-5').text, '出張に行く', '新しく選んだ作業には入れない');
  assert.equal(api.ui.stepSel, 'w-5');
  // 命令の前
  const memo = $('#sys-side [data-sw="memo"]');
  memo.focus();
  memo.value = '前日までに';
  api.runCommand('zoomIn');
  assert.equal(step('w-5').memo, '前日までに');
  // AI が書く前
  const text2 = $('#sys-side [data-sw="text"]');
  text2.focus();
  text2.value = '出張する';
  const r = await call('update_system', { system: 'y-trip', ops: [{ op: 'add', name: '総務' }] });
  assert.equal(r.ok, true);
  assert.equal(step('w-5').text, '出張する');
  assert.equal(app.document.activeElement.dataset.sw, 'text', 'フォーカスを戻す');
});

// ── 全体を表示・最初の倍率 ──
test('全体を表示: 図の幅を真ん中の欄の幅に合わせる。最初にスイムレーン図を出すときは、収まらなければ全体を表示の倍率（50% より小さくしない）、収まれば 100%', async (t) => {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(sampleState()) } });
  t.after(() => app.close());
  const api = await app.api();
  // 真ん中の欄の幅を 900 にする（jsdom では 0）
  Object.defineProperty(app.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.id === 'sys-swim' ? 900 : 0; } });
  const y = api.store.state.systems[0];
  const w = api.swimlaneLayout(api.swimlaneModel(api.store.state, y), y).w;
  api.openSystem('y-trip');
  const fit = Math.floor(89800 / w) / 100;
  assert.equal(api.ui.sysZoom, Math.max(0.5, fit));
  assert.equal(app.document.querySelector('#sys-zoom-label').textContent, Math.round(api.ui.sysZoom * 100) + '%');
  api.runCommand('zoomReset');
  assert.equal(api.ui.sysZoom, 1);
  app.document.querySelector('#toolbar [data-action="zoom-fit"]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(api.ui.sysZoom, fit, '全体を表示は 50% より小さくてもよい');
  // 2 回目に出すときは、倍率を変えない
  api.runCommand('zoomReset');
  api.openSystemPanel('roles');
  api.openSystemPanel('swimlane');
  assert.equal(api.ui.sysZoom, 1);
});

test('拡大縮小しても、点から図の中の位置を正しく求める（倍率で割る）', async (t) => {
  const { api, inner, pt, sys, pal } = await boot(t);
  api.runCommand('zoomOut');
  api.runCommand('zoomOut');
  assert.equal(api.ui.sysZoom, 0.8);
  click(pal('task'));
  const c = pt(1, 1100);
  press(inner(), { clientX: c.clientX * 0.8, clientY: c.clientY * 0.8 });
  const added = sys().swimlane.steps.at(-1);
  assert.deepEqual([added.roleId, added.col, added.pos.horizontal.flow, added.pos.horizontal.cross], ['l-b', 5, 1096, 65]);
});

test('ほかの図（関連図・ステータスの流れの図・画面遷移図の図）と出力のスイムレーン図には、押す所を描かない', async (t) => {
  const { api, S } = await boot(t, sampleState(), null);
  const y = S().systems[0];
  const html = api.swimlaneHtml(S(), y, { idPrefix: 'xi-swim', bare: true });
  assert.ok(!/sw-hit|sw-mid|sw-edge|sw-ends|swim-over|swim-arrow-s/.test(html));
  const view = api.viewHtml('process', S(), S().designs[0]);
  assert.ok(!/sw-hit|sw-line/.test(view));
  await waitFor(() => true);
});

// ── 見直しで見つけたもの（第 9 段階の T9）──
// 図の上の文字の欄で直した後、右の欄を押すと文字の欄を離れて確定する（ブラウザでは、押した時点〔mousedown〕の後にフォーカスが移る）。
// 確定のときに右の欄を作り直すと、押した欄・ボタンが click の前に消え、1 回押しても効かなかった（その後の Backspace で作業の箱が消えた）
test('図の上の文字の欄（作業）で直してから右のパネルを押す: 確定しても右のパネルを作り直さず（同じ要素）、値だけ書き換える。押した欄・ボタンが 1 回で効く', async (t) => {
  const { app, $, node, step, sys } = await boot(t);
  fire(node('w-5'), 'dblclick');
  const field = $('#sys-side [data-sw="text"]');
  const role = $('#sys-side [data-sw="role"]');
  $('#sys-swim .swim-edit').value = '出張に行く（直した）';
  field.focus();
  assert.equal(step('w-5').text, '出張に行く（直した）', '確定する');
  assert.equal($('#sys-side [data-sw="text"]'), field, '右のパネルを作り直さない');
  assert.equal(field.value, '出張に行く（直した）', '右のパネルの文字の欄の値も書き換える');
  assert.equal(app.document.activeElement, field, '押した欄にフォーカスが移る');
  assert.equal($('#sys-side [data-sw="role"]'), role);
  assert.equal(node('w-5').querySelector('b').textContent, '出張に行く（直した）', '図は描き直す');
  // もう一度直してから「この作業を削除」（押した時点でフォーカスが移り、確定する）
  fire(node('w-5'), 'dblclick');
  $('#sys-swim .swim-edit').value = '出張する';
  const del = $('#sys-side [data-action="sys-step-del"]');
  del.focus();
  assert.equal(step('w-5').text, '出張する');
  assert.ok(del.isConnected, '押したボタンは残る');
  click(del);
  assert.equal(sys().swimlane.steps.some((w) => w.id === 'w-5'), false, '1 回で消える');
});
test('図の上の文字の欄（矢印）で直してから右のパネルを押す: 確定しても右のパネルを作り直さず、矢印の文字の欄の値だけ書き換える。「この矢印を消す」が 1 回で効く', async (t) => {
  const { $, edgeHit, edges } = await boot(t);
  fire(edgeHit('e-3'), 'dblclick');
  const label = $('#sys-side [data-sw="edge-label"]');
  $('#sys-swim .swim-edit').value = '急ぎ';
  label.focus();
  assert.deepEqual(edges()[2], ['w-3', 'w-4', '急ぎ']);
  assert.equal($('#sys-side [data-sw="edge-label"]'), label, '右のパネルを作り直さない');
  assert.equal(label.value, '急ぎ');
  fire(edgeHit('e-3'), 'dblclick');
  $('#sys-swim .swim-edit').value = '承認';
  const del = $('#sys-side [data-action="sys-edge-del"]');
  del.focus();
  assert.ok(del.isConnected);
  click(del);
  assert.equal(edges().some((e) => e[0] === 'w-3' && e[1] === 'w-4'), false, '1 回で消える');
});
test('図の上の文字の欄で直した後、右のパネルがほかの作業を出しているときは、右のパネルを描き直す（矢印の先の名前を今の名前にする）', async (t) => {
  const { api, $, $$, node, step } = await boot(t);
  fire(node('w-2'), 'dblclick');
  $('#sys-swim .swim-edit').value = '出張を申請する';
  api.ui.stepSel = 'w-1'; // 右の欄が w-1（次の作業が w-2）を出している形にする
  api.runCommand('zoomIn'); // 命令の前に確定する
  assert.equal(step('w-2').text, '出張を申請する');
  assert.deepEqual($$('#sys-side .sw-next .to').map((x) => x.textContent), ['→ 出張を申請する']);
});
test('同じ列に 2 つ並んだ箱の下の箱を横にドラッグしても、同じレーンのまま（吸着とレーンは、ドラッグを始めたときの並べ方で求める。前は描き直しで帯が低くなり、1 つ下の帯に入った）', async (t) => {
  const st = sampleState();
  st.systems[0].swimlane.steps.push(step('w-9', 'l-a', 1, 'task', '並べた箱'));
  const { app, node, geom, step: get } = await boot(t, st);
  const b = geom().pos['w:w-9'];
  assert.ok(b.y > geom().pos['w:w-2'].y, '申請者のレーンの、w-2 の下');
  const [sx, sy] = [b.x + b.w / 2, b.y + b.h / 2];
  fire(node('w-9'), 'mousedown', at(sx, sy));
  for (let dx = 10; dx <= 300; dx += 10) fire(app.document, 'mousemove', at(sx + dx, sy));
  fire(app.document, 'mouseup', at(sx + 300, sy));
  assert.equal(get('w-9').roleId, 'l-a');
  assert.equal(get('w-9').pos.horizontal.flow, sx + 300);
});
// フォーカスが見えない radio（作業の種類）に残っていても、元に戻す・やり直すは効く（どの画面でも）。Delete・Backspace は欄の中の扱いのまま
test('作業の種類（radio）を押した後も Ctrl+Z・Ctrl+Y は効く。Delete・Backspace は作業を消さない', async (t) => {
  const { app, $, node, step, sys } = await boot(t);
  press(node('w-6'));
  const r = $('#sys-side input[data-sw="kind"][value="doc"]');
  r.focus();
  r.checked = true;
  r.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(step('w-6').kind, 'doc');
  assert.equal(app.document.activeElement.dataset.sw, 'kind', 'フォーカスは種類の欄に残る');
  key(app, app.document.activeElement, { key: 'z', ctrlKey: true });
  assert.equal(step('w-6').kind, 'task');
  key(app, app.document.activeElement, { key: 'y', ctrlKey: true });
  assert.equal(step('w-6').kind, 'doc');
  key(app, app.document.activeElement, { key: 'Delete' });
  key(app, app.document.activeElement, { key: 'Backspace' });
  assert.equal(sys().swimlane.steps.length, 8);
});
