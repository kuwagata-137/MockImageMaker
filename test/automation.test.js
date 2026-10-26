'use strict';
// automation-protocol.js（パイプのやりとりの決まり）と automation.js（パイプの受け口）のテスト。
// Electron は使わない。客は net.connect でつなぎ、readLines・sendLine で話す。
// Windows では名前付きパイプ、ほかでは Unix ソケット（道は pipePathFor で分かれる）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { once } = require('events');
const P = require('../automation-protocol');
const { createAutomationServer, writeUnique } = require('../automation');

const ROOT = path.join(__dirname, '..', '.devdata');
let dirSeq = 0;
let sessionSeq = 0;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDir() {
  const dir = path.join(ROOT, `test-automation-${process.pid}-${++dirSeq}`);
  fs.mkdirSync(dir, { recursive: true });
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

async function waitFor(cond, ms = 3000, what = '条件') {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`${what}が時間内にそろいませんでした`);
    await delay(10);
  }
}

// 客（AI の入口の身代わり）。届いた行は inbox に溜まり、next() で 1 つずつ取る
function openClient(pipe) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    const inbox = [];
    let closed = false;
    const closedP = new Promise((r) => socket.on('close', () => { closed = true; r(); }));
    socket.once('error', reject);
    P.readLines(socket, (m) => inbox.push(m));
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      socket.on('error', () => {});
      resolve({
        inbox,
        closed: closedP,
        isClosed: () => closed,
        send: (obj) => P.sendLine(socket, obj),
        sendRaw: (text) => socket.write(text),
        async next(ms = 3000) {
          await waitFor(() => inbox.length || closed, ms, '返事');
          if (!inbox.length) throw new Error('返事の前に切れました');
          return inbox.shift();
        },
        close() {
          socket.destroy();
          return closedP;
        },
      });
    });
  });
}

async function startServer(t, opts = {}) {
  const dir = makeDir();
  const srv = createAutomationServer({
    dir,
    appVersion: '1.00',
    onRequest: async ({ tool, args }) => ({ ok: true, result: { tool, args } }),
    ...opts,
  });
  const info = await srv.start();
  t.after(async () => {
    await srv.stop();
    removeDir(dir);
  });
  return { srv, info, dir };
}

const hello = (info, extra = {}) => ({ type: 'hello', token: info.token, protocol: P.PROTOCOL, session: `s-${++sessionSeq}`, client: 'test', ...extra });

async function greet(info, extra = {}) {
  const c = await openClient(info.pipe);
  c.send(hello(info, extra));
  const r = await c.next();
  assert.equal(r.ok, true);
  return c;
}

// 切れるまで待つ（切れなければ失敗）
async function expectClosed(c, ms = 3000) {
  await Promise.race([c.closed, delay(ms).then(() => { throw new Error('切れませんでした'); })]);
}

test('pipePathFor・newPipeId・newToken', () => {
  const id = P.newPipeId();
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.notEqual(P.newPipeId(), id);
  assert.match(P.newToken(), /^[0-9a-f]{64}$/);
  assert.notEqual(P.newToken(), P.newToken());
  if (process.platform === 'win32') {
    assert.equal(P.pipePathFor(id, ROOT), `\\\\.\\pipe\\mockimagemaker-${id}`);
  } else {
    assert.equal(P.pipePathFor(id, '/d'), `/d/mim-${id}.sock`);
    // 道が長すぎるときは、ソケットの道の長さの上限に収まる所に置く
    const long = P.pipePathFor(id, path.join(ROOT, 'a'.repeat(120)));
    assert.ok(Buffer.byteLength(long) <= 100, long);
    assert.ok(long.endsWith(`mim-${id}.sock`));
  }
});

