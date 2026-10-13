// 使い方: node tools/shoot-app.js [出力先のフォルダ]
// アプリの HTML（package.json の build.files の mock_v*.html）を headless の Chrome で開き、
// 見た目を確かめるための場面を順に撮る。中身は架空の業務アプリだけを使う。
// Chrome のプロファイルは作業フォルダの .devdata/chrome-profile に置く（tools/shoot.js と同じ）。
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => f.endsWith('.html'));
const VERSION = HTML_NAME.replace(/^mock_v|\.html$/g, '');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'screenshots'));

const screen = (id, name, device = 'pc', height) => {
  const sizes = { pc: [1280, 800], tablet: [768, 1024], phone: [375, 667] };
  const [width, h] = sizes[device];
  return { id, name, device, width, height: height || h, showHeader: true, tablePos: 'right', parts: [], callouts: [] };
};
const design = (id, name, target, updatedAt, scr, extra = {}) => ({
  id, name, target, description: '', createdAt: updatedAt, updatedAt, trashedAt: null, revisions: [], screens: [scr], ...extra,
});
const SAMPLE = {
  schemaVersion: 1,
  settings: { customTargets: [] },
  designs: [
    design('d1', '顧客管理アプリ', 'kintone', '2026-10-09T05:20:00.000Z', screen('s1', '一覧')),
    design('d2', '問い合わせ管理', 'salesforce', '2026-10-07T00:05:00.000Z', screen('s2', '受付', 'tablet')),
    design('d3', '備品貸出アプリ', 'claude', '2026-10-02T07:41:00.000Z', screen('s3', '貸出の申請', 'phone')),
    design('d4', '日報アプリ', 'kintone', '2026-09-28T02:12:00.000Z', screen('s4', '日報の入力')),
    design('d5', '会議室予約（古い案）', 'kintone', '2026-09-20T02:12:00.000Z', screen('s5', '予約'), { trashedAt: '2026-10-10T01:00:00.000Z' }),
  ],
};

async function shot(page, name) {
  const file = path.join(OUT, `v${VERSION}_${name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', path.relative(ROOT, file));
}

async function openApp(browser, seed) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 860 });
  await page.evaluateOnNewDocument((data) => {
    window.__test__ = {};
    localStorage.clear();
    if (data) localStorage.setItem('mockimagemaker.v1', data);
  }, seed ? JSON.stringify(seed) : null);
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  return page;
}

async function shootHome(browser) {
  const empty = await openApp(browser, null);
  await shot(empty, '01_一覧_画面設計なし');
  await empty.click('[data-action="new"]');
  await empty.type('.modal [name=name]', '顧客管理アプリ');
  await shot(empty, '02_新規作成の窓');
  await empty.close();

  const page = await openApp(browser, SAMPLE);
  await shot(page, '03_一覧_4つ');
  await page.click('.card-more[data-id="d1"]');
  await shot(page, '04_一覧_カードのメニュー');
  await page.keyboard.press('Escape');
  await page.type('#home-search', '管理');
  await shot(page, '05_一覧_名前で探した後');
  await page.evaluate(() => { const i = document.querySelector('#home-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('.trash-toggle');
  await page.evaluate(() => document.querySelector('.home-scroll').scrollTo(0, 9999));
  await shot(page, '06_一覧_ごみ箱を開いたところ');
  await page.close();
}

async function shootEditor(browser) {
  const page = await openApp(browser, SAMPLE);
  await page.click('.card-open[data-id="d1"]');
  await shot(page, '07_編集_パソコン_100%');
  await page.click('[data-action="zoom-out"]');
  for (let i = 0; i < 4; i++) await page.click('[data-action="zoom-out"]');
  await shot(page, '08_編集_パソコン_50%');
  // 下の縁をドラッグして高さを伸ばす
  const box = await (await page.$('[data-drag="resize"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 8 });
  await page.mouse.up();
  await shot(page, '09_編集_高さを伸ばした後_50%');
  await page.click('[data-action="zoom-reset"]');
  await page.click('[data-action="mode-hand"]');
  const wrap = await (await page.$('#canvas-wrap')).boundingBox();
  await page.mouse.move(wrap.x + 500, wrap.y + 500);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 300, wrap.y + 200, { steps: 8 });
  await page.mouse.up();
  await shot(page, '10_編集_ハンドで動かした後');
  await page.click('[data-action="home"]');
  await page.click('.card-open[data-id="d2"]');
  await shot(page, '11_編集_タブレット');
  await page.click('[data-action="home"]');
  await page.click('.card-open[data-id="d3"]');
  await shot(page, '12_編集_スマホ');
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    channel: 'chrome',
    userDataDir: path.join(ROOT, '.devdata', 'chrome-profile'),
    args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  try {
    await shootHome(browser);
    await shootEditor(browser);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
