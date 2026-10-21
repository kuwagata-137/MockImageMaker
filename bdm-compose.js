// bdm-compose.js — システムのスイムレーン図（ページが渡す形）と元の MPD の図の中身から、MPD へ出力する図の中身を組む（第 11 段階。設計書 11-3）
// 渡す形（bdm-export.js が形を確かめた物）: { name, lanes: [役割の名前…], steps: [{ key, lane（lanes の番号）, col, kind, text, box }], edges: [{ from, to, label }] }
//   box は、その作業が元の MPD の箱から作ったもののとき、その箱の id（ページが作業の src.material と選んだ資料を比べて入れる）
// 決まり（2026-10-21。設計書 16 章）:
//  - 図の種類は swimlane・名前はシステムの名前・向きと用紙・見た目・appVer などほかの欄は元のまま。docId は null（元のままだと、出力したファイルを
//    MultipurposeDiagramMaker で上書き保存したとき、元のファイルに書く恐れがある。null なら MultipurposeDiagramMaker が保存のときに作る）
//  - id は 'e' ＋ 番号。uid は「最後に使った番号」（MultipurposeDiagramMaker の uid() は ++S.uid）。元の uid と元の id の番号の最大から振る
//  - レーンは役割の順。元のレーンと名前が同じなら、id・色・幅を使い回す（同じ名前が 2 つなら順に）。ほかは新しい id と色の並び LC から順の色
//  - 箱の種類: start・end → terminal、task → rect、input → sys_input、decision → diamond、doc → doc。メモ・指す先は書かない。グループ枠・補足の箱は入れない
//  - 元の箱の使い回し: box の箱の id を使う。読み直して同じ種類になる（新しい矢印の本数で classifyBox）なら欄も残し、違えば作り直す。複数レーンの箱は作り直す
//  - 元の位置を使うのは、欄を残した箱のうち、元の図での役割と列が今と同じもの（位置は bdm-place.js）
//  - 矢印は、両端の箱が元の図の同じ向きの矢印でつながっていれば、その欄を使い回す（文字が変われば fromLabel・toLabel を空に、端の箱が動いたら経路の欄を消す）
// Electron に触らない。node だけでテストできる
'use strict';

const { diagramInfo, classifyBox, CROSSLANE_TYPES, GROUP_TYPE, SUPPLEMENT_TYPE } = require('./bdm-kinds');
const { createLaneMap, laneOf, DEFAULT_LANE_SIZE } = require('./bdm-layout');
const { labelOf } = require('./bdm-edges');
const { idOf, cleanText, isObject, finiteNumber } = require('./bdm-values');
const { placeBoxes } = require('./bdm-place');

// MultipurposeDiagramMaker の色の並び LC（参考/diagram_v8.31.html 1380）と、箱の標準の大きさ SD（1341。w は交差の向き・h は流れの向き）
const LANE_COLORS = [
  { bg: '#eff6ff', hd: '#bfdbfe' }, { bg: '#f0fdf4', hd: '#bbf7d0' }, { bg: '#fefce8', hd: '#fde68a' }, { bg: '#fdf4ff', hd: '#e9d5ff' },
  { bg: '#fff1f2', hd: '#fecdd3' }, { bg: '#f0fdfa', hd: '#99f6e4' }, { bg: '#fff7ed', hd: '#fed7aa' },
];
const TYPE_OF_KIND = Object.freeze({ start: 'terminal', end: 'terminal', task: 'rect', input: 'sys_input', decision: 'diamond', doc: 'doc' });
const BOX_SIZE = Object.freeze({ terminal: { w: 110, h: 31 }, rect: { w: 120, h: 37 }, sys_input: { w: 120, h: 37 }, diamond: { w: 180, h: 59 }, doc: { w: 60, h: 40 } });
const ROUTE_KEYS = ['waypoints', 'orthoWps', 'midPos']; // 矢印の経路の欄（端の箱が動いたら消す。MultipurposeDiagramMaker も箱を動かすと消す）
const E_ID = /^e(\d+)$/;

const listOf = (v) => (Array.isArray(v) ? v.filter(isObject) : []);
// レーンと役割の名前を比べる形。アプリの役割の名前（mock_v*.html の cleanName）と同じく、前後の空白を取り、続く空白（全角の空白・改行も）を
// 半角の空白 1 つにし、100 字で切る（取り込んだ役割の名前はこの形になるので、元のレーンの名前もそろえてから比べる）
const NAME_MAX = 100;
const nameKey = (v) => cleanText(v).replace(/\s+/g, ' ').slice(0, NAME_MAX);
const useLanesOf = (diagramType) => {
  try {
    return diagramInfo(diagramType).useLanes;
  } catch (_) {
    return false; // 読めない図の種類（ER 図など）のレーンは使い回さない
  }
};

