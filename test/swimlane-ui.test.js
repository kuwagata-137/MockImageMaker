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
test('メニューバー: 「モード」の組（▶ 選択・→ 接続・✋ 手のひらツール。v1.03 段階 B・q148 案B）・「編集」の組（⧉ コピー・📋 貼り付け・✕ 削除）・「図の向き」（横向き・縦向き）・「配置」（工程を整列する）と「表示」の「全体を表示」。削除とコピーは選んでいるときだけ、貼り付けはコピーした後だけ押せる。スイムレーン図のほかでは押せない', async (t) => {
  const { app, api, $, $$, node } = await boot(t);
  assert.deepEqual($$('#toolbar .glabel').map((e) => e.textContent), ['ファイル', '履歴', 'モード', '編集', '図の向き', '配置', '表示']);
  assert.deepEqual(['swim-horizontal', 'swim-vertical', 'swim-arrange'].map((a) => $(`#toolbar [data-action="${a}"]`).textContent.replace(/\s+/g, '')), ['横向き', '縦向き', '⊞工程を整列する']);
  const sel = $('#toolbar [data-action="swim-select"]');
  const con = $('#toolbar [data-action="swim-connect"]');
  const hand = $('#toolbar [data-action="swim-hand"]');
  const copy = $('#toolbar [data-action="swim-copy"]');
  const paste = $('#toolbar [data-action="swim-paste"]');
  const del = $('#toolbar [data-action="swim-delete"]');
  assert.deepEqual([sel, con, hand].map((b) => b.closest('.rgroup').querySelector('.glabel').textContent), ['モード', 'モード', 'モード']);
  assert.deepEqual([copy, paste, del].map((b) => b.closest('.rgroup').querySelector('.glabel').textContent), ['編集', '編集', '編集']);
  assert.deepEqual([sel, con, hand, copy, paste, del].map((b) => b.textContent.replace(/\s+/g, '')), ['▶選択', '→接続', '✋手のひらツール', '⧉コピー', '📋貼り付け', '✕選んだものを削除する']);
  assert.deepEqual([sel.classList.contains('on'), con.classList.contains('on'), hand.classList.contains('on'), del.disabled, copy.disabled, paste.disabled], [true, false, false, true, true, true]);
  assert.ok($('#toolbar [data-action="zoom-fit"]'));
  assert.equal($('#toolbar [data-action="zoom-fit"]').textContent, '⊡ 全体を表示');
  press(node('w-3'));
  assert.deepEqual([del.disabled, copy.disabled, paste.disabled], [false, false, true]);
  click(copy);
  assert.equal(paste.disabled, false, 'コピーした後は、貼り付けを押せる');
  click(con);
  assert.equal(api.ui.swimMode, 'connect');
  assert.deepEqual([sel.classList.contains('on'), con.classList.contains('on')], [false, true]);
  assert.equal(del.disabled, true, '接続モードにすると、選ぶのをやめる');
  click(sel);
  assert.equal(api.ui.swimMode, 'select');
  click(hand);
  assert.equal(api.ui.swimMode, 'hand');
  assert.deepEqual([sel.classList.contains('on'), hand.classList.contains('on')], [false, true]);
  click(sel);
  click($('#sys-list .db-entry[data-panel="roles"]'));
  assert.deepEqual([sel.disabled, con.disabled, hand.disabled, copy.disabled, paste.disabled, del.disabled, $('#toolbar [data-action="zoom-fit"]').disabled], [true, true, true, true, true, true, true]);
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

// ── v1.03 段階 B: 複数選択・まとめて動かす・複製・矢印キー・囲む選択・コピーと貼り付け・手のひらツール・ホイール・見出しを端に残す（q147〜q150）──
test('複数選択（段階 B・q147 案B）: Shift か Ctrl＋クリックで足す・外す。選んだ工程は全部に同じ青い枠。右のパネルは選んだ数とまとめて削除するボタン。Ctrl+A ですべて・Esc でやめる。Delete でまとめて消し、Ctrl+Z 1 回で戻る', async (t) => {
  const { app, api, $, $$, node, side, sys } = await boot(t);
  press(node('w-1'));
  press(node('w-3'), { shiftKey: true });
  assert.deepEqual(plain(api.ui.stepSels), ['w-1', 'w-3']);
  assert.equal(api.ui.stepSel, null, '2 つ以上のときは、1 つのときの id はない');
  assert.deepEqual($$('#sys-swim .mnode.sw.sel').map((n) => n.dataset.node), ['w:w-1', 'w:w-3']);
  assert.match(side(), /2 個の工程を選んでいます/);
  assert.ok($('#sys-side [data-action="swim-delete"]'));
  press(node('w-5'), { ctrlKey: true });
  assert.deepEqual(plain(api.ui.stepSels), ['w-1', 'w-3', 'w-5']);
  press(node('w-3'), { ctrlKey: true });
  assert.deepEqual(plain(api.ui.stepSels), ['w-1', 'w-5'], 'もう一度押すと外す');
  press(node('w-5'));
  assert.deepEqual(plain(api.ui.stepSels), ['w-5'], '選んだ工程の 1 つを（キーなしで）押すと、それだけを選ぶ');
  key(app, app.document.body, { key: 'a', ctrlKey: true });
  assert.equal(api.ui.stepSels.length, 8, 'Ctrl+A ですべて選ぶ');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.stepSels.length, 0);
  press(node('w-6'));
  press(node('w-7'), { shiftKey: true });
  key(app, app.document.body, { key: 'Delete' });
  assert.deepEqual(sys().swimlane.steps.map((w) => w.id), ['w-1', 'w-2', 'w-3', 'w-4', 'w-5', 'w-8']);
  assert.ok(!sys().swimlane.edges.some((e) => ['w-6', 'w-7'].includes(e.from) || ['w-6', 'w-7'].includes(e.to)), 'つながる矢印も消す');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().swimlane.steps.length, 8, '元に戻す 1 回で、2 つとも戻る');
  assert.equal(sys().swimlane.edges.length, 8);
});

test('囲む選択（段階 B・q150 案B）: 何もない所からドラッグすると点線の青い枠を出し、全体が枠に入った工程を選ぶ（一部がはみ出した工程は選ばない）。Shift を押していたら今の選択に足す。動かさずに押しただけなら選ぶのをやめる', async (t) => {
  const { app, api, $, inner, geom, node } = await boot(t);
  const { pos } = geom();
  const [b1, b2] = [pos['w:w-1'], pos['w:w-2']];
  fire(inner(), 'mousedown', at(b1.x - 10, b1.y - 10));
  fire(inner(), 'mousemove', at(b2.x + b2.w / 2, b2.y + b2.h + 10));
  assert.ok($('#swim-band'), '囲んでいる間は点線の枠');
  fire(inner(), 'mouseup', at(b2.x + b2.w / 2, b2.y + b2.h + 10));
  assert.equal($('#swim-band'), null);
  assert.deepEqual(plain(api.ui.stepSels), ['w-1'], 'w-2 は右半分がはみ出しているので選ばない');
  const b5 = pos['w:w-5'];
  fire(inner(), 'mousedown', { ...at(b5.x - 10, b5.y - 10), shiftKey: true });
  fire(inner(), 'mousemove', { ...at(b5.x + b5.w + 10, b5.y + b5.h + 10), shiftKey: true });
  fire(inner(), 'mouseup', { ...at(b5.x + b5.w + 10, b5.y + b5.h + 10), shiftKey: true });
  assert.deepEqual(plain(api.ui.stepSels), ['w-1', 'w-5'], 'Shift なら足す');
  press(inner(), at(b5.x - 40, b5.y + b5.h + 60));
  assert.deepEqual(plain(api.ui.stepSels), []);
  void app; void node;
});