test('start で automation.json ができ、stop で消える', async (t) => {
  const { srv, info, dir } = await startServer(t);
  const file = path.join(dir, P.AUTOMATION_FILE);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['appVersion', 'pid', 'pipe', 'protocol', 'startedAt', 'token']);
  assert.equal(saved.pipe, info.pipe);
  assert.equal(saved.token, info.token);
  assert.equal(saved.pid, process.pid);
  assert.equal(saved.appVersion, '1.00');
  assert.equal(saved.protocol, P.PROTOCOL);
  assert.ok(!Number.isNaN(Date.parse(saved.startedAt)));
  assert.match(info.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(P.readAutomationFile(dir), saved);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  if (process.platform !== 'win32') assert.ok(fs.existsSync(info.pipe));

  await srv.stop();
  assert.equal(fs.existsSync(file), false);
  if (process.platform !== 'win32') assert.equal(fs.existsSync(info.pipe), false);
  await assert.rejects(openClient(info.pipe));
  await srv.stop(); // 2 回目は何もしない
});

test('start を 2 回呼ぶと同じパイプを返す。start の途中で stop しても、止まった状態で終わる', async (t) => {
  const { srv, info, dir } = await startServer(t);
  assert.deepEqual(await srv.start(), info);
  await srv.stop();

  const starting = srv.start();
  await srv.stop();
  const again = await starting;
  assert.notEqual(again.token, info.token);
  assert.equal(P.readAutomationFile(dir), null);
  await assert.rejects(openClient(again.pipe));
});

test('automation.json を書けないと start は失敗し、待ち受けを閉じる（後で start し直せる）', async (t) => {
  const dir = makeDir();
  const srv = createAutomationServer({ dir, appVersion: '1.00', onRequest: async () => ({ ok: true }) });
  t.after(async () => {
    await srv.stop();
    removeDir(dir);
  });
  const blocker = path.join(dir, P.AUTOMATION_FILE);
  fs.mkdirSync(blocker); // 同じ名前のフォルダがあると rename できない
  const outcome = await Promise.race([srv.start().then(() => 'ok', (err) => err), delay(3000).then(() => 'stuck')]);
  assert.ok(outcome instanceof Error, `start の結果: ${String(outcome)}`);
  assert.equal(srv.clientCount(), 0);
  assert.deepEqual(fs.readdirSync(dir), [P.AUTOMATION_FILE]); // tmp が残らない

  fs.rmdirSync(blocker);
  const info = await srv.start();
  const c = await greet(info);
  c.send({ id: 1, tool: 'x' });
  assert.deepEqual(await c.next(), { id: 1, ok: true });
});

test('正しい hello で ok:true が返り、客の数が onClientsChanged で知らされる', async (t) => {
  const changes = [];
  const { srv, info } = await startServer(t, { onClientsChanged: (n, list) => changes.push({ n, list }) });
  const c = await openClient(info.pipe);
  c.send(hello(info, { session: 'sess-1', client: 'claude-code' }));
  assert.deepEqual(await c.next(), { type: 'hello', ok: true, appVersion: '1.00', protocol: P.PROTOCOL });
  await waitFor(() => changes.length === 1, 3000, '1 回目の知らせ');
  assert.deepEqual(changes[0], { n: 1, list: [{ session: 'sess-1', client: 'claude-code' }] });
  assert.equal(srv.clientCount(), 1);
  assert.deepEqual(srv.clients(), [{ session: 'sess-1', client: 'claude-code' }]);

  await c.close();
  await waitFor(() => changes.length === 2, 3000, '2 回目の知らせ');
  assert.deepEqual(changes[1], { n: 0, list: [] });
  assert.equal(srv.clientCount(), 0);
});

test('合言葉が違うと、返事なしで切れる', async (t) => {
  const changes = [];
  const { info } = await startServer(t, { onClientsChanged: (n) => changes.push(n) });
  const last = info.token.slice(-1) === '0' ? '1' : '0';
  const wrongs = [info.token.slice(0, -1) + last, 'abc', undefined, 12345];
  for (const token of wrongs) {
    const c = await openClient(info.pipe);
    c.send(hello(info, { token }));
    await expectClosed(c);
    assert.deepEqual(c.inbox, [], `合言葉 ${token}`);
  }
  assert.deepEqual(changes, []);
});

test('protocol が違うと、code protocol と日本語の文が来て切れる', async (t) => {
  const { srv, info } = await startServer(t);
  const c = await openClient(info.pipe);
  c.send(hello(info, { protocol: P.PROTOCOL + 1 }));
  assert.deepEqual(await c.next(), {
    type: 'hello',
    ok: false,
    error: { code: 'protocol', message: 'アプリの版が変わりました。AI のアプリを起動し直してください。' },
  });
  await expectClosed(c);
  assert.equal(srv.clientCount(), 0);
});

