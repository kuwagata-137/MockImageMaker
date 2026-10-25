// tools/check-electron.js の場面 13（使い方の窓。2026-10-24）。本物の Electron のアプリを窓を出さずに起動し、次を確かめる。
//  - アプリのメニューの「ヘルプ > 使い方」（メインプロセスの inspector からメニューの項目を押す）で、使い方の窓（manual/manual.html）が開き、
//    題名と目次が出て、本文の画像がすべて読める（画像は loading="lazy" なので、同じ場所を Image で読み直して確かめる）
//  - もう一度開いても、使い方の窓は 1 つのまま（2 回目は前に出すだけ）
//  - アプリの窓を閉じると、使い方の窓も閉じて、アプリが終わる（使い方の窓だけが残らない）
// jsdom のテスト（test/app.test.js・test/manual.test.js）では、main の窓と画像の読み込みを確かめていないため。
// 保存先は .devdata/check-userData-manual（毎回消してから始める）。node tools/check-electron.js --only=manual で、この 13 だけを動かす。
'use strict';

const { removeTree } = require('./material-sample-place');
const { open, killLeftovers } = require('./check-electron-materials-app');

const report = (ok, label, detail = '') => { console.log(`${ok ? 'OK' : 'NG'} 使い方の窓: ${label}${detail ? ` … ${detail}` : ''}`); return ok; };
const isManual = (p) => /\/manual\/manual\.html(#.*)?$/.test(p.url());
const manualPages = async (browser) => (await browser.pages()).filter(isManual);

// h は check-electron.js の道具 { launch, connect, appPage, enableTestHooks, withTimeout, sleep, PORT, MAIN_PORT, evalInMain, USER_DATA_MANUAL }
module.exports = async function checkManual(h) {
  removeTree(h.USER_DATA_MANUAL);
  try {
    const app = await open(h, h.USER_DATA_MANUAL, {}, [`--inspect=${h.MAIN_PORT}`]);
    const { child, browser, page } = app;
    // ヘルプ > 使い方（メニュー → ページの runCommand('openManual') → preload の menuAPI.openManual → main の manual:open）
    await h.evalInMain("require('electron').Menu.getApplicationMenu().items.find((m) => m.label === 'ヘルプ').submenu.items.find((m) => m.label === '使い方').click()");
    let pages = [];
    for (let i = 0; i < 40 && !pages.length; i++) {
      pages = await manualPages(browser);
      if (!pages.length) await h.sleep(250);
    }
    let ok = report(pages.length === 1, 'ヘルプ > 使い方で、使い方の窓が開く', `窓 ${pages.length} つ`);
    if (!pages.length) return false;
    const mp = pages[0];
    await mp.waitForSelector('nav a');
    const info = await mp.evaluate(async () => {
      const srcs = [...document.images].map((i) => i.src);
      const loaded = await Promise.all(srcs.map((src) => new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im.naturalWidth > 0);
        im.onerror = () => res(false);
        im.src = src;
      })));
      return { title: document.title, toc: document.querySelectorAll('nav a').length, images: srcs.length, broken: srcs.filter((_, i) => !loaded[i]) };
    });
    ok = report(/^使い方/.test(info.title) && info.toc > 10 && info.images > 0 && info.broken.length === 0,
      '題名と目次が出て、本文の画像がすべて読める', `題名「${info.title}」・目次 ${info.toc}・画像 ${info.images} 枚（読めない ${info.broken.length} 枚${info.broken.length ? `: ${info.broken.slice(0, 3).join(' ')}` : ''}）`) && ok;
    // 2 回目（ページの窓口から直接）。窓は増えない
    await page.evaluate(() => window.menuAPI.openManual());
    await h.sleep(800);
    pages = await manualPages(browser);
    ok = report(pages.length === 1, 'もう一度開いても、使い方の窓は 1 つのまま', `窓 ${pages.length} つ`) && ok;
    // アプリの窓を閉じる（窓の × と同じ BrowserWindow.close()）→ 使い方の窓も閉じて、アプリが終わる
    await h.evalInMain("require('electron').BrowserWindow.getAllWindows().find((w) => !/manual\\.html/.test(w.webContents.getURL())).close()");
    browser.disconnect();
    const code = await h.withTimeout(child.exited, 30000, 'アプリの窓を閉じても、アプリが終わらない（使い方の窓が残った？）');
    ok = report(code === 0, 'アプリの窓を閉じると、使い方の窓も閉じて、アプリが終わる', `終了コード ${code}`) && ok;
    return ok;
  } finally {
    await killLeftovers();
  }
};
