'use strict';
// 第 9 段階の前半（T6a）: システムの画面（画像 q62 の案A・q64 の案A・q65・q66）のテスト。いちばん上の帯・メニューバー・左の入口と画面設計のカード・
// 真ん中の概要・役割・スイムレーン図（見るだけ）・履歴・右の欄の案内・編集の画面との行き来（「← システムへ」）・AI が直したときの帯・命令とキー。
// スイムレーン図の上の操作（足す・つなぐ・ドラッグ）と右の欄の作業の設定は T6b（test/swimlane-ui.test.js）。画面設計とシステムの名前は架空の業務（出張申請・経費精算・社員マスタなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const mouse = (el, type, init = {}) => el.dispatchEvent(new (el.ownerDocument || el).defaultView.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
function setValue(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
function key(app, target, init) {
  target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
// その日のその時刻（日本の時刻で見えるように、テストを動かす PC の時刻で作る）
const at = (h, m) => new Date(2026, 9, 15, h, m).toISOString();

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name, updatedAt, extra = {}) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-' + id, '一覧')], mapPos: {}, processPos: {}, flowPos: {}, ...extra,
});
const system = (id, name, designIds, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds, roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
const step = (id, roleId, col, kind, text, ref = {}) => ({ id, roleId, col, kind, text, memo: '', ref: { designId: null, screenId: null, stateId: null, ...ref }, src: null });
const edge = (id, from, to, label = '') => ({ id, from, to, label });
const ROLES = [{ id: 'l-a', name: '申請者', memo: '' }, { id: 'l-b', name: '上長', memo: '' }, { id: 'l-c', name: '経理', memo: '' }];
// 出張申請の流れ（作業 8 つ・矢印 8 本。申請者 3・上長 2・経理 3。経理の作業につながる矢印は 3 本）
const STEPS = [
  step('w-1', 'l-a', 0, 'start', '出張が決まる'), step('w-2', 'l-a', 1, 'input', '出張申請を入力する', { designId: 'd-trip', screenId: 's-d-trip' }),
  step('w-3', 'l-b', 2, 'decision', '申請を確かめる'), step('w-4', 'l-b', 3, 'input', '承認する'), step('w-5', 'l-a', 4, 'task', '出張に行く'),
  step('w-6', 'l-c', 5, 'task', '旅費を精算する'), step('w-7', 'l-c', 6, 'doc', '精算書を出す'), step('w-8', 'l-c', 7, 'end', '終わり'),
];
const EDGES = [
  edge('e-1', 'w-1', 'w-2'), edge('e-2', 'w-2', 'w-3'), edge('e-3', 'w-3', 'w-4', '承認'), edge('e-4', 'w-3', 'w-2', '差し戻し'),
  edge('e-5', 'w-4', 'w-5'), edge('e-6', 'w-5', 'w-6'), edge('e-7', 'w-6', 'w-7'), edge('e-8', 'w-7', 'w-8'),
];
// 履歴の行（古い順）。13:05 の「戻す前の状態」（今と同じ中身）と、14:32 の「Claude Code が直す前の状態」（役割 2・作業 5・矢印 4。
// 画面設計の並びに、もうない画面設計 d-lost がある）
const REVISIONS = [
  { id: 'r-back', kind: 'restore', date: at(13, 5), note: '「Claude Code が直す前の状態（2026-10-15）」に戻す前の状態',
    snapshot: { name: '出張申請システム', description: '', roles: ROLES, swimlane: { steps: STEPS, edges: EDGES }, designIds: ['d-trip', 'd-emp'] } },
  { id: 'r-ai', kind: 'ai', date: at(14, 32), note: 'Claude Code が直す前の状態', aiSession: 'old',
    snapshot: { name: '出張申請システム', description: '前の説明', roles: ROLES.slice(0, 2), swimlane: { steps: STEPS.slice(0, 5), edges: EDGES.slice(0, 5).filter((e) => e.id !== 'e-4') },
      designIds: ['d-trip', 'd-emp', 'd-lost'] } },
];
// 見本の並び（ROLES など）を書き換えないように、毎回写して返す
function sampleState() {
  return plain({
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d-trip', '出張申請', '2026-10-05T00:00:00.000Z'),
      design('d-emp', '社員マスタ', '2026-10-04T00:00:00.000Z'),
      design('d-exp', '経費精算', '2026-10-03T00:00:00.000Z'),
      design('d-cli', '取引先マスタ', '2026-10-06T00:00:00.000Z'),
      design('d-gone', '古い申請', OLD, { trashedAt: '2026-10-07T00:00:00.000Z' }),
    ],
    systems: [
      system('y-trip', '出張申請システム', ['d-trip', 'd-gone', 'd-emp'], {
        description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム',
        roles: ROLES, swimlane: { steps: STEPS, edges: EDGES }, revisions: REVISIONS,
      }),
      system('y-exp', '経費精算システム', ['d-exp', 'd-emp']),
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
  return {
    app, api, $, $$, S,
    sys: (id = 'y-trip') => plain(S().systems.find((y) => y.id === id) || null),
    // 左の入口 [名前, 小さな字, 押しているか]
    entries: () => $$('#sys-list .db-entry').map((b) => [b.querySelector('b').textContent, b.querySelector('small').textContent, b.classList.contains('active')]),
    entry: (panel) => $(`#sys-list .db-entry[data-panel="${panel}"]`),
    cards: () => $$('#sys-list .sys-dcard').map((c) => c.querySelector('b').textContent),
    toast: () => $('#toast').textContent,
    dialogButtons: () => $$('.modal-actions button').filter((b) => !b.hidden).map((b) => b.textContent),
    call: async (tool, args = {}) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' })),
  };
}

// ── 配置（q62 の案A）──
test('配置: いちばん上の帯（システムの名前と小さく「（システム）」）・メニューバー（一覧へ・元に戻す・やり直す・選択・接続・削除・拡大・縮小・全体を表示）・左の入口 5 つ（資料の窓口がないとき）・右の欄。最初はスイムレーン図', async (t) => {
  const { $, $$, api, entries } = await boot(t);
  assert.equal($('.brandbar .brand').textContent, 'モックイメージメーカー');
  assert.equal($('#sys-title').textContent, '出張申請システム（システム）');
  assert.equal($('#sys-title small').textContent, '（システム）');
  // メニューバーは編集の画面と同じ見た目（組と、組の名前）
  assert.deepEqual($$('#toolbar .glabel').map((e) => e.textContent), ['ファイル', '履歴', '編集', '表示']);
  assert.match($('#toolbar [data-action="home"]').textContent, /一覧へ/);
  assert.equal($('#toolbar [data-action="home"]').title, 'システムと画面設計の一覧へ戻ります');
  assert.deepEqual($$('#toolbar .tbtn').map((b) => b.textContent), ['↶ 元に戻す', '↷ やり直す', '＋ 拡大', '－ 縮小', '⊡ 全体を表示', '100%']);
  assert.equal($('#toolbar [data-action="undo"]').disabled, true);
  assert.equal($('#toolbar [data-action="redo"]').disabled, true);
  // 左の入口（数）。履歴は「AI が直す前の状態」の行の数
  assert.deepEqual(entries(), [['概要', '名前と説明', false], ['役割', '3 つ', false], ['スイムレーン図', '作業 8 つ', true], ['設計ノート', 'まだ始めていません', false], ['履歴', 'AI が直す前の状態 1', false]]);
  assert.equal(api.ui.sysPanel, 'swimlane');
  assert.equal($('#sys-list').classList.contains('screen-list'), true, '左の欄は編集の画面と同じ幅（192）');
  assert.ok($('#sys-side-panel.side-panel'), '右の欄は編集の画面と同じ幅');
  assert.ok($('#ai-bands'));
});

test('左の入口の小さな字: 役割・作業・履歴の行がないとき', async (t) => {
  const { api, entries } = await boot(t, sampleState(), 'y-exp');
  assert.deepEqual(entries(), [['概要', '名前と説明', false], ['役割', 'まだありません', false], ['スイムレーン図', '作業なし', true], ['設計ノート', 'まだ始めていません', false], ['履歴', 'まだありません', false]]);
  // 戻す前の状態の行だけがあるとき
  api.actions.addRole('y-exp', '申請者');
  api.store.state.systems[1].revisions.push({ id: 'r-x', kind: 'restore', date: OLD, note: '', snapshot: null });
  api.renderSystem();
  assert.deepEqual(entries()[4], ['履歴', '戻す前の状態 1', false]);
});

test('入口を押すと真ん中を切り替える。最後に開いた入口は、同じアプリの間はシステムごとに覚える（保存データには入れない）', async (t) => {
  const { app, api, $, entry, entries, S } = await boot(t);
  click(entry('roles'));
  assert.equal(api.ui.sysPanel, 'roles');
  assert.deepEqual(entries().map((e) => e[2]), [false, true, false, false, false]);
  assert.match($('#sys-view h3').textContent, /^役割（出張申請システム）$/);
  click(entry('overview'));
  assert.match($('#sys-view h3').textContent, /^概要（出張申請システム）$/);
  click(entry('history'));
  assert.match($('#sys-view h3').textContent, /^履歴（出張申請システム）$/);
  click(entry('swimlane'));
  assert.match($('#sys-view h3').textContent, /^スイムレーン図（出張申請システム）$/);
  click(entry('roles'));
  // ほかのシステムは、最初はスイムレーン図
  api.openSystem('y-exp');
  assert.equal(api.ui.sysPanel, 'swimlane');
  click(entry('history'));
  api.goHome();
  api.openSystem('y-trip');
  assert.equal(api.ui.sysPanel, 'roles', '出張申請システムは役割のまま');
  api.openSystem('y-exp');
  assert.equal(api.ui.sysPanel, 'history');
  assert.equal(JSON.stringify(S()).includes('sysPanel'), false);
  void app;
});

test('右の欄: 入口ごとの案内の文', async (t) => {
  const { $, entry } = await boot(t);
  assert.match($('#sys-side').textContent, /作業の箱か矢印を押すと、ここで直せます。/);
  click(entry('roles'));
  assert.match($('#sys-side').textContent, /役割を直すと、スイムレーン図の帯がすぐ変わります。/);
  click(entry('history'));
  assert.match($('#sys-side').textContent, /「この状態に戻す…」を押すと、今の中身を「戻す前の状態」として残してから、その行の中身に置き換えます。/);
  click(entry('overview'));
  assert.ok($('#sys-side .hint').textContent.length > 0);
});

// ── 左の画面設計のカード ──
test('画面設計のカード: 小見出し「画面設計 2 つ」・designIds の順（ごみ箱の画面設計は出さない）・縮小画像と名前・共通の画面設計は緑の枠と札。いちばん下に「＋ 画面設計を入れる ▾」', async (t) => {
  const { $, $$, cards } = await boot(t);
  assert.equal($('#sys-list .sys-dhead').textContent, '画面設計 2 つ');
  assert.deepEqual(cards(), ['出張申請', '社員マスタ']);
  const [trip, emp] = $$('#sys-list .sys-dcard');
  assert.ok(trip.querySelector('.thumb'));
  assert.equal(trip.classList.contains('shared'), false);
  assert.ok(emp.classList.contains('shared'));
  assert.equal(emp.querySelector('.share-tag').textContent, '2 つのシステムで使っている');
  assert.equal(emp.querySelector('.share-tag').title, '出張申請システム・経費精算システムで使っています');
  assert.equal(trip.querySelector('.share-tag'), null);
  assert.equal($('#sys-list .sys-add').textContent, '＋ 画面設計を入れる ▾');
});

test('カードを押すと、その画面設計の編集の画面を開く。メニューバーの「← システムへ」（命令 backToSystem）でシステムの画面へ戻る。最初の画面から開いたときは今までどおり', async (t) => {
  const { app, api, $, $$, entry } = await boot(t);
  click(entry('roles'));
  click($$('#sys-list .sys-dcard')[1]);
  assert.deepEqual([api.ui.view, api.ui.designId], ['editor', 'd-emp']);
  const back = $('#tb-home');
  assert.equal(back.dataset.action, 'back-system');
  assert.equal(back.textContent, '←システムへ');
  assert.equal(back.title, '出張申請システムの画面へ戻ります');
  click(back);
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-trip', 'roles'], '開いていた入口のまま');
  // 命令 backToSystem
  click($$('#sys-list .sys-dcard')[0]);
  api.runCommand('backToSystem');
  assert.deepEqual([api.ui.view, api.ui.systemId], ['system', 'y-trip']);
  // 編集の画面から、ほかの画面設計を開いても、戻る先はシステムのまま
  click($$('#sys-list .sys-dcard')[0]);
  api.openDesign('d-cli');
  assert.equal($('#tb-home').textContent, '←システムへ');
  click($('#tb-home'));
  assert.equal(api.ui.view, 'system');
  // 最初の画面から開いたとき
  api.goHome();
  api.openDesign('d-emp');
  assert.equal($('#tb-home').dataset.action, 'home');
  assert.equal($('#tb-home').textContent, '←一覧へ');
  assert.equal($('#tb-home').title, '画面設計の一覧へ戻ります');
  api.runCommand('backToSystem');
  assert.equal(api.ui.view, 'home', '戻るシステムがなければ最初の画面へ');
  assert.equal(app.window.document.querySelector('#sys-view'), null);
});

test('アプリのメニューの「一覧へ戻る」（命令 goHome）は、システムの画面から開いた画面設計でも、いつも最初の画面へ行く', async (t) => {
  const { api, $, $$ } = await boot(t);
  click($$('#sys-list .sys-dcard')[0]);
  assert.equal(api.ui.view, 'editor');
  api.runCommand('goHome');
  assert.deepEqual([api.ui.view, api.ui.systemId], ['home', null]);
  assert.ok($('.home-head'));
});

test('「← システムへ」: 戻る先のシステムがごみ箱に入った・消えたときは、最初の画面へ戻る', async (t) => {
  const { api, $, $$ } = await boot(t);
  click($$('#sys-list .sys-dcard')[0]);
  api.actions.trashSystem('y-trip');
  assert.match($('#tb-home').textContent, /一覧へ/);
  assert.equal($('#tb-home').dataset.action, 'home');
  api.runCommand('backToSystem');
  assert.equal(api.ui.view, 'home');
  api.actions.restoreSystem('y-trip');
  api.openSystem('y-trip');
  click($$('#sys-list .sys-dcard')[0]);
  api.actions.deleteSystemForever('y-trip');
  click($('#tb-home'));
  assert.equal(api.ui.view, 'home');
});

test('カードの「…」: 開く・上へ動かす・下へ動かす・このシステムから外す（端では上へ・下へを押せない）。Esc で閉じる', async (t) => {
  const { app, api, $, $$, sys, cards, toast } = await boot(t);
  const more = (i) => $$('#sys-list .sl-more')[i];
  click(more(0));
  assert.equal(api.ui.sysDesignMenu, 'd-trip');
  const items = () => $$('#sys-menu-root [role="menuitem"]');
  assert.deepEqual(items().map((b) => b.textContent), ['開く', '上へ動かす', '下へ動かす', 'このシステムから外す']);
  assert.deepEqual(items().map((b) => b.disabled), [false, true, false, false]);
  assert.equal(more(0).getAttribute('aria-expanded'), 'true');
  click(items()[2]);
  assert.deepEqual(cards(), ['社員マスタ', '出張申請']);
  assert.deepEqual(sys().designIds, ['d-emp', 'd-gone', 'd-trip'], 'ごみ箱の画面設計は同じ場所に残す');
  assert.equal(api.ui.sysDesignMenu, null);
  click(more(1));
  assert.deepEqual(items().map((b) => b.disabled), [false, false, true, false]);
  click(items()[1]);
  assert.deepEqual(cards(), ['出張申請', '社員マスタ']);
  // Esc で閉じる（「…」にフォーカスを戻す）
  click(more(0));
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.sysDesignMenu, null);
  assert.equal($('#sys-menu-root').innerHTML, '');
  assert.equal(app.document.activeElement, more(0));
  // ほかの所を押すと閉じる
  click(more(0));
  click($('#sys-view'));
  assert.equal(api.ui.sysDesignMenu, null);
  // このシステムから外す（画面設計は残る）。元に戻すで戻る
  click(more(1));
  click(items()[3]);
  assert.deepEqual(cards(), ['出張申請']);
  assert.equal(toast(), '「社員マスタ」を出張申請システムから外しました。画面設計は残っています。');
  assert.ok(api.store.state.designs.some((d) => d.id === 'd-emp'));
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual(cards(), ['出張申請', '社員マスタ']);
  // 開く
  click(more(1));
  click(items()[0]);
  assert.deepEqual([api.ui.view, api.ui.designId], ['editor', 'd-emp']);
});

test('カードのドラッグで並べ替える（放したカードの上半分なら前、下半分なら後ろ。「＋ 画面設計を入れる」の上ならいちばん下）。少し動かすまでは並べ替えない', async (t) => {
  const { app, api, $, $$, cards } = await boot(t);
  api.actions.addDesignToSystem('y-trip', 'd-cli');
  assert.deepEqual(cards(), ['出張申請', '社員マスタ', '取引先マスタ']);
  const card = (i) => $$('#sys-list .sys-dcard')[i];
  const wrap = (i) => $$('#sys-list .sys-dwrap')[i];
  // 取引先マスタを、出張申請の上半分へ（jsdom では位置が 0 なので、clientY が 0 より上なら上半分）
  mouse(card(2), 'mousedown', { clientX: 50, clientY: 300 });
  mouse(wrap(0).querySelector('.sys-dcard'), 'mousemove', { clientX: 50, clientY: -10 });
  assert.ok(wrap(0).classList.contains('drop-before'));
  assert.ok(app.document.body.classList.contains('screen-sorting'));
  mouse(app.document, 'mouseup', { clientX: 50, clientY: -10 });
  assert.deepEqual(cards(), ['取引先マスタ', '出張申請', '社員マスタ']);
  assert.equal(app.document.body.classList.contains('screen-sorting'), false);
  // 押した直後の click では開かない
  click(card(0));
  assert.equal(api.ui.view, 'system');
  // いちばん下へ（「＋ 画面設計を入れる」の上で放す）
  await new Promise((r) => setTimeout(r, 450));
  mouse(card(0), 'mousedown', { clientX: 50, clientY: 0 });
  mouse($('#sys-list .sys-add'), 'mousemove', { clientX: 50, clientY: 400 });
  mouse(app.document, 'mouseup', {});
  assert.deepEqual(cards(), ['出張申請', '社員マスタ', '取引先マスタ']);
  // 少しだけ動かして放したときは並べ替えない
  mouse(card(0), 'mousedown', { clientX: 50, clientY: 0 });
  mouse(wrap(2).querySelector('.sys-dcard'), 'mousemove', { clientX: 51, clientY: 1 });
  mouse(app.document, 'mouseup', {});
  assert.deepEqual(cards(), ['出張申請', '社員マスタ', '取引先マスタ']);
  api.store.undo();
  assert.deepEqual(cards(), ['取引先マスタ', '出張申請', '社員マスタ'], '並べ替えは元に戻すの 1 回分');
});

test('「＋ 画面設計を入れる ▾」: 最初の画面と同じ 3 つのメニュー。入れたら左のカードを描き直す', async (t) => {
  const { app, api, $, $$, cards } = await boot(t);
  click($('#sys-list .sys-add'));
  assert.equal(api.ui.sysMenu, 'add:y-trip');
  assert.deepEqual($$('#sys-menu-root [role="menuitem"] b').map((b) => b.textContent), ['新しい画面設計を作る', '今ある画面設計を入れる', '今ある画面設計を複製して入れる']);
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.sysMenu, null);
  assert.equal(app.document.activeElement, $('#sys-list .sys-add'));
  click($('#sys-list .sys-add'));
  click($('#sys-menu-root [data-action="sys-add-same"]'));
  await waitFor(() => $('.modal'));
  click([...app.document.querySelectorAll('.pick-card')].find((b) => b.textContent.includes('取引先マスタ')));
  click($('[data-dlg="ok"]'));
  await waitFor(() => cards().length === 3, { label: '入れた' });
  assert.deepEqual(cards(), ['出張申請', '社員マスタ', '取引先マスタ']);
  assert.equal(api.ui.view, 'system');
  // 新しい画面設計を作ると、その編集の画面を開き、戻る先はこのシステム
  click($('#sys-list .sys-add'));
  click($('#sys-menu-root [data-action="sys-add-new"]'));
  await waitFor(() => $('.modal [name=name]'));
  assert.equal($('.modal [name=system]').value, 'y-trip');
  setValue($('.modal [name=name]'), '旅費の精算', 'input');
  click($('[data-dlg="ok"]'));
  await waitFor(() => api.ui.view === 'editor', { label: '編集の画面' });
  assert.equal($('#tb-home').textContent, '←システムへ');
});

// ── 概要 ──
test('概要: 名前（1 行）と説明（複数行）の欄。直すと updateSystem。名前を空にすると元に戻してお知らせ。下に数の要約', async (t) => {
  const { app, api, $, entry, sys, toast } = await boot(t);
  click(entry('overview'));
  const name = $('#sys-view [data-sy="name"]');
  const desc = $('#sys-view textarea[data-sy="desc"]');
  assert.equal(name.value, '出張申請システム');
  assert.equal(desc.value, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  assert.equal($('#sys-view .sys-sum').textContent, '画面設計 2 つ・役割 3 つ・作業 8 つ・矢印 8 本');
  name.focus();
  setValue(name, '出張と精算のシステム');
  assert.equal(sys().name, '出張と精算のシステム');
  assert.equal($('#sys-title').textContent, '出張と精算のシステム（システム）');
  assert.equal($('#sys-view h3').textContent, '概要（出張と精算のシステム）');
  assert.equal(app.document.activeElement, name, '打っている欄は作り直さない');
  setValue(name, '  ');
  assert.equal(name.value, '出張と精算のシステム');
  assert.equal(toast(), '名前を空にはできません。');
  setValue(desc, '出張の申請から精算まで');
  assert.equal(sys().description, '出張の申請から精算まで');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().description, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  assert.equal($('#sys-view textarea[data-sy="desc"]').value, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
});

test('概要: 打ちかけの文字は、命令・窓を離れるとき・AI が書く前に保存する。名前を空にして打ち直している途中は、描き直されても戻さない', async (t) => {
  const { app, api, $, entry, sys, call } = await boot(t);
  click(entry('overview'));
  const desc = $('#sys-view [data-sy="desc"]');
  desc.focus();
  desc.value = '人が打ちかけた説明';
  app.window.dispatchEvent(new app.window.Event('blur'));
  assert.equal(sys().description, '人が打ちかけた説明');
  // AI が書く前に、人の 1 回の変更として確定する
  const d2 = $('#sys-view [data-sy="desc"]');
  d2.focus();
  d2.value = 'もう一度打ちかけた説明';
  const r = await call('update_system', { system: 'y-trip', ops: [{ op: 'add', name: '総務' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(sys().description, 'もう一度打ちかけた説明');
  assert.equal(api.ui.sysPanel, 'overview', '開いている入口は変えない');
  assert.equal(app.document.activeElement.dataset.sy, 'desc', '打っていた欄にフォーカスを戻す');
  // 名前を空にして打ち直している途中
  const name = $('#sys-view [data-sy="name"]');
  name.focus();
  name.value = '';
  app.window.dispatchEvent(new app.window.Event('blur'));
  assert.equal(name.value, '');
  assert.equal(sys().name, '出張申請システム');
  const r2 = await call('update_system', { system: 'y-trip', ops: [{ op: 'add', name: '部長' }] });
  assert.equal(r2.ok, true, JSON.stringify(r2.error));
  assert.equal($('#sys-view [data-sy="name"]').value, '', 'AI が書いて描き直しても、空のまま');
  assert.equal(sys().name, '出張申請システム');
  // 一覧へ戻る前にも保存する
  const n2 = $('#sys-view [data-sy="name"]');
  n2.focus();
  n2.value = '出張申請システム２';
  api.runCommand('goHome');
  assert.equal(sys().name, '出張申請システム２');
});

// ── 役割（q64 の案A）──
test('役割: 番号・名前・メモ（薄い字）・作業の数・↑↓✕。足す（空いている番号の「役割 N」）・名前を直す・同じ名前と空の名前は断る・メモ・並べ替え', async (t) => {
  const { app, api, $, $$, entry, sys, toast } = await boot(t);
  click(entry('roles'));
  const rows = () => $$('#sys-view .sys-role');
  assert.deepEqual(rows().map((r) => [r.querySelector('.no').textContent, r.querySelector('[data-sy="role-name"]').value, r.querySelector('.cnt').textContent]),
    [['1', '申請者', '作業 3 つ'], ['2', '上長', '作業 2 つ'], ['3', '経理', '作業 3 つ']]);
  assert.equal(rows()[0].querySelector('[data-sy="role-memo"]').placeholder, 'この役割の人・部署など');
  const btn = (i, a) => rows()[i].querySelector(`[data-action="${a}"]`);
  assert.equal(btn(0, 'sys-role-up').disabled, true);
  assert.equal(btn(2, 'sys-role-down').disabled, true);
  assert.equal(btn(1, 'sys-role-up').disabled, false);
  // 足す
  click($('#sys-view [data-action="sys-role-add"]'));
  assert.deepEqual(sys().roles.map((r) => r.name), ['申請者', '上長', '経理', '役割 1']);
  assert.equal(app.document.activeElement, rows()[3].querySelector('[data-sy="role-name"]'), '足した役割の名前を打てるように');
  assert.equal(rows()[3].querySelector('.cnt').textContent, '作業なし');
  click($('#sys-view [data-action="sys-role-add"]'));
  assert.deepEqual(sys().roles.map((r) => r.name).slice(3), ['役割 1', '役割 2']);
  // 名前を直す
  setValue(rows()[3].querySelector('[data-sy="role-name"]'), '総務');
  assert.equal(sys().roles[3].name, '総務');
  click($('#sys-view [data-action="sys-role-add"]'));
  assert.equal(sys().roles[5].name, '役割 1', '空いた番号を使う');
  // 同じ名前・空の名前は断る
  setValue(rows()[4].querySelector('[data-sy="role-name"]'), '上長');
  assert.equal(rows()[4].querySelector('[data-sy="role-name"]').value, '役割 2');
  assert.equal(toast(), '「上長」という役割がもうあります。');
  setValue(rows()[4].querySelector('[data-sy="role-name"]'), ' ');
  assert.equal(rows()[4].querySelector('[data-sy="role-name"]').value, '役割 2');
  assert.equal(toast(), '役割の名前を空にはできません。');
  // メモ
  setValue(rows()[1].querySelector('[data-sy="role-memo"]'), '申請者の課の課長');
  assert.equal(sys().roles[1].memo, '申請者の課の課長');
  // 並べ替え
  click(btn(1, 'sys-role-up'));
  assert.deepEqual(sys().roles.map((r) => r.name).slice(0, 3), ['上長', '申請者', '経理']);
  click(btn(0, 'sys-role-down'));
  assert.deepEqual(sys().roles.map((r) => r.name).slice(0, 3), ['申請者', '上長', '経理']);
  assert.deepEqual(rows().map((r) => r.querySelector('.no').textContent), ['1', '2', '3', '4', '5', '6']);
  // 作業の箱のない役割は、確かめずに消す
  click(btn(5, 'sys-role-del'));
  assert.equal($('.modal'), null);
  assert.equal(sys().roles.length, 5);
  assert.equal(api.ui.sysPanel, 'roles');
});

test('役割: 作業の箱のある役割の ✕ は確かめの窓（一緒に消える作業の箱と矢印の数。「消す」〔赤・左〕「キャンセル」〔右・最初のフォーカス〕）。消した後は元に戻すで戻る', async (t) => {
  const { app, $, $$, entry, sys } = await boot(t);
  click(entry('roles'));
  const del = (i) => $$('#sys-view .sys-role')[i].querySelector('[data-action="sys-role-del"]');
  click(del(2));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '役割「経理」を消しますか？');
  assert.match($('.modal-body').textContent, /役割「経理」の帯に入っている作業の箱 3 つと、その箱につながる矢印 3 本も一緒に消えます。/);
  assert.match($('.modal-body').textContent, /消した後でも、元に戻す（Ctrl\+Z）で戻せます。/);
  assert.deepEqual($$('.modal-actions button').map((b) => b.textContent), ['消す', 'キャンセル']);
  assert.ok($('[data-dlg="ok"]').classList.contains('danger'));
  assert.equal(app.document.activeElement, $('[data-dlg="cancel"]'));
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  assert.equal(sys().roles.length, 3);
  click(del(2));
  await waitFor(() => $('.modal'));
  click($('[data-dlg="ok"]'));
  await waitFor(() => sys().roles.length === 2, { label: '消した' });
  assert.equal(sys().swimlane.steps.length, 5);
  assert.equal(sys().swimlane.edges.length, 5);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().roles.length, 3);
  assert.equal(sys().swimlane.steps.length, 8);
  assert.equal(sys().swimlane.edges.length, 8);
  assert.equal($$('#sys-view .sys-role').length, 3);
});

test('役割: 矢印のない作業の箱だけの役割の確かめの窓は、矢印の数を書かない', async (t) => {
  const st = sampleState();
  st.systems[0].roles.push({ id: 'l-d', name: '総務', memo: '' });
  st.systems[0].swimlane.steps.push(step('w-9', 'l-d', 8, 'task', '仮払いを出す'));
  const { $, $$, entry } = await boot(t, st);
  click(entry('roles'));
  click($$('#sys-view .sys-role')[3].querySelector('[data-action="sys-role-del"]'));
  await waitFor(() => $('.modal'));
  assert.match($('.modal-body').textContent, /役割「総務」の帯に入っている作業の箱 1 つも一緒に消えます。/);
  click($('[data-dlg="cancel"]'));
});

// ── スイムレーン図（見るだけ）──
test('スイムレーン図: 見出し・案内の文・凡例・図（帯 3 本・箱 8 つ）。箱を押すと選んだ印（ui.stepSel）。何もない所・Esc で選ぶのをやめる', async (t) => {
  const { app, api, $, $$ } = await boot(t);
  assert.equal($('#sys-view h3').textContent, 'スイムレーン図（出張申請システム）');
  assert.ok($('#sys-view .map-note'));
  assert.match($('#sys-view .map-head').textContent, /流れ.*戻る流れ/);
  assert.equal($$('#sys-swim .swim-lab').length, 3);
  assert.equal($$('#sys-swim .mnode.sw').length, 8);
  const node = (id) => $(`#sys-swim .mnode[data-node="w:${id}"]`);
  // 押すと選ぶ（ドラッグは始めない）
  mouse(node('w-4'), 'mousedown');
  mouse(app.document, 'mouseup');
  click(node('w-4'));
  assert.equal(api.ui.stepSel, 'w-4');
  assert.ok(node('w-4').classList.contains('sel'));
  assert.equal($('#sys-side [data-sw="text"]').value, '承認する');
  assert.equal(JSON.stringify(api.store.state.systems[0].swimlane), JSON.stringify(sampleState().systems[0].swimlane), '動かさない');
  click($('#sys-swim .swim-inner'));
  assert.equal(api.ui.stepSel, null);
  click(node('w-6'));
  assert.equal(api.ui.stepSel, 'w-6');
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.stepSel, null);
  assert.equal($$('#sys-swim .mnode.sel').length, 0);
});

test('スイムレーン図の拡大縮小（ui.sysZoom）: メニューバーとキー。スイムレーン図を出しているときだけ押せる', async (t) => {
  const { app, api, $, entry } = await boot(t);
  const zoomBtns = () => [...app.document.querySelectorAll('#toolbar [data-action^="zoom-"]')];
  assert.deepEqual(zoomBtns().map((b) => b.disabled), [false, false, false, false]);
  click($('#toolbar [data-action="zoom-out"]'));
  assert.equal(api.ui.sysZoom, 0.9);
  assert.equal($('#toolbar [data-action="zoom-reset"]').textContent, '90%');
  assert.match($('#sys-swim .swim-inner').getAttribute('style'), /transform:scale\(0\.9\)/);
  const z = $('#sys-swim .swim-zoom');
  const w = parseFloat($('#sys-swim .swim-inner').style.width);
  assert.equal(parseFloat(z.style.width), Math.round(w * 0.9), '縮めた大きさの枠で包む（スクロールの範囲）');
  key(app, app.document.body, { key: '-', ctrlKey: true });
  assert.equal(api.ui.sysZoom, 0.8);
  key(app, app.document.body, { key: '0', ctrlKey: true });
  assert.equal(api.ui.sysZoom, 1);
  key(app, app.document.body, { key: '=', ctrlKey: true });
  assert.equal(api.ui.sysZoom, 1.1);
  click(entry('roles'));
  assert.deepEqual(zoomBtns().map((b) => b.disabled), [true, true, true, true]);
  key(app, app.document.body, { key: '-', ctrlKey: true });
  assert.equal(api.ui.sysZoom, 1.1, 'スイムレーン図のほかでは変えない');
  click(entry('swimlane'));
  assert.match($('#sys-swim .swim-inner').getAttribute('style'), /transform:scale\(1\.1\)/, '倍率は覚えている');
});

test('スイムレーン図: 役割がないときは案内の文と「役割を足す」（役割の入口へ移り、「役割 1」を足す）', async (t) => {
  const { app, api, $, sys } = await boot(t, sampleState(), 'y-exp');
  assert.match($('#sys-view').textContent, /まず「役割」で、申請者・上長などの役割を足します。役割ごとに横の帯ができます。/);
  assert.equal($('#sys-swim'), null);
  const add = $('#sys-view [data-action="sys-role-first"]');
  assert.equal(add.textContent, '役割を足す');
  click(add);
  assert.equal(api.ui.sysPanel, 'roles');
  assert.deepEqual(sys('y-exp').roles.map((r) => r.name), ['役割 1']);
  assert.equal(app.document.activeElement.dataset.sy, 'role-name');
});

// ── 履歴（q65）──
test('履歴: 日時・行（AI の行は紫・戻す前の状態は灰色）・そのときの中身・「この状態に戻す…」。新しい行が上', async (t) => {
  const { $, $$, entry } = await boot(t);
  click(entry('history'));
  assert.match($('#sys-view .map-note').textContent, /AI がこのシステム（名前・説明・役割・スイムレーン図・画面設計の並び）を直す前の中身を、自動で残しています（新しい方から 10 行まで）。「この状態に戻す…」で戻したときは、戻す前の中身を「戻す前の状態」の行に残します（これも新しい方から 10 行まで）。中の画面設計の履歴は、それぞれの画面設計の「改訂履歴」にあります。/);
  assert.deepEqual($$('#sys-view thead th').map((e) => e.textContent), ['日時', '行', 'そのときの中身', '']);
  const rows = $$('#sys-view tbody tr').map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(rows, [
    ['2026-10-15 14:32', 'Claude Code が直す前の状態', '役割 2 つ・作業 5 つ・矢印 4 本・画面設計 2 つ', 'この状態に戻す…'],
    ['2026-10-15 13:05', '戻す前の状態', '役割 3 つ・作業 8 つ・矢印 8 本・画面設計 2 つ', 'この状態に戻す…'],
  ]);
  assert.ok($$('#sys-view tbody tr')[0].querySelector('.h-ai'));
  assert.ok($$('#sys-view tbody tr')[1].querySelector('.h-auto'));
});

test('履歴: 行がないときの案内', async (t) => {
  const { $, entry } = await boot(t, sampleState(), 'y-exp');
  click(entry('history'));
  assert.match($('#sys-view').textContent, /まだ履歴はありません。AI がこのシステムを直すと、直す前の中身がここに残ります。/);
  assert.equal($('#sys-view table'), null);
});

test('履歴の「この状態に戻す…」: 確かめの窓（今の中身の数・もうない画面設計の数。「戻す」〔赤・左〕「キャンセル」〔右・最初のフォーカス〕）。戻すと「戻す前の状態」の行が上に足され、Ctrl+Z で戻る', async (t) => {
  const { app, api, $, $$, entry, sys, entries } = await boot(t);
  click(entry('history'));
  click($$('#sys-view [data-action="sys-rev-restore"]')[0]);
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '「2026-10-15 14:32 の Claude Code が直す前の状態」に戻しますか？');
  assert.match($('.modal-body').textContent, /今の中身（役割 3 つ・作業 8 つ・矢印 8 本・画面設計 2 つ）は「戻す前の状態」として履歴に残ります。元に戻す（Ctrl\+Z）でも戻せます。/);
  assert.match($('.modal-body').textContent, /写しにある画面設計のうち 1 つは、もうないので入りません。/);
  assert.deepEqual($$('.modal-actions button').map((b) => b.textContent), ['戻す', 'キャンセル']);
  assert.ok($('[data-dlg="ok"]').classList.contains('danger'));
  assert.equal(app.document.activeElement, $('[data-dlg="cancel"]'));
  click($('[data-dlg="ok"]'));
  await waitFor(() => sys().roles.length === 2, { label: '戻した' });
  assert.equal(sys().description, '前の説明');
  assert.deepEqual(sys().designIds, ['d-trip', 'd-emp']);
  assert.equal(api.ui.sysPanel, 'history');
  const rows = $$('#sys-view tbody tr').map((tr) => tr.children[1].textContent);
  assert.deepEqual(rows, ['戻す前の状態', 'Claude Code が直す前の状態', '戻す前の状態']);
  assert.equal($$('#sys-view tbody tr')[0].children[2].textContent, '役割 3 つ・作業 8 つ・矢印 8 本・画面設計 2 つ');
  assert.deepEqual(entries()[1], ['役割', '2 つ', false]);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().roles.length, 3);
  assert.equal($$('#sys-view tbody tr').length, 2);
  // もうない画面設計がない行では、その文を書かない。キャンセルでは何も変えない
  click($$('#sys-view [data-action="sys-rev-restore"]')[1]);
  await waitFor(() => $('.modal'));
  assert.doesNotMatch($('.modal-body').textContent, /もうないので/);
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  assert.equal($$('#sys-view tbody tr').length, 2);
});

// ── AI が直したとき（q66）──
const roleRows = ($) => $('#sys-view').querySelectorAll('.sys-role').length;
test('AI がこのシステムだけを直したら、紫の帯と「元に戻す（Ctrl+Z）」。左の入口の数と真ん中を描き直し、開いている入口は変えない。帯の「元に戻す」で戻る', async (t) => {
  const { api, $, entry, entries, call, sys } = await boot(t);
  click(entry('roles'));
  const r = await call('update_system', { system: 'y-trip', ops: [{ op: 'add', name: '総務' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match($('#ai-band').textContent, /Claude Code が「出張申請システム」を直しました（変更 1 件）。/);
  assert.ok($('#ai-band [data-action="undo"]'));
  assert.equal(api.ui.sysPanel, 'roles');
  assert.deepEqual(entries()[1], ['役割', '4 つ', true]);
  assert.deepEqual(entries()[4], ['履歴', 'AI が直す前の状態 2', false]);
  assert.equal(roleRows($), 4);
  click($('#ai-band [data-action="undo"]'));
  assert.equal(sys().roles.length, 3);
  assert.equal($('#ai-band'), null);
  assert.equal(roleRows($), 3);
});

test('AI がほかの画面設計・ほかのシステムを直したときの帯と、元に戻すの履歴を消したときのオレンジの帯も、この画面に出る。オレンジの帯の「履歴を開く」でそのシステムの履歴の入口を開く', async (t) => {
  const { api, $, call } = await boot(t);
  const r = await call('update_design', { design: 'd-cli', description: 'AI の説明' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match($('#ai-band').textContent, /Claude Code が「取引先マスタ」を直しました。/);
  assert.ok($('#ai-band [data-action="ai-open-design"]'));
  const v = await call('update_system', { system: 'y-exp', description: 'AI の変更' });
  assert.equal(v.ok, true, JSON.stringify(v.error));
  assert.match($('#ai-band').textContent, /開いている「出張申請システム」は変わっていません。/);
  // 人が直してから、AI がほかのシステムを直す（履歴を消す）→ オレンジの帯
  api.actions.updateSystem('y-trip', { description: '人の変更' });
  const w = await call('update_system', { system: 'y-exp', name: '経費精算システム２' });
  assert.equal(w.ok, true, JSON.stringify(w.error));
  assert.match($('#ai-warn').textContent, /Claude Code が「経費精算システム２」を直したので、元に戻す（Ctrl\+Z）の履歴を消しました。/);
  assert.match($('#ai-warn').textContent, /開いている「出張申請システム」は変わっていません。/);
  click($('#ai-warn [data-action="ai-open-system-history"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-exp', 'history']);
});

test('オレンジの帯の「〇〇の履歴を開く」: 開いているシステムなら、開き直さずに入口を履歴にする', async (t) => {
  const { api, $, entry, call, sys } = await boot(t);
  click(entry('roles'));
  api.actions.updateSystem('y-trip', { description: '人の変更' });
  // AI がこのシステムに画面設計を複製して入れる（画面設計も増えるので、元に戻すの履歴を消す）
  const r = await call('add_to_system', { system: 'y-trip', design: 'd-cli', mode: 'copy' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(sys().designIds.length, 4);
  const btn = $('#ai-warn [data-action="ai-open-system-history"]');
  assert.equal(btn.textContent, '「出張申請システム」の履歴を開く');
  assert.doesNotMatch($('#ai-warn').textContent, /変わっていません/);
  click(btn);
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-trip', 'history']);
  assert.ok($('#ai-warn'), '開き直さないので、帯は残る');
});

// ── 命令とキー ──
test('命令: 編集の画面だけの命令は、この画面で来ても何もしない（落ちない）。Ctrl+Z・Ctrl+Y・アプリのメニューの元に戻す・やり直す', async (t) => {
  const { app, api, sys, $ } = await boot(t);
  for (const cmd of ['addScreen', 'duplicateScreen', 'deleteScreen', 'deletePart', 'selectAll', 'copyPart', 'pastePart', 'openItems', 'openMap', 'openProcess',
    'openFlow', 'addItemMenu', 'deleteItem', 'renumber', 'alignLeft', 'moveLeft', 'modeHand', 'prevScreen', 'addRevision', 'openRevisions', 'exportDialog']) {
    api.runCommand(cmd);
    assert.equal(api.ui.view, 'system', cmd);
  }
  api.actions.updateSystem('y-trip', { description: '1 回目' });
  assert.equal($('#toolbar [data-action="undo"]').disabled, false);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().description, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  assert.equal($('#toolbar [data-action="redo"]').disabled, false);
  key(app, app.document.body, { key: 'y', ctrlKey: true });
  assert.equal(sys().description, '1 回目');
  api.runCommand('undo');
  assert.equal(sys().description, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  click($('#toolbar [data-action="redo"]'));
  assert.equal(sys().description, '1 回目');
  // 入力欄の中の Ctrl+Z は、ブラウザの文字の取り消しに任せる
  click($('#sys-list .db-entry[data-panel="overview"]'));
  key(app, $('#sys-view [data-sy="desc"]'), { key: 'z', ctrlKey: true });
  assert.equal(sys().description, '1 回目');
  // 「← 一覧へ」
  click($('#toolbar [data-action="home"]'));
  assert.equal(api.ui.view, 'home');
});

// ── 見直しで見つけたもの（第 9 段階の T9）──
test('役割の入口の説明: まだない動き（ステータスの操作の「操作する人」と同じ名前を同じ役割として扱う）は書かない', async (t) => {
  const { $, entry } = await boot(t);
  click(entry('roles'));
  assert.equal($('#sys-view .map-note').textContent, '役割は、スイムレーン図の横の帯になります。上から順に帯を並べます。');
});

test('履歴の「この状態に戻す…」: 今と同じ中身の行では、確かめの窓を出さず何もしない（行も更新日時も元に戻すの履歴も変えない）。お知らせで知らせる', async (t) => {
  // 15:00 の「戻す前の状態」は、今と同じ中身（いちばん上の行）
  const st = sampleState();
  const y0 = st.systems[0];
  y0.revisions.push({ id: 'r-same', kind: 'restore', date: at(15, 0), note: '「Claude Code が直す前の状態（2026-10-15）」に戻す前の状態',
    snapshot: plain({ name: y0.name, description: y0.description, roles: y0.roles, swimlane: y0.swimlane, designIds: y0.designIds }) });
  const { app, api, $, $$, entry, sys, toast } = await boot(t, st);
  click(entry('history'));
  const before = sys();
  const undo0 = api.store.undoStack.length;
  click($$('#sys-view [data-action="sys-rev-restore"]')[0]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal($('.modal'), null, '確かめの窓を出さない');
  assert.equal(toast(), '今の中身と同じなので、戻すことはありません。');
  assert.deepEqual(sys(), before);
  assert.equal(api.store.undoStack.length, undo0);
  // actions から呼んでも変えない
  assert.equal(api.actions.restoreSystemRevision('y-trip', 'r-same'), false);
  assert.deepEqual(sys(), before);
  // 違う中身の行は今までどおり
  click($$('#sys-view [data-action="sys-rev-restore"]')[1]);
  await waitFor(() => $('.modal'));
  key(app, $('[data-dlg="cancel"]'), { key: 'Escape' });
  await waitFor(() => !$('.modal'));
});
