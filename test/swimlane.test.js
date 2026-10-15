'use strict';
// 第 9 段階の前半（T3）: スイムレーン図を描く純関数（モデル・並べ方・HTML・AI の図の画像・列を自動で付ける）のテスト。
// スイムレーン図は、役割（申請者・上長など）ごとの横の帯（レーン）に作業の箱を左から列で並べ、矢印でつないだ業務の流れの図。
// 図を画面のどこに出すか・ドラッグ・つなぐ操作は、あとのタスクで作る。
// 画面設計とシステムの名前は架空の業務（出張申請・社員マスタ）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name, extra = {}) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-' + id, '一覧')], mapPos: {}, processPos: {}, flowPos: {}, ...extra,
});
const NO_REF = { designId: null, screenId: null, stateId: null };
const step = (id, roleId, col, kind, text, ref = NO_REF, memo = '') => ({ id, roleId, col, kind, text, memo, ref: { ...NO_REF, ...ref }, src: null });
const edge = (id, from, to, label = '') => ({ id, from, to, label });
const system = (id, name, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: [], roles: [], swimlane: { steps: [], edges: [] }, materials: [], notes: {}, ...extra,
});
// 出張申請システム: 申請者・上長・経理の 3 つの帯。上長の帯の列 2 には作業が 2 つ（縦に積む）。経理の帯には作業がない。
// 役割の見つからない作業（w-6）と、その作業への矢印（e-5）は描かない。e-4 は列 2 → 列 1 の差し戻し（戻る流れ）
function sampleState() {
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d-trip', '出張申請', {
        screens: [screen('s-list', '一覧'), screen('s-form', '申請の入力')],
        items: [{ id: 'i-st', name: 'ステータス', type: 'status', required: false, memo: '', lookup: null, link: null,
          props: { states: [{ id: 't-a', name: '申請' }, { id: 't-b', name: '承認待ち' }, { id: 't-c', name: '完了' }],
            actions: [{ id: 'a-1', name: '', from: 't-a', to: 't-b', role: '', cond: '' }] } }],
      }),
      design('d-emp', '社員マスタ'),
    ],
    systems: [
      system('y-trip', '出張申請システム', {
        designIds: ['d-trip', 'd-emp'],
        roles: [{ id: 'l-app', name: '申請者', memo: '' }, { id: 'l-boss', name: '上長', memo: '課長と部長' }, { id: 'l-acc', name: '経理', memo: '' }],
        swimlane: {
          steps: [
            step('w-1', 'l-app', 0, 'start', '出張が決まる'),
            step('w-2', 'l-app', 1, 'input', '申請を入力する', { designId: 'd-trip', screenId: 's-form', stateId: 't-a' }, '日帰りも出す'),
            step('w-3', 'l-boss', 2, 'decision', '承認する', { designId: 'd-trip', stateId: 't-b' }),
            step('w-4', 'l-boss', 2, 'task', '部長に回す', { designId: 'd-emp' }),
            step('w-5', 'l-app', 3, 'end', '終わり'),
            step('w-6', 'l-none', 1, 'task', '役割のない作業'),
            step('w-7', 'l-app', 4, 'doc', '', { designId: 'd-trip', screenId: 's-gone', stateId: 't-gone' }),
          ],
          edges: [edge('e-1', 'w-1', 'w-2'), edge('e-2', 'w-2', 'w-3'), edge('e-3', 'w-3', 'w-5', '承認'), edge('e-4', 'w-3', 'w-2', '差し戻し'),
            edge('e-5', 'w-2', 'w-6'), edge('e-6', 'w-4', 'w-5')],
        },
      }),
      system('y-empty', '経費精算システム'),
      system('y-lanes', '日報システム', { roles: [{ id: 'l-1', name: '社員', memo: '' }, { id: 'l-2', name: '上長', memo: '' }] }),
    ],
  };
}

async function boot(t, state = sampleState()) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) } });
  t.after(() => app.close());
  const api = await app.api();
  const S = () => api.store.state;
  return { app, api, S, sys: (id) => S().systems.find((y) => y.id === id) };
}
// HTML の文字を、文書の中の要素にして返す
function dom(app, html) {
  const box = app.document.createElement('div');
  box.innerHTML = html;
  return box;
}

