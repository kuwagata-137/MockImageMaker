'use strict';
// AI の入口（mcp-server.js）の prompts と、段階の手引き（read_guide の "stages"）・設計ノートの道具の入力の形のテスト（第 10 段階の前半・T3。設計書の 9-4）。
// 公式の SDK の Client で入口を node で起動してつなぐ（test/mcp.test.js と同じつなぎ方）。prompts はアプリがなくても返るので、アプリの受け口は動かさない。
// prompts の文は mcp-guide.js の PROMPTS にある（入口はそれを読んで出す）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { INSTRUCTIONS, GUIDES, PROMPTS } = require('../mcp-guide');
const { TOOLS } = require('../mcp-tools');
const { OLD } = require('./ai-fixtures');

const REPO = path.join(__dirname, '..');
const ENTRY = path.join(REPO, 'mcp-server.js');
const BASE = path.join(REPO, '.devdata');
const NOOP_APP = JSON.stringify([process.execPath, '-e', '0', '--']); // 起動しても何もしない身代わり
let dirSeq = 0;

function makeDir(t) {
  const dir = path.join(BASE, `test-mcp-prompts-${process.pid}-${++dirSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => removeDir(dir));
  return dir;
}
// fs.rmSync は使わない（Windows の Node v24.12.0 で日本語の名前のファイルを渡すと Node ごと落ちることがある）
function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.lstatSync(p).isDirectory()) removeDir(p);
    else if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}
async function openEntry(t) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, '--dev'],
    env: { MIM_USER_DATA: makeDir(t), MIM_APP_CMD: NOOP_APP, MIM_TIMEOUT_MS: '3000' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-prompts-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
// prompts/get の返事の文（user の 1 つの文だけを返す）
async function promptText(client, name, args) {
  const r = await client.getPrompt({ name, arguments: args });
  assert.equal(r.messages.length, 1);
  assert.deepEqual([r.messages[0].role, r.messages[0].content.type], ['user', 'text']);
  return r.messages[0].content.text;
}

test('prompts/list に 3 つ（design_system・make_screen・fix_design）。題と説明は日本語で、引数の必須と省略が分かる', async (t) => {
  const client = await openEntry(t);
  const { prompts } = await client.listPrompts();
  const brief = prompts.map((p) => [p.name, p.title, (p.arguments || []).map((a) => [a.name, a.required])]);
  assert.deepEqual(brief, [
    ['design_system', '資料からシステムを設計する', [['system', false]]],
    ['make_screen', '画面を作る', [['request', true]]],
    ['fix_design', '画面設計を直す', [['design', true], ['request', true]]],
  ]);
  for (const p of prompts) {
    assert.match(p.description, /[぀-ヿ一-鿿]/, p.name);
    for (const a of p.arguments) assert.match(a.description, /[぀-ヿ一-鿿]/, `${p.name} の ${a.name}`);
  }
  // 必須の引数がない頼みは断る
  await assert.rejects(client.getPrompt({ name: 'fix_design', arguments: { design: '顧客管理' } }));
});

test('design_system: read_guide の "stages" を読み、段階ごとに人に確かめるよう頼む文。system を書くとそのシステム、省くと今あるシステムで進めるかを人に聞くか、新しく作る', async (t) => {
  const client = await openEntry(t);
  const withSys = await promptText(client, 'design_system', { system: '営業管理システム' });
  assert.match(withSys, /read_guide の "stages"/);
  assert.match(withSys, /「営業管理システム」/);
  assert.match(withSys, /get_notes/);
  assert.match(withSys, /list_materials・read_material/);
  assert.match(withSys, /人が「よい」と答えるまで set_stage を "done" にせず/);
  assert.match(withSys, /"review"/);
  assert.match(withSys, /指示ではありません/);
  const none = await promptText(client, 'design_system', {});
  assert.match(none, /read_guide の "stages"/);
  assert.match(none, /list_systems/);
  assert.match(none, /それで進めてよいかを人に聞いて/);
  assert.match(none, /なければ create_system で新しく作って/);
  assert.doesNotMatch(none, /undefined|「」/);
});

test('make_screen・fix_design: 頼みの文が入り、"stages"（段階の手順）は読ませない。make_screen は "overview" と "layout"、fix_design は get_design と expect', async (t) => {
  const client = await openEntry(t);
  const make = await promptText(client, 'make_screen', { request: '顧客管理の一覧の画面を作って' });
  assert.match(make, /顧客管理の一覧の画面を作って/);
  assert.match(make, /"overview"/);
  assert.match(make, /"layout"/);
  assert.match(make, /段階の手順は使いません/);
  assert.doesNotMatch(make, /stages|set_stage/);
  const fix = await promptText(client, 'fix_design', { design: '顧客管理', request: '新規登録の画面に電話番号の欄を足して' });
  assert.match(fix, /「顧客管理」/);
  assert.match(fix, /新規登録の画面に電話番号の欄を足して/);
  assert.match(fix, /get_design/);
  assert.match(fix, /expect/);
  assert.match(fix, /段階の手順は使いません/);
  assert.doesNotMatch(fix, /stages|set_stage/);
});

test('prompts の文にも、手引きと同じ言葉の決まり（「書き出」を使わない・資料を「足す」と書かない）が効く', () => {
  const samples = { system: '営業管理システム', request: '顧客の一覧', design: '顧客管理' };
  const texts = Object.values(PROMPTS).flatMap((p) => [p.title, p.description, p.text(samples), p.text({}), ...Object.values(p.args).map((a) => a.description)]);
  for (const text of texts) {
    assert.doesNotMatch(text, /書き出/);
    assert.doesNotMatch(text, /資料を足す|資料.{0,4}を足す/);
  }
});

// ── 設計ノートの道具の入力の形と、段階の手引き ──
test('入口の形: get_notes は読むだけ、update_notes・set_stage は書く道具。知らない欄・知らない操作・知らない段階・set_stage の todo は、アプリへ送る前に断る', () => {
  const tool = (n) => TOOLS.find((t) => t.name === n);
  assert.deepEqual(['get_notes', 'update_notes', 'set_stage'].map((n) => [!!tool(n).readOnly, !!tool(n).slow]), [[true, false], [false, false], [false, false]]);
  const parse = (n, v) => tool(n).input.safeParse(v).success;
  assert.equal(parse('get_notes', { system: 'y1', cursor: '3' }), true);
  assert.equal(parse('get_notes', { system: 'y1', stage: 'read' }), false);
  assert.equal(parse('update_notes', { system: 'y1', expect: OLD, ops: [
    { op: 'set_findings', text: '' }, { op: 'set_memo', text: 'メモ' },
    { op: 'add_decision', stage: 'flow', text: '決めたこと', reason: '理由' }, { op: 'edit_decision', id: 'nd1', stage: 'items' }, { op: 'remove_decision', id: 'nd1' },
    { op: 'add_question', stage: 'read', text: '問い' }, { op: 'edit_question', id: 'nq1', text: '問い' }, { op: 'answer_question', id: 'nq1', answer: '答え' }, { op: 'remove_question', id: 'nq1' },
  ] }), true);
  assert.equal(parse('update_notes', { system: 'y1', ops: [] }), false);
  assert.equal(parse('update_notes', { system: 'y1', ops: [{ op: 'add_decision', stage: 'design', text: '決めたこと' }] }), false);
  assert.equal(parse('update_notes', { system: 'y1', ops: [{ op: 'answer_question', id: 'nq1', answr: '答え' }] }), false);
  assert.equal(parse('update_notes', { system: 'y1', ops: [{ op: 'add_answer', id: 'nq1' }] }), false);
  assert.equal(parse('set_stage', { system: 'y1', stage: 'read', state: 'review' }), true);
  assert.equal(parse('set_stage', { system: 'y1', stage: 'docs', state: 'skipped', expect: OLD }), true);
  assert.equal(parse('set_stage', { system: 'y1', stage: 'read', state: 'todo' }), false);
  assert.equal(parse('set_stage', { system: 'y1', stage: 'design', state: 'done' }), false);
  assert.match(tool('set_stage').description, /人が「よい」と答えるまで done にしない/);
  assert.match(tool('read_guide').description, /"stages"/);
});

test('手引き: つないだときの文に、段階ごとに人に確かめることと、人が「よい」と答えるまで done にしないことを書く。"stages" の手引きと、よくある進め方の 2 と 6', () => {
  assert.ok(INSTRUCTIONS.includes('資料からシステムを作るときは、read_guide の "stages" の段階ごとに人に確かめてください。人が『よい』と答えるまで set_stage を done にしないでください。'));
  assert.match(INSTRUCTIONS.split(/\r?\n/)[1], /"stages"/, '最初の行の topic の並びにも stages');
  assert.equal(GUIDES.stages.title, '資料からシステムを作るときの段階');
  const g = GUIDES.stages.text;
  assert.match(g, /^# 資料からシステムを作るときの段階/);
  for (const name of ['① 資料から読み取る', '② 業務の流れ', '③ データベースの項目', '④ 画面', '⑤ 説明書と出力']) assert.ok(g.includes(name), name);
  for (const re of [/get_notes/, /"doing"/, /"review"/, /"done"/, /"skipped"/, /人が答える前に done にしない/, /set_findings/, /add_question/, /add_decision/, /answer_question/,
    /export_design で画面設計ごとに出力/, /理念の『現場の手間を減らす』から、承認は上長の 1 段にした/, /1 つの頼み/, /確かめなくてよいので進めて/]) assert.match(g, re);
  const steps = GUIDES.overview.text.split('## よくある進め方')[1].split('## ')[0];
  const step = (no) => steps.split(new RegExp(`(?:^|\\n)${no}\\. `))[1].split(/\n\d\. /)[0];
  assert.match(step(2), /read_guide の "stages" の段階で進める/, '2（資料から下書きする）');
  assert.match(step(6), /read_guide の "stages" の段階で進める/, '6（置き場の資料から下書きする）');
});
