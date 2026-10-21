// bdm-place.js — MPD へ出力するスイムレーン図の、箱の位置とレーンの幅を決める（第 11 段階）
// 位置は「流れの向き（main）」と「交差の向き（cross）」で決める。縦の図は main が y・cross が x、横の図はその逆（x・y への写しは bdm-compose.js）。
// 寸法は MultipurposeDiagramMaker の整列 laneFlowLayout（参考/diagram_v8.31.html 17209〜）と同じ:
//  - 最初の列（段）の中心は、見出しの帯 44 ＋ 格子 80。次の列は、前の列の箱の端との間が 24 以上になるよう、格子 80 の倍数だけ離す
//  - 同じレーンの同じ列の箱は、1 個はレーンの真ん中、2・3 個は 25/50/75%（入らなければ、端から 10・間を等分）。間は 24 以上
// 元の MPD の箱の位置を使う箱（reuse がある箱）は、列ごとに同じだけずらし（列の中のずれは保つ）、交差の向きはレーンの中の割合で写す。
// 読み直したとき（bdm-layout.js の assignColumns）に同じ列の並びになるよう、列の最初の箱の中心から、ほかの箱の中心が前に出ないようにする。
// Electron に触らない。node だけでテストできる
'use strict';

const HEADER = 44; // MultipurposeDiagramMaker の見出しの帯（headerSize）
const GRID = 80; // MultipurposeDiagramMaker の格子（GRID_STEP）
const ROW_GAP = 24; // 列どうしの最小の隙間（LAYOUT_MIN_ROW_GAP）
const SIDE_GAP = 24; // 同じレーンの同じ列の箱どうしの最小の隙間（LAYOUT_MIN_SIDE_GAP）
const INSET = 10; // レーンの端から離す（LAYOUT_LANE_INSET）
const EDGE = 4; // 箱をレーンの端・見出しの帯から離す最小（MultipurposeDiagramMaker の addNode と同じ）

// 列の番号（アプリの列。空きがある）→ 0 から詰めた番号
function columnRanks(items) {
  const cols = [...new Set(items.map((it) => it.col))].sort((a, b) => a - b);
  return new Map(cols.map((c, i) => [c, i]));
}

// 列ごとの中心 c[k] と、箱ごとの中心のずれ d（元の位置を使う箱の、列の最初の箱からのずれ。ほかは 0）
function placeColumns(items, rankOf) {
  const columns = [];
  items.forEach((it, i) => {
    const k = rankOf.get(it.col);
    (columns[k] = columns[k] || []).push(i);
  });
  const offset = new Array(items.length).fill(0);
  const centers = [];
  let prevDown = 0;
  columns.forEach((members, k) => {
    const reused = members.filter((i) => items[i].reuse);
    const origin = reused.length ? Math.min(...reused.map((i) => items[i].reuse.mainCenter)) : null;
    for (const i of reused) offset[i] = items[i].reuse.mainCenter - origin;
    const up = Math.max(...members.map((i) => items[i].main / 2 - offset[i]));
    const down = Math.max(...members.map((i) => offset[i] + items[i].main / 2));
    let c;
    if (k === 0) c = Math.max(origin === null ? HEADER + GRID : origin, HEADER + EDGE + up);
    else if (origin === null) c = centers[k - 1] + Math.ceil((prevDown + up + ROW_GAP) / GRID) * GRID;
    else c = Math.max(origin, centers[k - 1] + prevDown + up + ROW_GAP);
    centers.push(c);
    prevDown = down;
  });
  return items.map((it, i) => Math.round(centers[rankOf.get(it.col)] + offset[i] - it.main / 2));
}

// レーン × 列の枠ごとの箱の並び（箱の並びの順）
function cellsOf(items, rankOf) {
  const cells = new Map();
  items.forEach((it, i) => {
    const key = `${it.lane}|${rankOf.get(it.col)}`;
    if (!cells.has(key)) cells.set(key, { lane: it.lane, members: [] });
    cells.get(key).members.push(i);
  });
  return [...cells.values()];
}