test('モデル: 箱は役割のある作業だけ（帯の番号と列）。矢印は両端の箱があるものだけで、列が戻る矢印は back。指す先の名前を引く', async (t) => {
  const { api, S, sys } = await boot(t);
  const m = api.swimlaneModel(S(), sys('y-trip'));
  assert.deepEqual(plain(m.nodes.map((n) => [n.key, n.step.id, n.laneIndex, n.col])), [
    ['w:w-1', 'w-1', 0, 0], ['w:w-2', 'w-2', 0, 1], ['w:w-3', 'w-3', 1, 2], ['w:w-4', 'w-4', 1, 2], ['w:w-5', 'w-5', 0, 3], ['w:w-7', 'w-7', 0, 4],
  ], '役割の見つからない作業 w-6 は外す');
  assert.deepEqual(plain(m.edges.map((e) => [e.from, e.to, e.kind, e.labels, e.edge.id])), [
    ['w:w-1', 'w:w-2', 'next', [], 'e-1'],
    ['w:w-2', 'w:w-3', 'next', [], 'e-2'],
    ['w:w-3', 'w:w-5', 'next', ['承認'], 'e-3'],
    ['w:w-3', 'w:w-2', 'back', ['差し戻し'], 'e-4'],
    ['w:w-4', 'w:w-5', 'next', [], 'e-6'],
  ], '端の箱がない矢印 e-5 は外す');
  // 指す先の名前（画面とステータスは、画面設計と組で引く。見つからないものは「（ない…）」）
  const ref = (id) => plain(m.nodes.find((n) => n.step.id === id).ref);
  assert.deepEqual(ref('w-1'), { design: null, screen: null, state: null });
  assert.deepEqual(ref('w-2'), { design: '出張申請', screen: '申請の入力', state: '申請' });
  assert.deepEqual(ref('w-3'), { design: '出張申請', screen: null, state: '承認待ち' });
  assert.deepEqual(ref('w-4'), { design: '社員マスタ', screen: null, state: null });
  assert.deepEqual(ref('w-7'), { design: '出張申請', screen: '（ない画面）', state: '（ないステータス）' });
  // 別の画面設計の、同じ id の画面・ステータスは引かない（社員マスタには s-form も t-a もない）
  const other = { ...sys('y-trip'), swimlane: { steps: [step('w-9', 'l-app', 0, 'task', 'x', { designId: 'd-emp', screenId: 's-form', stateId: 't-a' })], edges: [] } };
  assert.deepEqual(plain(api.swimlaneModel(S(), other).nodes[0].ref), { design: '社員マスタ', screen: '（ない画面）', state: '（ないステータス）' });
  const gone = { ...sys('y-trip'), swimlane: { steps: [step('w-9', 'l-app', 0, 'task', 'x', { designId: 'd-gone' })], edges: [] } };
  assert.deepEqual(plain(api.swimlaneModel(S(), gone).nodes[0].ref), { design: '（ない画面設計）', screen: null, state: null });
  assert.deepEqual(plain(api.swimlaneModel(S(), sys('y-empty'))), { nodes: [], edges: [] });
});

test('並べ方: 帯は役割の順に上から。箱の左の端は 名前の列 + 24 + 列 × 240。同じ帯の同じ列の作業は縦に積み、その帯が高くなる', async (t) => {
  const { api, S, sys } = await boot(t);
  assert.equal(api.SWIM_LABEL_W, 136);
  assert.equal(api.SWIM_COL, 240);
  const y = sys('y-trip');
  const lay = api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  assert.deepEqual(plain(lay.lanes.map((l) => [l.role.name, l.y, l.h])), [['申請者', 0, 112], ['上長', 112, 192], ['経理', 304, 112]],
    '1 段の帯は 24 + 64 + 24、2 段の帯は 24 + 64 + 16 + 64 + 24。作業のない帯も 1 段分');
  assert.deepEqual(plain(lay.pos), {
    'w:w-1': { x: 160, y: 24, h: 64 },
    'w:w-2': { x: 400, y: 24, h: 64 },
    'w:w-3': { x: 640, y: 136, h: 64 },
    'w:w-4': { x: 640, y: 216, h: 64 },
    'w:w-5': { x: 880, y: 24, h: 64 },
    'w:w-7': { x: 1120, y: 24, h: 64 },
  });
  assert.equal(lay.w, 1120 + 200 + 40, 'いちばん右の列の箱の右 + 40');
  assert.equal(lay.h, 416);
  const two = api.swimlaneLayout(api.swimlaneModel(S(), sys('y-lanes')), sys('y-lanes'));
  assert.deepEqual(plain([two.lanes.map((l) => [l.y, l.h]), two.w, two.h, two.pos]), [[[0, 112], [112, 112]], 600, 224, {}], '作業がなくても幅は 600');
});

