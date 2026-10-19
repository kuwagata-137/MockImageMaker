// tools/check-electron-materials.js が使う、Electron のアプリの起動と後始末、待つ・読む小さな関数。
//  - open: アプリを窓を出さずに起動し、テスト用の窓口つきのページを返す。起動した子プロセスは控える
//  - closeApp: ページの window.close() で閉じ、終了コードを返す
//  - killLeftovers: 途中の失敗で閉じられなかった Electron を、子のプロセスごと終わらせる（check-mcp.js の後始末と同じ考え）
//  - waitFor・listFiles・saved・materialsOf: 条件を待つ・フォルダの中のファイルの名前・保存の終わりを待つ・資料の行を読む
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

// 条件がそろうまで待つ（そろえば true、ms たってもそろわなければ false）
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

// 起動した Electron の子プロセスの控え（子 → つないだ puppeteer）。途中で止まったときに、残った子を終わらせるため（check-mcp.js の後始末と同じ考え）
const live = new Map();

// アプリを起動して、テスト用の窓口つきのページを返す。extraEnv は環境変数（MIM_MATERIAL_FILES）
async function open(h, userData, extraEnv = {}) {
  const child = h.launch([`--remote-debugging-port=${h.PORT}`], userData, extraEnv);
  live.set(child, null);
  const browser = await h.connect();
  live.set(child, browser);
  const page = await h.appPage(browser);
  await h.enableTestHooks(page);
  return { child, browser, page };
}
async function closeApp(h, { child, browser, page }) {
  await page.evaluate(() => window.close());
  browser.disconnect();
  const code = await h.withTimeout(child.exited, 30000, '資料の確かめのアプリが閉じない');
  live.delete(child);
  return code;
}
// 残った Electron（途中の失敗で閉じられなかったもの）を、子のプロセスごと終わらせる。残すと、単独起動の印とポートを持ち続けて次の確かめが失敗する
async function killLeftovers() {
  for (const [child, browser] of live) {
    if (browser) browser.disconnect();
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    }
    await Promise.race([child.exited, new Promise((r) => setTimeout(r, 10000))]);
  }
  live.clear();
}
const saved = (page) => page.evaluate(() => window.__test__.store.whenSaved());
const materialsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__test__.store.state.systems[0].materials)));
module.exports = { open, closeApp, killLeftovers, waitFor, listFiles, saved, materialsOf };
