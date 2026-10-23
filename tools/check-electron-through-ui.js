// tools/check-electron-through.js（通しの確かめ）が使う、画面の操作の小さな関数。どれも Puppeteer で本物のマウスとキーを動かす（窓は出さない）。
//  - noModal・dialogOk: 窓が閉じるのを待つ・窓の肯定のボタンを押して閉じるのを待つ
//  - typeField: 文字の欄の中身を選んで打ち直し、Tab で欄を離れる（欄を離れたときの保存〔change〕を起こす）
//  - selectByText: 選ぶ欄で、見える名前の選択肢を選ぶ（値は id なので、名前から引く）
//  - fitScreen: 編集の画面で、画面の全体が真ん中の欄に収まるまで縮める（「−」のボタン）
//  - dropPart: 部品の箱から部品をドラッグして、画面の中の位置（画面の左上からのドット）に置く（たたんだ組にあるときは、組を開いてから）
//  - stateOf・whenSaved・report: ページの中の状態を写して読む・保存の終わりを待つ・確かめの結果の 1 行
'use strict';

const noModal = (page) => page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 30000 });

async function dialogOk(page) {
  await page.click('.modal [data-dlg="ok"]');
  await noModal(page);
}

async function typeField(page, sel, text) {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel);
  await page.$eval(sel, (el) => el.select());
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
}

async function selectByText(page, sel, text) {
  await page.waitForSelector(sel, { visible: true });
  const value = await page.$eval(sel, (el, t) => {
    const o = [...el.options].find((x) => x.textContent.trim() === t);
    return o ? o.value : null;
  }, text);
  if (value == null) throw new Error(`選ぶ欄 ${sel} に「${text}」がない`);
  await page.select(sel, value);
}

async function fitScreen(page) {
  for (let i = 0; i < 10; i++) {
    const fits = await page.evaluate(() => {
      const w = document.querySelector('#canvas-wrap').getBoundingClientRect();
      const r = document.querySelector('#stage .screen').getBoundingClientRect();
      return r.width <= w.width && r.height <= w.height;
    });
    if (fits) return;
    await page.click('#toolbar [data-action="zoom-out"]');
  }
}

async function dropPart(page, type, x, y) {
  const sel = `.pal-btn[data-type="${type}"]`;
  for (let i = 0; i < 8 && !(await page.$(sel)); i++) {
    const closed = await page.$('.pal-head[aria-expanded="false"]:not([data-id="items"])');
    if (!closed) break;
    await closed.click();
  }
  const btn = await page.$(sel);
  await btn.scrollIntoView(); // 部品の箱の下の方の組は、箱の見えている所の外にある
  const from = await btn.boundingBox();
  const to = await page.evaluate((px, py) => {
    const r = document.querySelector('#stage .screen').getBoundingClientRect();
    return { x: r.left + px * window.__test__.ui.zoom, y: r.top + py * window.__test__.ui.zoom };
  }, x, y);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__test__.store.state)));
const whenSaved = (page) => page.evaluate(() => window.__test__.store.whenSaved());

const results = [];
function report(ok, label, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'OK' : 'NG'} ${label}${detail ? ` … ${detail}` : ''}`);
  return !!ok;
}

module.exports = { noModal, dialogOk, typeField, selectByText, fitScreen, dropPart, stateOf, whenSaved, report, results };
