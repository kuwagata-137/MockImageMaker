// bdm-layout.js — BDM の図の中の位置から、レーン（役割）・列・グループ枠を決める
// 役割:
//  - レーン: 箱の lid が一覧にあればそのレーン。なければ（lid が空・一覧にない・'__virtual__'）、箱の中心の位置でレーンを決める（BDM の nodeLaneIdx・laneAt と同じ考え）
//    縦の図はレーンが縦の列（x が交差する向き・w がレーンの幅）、横の図はレーンが横の行（y が交差する向き・w が高さ）
//  - 同じ名前のレーンは 1 つの役割にまとめる
//  - 列: 流れの進む向き（縦の図は y・横の図は x）の、箱の中心の位置の順。前の列との違いが、箱の流れの向きの大きさの半分以内なら同じ列
// Electron に触らない。node だけでテストできる
'use strict';

const { idOf, cleanText, isObject } = require('./bdm-values');

const DEFAULT_LANE_SIZE = 220; // BDM の LANE_W（レーンの幅が数でないとき）
const EPSILON = 1e-9;

// レーンの一覧 → { roles: [役割の名前…], list: [{ id, role, start, end }…] }。useLanes が false（フローチャート）なら空
function createLaneMap(rawLanes, useLanes) {
  const roles = [];
  const list = [];
  let start = 0;
  for (const lane of useLanes && Array.isArray(rawLanes) ? rawLanes.filter(isObject) : []) {
    const role = cleanText(lane.name) || '名前なし';
    if (!roles.includes(role)) roles.push(role);
    const size = Number.isFinite(lane.w) && lane.w > 0 ? lane.w : DEFAULT_LANE_SIZE;
    list.push({ id: idOf(lane.id), role, start, end: start + size });
    start += size;
  }
  return { roles, list };
}

// 交差する向きの位置にあるレーン。外れたら端のレーン（BDM の laneAt と同じ）
function laneAt(list, cross) {
  const found = list.find((lane) => cross >= lane.start && cross < lane.end);
  return found || (cross < 0 ? list[0] : list[list.length - 1]);
}

// 箱のレーンの役割の名前。lid が一覧にあればそのレーン。ないとき（lid が空・一覧にない・'__virtual__'）は、箱の中心の位置のレーン
// （BDM の nodeLaneIdx と同じ。'__virtual__' は BDM がレーンのある図でもフリー配置の箱〔step_num など〕に付ける lid で、BDM はそれも位置のレーンに描く）。
// レーンなし（null）になるのは、レーンの一覧が空（フローチャートなどレーンを使わない図を含む）のときだけ
function laneRoleOf(laneMap, box, vertical) {
  const lane = laneOf(laneMap, box, vertical);
  return lane ? lane.role : null;
}

// 箱のレーン { id, role, start, end }（決め方は laneRoleOf と同じ。レーンの一覧が空なら null）。MPD へ出力するとき、元の位置を使うかの判定に使う（第 11 段階）
function laneOf(laneMap, box, vertical) {
  if (!laneMap.list.length) return null;
  const byId = box.laneId ? laneMap.list.find((lane) => lane.id === box.laneId) : null;
  return byId || laneAt(laneMap.list, vertical ? box.x + box.w / 2 : box.y + box.h / 2);
}

// 複数レーンの箱がまたがるレーンの役割の名前（fromLid から toLid まで・レーンの並びの順・同じ名前は 1 つ）
function spanRoles(laneMap, node) {
  const index = (lid) => laneMap.list.findIndex((lane) => lane.id === idOf(lid));
  const from = index(node.fromLid);
  const to = index(node.toLid);
  if (from < 0 || to < 0) return [];
  const roles = laneMap.list.slice(Math.min(from, to), Math.max(from, to) + 1).map((lane) => lane.role);
  return roles.filter((role, i) => roles.indexOf(role) === i);
}

// 中心の位置の順に 0 から列の番号を付ける。items: [{ key, center, length }]（length は流れの向きの箱の大きさ）。→ Map(key → 列)
// 同じ列の基準は、その列の最初の箱の中心（1 つずつずれていっても、続けて同じ列にはしない）
function assignColumns(items) {
  const columns = new Map();
  let column = -1;
  let reference = 0;
  const sorted = items.map((item, order) => ({ ...item, order })).sort((a, b) => a.center - b.center || a.order - b.order);
  for (const item of sorted) {
    if (column < 0 || item.center - reference > item.length / 2 + EPSILON) {
      column += 1;
      reference = item.center;
    }
    columns.set(item.key, column);
  }
  return columns;
}

// 箱の中心を含むグループ枠の名前（大きい枠＝外の枠から順）
function groupNamesOf(box, groups) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return groups
    .filter((g) => g.text && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .map((g) => g.text);
}

module.exports = { createLaneMap, laneRoleOf, laneOf, spanRoles, assignColumns, groupNamesOf, DEFAULT_LANE_SIZE };