test('まとめて動かす（段階 B）: 選んだ工程のどれかをドラッグすると、全部が同じだけ動く（掴んだ工程だけ吸着）。真ん中の入ったレーンの役割になり、選んだまま。Ctrl+Z 1 回で戻る', async (t) => {
  const { app, api, node, inner, center, step, geom } = await boot(t);
  press(node('w-1'));
  press(node('w-2'), { shiftKey: true });
  const before = geom().pos;
  const c = center('w-2');
  fire(node('w-2'), 'mousedown', c);
  fire(inner(), 'mousemove', at(c.clientX, c.clientY + 60));
  fire(inner(), 'mousemove', at(c.clientX, c.clientY + 130));
  fire(inner(), 'mouseup', at(c.clientX, c.clientY + 130));
  assert.deepEqual([step('w-1').roleId, step('w-2').roleId], ['l-b', 'l-b'], '2 つとも上長のレーンへ');
  const after = geom().pos;
  const d = (k) => [after[k].x - before[k].x, after[k].y - before[k].y];
  assert.deepEqual(d('w:w-1'), d('w:w-2'), '同じだけ動く');
  assert.ok(d('w:w-2')[1] > 100);
  assert.deepEqual(plain(api.ui.stepSels), ['w-1', 'w-2'], '選んだまま');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual([step('w-1').roleId, step('w-2').roleId], ['l-a', 'l-a']);
});

test('Ctrl＋ドラッグで複製（段階 B）: 選んだ工程を写して、放した所に足す（写した工程どうしの矢印も写す。元の工程はそのまま）。足した工程を選ぶ。途中で Ctrl を離すと移動に戻る', async (t) => {
  const { app, api, node, inner, center, sys, step } = await boot(t);
  press(node('w-3'));
  press(node('w-4'), { shiftKey: true });
  const c = center('w-4');
  fire(node('w-4'), 'mousedown', { ...c, ctrlKey: true });
  fire(inner(), 'mousemove', { ...at(c.clientX, c.clientY + 60), ctrlKey: true });
  assert.equal(app.document.querySelectorAll('#sys-swim .swim-orig').length, 2, '複製の間は、元の位置に元の工程の写し');
  fire(inner(), 'mousemove', { ...at(c.clientX, c.clientY + 130), ctrlKey: true });
  fire(inner(), 'mouseup', { ...at(c.clientX, c.clientY + 130), ctrlKey: true });
  const y = sys();
  assert.equal(y.swimlane.steps.length, 10);
  const added = y.swimlane.steps.slice(8);
  assert.deepEqual(added.map((w) => [w.text, w.kind, w.roleId]), [['申請を確かめる', 'decision', 'l-c'], ['承認する', 'input', 'l-c']]);
  assert.deepEqual(y.swimlane.edges.slice(8).map((e) => [e.from, e.to, e.label]), [[added[0].id, added[1].id, '承認']], 'w-3 → w-4 の矢印も写す');
  assert.deepEqual([step('w-3').roleId, step('w-4').roleId], ['l-b', 'l-b'], '元の工程は動かさない');
  assert.deepEqual(plain(api.ui.stepSels), added.map((w) => w.id));
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().swimlane.steps.length, 8);
  // 途中で Ctrl を離すと、移動
  press(node('w-4'));
  const c2 = center('w-4');
  fire(node('w-4'), 'mousedown', { ...c2, ctrlKey: true });
  fire(inner(), 'mousemove', { ...at(c2.clientX, c2.clientY + 60), ctrlKey: true });
  fire(inner(), 'mousemove', at(c2.clientX, c2.clientY + 130));
  fire(inner(), 'mouseup', at(c2.clientX, c2.clientY + 130));
  assert.equal(sys().swimlane.steps.length, 8);
  assert.equal(step('w-4').roleId, 'l-c');
  assert.equal(app.document.querySelectorAll('#sys-swim .swim-orig').length, 0);
});

test('矢印キー（段階 B）: 選んだ工程を 1 ドット（Shift で 10 ドット）動かす（吸着しない）。1 回押す＝元に戻すの 1 回分。入力欄の中では動かさない', async (t) => {
  const { app, api, $, node, geom } = await boot(t);
  press(node('w-5'));
  press(node('w-6'), { shiftKey: true });
  const b0 = geom().pos;
  key(app, app.document.body, { key: 'ArrowRight' });
  key(app, app.document.body, { key: 'ArrowDown', shiftKey: true });
  const b1 = geom().pos;
  for (const k of ['w:w-5', 'w:w-6']) assert.deepEqual([b1[k].x - b0[k].x, b1[k].y - b0[k].y], [1, 10], k);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  const b2 = geom().pos;
  assert.deepEqual([b2['w:w-5'].x - b0['w:w-5'].x, b2['w:w-5'].y - b0['w:w-5'].y], [1, 0], '元に戻す 1 回で、1 回分だけ戻る');
  press(node('w-5'));
  key(app, $('#sys-side [data-sw="text"]'), { key: 'ArrowRight' });
  assert.equal(geom().pos['w:w-5'].x, b2['w:w-5'].x);
  void api;
});

test('コピーと貼り付け（段階 B・q149 案A）: Ctrl+C でコピー、Ctrl+V で貼り付けモード（薄い形がカーソルに付く・右のパネルに案内）。図を押した所に貼り付け、貼り付けた工程を選ぶ。工程どうしの矢印も写す。Esc・右クリックでやめる', async (t) => {
  const { app, api, $, $$, node, inner, sys, side, toast, pt } = await boot(t);
  key(app, app.document.body, { key: 'v', ctrlKey: true });
  assert.match(toast(), /貼り付ける工程がありません/);
  assert.equal(api.ui.swimPaste, null);
  press(node('w-2'));
  press(node('w-3'), { shiftKey: true });
  key(app, app.document.body, { key: 'c', ctrlKey: true });
  assert.match(toast(), /2 個の工程をコピーしました/);
  key(app, app.document.body, { key: 'v', ctrlKey: true });
  assert.ok(api.ui.swimPaste);
  assert.ok($('#sys-swim').classList.contains('pasting'));
  assert.ok($('#toolbar [data-action="swim-paste"]').classList.contains('on'));
  assert.match(side(), /貼り付け/);
  fire(inner(), 'mousemove', pt(2, 700));
  assert.equal($$('#swim-paste-ghost .mnode').length, 2, '薄い形');
  press(inner(), pt(2, 700));
  const y = sys();
  assert.equal(y.swimlane.steps.length, 10);
  const added = y.swimlane.steps.slice(8);
  assert.deepEqual(added.map((w) => w.text), ['出張申請を入力する', '申請を確かめる']);
  assert.equal(added[0].ref.designId, 'd-trip', 'このシステムの画面設計を指す「使う画面」は写す');
  assert.deepEqual(y.swimlane.edges.slice(8).map((e) => [e.from, e.to, e.label]), [[added[0].id, added[1].id, ''], [added[1].id, added[0].id, '差し戻し']]);
  assert.deepEqual(plain(api.ui.stepSels), added.map((w) => w.id));
  assert.equal(api.ui.swimPaste, null, '貼り付けたら、貼り付けモードをやめる');
  assert.equal($('#swim-paste-ghost'), null);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().swimlane.steps.length, 8, '元に戻す 1 回で戻る');
  key(app, app.document.body, { key: 'v', ctrlKey: true });
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.swimPaste, null, 'Esc でやめる');
  click($('#toolbar [data-action="swim-paste"]'));
  assert.ok(api.ui.swimPaste, 'ツールバーのボタンでも貼り付けモード');
  fire(inner(), 'contextmenu', { ...pt(2, 700), button: 2 });
  assert.equal(api.ui.swimPaste, null, '右クリックでやめる');
  assert.equal(sys().swimlane.steps.length, 8);
  // Ctrl+D: 選んだ工程で貼り付けモード（コピーしたもの〔w-2・w-3〕は変えない）
  press(node('w-8'));
  key(app, app.document.body, { key: 'd', ctrlKey: true });
  assert.deepEqual(plain(api.ui.swimPaste.steps.map((c) => c.key)), ['w-8']);
  key(app, app.document.body, { key: 'Escape' });
  key(app, app.document.body, { key: 'v', ctrlKey: true });
  assert.deepEqual(plain(api.ui.swimPaste.steps.map((c) => c.key)), ['w-2', 'w-3']);
});

