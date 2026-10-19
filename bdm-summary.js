// bdm-summary.js — スイムレーン図の案（bdmPlan の返事）を、人と AI が読める短い行の文にして、塊（1 つ 3,000 字以内）の並びにする
// 役割:
//  - 図の種類・向き・レーンの一覧・箱（番号・種類・文字・レーン・列・メモ）・矢印（元 → 先・矢印の文字）・読み取りの注意（warnings）の順に書く
//  - 箱は、列・レーンの順に並べて #1 から番号を付ける。矢印は箱を番号と文字で指す（同じ文字の箱が 2 つあっても取り違えない）
//  - 列は 0 から数える（AI の道具 set_swimlane の col と同じ数え方）
// read_material の bdm の種類が使う。Electron に触らない。node だけでテストできる
'use strict';

const { diagramInfo } = require('./bdm-kinds');
const { oneLine } = require('./bdm-values');

const BLOCK_LIMIT = 3000; // 1 つの塊の字数（資料を読む部品の、1 つの塊の重みの上限と同じ）
const KIND_NAMES = Object.freeze({ start: '始まり', task: '作業', input: 'システムへの入力', decision: '判断', doc: '書類', end: '終わり' });
const ORIENTATION_TEXT = Object.freeze({
  vertical: '縦（レーンは左から右へ並び、流れは上から下へ進みます）',
  horizontal: '横（レーンは上から下へ並び、流れは左から右へ進みます）',
});

const quoted = (text) => `「${oneLine(text) || '（文字なし）'}」`;

// 箱を列・レーンの順に並べて、番号（1 から）を付ける。→ [{ step, number }]
function numberedSteps(plan) {
  const roleOrder = (step) => plan.roles.indexOf(step.role);
  return plan.steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.col - b.step.col || roleOrder(a.step) - roleOrder(b.step) || a.index - b.index)
    .map(({ step }, i) => ({ step, number: i + 1 }));
}

function boxLine({ step, number }) {
  const memo = step.memo ? ` メモ: ${step.memo.split('\n').map((l) => oneLine(l)).join('／')}` : '';
  return `#${number} ${KIND_NAMES[step.kind]}${quoted(step.text)} レーン: ${step.role} 列: ${step.col}${memo}`;
}

function summaryLines(plan) {
  const numbered = numberedSteps(plan);
  const byKey = new Map(numbered.map((n) => [n.step.key, n]));
  const ref = (key) => `#${byKey.get(key).number}${quoted(byKey.get(key).step.text)}`;
  const lines = [
    `ビジネスダイアグラムメーカーの図（${diagramInfo(plan.diagramType).name}）`,
    `図の名前: ${plan.diagramName || '（なし）'}`,
    `向き: ${ORIENTATION_TEXT[plan.orientation]}`,
    `レーン（役割）: ${plan.roles.join('・') || '（なし）'}`,
    `箱 ${plan.steps.length} 個・矢印 ${plan.edges.length} 本。列は 0 から数え、流れの進む向きの順です。`,
    '', '箱:', ...numbered.map(boxLine),
    '', '矢印:', ...(plan.edges.length ? plan.edges.map((e) => `${ref(e.from)}→ ${ref(e.to)}${e.label ? `（矢印の文字: ${oneLine(e.label)}）` : ''}`) : ['なし']),
  ];
  if (plan.warnings.length) lines.push('', '読み取りの注意:', ...plan.warnings.map((w) => `- ${w}`));
  return lines;
}

// limit 字を超える行だけ、limit 字ずつに分ける（超えない行・空行はそのまま）
function splitLong(line, limit) {
  const parts = [];
  for (let i = 0; i < line.length || i === 0; i += limit) parts.push(line.slice(i, i + limit));
  return parts;
}

// 行を、1 つが limit 字以内の塊にまとめる（行の途中では分けない。1 行が limit を超えるときだけ行を分ける）
function packLines(lines, limit) {
  const blocks = [];
  let current = '';
  for (const line of lines.flatMap((l) => splitLong(l, limit))) {
    if (current && current.length + 1 + line.length > limit) {
      blocks.push(current);
      current = line;
    } else current = current ? `${current}\n${line}` : line;
  }
  if (current) blocks.push(current);
  return blocks;
}

function summaryBlocksOf(plan) {
  return packLines(summaryLines(plan), BLOCK_LIMIT);
}

module.exports = { summaryBlocksOf };