// id を振る。元の uid と、元のレーン・箱・矢印の 'e' ＋ 番号の最大の次から。同じ id を 2 回使わない（元の id の重なりも直す）
function createIds(orig) {
  let last = Number.isSafeInteger(orig.uid) && orig.uid > 0 ? orig.uid : 0;
  for (const o of [...listOf(orig.lanes), ...listOf(orig.nodes), ...listOf(orig.edges)]) {
    const m = E_ID.exec(idOf(o.id));
    if (m) last = Math.max(last, Number(m[1]));
  }
  const used = new Set();
  const fresh = () => {
    last += 1;
    used.add(`e${last}`);
    return `e${last}`;
  };
  const claim = (id) => {
    if (!id || used.has(id)) return fresh();
    used.add(id);
    return id;
  };
  return { fresh, claim, last: () => last };
}

// レーン: [{ lane（出力するレーン）, from（使い回した元のレーンの id か null）}]
function composeLanes(orig, names, ids) {
  const origLanes = useLanesOf(orig.diagramType) ? listOf(orig.lanes) : [];
  const taken = new Set();
  return names.map((name, i) => {
    const j = origLanes.findIndex((l, k) => !taken.has(k) && nameKey(l.name) === nameKey(name));
    if (j < 0) return { lane: { id: ids.fresh(), name, ...LANE_COLORS[i % LANE_COLORS.length], w: DEFAULT_LANE_SIZE }, from: null };
    taken.add(j);
    const l = origLanes[j];
    const w = Number.isFinite(l.w) && l.w > 0 ? l.w : DEFAULT_LANE_SIZE;
    return { lane: { ...l, id: ids.claim(idOf(l.id)), name, w }, from: idOf(l.id) };
  });
}

// 作業 1 つの入るレーンの元の箱。使えない（ない・枠や補足・前の作業が使った）ときは null
function claimBox(step, origById, claimed) {
  const node = step.box ? origById.get(step.box) : null;
  if (!node || claimed.has(step.box) || node.type === GROUP_TYPE || node.type === SUPPLEMENT_TYPE) return null;
  claimed.add(step.box);
  return node;
}

// 元の位置を使えるときの { mainCenter, crossRatio }。元の図での役割（レーン）と列が、今と同じときだけ
function reuseOf(node, step, lane, ctx) {
  const was = ctx.origSteps.get(idOf(node.id));
  if (!was || was.col !== ctx.rankOf.get(step.col) || !lane.from) return null;
  const box = { laneId: idOf(node.lid), x: finiteNumber(node.x, 0), y: finiteNumber(node.y, 0), w: finiteNumber(node.w, 0), h: finiteNumber(node.h, 0) };
  const origLane = laneOf(ctx.origLaneMap, box, ctx.vertical);
  if (!origLane || origLane.id !== lane.from || nameKey(was.role) !== nameKey(lane.lane.name)) return null;
  const [main, mainSize, cross, crossSize] = ctx.vertical ? [box.y, box.h, box.x, box.w] : [box.x, box.w, box.y, box.h];
  return { mainCenter: main + mainSize / 2, crossRatio: (cross + crossSize / 2 - origLane.start) / (origLane.end - origLane.start) };
}

// 箱（位置の前）: [{ node, item（bdm-place.js に渡す）, origNode（使い回した元の箱か null）}]
function composeBoxes(plan, lanes, degrees, ctx) {
  const claimed = new Set();
  return plan.steps.map((step) => {
    const origNode = claimBox(step, ctx.origById, claimed);
    const keep = !!origNode && !CROSSLANE_TYPES.has(origNode.type)
      && classifyBox({ type: origNode.type, node: origNode, text: cleanText(step.text) }, degrees.get(step.key)).kind === step.kind;
    const type = keep ? origNode.type : TYPE_OF_KIND[step.kind];
    const id = origNode ? ctx.ids.claim(idOf(origNode.id)) : ctx.ids.fresh();
    const node = keep ? { ...origNode, id, text: step.text, lid: lanes[step.lane].lane.id } : { id, type, x: 0, y: 0, w: 0, h: 0, text: step.text, lid: lanes[step.lane].lane.id };
    const size = keep ? { w: finiteNumber(origNode.w, BOX_SIZE.rect.w), h: finiteNumber(origNode.h, BOX_SIZE.rect.h) } : null;
    const [main, cross] = size ? (ctx.vertical ? [size.h, size.w] : [size.w, size.h]) : [BOX_SIZE[type].h, BOX_SIZE[type].w];
    const reuse = keep ? reuseOf(origNode, step, lanes[step.lane], ctx) : null;
    return { node, origNode: keep ? origNode : null, item: { lane: step.lane, col: step.col, main, cross, reuse } };
  });
}

