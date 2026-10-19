// bdm-kinds.js — BDM（ビジネスダイアグラムメーカー v8.31）の図の種類・箱の種類を、アプリのスイムレーン図の言葉に直す対応表
// 元: 参考/diagram_v8.31.html の DIAGRAM_TYPES（1251-1338）と SD（1341-1379）。BDM の箱の type のキーはそこにある名前のまま
// アプリの作業の種類（kind）: start 始まり・task 作業・input システムへの入力・decision 判断・doc 書類・end 終わり
// 対応: rect・note・step_num → task ／ sys_input・sys_input_desc → input ／ diamond・diamond_desc・gateway_xor・gateway_par → decision ／
//   doc・parallelogram → doc ／ crosslane・crosslane_sys_input → task・input（またがるレーンはメモ）／ terminal・event → 矢印と字・variant で決める ／
//   group_box・supplement → 作業にしない（bdm-swimlane.js がメモに足す）／ 知らない種類 → task（メモに元の種類）
// Electron に触らない。node だけでテストできる
'use strict';

const { MaterialError } = require('./material-error');

const NO_LANE_ROLE = '（レーンなし）';
const GROUP_TYPE = 'group_box';
const SUPPLEMENT_TYPE = 'supplement';
const CROSSLANE_TYPES = new Set(['crosslane', 'crosslane_sys_input']);

// 読める図: スイムレーン・フローチャート・BPMN（useLanes は DIAGRAM_TYPES の useLanes と同じ）
const READABLE_DIAGRAMS = Object.freeze({
  swimlane: { name: 'スイムレーン図', useLanes: true },
  flowchart: { name: 'フローチャート', useLanes: false },
  bpmn: { name: 'プロセスフロー (BPMN)', useLanes: true },
});
const UNREADABLE_DIAGRAM_NAMES = Object.freeze({
  statechart: '状態遷移図', er: 'ER図', orgchart: '樹状図', sequence: 'シーケンス図', gantt: 'ガントチャート', mindmap: 'マインドマップ', uml: 'UMLクラス図',
});

const KIND_OF_TYPE = Object.freeze({
  rect: 'task', note: 'task', step_num: 'task', crosslane: 'task',
  sys_input: 'input', sys_input_desc: 'input', crosslane_sys_input: 'input',
  diamond: 'decision', diamond_desc: 'decision', gateway_xor: 'decision', gateway_par: 'decision',
  doc: 'doc', parallelogram: 'doc',
});
const END_WORDS = /終|完了/;

// 図の種類（diagramType）が読めるか確かめて { key, name, useLanes } を返す。ない・空は BDM と同じにスイムレーン図。読めなければ unsupported
function diagramInfo(diagramType) {
  const key = diagramType === undefined || diagramType === null || diagramType === '' ? 'swimlane' : diagramType;
  if (typeof key === 'string' && Object.hasOwn(READABLE_DIAGRAMS, key)) return { key, ...READABLE_DIAGRAMS[key] };
  const known = typeof key === 'string' && Object.hasOwn(UNREADABLE_DIAGRAM_NAMES, key);
  const label = known ? UNREADABLE_DIAGRAM_NAMES[key] : (typeof key === 'string' ? key.slice(0, 40) : '不明');
  throw new MaterialError('unsupported', `この図の種類は読めません（${label}）。スイムレーン図・フローチャート・BPMN だけ読めます。`);
}

// 開始/終了の箱: 入る矢印がなければ start・出る矢印がなければ end。決まらないとき（両方ある・どちらもない）は「終」「完了」の字があれば end。
// ピル型のステップ（flowKind が pill）は番号付きの作業
function terminalKind(box, degree) {
  if (box.node.flowKind === 'pill') return 'task';
  if (degree.incoming === 0 && degree.outgoing > 0) return 'start';
  if (degree.outgoing === 0 && degree.incoming > 0) return 'end';
  return END_WORDS.test(box.text) ? 'end' : 'start';
}

// イベント（BPMN）: variant が end なら end・start かなしなら start・mid は作業（メモに中間イベント）
function eventKind(box) {
  const variant = box.node.variant;
  if (variant === 'mid') return { kind: 'task', notes: ['中間イベント'] };
  return { kind: variant === 'end' ? 'end' : 'start', notes: [] };
}

// 作業にする箱（group_box・supplement 以外）の { kind, notes }。notes は作業のメモに足す文。degree は { incoming, outgoing }（作った矢印の数）
function classifyBox(box, degree) {
  if (box.type === 'terminal') return { kind: terminalKind(box, degree), notes: [] };
  if (box.type === 'event') return eventKind(box);
  if (Object.hasOwn(KIND_OF_TYPE, box.type)) return { kind: KIND_OF_TYPE[box.type], notes: box.type === 'gateway_par' ? ['並行'] : [] };
  return { kind: 'task', notes: [`元の種類: ${box.type || '（不明）'}`] };
}

module.exports = { NO_LANE_ROLE, GROUP_TYPE, SUPPLEMENT_TYPE, CROSSLANE_TYPES, diagramInfo, classifyBox };
