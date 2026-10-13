// 使い方: node tools/shoot-app.js [出力先のフォルダ]
// アプリの HTML（package.json の build.files の mock_v*.html）を headless の Chrome で開き、
// 見た目を確かめるための場面を順に撮る。中身は架空の業務アプリだけを使う。
// Chrome のプロファイルは作業フォルダの .devdata/chrome-profile に置く（tools/shoot.js と同じ）。
// 環境変数 MIM_CHROME_PATH にブラウザの場所を書くと、システムの Chrome の代わりにそれを使う（tools/shoot.js と同じ）。
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => f.endsWith('.html'));
const VERSION = HTML_NAME.replace(/^mock_v|\.html$/g, '');
// 引数: [出力先のフォルダ] [--only=場面の組の名前（home・editor・parts・db をカンマで区切る）]
const ARGS = process.argv.slice(2);
const OUT = path.resolve(ARGS.find((a) => !a.startsWith('--')) || path.join(ROOT, 'screenshots'));
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const wants = (name) => !ONLY.length || ONLY.includes(name);

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

// ── データベースの項目（第 3 段階の後半）。データの形 v2（項目は画面設計の items、部品は itemId で指す）──
const item = (id, name, type, props = {}, extra = {}) => ({ id, name, type, required: false, memo: '', props, lookup: null, link: null, ...extra });
const ipart = (id, type, x, y, w, h, no, itemId, extra = {}) => ({ id, type, x, y, w, h, no, labelPos: 'top', sample: '', placeholder: '', itemId, ...extra });
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県'];
const DB_SAMPLE = {
  schemaVersion: 2,
  settings: { customTargets: [] },
  designs: [design('d1', '顧客管理', 'kintone', '2026-10-13T05:20:00.000Z', {
    ...screen('s1', '新規登録'),
    parts: [
      ipart('p1', 'text1', 24, 64, 472, 64, 1, 'i1', { placeholder: '自動採番' }),
      ipart('p2', 'text1', 528, 64, 472, 64, 2, 'i2'),
      ipart('p3', 'radio', 24, 152, 472, 64, 3, 'i3'),
      ipart('p4', 'user', 528, 152, 472, 64, 4, 'i4'),
      ipart('p5', 'text1', 24, 240, 472, 64, 5, 'i5'),
      ipart('p6', 'text1', 528, 240, 472, 64, 6, 'i6'),
      ipart('p7', 'dropdown', 24, 328, 472, 64, 7, 'i7', { sample: '栃木県' }),
      { id: 'p9', type: 'button', x: 880, y: 440, w: 120, h: 40, no: 8, label: '保存', labelPos: 'top', sample: '', placeholder: '', required: false, memo: '', props: { style: 'primary', action: '登録して、一覧の画面へ戻る' } },
    ],
  }, {
    items: [
      item('i1', '顧客コード', 'text1', { maxLen: '10', initial: '' }, { required: true }),
      item('i2', '顧客名', 'text1', { maxLen: '50', initial: '' }, { required: true, memo: '会社名か、個人の名前を書く' }),
      item('i3', '区分', 'radio', { options: ['法人', '個人'], initial: '法人', dir: 'h' }),
      item('i4', '担当者', 'user', { scope: '営業部の社員', multiple: false, initial: 'me' }, { required: true }),
      item('i5', '取引先コード', 'text1', { maxLen: '', initial: '' }, {
        lookup: { db: { designId: 'd3', name: '取引先マスタ', free: false }, key: { itemId: 'b1', name: '取引先コード' }, copies: [{ from: { itemId: 'b2', name: '取引先名' }, to: { itemId: 'i6', name: '取引先名' } }] },
      }),
      item('i6', '取引先名', 'text1', { maxLen: '', initial: '' }),
      item('i7', '都道府県', 'dropdown', { options: PREFS, initial: '' }, { link: { designId: 'd2', itemId: 'a2', designName: '住所の共通項目', lost: false } }),
      item('i8', '備考', 'text2', { maxLen: '', initial: '' }),
    ],
  }), design('d2', '住所の共通項目', 'その他', '2026-10-12T05:20:00.000Z', screen('s2', '住所の入力'), {
    items: [
      item('a1', '郵便番号', 'text1', { maxLen: '8', initial: '' }),
      item('a2', '都道府県', 'dropdown', { options: PREFS, initial: '' }),
      item('a3', '市区町村', 'text1', { maxLen: '30', initial: '' }),
      item('a4', '番地', 'text1', { maxLen: '', initial: '' }),
      item('a5', '電話番号', 'text1', { maxLen: '13', initial: '' }),
    ],
  }), design('d3', '取引先マスタ', 'kintone', '2026-10-11T05:20:00.000Z', screen('s3', '一覧'), {
    items: [
      item('b1', '取引先コード', 'text1', { maxLen: '10', initial: '' }, { required: true }),
      item('b2', '取引先名', 'text1', { maxLen: '50', initial: '' }, { required: true }),
      item('b3', '住所', 'text1', { maxLen: '', initial: '' }),
    ],
  })],
};

