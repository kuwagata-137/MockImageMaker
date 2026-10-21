// tools/check-mcp.js の場面 E（設計ノート。第 10 段階の前半。説明書の export_system_doc は後半）。AI の入口（mcp-server）から、設計ノートの道具 3 つ・手引き stages・prompts 3 つ・
// export_system_doc を本物のアプリで確かめる。
// 起動の前に、保存先へ見本のシステム 1 つ（役割 2・作業 2。資料は置かない）を置く（check-mcp-materials.js の場面 D と同じ置き方。--only=notes で E だけを動かせる）。
//  0. アプリを起動する前に、入口だけで返る物を確かめる（アプリは起動しない）:
//     道具は 34 個で、get_notes（読むだけ）・update_notes・set_stage（書く）がある ／ prompts は 3 つ（design_system・make_screen・fix_design）で引数の必須と省略が合う ／
//     design_system（引数なし・system あり）は user の文 1 つで、read_guide の "stages" を読む指示がある ／ make_screen・fix_design は必須の引数がないと断られ、
//     文に "stages" を読ませる文も set_stage もない ／ resources は 5 つで、mim://guide/stages が読めて read_guide の "stages" と同じ文
//  1. 最初の get_notes（アプリを裏で起動する）: 段階 5 つが todo・読み取ったこと・メモ・決めたこと・まだ決まっていないことが空 ／ list_systems の行の stages も todo
//  2. update_notes（set_findings・add_question 2 つ・add_decision・set_memo を 1 回で）→ added が足した 3 行の id・更新の印が変わる。古い expect は stale で断られ、何も変わらない
//  3. set_stage: read を doing → review（確認の日時なし）→ done（確認の日時が入る。read にまだ決まっていないことが 1 つ残るので warnings）。answer_question で答えを書く。todo は bad_request で断られる
//  4. get_notes・list_systems・get_system で読める（段階・読み取ったこと・メモ・決めたこと・まだ決まっていないこと〔答えあり・答えなし〕）
//  4b. export_system_doc（第 10 段階の後半）: 決めたフォルダ（MIM_AI_EXPORT_DIR）に <システムの名前>_説明書.pdf（%PDF）を書き、返事の pages・included（設計ノートを入れた）・
//     designs（見本のシステムには画面設計がないので空）が合う。書く頼みではないので、システムの更新の印は変わらない
//  5. 入口を閉じてアプリが終わった後の designs.json に、段階・読み取ったこと・メモ・決めたこと・まだ決まっていないことが残り、「AI が直す前の状態」の行は増えていない
// インストールした版（--packaged）でも同じ場面が動く（保存先の置き方と、入口の起動の文は check-mcp.js のもの）。
'use strict';

const fs = require('fs');
const path = require('path');
const { placeSampleSystem } = require('./material-sample-place');
const { callRaw } = require('./check-mcp-materials');

