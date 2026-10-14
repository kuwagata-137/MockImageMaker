// automation.js — メインプロセス側の、AI の入口（mcp-server.js）からの頼みの受け口（第 7 段階）
// 役割:
//  - 起動ごとに乱数の名前のパイプ（Windows は名前付きパイプ、ほかは Unix ソケット）と合言葉を作って待ち受け、<userData>/automation.json に書く
//  - つないだ客の最初の 1 行（hello）で合言葉と protocol を確かめる。合言葉が違えば何も返さずに切る
//  - 頼みは全部の客をまたいで 1 本の列に並べ、1 つずつ onRequest（ページの AI の窓口への橋）に渡し、返事に id を付けて返す
//  - 1 つの頼みに時間切れを付ける（ふつう 60 秒・isSlow の頼み〔書き出しなど〕は 5 分）
//  - AI の書き出しを、同じ名前のファイルを上書きせずに書く（writeUnique）
// Electron には頼らない（main との結び付けは、後でこのファイルに足す）。やりとりの決まりは automation-protocol.js。
// 設計は AI設計基盤_設計書.md の 7-3・7-5・8-7。ログは環境変数 MIM_AUTOMATION_LOG=1 のときだけ console.error に出す。
'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const P = require('./automation-protocol');

const fsp = fs.promises;
const IS_WIN = process.platform === 'win32';
const CLOSE_GRACE_MS = 1000; // protocol が違うと知らせた後、相手が切るのを待つ時間
const UNIQUE_MAX = 999; // writeUnique で番号を付ける上限
const MSG = {
  protocol: 'アプリの版が変わりました。AI のアプリを起動し直してください。',
  timeout: 'アプリが応えません（時間切れ）。',
};
const TIMEOUT = Symbol('timeout');
const STOPPED = Symbol('stopped');

const log = (...a) => {
  if (process.env.MIM_AUTOMATION_LOG) console.error('[automation]', ...a);
};
const errText = (err) => String((err && err.message) || err);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (id) => (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id));
const failure = (id, code, message) => ({ id, ok: false, error: { code, message } });

// 合言葉を、かかる時間から中身を推し量られないように比べる（長さが違えば違うとみなす）
function tokenMatches(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(token, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function removeSocketFile(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    log('ソケットのファイルを消せません', errText(err));
  }
}

function listen(srv, pipe) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(pipe, () => {
      srv.removeListener('error', reject);
      resolve();
    });
  });
}

// onRequest の返事 { ok, result?, image?, error? } に id を付ける（返事の中の id は使わない）
function answerFor(id, outcome) {
  if (outcome === TIMEOUT) return failure(id, 'timeout', MSG.timeout);
  if ('error' in outcome) return failure(id, 'internal', `アプリの中で失敗しました（${errText(outcome.error)}）。`);
  if (!isPlainObject(outcome.value)) return failure(id, 'internal', 'アプリの中で失敗しました（返事の形が正しくありません）。');
  const { id: _ignored, ...rest } = outcome.value;
  return { id, ...rest, ok: rest.ok === true };
}

