// 使い方: node tools/check-mcp.js
// AI の入口（mcp-server.js --dev）を公式の SDK の Client で起動してつなぎ、入口が Electron のアプリを裏で起動して使えるかを確かめる（第 7 段階の T9）。
// アプリは窓を出さない（MIM_HEADLESS=1）。入口がアプリを起動するときの文は MIM_APP_CMD で差し替え、メインプロセスの inspector を開ける
// （窓の × は、check-electron と同じく BrowserWindow.close() を inspector から呼んで再現する。ページの window.close() は close の知らせを通らないため）。
//  A. 最初の頼みで、アプリを --background で起動する（かかった時間を出す）。画面設計を作って部品を並べると、designs.json に残る。
//     status で、窓が見えていない・裏の起動・ページの準備ができている。2 つ目の起動（--background）では窓を出す印が付かない。
//     AI がつながっている間の窓の ×（BrowserWindow.close()）では、窓を隠して動き続ける。入口を閉じると、5 秒（MIM_IDLE_QUIT_MS）たって終わり、automation.json が消える
//  B. 次の入口で、アプリをまた起動し、A で作った画面設計が一覧に出る。入口を強制終了しても、5 秒たってアプリが終わる
//  C. 2 つ目の起動（--background なし。人がアプリを起動した）では窓を出す印が付き、入口を閉じても終わらない。AI のつながりがないときの窓の × では終わる
// 保存先は作業フォルダの .devdata/check-mcp（毎回消してから始める）。
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
const BASE = path.join(ROOT, '.devdata', 'check-mcp');
const USER_DATA = path.join(BASE, 'userData');
const EXPORT_DIR = path.join(BASE, 'export');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
const MAIN_PORT = 9337; // メインプロセスの inspector（check-electron・check-export の 9333〜9335 と分ける）
const IDLE_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'NG'} ${label}${detail ? ' … ' + detail : ''}`); };

const ENV = {
  MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA, MIM_AI_EXPORT_DIR: EXPORT_DIR, MIM_IDLE_QUIT_MS: String(IDLE_MS),
  MIM_APP_CMD: JSON.stringify([electronPath, ROOT, `--inspect=${MAIN_PORT}`]), MIM_TIMEOUT_MS: '40000',
};

async function openEntry() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp-server.js'), '--dev'], env: ENV, stderr: 'pipe' });
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
  const child = spawn(electronPath, [ROOT, ...(background ? ['--background'] : [])], { env, stdio: 'ignore', windowsHide: true });
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
  const st = await status();
  check('A. 窓は見えていない・裏の起動・ページの準備ができている', st.visible === false && st.background === true && st.pageReady === true && st.clients >= 1, JSON.stringify(st));
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
  try {
    await phaseA();
    await phaseB();
    await phaseC();
  } catch (err) {
    check('途中で止まった', false, err.stack || String(err));
  } finally {
    const info = appInfo();
    if (info && alive(info.pid)) { try { process.kill(info.pid); } catch (_) { /* もう終わっている */ } }
  }
  console.log(results.every(Boolean) ? 'OK' : 'NG');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
