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

// 部品の入った画面（仕上がりイメージ.png の新規登録の画面に近づけたもの）
const part = (id, type, x, y, w, h, no, label, extra = {}) => ({
  id, type, x, y, w, h, no, label, labelPos: 'top', sample: '', placeholder: '', required: false, memo: '', props: {}, ...extra,
});
const PARTS_SAMPLE = {
  schemaVersion: 1,
  settings: { customTargets: [] },
  designs: [design('d1', '顧客管理', 'kintone', '2026-10-13T05:20:00.000Z', {
    ...screen('s1', '新規登録'),
    parts: [
      part('p1', 'text1', 24, 64, 472, 64, 1, '顧客名', { required: true, props: { maxLen: '50', initial: '' } }),
      part('p2', 'text1', 528, 64, 472, 64, null, '顧客コード', { placeholder: '自動採番' }),
      part('p3', 'dropdown', 24, 152, 472, 64, 2, '担当者', { props: { options: ['営業部の社員'], initial: '' } }),
      part('p4', 'date', 528, 152, 472, 64, null, '契約日', { sample: '2026-10-08' }),
      part('p5', 'radio', 24, 240, 472, 64, 3, '区分', { props: { options: ['法人', '個人'], initial: '法人', dir: 'h' } }),
      part('p6', 'text2', 24, 328, 976, 120, null, '備考'),
      part('p7', 'button', 744, 480, 120, 40, null, 'キャンセル', { props: { style: 'normal', action: '' } }),
      part('p8', 'button', 880, 480, 120, 40, 4, '保存', { props: { style: 'primary', action: '登録して、一覧の画面へ戻る' } }),
    ],
  })],
};

async function center(page, sel) {
  const b = await (await page.$(sel)).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function dragMouse(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function shootParts(browser) {
  const page = await openApp(browser, PARTS_SAMPLE);
  await page.click('.card-open[data-id="d1"]');
  for (let i = 0; i < 6; i++) await page.click('[data-action="zoom-out"]');
  await shot(page, '13_部品_仕上がりイメージの画面と一覧表_40%');
  for (let i = 0; i < 3; i++) await page.click('[data-action="zoom-in"]');
  // 部品の箱から「数値」をドラッグして画面に置く
  const scr = await (await page.$('#stage .screen')).boundingBox();
  await dragMouse(page, await center(page, '.pal-btn[data-type="number"]'), { x: scr.x + scr.width * 0.83, y: scr.y + scr.height * 0.12 });
  await shot(page, '14_部品_箱からドラッグして置いた後');
  // 置いた部品を動かし、右下のつまみで大きくする
  const placed = await center(page, '#stage .part.sel');
  await dragMouse(page, placed, { x: placed.x, y: placed.y + 120 });
  const grip = await center(page, '#stage .part.sel .g-se');
  await dragMouse(page, grip, { x: grip.x + 60, y: grip.y });
  await shot(page, '15_部品_動かして大きくした後');
  // 顧客名を選んで、右下の設定の欄を見る
  await page.click('#stage .part[data-part-id="p1"]');
  await shot(page, '16_部品_顧客名を選んだところ');
  await page.click('#stage .part[data-part-id="p5"]');
  await shot(page, '17_部品_ラジオボタンを選んだところ');
  // 選ぶのをやめて、一覧表を下に置く
  await page.keyboard.press('Escape');
  // 機器の種類などと同じく、選択のボタンは見えている文字（span）を押す（input は隠してある）
  await page.click('[data-field="table-pos"][value="bottom"] + span');
  await page.click('[data-action="zoom-out"]');
  await shot(page, '18_部品_一覧表を画面の下に置いた_60%');
  // 部品の箱の「基本」を閉じる
  await page.click('.pal-head[data-id="basic"]');
  await shot(page, '19_部品_部品の箱の基本を閉じた');
  await page.click('[data-action="home"]');
  await shot(page, '20_一覧_部品の入った縮小画像');
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
    await shootParts(browser);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
