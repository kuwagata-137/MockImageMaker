// 使い方: node tools/check-mcp.js [--only=materials（場面 D だけ）|--only=notes（場面 E だけ）] [--packaged=<作った版のフォルダ（例 dist/win-unpacked）>]
// AI の入口（mcp-server.js --dev）を公式の SDK の Client で起動してつなぎ、入口が Electron のアプリを裏で起動して使えるかを確かめる（第 7 段階の T9）。
// アプリは窓を出さない（MIM_HEADLESS=1）。入口がアプリを起動するときの文は MIM_APP_CMD で差し替え、メインプロセスの inspector を開ける
// （窓の × は、check-electron と同じく BrowserWindow.close() を inspector から呼んで再現する。ページの window.close() は close の知らせを通らないため）。
//  A. 最初の頼みで、アプリを --background で起動する（かかった時間を出す）。画面設計を作って部品を並べると、designs.json に残る。
//     画面の画像は長い辺が 1568 以下の PNG。出力（PDF・PNG・HTML）は MIM_AI_EXPORT_DIR に書き、同じ名前には番号を付ける。
//     道具は 36 個。edit_process でステータスと操作を書き、移る先を持つボタンを並べると、get_flow で読め、get_view_image は PNG（長い辺が 1568 以下。第 8 段階）。
//     システムを作って役割・画面設計・スイムレーンを書くと、get_system・list_systems で読め、designs.json に残り、スイムレーン図の画像は PNG（第 9 段階）。
//     edit_items で kintone の欄を書くと、get_kintone_app が kintone の MCP サーバーに渡す形を返す（第 13 段階）。
//     グループ枠・縦に重ねる形・レコードの見出しのボタンで画面を並べると、get_screen が inFrame を返し、get_kintone_app がグループ（GROUP）を返す（第 14 段階）。
//     レコード一覧のかんばんと大きな数字・メーターのグラフを並べると、get_screen で読め、get_kintone_app の warnings で知らせる（第 15 段階）。
//     status で、窓が見えていない・裏の起動・ページの準備ができている。2 つ目の起動（--background）では窓を出す印が付かない。
//     前に人が窓を最大化して閉じていても（window-state.json の isMaximized）、裏の起動では窓が画面に出ない（status の onScreen）。
//     AI がつながっている間の窓の ×（BrowserWindow.close()）では、窓を隠して動き続ける。入口を閉じると、5 秒（MIM_IDLE_QUIT_MS）たって終わり始め（automation.json が消える）、プロセスも消える
//  B. 次の入口で、アプリをまた起動し、A で作った画面設計が一覧に出る。入口を強制終了しても、5 秒たってアプリが終わる
//  C. 2 つ目の起動（--background なし。人がアプリを起動した）では窓を出す印が付き、入口を閉じても終わらない。AI のつながりがないときの窓の × では終わる
//  D. 資料の置き場（第 9 段階の後半。check-mcp-materials.js）: 起動の前に見本のシステムと資料 8 つを置き、道具が 36 個・list_materials・read_material
//     （7 つ同時に頼んでも読める・仕込んだ指示の文字・Excel の番地・PDF の日本語の文字と 3 ページ目の画像・古い形の old_format）・swimlane_from_bdm（replace なしは断られ、replace: true で入る）・get_system・
//     export_bdm（第 11 段階。入れた図を元の MPD に入れて MIM_AI_EXPORT_DIR に書く。読み直すと同じで、元の資料は変わらない）
//  E. 設計ノート（第 10 段階の前半。check-mcp-notes.js）と説明書（第 10 段階の後半。export_system_doc）: 起動の前に見本のシステムを置き、アプリを起動する前に、道具が 36 個・prompts が 3 つ（design_system・make_screen・fix_design。
//     引数の必須と省略、文の中身）・resources が 6 つ（mim://guide/stages が読める）を確かめる。そのあと update_notes（set_findings・add_question・add_decision・set_memo）→ set_stage（read を doing → review → done。
//     todo は断られる）→ get_notes・list_systems・get_system の stages で読め、入口を閉じた後の designs.json に残る
//  最後に、窓を出さなかった起動では window-state.json を書き換えていない（人が最大化して使っていたことが残る）
// 「アプリが終わる」は 2 つに分けて待つ（waitAppQuit）。終わり始める時（automation.json が消える。アプリが決める時）は決めた時間で確かめ、
// その後プロセスが消えるまでは長く待つ（EXIT_WAIT_MS）。PC の負荷が高いと、Windows で Electron のプロセスが消えるまで数十秒〜数分かかるため（2026-10-19。開発記録）。
// 保存先は作業フォルダの .devdata/check-mcp（毎回消してから始める）。
// --packaged のときは、作った版（npm run dist の win-unpacked）の MockImageMaker.exe を ELECTRON_RUN_AS_NODE=1 で入口にし、
// resources\app.asar\mcp-server.js を渡す（インストールした版と同じ動かし方）。保存先は .devdata/check-mcp-packaged
// （窓を出さない確かめの起動〔MIM_HEADLESS=1〕のときだけ、インストールした版でも MIM_USER_DATA で保存先を変えられる。人の保存データに触らないため）。
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const P = require('../automation-protocol');
const { phaseMaterials } = require('./check-mcp-materials');
const { phaseNotes } = require('./check-mcp-notes');

