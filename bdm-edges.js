// bdm-edges.js — BDM の矢印を、アプリのスイムレーン図の矢印（作業から作業へ）にする
// 役割:
//  - 矢印の文字は label → fromLabel → toLabel の順に、最初にある物
//  - 外す矢印（warnings に書く）: つなぐ箱がない・自分への矢印・同じ向きの 2 本目（1 本目を残す）・
//    箱にしなかった物（グループ枠・補足情報）につながる矢印
//  - 補足情報は作業にしない。矢印でつながる作業のメモに文字を足すので、その対応（作業の id → 補足の文字の並び）も作る
// Electron に触らない。node だけでテストできる
'use strict';

const { GROUP_TYPE, SUPPLEMENT_TYPE } = require('./bdm-kinds');
const { idOf, cleanText, oneLine, isObject } = require('./bdm-values');

const NAME_LENGTH = 20; // warnings に入れる箱の文字の長さ（これより長ければ切る）

const nameOf = (box) => oneLine(box && box.text, NAME_LENGTH) || '（文字なし）';
const arrowName = (from, to) => `矢印「${nameOf(from)}」→「${nameOf(to)}」`;

function labelOf(edge) {
  for (const key of ['label', 'fromLabel', 'toLabel']) {
    const text = cleanText(edge[key]);
    if (text) return text;
  }
  return '';
}

// 箱にしなかった物につながる矢印を外す。補足情報なら、つながる作業を attached（補足の id → 作業の id の並び）に控える
function dropAtNonStep(from, to, attached, warnings) {
  const frame = from.type === GROUP_TYPE || to.type === GROUP_TYPE;
  const supplement = from.type === SUPPLEMENT_TYPE ? from : to.type === SUPPLEMENT_TYPE ? to : null;
  const step = [from, to].find((b) => b.isStep);
  if (supplement && step && !frame) {
    attached.get(supplement.id).push(step.id);
    const note = supplement.text ? '（補足の文字は、接続している工程のメモに入れました）' : '';
    warnings.push(`${arrowName(from, to)}は、補足情報に接続しているため外しました${note}。`);
    return;
  }
  warnings.push(`${arrowName(from, to)}は、${frame ? 'MPD のグループ枠' : '補足情報'}に接続しているため外しました。`);
}

// 矢印を読む。boxes は Map(箱の id → 箱)。→ { edges: [{ from, to, label }], supplementsOf: Map(作業の id → [補足の文字…]) }
function readEdges(rawEdges, boxes, warnings) {
  const edges = [];
  const seen = new Set();
  const attached = new Map([...boxes.values()].filter((b) => b.type === SUPPLEMENT_TYPE).map((b) => [b.id, []]));
  for (const raw of Array.isArray(rawEdges) ? rawEdges.filter(isObject) : []) {
    const from = boxes.get(idOf(raw.from));
    const to = boxes.get(idOf(raw.to));
    if (!from || !to) {
      warnings.push(`矢印（${oneLine(idOf(raw.from), NAME_LENGTH) || '？'} → ${oneLine(idOf(raw.to), NAME_LENGTH) || '？'}）は、接続するシェイプが見つからないため外しました。`);
    } else if (!from.isStep || !to.isStep) dropAtNonStep(from, to, attached, warnings);
    else if (from === to) warnings.push(`${arrowName(from, to)}は、自分自身へ戻る矢印のため外しました。`);
    else if (seen.has(`${from.id}\n${to.id}`)) warnings.push(`${arrowName(from, to)}は、同じ向きの 2 本目のため外しました（1 本目を残しました）。`);
    else {
      seen.add(`${from.id}\n${to.id}`);
      edges.push({ from: from.id, to: to.id, label: labelOf(raw) });
    }
  }
  return { edges, supplementsOf: supplementTexts(boxes, attached, warnings) };
}

// 作業ごとの補足の文字の並び（補足情報の箱の並びの順）。どの作業ともつながらない補足情報は入れず、warnings に書く
function supplementTexts(boxes, attached, warnings) {
  const supplementsOf = new Map();
  for (const box of boxes.values()) {
    if (box.type !== SUPPLEMENT_TYPE) continue;
    const stepIds = [...new Set(attached.get(box.id))];
    if (!stepIds.length || !box.text) {
      warnings.push(`補足情報「${nameOf(box)}」は、矢印で接続している工程がない（または文字がない）ため、取り込みませんでした。`);
      continue;
    }
    for (const id of stepIds) supplementsOf.set(id, [...(supplementsOf.get(id) || []), box.text]);
  }
  return supplementsOf;
}

module.exports = { readEdges, labelOf };
