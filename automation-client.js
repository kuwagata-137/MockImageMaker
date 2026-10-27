// automation-client.js — AI の入口（mcp-server.js）の側の、アプリへのつなぎ役（第 7 段階）
// 役割:
//  - <userData>/automation.json を読み、名前付きパイプにつないで合言葉を名乗る（hello）
//  - アプリが動いていなければ、--background で 1 回だけ起動し、つながるまで待つ（最大 30 秒）
//  - 頼みを送り、id の合う返事を待つ。送った後に切れたら、読む頼みだけ 1 回やり直す（書く頼みは、入ったか分からないのでやり直さない）
// つなぐのは最初の頼みのとき（AI のアプリを起動するたびに、裏のアプリが立ち上がらないように）。
// 設計は AI設計基盤_設計書.md の 7-3・7-4。やりとりの決まりは automation-protocol.js。
'use strict';

const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./automation-protocol');

const ROOT = __dirname;
const RETRY_MS = 300; // つなぎ直す間隔
const LAUNCH_WAIT_MS = 30000; // 起動してからつながるまで待つ長さ
const HELLO_WAIT_MS = 5000;
const REQUEST_MS = 60000; // アプリの側の時間切れ（automation.js）と同じ
const SLOW_MS = 300000;
const MARGIN_MS = 15000; // アプリの側が時間切れを返すのを待つ余り（アプリの列の余り automation.js の QUEUE_GRACE_MS 10 秒より長くする）

