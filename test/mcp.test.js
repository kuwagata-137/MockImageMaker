'use strict';
// AI の入口（mcp-server.js・automation-client.js・mcp-tools.js）のテスト（第 7 段階の T8。設計書の 14 章）。
// 公式の SDK の Client で入口を node で起動してつなぎ、アプリの代わりに、このテストの中で受け口（createAutomationServer）を動かす。
// アプリを起動させる場面は、MIM_APP_CMD で身代わり（test/fixtures/fake-app.js など。黒い窓は出さない）を起動させる。Electron は使わない。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const P = require('../automation-protocol');
const { createAutomationServer } = require('../automation');
const { TOOLS } = require('../mcp-tools');
const SC = require('../mcp-schemas');
const { bootApp } = require('./harness');

const REPO = path.join(__dirname, '..');
const ENTRY = path.join(REPO, 'mcp-server.js');
const BASE = path.join(REPO, '.devdata');
const CLIENT_NAME = 'mcp-test';
const NOOP_APP = JSON.stringify([process.execPath, '-e', '0', '--']); // 起動しても何もしない身代わり
let dirSeq = 0;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const isJa = (s) => /[぀-ヿ一-鿿]/.test(s);

function makeDir(t) {
  const dir = path.join(BASE, `test-mcp-${process.pid}-${++dirSeq}`);
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

// 入口を起動して SDK の Client でつなぐ
async function openEntry(t, userData, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, '--dev'],
    env: { MIM_USER_DATA: userData, MIM_APP_CMD: NOOP_APP, MIM_TIMEOUT_MS: '3000', ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: CLIENT_NAME, version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const textOf = (res) => res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// アプリの代わりの受け口（このテストの中で動かす）
async function startApp(t, dir, onRequest, opts = {}) {
  const calls = [];
  const srv = createAutomationServer({ dir, appVersion: 'test', onRequest: async (r) => { calls.push(r); return onRequest(r, calls.length); }, ...opts });
  await srv.start();
  t.after(() => srv.stop());
  return { srv, calls };
}

test('道具は 17 個で、説明は日本語。入口の道具は、read_guide のほかはページの AI_TOOLS とぴったり同じ', () => {
  assert.equal(TOOLS.length, 17);
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z_]+$/, t.name);
    assert.ok(isJa(t.description) && isJa(t.title), `${t.name} の説明が日本語でない`);
  }
  const html = fs.readFileSync(path.join(REPO, 'mock_v1.00.html'), 'utf8');
  const block = html.match(/const AI_TOOLS = \{([\s\S]*?)\n\};/)[1];
  const page = [...block.matchAll(/^\s+([a-z_]+): \{ write/mg)].map((m) => m[1]);
  // 入口だけにあるのは read_guide（入口の中で返す）だけ
  assert.deepEqual(TOOLS.map((t) => t.name).filter((n) => n !== 'read_guide').sort(), [...page].sort());
  // 読むだけの道具（readOnlyHint）は、ページで write: false の道具と同じ。ただし export_design はファイルを書くので読むだけにしない
  const readOnly = [...block.matchAll(/^\s+([a-z_]+): \{ write: false/mg)].map((m) => m[1]).filter((n) => n !== 'export_design').sort();
  assert.deepEqual(TOOLS.filter((t) => t.readOnly && !t.local).map((t) => t.name).sort(), readOnly);
  // 時間のかかる道具は、アプリの側（automation-main.js の SLOW_TOOLS。時間切れを 5 分にする）と同じ
  const { SLOW_TOOLS } = require('../automation-main');
  assert.deepEqual(TOOLS.filter((t) => t.slow).map((t) => t.name).sort(), [...SLOW_TOOLS].sort());
});

test('入口の選べる値（機器・表の中身・吹き出しの色と線の先・揃え方）は、ページの値とそろう', async () => {
  const app = bootApp();
  const T = await app.api();
  const cat = JSON.parse(JSON.stringify(await T.aiDispatch('get_catalog', {}, {}))).result;
  assert.deepEqual(Object.keys(cat.devices), SC.DEVICES);
  assert.deepEqual(Object.keys(cat.tableKinds), SC.TABLE_KINDS);
  assert.deepEqual(Object.keys(cat.callout.colors), SC.CALLOUT_COLORS);
  assert.deepEqual(Object.keys(cat.callout.tips), SC.CALLOUT_TIPS);
  app.close();
  const html = fs.readFileSync(path.join(REPO, 'mock_v1.00.html'), 'utf8');
  const align = JSON.parse(html.match(/const AI_ALIGN = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(align, SC.ALIGN_HOW);
});

test('アプリがなくても、道具の一覧・read_guide・resources は返り、アプリを起動しない。道具を呼ぶと 1 回だけ起動し、つなげなければ日本語で断る', async (t) => {
  const dir = makeDir(t);
  const marker = path.join(dir, 'launched.txt');
  const app = JSON.stringify([process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(marker)}, 'x')`, '--']);
  const client = await openEntry(t, dir, { MIM_APP_CMD: app, MIM_TIMEOUT_MS: '1500' });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 17);
  assert.ok(tools.every((x) => x.inputSchema && x.inputSchema.type === 'object'));
  const g = await call(client, 'read_guide', { topic: 'overview' });
  assert.match(textOf(g), /^# モックイメージメーカーの使い方/);
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), ['mim://guide/catalog', 'mim://guide/layout', 'mim://guide/overview', 'mim://guide/rules']);
  const rr = await client.readResource({ uri: 'mim://guide/rules' });
  assert.match(rr.contents[0].text, /^# 守ること/);
  assert.equal(fs.existsSync(marker), false, 'まだ起動していない');
  const r = await call(client, 'list_designs');
  assert.equal(r.isError, true);
  assert.match(textOf(r), /モックイメージメーカーにつなげませんでした/);
  assert.match(textOf(r), /"code":"no_app"/);
  await delay(200);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'x', '1 回だけ起動した');
});

test('頼みはそのまま届き、session（入口ごとに 1 つ）と AI のアプリの名前が付く。返事は JSON の文字', async (t) => {
  const dir = makeDir(t);
  const { srv, calls } = await startApp(t, dir, (r) => ({ ok: true, result: { echo: r.args, n: 1 } }));
  const client = await openEntry(t, dir);
  const r1 = await call(client, 'list_designs', { query: '顧客' });
  assert.equal(r1.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(r1)), { echo: { query: '顧客' }, n: 1 });
  await call(client, 'get_design', { design: 'd1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, 'list_designs');
  assert.deepEqual(calls[1].args, { design: 'd1' });
  assert.match(calls[0].session, /^[0-9a-f-]{36}$/);
  assert.equal(calls[1].session, calls[0].session);
  assert.equal(calls[0].client, CLIENT_NAME);
  assert.equal(srv.clientCount(), 1, 'つないだままにする（アプリの紫の札・終わる時計に使う）');
});

test('断る返事は isError で、日本語の文と code・候補が付く。画像の返事は PNG の image で返す', async (t) => {
  const dir = makeDir(t);
  await startApp(t, dir, (r) => {
    if (r.tool === 'get_screen_image') return { ok: true, result: { width: 1280 }, image: 'iVBORw0KGgo=' };
    return { ok: false, error: { code: 'ambiguous', message: '「顧客」という画面設計が 2 つあります。id で指してください。', candidates: [{ id: 'd1', name: '顧客' }, { id: 'd9', name: '顧客' }] } };
  });
  const client = await openEntry(t, dir);
  const bad = await call(client, 'get_design', { design: '顧客' });
  assert.equal(bad.isError, true);
  const [msg, extra] = textOf(bad).split('\n');
  assert.equal(msg, '「顧客」という画面設計が 2 つあります。id で指してください。');
  assert.deepEqual(JSON.parse(extra), { code: 'ambiguous', candidates: [{ id: 'd1', name: '顧客' }, { id: 'd9', name: '顧客' }] });
  const img = await call(client, 'get_screen_image', { design: 'd1', screen: 's1' });
  assert.deepEqual(img.content[0], { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  assert.deepEqual(JSON.parse(img.content[1].text), { width: 1280 });
});

test('入力の形に合わない頼み（知らない欄・知らない操作）は、アプリへ送らずに断る', async (t) => {
  const dir = makeDir(t);
  const { calls } = await startApp(t, dir, () => ({ ok: true, result: {} }));
  const client = await openEntry(t, dir);
  const typo = await call(client, 'edit_parts', { design: 'd1', screen: 's1', ops: [{ op: 'update', part: 1, lable: '顧客名' }] });
  assert.equal(typo.isError, true);
  assert.match(textOf(typo), /lable/);
  const unknown = await call(client, 'edit_items', { design: 'd1', ops: [{ op: 'erase', item: 'x' }] });
  assert.equal(unknown.isError, true);
  const extraTop = await call(client, 'list_designs', { quary: '顧客' });
  assert.equal(extraTop.isError, true);
  assert.equal(calls.length, 0);
});

test('合言葉が違うと、つなげないまま時間内に断る', async (t) => {
  const dir = makeDir(t);
  const { srv } = await startApp(t, dir, () => ({ ok: true, result: {} }));
  const file = path.join(dir, P.AUTOMATION_FILE);
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...info, token: 'x'.repeat(64) }));
  const client = await openEntry(t, dir, { MIM_TIMEOUT_MS: '1500' });
  const r = await call(client, 'list_designs');
  assert.equal(r.isError, true);
  assert.match(textOf(r), /"code":"no_app"/);
  assert.equal(srv.clientCount(), 0);
});

test('protocol が違うと「アプリの版が変わりました」と返し、アプリを起動し直さない', async (t) => {
  const dir = makeDir(t);
  const pipe = P.pipePathFor(P.newPipeId(), dir);
  const fake = net.createServer((s) => {
    P.readLines(s, () => P.sendLine(s, { type: 'hello', ok: false, error: { code: 'protocol', message: 'アプリの版が変わりました。AI のアプリを起動し直してください。' } }));
    s.on('error', () => {});
  });
  await new Promise((r) => fake.listen(pipe, r));
  t.after(() => new Promise((r) => fake.close(r)));
  fs.writeFileSync(path.join(dir, P.AUTOMATION_FILE), JSON.stringify({ pipe, token: 't', pid: 1, protocol: 999 }));
  const marker = path.join(dir, 'launched.txt');
  const client = await openEntry(t, dir, { MIM_APP_CMD: JSON.stringify([process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`, '--']) });
  const r = await call(client, 'list_designs');
  assert.equal(r.isError, true);
  assert.match(textOf(r), /^アプリの版が変わりました。AI のアプリを起動し直してください。/);
  assert.match(textOf(r), /"code":"protocol"/);
  await delay(200);
  assert.equal(fs.existsSync(marker), false);
});