test('hello が来ないと helloTimeoutMs で切れる。hello の前に頼み・status が来ても切れる', async (t) => {
  const { info } = await startServer(t, { helloTimeoutMs: 200 });
  const t0 = Date.now();
  const silent = await openClient(info.pipe);
  await expectClosed(silent);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 150 && elapsed < 2500, `切れるまで ${elapsed}ms`);
  assert.deepEqual(silent.inbox, []);

  // hello の前に頼みが来たら、hello の待ち時間（ここでは 30 秒）を待たずに切る
  const patient = await startServer(t, { helloTimeoutMs: 30000 });
  for (const first of [{ id: 1, tool: 'list_designs' }, { type: 'status' }, 'not json']) {
    const c = await openClient(patient.info.pipe);
    if (first === 'not json') c.sendRaw('not json\n');
    else c.send(first);
    await expectClosed(c);
    assert.deepEqual(c.inbox, []);
  }
});

test('頼みは全部の客をまたいで 1 つずつ順に実行する', async (t) => {
  let active = 0;
  let maxActive = 0;
  const started = [];
  const { srv, info } = await startServer(t, {
    onRequest: async ({ args, session, client }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      started.push(args.name);
      await delay(args.ms);
      active--;
      return { ok: true, result: { name: args.name, session, client } };
    },
  });
  const a = await greet(info, { session: 'A', client: 'ai-a' });
  const b = await greet(info, { session: 'B', client: 'ai-b' });
  a.send({ id: 1, tool: 'work', args: { name: 'a1', ms: 400 } });
  await waitFor(() => started.length === 1, 3000, 'a1 の開始');
  b.send({ id: 'x', tool: 'work', args: { name: 'b1', ms: 30 } });
  await waitFor(() => srv.inflight() === 2, 3000, 'b1 が並ぶこと');
  a.send({ id: 2, tool: 'work', args: { name: 'a2', ms: 30 }, session: 'A2' });
  await waitFor(() => srv.inflight() === 3, 3000, 'a2 が並ぶこと');

  assert.deepEqual(await a.next(), { id: 1, ok: true, result: { name: 'a1', session: 'A', client: 'ai-a' } });
  assert.deepEqual(await b.next(), { id: 'x', ok: true, result: { name: 'b1', session: 'B', client: 'ai-b' } });
  assert.deepEqual(await a.next(), { id: 2, ok: true, result: { name: 'a2', session: 'A2', client: 'ai-a' } });
  assert.deepEqual(started, ['a1', 'b1', 'a2']);
  assert.equal(maxActive, 1);
  await waitFor(() => srv.inflight() === 0, 3000, '列が空になること');
});

test('客が切れたら、その客の待っている頼みは外す（実行中のものは最後まで実行する）', async (t) => {
  const started = [];
  const finished = [];
  const { srv, info } = await startServer(t, {
    onRequest: async ({ args }) => {
      started.push(args.name);
      await delay(args.ms || 0);
      finished.push(args.name);
      return { ok: true, result: args.name };
    },
  });
  const a = await greet(info);
  const b = await greet(info);
  a.send({ id: 1, tool: 'work', args: { name: 'a1', ms: 300 } });
  await waitFor(() => started.length === 1, 3000, 'a1 の開始');
  a.send({ id: 2, tool: 'work', args: { name: 'a2' } });
  a.send({ id: 3, tool: 'work', args: { name: 'a3' } });
  await waitFor(() => srv.inflight() === 3, 3000, 'a2・a3 が並ぶこと');
  await a.close();
  await waitFor(() => srv.inflight() === 1, 3000, 'a2・a3 が外れること');
  b.send({ id: 1, tool: 'work', args: { name: 'b1' } });
  assert.deepEqual(await b.next(), { id: 1, ok: true, result: 'b1' });
  assert.deepEqual(started, ['a1', 'b1']);
  assert.deepEqual(finished, ['a1', 'b1']);
});