const SYSTEM_ID = 'y-check-mcp-notes';
const SYSTEM_NAME = '出張申請システム（設計ノートの確かめ）';
const STAGES = ['read', 'flow', 'items', 'screens', 'docs'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/; // 日時（確認の日時・解決の日時）
const DAY = /^\d{4}-\d{2}-\d{2}$/; // 日付（決めたこと・まだ決まっていないことの行の date）
const FINDINGS = '社員が出張申請書を出し、上長が承認し、経理が旅費を精算する。旅費規程は役職で日当と宿泊費が違う。';
const MEMO = '設計ノートの確かめ用のメモ';
const Q_READ = '旅費規程の宿泊費は、役職ごとに金額が違うか';
const Q_ITEMS = '出張の目的は、選ぶ形か、自由に書く形か';
const ANSWER = 'はい。一般社員は 1 万円、課長以上は 1 万 5 千円';
const D_FLOW = '承認は上長の 1 段にする';
const D_REASON = '理念の「現場の手間を減らす」から';

const allStages = (state) => Object.fromEntries(STAGES.map((k) => [k, state]));
const stagesOf = (json) => STAGES.map((k) => `${k}:${json && json.stages && json.stages[k] ? json.stages[k].state : '?'}`).join(' ');
// 返事の文を 1 行にして短くする（NG の行に出す）
const brief = (r) => (r.isError ? `${r.code}: ${String(r.text).split('\n')[0]}` : JSON.stringify(r.json)).slice(0, 300);
const promptText = (r) => r.messages.map((m) => m.content.text).join('\n');
const rejected = async (promise) => { try { await promise; return null; } catch (err) { return err; } };

// 0. アプリを起動する前に、入口だけで返る物（道具の一覧・prompts・resources・手引き）
async function checkWithoutApp(client, env) {
  const { check, appInfo, TOOL_COUNT } = env;
  const tl = await client.listTools();
  const byName = Object.fromEntries(tl.tools.map((t) => [t.name, t]));
  const NEW = ['get_notes', 'update_notes', 'set_stage'];
  check(`E. 道具は ${TOOL_COUNT} 個で、設計ノートの道具 3 個（get_notes・update_notes・set_stage）がある。get_notes は読むだけ、update_notes・set_stage は書く`,
    tl.tools.length === TOOL_COUNT && NEW.every((n) => byName[n])
      && byName.get_notes.annotations.readOnlyHint === true && byName.update_notes.annotations.readOnlyHint === false && byName.set_stage.annotations.readOnlyHint === false,
    `${tl.tools.length} 個 ／ readOnlyHint ${NEW.map((n) => `${n}:${byName[n] && byName[n].annotations.readOnlyHint}`).join(' ')}`);

  const pl = await client.listPrompts();
  const shape = pl.prompts.map((p) => `${p.name}(${(p.arguments || []).map((a) => `${a.name}${a.required ? '*' : ''}`).join(',')})`).join(' ');
  check('E. prompts は 3 つ（design_system・make_screen・fix_design）。引数は system（省ける）／ request（省ける）／ design（必須）と request（省ける）',
    shape === 'design_system(system) make_screen(request) fix_design(design*,request)', shape);

  const ds0 = await client.getPrompt({ name: 'design_system' });
  const t0 = promptText(ds0);
  check('E. design_system（引数なし）は user の文 1 つで、read_guide の "stages" を読む指示と、設計するシステムが決まっていない時の進め方がある',
    ds0.messages.length === 1 && ds0.messages[0].role === 'user' && ds0.messages[0].content.type === 'text'
      && /read_guide の "stages"/.test(t0) && /決まっていません/.test(t0) && /set_stage/.test(t0), `${t0.length} 字`);
  const ds1 = await client.getPrompt({ name: 'design_system', arguments: { system: SYSTEM_NAME } });
  const t1 = promptText(ds1);
  check('E. design_system（system あり）は user の文 1 つで、"stages" を読む指示・そのシステムの名前・get_notes で続きから進める指示がある',
    ds1.messages.length === 1 && ds1.messages[0].role === 'user' && /read_guide の "stages"/.test(t1) && t1.includes(`「${SYSTEM_NAME}」`) && /get_notes/.test(t1) && !/決まっていません/.test(t1), `${t1.length} 字`);

  // Claude Code は prompts の引数を空白のところで切って渡すので、頼みは省けて、文で「人が打った文の全部を頼みとして読む・分からなければ人に聞く」と伝える
  const msNone = promptText(await client.getPrompt({ name: 'make_screen', arguments: {} }));
  const REQUEST = '顧客管理の一覧の画面を作って';
  const ms = promptText(await client.getPrompt({ name: 'make_screen', arguments: { request: REQUEST } }));
  check('E. make_screen は request を省ける（省くと「引数に書いてありません」）。文に頼みと、切れた引数の読み方が入る。"stages" を読ませる文も set_stage もない',
    /頼み: （引数に書いてありません。/.test(msNone) && ms.includes(REQUEST) && /空白のところで切れて届きます/.test(ms) && /"overview"/.test(ms) && !/stages/.test(ms) && !/set_stage/.test(ms),
    `省いたとき ${msNone.length} 字 ／ 頼みあり ${ms.length} 字`);
  const noDesign = await rejected(client.getPrompt({ name: 'fix_design', arguments: { request: '電話番号の欄を足して' } }));
  const fx = promptText(await client.getPrompt({ name: 'fix_design', arguments: { design: '顧客管理', request: '電話番号の欄を足して' } }));
  check('E. fix_design は design がないと断られ、文に画面設計の名前と頼みが入る。文に "stages" を読ませる文も set_stage もない',
    !!noDesign && fx.includes('「顧客管理」') && fx.includes('電話番号の欄を足して') && /get_design/.test(fx) && !/stages/.test(fx) && !/set_stage/.test(fx), noDesign ? `断られた: ${noDesign.message.split('\n')[0].slice(0, 100)}` : '断られなかった');

  const rl = await client.listResources();
  const uris = rl.resources.map((r) => r.uri);
  const res = await client.readResource({ uri: 'mim://guide/stages' });
  const resText = res.contents.map((c) => c.text).join('');
  const guide = await client.callTool({ name: 'read_guide', arguments: { topic: 'stages' } });
  const guideText = guide.content.map((c) => c.text).join('');
  check('E. resources は 5 つで mim://guide/stages が読め、read_guide の "stages" と同じ文（5 つの段階の表がある）',
    uris.length === 5 && uris.includes('mim://guide/stages') && resText === guideText && /^# 資料からシステムを作るときの段階/.test(resText) && /## 5 つの段階/.test(resText),
    `${uris.map((u) => u.replace('mim://guide/', '')).join('・')} ／ ${resText.length} 字`);
  check('E. 道具の一覧・prompts・resources・手引きを読むだけでは、アプリを起動しない', !appInfo(), appInfo() ? `起動していた（pid ${appInfo().pid}）` : '起動していない');
}

// 1〜4. アプリを起動して、設計ノートを読む・書く・段階を変える
async function checkNotesTools(client, env) {
  const { check, appInfo, setLastPid } = env;
  const t0 = Date.now();
  const first = await callRaw(client, 'get_notes', { system: SYSTEM_ID });
  const a = appInfo();
  setLastPid(a && a.pid);
  console.log(`E. 設計ノートの確かめのアプリを裏で起動した（${Date.now() - t0} ms ／ pid ${a && a.pid}）`);
  const f = first.json || {};
  const emptyStage = (s) => s && s.state === 'todo' && s.confirmedAt === null;
  check('E. get_notes（最初）: 段階 5 つが todo で、読み取ったこと・メモ・決めたこと・まだ決まっていないことが空',
    !first.isError && f.system.id === SYSTEM_ID && f.system.name === SYSTEM_NAME && STAGES.every((k) => emptyStage(f.stages[k])) && Object.keys(f.stages).length === 5
      && f.findings === '' && f.memo === '' && f.decisions.length === 0 && f.questions.length === 0 && f.decisionsTotal === 0 && f.questionsTotal === 0 && f.nextCursor === null && !!f.updatedAt,
    first.isError ? brief(first) : stagesOf(f));
  const before = await callRaw(client, 'list_systems', {});
  const row0 = ((before.json || {}).systems || []).find((y) => y.id === SYSTEM_ID);
  check('E. list_systems の行に stages があり、5 つとも todo', !!row0 && JSON.stringify(row0.stages) === JSON.stringify(allStages('todo')), JSON.stringify(row0 && row0.stages));

  // 2. update_notes（1 回で 5 つの操作）
  const w = await callRaw(client, 'update_notes', { system: SYSTEM_ID, expect: f.updatedAt, ops: [
    { op: 'set_findings', text: FINDINGS },
    { op: 'add_question', stage: 'read', text: Q_READ },
    { op: 'add_question', stage: 'items', text: Q_ITEMS },
    { op: 'add_decision', stage: 'flow', text: D_FLOW, reason: D_REASON },
    { op: 'set_memo', text: MEMO },
  ] });
  const wj = w.json || {};
  const added = wj.added || [];
  check('E. update_notes（set_findings・add_question 2 つ・add_decision・set_memo）: 操作 5 つが 1 回で入り、added が足した 3 行の id を返し、更新の印が変わる',
    !w.isError && wj.ops.length === 5 && added.map((a) => a.op).join() === 'add_question,add_question,add_decision' && added.every((a) => typeof a.id === 'string' && a.id) && new Set(added.map((a) => a.id)).size === 3
      && wj.changed === true && !!wj.updatedAt && wj.updatedAt !== f.updatedAt,
    w.isError ? brief(w) : `added ${added.map((a) => `${a.op}:${a.id}`).join('・')} ／ updatedAt ${f.updatedAt} → ${wj.updatedAt}`);
  const stale = await callRaw(client, 'update_notes', { system: SYSTEM_ID, expect: f.updatedAt, ops: [{ op: 'set_memo', text: '古い expect で書いた' }] });
  check('E. update_notes: 読んだ後に更新の印が変わっていれば（古い expect）、stale で断られる', stale.isError && stale.code === 'stale', stale.isError ? stale.code : '断られなかった');
  const [qRead, , dFlow] = added;

  // 3. set_stage
  let stamp = wj.updatedAt;
  const doing = await callRaw(client, 'set_stage', { system: SYSTEM_ID, stage: 'read', state: 'doing', expect: stamp });
  stamp = (doing.json || {}).updatedAt || stamp;
  const review = await callRaw(client, 'set_stage', { system: SYSTEM_ID, stage: 'read', state: 'review', expect: stamp });
  stamp = (review.json || {}).updatedAt || stamp;
  check('E. set_stage: read を doing → review にでき、確認の日時はまだ付かない（changed: true）',
    !doing.isError && !review.isError && doing.json.state === 'doing' && review.json.stage === 'read' && review.json.state === 'review' && review.json.confirmedAt === null && review.json.changed === true && !review.json.warnings,
    doing.isError || review.isError ? brief(doing.isError ? doing : review) : JSON.stringify(review.json));
  const done = await callRaw(client, 'set_stage', { system: SYSTEM_ID, stage: 'read', state: 'done', expect: stamp });
  const dj = done.json || {};
  stamp = dj.updatedAt || stamp;
  check('E. set_stage: read を done にすると確認の日時が入り、read にまだ決まっていないことが 1 つ残っているので warnings で知らせる',
    !done.isError && dj.state === 'done' && ISO.test(dj.confirmedAt || '') && dj.changed === true && Array.isArray(dj.warnings) && dj.warnings.length === 1 && /まだ決まっていないことが 1 つ残っています/.test(dj.warnings[0]) && /answer_question/.test(dj.warnings[0]),
    done.isError ? brief(done) : JSON.stringify(dj));
  const answer = await callRaw(client, 'update_notes', { system: SYSTEM_ID, expect: stamp, ops: [{ op: 'answer_question', id: qRead.id, answer: ANSWER }] });
  stamp = (answer.json || {}).updatedAt || stamp;
  check('E. update_notes（answer_question）: まだ決まっていないことに人の答えを書ける', !answer.isError && answer.json.changed === true && answer.json.ops[0].id === qRead.id, answer.isError ? brief(answer) : JSON.stringify(answer.json));
  const todo = await callRaw(client, 'set_stage', { system: SYSTEM_ID, stage: 'read', state: 'todo', expect: stamp });
  check('E. set_stage: todo（まだ）には戻せず、bad_request で断られる（前の段階を直すときは "review" に戻す、と添える）',
    todo.isError && todo.code === 'bad_request' && /"todo".*戻せません/.test(todo.text) && /"review"/.test(todo.text), todo.isError ? `${todo.code}: ${todo.text.split('\n')[0]}` : '断られなかった');

  // 4. 読む
  const g = await callRaw(client, 'get_notes', { system: SYSTEM_ID });
  const j = g.json || {};
  const dec = (j.decisions || [])[0] || {};
  const qs = j.questions || [];
  const qR = qs.find((q) => q.id === qRead.id) || {};
  const qI = qs.find((q) => q.stage === 'items') || {};
  const stageOk = j.stages && j.stages.read.state === 'done' && ISO.test(j.stages.read.confirmedAt || '') && j.stages.flow.state === 'todo' && j.stages.items.state === 'todo' && j.stages.screens.state === 'todo' && j.stages.docs.state === 'todo';
  check('E. get_notes: 段階（read だけ done と確認の日時）・読み取ったこと・メモ・決めたことと理由が読める',
    !g.isError && stageOk && j.findings === FINDINGS && j.memo === MEMO && j.decisionsTotal === 1 && dec.id === dFlow.id && dec.stage === 'flow' && dec.text === D_FLOW && dec.reason === D_REASON && DAY.test(dec.date || ''), g.isError ? brief(g) : `${stagesOf(j)} ／ 決めたこと ${j.decisionsTotal}`);
  check('E. get_notes: まだ決まっていないことが 2 つ読め、書いた答えが read の行にあり（解決の日時あり）、items の行は答えなしのまま（stale で断った古い書き込みは入っていない）',
    qs.length === 2 && j.questionsTotal === 2 && qR.stage === 'read' && qR.text === Q_READ && qR.answer === ANSWER && ISO.test(qR.resolvedAt || '') && qI.text === Q_ITEMS && qI.answer === '' && qI.resolvedAt === null && j.updatedAt === stamp,
    `read: ${JSON.stringify(qR.answer)}・${qR.resolvedAt} ／ items: ${JSON.stringify(qI.answer)}・${qI.resolvedAt} ／ updatedAt ${j.updatedAt}`);
  const ls = await callRaw(client, 'list_systems', {});
  const gs = await callRaw(client, 'get_system', { system: SYSTEM_ID });
  const row = ((ls.json || {}).systems || []).find((y) => y.id === SYSTEM_ID);
  const expectStages = { read: 'done', flow: 'todo', items: 'todo', screens: 'todo', docs: 'todo' };
  check('E. list_systems の行と get_system の返事の stages に、段階ごとの進み具合（read だけ done）が出る',
    !!row && JSON.stringify(row.stages) === JSON.stringify(expectStages) && !gs.isError && JSON.stringify(gs.json.stages) === JSON.stringify(expectStages),
    `list_systems ${JSON.stringify(row && row.stages)} ／ get_system ${JSON.stringify(gs.json && gs.json.stages)}`);
  return { pid: a && a.pid, stamp, noteIds: { qRead: qRead.id, dFlow: dFlow.id } };
}

// 4b. export_system_doc（説明書の PDF。第 10 段階の後半）
async function checkSystemDocTool(client, env, info) {
  const { check, EXPORT_DIR } = env;
  const r = await callRaw(client, 'export_system_doc', { system: SYSTEM_ID });
  const j = r.json || {};
  const file = (j.files || [])[0] || '';
  const head = file && fs.existsSync(file) ? fs.readFileSync(file).subarray(0, 4).toString() : '';
  check('E. export_system_doc: 決めたフォルダに <システムの名前>_説明書.pdf を書き、返事のページ数・入れたページ（表紙・スイムレーン図・設計ノート）が合う',
    !r.isError && j.folder === EXPORT_DIR && path.basename(file) === `${SYSTEM_NAME}_説明書.pdf` && head === '%PDF'
      && j.pages === 3 && JSON.stringify(j.included) === JSON.stringify({ systemCover: true, swimlane: true, notes: true }) && Array.isArray(j.designs) && j.designs.length === 0,
    r.isError ? brief(r) : `${path.basename(file)}（${head}）・${j.pages} ページ・${JSON.stringify(j.included)}`);
  const g = await callRaw(client, 'get_notes', { system: SYSTEM_ID });
  check('E. export_system_doc は書く頼みではない（システムの更新の印が変わらない）', !g.isError && g.json.updatedAt === info.stamp, `updatedAt ${g.json && g.json.updatedAt}`);
}

// 5. アプリが終わった後の designs.json
function checkSaved(env, info) {
  const { check, STATE_FILE } = env;
  const saved = (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).systems || []).find((y) => y.id === SYSTEM_ID);
  const n = (saved && saved.notes) || {};
  const qs = n.questions || [];
  const qR = qs.find((q) => q.id === info.noteIds.qRead) || {};
  const qI = qs.find((q) => q.stage === 'items') || {};
  const dec = (n.decisions || [])[0] || {};
  check('E. 入口を閉じてアプリが終わった後の designs.json に、段階（read だけ done と確認の日時）・読み取ったこと・メモ・決めたこと・まだ決まっていないことが残る',
    !!saved && n.stages.read.state === 'done' && ISO.test(n.stages.read.confirmedAt || '') && ['flow', 'items', 'screens', 'docs'].every((k) => n.stages[k].state === 'todo')
      && n.findings === FINDINGS && n.memo === MEMO && (n.decisions || []).length === 1 && dec.id === info.noteIds.dFlow && dec.stage === 'flow' && dec.text === D_FLOW && dec.reason === D_REASON
      && qs.length === 2 && qR.answer === ANSWER && ISO.test(qR.resolvedAt || '') && qI.text === Q_ITEMS && qI.answer === '' && qI.resolvedAt === null && saved.updatedAt === info.stamp,
    saved ? `${stagesOf({ stages: n.stages })} ／ 決めたこと ${(n.decisions || []).length}・まだ決まっていないこと ${qs.length} ／ updatedAt ${saved.updatedAt}` : 'システムがない');
  check('E. 設計ノートだけを直したので、designs.json に「AI が直す前の状態」の行が増えていない', !!saved && saved.revisions.filter((r) => r.kind === 'ai').length === 0 && saved.roles.length === 2,
    saved ? `改訂履歴の行 ${saved.revisions.length}・役割 ${saved.roles.length}` : 'システムがない');
}

