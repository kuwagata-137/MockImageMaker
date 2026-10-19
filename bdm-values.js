// bdm-values.js — BDM の保存データ（JSON）の値の読み方（id・文字・形・数）
// 役割: BDM の箱・矢印・レーンの値は、手で作った・古い版の保存データでは型が揺れる（id が数・文字がない・位置が数でない）。
//  bdm-layout.js・bdm-edges.js・bdm-swimlane.js が同じ読み方で読むための小さな関数
// Electron に触らない。node だけでテストできる
'use strict';

// id は文字にそろえる（BDM の id は 'e12' の文字だが、手で作った状態では数のこともある）。ないときは ''
const idOf = (v) => (v === undefined || v === null ? '' : String(v));
// 文字: 文字以外は ''。改行は \n にそろえ、前後の空白を取る（途中の改行は残す）
const cleanText = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');
// 文字を 1 行にする（人と AI が読む文の中で使う）。長ければ max 字で切る
const oneLine = (v, max = Infinity) => {
  const line = cleanText(v).replace(/\s*\n\s*/g, ' ');
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finiteNumber = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

module.exports = { idOf, cleanText, oneLine, isObject, finiteNumber };
