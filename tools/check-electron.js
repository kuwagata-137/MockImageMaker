// 使い方: node tools/check-electron.js
// Electron のアプリを窓を出さずに（MIM_HEADLESS=1）起動し、次の 3 つを確かめる。
//  1. 画面設計を作って名前を変え、窓を閉じたあと <userData>/data/designs.json に残っている
//  2. 1 つ目が動いている間に 2 つ目を起動すると、2 つ目はすぐに終わる
//  3. 起動し直すと、作った画面設計が一覧に出る
// 保存先は作業フォルダの .devdata/check-userData（毎回消してから始める。npm start のデータとは別）。
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const electronPath = require('electron');

const ROOT = path.resolve(__dirname, '..');
const USER_DATA = path.join(ROOT, '.devdata', 'check-userData');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(extraArgs = []) {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', ...extraArgs], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      return await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
    } catch (_) {
      await sleep(250);
    }
  }
  throw new Error('Electron に接続できませんでした');
}

async function appPage(browser) {
  for (let i = 0; i < 40; i++) {
    const pages = await browser.pages();
    const page = pages.find((p) => /mock_v.*\.html$/.test(p.url()));
    if (page) {
      await page.waitForSelector('#home-cards');
      return page;
    }
    await sleep(250);
  }
  throw new Error('アプリの画面が見つかりません');
}

async function withTimeout(promise, ms, label) {
  return Promise.race([promise, sleep(ms).then(() => { throw new Error(`時間切れ: ${label}`); })]);
}

async function firstRun() {
  const child = launch([`--remote-debugging-port=${PORT}`]);
  const browser = await connect();
  const page = await appPage(browser);
  await page.click('[data-action="new"]');
  await page.type('.modal [name=name]', '顧客管理アプリ');
  await page.click('[data-dlg="ok"]');
  await page.waitForSelector('#side-panel [data-field="design-name"]');
  await page.evaluate(() => {
    const input = document.querySelector('[data-field="design-name"]');
    input.value = '顧客管理';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const title = await page.$eval('#ed-title', (e) => e.textContent);

  const second = launch();
  const secondCode = await withTimeout(second.exited, 15000, '2 つ目の起動が終わらない');
  const firstAlive = child.exitCode === null;

  await page.evaluate(() => window.close());
  browser.disconnect();
  const code = await withTimeout(child.exited, 15000, '1 つ目が閉じない');
  return { title, secondCode, firstAlive, code };
}

async function secondRun() {
  const child = launch([`--remote-debugging-port=${PORT}`]);
  const browser = await connect();
  const page = await appPage(browser);
  const names = await page.$$eval('.card-name', (els) => els.map((e) => e.textContent));
  await page.evaluate(() => window.close());
  browser.disconnect();
  await withTimeout(child.exited, 15000, '起動し直したアプリが閉じない');
  return names;
}

(async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const r = await firstRun();
  console.log('編集の画面の題名:', r.title);
  console.log('2 つ目の起動: 終了コード', r.secondCode, '／ そのとき 1 つ目は動いていたか:', r.firstAlive);
  console.log('1 つ目を閉じたときの終了コード:', r.code);
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  console.log('designs.json の画面設計:', saved.designs.map((d) => `${d.name}（${d.target}・画面 ${d.screens.length} つ）`).join('、'));
  const names = await secondRun();
  console.log('起動し直したときの一覧:', names.join('、'));
  const ok = r.firstAlive && saved.designs.length === 1 && saved.designs[0].name === '顧客管理' && names.join() === '顧客管理';
  console.log(ok ? 'OK' : 'NG');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