test('時間切れで timeout を返し、次の頼みへ進む。isSlow の頼みは slowTimeoutMs を使う', async (t) => {
  const ran = [];
  const { info } = await startServer(t, {
    requestTimeoutMs: 150,
    slowTimeoutMs: 600,
    isSlow: (tool) => tool.startsWith('export'),
    onRequest: async ({ tool, args }) => {
      ran.push(tool);
      if (args.hang) await new Promise(() => {}); // 応えない
      if (args.ms) await delay(args.ms);
      return { ok: true, result: tool };
    },
  });
  const c = await greet(info);
  const t0 = Date.now();
  c.send({ id: 1, tool: 'hang', args: { hang: true } });
  c.send({ id: 2, tool: 'quick' });
  // 時間切れの文は、頼みが遅れて実行されて変更が入ったかもしれないこと・頼み直す前に読む道具で確かめることを伝える（見直し④-3）。入口（automation-client.js）も同じ文
  const r1 = await c.next();
  assert.deepEqual([r1.id, r1.ok, r1.error.code], [1, false, 'timeout']);
  assert.match(r1.error.message, /時間切れ.*変更が入ったかもしれません.*頼み直す前に.*list_designs/s);
  assert.equal(r1.error.message, require('../automation-protocol').TIMEOUT_MESSAGE);
  const e1 = Date.now() - t0;
  assert.ok(e1 >= 120 && e1 < 550, `時間切れまで ${e1}ms`);
  assert.deepEqual(await c.next(), { id: 2, ok: true, result: 'quick' });

  // isSlow の頼みは 150ms を超えても、600ms までは待つ
  c.send({ id: 3, tool: 'export_pdf', args: { ms: 300 } });
  assert.deepEqual(await c.next(), { id: 3, ok: true, result: 'export_pdf' });
  const t1 = Date.now();
  c.send({ id: 4, tool: 'export_png', args: { hang: true } });
  const r4 = await c.next(3000);
  assert.equal(r4.id, 4);
  assert.equal(r4.error.code, 'timeout');
  const e4 = Date.now() - t1;
  assert.ok(e4 >= 550, `時間切れまで ${e4}ms`);
  assert.deepEqual(ran, ['hang', 'quick', 'export_pdf', 'export_png']);
});

test('列で待つ間に期限（時間切れ＋queueGraceMs）を過ぎた頼みは、実行せずに timeout を返す（入口が時間切れにした後で実行しない）', async (t) => {
  const ran = [];
  const { info } = await startServer(t, {
    requestTimeoutMs: 150,
    slowTimeoutMs: 2000,
    queueGraceMs: 100,
    isSlow: (tool) => tool.startsWith('export'),
    onRequest: async ({ tool, args }) => {
      ran.push(tool);
      if (args.ms) await delay(args.ms);
      return { ok: true, result: tool };
    },
  });
  const a = await greet(info);
  const b = await greet(info);
  a.send({ id: 1, tool: 'export_pdf', args: { ms: 500 } }); // 長い出力が列の先にある
  await delay(20);
  b.send({ id: 2, tool: 'create_design' }); // 150＋100ms を過ぎても順番が来ない
  assert.deepEqual(await a.next(), { id: 1, ok: true, result: 'export_pdf' });
  const r2 = await b.next();
  assert.equal(r2.id, 2);
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, 'timeout');
  assert.match(r2.error.message, /実行していません/);
  assert.deepEqual(ran, ['export_pdf']);
  // 期限の前に順番が来た頼みは、残りの時間で実行する
  a.send({ id: 3, tool: 'export_pdf', args: { ms: 120 } });
  await delay(20);
  b.send({ id: 4, tool: 'quick' });
  assert.deepEqual(await a.next(), { id: 3, ok: true, result: 'export_pdf' });
  assert.deepEqual(await b.next(), { id: 4, ok: true, result: 'quick' });
  assert.deepEqual(ran, ['export_pdf', 'export_pdf', 'quick']);
});