const ROOT = path.resolve(__dirname, '..');
const PACKAGED = ((process.argv.find((a) => a.startsWith('--packaged=')) || '').slice(11)) || null;
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)) || null; // 'materials'（場面 D）か 'notes'（場面 E）だけを確かめる
if (ONLY && !['materials', 'notes'].includes(ONLY)) { console.error('--only= は materials か notes'); process.exit(2); }
const wants = (scene) => !ONLY || ONLY === scene; // scene: 'materials'（場面 D）・'notes'（場面 E）。場面 A〜C は --only= がないときだけ
const TOOL_COUNT = 36; // 入口の道具の数（第 10 段階の前半で設計ノートの 3 個が増えて 33 個、後半で説明書の export_system_doc が増えて 34 個、第 11 段階で export_bdm が増えて 35 個、第 13 段階で get_kintone_app が増えて 36 個）
const PKG_DIR = PACKAGED ? path.resolve(ROOT, PACKAGED) : null;
const PKG_EXE = PKG_DIR ? path.join(PKG_DIR, 'MockImageMaker.exe') : null;
// アプリの起動の文（2 つ目の起動と、入口がアプリを起動するときの差し替え）
const appCommand = (...args) => (PKG_EXE ? [PKG_EXE, ...args] : [electronPath, ROOT, ...args]);
const BASE = path.join(ROOT, '.devdata', PACKAGED ? 'check-mcp-packaged' : 'check-mcp');
const USER_DATA = path.join(BASE, 'userData');
const EXPORT_DIR = path.join(BASE, 'export');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
// 前に人が窓を最大化して閉じた、という状態（electron-window-state の形。どの画面にも収まる位置と大きさ）
const WINDOW_STATE_FILE = path.join(USER_DATA, 'window-state.json');
const WINDOW_STATE = { x: 0, y: 0, width: 800, height: 560, isMaximized: true, isFullScreen: false, displayBounds: { x: 0, y: 0, width: 800, height: 560 } };
const MAIN_PORT = 9337; // メインプロセスの inspector（check-electron・check-export の 9333〜9335 と分ける）
const IDLE_MS = 5000;
// アプリが終わり始めてから（automation.json が消えてから）、プロセスが消えるまで待つ長さ。ふだんは 1 秒もかからないが、
// PC の負荷が高いと、Windows で Electron のプロセス（と子のプロセス）が消えるまで数十秒〜数分かかった（2026-10-19。開発記録）
const EXIT_WAIT_MS = 360000;
const EXIT_SLOW_MS = 5000; // プロセスが消えるまでにこれより長くかかったら、結果の行に書き添える
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'NG'} ${label}${detail ? ' … ' + detail : ''}`); };

const ENV = {
  MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA, MIM_AI_EXPORT_DIR: EXPORT_DIR, MIM_IDLE_QUIT_MS: String(IDLE_MS),
  MIM_APP_CMD: JSON.stringify(appCommand(`--inspect=${MAIN_PORT}`)), MIM_TIMEOUT_MS: '40000',
};

async function openEntry() {
  const transport = PKG_EXE
    ? new StdioClientTransport({ command: PKG_EXE, args: [path.join(PKG_DIR, 'resources', 'app.asar', 'mcp-server.js')], env: { ...ENV, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' })
    : new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp-server.js')], env: ENV, stderr: 'pipe' });
  const client = new Client({ name: 'claude-code', version: 'check' });
  await client.connect(transport);
  return { client, transport };
}
async function tool(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(`${name} が断られた: ${text}`);
  return JSON.parse(text);
}

const appInfo = () => P.readAutomationFile(USER_DATA);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
async function waitUntil(cond, ms, label) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`時間切れ: ${label}`);
    await sleep(100);
  }
  return Date.now() - t0;
}

let lastPid = null; // 最後に起動したアプリの pid（途中で止まったときに、残ったアプリを終わらせる）

// アプリが終わるのを待つ。終わり始める（automation.json が消える）までは startMs、そこからプロセスが消えるまでは EXIT_WAIT_MS まで待つ。
// 戻り値は、待ち始めてから終わり始めるまで（begin）と、プロセスが消えるまで（gone）の ms
async function waitAppQuit(pid, startMs, label) {
  const begin = await waitUntil(() => !appInfo(), startMs, `${label}（automation.json が消えない）`);
  const t0 = Date.now();
  let told = false;
  while (alive(pid)) {
    const ms = Date.now() - t0;
    if (ms > EXIT_WAIT_MS) throw new Error(`時間切れ: ${label}（終わり始めてから ${Math.round(ms / 1000)} 秒たっても、プロセスが消えない）`);
    if (!told && ms > 20000) {
      told = true;
      console.log(`… ${label}: 終わり始めた後、プロセスが消えるのを待っています（PC の負荷が高いと数分かかることがあります）`);
    }
    await sleep(100);
  }
  return { begin, gone: begin + (Date.now() - t0) };
}
const quitDetail = (q) => `終わり始めるまで ${q.begin} ms・プロセスが消えるまで ${q.gone} ms`
  + (q.gone - q.begin > EXIT_SLOW_MS ? '（Windows でプロセスが消えるのに時間がかかった）' : '');

// パイプにつないで status を聞く（確かめ用の決まり。つないでいる間は AI のつながりに数えられる）
function status() {
  const info = appInfo();
  if (!info) return Promise.reject(new Error('automation.json がない'));
  return new Promise((resolve, reject) => {
    const s = net.connect(info.pipe);
    const timer = setTimeout(() => { s.destroy(); reject(new Error('status の返事が来ない')); }, 5000);
    s.once('error', reject);
    P.readLines(s, (m) => {
      if (m.type === 'hello') P.sendLine(s, { type: 'status' });
      if (m.type === 'status') { clearTimeout(timer); s.destroy(); resolve(m); }
    });
    s.once('connect', () => P.sendLine(s, { type: 'hello', token: info.token, protocol: P.PROTOCOL, session: 'check', client: 'check-mcp' }));
  });
}

// 2 つ目の起動（すぐ終わる）
function secondLaunch(background) {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA };
  delete env.ELECTRON_RUN_AS_NODE;
  const [cmd, ...args] = appCommand(...(background ? ['--background'] : []));
  const child = spawn(cmd, args, { env, stdio: 'ignore', windowsHide: true });
  return new Promise((resolve) => child.on('exit', resolve));
}

// 窓の ×（メインプロセスの inspector から BrowserWindow.close() を呼ぶ。評価したらすぐ切る〔つないだままだと、終わるときに切断を待って止まる〕）
async function closeWindow() {
  let list = null;
  for (let i = 0; i < 40 && !list; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json/list`)).json();
    } catch (_) {
      await sleep(250);
    }
  }
  if (!list || !list[0]) throw new Error('メインプロセスの inspector に接続できませんでした');
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = new Promise((resolve) => { ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id === 1) resolve(msg); }; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "require('electron').BrowserWindow.getAllWindows()[0].close()", includeCommandLineAPI: true } }));
  const msg = await Promise.race([reply, sleep(5000).then(() => ({ error: '時間切れ' }))]);
  ws.close();
  const err = msg.error || (msg.result && msg.result.exceptionDetails);
  if (err) throw new Error('メインプロセスでの評価に失敗しました: ' + JSON.stringify(err));
}