test('アプリのメニュー「編集」の命令（段階 B）: システムの画面では、すべて選ぶ・コピー・貼り付け・削除が工程に効く', async (t) => {
  const { api, node, sys } = await boot(t);
  api.runCommand('selectAll');
  assert.equal(api.ui.stepSels.length, 8);
  press(node('w-8'));
  api.runCommand('copyPart');
  api.runCommand('pastePart');
  assert.deepEqual(plain(api.ui.swimPaste.steps.map((c) => c.key)), ['w-8']);
  api.runCommand('swimEscape');
  api.runCommand('deletePart');
  assert.equal(sys().swimlane.steps.length, 7);
});

test('手のひらツール（段階 B）: 選んでいた工程はそのまま。右のパネルに案内。工程は押して選べる。Esc・V で選択に戻る。左右のボタンの同時押しで選択と切り替え、そのときの右クリックでは消さない', async (t) => {
  const { app, api, $, node, inner, side, sys } = await boot(t);
  press(node('w-1'));
  click($('#toolbar [data-action="swim-hand"]'));
  assert.equal(api.ui.swimMode, 'hand');
  assert.ok($('#sys-swim').classList.contains('hand'));
  assert.equal(api.ui.stepSel, 'w-1', '選択と手のひらツールの切り替えでは、選んだまま');
  press(node('w-3'));
  assert.equal(api.ui.stepSel, 'w-3', '手のひらツールでも工程を選べる');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.swimMode, 'select');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.stepSel, null);
  click($('#toolbar [data-action="swim-hand"]'));
  assert.match(side(), /手のひらツール/);
  key(app, app.document.body, { key: 'v' });
  assert.equal(api.ui.swimMode, 'select');
  // 同時押し: 左を押したまま右を押す
  fire(node('w-1'), 'mousedown', { button: 2, buttons: 3 });
  assert.equal(api.ui.swimMode, 'hand');
  fire(node('w-1'), 'contextmenu', { button: 2 });
  assert.equal(sys().swimlane.steps.length, 8, '同時押しの右クリックでは消さない');
  fire(app.document.body, 'mouseup', { button: 2, buttons: 0 });
  await new Promise((r) => setTimeout(r, 10));
  fire(inner(), 'mousedown', { button: 0, buttons: 3 });
  assert.equal(api.ui.swimMode, 'select', 'もう一度で選択へ');
});

test('ホイールの拡大縮小（段階 B）: Ctrl＋ホイールはどのモードでも、手のひらツールではホイールだけで拡大縮小する。選択のホイールだけでは変えない', async (t) => {
  const { app, api, $, inner } = await boot(t);
  const wheel = (init) => inner().dispatchEvent(new app.window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
  const z0 = api.ui.sysZoom;
  wheel({ deltaY: -100 });
  assert.equal(api.ui.sysZoom, z0);
  wheel({ deltaY: -100, ctrlKey: true });
  assert.ok(api.ui.sysZoom > z0);
  const z1 = api.ui.sysZoom;
  click($('#toolbar [data-action="swim-hand"]'));
  wheel({ deltaY: 100 });
  assert.ok(api.ui.sysZoom < z1);
});

test('レーンの見出しを端に残す（段階 B）: システムの画面の図の前に、見出しの写しを sticky の箱で置く（横向きは左・縦向きは上）。説明書（PDF）の図には出さない', async (t) => {
  const { api, $, $$, S, call } = await boot(t);
  assert.ok($('#sys-swim .swim-stick:not(.down)'));
  assert.deepEqual($$('#sys-swim .swim-stick .swim-lab').map((e) => e.textContent), ['申請者', '上長', '経理']);
  const y = S().systems[0];
  assert.ok(!api.swimlaneHtml(S(), y).includes('swim-stick'));
  await call('set_swimlane', { system: '出張申請システム', orientation: 'vertical', steps: y.swimlane.steps.map((w) => ({ key: w.id, role: ['申請者', '上長', '経理'][['l-a', 'l-b', 'l-c'].indexOf(w.roleId)], kind: w.kind, text: w.text })) });
  assert.ok($('#sys-swim .swim-stick.down'), '縦向きは上の端');
});

test('まとめて置く・写して足す・まとめて消す（actions.placeSteps・addStepsAt・deleteSteps。段階 B）: 直せない行があれば何もしない。使う画面は、そのシステムの画面設計のときだけ写す', async (t) => {
  const { api, sys } = await boot(t);
  const before = JSON.stringify(sys().swimlane);
  assert.equal(api.actions.placeSteps('y-trip', [{ id: 'w-1', roleId: 'l-b', flow: 300, cross: 60 }, { id: 'w-x', roleId: 'l-b', flow: 400, cross: 60 }]), false);
  assert.equal(JSON.stringify(sys().swimlane), before);
  assert.equal(api.actions.placeSteps('y-trip', [{ id: 'w-1', roleId: 'l-b', flow: 300, cross: 60 }, { id: 'w-2', roleId: 'l-c', flow: 400, cross: 60 }]), true);
  assert.deepEqual(['w-1', 'w-2'].map((id) => sys().swimlane.steps.find((w) => w.id === id).roleId), ['l-b', 'l-c']);
  const ids = api.actions.addStepsAt('y-trip', [
    { key: 'a', step: { kind: 'task', text: '写し 1', memo: 'メモ', ref: { designId: 'd-cli', screenId: null, stateId: null } }, roleId: 'l-a', flow: 900, cross: 65 },
    { key: 'b', step: { kind: 'doc', text: '写し 2', memo: '', ref: { designId: 'd-emp', screenId: null, stateId: null } }, roleId: 'l-a', flow: 1100, cross: 65 },
  ], [{ from: 'a', to: 'b', label: '次' }, { from: 'a', to: 'zz' }]);
  const y = sys();
  const [a, b] = ids.map((id) => y.swimlane.steps.find((w) => w.id === id));
  assert.deepEqual([a.text, a.memo, a.ref.designId, b.ref.designId], ['写し 1', 'メモ', null, 'd-emp'], '取引先マスタはこのシステムにないので写さない');
  assert.deepEqual(y.swimlane.edges.filter((e) => ids.includes(e.from)).map((e) => [e.from, e.to, e.label]), [[a.id, b.id, '次']]);
  assert.equal(api.actions.addStepsAt('y-trip', [{ key: 'a', step: {}, roleId: 'l-x', flow: 1, cross: 1 }]), null);
  assert.equal(api.actions.deleteSteps('y-trip', ['w-zz']), false);
  assert.equal(api.actions.deleteSteps('y-trip', ids), true);
  assert.equal(sys().swimlane.steps.length, 8);
});

// ── 段階 C（v1.03・q151〜q156）: 工程の大きさ・線の形・レーンの太さの手直し ──
test('工程の大きさ（actions.resizeStep・resetStepSize。段階 C・q151）: 今の向きの size と位置を 1 回で直す。下限 24。中身が変わらないときは積まない。自動に戻すと size を消す', async (t) => {
  const { api, sys, step, geom } = await boot(t);
  assert.equal(api.actions.resizeStep('y-trip', 'w-5', { w: 200, roleId: 'l-x', flow: 1, cross: 1 }), false, 'ない役割');
  assert.equal(api.actions.resizeStep('y-trip', 'w-5', { roleId: 'l-a', flow: 1, cross: 1 }), false, '大きさがない');
  const b = geom().pos['w:w-5'];
  const n0 = api.store.undoStack.length;
  assert.equal(api.actions.resizeStep('y-trip', 'w-5', { w: 200, h: 10, roleId: 'l-a', flow: b.flow + 40, cross: b.cross }), true);
  assert.equal(api.store.undoStack.length, n0 + 1, '元に戻すの 1 回分');
  assert.deepEqual(step('w-5').size, { horizontal: { w: 200, h: 24 } }, '高さは下限 24');
  const b2 = geom().pos['w:w-5'];
  assert.deepEqual([b2.w, b2.h, b2.flow], [200, b.h, b.flow + 40], '幅は決めたとおり。高さは下限なので、文字の入る高さより低くはならない');
  assert.equal(api.actions.resizeStep('y-trip', 'w-5', { w: 200, roleId: 'l-a', flow: b.flow + 40, cross: b.cross }), false, '変わらない');
  assert.equal(api.store.undoStack.length, n0 + 1);
  assert.equal(api.actions.resetStepSize('y-trip', 'w-5'), true);
  assert.equal(step('w-5').size, undefined);
  assert.equal(api.actions.resetStepSize('y-trip', 'w-5'), false);
  api.runCommand('undo');
  assert.deepEqual(step('w-5').size, { horizontal: { w: 200, h: 24 } });
  // 向きごと（q154）: 縦向きでは横向きの大きさを使わず、縦向きで決めた大きさは横向きに戻しても残る
  assert.equal(api.actions.setSwimOrient('y-trip', 'vertical'), true);
  assert.notEqual(geom().pos['w:w-5'].w, 200);
  const v = geom().pos['w:w-5'];
  assert.equal(api.actions.resizeStep('y-trip', 'w-5', { h: 80, roleId: 'l-a', flow: v.flow, cross: v.cross }), true);
  assert.deepEqual(plain(step('w-5').size), { horizontal: { w: 200, h: 24 }, vertical: { h: 80 } });
  api.actions.setSwimOrient('y-trip', 'horizontal');
  assert.equal(geom().pos['w:w-5'].w, 200);
  assert.equal(sys().swimlane.steps.length, 8);
});

test('線の形（actions.setEdgeShape・resetEdgeShape。段階 C・q152・q156）: 今の向きの出入りの位置・曲がり角・文字の位置を入れ、null で消す。形の違う値は入れない。自動に戻すは文字の位置を残す', async (t) => {
  const { api, sys } = await boot(t);
  const shape = () => sys().swimlane.edges.find((e) => e.id === 'e-2').shape;
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-x', { labelT: 0.3 }), false, 'ない矢印');
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { other: 1 }), false, '知らない欄だけ');
  const n0 = api.store.undoStack.length;
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { orthoWps: [{ x: 300, y: 200 }, { x: 'a', y: 1 }] }), false, '数でない点があれば曲がり角ごと入れない（MPD と同じ）');
  assert.equal(api.store.undoStack.length, n0);
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { fromPin: { side: 'bottom', frac: 0.25 }, orthoWps: [{ x: 300, y: 200 }], labelT: 0.7, labelOff: [4, -6] }), true);
  assert.equal(api.store.undoStack.length, n0 + 1);
  const s1 = shape();
  assert.deepEqual(s1.horizontal.fromPin, { side: 'bottom', frac: 0.25 });
  assert.deepEqual(s1.horizontal.orthoWps, [{ x: 300, y: 200 }]);
  assert.deepEqual([s1.horizontal.labelT, s1.horizontal.labelOff], [0.7, [4, -6]]);
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { labelT: 0.7 }), false, '変わらない');
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { toPin: { side: 'nowhere', frac: 0.5 } }), false, '形の違う出入りの位置は入れない');
  assert.equal(api.actions.resetEdgeShape('y-trip', 'e-2'), true);
  assert.deepEqual(shape(), { horizontal: { labelT: 0.7, labelOff: [4, -6] } }, '文字の位置は残す');
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { labelT: null, labelOff: null }), true);
  assert.equal(shape(), undefined, '空になったら欄ごと消す');
  api.runCommand('undo');
  api.runCommand('undo');
  assert.deepEqual(shape().horizontal.orthoWps, [{ x: 300, y: 200 }], '1 回ずつ戻る');
  // 向きごと（q154）: 縦向きで直しても横向きの形は残る
  api.actions.setSwimOrient('y-trip', 'vertical');
  assert.equal(api.actions.setEdgeShape('y-trip', 'e-2', { labelT: 0.2 }), true);
  assert.deepEqual(Object.keys(shape()).sort(), ['horizontal', 'vertical']);
  assert.deepEqual(shape().vertical, { labelT: 0.2 });
});