test('HTML: 帯と名前の列は SVG の rect（diagramCrop が拾う）。箱は種類の印と指す先の札。文字のない矢印は文字も下地も描かない', async (t) => {
  const { app, api, S, sys } = await boot(t);
  const y = sys('y-trip');
  const html = api.swimlaneHtml(S(), y);
  assert.ok(!/Infinity|NaN/.test(html), '文字のない矢印で Infinity・NaN が出ない');
  const box = dom(app, html);
  const inner = box.querySelector('.map-inner.swim-inner');
  assert.equal(inner.id, 'map-inner');
  assert.deepEqual(plain([inner.dataset.view, inner.dataset.focus, inner.style.width, inner.style.height]), ['swimlane', 'y-trip', '1360px', '416px']);
  // 帯（交互に白と #f8fafc）と名前の列（#e8eef6）。矢印の文字の下地は、文字のある 2 本の分だけ
  const rects = [...box.querySelectorAll('svg rect')];
  const bands = rects.filter((r) => r.getAttribute('opacity') !== '.92');
  assert.deepEqual(plain(bands.map((r) => ['x', 'y', 'width', 'height', 'fill'].map((a) => r.getAttribute(a)))), [
    ['0', '0', '1360', '112', '#fff'], ['0', '0', '136', '112', '#e8eef6'],
    ['0', '112', '1360', '192', '#f8fafc'], ['0', '112', '136', '192', '#e8eef6'],
    ['0', '304', '1360', '112', '#fff'], ['0', '304', '136', '112', '#e8eef6'],
  ]);
  assert.equal(rects.length - bands.length, 2, '文字の下地は「承認」「差し戻し」の 2 つ');
  assert.deepEqual(plain([...box.querySelectorAll('svg text')].map((x) => x.textContent)), ['承認', '差し戻し']);
  assert.equal(box.querySelectorAll('svg path[marker-end]').length, 5);
  assert.deepEqual(plain([...box.querySelectorAll('svg marker')].map((x) => x.id).sort()), ['swim-arrow-n', 'swim-arrow-o']);
  const back = [...box.querySelectorAll('svg path[marker-end]')].find((p) => p.getAttribute('marker-end') === 'url(#swim-arrow-o)');
  assert.deepEqual(plain([back.getAttribute('stroke'), back.getAttribute('stroke-dasharray')]), ['#ea580c', '6 4'], '戻る流れは橙の点線');
  // 帯の名前の列
  assert.deepEqual(plain([...box.querySelectorAll('.swim-lab')].map((x) => [x.textContent, x.style.top, x.style.height, x.title])),
    [['申請者', '0px', '112px', ''], ['上長', '112px', '192px', '課長と部長'], ['経理', '304px', '112px', '']]);
  // 作業の箱
  const node = (id) => box.querySelector(`.mnode[data-node="w:${id}"]`);
  assert.deepEqual(plain([...box.querySelectorAll('.mnode')].map((n) => n.className)),
    ['mnode sw k-start', 'mnode sw k-input', 'mnode sw k-decision', 'mnode sw k-task', 'mnode sw k-end', 'mnode sw k-doc']);
  assert.deepEqual(plain(['left', 'top', 'width', 'height'].map((k) => node('w-3').style[k])), ['640px', '136px', '200px', '64px']);
  assert.equal(node('w-1').querySelector('b').textContent, '出張が決まる');
  assert.equal(node('w-1').querySelector('.ref'), null, '指す先がなければ札はない');
  assert.equal(node('w-2').querySelector('.ref').textContent, '画面: 申請の入力', '画面とステータスの両方を指すときは、札は画面');
  assert.equal(node('w-3').querySelector('.ref').textContent, 'ステータス: 承認待ち');
  assert.equal(node('w-4').querySelector('.ref').textContent, '画面設計: 社員マスタ');
  assert.equal(node('w-7').querySelector('.ref').textContent, '画面: （ない画面）');
  assert.equal(node('w-7').querySelector('b').textContent, '書類', '文字のない作業は、種類の名前を出す');
  assert.equal(node('w-2').title, 'システムへの入力: 申請を入力する\n画面設計: 出張申請\n画面: 申請の入力\nステータス: 申請\nメモ: 日帰りも出す');
  assert.match(node('w-7').title, /ステータス: （ないステータス）/);
  // 切り出す範囲は、帯の全体（帯の rect を拾い、map-inner の幅と高さで抑える）
  assert.deepEqual(plain(api.diagramCrop(html)), { x0: 0, y0: 0, cw: 1360, ch: 416 });
  // 書き出し・AI の画像では、id="map-inner" を付けず、矢印の印の id の頭を変える
  const xp = api.swimlaneHtml(S(), y, { idPrefix: 'xi-swim', bare: true });
  assert.ok(!/id="map-inner"|[#"]swim-arrow-/.test(xp) && /url\(#xi-swim-arrow-n\)/.test(xp));
});

test('HTML: 役割がないときは案内の文。作業がないときは帯だけ描く（帯の rect で切り出せる）', async (t) => {
  const { app, api, S, sys } = await boot(t);
  assert.match(api.swimlaneHtml(S(), sys('y-empty')), /^<p class="map-empty">役割がまだありません。/);
  const html = api.swimlaneHtml(S(), sys('y-lanes'));
  const box = dom(app, html);
  assert.equal(box.querySelectorAll('.mnode').length, 0);
  assert.equal(box.querySelectorAll('svg path').length, 0);
  assert.equal(box.querySelectorAll('svg rect').length, 4);
  assert.deepEqual(plain([...box.querySelectorAll('.swim-lab')].map((x) => x.textContent)), ['社員', '上長']);
  assert.deepEqual(plain(api.diagramCrop(html)), { x0: 0, y0: 0, cw: 600, ch: 224 });
});

test('ほかの図の矢印も、文字が全部空なら文字の下地を描かない（名前のない操作のステータスの移り方の図）', async (t) => {
  const { app, api, S } = await boot(t);
  const html = api.viewHtml('process', S(), S().designs.find((d) => d.id === 'd-trip'));
  const box = dom(app, html);
  assert.equal(box.querySelectorAll('svg path[marker-end]').length, 1);
  assert.equal(box.querySelectorAll('svg rect').length, 0, '下地（幅 12 の白い四角）を描かない');
  assert.equal(box.querySelectorAll('svg text').length, 0);
  assert.ok(!/Infinity|NaN/.test(html));
});

test('書き出しの文と AI の図の画像: 題はシステムの名前、凡例は流れと戻る流れと箱の形。箱と矢印の数を返す', async (t) => {
  const { api, S, sys } = await boot(t);
  assert.equal(api.VIEW_TITLES.swimlane, 'スイムレーン図');
  assert.match(api.VIEW_LEGENDS.swimlane, /流れ.*戻る流れ（差し戻しなど）.*ひし形＝判断/);
  const doc = api.swimlaneImageDoc(S(), sys('y-trip'));
  assert.deepEqual(plain([doc.boxes, doc.arrows, doc.width, doc.height]), [6, 5, 1360 + 48, 416 + 28 + 48]);
  assert.match(doc.html, /<title>出張申請システム ／ スイムレーン図<\/title>/);
  assert.match(doc.html, /url\(#xi-swim-arrow-n\)/);
  assert.ok(!/id="map-inner"/.test(doc.html));
  // 凡例が長いので、図が狭くても画像の幅は 880 ＋ 余白より狭くしない（凡例を 1 行に収める）
  const lanes = api.swimlaneImageDoc(S(), sys('y-lanes'));
  assert.deepEqual(plain([lanes.boxes, lanes.arrows, lanes.width, lanes.height]), [0, 0, 880 + 48, 224 + 28 + 48], '作業がなくても帯の全体を撮る');
  assert.match(lanes.html, /width:600px;height:224px;overflow:hidden/);
  const empty = api.swimlaneImageDoc(S(), sys('y-empty'));
  assert.deepEqual(plain([empty.boxes, empty.arrows, empty.width, empty.height]), [0, 0, 880 + 48, 120 + 28 + 48]);
  assert.match(empty.html, /役割がまだありません/);
});

test('列を自動で付ける: 列のない作業に、矢印の順から列を付けた写しを返す。輪を閉じる矢印は数えない。矢印のない作業はいちばん右の次', async (t) => {
  const { api } = await boot(t);
  const raw = [
    { id: 'a', roleId: 'l-app', text: '始まり' },
    { id: 'b', roleId: 'l-app', col: null },
    { id: 'c', roleId: 'l-boss' },
    { id: 'd', roleId: 'l-app' }, // 矢印がない
    { id: 'e', roleId: 'l-boss', col: 5 }, // 列を書いた作業はそのまま
    { id: 'f', roleId: 'l-app' }, // 列 5 の作業の次
    { id: 'g', roleId: 'l-app' }, // 列 5 の作業の前（いちばん元）
    { id: 'h', roleId: 'l-app' }, // 矢印がない（d の次）
  ];
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, // c → a は輪を閉じる矢印（差し戻し）
    { from: 'e', to: 'f' }, { from: 'g', to: 'e' }, { from: 'f', to: 'zz' }, { from: 'f', to: 'f' },
  ];
  const before = plain(raw);
  const out = api.swimAutoCols(raw, edges);
  assert.deepEqual(plain(out.map((w) => [w.id, w.col])), [['a', 0], ['b', 1], ['c', 2], ['d', 7], ['e', 5], ['f', 6], ['g', 4], ['h', 8]]);
  assert.equal(out[0].text, '始まり', 'ほかの欄は残す');
  assert.deepEqual(plain(raw), before, '渡した作業は書き換えない（写しを返す）');
  assert.notEqual(out[4], raw[4]);
  assert.deepEqual(plain(api.swimAutoCols([{ id: 'x' }, { id: 'y' }], [])), [{ id: 'x', col: 0 }, { id: 'y', col: 1 }], '矢印も列もなければ、左から順に');
  assert.deepEqual(plain(api.swimAutoCols([{ id: 'x', col: 2 }], [])), [{ id: 'x', col: 2 }]);
});
