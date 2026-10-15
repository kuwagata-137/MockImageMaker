// 使い方: node tools/check-mcp.js [--packaged=<作った版のフォルダ（例 dist/win-unpacked）>]
// AI の入口（mcp-server.js --dev）を公式の SDK の Client で起動してつなぎ、入口が Electron のアプリを裏で起動して使えるかを確かめる（第 7 段階の T9）。
// アプリは窓を出さない（MIM_HEADLESS=1）。入口がアプリを起動するときの文は MIM_APP_CMD で差し替え、メインプロセスの inspector を開ける
// （窓の × は、check-electron と同じく BrowserWindow.close() を inspector から呼んで再現する。ページの window.close() は close の知らせを通らないため）。
//  A. 最初の頼みで、アプリを --background で起動する（かかった時間を出す）。画面設計を作って部品を並べると、designs.json に残る。
//     画面の画像は長い辺が 1568 以下の PNG。書き出し（PDF・PNG・HTML）は MIM_AI_EXPORT_DIR に書き、同じ名前には番号を付ける。
//     道具は 27 個。edit_process でステータスと操作を書き、移る先を持つボタンを並べると、get_flow で読め、get_view_image は PNG（長い辺が 1568 以下。第 8 段階）。
//     システムを作って役割・画面設計・スイムレーンを書くと、get_system・list_systems で読め、designs.json に残り、スイムレーン図の画像は PNG（第 9 段階）。
//     status で、窓が見えていない・裏の起動・ページの準備ができている。2 つ目の起動（--background）では窓を出す印が付かない。
//     前に人が窓を最大化して閉じていても（window-state.json の isMaximized）、裏の起動では窓が画面に出ない（status の onScreen）。
//     AI がつながっている間の窓の ×（BrowserWindow.close()）では、窓を隠して動き続ける。入口を閉じると、5 秒（MIM_IDLE_QUIT_MS）たって終わり、automation.json が消える
//  B. 次の入口で、アプリをまた起動し、A で作った画面設計が一覧に出る。入口を強制終了しても、5 秒たってアプリが終わる
//  C. 2 つ目の起動（--background なし。人がアプリを起動した）では窓を出す印が付き、入口を閉じても終わらない。AI のつながりがないときの窓の × では終わる
//  最後に、窓を出さなかった起動では window-state.json を書き換えていない（人が最大化して使っていたことが残る）
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