async function phaseA() {
  const { client } = await openEntry();
  const t0 = Date.now();
  const list = await tool(client, 'list_designs');
  const info = appInfo();
  lastPid = info && info.pid;
  check('A. 最初の頼みでアプリを裏で起動する', !!info && list.total === 0, `${Date.now() - t0} ms ／ pid ${info && info.pid}`);
  const made = await tool(client, 'create_design', { name: '出張申請（確かめ）', target: 'kintone' });
  await tool(client, 'layout_screen', {
    design: made.id, screen: made.firstScreen.id, expect: made.updatedAt,
    layout: { columns: 2, rows: [[{ item: '申請日', type: 'date' }, { item: '申請者', type: 'user' }], [{ item: '目的', type: 'text2', span: 2 }], { align: 'right', parts: [{ type: 'button', label: '申請する', style: 'primary' }] }] },
  });
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).designs.find((d) => d.id === made.id);
  check('A. 作った画面設計と並べたアイテムが designs.json に残る', !!saved && saved.screens[0].parts.length === 4 && saved.items.length === 3,
    saved ? `アイテム ${saved.screens[0].parts.length} つ・項目 ${saved.items.map((i) => i.name).join('・')}` : 'ない');
  // 第 13 段階: 入口の形のまま kintone の欄を書き、get_kintone_app で kintone の MCP サーバーに渡す形を読む
  await tool(client, 'edit_items', { design: made.id, ops: [{ op: 'update', item: '申請者', kintone: { type: 'CREATOR', code: 'applicant' } }] });
  const kt = await tool(client, 'get_kintone_app', { design: made.id });
  check('A. kintone の欄を書け、get_kintone_app が kintone の MCP サーバーに渡す形を返す（第 13 段階）',
    kt.systemFields.length === 1 && kt.systemFields[0].code === 'applicant' && !!kt.properties['申請日'] && kt.layout.length >= 2 && kt.howTo.some((l) => l.includes('kintone-add-form-fields')),
    `properties ${Object.keys(kt.properties).join('・')} ／ systemFields ${kt.systemFields.map((f) => f.code).join('・')} ／ layout ${kt.layout.length} 行`);
  // 画面の画像（PNG。長い辺を 1568 までに縮める）と出力（決めたフォルダへ。同じ名前には番号を付ける）
  const img = await client.callTool({ name: 'get_screen_image', arguments: { design: made.id, screen: made.firstScreen.id } });
  const im = img.content.find((c) => c.type === 'image');
  const buf = im ? Buffer.from(im.data, 'base64') : Buffer.alloc(0);
  const [iw, ih] = buf.length > 24 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [0, 0];
  check('A. 画面の画像は PNG で、長い辺が 1568 以下', !img.isError && buf.subarray(1, 4).toString() === 'PNG' && Math.max(iw, ih) <= 1568 && Math.max(iw, ih) >= 1500, `${iw} × ${ih}`);
  const pdf1 = await tool(client, 'export_design', { design: made.id, format: 'pdf' });
  const pdf2 = await tool(client, 'export_design', { design: made.id, format: 'pdf' });
  const png = await tool(client, 'export_design', { design: made.id, format: 'png' });
  const html = await tool(client, 'export_design', { design: made.id, format: 'html' });
  const names = [pdf1, pdf2, png, html].map((r) => r.files.map((f) => path.basename(f)).join('・'));
  const head = (f, n) => fs.readFileSync(f).subarray(0, n).toString();
  check('A. 出力は決めたフォルダに書き、同じ名前のファイルには番号を付ける',
    pdf1.folder === EXPORT_DIR && names[0] === '出張申請（確かめ）.pdf' && names[1] === '出張申請（確かめ） (2).pdf' && head(pdf1.files[0], 4) === '%PDF'
      && png.files.length === 1 && head(png.files[0], 4).slice(1) === 'PNG' && /mim-embedded/.test(fs.readFileSync(html.files[0], 'utf8')),
    names.join('、'));
  // 第 14 段階: 入口の形のまま、グループ枠・縦に重ねる形・レコードの見出しのボタンでレコードの画面を並べ、get_screen の inFrame と get_kintone_app のグループを読む
  const rec = await tool(client, 'add_screen', { design: made.id, name: '詳細', layout: { columns: 3, rows: [
    [{ type: 'recordHead', span: 3, props: { kind: '出張申請' }, buttons: [{ type: 'button', label: '編集' }] }],
    [{ span: 2, stack: [{ frame: '申請の情報', columns: 2, rows: [[{ item: '申請日' }, { item: '申請者' }]] }, { type: 'activity' }] },
      { stack: [{ type: 'table', tableKind: 'related', label: '経費', props: { display: 'tiles', db: '経費', columns: ['日付', '金額'] } }] }],
  ] } });
  const rs = await tool(client, 'get_screen', { design: made.id, screen: rec.screen.id });
  const inFrame = rs.parts.filter((p) => p.inFrame).map((p) => p.inFrame.name);
  const kg = await tool(client, 'get_kintone_app', { design: made.id, screen: '詳細' });
  check('A. グループ枠・縦に重ねる形・見出しのボタンで並べ、get_screen の inFrame と get_kintone_app のグループ（GROUP）を読める（第 14 段階）',
    rs.parts.length === 7 && inFrame.join('・') === 'レコードの見出し・申請の情報・申請の情報' && kg.properties['申請の情報'] && kg.properties['申請の情報'].type === 'GROUP' && kg.layout[0].type === 'GROUP',
    `アイテム ${rs.parts.map((p) => p.type).join('・')} ／ inFrame ${inFrame.join('・')} ／ layout ${kg.layout.map((r) => r.type).join('・')}`);
  // 第 15 段階: 入口の形のまま、レコード一覧のかんばん（後ろの行で作る項目を列に分ける項目に書く）と大きな数字・メーターのグラフを並べ、get_screen と get_kintone_app で読む
  const kb = await tool(client, 'add_screen', { design: made.id, name: '経費の一覧', layout: { columns: 4, rows: [
    [{ type: 'table', tableKind: 'records', label: '経費のかんばん', span: 4, props: { display: 'kanban', columns: ['目的', '金額', '区分'], laneItem: '区分', sumItem: '金額' },
       samples: { 目的: ['展示会の下見', '研修'], 金額: [1200, 800], 区分: ['交通費', '宿泊費'] } }],
    [{ type: 'graph', label: '今月の経費', props: { chart: 'metric', samples: '今月の経費, 2000', unit: '円' } },
     { type: 'graph', label: '予算の消化', props: { chart: 'gauge', samples: '消化, 60', target: '100', unit: '%' } }],
    [{ item: '金額', type: 'number' }, { item: '区分', type: 'dropdown', props: { options: ['交通費', '宿泊費'] } }],
  ] } });
  const ks = await tool(client, 'get_screen', { design: made.id, screen: kb.screen.id });
  const ksTable = ks.parts.find((p) => p.type === 'table');
  const kk = await tool(client, 'get_kintone_app', { design: made.id });
  const kWarn = kk.warnings.join('\n');
  check('A. レコード一覧のかんばんと大きな数字・メーターのグラフを並べ、get_screen と get_kintone_app の warnings で読める（第 15 段階）',
    !!ksTable && /かんばん/.test(JSON.stringify(ksTable)) && ks.parts.filter((p) => p.type === 'graph').length === 2
      && /レコード一覧のかんばん/.test(kWarn) && /（大きな数字）は、kintone のグラフの種類にない/.test(kWarn) && /（メーター）は、kintone のグラフの種類にない/.test(kWarn),
    `アイテム ${ks.parts.map((p) => p.type).join('・')} ／ warnings ${kk.warnings.length} 件`);
  // 第 8 段階の道具（ステータスの移り方と画面の移り方）
  const tl = await client.listTools();
  const NEW_TOOLS = ['edit_process', 'get_flow', 'get_view_image', 'list_systems', 'get_system', 'create_system', 'update_system', 'add_to_system', 'remove_from_system', 'set_swimlane',
    'list_materials', 'read_material', 'swimlane_from_bdm', 'get_notes', 'update_notes', 'set_stage', 'export_system_doc', 'export_bdm', 'get_kintone_app'];
  check(`A. 道具は ${TOOL_COUNT} 個（第 8 段階の edit_process・get_flow・get_view_image と、第 9 段階のシステムの 7 個・資料の 3 個、第 10 段階の設計ノートの 3 個・説明書の 1 個、第 11 段階の MPD への出力の 1 個、第 13 段階の kintone のアプリの形の 1 個を含む）`,
    tl.tools.length === TOOL_COUNT && NEW_TOOLS.every((n) => tl.tools.some((x) => x.name === n)), `${tl.tools.length} 個`);
  await tool(client, 'edit_process', { design: made.id, ops: [
    { op: 'set_states', states: ['申請', '承認待ち', '完了'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' },
    { op: 'add_action', name: '承認する', from: '承認待ち', to: '完了', role: '上長' },
  ] });
  await tool(client, 'add_screen', { design: made.id, name: '一覧' });
  await tool(client, 'layout_screen', { design: made.id, screen: '一覧', layout: { columns: 1, rows: [{ align: 'right', parts: [{ type: 'button', label: '＋ 新規申請', style: 'primary', to: made.firstScreen.id }] }] } });
  const flow = await tool(client, 'get_flow', { design: made.id });
  const moves = (flow.moves || []).filter((m) => m.to); // 移る先のないボタンは to: null で並ぶ
  check('A. edit_process で書いたステータスと操作、ボタンの移動先を get_flow で読める',
    flow.status && flow.status.states.length === 3 && flow.actions.length === 2 && moves.length === 1 && moves[0].to.screenId === made.firstScreen.id,
    `ステータス ${flow.status ? flow.status.states.length : 0}・操作 ${(flow.actions || []).length}・移動先のあるボタン ${moves.length}`);
  for (const view of ['process', 'screenflow']) {
    const vi = await client.callTool({ name: 'get_view_image', arguments: { design: made.id, view } });
    const vim = vi.content.find((c) => c.type === 'image');
    const vb = vim ? Buffer.from(vim.data, 'base64') : Buffer.alloc(0);
    const [vw, vh] = vb.length > 24 ? [vb.readUInt32BE(16), vb.readUInt32BE(20)] : [0, 0];
    check(`A. get_view_image（${view}）は PNG で、長い辺が 1568 以下`, !vi.isError && vb.subarray(1, 4).toString() === 'PNG' && Math.max(vw, vh) <= 1568 && vw >= 400, `${vw} × ${vh}`);
  }
  await checkSystemTools(client, made);
  const st = await status();
  check('A. 窓は見えていない・裏の起動・ページの準備ができている', st.visible === false && st.background === true && st.pageReady === true && st.clients >= 1, JSON.stringify(st));
  check('A. 前に人が窓を最大化して閉じていても、裏の起動では窓が画面に出ない', st.onScreen === false, `onScreen ${st.onScreen}`);
  const t2 = Date.now();
  const code = await secondLaunch(true);
  const ms2 = Date.now() - t2; // 2 つ目の起動も、PC の負荷が高いとプロセスが消えるまで 1 分ほどかかることがある
  const st2 = await status();
  check('A. 2 つ目の起動（--background）はすぐ終わり、窓を出す印は付かない', code === 0 && st2.showRequested === false && alive(info.pid), `終了コード ${code} ／ showRequested ${st2.showRequested} ／ ${ms2} ms`);
  await closeWindow();
  await sleep(800);
  const again = await tool(client, 'list_designs');
  const st3 = await status();
  check('A. AI がつながっている間の窓の × では、窓を隠して動き続ける', alive(info.pid) && again.total === 1 && st3.visible === false, `designs ${again.total} ／ visible ${st3.visible}`);
  await client.close();
  const q = await waitAppQuit(info.pid, IDLE_MS + 15000, 'A. 入口を閉じた後にアプリが終わる');
  check('A. 入口を閉じると、5 秒たってアプリが終わり始め（automation.json が消え）、プロセスも消える', q.begin >= IDLE_MS - 500, quitDetail(q));
}

// 第 9 段階の道具（システム）を 1 回ずつ呼ぶ: 作る・役割を足す・画面設計を入れる・スイムレーンを書く・読む・図の画像・外す
async function checkSystemTools(client, made) {
  const ys = await tool(client, 'create_system', { name: '出張申請システム（確かめ）', description: '確かめの見本' });
  await tool(client, 'update_system', { system: ys.id, expect: ys.updatedAt, ops: [{ op: 'add', name: '申請者' }, { op: 'add', name: '上長', memo: '課長以上' }] });
  await tool(client, 'add_to_system', { system: ys.id, design: made.id });
  const sw = await tool(client, 'set_swimlane', { system: ys.id, steps: [
    { key: 's', role: '申請者', kind: 'start', text: '始まり' },
    { key: 'in', role: '申請者', kind: 'input', text: '申請を入力する', ref: { design: made.id, screen: made.firstScreen.id } },
    { key: 'ok', role: '上長', kind: 'decision', text: '承認する' },
  ], edges: [{ from: 's', to: 'in' }, { from: 'in', to: 'ok', label: '出す' }] });
  const gs = await tool(client, 'get_system', { system: ys.id });
  const ls = await tool(client, 'list_systems');
  const saved = (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).systems || []).find((y) => y.id === ys.id);
  check('A. システムを作り、役割・画面設計・スイムレーンを書くと、get_system・list_systems で読め、designs.json に残る（第 9 段階）',
    gs.roles.length === 2 && gs.designs.length === 1 && gs.steps.length === 3 && gs.edges.length === 2 && sw.steps.map((s) => s.col).join(',') === '0,1,2'
      && ls.systems.some((y) => y.id === ys.id) && !!saved && saved.swimlane.steps.length === 3 && saved.revisions.some((r) => r.kind === 'ai'),
    `役割 ${gs.roles.length}・画面設計 ${gs.designs.length}・工程 ${gs.steps.length}・矢印 ${gs.edges.length}・列 ${sw.steps.map((s) => s.col).join(',')}`);
  const vi = await client.callTool({ name: 'get_view_image', arguments: { system: ys.id, view: 'swimlane' } });
  const vim = vi.content.find((c) => c.type === 'image');
  const vb = vim ? Buffer.from(vim.data, 'base64') : Buffer.alloc(0);
  const [vw, vh] = vb.length > 24 ? [vb.readUInt32BE(16), vb.readUInt32BE(20)] : [0, 0];
  check('A. get_view_image（swimlane）は PNG で、長い辺が 1568 以下', !vi.isError && vb.subarray(1, 4).toString() === 'PNG' && Math.max(vw, vh) <= 1568 && vw >= 400, `${vw} × ${vh}`);
  const rm = await tool(client, 'remove_from_system', { system: ys.id, design: made.id });
  const after = await tool(client, 'get_system', { system: ys.id });
  check('A. remove_from_system で外しても、画面設計は残る', rm.design.id === made.id && after.designs.length === 0 && (await tool(client, 'list_designs')).designs.some((d) => d.id === made.id));
}