async function shootDatabase(browser) {
  const page = await openApp(browser, DB_SAMPLE);
  await page.click('.card-open[data-id="d1"]');
  for (let i = 0; i < 3; i++) await page.click('[data-action="zoom-out"]');
  await shot(page, '21_項目_部品の箱のデータベースの項目の組_70%');
  await page.click('#stage .part[data-part-id="p2"]');
  await shot(page, '22_項目_部品を選んだ設定の欄（2 つの枠）');
  await page.click('#stage .part[data-part-id="p5"]');
  await page.evaluate(() => { const s = document.querySelector('#side-settings'); s.scrollTop += s.querySelector('.lk-box').getBoundingClientRect().top - s.getBoundingClientRect().top - 8; });
  await shot(page, '30_ルックアップ_探す項目を選んだところ');
  await page.click('[data-action="open-items"]');
  await page.click('#db-view tr[data-id="i2"]');
  await shot(page, '23_項目_データベースの項目の一覧表');
  await page.click('#db-view [data-action="add-item-menu"]');
  await shot(page, '24_項目_項目を足すメニュー');
  await page.keyboard.press('Escape');
  await page.click('#db-view .itable-head h3');
  // 画面に置いてある「取引先名」を消すと、部品は消したときの中身で固定される
  await page.click('#db-view [data-action="delete-item"][data-id="i6"]');
  await shot(page, '25_項目_画面に置いた項目を消す確かめの窓');
  await page.click('.modal [data-dlg="ok"]');
  await page.click('.sl-item');
  await page.click('#stage .part[data-part-id="p6"]');
  await shot(page, '26_項目_項目を消した後に残った部品');
  // 取り込んだ項目（都道府県）を選ぶ
  await page.click('#stage .part[data-part-id="p7"]');
  await shot(page, '27_取り込み_取り込んだ項目の部品を選んだところ');
  // ほかのモックから取り込む窓
  await page.click('[data-action="import-items"]');
  await page.click('[data-imp-item="a1"]');
  await page.click('[data-imp-item="a5"]');
  await shot(page, '28_取り込み_ほかのモックから取り込む窓');
  await page.click('.modal [data-dlg="ok"]');
  await shot(page, '29_取り込み_取り込んだ後の一覧表');
  await page.close();
}