test('レーンの太さ（actions.setLaneWidth。段階 C・q153）: 今の向きの値だけ変える。下限 100。null で自動に戻す。変わらないときは積まない', async (t) => {
  const { api, sys, geom } = await boot(t);
  const laneW = () => plain(sys().roles.find((r) => r.id === 'l-b').laneW);
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-x', 200), false);
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', 'a'), false);
  const n0 = api.store.undoStack.length;
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', 40), true);
  assert.deepEqual(laneW(), { horizontal: 100 }, '下限 100');
  assert.equal(geom().lanes[1].h, 100);
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', 100.2), false, '丸めて同じなら変えない');
  assert.equal(api.store.undoStack.length, n0 + 1);
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', 240), true);
  assert.equal(geom().lanes[1].h, 240);
  api.actions.setSwimOrient('y-trip', 'vertical');
  assert.notEqual(geom().lanes[1].w, 240, '縦向きは別');
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', 180), true);
  assert.deepEqual(laneW(), { horizontal: 240, vertical: 180 });
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', null), true);
  assert.deepEqual(laneW(), { horizontal: 240 });
  assert.equal(api.actions.setLaneWidth('y-trip', 'l-b', null), false);
});

test('手直しした線と工程の動き（段階 C）: 工程を動かすと、つながる矢印の曲がり角も同じだけ動く。整列は今の向きの曲がり角を消す。付け替えはその端の出入りの位置と曲がり角を消す。写して足すときは曲がり角を写さない', async (t) => {
  const { api, sys, geom } = await boot(t);
  const sh = (id) => sys().swimlane.edges.find((e) => e.id === id).shape;
  // e-5（w-4 → w-5）に曲がり角、e-6 に出入りの位置
  api.actions.setEdgeShape('y-trip', 'e-5', { orthoWps: [{ x: 900, y: 150 }], toPin: { side: 'top', frac: 0.5 } });
  api.actions.setEdgeShape('y-trip', 'e-6', { fromPin: { side: 'right', frac: 0.5 } });
  const b = geom().pos['w:w-5'];
  assert.equal(api.actions.placeStep('y-trip', 'w-5', { roleId: 'l-a', flow: b.flow + 30, cross: b.cross + 10 }), true);
  assert.deepEqual(sh('e-5').horizontal.orthoWps, [{ x: 930, y: 160 }], '工程と同じだけ動く');
  // 付け替え: 終わりの端を変えると toPin と曲がり角を消す（始まりの出入りの位置は残す）
  api.actions.setEdgeShape('y-trip', 'e-5', { fromPin: { side: 'bottom', frac: 0.5 } });
  assert.equal(api.actions.relinkEdge('y-trip', 'e-5', { to: 'w-6' }), true);
  assert.deepEqual(sh('e-5'), { horizontal: { fromPin: { side: 'bottom', frac: 0.5 } } });
  // 整列: 今の向きの曲がり角だけを消す（出入りの位置は残す）。曲がり角だけあるときも動く
  api.actions.setEdgeShape('y-trip', 'e-6', { orthoWps: [{ x: 1100, y: 300 }] });
  api.actions.arrangeSwimlane('y-trip');
  assert.equal(api.actions.arrangeSwimlane('y-trip'), false, '2 回目は何もない');
  assert.deepEqual(sh('e-6'), { horizontal: { fromPin: { side: 'right', frac: 0.5 } } });
  api.actions.setEdgeShape('y-trip', 'e-6', { orthoWps: [{ x: 1100, y: 300 }] });
  assert.equal(api.actions.arrangeSwimlane('y-trip'), true, '位置がなくても曲がり角があれば消す');
  // 写して足す: 曲がり角は写さず、出入りの位置は写す
  api.actions.setEdgeShape('y-trip', 'e-7', { orthoWps: [{ x: 1200, y: 300 }], labelT: 0.4 });
  const ids = api.actions.addStepsAt('y-trip', [
    { key: 'a', step: { kind: 'task', text: '写し 1' }, roleId: 'l-a', flow: 900, cross: 65 },
    { key: 'b', step: { kind: 'task', text: '写し 2' }, roleId: 'l-a', flow: 1100, cross: 65 },
  ], [{ ...plain(sys().swimlane.edges.find((e) => e.id === 'e-7')), from: 'a', to: 'b' }]);
  const copy = sys().swimlane.edges.find((e) => e.from === ids[0]);
  assert.deepEqual(copy.shape, { horizontal: { labelT: 0.4 } });
});