test('アプリが終わって起動し直したら、次の頼みでつなぎ直す', async (t) => {
  const dir = makeDir(t);
  const a1 = await startApp(t, dir, () => ({ ok: true, result: { from: 1 } }));
  const client = await openEntry(t, dir);
  assert.deepEqual(JSON.parse(textOf(await call(client, 'list_designs'))), { from: 1 });
  await a1.srv.stop();
  await startApp(t, dir, () => ({ ok: true, result: { from: 2 } }));
  assert.deepEqual(JSON.parse(textOf(await call(client, 'list_designs'))), { from: 2 });
});

test('頼みを送った後に切れたら、読む頼みは 1 回やり直し、書く頼みはやり直さない', async (t) => {
  const dir = makeDir(t);
  // 1 つ目の受け口は、頼みを受けると止まり（返事を返さずに切る）、2 つ目の受け口を始める
  const relay = async (tool) => {
    const second = { calls: [] };
    const a1 = await startApp(t, dir, async () => {
      await a1.srv.stop();
      const a2 = await startApp(t, dir, (r) => ({ ok: true, result: { from: 2, tool: r.tool } }));
      second.calls = a2.calls;
      second.srv = a2.srv;
      return new Promise(() => {});
    });
    const client = await openEntry(t, dir, { MIM_TIMEOUT_MS: '5000' });
    const res = await call(client, tool, tool === 'create_design' ? { name: '出張申請' } : {});
    await client.close();
    if (second.srv) await second.srv.stop();
    return { res, first: a1.calls, second: second.calls };
  };
  const rd = await relay('list_designs');
  assert.equal(rd.res.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(rd.res)), { from: 2, tool: 'list_designs' });
  assert.equal(rd.first.length, 1);
  assert.equal(rd.second.length, 1);
  const wr = await relay('create_design');
  assert.equal(wr.res.isError, true);
  assert.match(textOf(wr.res), /変更が入ったかは分かりません/);
  assert.equal(wr.first.length, 1);
  assert.equal(wr.second.length, 0);
});