// ── 第 3 段階の後半の部品（表・グラフ・一覧の画面用・進み具合の画面用・見た目用）──
// 画面を足す操作は第 4 段階で作るので、アプリの中の操作（window.__test__.actions）とデータで組み立てる
async function buildParts2(page) {
  return page.evaluate(() => {
    const { actions: a, store } = window.__test__;
    const did = a.createDesign('受注管理', 'kintone');
    const item = (type, label, props) => { const id = a.addItem(did, type); a.updateItem(did, id, { label, ...(props ? { props } : {}) }); return id; };
    const ids = {
      no: item('text1', '受注番号'), date: item('date', '受注日'), cust: item('text1', '顧客名'),
      kind: item('radio', '区分', { options: ['法人', '個人'] }), staff: item('user', '担当者'), amount: item('number', '合計金額', { unit: '円' }),
    };
    const sc = (name) => ({ id: 's-' + name, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
    store.commit((s) => { const d = s.designs.find((x) => x.id === did); d.screens = [sc('一覧'), sc('新規登録'), sc('進み具合'), sc('グラフ')]; });
    const put = (sid, type, x, y, patch, w, h) => {
      const pid = a.addPart(did, sid, type, { x, y });
      if (patch) a.updatePart(did, sid, pid, patch);
      const d = store.state.designs.find((x2) => x2.id === did);
      const p = d.screens.find((s) => s.id === sid).parts.find((q) => q.id === pid);
      if (w || h) a.movePart(did, sid, pid, { ...p, w: w || p.w, h: h || p.h });
      return pid;
    };
    // 一覧の画面
    put('s-一覧', 'search', 24, 64, { props: { items: [ids.cust, ids.no] } });
    put('s-一覧', 'filter', 376, 64, { props: { items: [ids.kind, ids.staff], values: ['法人', ''] } });
    const rec = put('s-一覧', 'table', 24, 128, { view: { rows: 4, samples: {} } }, 1000);
    a.setTableKind(did, 's-一覧', rec, 'records');
    a.updatePart(did, 's-一覧', rec, { label: '受注の一覧' });
    put('s-一覧', 'pager', 24, 360, { props: { perPage: '20', total: '86' } });
    // 新規登録の画面（テーブル）
    const tb = put('s-新規登録', 'table', 24, 64, { label: '明細', required: true, view: { rows: 3 } }, 760);
    const d1 = store.state.designs.find((x) => x.id === did);
    const tItem = d1.items.find((it) => it.type === 'table');
    const cols = [['品名', 'text1', true], ['数量', 'number', true], ['単価', 'number', false], ['金額', 'calc', false]].map(([name, type, required], i) => ({ ...(tItem.props.columns[i] || {}), id: 'c' + i, name, type, required, memo: '', props: type === 'calc' ? { formula: '数量×単価', unit: '円' } : type === 'number' ? { unit: '', min: '', max: '', decimals: '', initial: '' } : { maxLen: '50', initial: '' } }));
    a.updateItem(did, tItem.id, { props: { columns: cols } });
    a.updatePart(did, 's-新規登録', tb, { view: { samples: { c0: ['コピー用紙 A4', 'ボールペン 黒'], c1: ['10', '20'], c2: ['450 円', '120 円'], c3: ['4,500 円', '2,400 円'] }, widths: { c0: 260 } } });
    // 進み具合と見た目用
    put('s-進み具合', 'status', 24, 64);
    put('s-進み具合', 'steps', 232, 64);
    put('s-進み具合', 'tabs', 24, 136);
    put('s-進み具合', 'image', 24, 200, { label: '会社のロゴ' });
    put('s-進み具合', 'link', 296, 200, { label: '受注の詳しい画面を開く', props: { to: 'screen', screenId: 's-新規登録' } });
    ['gear', 'bell', 'mail', 'trash', 'edit', 'info', 'search', 'plus', 'check', 'close', 'user', 'calendar', 'home', 'star', 'download', 'upload'].forEach((icon, i) =>
      put('s-進み具合', 'icon', 296 + (i % 8) * 48, 248 + Math.floor(i / 8) * 48, { props: { icon, color: ['black', 'blue', 'red', 'gray'][i % 4] } }));
    // グラフの画面
    put('s-グラフ', 'graph', 24, 64, { label: '月ごとの受注金額', props: { byItem: ids.date, byUnit: '月ごと', aggItem: ids.amount, unit: '万円' } });
    put('s-グラフ', 'graph', 528, 64, { label: '区分ごとの顧客数', props: { chart: 'pie', byItem: ids.kind, agg: 'count', samples: '法人, 60\n個人, 30\n官公庁, 10' } });
    put('s-グラフ', 'graph', 24, 400, { label: '月ごとの受注件数', props: { chart: 'line', agg: 'count' } });
    put('s-グラフ', 'graph', 528, 400, { label: '担当者ごとの受注金額', props: { chart: 'hbar', samples: '山田 太郎, 560\n佐藤 花子, 380\n鈴木 次郎, 240' } });
    // 関連レコード一覧のために、顧客管理を作る
    const cid = a.createDesign('顧客管理', 'kintone');
    const ccode = a.addItem(cid, 'text1');
    a.updateItem(cid, ccode, { label: '顧客コード' });
    const ocode = a.addItem(did, 'text1');
    a.updateItem(did, ocode, { label: '顧客コード' });
    window.__test__.openDesign(cid);
    const cs = store.state.designs.find((x) => x.id === cid).screens[0].id;
    const rel = a.addPart(cid, cs, 'table', { x: 24, y: 64 });
    a.setTableKind(cid, cs, rel, 'related');
    const dd = store.state.designs.find((x) => x.id === cid);
    const relPart = dd.screens[0].parts.find((p) => p.id === rel);
    a.updatePart(cid, cs, rel, { label: 'この顧客の受注', props: { ...relPart.props, db: { designId: did, name: '受注管理', free: false }, cond: { from: { itemId: ocode, name: '顧客コード' }, to: { itemId: ccode, name: '顧客コード' } },
      columns: [ids.no, ids.date, ids.amount].map((id, i) => ({ id: 'r' + i, ref: { itemId: id, name: '' } })), sort: '受注日の新しい順', limit: '5' } });
    return { did, cid, rel };
  });
}

async function shootParts2(browser) {
  const page = await openApp(browser, null);
  const ids = await buildParts2(page);
  await page.evaluate((id) => window.__test__.openDesign(id), ids.did);
  for (let i = 0; i < 4; i++) await page.click('[data-action="zoom-out"]');
  await shot(page, '31_後半の部品_一覧の画面（検索・絞り込み・レコード一覧・ページ送り）_60%');
  await page.click('.sl-item[data-id="s-新規登録"]');
  await shot(page, '32_後半の部品_テーブルと一覧表の枝番_60%');
  await page.click('#stage .part.pt-table');
  await page.click('#side-settings [data-action="tb-col"][data-id="c1"]');
  await shot(page, '33_後半の部品_テーブルの列を選んだ設定の欄_60%');
  await page.click('.sl-item[data-id="s-進み具合"]');
  await shot(page, '34_後半の部品_ステータス・進み具合・タブ・見た目用_60%');
  await page.click('.sl-item[data-id="s-グラフ"]');
  await shot(page, '35_後半の部品_グラフ 4 種類_60%');
  await page.click('#stage .part.pt-graph');
  await shot(page, '36_後半の部品_グラフの設定の欄_60%');
  await page.evaluate((id) => window.__test__.openDesign(id), ids.cid);
  await page.click('#stage .part.pt-table');
  await shot(page, '37_後半の部品_関連レコード一覧と設定の欄');
  await page.close();
}

// ── 吹き出し（画像 q27）。ドラッグの操作は、実際にマウスを動かして確かめる ──
async function shootCallouts(browser) {
  const page = await openApp(browser, PARTS_SAMPLE);
  await page.click('.card-open[data-id="d1"]');
  for (let i = 0; i < 5; i++) await page.click('[data-action="zoom-out"]');
  // 部品の箱の「吹き出し」を、顧客名の部品の上に落とす（部品の箱の中だけをスクロールして、ボタンを見えるようにする）
  await page.evaluate(() => {
    const box = document.querySelector('#side-box');
    const b = box.querySelector('.pal-btn[data-type="callout"]');
    box.scrollTop += b.getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
  });
  await dragMouse(page, await center(page, '.pal-btn[data-type="callout"]'), await center(page, '#stage .part[data-part-id="p1"]'));
  const placed = await page.evaluate(() => window.__test__.currentScreen().callouts.map((c) => [c.target, c.x, c.y]));
  console.log('部品の上に落とした吹き出し（つないだ部品・位置）:', JSON.stringify(placed));
  await shot(page, '38_吹き出し_部品の上に落として置いた_50%');
  // 吹き出しを、画面の左の外の余白へ動かす
  const co = await center(page, '#stage .callout');
  const scr = await (await page.$('#stage .screen')).boundingBox();
  await dragMouse(page, co, { x: scr.x - 70, y: scr.y + 60 });
  const moved = await page.evaluate(() => window.__test__.currentScreen().callouts.map((c) => [c.x, c.y]));
  console.log('外の余白へ動かした後の位置:', JSON.stringify(moved));
  await shot(page, '39_吹き出し_外の余白へ動かした_50%');
  // 線の先の ○ を、区分の部品へドラッグしてつなぎ直す
  await page.click('#stage .callout');
  await dragMouse(page, await center(page, '#stage [data-co-handle]'), await center(page, '#stage .part[data-part-id="p5"]'));
  const linked = await page.evaluate(() => window.__test__.currentScreen().callouts.map((c) => c.target));
  console.log('つなぎ直した後の部品:', JSON.stringify(linked));
  await shot(page, '40_吹き出し_線の先をドラッグして区分につないだ_50%');
  // つないだ部品（区分）を動かすと、線も付いてくる（動かしている途中を撮る）
  const p5 = await center(page, '#stage .part[data-part-id="p5"]');
  await page.mouse.move(p5.x, p5.y);
  await page.mouse.down();
  await page.mouse.move(p5.x + 200, p5.y + 60, { steps: 8 });
  await shot(page, '41_吹き出し_つないだ部品を動かしている途中_50%');
  await page.mouse.up();
  // 設定の欄で赤・矢印にし、文字を書く
  await page.click('#stage .callout');
  await page.click('#side-settings [data-co="color"][value="red"] + span');
  await page.click('#side-settings [data-co="tip"][value="arrow"] + span');
  await page.click('#side-settings [data-co="text"]', { clickCount: 3 });
  await page.keyboard.type('法人を選んだときだけ、会社名の欄を出す');
  await page.click('#side-settings .panel-title');
  await shot(page, '42_吹き出し_赤と矢印にして文字を書いた_50%');
  await page.close();
}

// ── まとめて選ぶ・動かす・揃える（画像 q28）。囲む・まとめてドラッグ・Ctrl のドラッグは、実際にマウスを動かして確かめる ──
async function shootMulti(browser) {
  const page = await openApp(browser, PARTS_SAMPLE);
  await page.click('.card-open[data-id="d1"]');
  for (let i = 0; i < 5; i++) await page.click('[data-action="zoom-out"]');
  const info = () => page.evaluate(() => ({
    sel: window.__test__.ui.sel.map((x) => x.id),
    pos: Object.fromEntries(window.__test__.currentScreen().parts.map((p) => [p.id, [p.x, p.y]])),
  }));
  const scr = await (await page.$('#stage .screen')).boundingBox();
  const k = scr.width / 1280;
  const at = (x, y) => ({ x: scr.x + x * k, y: scr.y + y * k });
  // 何もない所から囲む（顧客名・担当者・区分の 3 つが枠に全部入る。顧客コードは入らない）
  await dragMouse(page, at(8, 52), at(508, 316));
  console.log('囲んで選んだもの:', JSON.stringify((await info()).sel));
  await shot(page, '43_まとめて_囲んで選んだ_50%');
  // 選んだ 1 つ（担当者）をドラッグすると、3 つまとめて動く
  const b0 = (await info()).pos;
  await dragMouse(page, await center(page, '#stage .part[data-part-id="p3"]'), { x: (await center(page, '#stage .part[data-part-id="p3"]')).x + 60, y: (await center(page, '#stage .part[data-part-id="p3"]')).y + 20 });
  const b1 = (await info()).pos;
  console.log('まとめて動かした幅（顧客名・担当者・区分）:', JSON.stringify(['p1', 'p3', 'p5'].map((id) => [b1[id][0] - b0[id][0], b1[id][1] - b0[id][1]])));
  await shot(page, '44_まとめて_まとめてドラッグした_50%');
  // Ctrl を押しながら顧客コードを押して足し、メニューバーの「左」で揃える（基準は最初に選んだもの）
  await page.keyboard.down('Control');
  await page.click('#stage .part[data-part-id="p2"]');
  await page.keyboard.up('Control');
  console.log('Ctrl で足した後:', JSON.stringify((await info()).sel));
  await shot(page, '45_まとめて_Ctrlで足した（右の欄に揃えるボタン）_50%');
  await page.click('#toolbar [data-action="align-left"]');
  const b2 = (await info()).pos;
  console.log('左に揃えた後の x:', JSON.stringify(['p1', 'p3', 'p5', 'p2'].map((id) => b2[id][0])));
  await shot(page, '46_まとめて_左に揃えた_50%');
  // Ctrl を押しながらドラッグすると、選んだものを複製する
  const before = Object.keys(b2).length;
  const c = await center(page, '#stage .part[data-part-id="p1"]');
  await page.keyboard.down('Control');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 300, c.y + 120, { steps: 10 });
  await shot(page, '47_まとめて_Ctrlを押しながらドラッグしている途中_50%');
  await page.mouse.up();
  await page.keyboard.up('Control');
  console.log('複製した後の部品の数:', before, '→', Object.keys((await info()).pos).length);
  await shot(page, '48_まとめて_Ctrlのドラッグで複製した_50%');
  await page.close();
}

// ── データベースどうしのつながりの図（画像 q23）。q23 と同じ顔ぶれに、顧客管理の「受注の履歴」（関連レコード一覧。受注管理 → 顧客管理 で輪になる）を足す ──
const lk = (dbId, dbName, key, copies) => ({ db: { designId: dbId, name: dbName, free: !dbId }, key, copies: copies.map(([from, to]) => ({ from, to })) });
const ref = (itemId, name) => ({ itemId, name });
const MAP_SAMPLE = {
  schemaVersion: 2,
  settings: { customTargets: [] },
  designs: [
    design('d1', '顧客管理', 'kintone', '2026-10-13T05:20:00.000Z', {
      ...screen('s1', '詳細'),
      parts: [
        ipart('p1', 'text1', 24, 64, 472, 64, 1, 'i1'),
        ipart('p2', 'text1', 528, 64, 472, 64, 2, 'i2'),
        { id: 'p3', type: 'table', x: 24, y: 160, w: 976, h: 168, no: 3, labelPos: 'top', sample: '', placeholder: '', label: '受注の履歴', required: false, memo: '', tableKind: 'related',
          props: { columns: [], sort: '受注日の新しい順', perPage: '20', limit: '5', db: { designId: 'd5', name: '', free: false }, cond: { from: ref('e1', '顧客コード'), to: ref('i1', '顧客コード') } },
          view: { rows: 3, samples: {}, widths: {} } },
      ],
    }, {
      items: [
        item('i1', '顧客コード', 'text1', {}, { required: true }),
        item('i2', '顧客名', 'text1', {}, { required: true }),
        item('i3', '取引先コード', 'text1', {}, { lookup: lk('d3', '取引先マスタ', ref('b1', '取引先コード'), [[ref('b2', '取引先名'), ref('i4', '取引先名')], [ref('b3', '住所'), ref('i7', '住所')]]) }),
        item('i4', '取引先名', 'text1'),
        item('i5', '郵便番号', 'text1', {}, { link: { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false } }),
        item('i6', '都道府県', 'dropdown', { options: PREFS }, { link: { designId: 'd2', itemId: 'a2', designName: '住所の共通項目', lost: false } }),
        item('i7', '住所', 'text1'),
      ],
    }),
    design('d2', '住所の共通項目', 'その他', '2026-10-12T05:20:00.000Z', screen('s2', '住所の入力'), {
      items: [item('a1', '郵便番号', 'text1'), item('a2', '都道府県', 'dropdown', { options: PREFS }), item('a3', '市区町村', 'text1'), item('a4', '番地', 'text1')],
    }),
    design('d3', '取引先マスタ', 'kintone', '2026-10-11T05:20:00.000Z', screen('s3', '一覧'), {
      items: [item('b1', '取引先コード', 'text1'), item('b2', '取引先名', 'text1'), item('b3', '住所', 'text1'),
        item('b4', '都道府県', 'dropdown', { options: PREFS }, { link: { designId: 'd2', itemId: 'a2', designName: '住所の共通項目', lost: false } })],
    }),
    design('d4', '商品マスタ', 'kintone', '2026-10-10T05:20:00.000Z', screen('s4', '一覧'), {
      items: [item('c1', '商品コード', 'text1'), item('c2', '商品名', 'text1'), item('c3', '単価', 'number')],
    }),
    design('d5', '受注管理', 'kintone', '2026-10-09T05:20:00.000Z', screen('s5', '新規登録'), {
      items: [
        item('e1', '顧客コード', 'text1', {}, { lookup: lk('d1', '顧客管理', ref('i1', '顧客コード'), [[ref('i2', '顧客名'), ref('e2', '顧客名')]]) }),
        item('e2', '顧客名', 'text1'),
        item('e3', '商品コード', 'text1', {}, { lookup: lk('d4', '商品マスタ', ref('c1', '商品コード'), [[ref('c2', '商品名'), ref('e4', '商品名')], [ref('c3', '単価'), ref('e5', '単価')]]) }),
        item('e4', '商品名', 'text1'),
        item('e5', '単価', 'number'),
        item('e6', '勘定科目コード', 'text1', {}, { lookup: lk(null, '会計システム', ref(null, '勘定科目コード'), [[ref(null, '勘定科目名'), ref('e7', '勘定科目名')]]) }),
        item('e7', '勘定科目名', 'text1'),
      ],
    }),
    design('d6', '社員名簿', 'kintone', '2026-10-08T05:20:00.000Z', screen('s6', '一覧'), {
      items: [item('f1', '社員番号', 'text1'), item('f2', '氏名', 'text1')],
    }),
  ],
};

// 箱のドラッグ・押して開くは、実際にマウスを動かして確かめる
async function shootMap(browser) {
  const page = await openApp(browser, MAP_SAMPLE);
  await page.setViewport({ width: 1600, height: 900 });
  await page.click('[data-action="home-map"]');
  const edges = await page.evaluate(() => window.__test__.mapModel(window.__test__.store.state).edges.map((e) => `${e.kind}: ${e.from} → ${e.to}`));
  console.log('矢印:', JSON.stringify(edges));
  await shot(page, '49_図_最初の画面のつながりの図');
  // 社員名簿（つながりのない箱。つながった箱の下にある）を右下へドラッグする（途中で撮る）
  const node = '#home-map .mnode[data-node="d:d6"]';
  const c = await center(page, node);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 1200, c.y + 120, { steps: 12 });
  await shot(page, '50_図_箱をドラッグしている途中');
  await page.mouse.up();
  console.log('覚えた位置（最初の画面）:', JSON.stringify(await page.evaluate(() => window.__test__.store.state.settings.mapPos)));
  await shot(page, '51_図_箱を動かした後');
  // 顧客管理の箱を押す（動かさない）と、編集の画面を開く
  await page.click('#home-map .mnode[data-node="d:d1"]');
  console.log('押した後:', JSON.stringify(await page.evaluate(() => [window.__test__.ui.view, window.__test__.currentDesign().name])));
  await page.setViewport({ width: 1400, height: 860 });
  await page.click('[data-action="open-map"]');
  await shot(page, '52_図_編集の画面のつながりの図（顧客管理）');
  // 編集の画面の図でも動かせる（画面設計ごとに覚える）
  const n3 = await center(page, '#design-map .mnode[data-node="d:d3"]');
  await dragMouse(page, n3, { x: n3.x + 40, y: n3.y + 240 });
  console.log('覚えた位置（顧客管理）:', JSON.stringify(await page.evaluate(() => window.__test__.currentDesign().mapPos)));
  await shot(page, '53_図_編集の画面で箱を動かした後');
  await page.click('#design-map .mnode[data-node="d:d5"]');
  console.log('受注管理の箱を押した後:', JSON.stringify(await page.evaluate(() => [window.__test__.ui.view, window.__test__.currentDesign().name, window.__test__.ui.panel])));
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.MIM_CHROME_PATH ? { executablePath: process.env.MIM_CHROME_PATH } : { channel: 'chrome' }),
    userDataDir: path.join(ROOT, '.devdata', 'chrome-profile'),
    args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  try {
    if (wants('home')) await shootHome(browser);
    if (wants('editor')) await shootEditor(browser);
    if (wants('parts')) await shootParts(browser);
    if (wants('db')) await shootDatabase(browser);
    if (wants('parts2')) await shootParts2(browser);
    if (wants('callout')) await shootCallouts(browser);
    if (wants('multi')) await shootMulti(browser);
    if (wants('map')) await shootMap(browser);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
