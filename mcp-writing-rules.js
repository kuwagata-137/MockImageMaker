// mcp-writing-rules.js — 説明文ルールの「追加ルール」（v1.05 段階 E。質問 q179）
// 人が「ヘルプ > AI と連携…」のウィンドウで追加したルールを、<userData>/data/writing-rules.json に保存する。
// - アプリ（automation-main.js）: ウィンドウの入力欄に表示する・保存する
// - AI の入口（mcp-server.js）: read_guide の "writing" の最後に追加して返す（ファイルを直接読むので、アプリが動いていなくても返す）
// 画面設計のデータ（designs.json）とは別のファイルなので、出力した HTML には含まれず、「元に戻す」の履歴にも入らない。
'use strict';

const fs = require('fs');
const path = require('path');

const WRITING_RULES_FILE = 'writing-rules.json';
const MAX_RULES = 30; // 追加ルールの数の上限（Claude が決めた。手引きが長くなりすぎないように）
const MAX_RULE_CHARS = 100; // 追加ルール 1 項目の文字数の上限（Claude が決めた）

const rulesFile = (userData) => path.join(userData, 'data', WRITING_RULES_FILE);
const charCount = (s) => [...s].length;

// 入力欄の値（1 行に 1 項目）を、ルールの配列にする。空の行は除く。戻り値は { rules } か { error }
function parseWritingRules(text) {
  const rules = String(text == null ? '' : text).split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (rules.length > MAX_RULES) return { error: `追加ルールは ${MAX_RULES} 項目までです（今は ${rules.length} 項目）。` };
  const long = rules.findIndex((r) => charCount(r) > MAX_RULE_CHARS);
  if (long >= 0) return { error: `追加ルールは 1 項目 ${MAX_RULE_CHARS} 字までです（${long + 1} 項目めが ${charCount(rules[long])} 字）。` };
  return { rules };
}

// 保存してある追加ルール。ファイルがない・読めない・形が違うときは、空の配列
function readWritingRules(userData) {
  if (!userData) return [];
  try {
    const data = JSON.parse(fs.readFileSync(rulesFile(userData), 'utf8'));
    const rules = Array.isArray(data && data.rules) ? data.rules : [];
    return rules.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()).slice(0, MAX_RULES);
  } catch (_) {
    return [];
  }
}

// 入力欄の値を保存する。戻り値は { ok: true, rules } か { ok: false, error }
function saveWritingRules(userData, text) {
  const parsed = parseWritingRules(text);
  if (parsed.error) return { ok: false, error: parsed.error };
  try {
    const file = rulesFile(userData);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, rules: parsed.rules }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, rules: parsed.rules };
  } catch (e) {
    return { ok: false, error: `追加ルールを保存できませんでした（${(e && e.message) || e}）。` };
  }
}

// 手引き "writing" の最後に追加する節（追加ルールがないときは空文字列）
function writingRulesSection(rules) {
  if (!rules || !rules.length) return '';
  return '\n\n## 追加ルール（このアプリの利用者が追加したルール）\n'
    + '上のルールに加えて、次のルールも守ってください。上のルールと食い違うときは、追加ルールを優先します。\n'
    + rules.map((r) => `- ${r}`).join('\n');
}

module.exports = { WRITING_RULES_FILE, MAX_RULES, MAX_RULE_CHARS, parseWritingRules, readWritingRules, saveWritingRules, writingRulesSection };
