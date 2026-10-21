// bdm-state.js — ビジネスダイアグラムメーカー（BDM）の保存 HTML から、図の中身（JSON）を取り出す
// 役割:
//  - HTML の中の script は動かさない。印の所から JSON の文字を切り出して、JSON として読む
//  - 探す順は、BDM が起動するときの init()（参考/diagram_v8.31.html 2844-2847）と同じ
//    ① <script id="swimlane-state">window.__SWIMLANE_STATE__={…};</script>（保存 buildSaveHtml の形）
//    ② body の data-state 属性（URI 符号化）  ③ window.__SAVED_STATE__={…}
//    ①が読めなければ ② へ進む（BDM は script が動かなければ ① を使わず ② へ進むため）
//  - BDM のアプリのコード自体にも、同じ印の文字が出てくる（図の中身ではない）。取り違えない
//    ① は印の script の直後だけ・② は script とコメントの外の本物の body だけ・③ は右が { のものだけを見る
//  - Electron に触らない。node だけでテストできる
// JSON の切り出しは、BDM の「;</script>」を探す方法ではなく、JSON の文字列を数えて対の } まで読む
// （箱の文字に「;</script>」があっても、BDM の「<\/script>」でも、アプリの出力の「<」の escape でも切り出せる）。
'use strict';

const { MaterialError } = require('./material-error');

const NOT_FOUND = 'MultipurposeDiagramMaker で保存した図の中身が見つかりません。';
const BROKEN = '図の中身を読めません（保存した HTML が壊れているようです）。';
const NO_NODES = '図の中身に箱の一覧（nodes）がありません。';

// ① 印の script の直後（空白をはさんで window.__SWIMLANE_STATE__= に { が続く所）。match の終わりが { の位置
const STATE_SCRIPT = /<script\b[^>]*?\sid\s*=\s*["']swimlane-state["'][^>]*>\s*window\.__SWIMLANE_STATE__\s*=\s*(?=\{)/gi;
// ③ 右が { の代入だけ（アプリのコードの「if(window.__SAVED_STATE__)」や文字列への代入は除く）
const SAVED_STATE = /window\.__SAVED_STATE__\s*=\s*(?=\{)/g;
// script・style・コメントを飛ばして、最初の本物の <body …> を探す（括弧の中が属性）
const BODY_TAG = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<body\b([^>]*)>/gi;
const DATA_STATE = /\sdata-state\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

// text[start]（{）から、対になる } までの文字を返す。文字列（"…"）の中の { } は数えない。
// JSON の文字列の外に「<」は出ないので、あれば壊れているとみなし、先の script の終わりまで読み進めない。閉じていなければ null
function sliceJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i += 1; // バックスラッシュ: 次の 1 文字は文字列の一部
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123) depth += 1;
    else if (c === 125) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    } else if (c === 60) return null;
  }
  return null;
}

function bodyAttributes(html) {
  for (const m of html.matchAll(BODY_TAG)) if (m[1] !== undefined) return m[1];
  return null;
}

function decodeAttribute(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

// 印のある所の JSON の文字を、探す順に 1 つずつ返す（切り出せない・符号を戻せないものは null）
function* candidateJsons(html) {
  for (const m of html.matchAll(STATE_SCRIPT)) yield sliceJsonObject(html, m.index + m[0].length);
  const attrs = bodyAttributes(html);
  const dataState = attrs === null ? null : DATA_STATE.exec(attrs);
  if (dataState) yield decodeAttribute(dataState[1] !== undefined ? dataState[1] : dataState[2]);
  for (const m of html.matchAll(SAVED_STATE)) yield sliceJsonObject(html, m.index + m[0].length);
}

// JSON の文字を図の中身にする。{ state } か、使えない理由 { problem }
function parseState(json) {
  if (json === null) return { problem: BROKEN };
  let state;
  try {
    state = JSON.parse(json);
  } catch (_) {
    return { problem: BROKEN };
  }
  const isObject = state !== null && typeof state === 'object' && !Array.isArray(state);
  if (!isObject || !Array.isArray(state.nodes)) return { problem: NO_NODES };
  return { state };
}

// BDM の保存 HTML（文字）から図の中身を返す。見つからない・壊れている・nodes が配列でないときは MaterialError('read_failed')
function extractBdmState(html) {
  if (typeof html !== 'string') throw new MaterialError('read_failed', NOT_FOUND);
  let problem = null;
  for (const json of candidateJsons(html)) {
    const parsed = parseState(json);
    if (parsed.state) return parsed.state;
    problem = problem || parsed.problem;
  }
  throw new MaterialError('read_failed', problem || NOT_FOUND);
}

module.exports = { extractBdmState };