function createAutomationServer({
  dir, appVersion, onRequest, onClientsChanged, onStatus, isSlow,
  helloTimeoutMs = 5000, requestTimeoutMs = 60000, slowTimeoutMs = 300000, maxLineBytes = P.MAX_LINE_BYTES,
} = {}) {
  if (!dir) throw new TypeError('dir が要ります。');
  if (typeof onRequest !== 'function') throw new TypeError('onRequest が要ります。');

  let server = null;
  let info = null; // { pipe, token }
  let starting = null;
  const conns = new Set(); // { socket, ready, closing, session, client, timer }
  let queue = []; // 待っている頼み { conn, id, tool, args, session, client }
  let running = null; // 実行中の頼み

  const readyConns = () => [...conns].filter((c) => c.ready);
  const clients = () => readyConns().map((c) => ({ session: c.session, client: c.client }));
  const clientCount = () => readyConns().length;
  const inflight = () => queue.length + (running ? 1 : 0);

  function clientsChanged() {
    if (!onClientsChanged) return;
    try {
      onClientsChanged(clientCount(), clients());
    } catch (err) {
      log('onClientsChanged で失敗しました', errText(err));
    }
  }

  function reply(conn, obj) {
    try {
      P.sendLine(conn.socket, obj);
    } catch (err) {
      P.sendLine(conn.socket, failure(obj.id, 'internal', `返事を JSON にできませんでした（${errText(err)}）。`));
    }
  }

  function statusInfo() {
    try {
      return onStatus ? onStatus() : {};
    } catch (err) {
      log('onStatus で失敗しました', errText(err));
      return {};
    }
  }

  // ── 頼みの列（全部の客で 1 本。1 つずつ実行する）──────────────
  function timeoutFor(tool) {
    try {
      return isSlow && isSlow(tool) ? slowTimeoutMs : requestTimeoutMs;
    } catch (_) {
      return requestTimeoutMs;
    }
  }

  async function runJob(job) {
    let timer;
    const limit = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutFor(job.tool));
      job.cancel = () => resolve(STOPPED);
    });
    const work = Promise.resolve()
      .then(() => onRequest({ tool: job.tool, args: job.args, session: job.session, client: job.client }))
      .then((value) => ({ value }), (error) => ({ error }));
    const outcome = await Promise.race([work, limit]);
    clearTimeout(timer);
    if (outcome !== STOPPED) reply(job.conn, answerFor(job.id, outcome)); // 客が切れていれば sendLine は何もしない
  }

  // 時間切れのときは、onRequest の終わりを待たずに次へ進む
  function pump() {
    if (running || !queue.length || !server) return;
    const job = queue.shift();
    running = job;
    runJob(job)
      .catch((err) => log('頼みの実行で失敗しました', errText(err)))
      .finally(() => {
        if (running === job) running = null;
        pump();
      });
  }

  // ── つながり ─────────────────────────────────────────────
  function onHello(conn, msg) {
    clearTimeout(conn.timer);
    if (!info || !isPlainObject(msg) || msg.type !== 'hello' || !tokenMatches(msg.token, info.token)) {
      conn.socket.destroy(); // 合言葉が違う・hello の前に頼みが来た: 何も返さずに切る
      return;
    }
    if (msg.protocol !== P.PROTOCOL) {
      reply(conn, { type: 'hello', ok: false, error: { code: 'protocol', message: MSG.protocol } });
      conn.closing = true;
      conn.socket.end();
      conn.timer = setTimeout(() => conn.socket.destroy(), CLOSE_GRACE_MS);
      return;
    }
    conn.ready = true;
    conn.session = msg.session === undefined ? null : msg.session;
    conn.client = msg.client === undefined ? null : msg.client;
    reply(conn, { type: 'hello', ok: true, appVersion, protocol: P.PROTOCOL });
    clientsChanged();
  }

  function badRequest(conn, id, message) {
    reply(conn, failure(validId(id) ? id : undefined, 'bad_request', message));
  }

  function onLine(conn, msg) {
    if (conn.closing) return;
    if (!conn.ready) return onHello(conn, msg);
    if (!isPlainObject(msg)) return badRequest(conn, undefined, '頼みの形が正しくありません（JSON のオブジェクトで送ってください）。');
    if (msg.type === 'status') return reply(conn, { type: 'status', ...statusInfo(), clients: clientCount() });
    if (msg.type === 'hello') return badRequest(conn, msg.id, 'あいさつ（hello）はもう済んでいます。');
    if (msg.type !== undefined) return badRequest(conn, msg.id, `知らない type です: ${String(msg.type)}`);
    if (!validId(msg.id)) return badRequest(conn, undefined, '頼みに id がありません。');
    if (typeof msg.tool !== 'string' || !msg.tool) return badRequest(conn, msg.id, '頼みに tool（道具の名前）がありません。');
    if (msg.args !== undefined && !isPlainObject(msg.args)) return badRequest(conn, msg.id, 'args は JSON のオブジェクトで送ってください。');
    queue.push({
      conn,
      id: msg.id,
      tool: msg.tool,
      args: msg.args || {},
      session: msg.session === undefined ? conn.session : msg.session,
      client: msg.client === undefined ? conn.client : msg.client,
    });
    pump();
  }

  function onBadLine(conn, err) {
    if (conn.socket.destroyed || conn.closing) return;
    if (!conn.ready) return conn.socket.destroy();
    log('読めない行', errText(err));
    badRequest(conn, undefined, 'JSON として読めない行です。');
  }

  // 切れたら、その客の待っている頼みを列から外す（実行中のものは最後まで実行し、返事は捨てる）
  function onClose(conn) {
    if (!conns.delete(conn)) return;
    clearTimeout(conn.timer);
    queue = queue.filter((j) => j.conn !== conn);
    if (conn.ready) clientsChanged();
  }

  function onConnection(socket) {
    if (!server) return socket.destroy(); // 止めている途中に届いたつながり
    const conn = { socket, ready: false, closing: false, session: null, client: null, timer: null };
    conns.add(conn);
    socket.on('error', (err) => log('つながりの失敗', errText(err)));
    socket.on('close', () => onClose(conn));
    conn.timer = setTimeout(() => socket.destroy(), helloTimeoutMs);
    P.readLines(socket, (msg) => onLine(conn, msg), { maxBytes: maxLineBytes, onError: (err) => onBadLine(conn, err) });
  }

  // ── 始める・止める ────────────────────────────────────────
  async function doStart() {
    const token = P.newToken();
    const pipe = P.pipePathFor(P.newPipeId(), dir);
    await fsp.mkdir(dir, { recursive: true });
    if (!IS_WIN) removeSocketFile(pipe); // 前に落ちたときのソケットが残っていれば消す
    const srv = net.createServer(onConnection);
    await listen(srv, pipe);
    srv.on('error', (err) => log('待ち受けの失敗', errText(err)));
    if (!IS_WIN) {
      try {
        fs.chmodSync(pipe, 0o600); // ほかのユーザーにはつながせない
      } catch (_) { /* 合言葉で守れる */ }
    }
    server = srv;
    info = { pipe, token };
    try {
      await P.writeAutomationFile(dir, { pipe, token, pid: process.pid, appVersion, protocol: P.PROTOCOL, startedAt: new Date().toISOString() });
    } catch (err) {
      await shutdown(); // stop() は starting（この関数）の終わりを待つので、ここでは呼ばない
      throw err;
    }
    return { pipe, token };
  }

  // 始めている途中なら、その終わり（automation.json を書き終えた後）を返す
  function start() {
    if (starting) return starting;
    if (server && info) return Promise.resolve({ ...info });
    starting = doStart().finally(() => { starting = null; });
    return starting;
  }

  // 新しいつながりを断り、今のつながりを全部閉じ、automation.json（自分の pid のときだけ）とソケットのファイルを消す
  async function stop() {
    if (starting) await starting.catch(() => {});
    await shutdown();
  }

  async function shutdown() {
    const srv = server;
    if (!srv) return;
    server = null;
    P.removeAutomationFile(dir, process.pid);
    queue = [];
    if (running && running.cancel) running.cancel();
    const closed = new Promise((resolve) => srv.close(() => resolve()));
    for (const c of conns) c.socket.destroy();
    await closed;
    if (!IS_WIN && info) removeSocketFile(info.pipe);
    info = null;
  }

  return { start, stop, clientCount, inflight, clients };
}

// AI の書き出しを dir に書く。同じ名前のファイルがあれば「名前 (2).拡張子」「名前 (3).拡張子」… にする（上書きしない）。書いた道を返す。
// name はファイルの名前だけ（フォルダの区切りを含む名前は断る。決めたフォルダの外へ書かないため。設計書 8-7）
async function writeUnique(dir, name, data) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || path.basename(name) !== name) {
    throw new Error(`ファイルの名前が正しくありません: ${name}`);
  }
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; n <= UNIQUE_MAX; n++) {
    const file = path.join(dir, n === 1 ? name : `${base} (${n})${ext}`);
    try {
      await fsp.writeFile(file, data, { flag: 'wx' });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`同じ名前のファイルが多すぎて書けません: ${name}`);
}

module.exports = { createAutomationServer, writeUnique };