async function phaseB() {
  const { client, transport } = await openEntry();
  const t0 = Date.now();
  const list = await tool(client, 'list_designs');
  const info = appInfo();
  lastPid = info && info.pid;
  check('B. 次の入口でアプリをまた起動し、前に作った画面設計が一覧に出る', list.designs.some((d) => d.name === '出張申請（確かめ）'), `${Date.now() - t0} ms`);
  process.kill(transport.pid);
  const q = await waitAppQuit(info.pid, IDLE_MS + 15000, 'B. 入口を強制終了した後にアプリが終わる');
  check('B. 入口を強制終了しても、5 秒たってアプリが終わり始め（automation.json が消え）、プロセスも消える', q.begin >= IDLE_MS - 500, quitDetail(q));
  await client.close().catch(() => {});
}

async function phaseC() {
  const { client } = await openEntry();
  await tool(client, 'list_designs');
  const info = appInfo();
  lastPid = info && info.pid;
  const t2 = Date.now();
  const code = await secondLaunch(false);
  const ms2 = Date.now() - t2;
  const st = await status();
  check('C. 2 つ目の起動（--background なし）では、窓を出す印が付く', code === 0 && st.showRequested === true, `終了コード ${code} ／ showRequested ${st.showRequested} ／ ${ms2} ms`);
  await client.close();
  await sleep(IDLE_MS + 2000);
  check('C. 人がアプリを起動した後は、入口を閉じても終わらない', alive(info.pid) && !!appInfo());
  await closeWindow();
  const q = await waitAppQuit(info.pid, 15000, 'C. 窓の × でアプリが終わる');
  check('C. AI のつながりがないときの窓の × では、アプリが終わる', !appInfo() && !alive(info.pid), quitDetail(q));
}

