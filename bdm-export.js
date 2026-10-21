// bdm-export.js — システムのスイムレーン図を、元にする MPD（MultipurposeDiagramMaker で保存した HTML）の埋め込みに入れた HTML を作る（第 11 段階。設計書 11-3）
// 流れ: 渡す形を確かめる → 元の図の中身を取り出す（bdm-state.js）→ 元の図を読む（bdmPlan。元の位置を使うかの判定）→ 組む（bdm-compose.js）→
//       差し替える（bdm-inject.js）→ 出力した HTML を読み直して（planFromHtml）、渡した形と比べる（食い違いは warnings。始まり・終わりの読み違いなど）
// 人の「MPD に出力…」（main の IPC）と AI の export_bdm（automation-render.js）が同じ関数を使う。元のファイルは書き換えない（文字を返すだけ）。
// Electron に触らない。node だけでテストできる
'use strict';

const { MaterialError } = require('./material-error');
const { extractBdmState } = require('./bdm-state');
const { injectBdmState } = require('./bdm-inject');
const { composeBdmState, TYPE_OF_KIND } = require('./bdm-compose');
const { bdmPlan, planFromHtml } = require('./bdm-swimlane');
const { cleanText, isObject } = require('./bdm-values');

const BAD_PLAN = 'スイムレーン図の形が正しくありません。';
const NO_STEPS = 'スイムレーン図に作業がないので、MPD に出力しません。';
const KIND_NAMES = Object.freeze({ start: '始まり', task: '作業', input: 'システムへの入力', decision: '判断', doc: '書類', end: '終わり' });
const isCol = (v) => Number.isSafeInteger(v) && v >= 0;
const bad = (message = BAD_PLAN) => new MaterialError('bad_request', message);

// 渡す形を確かめて、使う形にする（ページから来るので、形が違えば bad_request）。矢印は、両端の作業がない・自分への・同じ向きの 2 本目を外す
function readExportPlan(plan) {
  if (!isObject(plan) || !Array.isArray(plan.lanes) || !Array.isArray(plan.steps) || !Array.isArray(plan.edges)) throw bad();
  if (!plan.lanes.every((n) => typeof n === 'string')) throw bad();
  const keys = new Set();
  const steps = plan.steps.map((s) => {
    const ok = isObject(s) && typeof s.key === 'string' && s.key && !keys.has(s.key) && Number.isSafeInteger(s.lane) && s.lane >= 0 && s.lane < plan.lanes.length
      && isCol(s.col) && Object.hasOwn(TYPE_OF_KIND, s.kind) && typeof s.text === 'string' && (s.box == null || typeof s.box === 'string');
    if (!ok) throw bad();
    keys.add(s.key);
    return { key: s.key, lane: s.lane, col: s.col, kind: s.kind, text: s.text, box: s.box || null };
  });
  if (!steps.length) throw bad(NO_STEPS);
  const pairs = new Set();
  const edges = plan.edges.filter((e) => isObject(e) && keys.has(e.from) && keys.has(e.to) && e.from !== e.to)
    .filter((e) => !pairs.has(`${e.from}\n${e.to}`) && pairs.add(`${e.from}\n${e.to}`))
    .map((e) => ({ from: e.from, to: e.to, label: typeof e.label === 'string' ? e.label : '' }));
  return { name: typeof plan.name === 'string' ? cleanText(plan.name) : '', lanes: plan.lanes.slice(), steps, edges };
}

// 元の図の読み取り（元の位置を使うかの判定に使う）。読めない図の種類（ER 図など）は null（位置を使い回さない）
function readOriginal(state) {
  try {
    return bdmPlan(state);
  } catch (err) {
    if (err instanceof MaterialError && err.code === 'unsupported') return null;
    throw err;
  }
}

const quoted = (text) => `「${cleanText(text).replace(/\s*\n\s*/g, ' ') || '（文字なし）'}」`;

// 出力した HTML を読み直した案と、渡した形を比べる。食い違いの文の並び
function compareReadBack(read, plan, idOfKey) {
  const warnings = [];
  const roles = plan.lanes.map(cleanText); // 同じ名前の役割が 2 つあると、読み直しでは 1 つにまとまるので、食い違いとして知らせる
  if (JSON.stringify(read.roles) !== JSON.stringify(roles)) warnings.push(`MPD で読み直すと、役割の並びが「${read.roles.join('・')}」になります。`);
  const ranks = new Map([...new Set(plan.steps.map((s) => s.col))].sort((a, b) => a - b).map((c, i) => [c, i]));
  const readById = new Map(read.steps.map((s) => [s.key, s]));
  for (const s of plan.steps) {
    const r = readById.get(idOfKey.get(s.key));
    const name = `作業${quoted(s.text)}`;
    if (!r) warnings.push(`${name}は、MPD で読み直すと見つかりません。`);
    else if (r.kind !== s.kind) warnings.push(`${name}は、MPD で読み直すと種類が「${KIND_NAMES[r.kind]}」になります（アプリでは「${KIND_NAMES[s.kind]}」）。`);
    else if (r.role !== cleanText(plan.lanes[s.lane]) || r.col !== ranks.get(s.col) || r.text !== cleanText(s.text)) warnings.push(`${name}は、MPD で読み直すと役割・列・文字のどれかが違います。`);
  }
  const edgeKey = (from, to, label) => `${from}\n${to}\n${cleanText(label)}`;
  const want = new Set(plan.edges.map((e) => edgeKey(idOfKey.get(e.from), idOfKey.get(e.to), e.label)));
  const got = new Set(read.edges.map((e) => edgeKey(e.from, e.to, e.label)));
  const differ = [...want].filter((k) => !got.has(k)).length + [...got].filter((k) => !want.has(k)).length;
  if (differ) warnings.push(`MPD で読み直すと、矢印が ${differ} 本違います。`);
  return warnings;
}

// html: 元にする MPD の文字・plan: 渡す形 → { html（出力する文字）, warnings, counts: { lanes, steps, edges } }
// 図の中身がない（保存していない MultipurposeDiagramMaker の本体など）・壊れている → read_failed、渡す形が違う・作業がない → bad_request
function exportBdmHtml(html, plan) {
  const input = readExportPlan(plan);
  const original = extractBdmState(html);
  const { state, idOfKey } = composeBdmState(original, input, readOriginal(original));
  const out = injectBdmState(html, state);
  const warnings = compareReadBack(planFromHtml(out), input, idOfKey);
  return { html: out, warnings, counts: { lanes: state.lanes.length, steps: state.nodes.length, edges: state.edges.length } };
}

module.exports = { exportBdmHtml, readExportPlan };