test('AI の set_swimlane（段階 C）: 手直しは AI に出さず、残す。矢印の端を変えたときだけ、その端の出入りの位置と曲がり角を消す（付け替えと同じ）', async (t) => {
  const { api, sys, call } = await boot(t);
  api.actions.setEdgeShape('y-trip', 'e-5', { orthoWps: [{ x: 900, y: 150 }], fromPin: { side: 'bottom', frac: 0.5 }, toPin: { side: 'top', frac: 0.5 } });
  api.actions.setEdgeShape('y-trip', 'e-6', { orthoWps: [{ x: 1100, y: 300 }], labelT: 0.3 });
  api.actions.setLaneWidth('y-trip', 'l-b', 200);
  const y = sys();
  const names = { 'l-a': '申請者', 'l-b': '上長', 'l-c': '経理' };
  const res = await call('set_swimlane', {
    system: '出張申請システム',
    steps: y.swimlane.steps.map((w) => ({ id: w.id, key: w.id, role: names[w.roleId], kind: w.kind, text: w.text })),
    edges: y.swimlane.edges.map((e) => (e.id === 'e-5' ? { id: e.id, from: e.from, to: 'w-6' } : { id: e.id, from: e.from, to: e.to, label: e.label })),
  });
  assert.ok(!JSON.stringify(res).includes('orthoWps'), '手直しは返事に出さない');
  assert.ok(!res.error, JSON.stringify(res));
  const sh = (id) => sys().swimlane.edges.find((e) => e.id === id).shape;
  assert.deepEqual(sh('e-5'), { horizontal: { fromPin: { side: 'bottom', frac: 0.5 } } });
  assert.deepEqual(sh('e-6'), { horizontal: { orthoWps: [{ x: 1100, y: 300 }], labelT: 0.3 } });
  assert.deepEqual(sys().roles.find((r) => r.id === 'l-b').laneW, { horizontal: 200 });
});