// fs.rmSync は使わない（Windows の Node v24.12.0 で日本語の名前のファイルを渡すと Node ごと落ちる。出力のファイルは日本語の名前）
function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.lstatSync(p).isDirectory()) removeDir(p);
    else if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

(async () => {
  removeDir(BASE);
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(WINDOW_STATE));
  try {
    const env = { openEntry, check, appInfo, waitUntil, waitAppQuit, quitDetail, setLastPid: (pid) => { lastPid = pid; }, USER_DATA, STATE_FILE, IDLE_MS, TOOL_COUNT, EXPORT_DIR };
    if (!ONLY) {
      await phaseA();
      await phaseB();
      await phaseC();
    }
    if (wants('materials')) await phaseMaterials(env);
    if (wants('notes')) await phaseNotes(env);
    const kept = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
    check('窓を出さなかった起動では、覚えた窓の状態（最大化）を書き換えない', kept.isMaximized === true && kept.width === WINDOW_STATE.width, JSON.stringify(kept));
  } catch (err) {
    check('途中で止まった', false, err.stack || String(err));
  } finally {
    // 途中で止まったときに残ったアプリを終わらせる（automation.json が消えた後で止まったときは、lastPid でしか分からない）
    const info = appInfo();
    for (const pid of new Set([info && info.pid, lastPid])) {
      if (pid && alive(pid)) { try { process.kill(pid); } catch (_) { /* もう終わっている */ } }
    }
  }
  console.log(results.every(Boolean) ? 'OK' : 'NG');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
