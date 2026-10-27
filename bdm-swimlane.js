// bdm-swimlane.js — BDM（ビジネスダイアグラムメーカー）の図の中身から、システムのスイムレーン図の案と、AI が読む文を作る
// 役割:
//  - bdmPlan(state): 図の中身 → { diagramType, diagramName, orientation, roles, steps, edges, warnings }
//    roles は役割（レーン）の名前・steps は作業（key は BDM の箱の id）・edges は作業の key どうしの矢印・warnings は読み飛ばしたことの文
//    種類の対応は bdm-kinds.js・レーンと列は bdm-layout.js・矢印は bdm-edges.js・AI が読む文は bdm-summary.js
//  - planFromHtml(html): 保存 HTML → 案（materials:bdmPlan の本体。bdm-state.js で図の中身を取り出してから bdmPlan）
//  - bdmSummaryBlocks(state)・bdmBlocksFromHtml(html): AI が読む文の塊の並び（資料の読み出し read_material の bdm の種類が使う）
// 図の元の箱の { id, x, y, w, h } は step の src に残す（BDM へ書き戻すとき、同じ箱・同じ位置に戻すため）。
// Electron に触らない。node だけでテストできる
'use strict';

const { MaterialError } = require('./material-error');
const { extractBdmState } = require('./bdm-state');
const { NO_LANE_ROLE, GROUP_TYPE, SUPPLEMENT_TYPE, CROSSLANE_TYPES, diagramInfo, classifyBox } = require('./bdm-kinds');
const { createLaneMap, laneRoleOf, spanRoles, assignColumns, groupNamesOf } = require('./bdm-layout');
const { readEdges } = require('./bdm-edges');
const { summaryBlocksOf } = require('./bdm-summary');
const { idOf, cleanText, isObject, finiteNumber } = require('./bdm-values');

const DEFAULT_BOX = { w: 120, h: 37 }; // BDM の長方形の標準の大きさ（大きさが数でない箱）
const CROSSLANE_THICKNESS = 37; // 複数レーンの箱の標準の厚み（BDM の SD.crosslane.h）

// 箱 1 つの読み取り。複数レーンの箱（fromLid がある物）は、BDM が描くたびに normalizeCrosslaneGeometry で作り直すのと同じに読む:
// 所属レーンは fromLid・流れの向きの位置は mainPos（なければ x か y）・流れの向きの大きさは thick（なければ 37）
function readBox(id, node, vertical) {
  const type = typeof node.type === 'string' ? node.type : '';
  const crosslane = CROSSLANE_TYPES.has(type) && node.fromLid !== undefined && node.fromLid !== null;
  const box = {
    id, node, type, text: cleanText(node.text), isStep: type !== GROUP_TYPE && type !== SUPPLEMENT_TYPE,
    x: finiteNumber(node.x, 0), y: finiteNumber(node.y, 0), w: finiteNumber(node.w, DEFAULT_BOX.w), h: finiteNumber(node.h, DEFAULT_BOX.h),
    laneId: idOf(crosslane ? node.fromLid : node.lid),
  };
  if (!crosslane) return box;
  const [start, length] = vertical ? ['y', 'h'] : ['x', 'w'];
  box[start] = finiteNumber(node.mainPos, box[start]);
  box[length] = node.thick > 0 && Number.isFinite(node.thick) ? node.thick : CROSSLANE_THICKNESS;
  return box;
}

// 箱の一覧 → Map(id → 箱)。箱として読めない物（形が違う・id がない・id が重なる 2 つ目）は読み込まない
function readBoxes(rawNodes, vertical, warnings) {
  const boxes = new Map();
  let skipped = 0;
  for (const node of rawNodes) {
    const id = isObject(node) ? idOf(node.id) : '';
    if (!id || boxes.has(id)) skipped += 1;
    else boxes.set(id, readBox(id, node, vertical));
  }
  if (skipped) warnings.push(`箱として読めない物が ${skipped} 個ありました（形が違う・id がない・id が重なる）。読み込みませんでした。`);
  return boxes;
}