test('onRequest の例外・reject・形の違う返事で code internal', async (t) => {
  const { info } = await startServer(t, {
    onRequest: ({ tool }) => {
      if (tool === 'throw') throw new Error('こわれた');
      if (tool === 'reject') return Promise.reject(new Error('だめだった'));
      if (tool === 'bad') return 42;
      return { ok: true, result: 1, id: 'ignored' };
    },
  });
  const c = await greet(info);
  c.send({ id: 1, tool: 'throw' });
  const r1 = await c.next();
  assert.equal(r1.id, 1);
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, 'internal');
  assert.match(r1.error.message, /アプリの中で/);
  assert.match(r1.error.message, /こわれた/);
  c.send({ id: 2, tool: 'reject' });
  const r2 = await c.next();
  assert.equal(r2.error.code, 'internal');
  assert.match(r2.error.message, /だめだった/);
  c.send({ id: 3, tool: 'bad' });
  const r3 = await c.next();
  assert.equal(r3.id, 3);
  assert.equal(r3.error.code, 'internal');
  c.send({ id: 4, tool: 'fine' });
  assert.deepEqual(await c.next(), { id: 4, ok: true, result: 1 });
});

test('形の違う行には bad_request を返す（id があれば付ける）', async (t) => {
  const ran = [];
  const { info } = await startServer(t, { onRequest: async ({ tool }) => { ran.push(tool); return { ok: true }; } });
  const c = await greet(info);
  const cases = [
    [{ tool: 'x' }, undefined],
    [{ id: 7 }, 7],
    [{ id: 8, tool: 'x', args: [1] }, 8],
    [{ id: 9, tool: 'x', type: 'other' }, 9],
    [[1, 2], undefined],
    [{ id: 10, type: 'hello', token: 'x' }, 10],
  ];
  for (const [line, id] of cases) {
    c.send(line);
    const r = await c.next();
    assert.equal(r.ok, false, JSON.stringify(line));
    assert.equal(r.error.code, 'bad_request');
    assert.equal(typeof r.error.message, 'string');
    assert.equal(r.id, id, JSON.stringify(line));
  }
  c.sendRaw('not json\n');
  const r = await c.next();
  assert.equal(r.error.code, 'bad_request');
  assert.equal('id' in r, false);
  assert.deepEqual(ran, []);
  assert.equal(c.isClosed(), false);
});

test('1 行が大きい（約 5MB）頼みと返事が通る。maxLineBytes を超える行で切れる', async (t) => {
  const big = '顧客管理'.repeat(450000); // UTF-8 で約 5.4MB（1 字 3 バイト）
  const { info } = await startServer(t, {
    onRequest: async ({ args }) => ({ ok: true, result: { len: args.text.length, back: args.text } }),
  });
  const c = await greet(info);
  c.send({ id: 1, tool: 'echo', args: { text: big } });
  const r = await c.next(10000);
  assert.equal(r.ok, true);
  assert.equal(r.result.len, big.length);
  assert.equal(r.result.back === big, true);

  const small = await startServer(t, { maxLineBytes: 1024 });
  const s = await greet(small.info);
  s.send({ id: 1, tool: 'echo', args: { text: 'x'.repeat(2048) } });
  await expectClosed(s);
  assert.deepEqual(s.inbox, []);
});

test('status で客の数と onStatus の中身が返る', async (t) => {
  const { info } = await startServer(t, { onStatus: () => ({ visible: false, mode: 'background' }) });
  const a = await greet(info);
  const b = await greet(info);
  a.send({ type: 'status' });
  assert.deepEqual(await a.next(), { type: 'status', visible: false, mode: 'background', clients: 2 });
  await b.close();
  await delay(50);
  a.send({ type: 'status' });
  assert.deepEqual(await a.next(), { type: 'status', visible: false, mode: 'background', clients: 1 });

  const plain = await startServer(t);
  const c = await greet(plain.info);
  c.send({ type: 'status' });
  assert.deepEqual(await c.next(), { type: 'status', clients: 1 });
});

