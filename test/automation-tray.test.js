'use strict';
// タスクトレイ（automation-tray.js）と「AI とつなぐ」の登録の文（automation-connect.js）のテスト（第 7 段階の T10。Node だけで動く）。
// トレイを本当に出すのは Electron が要るので、出すか・点・文の決め方と、アイコンの PNG を確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { trayModel, trayIconPng, iconPixels, ICON_SIZES } = require('../automation-tray');
const { connectInfo, claudeAddCommand, mcpServerEntry } = require('../automation-connect');

test('トレイのアイコン: AI がつながっている間と、窓が見えていない間だけ出す（q48 の表）', () => {
  const cc = [{ session: 's-1', client: 'claude-code' }];
  // 人が起動した（AI はつながっていない）: 出さない
  assert.equal(trayModel({ clients: [], visible: true }).show, false);
  // 人が起動し、AI もつながっている: 紫の点
  const both = trayModel({ clients: cc, visible: true });
  assert.deepEqual([both.show, both.dot], [true, true]);
  assert.equal(both.tooltip, 'モックイメージメーカー\nAI と連携しています（Claude Code）');
  assert.equal(both.connected, '連携している AI：Claude Code');
  // AI が起動した（裏だけで動いている）: 紫の点・窓は閉じている
  const bg = trayModel({ clients: cc, visible: false });
  assert.equal(bg.tooltip, 'モックイメージメーカー\nAI と連携しています（Claude Code）\nウィンドウは閉じています。押すと開きます。');
  // 窓を閉じた後で AI が切れた（30 秒たつと終わる）: 点なし
  const left = trayModel({ clients: [], visible: false });
  assert.deepEqual([left.show, left.dot], [true, false]);
  assert.equal(left.connected, '連携している AI はありません');
  // 2 つ・知らない名前はそのまま・空は「AI」
  const two = trayModel({ clients: [...cc, { client: 'cursor' }, { client: '' }], visible: true });
  assert.equal(two.connected, '連携している AI：Claude Code・cursor・AI');
  assert.ok(trayModel({ clients: Array.from({ length: 20 }, () => ({ client: 'x'.repeat(40) })), visible: false }).tooltip.length <= 127, 'Windows の上限 127 字');
});

// PNG の中身を読む（IHDR の大きさと、IDAT をほどいた画素）
function readPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  const chunks = {};
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    assert.equal(buf.readUInt32BE(o + 8 + len), zlib.crc32(buf.subarray(o + 4, o + 8 + len)) >>> 0, `${type} の CRC`);
    chunks[type] = Buffer.concat([chunks[type] || Buffer.alloc(0), data]);
    o += 12 + len;
  }
  return { width: chunks.IHDR.readUInt32BE(0), height: chunks.IHDR.readUInt32BE(4), raw: zlib.inflateSync(chunks.IDAT), end: 'IEND' in chunks };
}

test('トレイのアイコン: 16・24・32 ドットの PNG。紺の四角に白い画面、AI がつながっている間は右下に紫の点', () => {
  assert.deepEqual(ICON_SIZES.map(([s]) => s), [16, 24, 32]);
  for (const [size] of ICON_SIZES) {
    const png = readPng(trayIconPng(size, true));
    assert.deepEqual([png.width, png.height, png.end], [size, size, true]);
    assert.equal(png.raw.length, (size * 4 + 1) * size);
  }
  const px = (buf, size, x, y) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const plain = iconPixels(32, false);
  const dot = iconPixels(32, true);
  assert.equal(px(plain, 32, 0, 0)[3], 0, '角は透明（角丸）');
  assert.deepEqual(px(plain, 32, 3, 16), [31, 47, 79, 255], '縁は紺');
  assert.deepEqual(px(plain, 32, 16, 13), [255, 255, 255, 255], '真ん中は白い画面');
  assert.deepEqual(px(plain, 32, 22, 22), [255, 255, 255, 255], '点なしの右下は画面の白');
  assert.deepEqual(px(dot, 32, 22, 22), [124, 58, 237, 255], '点ありの右下は紫');
});

test('「AI と連携」の登録の文: インストールした版は MockImageMaker.exe を Node として動かし、app.asar の中の入口を渡す', () => {
  const where = { packaged: true, execPath: 'C:\\Users\\o\'neil\\AppData\\Local\\Programs\\mockimagemaker\\MockImageMaker.exe', resourcesPath: 'C:\\Users\\o\'neil\\AppData\\Local\\Programs\\mockimagemaker\\resources', root: 'X' };
  const info = connectInfo(where);
  assert.equal(info.dev, false);
  assert.equal(info.serverName, 'mockimagemaker');
  // --env を --scope の前に置く（--env は後ろの値をいくつでも取るため）。「--」は使わない。' は '' にする
  assert.equal(info.claudeCommand, "claude mcp add --env ELECTRON_RUN_AS_NODE=1 --scope user mockimagemaker 'C:\\Users\\o''neil\\AppData\\Local\\Programs\\mockimagemaker\\MockImageMaker.exe' 'C:\\Users\\o''neil\\AppData\\Local\\Programs\\mockimagemaker\\resources\\app.asar\\mcp-server.js'");
  assert.doesNotMatch(info.claudeCommand, / -- /);
  const json = JSON.parse(info.json);
  assert.deepEqual(json, { mcpServers: { mockimagemaker: { command: where.execPath, args: [`${where.resourcesPath}\\app.asar\\mcp-server.js`], env: { ELECTRON_RUN_AS_NODE: '1' } } } });
});

test('「AI と連携」の登録の文: 開発版は別の名前（mockimagemaker-dev）で、node で作業フォルダの入口を動かす', () => {
  const info = connectInfo({ packaged: false, execPath: 'E', resourcesPath: 'R', root: 'C:\\work\\MockImageMaker' });
  assert.equal(info.dev, true);
  assert.equal(info.claudeCommand, "claude mcp add --scope user mockimagemaker-dev node 'C:\\work\\MockImageMaker\\mcp-server.js'");
  assert.deepEqual(JSON.parse(info.json), { mcpServers: { 'mockimagemaker-dev': { command: 'node', args: ['C:\\work\\MockImageMaker\\mcp-server.js'] } } });
  assert.equal(claudeAddCommand(mcpServerEntry({ packaged: false, root: 'D:\\a b' })), "claude mcp add --scope user mockimagemaker-dev node 'D:\\a b\\mcp-server.js'");
});

test('「AI と連携」の登録の文: 場所は、動いている OS でなく、渡された場所の形（Windows は「\\」・ほかは「/」）でつなぐ', () => {
  // CI（Linux）で Windows の場所を渡しても、Windows（手元）で Linux の場所を渡しても崩れない
  assert.deepEqual(mcpServerEntry({ packaged: false, root: '/home/u/MockImageMaker' }).args, ['/home/u/MockImageMaker/mcp-server.js']);
  assert.deepEqual(mcpServerEntry({ packaged: true, execPath: '/opt/mim/MockImageMaker', resourcesPath: '/opt/mim/resources' }).args, ['/opt/mim/resources/app.asar/mcp-server.js']);
  assert.deepEqual(mcpServerEntry({ packaged: false, root: 'C:/work/MockImageMaker' }).args, ['C:\\work\\MockImageMaker\\mcp-server.js']);
  assert.deepEqual(mcpServerEntry({ packaged: false, root: '\\\\server\\share\\MockImageMaker' }).args, ['\\\\server\\share\\MockImageMaker\\mcp-server.js']);
});