// 矢印。両端の箱が元の図の同じ向きの矢印でつながっていれば、その矢印の欄を使い回す
function composeEdges(orig, plan, boxOf, ids) {
  const origByPair = new Map();
  for (const e of listOf(orig.edges)) {
    const pair = `${idOf(e.from)}\n${idOf(e.to)}`;
    if (!origByPair.has(pair)) origByPair.set(pair, e);
  }
  return plan.edges.map((e) => {
    const from = boxOf.get(e.from);
    const to = boxOf.get(e.to);
    const was = origByPair.get(`${from.node.id}\n${to.node.id}`);
    origByPair.delete(`${from.node.id}\n${to.node.id}`);
    if (!was) return { id: ids.fresh(), from: from.node.id, to: to.node.id, label: e.label, fromLabel: '', toLabel: '', fromLid: null, toLid: null };
    const out = { ...was, id: ids.claim(idOf(was.id)), from: from.node.id, to: to.node.id };
    if (labelOf(was) !== cleanText(e.label)) Object.assign(out, { label: e.label, fromLabel: '', toLabel: '' });
    if (from.moved || to.moved) {
      for (const k of ROUTE_KEYS) delete out[k];
      Object.assign(out, { fromLid: null, toLid: null });
    }
    return out;
  });
}

// 作業ごとの、入る矢印と出る矢印の数（classifyBox で、始まり・終わりを読み直したときと同じに見分けるため）
function degreesOf(plan) {
  const degrees = new Map(plan.steps.map((s) => [s.key, { incoming: 0, outgoing: 0 }]));
  for (const e of plan.edges) {
    degrees.get(e.from).outgoing += 1;
    degrees.get(e.to).incoming += 1;
  }
  return degrees;
}

// orig: 元の MPD の図の中身・plan: 渡す形・origPlan: bdmPlan(orig)（読めない図の種類なら null）
// → { state（出力する図の中身）, idOfKey（作業の key → 箱の id）}
function composeBdmState(orig, plan, origPlan) {
  const vertical = (orig.orientation || 'vertical') === 'vertical'; // MultipurposeDiagramMaker の isV()
  const ids = createIds(orig);
  const lanes = composeLanes(orig, plan.lanes, ids);
  const ctx = {
    vertical, ids,
    origById: new Map(listOf(orig.nodes).map((n) => [idOf(n.id), n]).reverse()), // 同じ id が 2 つなら前の箱
    origSteps: new Map((origPlan ? origPlan.steps : []).map((s) => [s.key, s])),
    origLaneMap: createLaneMap(orig.lanes, useLanesOf(orig.diagramType)),
    rankOf: new Map([...new Set(plan.steps.map((s) => s.col))].sort((a, b) => a - b).map((c, i) => [c, i])),
  };
  const boxes = composeBoxes(plan, lanes, degreesOf(plan), ctx);
  const placed = placeBoxes({ items: boxes.map((b) => b.item), laneSizes: lanes.map((l) => l.lane.w) });
  boxes.forEach((b, i) => {
    const [x, y] = vertical ? [placed.crosses[i], placed.mains[i]] : [placed.mains[i], placed.crosses[i]];
    const [w, h] = vertical ? [b.item.cross, b.item.main] : [b.item.main, b.item.cross];
    b.moved = !b.origNode || b.origNode.x !== x || b.origNode.y !== y || b.origNode.w !== w || b.origNode.h !== h;
    Object.assign(b.node, { x, y, w, h });
  });
  lanes.forEach((l, i) => { l.lane.w = placed.laneSizes[i]; });
  const boxOf = new Map(plan.steps.map((s, i) => [s.key, boxes[i]]));
  const edges = composeEdges(orig, plan, boxOf, ids);
  const state = {
    ...orig, diagramType: 'swimlane', diagramName: plan.name,
    lanes: lanes.map((l) => l.lane), nodes: boxes.map((b) => b.node), edges, uid: ids.last(), docId: null,
  };
  return { state, idOfKey: new Map(plan.steps.map((s, i) => [s.key, boxes[i].node.id])) };
}

module.exports = { composeBdmState, TYPE_OF_KIND };
