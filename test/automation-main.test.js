'use strict';
// automation-main.js（main とページの橋・終わる時計）と automation-render.js（AI の書き出しの仕上げ）のテスト。
// Electron は使わない。app・ipcMain・窓は身代わりを渡す（終わる時計は MIM_IDLE_QUIT_MS で縮める。開発版〔isPackaged: false〕だけ読む）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initAutomation } = require('../automation-main');
const { createRenderFinisher } = require('../automation-render');

const ROOT = path.join(__dirname, '..', '.devdata');
let dirSeq = 0;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDir() {
  const dir = path.join(ROOT, `test-automation-main-${process.pid}-${++dirSeq}`);
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

// 身代わりの窓。isVisible は Electron の Windows 版と同じく、最小化していると false を返す
function fakeWindow({ shown = true, minimized = false } = {}) {
  const win = {
    shown,
    minimized,
    isDestroyed: () => false,
    isVisible: () => win.shown && !win.minimized,
    isMinimized: () => win.minimized,
    webContents: { on() {}, once() {}, send() {}, isDestroyed: () => false },
  };
  return win;
}

// 終わる時計を 60ms にして initAutomation を始める。戻り値の quits() は app.quit() を呼んだ回数
async function startAutomation(t, { win, background = false }) {
  const dir = makeDir();
  const saved = process.env.MIM_IDLE_QUIT_MS;
  process.env.MIM_IDLE_QUIT_MS = '60';
  let quits = 0;
  const app = { isPackaged: false, getPath: () => dir, on() {}, quit: () => { quits++; } };
  const automation = initAutomation({ app, ipcMain: { on() {}, handle() {} }, getWindow: () => win, background, headless: false, appVersion: '1.00', renderer: {} });
  if (saved === undefined) delete process.env.MIM_IDLE_QUIT_MS;
  else process.env.MIM_IDLE_QUIT_MS = saved;
  t.after(async () => {
    await automation.stop();
    removeDir(dir);
  });
  return { automation, quits: () => quits };
}

test('人の窓を最小化しているだけなら、AI のつながりが 0 でも終わる時計を回さない', async (t) => {
  const win = fakeWindow({ shown: true, minimized: true });
  const { automation, quits } = await startAutomation(t, { win });
  automation.windowCreated();
  await delay(250);
  assert.equal(automation.windowVisible(), true);
  assert.equal(quits(), 0);
});

test('× で隠した窓は、最小化したままでも見えていないとみなし、終わる時計で終わる', async (t) => {
  const win = fakeWindow({ shown: true, minimized: true });
  const { automation, quits } = await startAutomation(t, { win });
  automation.windowCreated();
  win.shown = false; // 窓の × で hide() した（hide の知らせ）
  automation.windowShownOrHidden(false);
  await delay(250);
  assert.equal(automation.windowVisible(), false);
  assert.equal(quits(), 1);
});

test('--background の起動は、窓を出すまで見えていないとみなし、出したら見えているとみなす', async (t) => {
  const win = fakeWindow({ shown: false });
  const { automation, quits } = await startAutomation(t, { win, background: true });
  automation.windowCreated();
  assert.equal(automation.windowVisible(), false);
  win.shown = true; // 窓を出した（show の知らせ）
  automation.windowShownOrHidden(true);
  await delay(250);
  assert.equal(automation.windowVisible(), true);
  assert.equal(quits(), 0);
});

test('AI の書き出しが途中で失敗したときは、書けたファイルの場所を失敗の文に入れる', async (t) => {
  const dir = makeDir();
  t.after(() => removeDir(dir));
  const saved = process.env.MIM_AI_EXPORT_DIR;
  process.env.MIM_AI_EXPORT_DIR = dir;
  t.after(() => {
    if (saved === undefined) delete process.env.MIM_AI_EXPORT_DIR;
    else process.env.MIM_AI_EXPORT_DIR = saved;
  });
  const renderer = {
    renderPng: async ({ html }) => {
      if (html === 'bad') throw new Error('描けない');
      return Buffer.from('PNG');
    },
  };
  const { finish } = createRenderFinisher({ app: { isPackaged: false, getPath: () => dir }, renderer, headless: true });
  const res = await finish({
    ok: true,
    result: {},
    render: { kind: 'png', files: [{ name: '顧客管理_01_一覧.png', html: 'ok', width: 10, height: 10 }, { name: '顧客管理_02_詳細.png', html: 'bad', width: 10, height: 10 }] },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'render_failed');
  const written = path.join(dir, '顧客管理_01_一覧.png');
  assert.ok(fs.existsSync(written));
  assert.match(res.error.message, /描けない/);
  assert.ok(res.error.message.includes(written), res.error.message);
});