// 枠の箱がどれも元の位置を使う（レーンの中の割合で写す）か
const keepsRatio = (cell, items) => cell.members.every((i) => items[i].reuse && Number.isFinite(items[i].reuse.crossRatio));

// 並べて置くのに要るレーンの幅（端 10 ×2 ＋ 箱の大きさの合計 ＋ 間 24）
const spreadNeed = (cell, items) => INSET * 2 + cell.members.reduce((s, i) => s + items[i].cross, 0) + SIDE_GAP * (cell.members.length - 1);

// レーンの中の、並べて置く箱の中心の並び（MultipurposeDiagramMaker の laneFlowLayout と同じ）
function spreadCenters(sizes, start, width) {
  const k = sizes.length;
  const fixed = k === 1 ? [0.5] : k === 2 ? [0.25, 0.75] : k === 3 ? [0.25, 0.5, 0.75] : null;
  if (fixed) {
    const cs = fixed.map((f) => start + width * f);
    const fits = cs.every((c, i) => c - sizes[i] / 2 >= start + INSET && c + sizes[i] / 2 <= start + width - INSET
      && (i === 0 || (c - sizes[i] / 2) - (cs[i - 1] + sizes[i - 1] / 2) >= SIDE_GAP));
    if (fits) return cs;
  }
  const total = sizes.reduce((s, v) => s + v, 0);
  const inner = k > 1 ? (width - INSET * 2 - total) / (k - 1) : 0;
  let p = k > 1 ? start + INSET : start + (width - total) / 2;
  return sizes.map((v) => {
    const c = p + v / 2;
    p += v + inner;
    return c;
  });
}

// items: [{ lane（レーンの番号）, col（アプリの列）, main・cross（箱の流れの向き・交差の向きの大きさ）,
//           reuse（元の位置を使うときだけ { mainCenter（元の流れの向きの中心）, crossRatio（元のレーンの中の、交差の向きの中心の割合）}）}]
// laneSizes: レーンの今の幅（元の MPD のレーンを使い回すときはその幅、新しいレーンは 220）。広げるだけで狭めない
// → { mains: [流れの向きの始まり], crosses: [交差の向きの始まり], laneSizes: [レーンの幅] }（どれも items の順）
function placeBoxes({ items, laneSizes }) {
  const rankOf = columnRanks(items);
  const mains = placeColumns(items, rankOf);
  const cells = cellsOf(items, rankOf);
  const sizes = laneSizes.slice();
  for (const cell of cells) if (!keepsRatio(cell, items)) sizes[cell.lane] = Math.max(sizes[cell.lane], spreadNeed(cell, items));
  const starts = [];
  sizes.reduce((at, w, i) => { starts[i] = at; return at + w; }, 0);
  const crosses = new Array(items.length).fill(0);
  for (const cell of cells) {
    const start = starts[cell.lane];
    const width = sizes[cell.lane];
    // 元の位置を使う枠は、割合で写すだけ（端へ寄せない。書類の箱などは、MultipurposeDiagramMaker でもレーンの境に重ねて置ける。レーンは広げるだけなので、元のはみ出し方より外へは出ない）
    if (keepsRatio(cell, items)) {
      for (const i of cell.members) crosses[i] = Math.round(start + items[i].reuse.crossRatio * width - items[i].cross / 2);
      continue;
    }
    const centers = spreadCenters(cell.members.map((i) => items[i].cross), start, width);
    cell.members.forEach((i, n) => {
      const lo = start + EDGE;
      const hi = start + width - items[i].cross - EDGE;
      crosses[i] = Math.round(Math.max(lo, Math.min(hi, centers[n] - items[i].cross / 2)));
    });
  }
  return { mains, crosses, laneSizes: sizes };
}

module.exports = { placeBoxes, HEADER, GRID };