// 作った矢印の本数（作業ごとの、入る数と出る数）。開始/終了の見分けに使う
function countDegrees(edges) {
  const degrees = new Map();
  const at = (key) => degrees.get(key) || degrees.set(key, { incoming: 0, outgoing: 0 }).get(key);
  for (const e of edges) {
    at(e.from).outgoing += 1;
    at(e.to).incoming += 1;
  }
  return degrees;
}

// 作業のメモ: 説明（説明有の箱の説明欄）・種類のメモ・またがるレーン・枠の名前・補足の順に、1 行ずつ
function memoOf(box, notes, ctx) {
  const lines = [];
  const description = cleanText(box.node.note);
  if (description) lines.push(`説明: ${description}`);
  lines.push(...notes);
  const span = CROSSLANE_TYPES.has(box.type) ? spanRoles(ctx.laneMap, box.node) : [];
  if (span.length > 1) lines.push(`またがるレーン: ${span.join('・')}`);
  const frames = groupNamesOf(box, ctx.groups);
  if (frames.length) lines.push(`枠: ${frames.join('・')}`);
  for (const text of ctx.supplementsOf.get(box.id) || []) lines.push(`補足: ${text}`);
  return lines.join('\n');
}

function makeStep(box, ctx) {
  const { kind, notes } = classifyBox(box, ctx.degrees.get(box.id) || { incoming: 0, outgoing: 0 });
  return {
    key: box.id,
    role: laneRoleOf(ctx.laneMap, box, ctx.vertical) || NO_LANE_ROLE,
    col: ctx.columns.get(box.id),
    kind,
    text: box.text,
    memo: memoOf(box, notes, ctx),
    src: { id: box.id, x: box.x, y: box.y, w: box.w, h: box.h },
  };
}

// 図の中身 → スイムレーン図の案。読めない図の種類は unsupported・中身が使えない形は read_failed
function bdmPlan(state) {
  if (!isObject(state) || !Array.isArray(state.nodes)) throw new MaterialError('read_failed', '図の中身に箱の一覧（nodes）がありません。');
  const info = diagramInfo(state.diagramType);
  const vertical = (state.orientation || 'vertical') === 'vertical'; // BDM の isV()
  const warnings = [];
  const boxes = readBoxes(state.nodes, vertical, warnings);
  const { edges, supplementsOf } = readEdges(state.edges, boxes, warnings);
  const stepBoxes = [...boxes.values()].filter((b) => b.isStep);
  const columns = assignColumns(stepBoxes.map((b) => (vertical
    ? { key: b.id, center: b.y + b.h / 2, length: b.h } : { key: b.id, center: b.x + b.w / 2, length: b.w })));
  const ctx = {
    vertical, columns, supplementsOf, degrees: countDegrees(edges), laneMap: createLaneMap(state.lanes, info.useLanes),
    groups: [...boxes.values()].filter((b) => b.type === GROUP_TYPE),
  };
  const steps = stepBoxes.map((box) => makeStep(box, ctx));
  if (!steps.length) warnings.push('図に工程がありません。');
  return {
    diagramType: info.key,
    diagramName: cleanText(state.diagramName),
    orientation: vertical ? 'vertical' : 'horizontal',
    roles: steps.some((s) => s.role === NO_LANE_ROLE) ? [...ctx.laneMap.roles, NO_LANE_ROLE] : ctx.laneMap.roles,
    steps, edges, warnings,
  };
}

const planFromHtml = (html) => bdmPlan(extractBdmState(html));
const bdmSummaryBlocks = (state) => summaryBlocksOf(bdmPlan(state));
const bdmBlocksFromHtml = (html) => bdmSummaryBlocks(extractBdmState(html));

module.exports = { bdmPlan, planFromHtml, bdmSummaryBlocks, bdmBlocksFromHtml, extractBdmState };