test('readLines: 字が chunk の境目で切れても読め、JSON でない行は onError へ、上限を超える行で socket を壊す', async (t) => {
  const dir = makeDir();
  const pipe = P.pipePathFor(P.newPipeId(), dir);
  const got = [];
  const errors = [];
  let serverSocket = null;
  const srv = net.createServer((s) => {
    serverSocket = s;
    s.on('error', () => {});
    P.readLines(s, (m) => got.push(m), { maxBytes: 64, onError: (err, line) => errors.push({ err, line }) });
  });
  await new Promise((r) => srv.listen(pipe, r));
  const c = net.connect(pipe);
  c.on('error', () => {});
  t.after(async () => {
    c.destroy();
    await new Promise((r) => srv.close(() => r()));
    removeDir(dir);
  });
  await once(c, 'connect');

  const bytes = Buffer.from(JSON.stringify({ name: '顧客' }) + '\r\n');
  const cut = bytes.indexOf(Buffer.from('顧')) + 1; // 字の途中で切る
  c.write(bytes.subarray(0, cut));
  await delay(30);
  c.write(bytes.subarray(cut));
  c.write('\n{oops\n');
  await waitFor(() => got.length === 1 && errors.length === 1, 3000, '読んだ行');
  assert.deepEqual(got, [{ name: '顧客' }]);
  assert.equal(errors[0].line, '{oops');

  c.write('x'.repeat(100)); // 改行なしで上限を超える
  await once(c, 'close');
  assert.equal(serverSocket.destroyed, true);
  assert.equal(errors.length, 2);
});

test('sendLine は壊れた socket には何もしない', async () => {
  const s = new net.Socket();
  s.destroy();
  assert.equal(P.sendLine(s, { a: 1 }), false);
  assert.equal(P.sendLine(null, { a: 1 }), false);
});

test('removeAutomationFile は自分の pid のファイルだけを消す。readAutomationFile は無い・壊れたファイルで null', async (t) => {
  const dir = makeDir();
  t.after(() => removeDir(dir));
  const file = path.join(dir, P.AUTOMATION_FILE);
  assert.equal(P.readAutomationFile(dir), null);
  const other = { pipe: 'p', token: 't', pid: process.pid + 1, appVersion: '1.00', protocol: P.PROTOCOL, startedAt: new Date().toISOString() };
  await P.writeAutomationFile(dir, other);
  assert.deepEqual(P.readAutomationFile(dir), other);
  assert.deepEqual(fs.readdirSync(dir), [P.AUTOMATION_FILE]); // tmp が残らない
  assert.equal(P.removeAutomationFile(dir, process.pid), false);
  assert.equal(fs.existsSync(file), true);
  assert.equal(P.removeAutomationFile(dir, process.pid + 1), true);
  assert.equal(fs.existsSync(file), false);

  fs.writeFileSync(file, '{broken');
  assert.equal(P.readAutomationFile(dir), null);
  assert.equal(P.removeAutomationFile(dir, process.pid), false);
  assert.equal(fs.existsSync(file), true);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid })); // pipe・token のないファイルも壊れたとみなす
  assert.equal(P.readAutomationFile(dir), null);
});

test('writeUnique: 同じ名前なら「名前 (2).拡張子」「名前 (3).拡張子」にする', async (t) => {
  const dir = path.join(makeDir(), 'AI の出力');
  t.after(() => removeDir(path.dirname(dir)));
  const p1 = await writeUnique(dir, '顧客管理.pdf', Buffer.from('1'));
  const p2 = await writeUnique(dir, '顧客管理.pdf', Buffer.from('2'));
  const p3 = await writeUnique(dir, '顧客管理.pdf', '3');
  assert.equal(p1, path.join(dir, '顧客管理.pdf'));
  assert.equal(p2, path.join(dir, '顧客管理 (2).pdf'));
  assert.equal(p3, path.join(dir, '顧客管理 (3).pdf'));
  assert.equal(fs.readFileSync(p1, 'utf8'), '1');
  assert.equal(fs.readFileSync(p2, 'utf8'), '2');
  assert.equal(fs.readFileSync(p3, 'utf8'), '3');
  const p4 = await writeUnique(dir, '拡張子なし', 'x');
  const p5 = await writeUnique(dir, '拡張子なし', 'y');
  assert.equal(path.basename(p4), '拡張子なし');
  assert.equal(path.basename(p5), '拡張子なし (2)');
  // フォルダの外へ書かない
  for (const bad of ['../外.pdf', 'sub/中.pdf', '', '..']) {
    await assert.rejects(writeUnique(dir, bad, 'x'), /ファイルの名前/);
  }
  if (process.platform === 'win32') await assert.rejects(writeUnique(dir, 'sub\\中.pdf', 'x'), /ファイルの名前/);
});