class AppLinkError extends Error {
  constructor(code, message, { fatal = false } = {}) {
    super(message);
    this.code = code;
    this.fatal = fatal; // つなぎ直しても直らない（版が違う・起動できない）
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// アプリを起動するときの環境変数。ELECTRON_RUN_AS_NODE は大文字小文字を問わず外す（付いたままだと、アプリも Node として動くため）
function childEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
}

// どのアプリにつなぐか。app.asar の中から動いているならインストールした版、ほかは開発版（npm start と同じ保存先）。
// テストでは MIM_APP_CMD（JSON の配列。例 ["node","fake-app.js"]）で起動するものを差し替える（そのときは黒い窓を出さない）
function appTarget({ dirname = ROOT, env = process.env, execPath = process.execPath } = {}) {
  const custom = env.MIM_APP_CMD ? JSON.parse(env.MIM_APP_CMD) : null;
  const installed = /[\\/]app\.asar([\\/]|$)/i.test(dirname);
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  // インストールした版の保存先は、窓を出さない確かめの起動（MIM_HEADLESS=1）のときだけ MIM_USER_DATA で変えられる（main.js と同じ）
  const installedData = env.MIM_HEADLESS === '1' && env.MIM_USER_DATA ? path.resolve(env.MIM_USER_DATA) : path.join(appData, 'MockImageMaker');
  return {
    mode: installed ? 'installed' : 'dev',
    userData: installed ? installedData : env.MIM_USER_DATA || path.join(ROOT, '.devdata', 'userData'),
    hide: !!custom,
    cwd: installed ? path.dirname(execPath) : ROOT,
    // 開発版の Electron の場所は、起動するときに初めて調べる（require('electron') は Node で動くとき、Electron の exe の場所を返す）
    command: () => {
      if (custom) return [...custom, '--background'];
      return installed ? [execPath, '--background'] : [require('electron'), ROOT, '--background'];
    },
  };
}

function createAppLink({ target, session, clientName = () => '', launchWaitMs = LAUNCH_WAIT_MS, env = process.env }) {
  let conn = null; // { socket, pending: Map<id, { resolve, reject }>, hello }
  let opening = null;
  let nextId = 0;

  function launch() {
    return new Promise((resolve) => {
      let cmd;
      try {
        cmd = target.command();
      } catch (err) {
        resolve(err);
        return;
      }
      const child = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', env: childEnv(env), cwd: target.cwd, windowsHide: target.hide });
      child.once('error', resolve);
      child.once('spawn', () => {
        child.unref();
        resolve(null);
      });
    });
  }

  // パイプにつなぎ、hello の返事を待つ。返事の前に切れたら（合言葉が違う・アプリが終わった）、つなぎ直せる失敗にする
  function connect(info) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(info.pipe);
      const c = { socket, pending: new Map(), hello: null };
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new AppLinkError('no_answer', 'アプリがあいさつに応えません。')), HELLO_WAIT_MS);
      socket.once('error', (err) => fail(new AppLinkError('connect', `アプリに接続できません（${err.code || err.message}）。`)));
      socket.on('close', () => {
        fail(new AppLinkError('closed', 'アプリが接続を切りました。'));
        for (const p of c.pending.values()) p.reject(new AppLinkError('disconnected', 'アプリとの接続が切れました。'));
        c.pending.clear();
        if (conn === c) conn = null;
      });
      socket.on('error', () => {}); // つないだ後の失敗は close で扱う
      P.readLines(socket, (msg) => {
        if (msg && msg.type === 'hello') {
          if (done) return;
          if (msg.ok) {
            done = true;
            clearTimeout(timer);
            resolve(c);
          } else {
            const e = msg.error || {};
            fail(new AppLinkError(e.code || 'hello', e.message || 'アプリに接続できません。', { fatal: e.code === 'protocol' }));
          }
          return;
        }
        const p = msg && c.pending.get(msg.id);
        if (!p) return;
        c.pending.delete(msg.id);
        p.resolve(msg);
      });
      socket.once('connect', () => {
        P.sendLine(socket, { type: 'hello', token: info.token, protocol: P.PROTOCOL, session, client: clientName() || null });
      });
    });
  }

  // automation.json を読んでつなぐ。つなげなければアプリを 1 回だけ起動し、つながるまで待つ
  async function open() {
    const deadline = Date.now() + launchWaitMs;
    let launched = false;
    let last = null;
    for (;;) {
      const info = P.readAutomationFile(target.userData);
      if (info) {
        try {
          return await connect(info);
        } catch (err) {
          if (err.fatal) throw err;
          last = err;
        }
      }
      if (!launched) {
        launched = true;
        const err = await launch();
        if (err) throw new AppLinkError('launch', `モックイメージメーカーを起動できませんでした（${err.message}）。インストールしてあるかを確かめてください。`, { fatal: true });
      }
      if (Date.now() >= deadline) {
        throw new AppLinkError('no_app', `モックイメージメーカーに接続できませんでした${last ? `（${last.message}）` : ''}。アプリを起動してから、もう一度依頼してください。`);
      }
      await sleep(RETRY_MS);
    }
  }

  async function ensure() {
    if (conn && !conn.socket.destroyed) return conn;
    if (!opening) {
      opening = open().then((c) => (conn = c)).finally(() => { opening = null; });
    }
    return opening;
  }

  function send(c, tool, args, slow) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        c.pending.delete(id);
        reject(new AppLinkError('timeout', P.TIMEOUT_MESSAGE));
      }, (slow ? SLOW_MS : REQUEST_MS) + MARGIN_MS);
      c.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      if (!P.sendLine(c.socket, { id, tool, args })) {
        c.pending.delete(id);
        clearTimeout(timer);
        reject(Object.assign(new AppLinkError('disconnected', 'アプリとの接続が切れました。'), { notSent: true }));
      }
    });
  }

  // 戻り値はアプリの返事 { id, ok, result?, image?, error? }。つなげない・切れた・時間切れは AppLinkError を投げる
  async function call(tool, args, { slow = false, write = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const c = await ensure();
      try {
        return await send(c, tool, args || {}, slow);
      } catch (err) {
        if (err.code !== 'disconnected') throw err;
        if (!err.notSent && (write || attempt >= 1)) {
          throw new AppLinkError('disconnected', write
            ? 'アプリとの接続が、依頼を送った後に切れました。変更が入ったかは分かりません。読み直して確かめてから、もう一度依頼してください。'
            : 'アプリとの接続が切れました。もう一度依頼してください。');
        }
        if (attempt >= 2) throw err;
      }
    }
  }

  function close() {
    if (conn) conn.socket.destroy();
    conn = null;
  }

  return { call, close, connected: () => !!(conn && !conn.socket.destroyed) };
}

module.exports = { appTarget, createAppLink, childEnv, AppLinkError };