// ── 段階 C の図の上の操作（jsdom では要素の位置が 0 なので、マウスの位置がそのまま図の中の位置になる）──
test('8 つの四角（段階 C・q151 案A）: 1 つだけ選んだ工程に出す（2 つ以上・手のひらツールでは出さない）。ドラッグで掴んだ辺だけ動かし、元に戻す 1 回で戻る。四角のダブルクリックで自動の大きさに戻す', async (t) => {
  const { app, api, $, $$, node, geom, step: get } = await boot(t);
  press(node('w-5'));
  assert.deepEqual($$('#swim-rs .sw-rs').map((n) => n.getAttribute('data-h')), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  press(node('w-6'), { shiftKey: true });
  assert.equal($$('#swim-rs .sw-rs').length, 0, '2 つ選んだときは出さない');
  press(node('w-5'));
  click($('#toolbar [data-action="swim-hand"]'));
  assert.equal($$('#swim-rs .sw-rs').length, 0, '手のひらツールでは出さない');
  key(app, app.document.body, { key: 'v' });
  assert.equal($$('#swim-rs .sw-rs').length, 8);
  const b = geom().pos['w:w-5'];
  const rs = (h) => $(`#swim-rs .sw-rs[data-h="${h}"]`);
  fire(rs('e'), 'mousedown', at(b.x + b.w, b.y + b.h / 2));
  fire(app.document, 'mousemove', at(b.x + b.w + 50, b.y + b.h / 2));
  assert.ok(app.document.body.classList.contains('swim-dragging'));
  fire(app.document, 'mouseup', at(b.x + b.w + 50, b.y + b.h / 2));
  assert.ok(!app.document.body.classList.contains('swim-dragging'));
  assert.deepEqual(get('w-5').size, { horizontal: { w: b.w + 50 } });
  const b2 = geom().pos['w:w-5'];
  assert.deepEqual([b2.x, b2.w], [b.x, b.w + 50], '左の辺は動かない');
  assert.equal($$('#swim-rs .sw-rs').length, 8, '選んだまま');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(get('w-5').size, undefined);
  key(app, app.document.body, { key: 'y', ctrlKey: true });
  fire(rs('e'), 'dblclick');
  assert.equal(get('w-5').size, undefined, 'ダブルクリックで自動の大きさ');
  // 動かさずに放したときは何も変えない
  const n0 = api.store.undoStack.length;
  fire(rs('s'), 'mousedown', at(b.x + b.w / 2, b.y + b.h));
  fire(app.document, 'mouseup', at(b.x + b.w / 2, b.y + b.h));
  assert.equal(api.store.undoStack.length, n0);
});

test('区間の □ と端の ○（段階 C・q152 案A）: 選んだ矢印の区間に □ を出し、ドラッグで平行にずらす。○ を自分の工程の辺に沿って動かすと出入りの位置。どちらもダブルクリックで自動に戻す。□ の右クリックは矢印を消す', async (t) => {
  const { app, api, $, $$, S, edgeHit, inner, geom, sys } = await boot(t);
  const sh = () => (sys().swimlane.edges.find((e) => e.id === 'e-6') || {}).shape;
  const route = () => { const y = S().systems[0]; return api.swimDrawing(S(), y).routes['e-6']; };
  press(edgeHit('e-6'));
  assert.ok($('#sys-swim .sw-segs[data-edge="e-6"]').classList.contains('sel'));
  assert.ok($$('#sys-swim .sw-segs[data-edge="e-6"] .sw-seg').length > 0);
  // 区間: いちばん長い区間をずらす
  const r = route();
  const segs = r.wps.slice(0, -1).map((a, i) => ({ i, a, b: r.wps[i + 1], len: Math.hypot(r.wps[i + 1][0] - a[0], r.wps[i + 1][1] - a[1]) })).filter((g) => g.len >= 8);
  const g = segs.sort((p, q) => q.len - p.len)[0];
  const vert = Math.abs(g.a[0] - g.b[0]) < 0.5;
  const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
  const seg = () => $(`#sys-swim .sw-segs[data-edge="e-6"] .sw-seg[data-i="${g.i}"]`);
  fire(seg(), 'mousedown', at(...m));
  fire(app.document, 'mousemove', at(m[0] + (vert ? 25 : 0), m[1] + (vert ? 0 : 25)));
  fire(app.document, 'mouseup', at(m[0] + (vert ? 25 : 0), m[1] + (vert ? 0 : 25)));
  assert.ok(sh() && sh().horizontal.orthoWps.length >= 2, JSON.stringify(sh()));
  const moved = route().wps.some((p) => Math.abs((vert ? p[0] : p[1]) - (vert ? m[0] + 25 : m[1] + 25)) < 0.6);
  assert.ok(moved, 'ずらした所を通る');
  assert.equal(api.ui.edgeSel, 'e-6', '選んだまま');
  fire($('#sys-swim .sw-segs[data-edge="e-6"] .sw-seg'), 'dblclick');
  assert.equal(sh(), undefined, '□ のダブルクリックで自動の線');
  // 端の ○: 始まりの工程（w-5）の下の辺の 8 割の所（Alt で吸い付かない）
  const b = geom().pos['w:w-5'];
  const end = (which) => $(`#sys-swim .sw-ends[data-edge="e-6"] .sw-end[data-end="${which}"]`);
  fire(end('from'), 'mousedown');
  fire(inner(), 'mousemove', { ...at(b.x + b.w * 0.8, b.y + b.h + 4), altKey: true });
  assert.ok($('#swim-prev .sw-pin-mark'), '出入りの位置の印');
  fire(inner(), 'mouseup', { ...at(b.x + b.w * 0.8, b.y + b.h + 4), altKey: true });
  assert.deepEqual(sh(), { horizontal: { fromPin: { side: 'bottom', frac: 0.8 } } });
  assert.deepEqual(sys().swimlane.edges.find((e) => e.id === 'e-6').from, 'w-5', '付け替えない');
  fire(end('from'), 'dblclick');
  assert.equal(sh(), undefined, '○ のダブルクリックでその端の出入りの位置を消す');
  assert.equal($('.swim-edit'), null, '文字の欄は出さない');
  // □ の右クリックは矢印を消す
  api.actions.setEdgeShape('y-trip', 'e-6', { orthoWps: route().wps.slice(1, -1).map(([x, y]) => ({ x, y })) });
  press(edgeHit('e-6'));
  fire($('#sys-swim .sw-segs[data-edge="e-6"] .sw-seg'), 'contextmenu', { button: 2 });
  assert.ok(!sys().swimlane.edges.some((e) => e.id === 'e-6'));
});

test('レーンの境目と見出し（段階 C・q153 案A・q156）: 境目のドラッグで太さ（20 刻み・Alt で自由・札）。見出しのドラッグで並べ替え（青い太線）、ダブルクリックで名前の欄。境目のダブルクリックで自動の太さ', async (t) => {
  const { app, api, $, sys, toast } = await boot(t);
  const band = (id) => $(`#sys-swim .swim-over .sw-lanew[data-role="${id}"]`);
  fire(band('l-a'), 'mousedown', at(300, 130));
  fire(app.document, 'mousemove', at(300, 171));
  assert.equal($('#sys-swim .swim-tip').textContent, '申請者 の高さ: 180');
  assert.ok($('#sys-swim .swim-tip-line'));
  fire(app.document, 'mouseup', at(300, 171));
  assert.deepEqual(sys().roles[0].laneW, { horizontal: 180 });
  assert.equal($('#sys-swim .swim-tip'), null);
  fire(band('l-b'), 'mousedown', at(300, 310));
  fire(app.document, 'mousemove', { ...at(300, 321), altKey: true });
  fire(app.document, 'mouseup', { ...at(300, 321), altKey: true });
  assert.deepEqual(sys().roles[1].laneW, { horizontal: 141 }, 'Alt で吸い付かない');
  fire(band('l-b'), 'dblclick');
  assert.equal(sys().roles[1].laneW, undefined);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.ok(sys().roles.every((r) => !r.laneW), '1 回ずつ戻る');
  // 見出しの並べ替え（申請者を最後へ）
  const head = (id) => $(`#sys-swim .swim-inner .swim-lab[data-role="${id}"]`);
  fire(head('l-a'), 'mousedown', at(68, 65));
  fire(app.document, 'mousemove', at(68, 380));
  assert.ok($('#swim-lanedrop'), '入る所の青い太線');
  assert.ok(head('l-a').classList.contains('lane-grab'));
  fire(app.document, 'mouseup', at(68, 380));
  assert.deepEqual(sys().roles.map((r) => r.name), ['上長', '経理', '申請者']);
  assert.equal($('#swim-lanedrop'), null);
  // 動かさずに放したときは変えない
  fire(head('l-b'), 'mousedown', at(68, 65));
  fire(app.document, 'mouseup', at(68, 65));
  assert.deepEqual(sys().roles.map((r) => r.name), ['上長', '経理', '申請者']);
  // 端に残す見出しのダブルクリックで名前の欄
  fire($('#sys-swim .swim-stick .swim-lab[data-role="l-b"]'), 'dblclick');
  const input = $('#sys-swim .swim-stick .swim-edit');
  assert.equal(input.value, '上長');
  input.value = '経理';
  key(app, input, { key: 'Enter' });
  assert.equal(toast(), '「経理」という役割がもうあります。');
  assert.equal(sys().roles[0].name, '上長');
  fire($('#sys-swim .swim-stick .swim-lab[data-role="l-b"]'), 'dblclick');
  $('#sys-swim .swim-stick .swim-edit').value = '課長';
  key(app, $('#sys-swim .swim-stick .swim-edit'), { key: 'Enter' });
  assert.equal(sys().roles[0].name, '課長');
  assert.equal(api.ui.swimMode, 'select');
});

test('矢印の文字のドラッグ（段階 C・q156）: 線から 10 以内なら線の上に吸い付き（labelT だけ）、離すと離れ方（labelOff）も覚える。押しただけなら変えない', async (t) => {
  const { app, api, $, sys } = await boot(t);
  const lab = () => $('#sys-swim .sw-edge[data-edge="e-3"] .sw-labhit');
  const c = () => { const g = $('#sys-swim .sw-edge[data-edge="e-3"]'); return [Number(g.getAttribute('data-mx')), Number(g.getAttribute('data-my'))]; };
  const sh = () => (sys().swimlane.edges.find((e) => e.id === 'e-3').shape || {}).horizontal;
  const n0 = api.store.undoStack.length;
  fire(lab(), 'mousedown', at(...c()));
  fire(app.document, 'mouseup', at(...c()));
  assert.equal(api.store.undoStack.length, n0, '押しただけ');
  assert.equal(api.ui.edgeSel, 'e-3', '押すと矢印を選ぶ');
  const [x, y] = c();
  fire(lab(), 'mousedown', at(x, y));
  fire(app.document, 'mousemove', at(x - 20, y + 4));
  fire(app.document, 'mouseup', at(x - 20, y + 4));
  assert.ok(sh() && sh().labelT > 0 && sh().labelT < 1 && !sh().labelOff, JSON.stringify(sh()));
  const [x2, y2] = c();
  fire(lab(), 'mousedown', at(x2, y2));
  fire(app.document, 'mousemove', at(x2, y2 + 40));
  fire(app.document, 'mouseup', at(x2, y2 + 40));
  assert.ok(sh().labelOff && Math.abs(sh().labelOff[1] - 40) < 6, JSON.stringify(sh()));
});

test('右のパネルと役割のパネル（段階 C）: 「⟲ 線の形を自動に戻す」は手直しがあるときだけ押せる（文字の位置は残す）。大きさを決めた工程だけ「⟲ 大きさを自動に戻す」。役割の行に高さ（縦向きは幅）の欄', async (t) => {
  const { api, $, $$, sys, edgeHit, node, side } = await boot(t);
  press(edgeHit('e-6'));
  assert.match(side(), /線の形/);
  assert.ok($('#sys-side [data-action="sys-edge-shape-reset"]').disabled);
  api.actions.setEdgeShape('y-trip', 'e-6', { toPin: { side: 'left', frac: 0.5 }, labelT: 0.3 });
  click($('#sys-side [data-action="sys-edge-shape-reset"]'));
  assert.deepEqual(sys().swimlane.edges.find((e) => e.id === 'e-6').shape, { horizontal: { labelT: 0.3 } });
  assert.ok($('#sys-side [data-action="sys-edge-shape-reset"]').disabled);
  press(node('w-5'));
  assert.equal($('#sys-side [data-action="sys-step-size-reset"]'), null);
  api.actions.resetStepSize('y-trip', 'w-5');
  const b = api.swimlaneLayout(api.swimlaneModel(api.store.state, api.store.state.systems[0]), api.store.state.systems[0]).pos['w:w-5'];
  api.actions.resizeStep('y-trip', 'w-5', { w: 200, roleId: 'l-a', flow: b.flow, cross: b.cross });
  click($('#sys-side [data-action="sys-step-size-reset"]'));
  assert.equal(sys().swimlane.steps.find((w) => w.id === 'w-5').size, undefined);
  api.openSystemPanel('roles');
  const fields = () => $$('#sys-view [data-sy="role-lanew"]');
  assert.deepEqual(fields().map((x) => x.value), ['130', '130', '130']);
  assert.match(fields()[0].closest('label').textContent, /高さ/);
  setValue(fields()[1], '40');
  assert.deepEqual(sys().roles[1].laneW, { horizontal: 100 });
  assert.equal(fields()[1].value, '100');
  setValue(fields()[1], '');
  assert.equal(sys().roles[1].laneW, undefined, '空で自動');
  assert.equal(fields()[1].value, '130');
  api.actions.setSwimOrient('y-trip', 'vertical');
  assert.match(fields()[0].closest('label').textContent, /幅/);
});

test('手直しの出し先（段階 C・q155）: 説明書（PDF）と AI の画像の図（swimlaneHtml）には出し、MPD への出力（bdmExportPlan）には渡さない。説明書の図には押す所を描かない', async (t) => {
  const { api, S } = await boot(t);
  api.actions.setLaneWidth('y-trip', 'l-a', 200);
  const b = api.swimlaneLayout(api.swimlaneModel(S(), S().systems[0]), S().systems[0]).pos['w:w-5'];
  api.actions.resizeStep('y-trip', 'w-5', { w: 222, roleId: 'l-a', flow: b.flow, cross: b.cross });
  api.actions.setEdgeShape('y-trip', 'e-6', { fromPin: { side: 'bottom', frac: 0.5 } });
  const y = S().systems[0];
  const html = api.swimlaneHtml(S(), y);
  assert.match(html, /<rect x="0" y="0" width="\d+" height="200"/, '申請者のレーンの高さ 200');
  assert.match(html, /data-node="w:w-5"[^>]*width:222px/, '工程の幅 222');
  assert.ok(!/sw-rs|sw-seg|sw-lanew|swim-stick|data-role/.test(html), '押す所は描かない');
  const plan = JSON.stringify(api.bdmExportPlan(y, null).plan);
  assert.ok(!/laneW|size|shape|fromPin|orthoWps|labelT/.test(plan), plan);
});

// ── v1.03 段階 D: 整える機能（q157〜q161）──
test('見た目とグループ枠のデータ（段階 D）: 形の違う色・点線・文字の大きさ・揃え・グループ・レーンの色・枠は外すか直す。知らない欄は残す。枠がなければ欄を付けない', async (t) => {
  const s = sampleState();
  const y = s.systems[0];
  Object.assign(y.swimlane.steps[0], { color: '#FEE2E2', stroke: 'red', dashed: 'yes', fontSize: 100, textAlign: 'center', groupId: 'g-1' });
  Object.assign(y.swimlane.steps[1], { dashed: true, fontSize: 3.6, textAlign: 'left', groupId: '' });
  Object.assign(y.swimlane.edges[0], { dashed: true });
  Object.assign(y.swimlane.edges[1], { dashed: 1 });
  Object.assign(y.roles[0], { bg: '#EFF6FF', hd: '#bfdbfe' });
  Object.assign(y.roles[1], { bg: 'blue' });
  y.swimlane.frames = [{ id: 'f-1', text: '申請と承認', rect: { horizontal: { x: 10, y: 20, w: 30, h: 10 }, vertical: { x: 'a' }, other: 1 }, memo: 'x' }, { id: 'f-1', text: '', rect: null }, 'x'];
  const { sys } = await boot(t, s);
  const yy = sys();
  const [w1, w2] = yy.swimlane.steps;
  assert.deepEqual([w1.color, w1.stroke, w1.dashed, w1.fontSize, w1.textAlign, w1.groupId], ['#fee2e2', undefined, undefined, 48, undefined, 'g-1']);
  assert.deepEqual([w2.dashed, w2.fontSize, w2.textAlign, w2.groupId], [true, 6, 'left', undefined]);
  assert.deepEqual([yy.swimlane.edges[0].dashed, yy.swimlane.edges[1].dashed], [true, undefined]);
  assert.deepEqual([yy.roles[0].bg, yy.roles[0].hd, yy.roles[1].bg], ['#eff6ff', '#bfdbfe', undefined]);
  assert.equal(yy.swimlane.frames.length, 2);
  assert.deepEqual(yy.swimlane.frames[0], { id: 'f-1', text: '申請と承認', memo: 'x', rect: { horizontal: { x: 10, y: 20, w: 80, h: 44 }, other: 1 } }, '大きさの下限 80 × 44・形の違う向きは外す');
  assert.notEqual(yy.swimlane.frames[1].id, 'f-1', 'id の重なりを直す');
  assert.ok(!('rect' in yy.swimlane.frames[1]));
  assert.ok(!('frames' in sys('y-exp').swimlane), '枠がなければ欄を付けない');
});

test('工程の見た目・矢印の点線・レーンの色（actions.setStepLook・setEdgeDashed・setRoleColor。段階 D・q160）: null で標準に戻す。形の違う値は入れない。変わらないときは積まない', async (t) => {
  const { api, sys, step } = await boot(t);
  const n0 = api.store.undoStack.length;
  assert.equal(api.actions.setStepLook('y-trip', ['w-x'], { color: '#dbeafe' }), false);
  assert.equal(api.actions.setStepLook('y-trip', ['w-1'], { memo: 'x' }), false, '見た目の欄でなければ直さない');
  assert.equal(api.actions.setStepLook('y-trip', ['w-1', 'w-2'], { color: '#DBEAFE', stroke: '#3b82f6', fontSize: 16, textAlign: 'left', dashed: true }), true);
  assert.equal(api.store.undoStack.length, n0 + 1, '元に戻すの 1 回分');
  assert.deepEqual([step('w-2').color, step('w-2').stroke, step('w-2').fontSize, step('w-2').textAlign, step('w-2').dashed], ['#dbeafe', '#3b82f6', 16, 'left', true]);
  assert.equal(api.actions.setStepLook('y-trip', ['w-1', 'w-2'], { color: '#dbeafe' }), false, '変わらないときは積まない');
  assert.equal(api.actions.setStepLook('y-trip', ['w-1'], { color: 'red', fontSize: 200 }), true);
  assert.deepEqual([step('w-1').color, step('w-1').fontSize], [undefined, 48], '形の違う色は外し、大きさは 48 まで');
  assert.equal(api.actions.setStepLook('y-trip', ['w-2'], { color: null, stroke: null, dashed: null, textAlign: null, fontSize: null }), true);
  assert.ok(['color', 'stroke', 'dashed', 'textAlign', 'fontSize'].every((k) => !(k in step('w-2'))));
  // 矢印の点線
  assert.equal(api.actions.setEdgeDashed('y-trip', 'e-1', false), false);
  assert.equal(api.actions.setEdgeDashed('y-trip', 'e-1', true), true);
  assert.equal(sys().swimlane.edges[0].dashed, true);
  assert.equal(api.actions.setEdgeDashed('y-trip', 'e-1', true), false);
  assert.equal(api.actions.setEdgeDashed('y-trip', 'e-1', false), true);
  assert.ok(!('dashed' in sys().swimlane.edges[0]));
  // レーンの色
  assert.equal(api.actions.setRoleColor('y-trip', 'l-a', { bg: 'x', hd: '#bfdbfe' }), false);
  assert.equal(api.actions.setRoleColor('y-trip', 'l-a', null), false, '色がないときに標準へは戻さない');
  assert.equal(api.actions.setRoleColor('y-trip', 'l-a', { bg: '#EFF6FF', hd: '#BFDBFE' }), true);
  assert.deepEqual([sys().roles[0].bg, sys().roles[0].hd], ['#eff6ff', '#bfdbfe']);
  assert.equal(api.actions.setRoleColor('y-trip', 'l-a', { bg: '#eff6ff', hd: '#bfdbfe' }), false);
  assert.equal(api.actions.setRoleColor('y-trip', 'l-a', null), true);
  assert.ok(!('bg' in sys().roles[0]) && !('hd' in sys().roles[0]));
});

test('グループ化とグループ枠（actions.groupSteps・ungroupSteps・addFrame・setFrameRect・renameFrame・deleteFrames。段階 D・q159）', async (t) => {
  const { api, sys, step } = await boot(t);
  const y = () => api.store.state.systems.find((x) => x.id === 'y-trip');
  assert.equal(api.actions.groupSteps('y-trip', ['w-1']), null, '2 つ以上が要る');
  const g1 = api.actions.groupSteps('y-trip', ['w-1', 'w-2']);
  assert.ok(g1);
  assert.deepEqual(plain(api.swimWithGroup(y(), ['w-2'])), ['w-2', 'w-1'], '1 つで同じグループの全部');
  const g2 = api.actions.groupSteps('y-trip', ['w-2', 'w-3']);
  assert.deepEqual([step('w-1').groupId, step('w-2').groupId, step('w-3').groupId], [g2, g2, g2], '入っていたグループの工程もまとめる');
  assert.equal(api.actions.ungroupSteps('y-trip', ['w-5']), 0);
  assert.equal(api.actions.ungroupSteps('y-trip', ['w-3']), 3);
  assert.ok(['w-1', 'w-2', 'w-3'].every((id) => !('groupId' in step(id))));
  // 枠
  const n0 = api.store.undoStack.length;
  const fid = api.actions.addFrame('y-trip', { x: 100, y: 10, w: 20, h: 300 });
  assert.ok(fid);
  assert.deepEqual(sys().swimlane.frames, [{ id: fid, text: 'グループ', rect: { horizontal: { x: 100, y: 10, w: 80, h: 300 } } }]);
  assert.equal(api.actions.setFrameRect('y-trip', fid, { x: 100, y: 10, w: 80, h: 300 }), false, '変わらないときは積まない');
  assert.equal(api.actions.setFrameRect('y-trip', fid, { x: 120, y: 10, w: 200, h: 300 }), true);
  api.actions.setSwimOrient('y-trip', 'vertical');
  assert.equal(api.swimFramesOf(y(), 'vertical').length, 0, 'ほかの向きでは描かない');
  assert.equal(api.actions.setFrameRect('y-trip', fid, { x: 5, y: 60, w: 300, h: 200 }), true);
  assert.deepEqual(plain(sys().swimlane.frames[0].rect), { horizontal: { x: 120, y: 10, w: 200, h: 300 }, vertical: { x: 5, y: 60, w: 300, h: 200 } });
  assert.equal(api.actions.renameFrame('y-trip', fid, '  '), false);
  assert.equal(api.actions.renameFrame('y-trip', fid, '申請と承認'), true);
  assert.equal(sys().swimlane.frames[0].text, '申請と承認');
  assert.equal(api.actions.deleteFrames('y-trip', ['f-x']), false);
  assert.equal(api.actions.deleteFrames('y-trip', [fid]), true);
  assert.ok(!('frames' in sys().swimlane), '最後の枠を消すと欄も消す');
  assert.equal(api.store.undoStack.length, n0 + 6);
});

test('スペース挿入（actions.insertSwimGap。段階 D・q158 案A）: 流れの向きは点線より先の工程・曲がり角・枠を押し出す（またぐ枠は伸ばす）。レーンをまたぐ向きは点線のあるレーンを広げ、そのレーンの中の先の工程だけ押し出す', async (t) => {
  const { api, geom, sys } = await boot(t);
  const L0 = geom();
  const b = (id, L = geom()) => L.pos['w:' + id];
  const at = b('w-5', L0).x; // 出張に行く の左の縁
  api.actions.setEdgeShape('y-trip', 'e-6', { orthoWps: [{ x: at + 200, y: 65 }, { x: at + 200, y: 325 }] });
  const fid = api.actions.addFrame('y-trip', { x: at - 100, y: 10, w: 300, h: 100 }); // 点線をまたぐ枠
  const n0 = api.store.undoStack.length;
  assert.deepEqual(plain(api.actions.insertSwimGap('y-trip', { axis: 'flow', at, gap: 80 })), { lane: -1 });
  assert.equal(api.store.undoStack.length, n0 + 1, '元に戻すの 1 回分');
  const L1 = geom();
  ['w-1', 'w-2', 'w-3', 'w-4'].forEach((id) => assert.equal(b(id, L1).x, b(id, L0).x, id + ' は動かない'));
  ['w-5', 'w-6', 'w-7', 'w-8'].forEach((id) => assert.equal(b(id, L1).x, b(id, L0).x + 80, id + ' は 80 先へ'));
  assert.equal(sys().swimlane.edges.find((e) => e.id === 'e-6').shape.horizontal.orthoWps[0].x, at + 280, '曲がり角も動く');
  assert.deepEqual(plain(sys().swimlane.frames.find((f) => f.id === fid).rect.horizontal), { x: at - 100, y: 10, w: 380, h: 100 }, 'またぐ枠は伸ばす');
  assert.equal(api.actions.insertSwimGap('y-trip', { axis: 'flow', at: 1e6, gap: 80 }), null, '動くものがなければ直さない');
  // レーンをまたぐ向き（横向きは y）。申請者のレーン（0〜130）の 40 の所（工程の上の縁 49.5 より手前）
  const c0 = geom();
  assert.deepEqual(plain(api.actions.insertSwimGap('y-trip', { axis: 'cross', at: 40, gap: 80 })), { lane: 0 });
  const c1 = geom();
  assert.equal(c1.lanes[0].h, c0.lanes[0].h + 80, '申請者のレーンを 80 広げる');
  assert.equal(sys().roles[0].laneW.horizontal, c0.lanes[0].h + 80);
  assert.equal(b('w-1', c1).y, b('w-1', c0).y + 80, '申請者のレーンの中の、点線より先の工程を押し出す');
  assert.equal(b('w-3', c1).y, b('w-3', c0).y + 80, '後ろのレーンの工程は、レーンがずれて動く');
  api.store.undo();
  assert.equal(geom().lanes[0].h, c0.lanes[0].h, '元に戻す');
  assert.equal(api.actions.insertSwimGap('y-trip', { axis: 'x', at: 1, gap: 80 }), null);
  assert.equal(api.actions.insertSwimGap('y-trip', { axis: 'flow', at: 1, gap: 0 }), null);
});

test('スペース調整（actions.adjustSwimGap・swimGapAdjustOf。段階 D・q158 案A）: 点線の両側でいちばん近い工程の外枠の間を既定の間（横向きの流れの向き 40）にそろえる。詰める・広げる。両側に工程がなければ直さない', async (t) => {
  const { api, geom } = await boot(t);
  const y = () => api.store.state.systems.find((x) => x.id === 'y-trip');
  const b = (id) => geom().pos['w:' + id];
  assert.equal(api.swimGapEdge(geom(), 'flow'), 40);
  assert.equal(api.swimGapEdge(geom(), 'cross'), 43);
  const mid = (b('w-1').x + b('w-1').w + b('w-2').x) / 2;
  const r = plain(api.swimGapAdjustOf(y(), 'flow', mid));
  assert.deepEqual([r.A.id, r.B.id, r.gap], ['w-1', 'w-2', 40]);
  const gap0 = b('w-2').x - (b('w-1').x + b('w-1').w);
  assert.equal(r.delta, Math.round(gap0 - 40));
  const x6 = b('w-6').x;
  const n0 = api.store.undoStack.length;
  assert.equal(api.actions.adjustSwimGap('y-trip', { axis: 'flow', at: mid }).changed, true);
  assert.equal(api.store.undoStack.length, n0 + 1);
  assert.ok(Math.abs(b('w-2').x - (b('w-1').x + b('w-1').w) - 40) <= 0.5, '外枠の間が 40');
  assert.ok(Math.abs(b('w-6').x - (x6 - r.delta)) <= 0.5, '先の工程も同じだけ動く');
  assert.equal(api.actions.adjustSwimGap('y-trip', { axis: 'flow', at: mid }).changed, false, 'もうそろっている');
  // 広げる: 間を詰めてからそろえる
  api.actions.insertSwimGap('y-trip', { axis: 'flow', at: b('w-2').x, gap: 1 }); // 41
  const w2 = b('w-2').x;
  const r2 = api.actions.adjustSwimGap('y-trip', { axis: 'flow', at: mid });
  assert.equal(r2.delta, 1);
  assert.equal(b('w-2').x, w2 - 1);
  assert.equal(api.actions.adjustSwimGap('y-trip', { axis: 'flow', at: -10 }).changed, false, '手前に工程がない');
});