test('アプリが動いていなければ --background で起動し、ELECTRON_RUN_AS_NODE を渡さない', async (t) => {
  const dir = makeDir(t);
  const app = JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-app.js')]);
  const client = await openEntry(t, dir, { MIM_APP_CMD: app, MIM_TIMEOUT_MS: '15000', ELECTRON_RUN_AS_NODE: '1' });
  const r = await call(client, 'list_designs', { query: '顧客' });
  const out = JSON.parse(textOf(r));
  t.after(() => { try { process.kill(out.pid); } catch (_) { /* もう終わっている */ } });
  assert.deepEqual(out.argv, ['--background']);
  assert.equal(out.runAsNode, null);
  assert.equal(out.tool, 'list_designs');
  assert.equal(out.client, CLIENT_NAME);
  await client.close();
  try { process.kill(out.pid); } catch (_) { /* もう終わっている */ }
  await delay(300);
});

test('標準出力には JSON-RPC の行だけが出る。標準入力が閉じたら入口は終わる', async (t) => {
  const dir = makeDir(t);
  const child = spawn(process.execPath, [ENTRY, '--dev'], { env: { ...process.env, MIM_USER_DATA: dir, MIM_APP_CMD: NOOP_APP }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT_NAME, version: '1' } } });
  const until = Date.now() + 10000;
  while (!out.includes('"id":1')) { if (Date.now() > until) throw new Error('initialize の返事が来ない'); await delay(20); }
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  while (!out.includes('"id":2')) { if (Date.now() > until) throw new Error('tools/list の返事が来ない'); await delay(20); }
  const lines = out.split('\n').filter((l) => l.trim());
  lines.forEach((l) => assert.equal(JSON.parse(l).jsonrpc, '2.0', l.slice(0, 80)));
  const init = JSON.parse(lines[0]);
  assert.equal(init.result.serverInfo.name, 'mockimagemaker');
  assert.ok(isJa(init.result.instructions));
  const exited = new Promise((r) => child.once('exit', r));
  child.stdin.end();
  const code = await Promise.race([exited, delay(5000).then(() => 'timeout')]);
  assert.equal(code, 0);
});

