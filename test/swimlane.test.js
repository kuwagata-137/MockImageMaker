'use strict';
// 第 9 段階の前半（T3）: スイムレーン図を描く純関数（モデル・並べ方・HTML・AI の図の画像・列を自動で付ける）のテスト。
// スイムレーン図は、役割（申請者・上長など）ごとのレーンに作業の箱を流れの順に並べ、矢印でつないだ業務の流れの図。
// v1.03 で、描き方（箱の大きさ・線の引き方）と並べ方（自由な位置と、列から置く決まり）を MultipurposeDiagramMaker（MPD）v8.33 と同じにし、縦向きを足した（q141〜q146）。
// jsdom には canvas がないので、文字の幅は見積もり（全角＝字の大きさ・半角＝0.6 倍）で決まる（swimTextW）。
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

test('モデル: 箱は役割のある工程だけ（帯の番号と列）。矢印は両端の箱があるものだけで、列が戻る矢印は back。指す先の名前を引く', async (t) => {
  const { api, S, sys } = await boot(t);
  const m = api.swimlaneModel(S(), sys('y-trip'));
  assert.deepEqual(plain(m.nodes.map((n) => [n.key, n.step.id, n.laneIndex, n.col])), [
    ['w:w-1', 'w-1', 0, 0], ['w:w-2', 'w-2', 0, 1], ['w:w-3', 'w-3', 1, 2], ['w:w-4', 'w-4', 1, 2], ['w:w-5', 'w-5', 0, 3], ['w:w-7', 'w-7', 0, 4],
  ], '役割の見つからない工程 w-6 は外す');
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

// 箱の左上と大きさ [x, y, w, h]（並べ方の pos から）
const box4 = (p) => [p.x, p.y, p.w, p.h];
// 横向き（v1.02 までと同じ向き）の見本の並べ方。jsdom の文字の幅の見積もりで決まる値
const H_POS = {
  'w:w-1': [161, 49.5, 110, 31], // 始まり（110 × 31）
  'w:w-2': [313, 38.5, 126, 53], // システムへの入力（画面の札があるので 16 高い。札の文字で幅が広がる）
  'w:w-3': [520.5, 140, 191, 79], // 判断（ひし形。札の分だけ広く高い）
  'w:w-4': [549, 243, 134, 53], // w-3 と同じ列・同じ役割なので、レーンの中に 2 つ並べる
  'w:w-5': [801, 49.5, 110, 31],
  'w:w-7': [954, 37, 124, 56], // 書類（文字がないので種類の名前）
};

test('並べ方（横向き）: レーンは役割の順に上から（太さは 130。同じ列に 2 つあるレーンは 2 つが入る太さ）。列は左の名前の列（136）から 80 おきのガイド線に乗せ、間は前後の箱と矢印の文字が入るだけ空ける', async (t) => {
  const { api, S, sys } = await boot(t);
  assert.deepEqual(plain([api.SWIM_LABEL_W, api.SWIM_HDR, api.SWIM_LANE, api.SWIM_STEP]), [136, { horizontal: 136, vertical: 44 }, { horizontal: 130, vertical: 220 }, 80]);
  const y = sys('y-trip');
  const lay = api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  assert.equal(lay.vertical, false);
  assert.deepEqual(plain(lay.lanes.map((l) => [l.role.name, l.x, l.y, l.w, l.h])), [['申請者', 0, 0, 1158, 130], ['上長', 0, 130, 1158, 176], ['経理', 0, 306, 1158, 130]],
    '上長のレーンは、ひし形 79 ＋ 間 24 ＋ 箱 53 ＋ 縁 10 × 2');
  assert.deepEqual(plain(Object.fromEntries(Object.entries(lay.pos).map(([k, p]) => [k, box4(p)]))), H_POS);
  // 段（列）の真ん中は、見出し 136 から 80 おきのガイド線の上
  assert.deepEqual(plain(Object.values(lay.pos).map((p) => p.flow)), [216, 376, 616, 616, 856, 1016]);
  assert.ok(Object.values(lay.pos).every((p) => (p.flow - 136) % 80 === 0 && p.auto));
  // レーンに 1 つならレーンの真ん中。2 つで 1/4・3/4 に入らないときは、縁から 10 を空けて等しく並べる
  assert.deepEqual(plain(['w:w-1', 'w:w-3', 'w:w-4'].map((k) => lay.pos[k].cross)), [65, 49.5, 139.5]);
  assert.deepEqual(plain([lay.w, lay.h, lay.hdr, lay.orient]), [1158, 436, 136, 'horizontal'], '幅は、いちばん先の箱の後ろに 80');
  const two = api.swimlaneLayout(api.swimlaneModel(S(), sys('y-lanes')), sys('y-lanes'));
  assert.deepEqual(plain([two.lanes.map((l) => [l.y, l.h]), two.w, two.h, two.pos]), [[[0, 130], [130, 130]], 600, 260, {}], '工程がなくても長さは 600');
});

test('並べ方（縦向き。q141）: レーンは役割の順に左から（太さは 220。上に名前の行 44）。列は上から 80 おきのガイド線に乗せる。字は横書きのまま（箱は回さない。q145）', async (t) => {
  const { api, S, sys } = await boot(t);
  const y = { ...sys('y-trip'), swimlane: { ...sys('y-trip').swimlane, orientation: 'vertical' } };
  const lay = api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  assert.deepEqual(plain([lay.vertical, lay.hdr, lay.orient, lay.w, lay.h]), [true, 44, 'vertical', 809, 632]);
  assert.deepEqual(plain(lay.lanes.map((l) => [l.role.name, l.x, l.y, l.w, l.h])), [['申請者', 0, 0, 220, 632], ['上長', 220, 0, 369, 632], ['経理', 589, 0, 220, 632]]);
  assert.deepEqual(plain(Object.fromEntries(Object.entries(lay.pos).map(([k, p]) => [k, box4(p)]))), {
    'w:w-1': [55, 108.5, 110, 31], 'w:w-2': [47, 177.5, 126, 53], 'w:w-3': [230, 324.5, 191, 79], 'w:w-4': [445, 337.5, 134, 53],
    'w:w-5': [55, 428.5, 110, 31], 'w:w-7': [48, 496, 124, 56],
  });
  assert.deepEqual(plain(Object.values(lay.pos).map((p) => p.flow)), [124, 204, 364, 364, 444, 524]);
  assert.ok(Object.values(lay.pos).every((p) => (p.flow - 44) % 80 === 0));
  // 箱の大きさは横向きと同じ（横書き）
  const hz = api.swimlaneLayout(api.swimlaneModel(S(), sys('y-trip')), sys('y-trip'));
  assert.deepEqual(plain(Object.values(lay.pos).map((p) => [p.w, p.h])), plain(Object.values(hz.pos).map((p) => [p.w, p.h])));
  const lanes = { ...sys('y-lanes'), swimlane: { steps: [], edges: [], orientation: 'vertical' } };
  const two = api.swimlaneLayout(api.swimlaneModel(S(), lanes), lanes);
  assert.deepEqual(plain([two.lanes.map((l) => [l.x, l.w, l.h]), two.w, two.h]), [[[0, 220, 400], [220, 220, 400]], 440, 400], '工程がなくても長さは 400');
});

test('箱の大きさ（q144。MPD の autoFitNodeSize と同じ）: 種類ごとの既定の大きさ。文字の量で横に 260 まで広げ、超えたら折り返して縦に伸ばす。画面の札のある箱は 16 高い', async (t) => {
  const { api } = await boot(t);
  const sz = (text, kind, tag = '', cap = 260) => { const b = api.swimBoxSize(text, kind, tag, cap); return [b.w, b.h, b.lines.length]; };
  assert.deepEqual(plain(Object.fromEntries(Object.entries(api.SWIM_SHAPES).map(([k, v]) => [k, [v.type, v.w, v.h]]))), {
    start: ['terminal', 110, 31], end: ['terminal', 110, 31], task: ['rect', 120, 37], input: ['sys_input', 120, 37], decision: ['diamond', 180, 59], doc: ['doc', 60, 40],
  });
  assert.deepEqual([sz('始まり', 'start'), sz('作業', 'task'), sz('入力', 'input'), sz('判断', 'decision'), sz('書類', 'doc')], [[110, 31, 1], [120, 37, 1], [120, 37, 1], [180, 59, 1], [60, 40, 1]]);
  assert.equal(api.SWIM_W_MAX, 260);
  assert.deepEqual(sz('あ'.repeat(30), 'task'), [260, 46, 2], '260 を超える文字は折り返す（2 行で 15 × 2 ＋ 16）');
  assert.deepEqual(sz('作業', 'task', '画面: 一覧'), [120, 53, 1], '札の行の分 16 高い');
  assert.deepEqual(sz('あ'.repeat(30), 'task', '', 216), [212, 46, 2], '縦向きはレーンの太さ − 4 まで');
  assert.deepEqual(sz('申請の中身と金額を確かめる', 'decision'), [233, 77, 1], 'ひし形は、文字が入るまで縦横の比のまま広げる');
});

test('覚えた位置（q145・q146）: 向きごとの pos の位置に置く。覚えた後に役割か列が変わった工程は列から置き直す。覚えた工程のない列は、近くの覚えた列から、列から置いたときと同じ間を空ける', async (t) => {
  const { api, S, sys } = await boot(t);
  const withPos = (pos, orientation) => {
    const y = plain(sys('y-trip'));
    y.swimlane.steps.find((w) => w.id === 'w-2').pos = pos;
    if (orientation) y.swimlane.orientation = orientation;
    return api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  };
  const L = withPos({ horizontal: { flow: 500, cross: 40, roleId: 'l-app', col: 1 }, vertical: { flow: 300, cross: 80, roleId: 'l-app', col: 1 } });
  assert.deepEqual(plain([box4(L.pos['w:w-2']), L.pos['w:w-2'].auto]), [[437, 13.5, 126, 53], false], '真ん中が流れ 500・レーンの縁から 40');
  assert.deepEqual(plain([L.pos['w:w-1'].flow, L.pos['w:w-3'].flow, L.pos['w:w-5'].flow]), [340, 740, 980], '前後の列は、列から置いたときと同じ間（160・240）');
  const V = withPos({ horizontal: { flow: 500, cross: 40, roleId: 'l-app', col: 1 }, vertical: { flow: 300, cross: 80, roleId: 'l-app', col: 1 } }, 'vertical');
  assert.deepEqual(plain(box4(V.pos['w:w-2'])), [17, 273.5, 126, 53], '縦向きは縦向きの位置');
  assert.equal(withPos({ horizontal: { flow: 500, cross: 40, roleId: 'l-boss', col: 1 } }).pos['w:w-2'].flow, 376, '役割が変わった工程は、列から置く');
  assert.equal(withPos({ horizontal: { flow: 500, cross: 40, roleId: 'l-app', col: 3 } }).pos['w:w-2'].auto, true, '列が変わった工程も');
  assert.equal(withPos({ vertical: { flow: 300, cross: 80, roleId: 'l-app', col: 1 } }).pos['w:w-2'].auto, true, 'ほかの向きの位置は使わない');
});

// 線の折れ線の点（data-wps の "x,y x,y …"）
const wpsOf = (path) => path.getAttribute('data-wps').split(' ').map((s) => s.split(',').map(Number));
// 点が箱の縁の上にあるか（ひし形の頂点も、外の四角の縁の上）
const onEdge = ([x, y], b) => {
  const inX = x >= b.x - 0.6 && x <= b.x + b.w + 0.6;
  const inY = y >= b.y - 0.6 && y <= b.y + b.h + 0.6;
  return inX && inY && (Math.abs(x - b.x) < 0.6 || Math.abs(x - b.x - b.w) < 0.6 || Math.abs(y - b.y) < 0.6 || Math.abs(y - b.y - b.h) < 0.6);
};

test('HTML（横向き）: 帯と名前の列は SVG の rect（diagramCrop が拾う）・80 おきの薄いガイド線・箱（種類の印と指す先の札）。線は MPD と同じ灰色 1.5 の直角の線、戻る線だけ橙の点線（q143）', async (t) => {
  const { app, api, S, sys } = await boot(t);
  const y = sys('y-trip');
  const html = api.swimlaneHtml(S(), y);
  assert.ok(!/Infinity|NaN/.test(html), '文字のない矢印で Infinity・NaN が出ない');
  const box = dom(app, html);
  const inner = box.querySelector('.map-inner.swim-inner');
  assert.equal(inner.id, 'map-inner');
  assert.equal(inner.classList.contains('down'), false);
  assert.deepEqual(plain([inner.dataset.view, inner.dataset.focus, inner.style.width, inner.style.height]), ['swimlane', 'y-trip', '1158px', '436px']);
  // 帯（交互に白と #f8fafc）と名前の列（#e8eef6）。矢印の文字の下地（.sw-lab）は、文字のある 2 本の分だけ
  const rects = [...box.querySelectorAll('svg rect')];
  const bands = rects.filter((r) => !r.classList.contains('sw-lab'));
  assert.deepEqual(plain(bands.map((r) => ['x', 'y', 'width', 'height', 'fill'].map((a) => r.getAttribute(a)))), [
    ['0', '0', '1158', '130', '#fff'], ['0', '0', '136', '130', '#e8eef6'],
    ['0', '130', '1158', '176', '#f8fafc'], ['0', '130', '136', '176', '#e8eef6'],
    ['0', '306', '1158', '130', '#fff'], ['0', '306', '136', '130', '#e8eef6'],
  ]);
  assert.equal(box.querySelectorAll('svg .sw-grid line').length, 12, 'ガイド線は 216 から 80 おきに 1158 の手前まで');
  const labs = rects.filter((r) => r.classList.contains('sw-lab'));
  assert.deepEqual(plain(labs.map((r) => [r.dataset.edge, r.getAttribute('fill'), r.getAttribute('stroke'), r.getAttribute('rx')])), [['e-3', '#fff', '#cbd5e1', '3'], ['e-4', '#fff', '#cbd5e1', '3']]);
  assert.deepEqual(plain([...box.querySelectorAll('svg text')].map((x) => [x.textContent, x.getAttribute('font-size'), x.getAttribute('fill')])), [['承認', '11', '#475569'], ['差し戻し', '11', '#ea580c']]);
  // 差し戻しの線はレーンの縁から 10 を通る。文字の下地は図からはみ出さない（y が 0 より下）
  assert.deepEqual(plain(['x', 'y', 'width', 'height'].map((a) => labs[1].getAttribute(a))), ['517.8', '1.0', '58', '22']);
  // 線: 進む線を先に、戻る線を後に描く。矢印の先は MPD と同じ形（8 × 6）
  const lines = [...box.querySelectorAll('svg path.sw-line')];
  assert.deepEqual(plain(lines.map((p) => [p.dataset.edge, p.getAttribute('stroke'), p.getAttribute('stroke-width'), p.getAttribute('stroke-dasharray'), p.getAttribute('marker-end')])), [
    ['e-1', '#475569', '1.5', null, 'url(#swim-arrow)'], ['e-2', '#475569', '1.5', null, 'url(#swim-arrow)'], ['e-3', '#475569', '1.5', null, 'url(#swim-arrow)'],
    ['e-6', '#475569', '1.5', null, 'url(#swim-arrow)'], ['e-4', '#ea580c', '1.5', '6,4', 'url(#swim-arrow-b)'],
  ], '端の箱がない矢印 e-5 は描かない');
  assert.deepEqual(plain([...box.querySelectorAll('svg marker')].map((x) => [x.id, x.getAttribute('markerWidth'), x.getAttribute('markerHeight')])), [['swim-arrow', '8', '6'], ['swim-arrow-b', '8', '6']]);
  // 線は直角に曲がり（折れ線の隣の点は x か y が同じ）、両端は箱の縁の上
  const L = api.swimlaneLayout(api.swimlaneModel(S(), y), y);
  const ends = { 'e-1': ['w-1', 'w-2'], 'e-2': ['w-2', 'w-3'], 'e-3': ['w-3', 'w-5'], 'e-6': ['w-4', 'w-5'], 'e-4': ['w-3', 'w-2'] };
  lines.forEach((p) => {
    const w = wpsOf(p);
    w.slice(1).forEach((q, i) => assert.ok(Math.abs(q[0] - w[i][0]) < 0.01 || Math.abs(q[1] - w[i][1]) < 0.01, `${p.dataset.edge} の ${i} 番目の区間が直角でない`));
    const [a, b] = ends[p.dataset.edge];
    assert.ok(onEdge(w[0], L.pos['w:' + a]), `${p.dataset.edge} の元の端`);
    assert.ok(onEdge(w.at(-1), L.pos['w:' + b]), `${p.dataset.edge} の先の端`);
  });
  assert.deepEqual(plain(wpsOf(lines[0])), [[271, 65], [313, 65]], '同じ高さの箱どうしは、まっすぐ右の縁 → 左の縁');
  assert.deepEqual(plain(wpsOf(lines[4])), [[616, 140], [616, 10], [376, 10], [376, 38.5]], '差し戻しは上の縁から出て、レーンの縁の 10 内を通り、上の縁に入る');
  // 帯の名前の列
  assert.deepEqual(plain([...box.querySelectorAll('.swim-lab')].map((x) => [x.textContent, x.style.top, x.style.width, x.style.height, x.title])),
    [['申請者', '0px', '136px', '130px', ''], ['上長', '130px', '136px', '176px', '課長と部長'], ['経理', '306px', '136px', '130px', '']]);
  // 作業の箱
  const node = (id) => box.querySelector(`.mnode[data-node="w:${id}"]`);
  assert.deepEqual(plain([...box.querySelectorAll('.mnode')].map((n) => n.className)),
    ['mnode sw k-start', 'mnode sw k-input', 'mnode sw k-decision', 'mnode sw k-task', 'mnode sw k-end', 'mnode sw k-doc']);
  assert.deepEqual(plain(['left', 'top', 'width', 'height'].map((k) => node('w-3').style[k])), ['520.5px', '140px', '191px', '79px']);
  assert.equal(node('w-1').querySelector('b').textContent, '出張が決まる');
  assert.equal(node('w-1').querySelector('.ref'), null, '指す先がなければ札はない');
  assert.equal(node('w-2').querySelector('.ref').textContent, '画面: 申請の入力', '画面とステータスの両方を指すときは、札は画面');
  assert.equal(node('w-3').querySelector('.ref').textContent, 'ステータス: 承認待ち');
  assert.equal(node('w-4').querySelector('.ref').textContent, '画面設計: 社員マスタ');
  assert.equal(node('w-7').querySelector('.ref').textContent, '画面: （ない画面）');
  assert.equal(node('w-7').querySelector('b').textContent, '書類', '文字のない作業は、種類の名前を出す');
  assert.equal(node('w-2').title, 'システムへの入力: 申請を入力する\n画面設計: 出張申請\n画面: 申請の入力\nステータス: 申請\nメモ: 日帰りも出す');
  assert.match(node('w-7').title, /ステータス: （ないステータス）/);
  // 切り出す範囲は、帯の全体（帯の rect と線の点を拾い、map-inner の幅と高さで抑える）
  assert.deepEqual(plain(api.diagramCrop(html)), { x0: 0, y0: 0, cw: 1158, ch: 436 });
  // 出力・AI の画像では、id="map-inner" を付けず、矢印の印の id の頭を変える
  const xp = api.swimlaneHtml(S(), y, { idPrefix: 'xi-swim', bare: true });
  assert.ok(!/id="map-inner"|[#"]swim-arrow/.test(xp) && /url\(#xi-swim-arrow\)/.test(xp) && /url\(#xi-swim-arrow-b\)/.test(xp));
});

test('HTML（縦向き）: .swim-inner に down。名前は上の行（44）、帯の rect は縦長。線は下の縁から出て上の縁に入り、差し戻しは左へ回る', async (t) => {
  const { app, api, S, sys } = await boot(t);
  const y = { ...sys('y-trip'), swimlane: { ...sys('y-trip').swimlane, orientation: 'vertical' } };
  const html = api.swimlaneHtml(S(), y);
  const box = dom(app, html);
  const inner = box.querySelector('.swim-inner');
  assert.ok(inner.classList.contains('down'));
  assert.deepEqual(plain([inner.style.width, inner.style.height]), ['809px', '632px']);
  assert.deepEqual(plain([...box.querySelectorAll('.swim-lab')].map((x) => [x.textContent, x.style.left, x.style.top, x.style.width, x.style.height])),
    [['申請者', '0px', '0px', '220px', '44px'], ['上長', '220px', '0px', '369px', '44px'], ['経理', '589px', '0px', '220px', '44px']]);
  assert.deepEqual(plain([...box.querySelectorAll('svg rect')].slice(0, 2).map((r) => ['x', 'y', 'width', 'height', 'fill'].map((a) => r.getAttribute(a)))),
    [['0', '0', '220', '632', '#fff'], ['0', '0', '220', '44', '#e8eef6']]);
  const line = (id) => box.querySelector(`svg path.sw-line[data-edge="${id}"]`);
  assert.deepEqual(plain(wpsOf(line('e-1'))), [[110, 139.5], [110, 177.5]], '上の箱の下の縁 → 下の箱の上の縁');
  assert.deepEqual(plain(wpsOf(line('e-4'))), [[230, 364], [10, 364], [10, 204], [47, 204]], '差し戻しは左の縁から出て、レーンの縁の 10 内を通り、左の縁に入る');
  assert.ok(line('e-4').classList.contains('back'));
  const lab = box.querySelector('svg rect.sw-lab[data-edge="e-4"]');
  assert.ok(Number(lab.getAttribute('x')) >= 0, '縁を通る線の文字も図の中');
  assert.deepEqual(plain(api.diagramCrop(html)), { x0: 0, y0: 0, cw: 809, ch: 632 });
});

test('HTML: 役割がないときは案内の文。作業がないときはヘッダーだけ描く（帯の rect で切り出せる）', async (t) => {
  const { app, api, S, sys } = await boot(t);
  assert.match(api.swimlaneHtml(S(), sys('y-empty')), /^<p class="map-empty">役割がまだありません。/);
  const html = api.swimlaneHtml(S(), sys('y-lanes'));
  const box = dom(app, html);
  assert.equal(box.querySelectorAll('.mnode').length, 0);
  assert.equal(box.querySelectorAll('svg path.sw-line').length, 0, '線はない（矢印の先の印の形だけ）');
  assert.equal(box.querySelectorAll('svg rect').length, 4);
  assert.deepEqual(plain([...box.querySelectorAll('.swim-lab')].map((x) => x.textContent)), ['社員', '上長']);
  assert.deepEqual(plain(api.diagramCrop(html)), { x0: 0, y0: 0, cw: 600, ch: 260 });
});

test('ほかの図の矢印も、文字が全部空なら文字の下地を描かない（名前のない操作のステータスの流れの図）', async (t) => {
  const { app, api, S } = await boot(t);
  const html = api.viewHtml('process', S(), S().designs.find((d) => d.id === 'd-trip'));
  const box = dom(app, html);
  assert.equal(box.querySelectorAll('svg path[marker-end]').length, 1);
  assert.equal(box.querySelectorAll('svg rect').length, 0, '下地（幅 12 の白い四角）を描かない');
  assert.equal(box.querySelectorAll('svg text').length, 0);
  assert.ok(!/Infinity|NaN/.test(html));
});

test('出力の文と AI の図の画像: 題はシステムの名前、凡例は流れと戻る流れと箱の形。箱と矢印の数を返す', async (t) => {
  const { api, S, sys } = await boot(t);
  assert.equal(api.VIEW_TITLES.swimlane, 'スイムレーン図');
  assert.match(api.VIEW_LEGENDS.swimlane, /<i class="s"><\/i>流れ.*<i class="sb"><\/i>戻る流れ（差し戻しなど）.*ひし形＝判断/);
  const doc = api.swimlaneImageDoc(S(), sys('y-trip'));
  assert.deepEqual(plain([doc.boxes, doc.arrows, doc.width, doc.height]), [6, 5, 1158 + 48, 436 + 28 + 48]);
  assert.match(doc.html, /<title>出張申請システム ／ スイムレーン図<\/title>/);
  assert.match(doc.html, /url\(#xi-swim-arrow\)/);
  assert.ok(!/id="map-inner"/.test(doc.html));
  // 凡例が長いので、図が狭くても画像の幅は 880 ＋ 余白より狭くしない（凡例を 1 行に収める）
  const lanes = api.swimlaneImageDoc(S(), sys('y-lanes'));
  assert.deepEqual(plain([lanes.boxes, lanes.arrows, lanes.width, lanes.height]), [0, 0, 880 + 48, 260 + 28 + 48], '作業がなくても帯の全体を撮る');
  assert.match(lanes.html, /width:600px;height:260px;overflow:hidden/);
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

// ── 見直しで見つけたもの（第 9 段階の T9）──
test('列を自動で付ける: 矢印の並びの順によらない（作業の並びで前へ進む矢印を先に数え、戻る矢印〔差し戻し〕を輪を閉じる矢印にする）', async (t) => {
  const { api } = await boot(t);
  const steps = ['A', 'B', 'C'].map((id) => ({ id, roleId: 'l-app' }));
  const cols = (edges) => plain(api.swimAutoCols(steps, edges).map((w) => w.col));
  const fwd = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
  const back = { from: 'C', to: 'B', label: '差し戻し' };
  assert.deepEqual(cols([...fwd, back]), [0, 1, 2]);
  assert.deepEqual(cols([fwd[0], back, fwd[1]]), [0, 1, 2], '差し戻しが行きより先に並んでいても同じ');
  assert.deepEqual(cols([back, fwd[1], fwd[0]]), [0, 1, 2]);
});
