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
    ['make_screen', '画面を作る', [['request', false]]],
    ['fix_design', '画面設計を変更する', [['design', true], ['request', false]]],
  ]);
  for (const p of prompts) {
    assert.match(p.description, /[぀-ヿ一-鿿]/, p.name);
    for (const a of p.arguments) assert.match(a.description, /[぀-ヿ一-鿿]/, `${p.name} の ${a.name}`);
  }
  // 必須の引数がない頼みは断る
  await assert.rejects(client.getPrompt({ name: 'fix_design', arguments: { request: '電話番号の欄を足して' } }));
});

// Claude Code は prompts の引数を空白のところで切って渡す（2026-10-20 に claude -p で確かめた。「顧客管理の一覧の画面に 20 行の表を置く」は「顧客管理の一覧の画面に」だけが届き、
// 引用符で囲んでも同じ）。AI には人が打ったコマンドの文の全部が見えているので、頼みの文で、それを頼みとして読むよう伝える。頼みを省いたときは人に聞く
test('prompts の引数は空白で切れて届くので、3 つの文に「人が打った文の全部を頼みとして読む」ことと、分からなければ人に聞くことを書く。make_screen・fix_design は頼みを省ける', async (t) => {
  const client = await openEntry(t);
  const texts = {
    design_system: await promptText(client, 'design_system', { system: '出張申請' }),
    make_screen: await promptText(client, 'make_screen', { request: '顧客管理の一覧の画面に' }),
    fix_design: await promptText(client, 'fix_design', { design: '顧客管理', request: '新規登録の画面に' }),
  };
  for (const [name, text] of Object.entries(texts)) {
    assert.match(text, /空白のところで切れて届きます/, name);
    assert.match(text, /人が打ったコマンドの文が見えていれば、その全部を/, name);
    assert.match(text, /始める前に人に聞いてください/, name);
  }
  const makeNone = await promptText(client, 'make_screen', {});
  assert.match(makeNone, /依頼: （引数に書いてありません。チャットにも依頼がなければ、始める前に人に聞いてください）/);
  assert.doesNotMatch(makeNone, /undefined|「」/);
  const fixNone = await promptText(client, 'fix_design', { design: '顧客管理' });
  assert.match(fixNone, /「顧客管理」/);
  assert.match(fixNone, /依頼: （引数に書いてありません。チャットにも依頼がなければ、始める前に人に聞いてください）/);
  // design_system は system を省くと list_systems で探す進め方なので、切れた引数の文は「書いていないときは聞く」と言わない（食い違わない）
  const dsNone = await promptText(client, 'design_system', {});
  assert.match(dsNone, /空白のところで切れて届きます/);
  assert.doesNotMatch(dsNone, /書いていない/);
  assert.match(dsNone, /list_systems/);
  assert.doesNotMatch(fixNone, /undefined/);
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
  assert.match(withSys, /そのシステムがまだなければ、その名前で create_system で作ってください/, 'これから作るシステムの名前を渡したとき');
  // 人が確かめを飛ばすよう頼んだ段階は止まらずに進む（手引き stages の例外）。頼みの文もそれと食い違わない
  assert.match(withSys, /人が確かめを飛ばすよう依頼した段階は、手引き "stages" のとおり "skipped" にして進めます/);
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
test('入口の形: get_notes は読むだけ、update_notes・set_stage は書く道具。知らない欄・知らない操作・知らない段階は、アプリへ送る前に断る（set_stage の todo は、ページが文で断る）', () => {
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
  assert.equal(parse('set_stage', { system: 'y1', stage: 'read', state: 'todo' }), true, 'todo はページが「review に戻す」の文で断る（test/ai-notes.test.js）');
  assert.equal(parse('set_stage', { system: 'y1', stage: 'read', state: 'finished' }), false);
  assert.equal(parse('set_stage', { system: 'y1', stage: 'design', state: 'done' }), false);
  assert.match(tool('set_stage').description, /人が「よい」と答えるまで done にしない/);
  assert.match(tool('read_guide').description, /"stages"/);
  // 段階の state は、AI に見える文で「進み具合」と呼ぶ（設計書の「段階の進み具合」。「状態」と呼び分けない）
  for (const n of ['list_systems', 'get_system', 'get_notes', 'set_stage']) assert.match(tool(n).description, /進捗/, n);
  assert.match(tool('set_stage').input.shape.state.description, /^進捗: /);
  const visible = [INSTRUCTIONS, ...Object.values(GUIDES).map((g) => g.text), ...TOOLS.map((x) => x.description)];
  for (const text of visible) assert.doesNotMatch(text, /段階ごとの状態|同じ状態なら|使える状態/);
});

test('手引き: つないだときの文に、段階ごとに人に確かめることと、人が「よい」と答えるまで done にしないことを書く。"stages" の手引きと、よくある進め方の 2 と 6', () => {
  assert.ok(INSTRUCTIONS.includes('資料からシステムを作るときは、read_guide の "stages" の段階ごとに人に確かめてください。人が「よい」と答えるまで set_stage を done にしないでください。'));
  assert.match(INSTRUCTIONS.split(/\r?\n/)[1], /"stages"/, '最初の行の topic の並びにも stages');
  assert.equal(GUIDES.stages.title, '資料からシステムを作るときの段階');
  const g = GUIDES.stages.text;
  assert.match(g, /^# 資料からシステムを作るときの段階/);
  for (const name of ['① 資料から読み取る', '② 業務の流れ', '③ データベースの項目', '④ 画面', '⑤ システム設計書と出力']) assert.ok(g.includes(name), name);
  for (const re of [/get_notes/, /"doing"/, /"review"/, /"done"/, /"skipped"/, /人が答える前に done にしない/, /set_findings/, /add_question/, /add_decision/, /answer_question/,
    /export_system_doc でシステム設計書（PDF）を出力する/, /画面設計ごとの HTML・PNG が要るときは export_design/, /理念の『現場の手間を減らす』から、承認は上長の 1 段にした/, /1 つの依頼/, /確かめなくてよいので進めて/]) assert.match(g, re);
  assert.match(g, /済んだ段階（"done"（確認済み）・"skipped"（確認を飛ばした））は繰り返さず/);
  // ⑤ は、案を出して review → 人が「よい」と答えたら出力し、ファイルの場所を書いてから done（ほかの段階は、アプリに入れてから review）
  assert.match(g, /⑤ システム設計書と出力だけは、案（出力するもの）を出して "review" にし、人が「よい」と答えたら出力して、出力したファイルの場所を add_decision（段階 docs）で書いてから "done" にする/);
  // 「よい」「それで進めて」は done、案を見ずに確かめを飛ばす頼みだけ skipped。人がアプリで進み具合を変えたとき
  assert.match(g, /人が案を見て認めた（「よい」「それで進めて」「OK」など）ときは "done"/);
  assert.match(g, /案を見ずに確かめを飛ばすよう依頼された段階だけ "skipped"/);
  assert.match(g, /どの段階を飛ばすかは人の言葉のとおりにし、分からなければ人に聞く/);
  assert.match(g, /人はアプリの設計ノートで進捗を変えられます/);
  // ⑤ を飛ばすよう頼まれたとき（「出力は『よい』の前にしない」と「skipped の段階も作業は飛ばさない」のどちらか）
  assert.match(g, /⑤ の確かめを飛ばすよう依頼されたときは、案を出して止まらずに出力し、出力したファイルの場所を書いてから "skipped" にする/);
  assert.match(g, /済んだはずの段階が "todo"（まだ）に戻っていたら、やり直す前に人に聞く/);
  // 設計ノートの変更は「AI が直す前の状態」の行に残らない（人が戻せない）ことを書く。INSTRUCTIONS の「いつでも戻せます」は設計ノートを除く
  assert.ok(GUIDES.overview.text.includes('設計ノート（update_notes・set_stage）の変更は「AI が変更する前の状態」の行に残りません'));
  assert.match(GUIDES.overview.text, /開いていないシステムでは元に戻すの履歴も消えるので、人は戻せません/);
  assert.match(INSTRUCTIONS.split(/\r?\n/).at(-1), /（設計ノートを除く）.*人がいつでも戻せます/);
  // 指し方: 設計ノートの行は get_notes の id で指す
  assert.match(GUIDES.overview.text.split('## 指し方')[1].split('## ')[0], /設計ノートの行（決めたこと・まだ決まっていないこと）は、get_notes の id で指します/);
  const steps = GUIDES.overview.text.split('## よくある進め方')[1].split('## ')[0];
  const step = (no) => steps.split(new RegExp(`(?:^|\\n)${no}\\. `))[1].split(/\n\d\. /)[0];
  assert.match(step(2), /read_guide の "stages" の段階で進める/, '2（資料から下書きする）');
  assert.match(step(6), /read_guide の "stages" の段階で進める/, '6（置き場の資料から下書きする）');
});