test('入口のつなぎ先: インストールした版は APPDATA の MockImageMaker。保存先を変えられるのは、窓を出さない確かめの起動（MIM_HEADLESS=1）のときだけ', () => {
  const { appTarget } = require('../automation-client');
  const inst = path.join(BASE, 'fake-install', 'mockimagemaker'); // 架空のインストール先（読まない）
  const asar = path.join(inst, 'resources', 'app.asar');
  const exe = path.join(inst, 'MockImageMaker.exe');
  const env = { APPDATA: path.join(BASE, 'fake-appdata') };
  const t = appTarget({ dirname: asar, env, execPath: exe });
  assert.equal(t.mode, 'installed');
  assert.equal(t.userData, path.join(env.APPDATA, 'MockImageMaker'));
  assert.deepEqual(t.command(), [exe, '--background']);
  const other = path.join(BASE, 'fake-data');
  assert.equal(appTarget({ dirname: asar, env: { ...env, MIM_USER_DATA: other } }).userData, path.join(env.APPDATA, 'MockImageMaker'), 'MIM_USER_DATA だけでは変えない');
  assert.equal(appTarget({ dirname: asar, env: { ...env, MIM_USER_DATA: other, MIM_HEADLESS: '1' } }).userData, other);
  const dev = appTarget({ dirname: REPO, env: { MIM_USER_DATA: other } });
  assert.deepEqual([dev.mode, dev.userData], ['dev', other]);
});