const ROOT = path.resolve(__dirname, '..');
const PACKAGED = ((process.argv.find((a) => a.startsWith('--packaged=')) || '').slice(11)) || null;
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
  check('A. 最初の頼みでアプリを裏で起動する', !!info && list.total === 0, `${Date.now() - t0} ms ／ pid ${info && info.pid}`);
  const made = await tool(client, 'create_design', { name: '出張申請（確かめ）', target: 'kintone' });
  await tool(client, 'layout_screen', {
    design: made.id, screen: made.firstScreen.id, expect: made.updatedAt,
    layout: { columns: 2, rows: [[{ item: '申請日', type: 'date' }, { item: '申請者', type: 'user' }], [{ item: '目的', type: 'text2', span: 2 }], { align: 'right', parts: [{ type: 'button', label: '申請する', style: 'primary' }] }] },
  });
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).designs.find((d) => d.id === made.id);
  check('A. 作った画面設計と並べた部品が designs.json に残る', !!saved && saved.screens[0].parts.length === 4 && saved.items.length === 3,
    saved ? `部品 ${saved.screens[0].parts.length} つ・項目 ${saved.items.map((i) => i.name).join('・')}` : 'ない');
  // 画面の画像（PNG。長い辺を 1568 までに縮める）と書き出し（決めたフォルダへ。同じ名前には番号を付ける）
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
  check('A. 書き出しは決めたフォルダに書き、同じ名前のファイルには番号を付ける',
    pdf1.folder === EXPORT_DIR && names[0] === '出張申請（確かめ）.pdf' && names[1] === '出張申請（確かめ） (2).pdf' && head(pdf1.files[0], 4) === '%PDF'
      && png.files.length === 1 && head(png.files[0], 4).slice(1) === 'PNG' && /mim-embedded/.test(fs.readFileSync(html.files[0], 'utf8')),
    names.join('、'));
  // 第 8 段階の道具（ステータスの移り方と画面の移り方）
  const tl = await client.listTools();
  const NEW_TOOLS = ['edit_process', 'get_flow', 'get_view_image', 'list_systems', 'get_system', 'create_system', 'update_system', 'add_to_system', 'remove_from_system', 'set_swimlane'];
  check('A. 道具は 27 個（第 8 段階の edit_process・get_flow・get_view_image と、第 9 段階のシステムの 7 個を含む）',
    tl.tools.length === 27 && NEW_TOOLS.every((n) => tl.tools.some((x) => x.name === n)), `${tl.tools.length} 個`);
  await tool(client, 'edit_process', { design: made.id, ops: [
    { op: 'set_states', states: ['申請', '承認待ち', '完了'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' },
    { op: 'add_action', name: '承認する', from: '承認待ち', to: '完了', role: '上長' },
  ] });
  await tool(client, 'add_screen', { design: made.id, name: '一覧' });
  await tool(client, 'layout_screen', { design: made.id, screen: '一覧', layout: { columns: 1, rows: [{ align: 'right', parts: [{ type: 'button', label: '＋ 新規申請', style: 'primary', to: made.firstScreen.id }] }] } });
  const flow = await tool(client, 'get_flow', { design: made.id });
  const moves = (flow.moves || []).filter((m) => m.to); // 移る先のないボタンは to: null で並ぶ
  check('A. edit_process で書いたステータスと操作、ボタンの移る先を get_flow で読める',
    flow.status && flow.status.states.length === 3 && flow.actions.length === 2 && moves.length === 1 && moves[0].to.screenId === made.firstScreen.id,
    `ステータス ${flow.status ? flow.status.states.length : 0}・操作 ${(flow.actions || []).length}・移る先のあるボタン ${moves.length}`);
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
  const code = await secondLaunch(true);
  const st2 = await status();
  check('A. 2 つ目の起動（--background）はすぐ終わり、窓を出す印は付かない', code === 0 && st2.showRequested === false && alive(info.pid), `終了コード ${code} ／ showRequested ${st2.showRequested}`);
  await closeWindow();
  await sleep(800);
  const again = await tool(client, 'list_designs');
  const st3 = await status();
  check('A. AI がつながっている間の窓の × では、窓を隠して動き続ける', alive(info.pid) && again.total === 1 && st3.visible === false, `designs ${again.total} ／ visible ${st3.visible}`);
  await client.close();
  const ms = await waitUntil(() => !alive(info.pid), IDLE_MS + 15000, 'A. 入口を閉じた後にアプリが終わる');
  check('A. 入口を閉じると、5 秒たってアプリが終わり、automation.json が消える', !appInfo() && ms >= IDLE_MS - 500, `${ms} ms`);
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
    `役割 ${gs.roles.length}・画面設計 ${gs.designs.length}・作業 ${gs.steps.length}・矢印 ${gs.edges.length}・列 ${sw.steps.map((s) => s.col).join(',')}`);
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
  check('B. 次の入口でアプリをまた起動し、前に作った画面設計が一覧に出る', list.designs.some((d) => d.name === '出張申請（確かめ）'), `${Date.now() - t0} ms`);
  process.kill(transport.pid);
  const ms = await waitUntil(() => !alive(info.pid), IDLE_MS + 15000, 'B. 入口を強制終了した後にアプリが終わる');
  check('B. 入口を強制終了しても、5 秒たってアプリが終わり、automation.json が消える', !appInfo() && ms >= IDLE_MS - 500, `${ms} ms`);
  await client.close().catch(() => {});
}

async function phaseC() {
  const { client } = await openEntry();
  await tool(client, 'list_designs');
  const info = appInfo();
  const code = await secondLaunch(false);
  const st = await status();
  check('C. 2 つ目の起動（--background なし）では、窓を出す印が付く', code === 0 && st.showRequested === true, `終了コード ${code} ／ showRequested ${st.showRequested}`);
  await client.close();
  await sleep(IDLE_MS + 2000);
  check('C. 人がアプリを起動した後は、入口を閉じても終わらない', alive(info.pid) && !!appInfo());
  await closeWindow();
  const ms = await waitUntil(() => !alive(info.pid), 15000, 'C. 窓の × でアプリが終わる');
  check('C. AI のつながりがないときの窓の × では、アプリが終わる', !appInfo(), `${ms} ms`);
}

// fs.rmSync は使わない（Windows の Node v24.12.0 で日本語の名前のファイルを渡すと Node ごと落ちる。書き出しのファイルは日本語の名前）
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
    await phaseA();
    await phaseB();
    await phaseC();
    const kept = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
    check('窓を出さなかった起動では、覚えた窓の状態（最大化）を書き換えない', kept.isMaximized === true && kept.width === WINDOW_STATE.width, JSON.stringify(kept));
  } catch (err) {
    check('途中で止まった', false, err.stack || String(err));
  } finally {
    const info = appInfo();
    if (info && alive(info.pid)) { try { process.kill(info.pid); } catch (_) { /* もう終わっている */ } }
  }
  console.log(results.every(Boolean) ? 'OK' : 'NG');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