// 場面 E 全体。env は check-mcp.js の道具（openEntry・check・appInfo・waitUntil・waitAppQuit・quitDetail・setLastPid・USER_DATA・STATE_FILE・IDLE_MS・TOOL_COUNT・EXPORT_DIR）
async function phaseNotes(env) {
  const { openEntry, check, waitAppQuit, quitDetail, USER_DATA, STATE_FILE, IDLE_MS } = env;
  await placeSampleSystem({ userData: USER_DATA, systemId: SYSTEM_ID, systemName: SYSTEM_NAME, names: [], idPrefix: 'm-check-', description: '設計ノートの確かめの見本' });
  const placed = (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).systems || []).find((y) => y.id === SYSTEM_ID);
  check('E. 起動の前に、見本のシステム（役割 2・作業 2）を置いた', !!placed && placed.roles.length === 2 && placed.swimlane.steps.length === 2 && path.basename(STATE_FILE) === 'designs.json', placed ? placed.name : 'ない');
  const { client } = await openEntry();
  await checkWithoutApp(client, env);
  const info = await checkNotesTools(client, env);
  await checkSystemDocTool(client, env, info);
  await client.close();
  const q = await waitAppQuit(info.pid, IDLE_MS + 15000, 'E. 入口を閉じた後にアプリが終わる');
  check('E. 入口を閉じると、アプリが終わり始め、プロセスも消える', q.begin >= IDLE_MS - 500, quitDetail(q));
  checkSaved(env, info);
}

module.exports = { phaseNotes };
