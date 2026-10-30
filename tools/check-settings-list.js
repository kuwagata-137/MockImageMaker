// 使い方: node tools/check-settings-list.js
//   クラウドのセッション（Linux・root）では ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node tools/check-settings-list.js
// 設定一覧の載せ方（q138）を、Electron のアプリを窓を出さずに（MIM_HEADLESS=1）起動して確かめる。
// 架空の画面設計「備品購入申請」（ステータス 12 個・操作 26 個、メモの長い項目、明細の列の多いテーブル）の PDF（A4 横・表紙あり）を出力し、
// アプリの数え方（countOnly）と PDF のページ数が同じか、分けた画面の「設定一覧」「設定一覧（続き）」のページがあるかを見る。
// 出力した PDF は .devdata/check-settings-list/out/備品購入申請.pdf（目で見て確かめる）。
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');
const electronPath = require('electron');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, '.devdata', 'check-settings-list');
const USER_DATA = path.join(BASE, 'userData');
const OUT = path.join(BASE, 'out');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
const PDF_FILE = path.join(OUT, '備品購入申請.pdf');
const PRINT_FILE = path.join(OUT, 'print.html');
const PRINT_DIFF_FILE = path.join(OUT, 'print_diff.html');
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 架空の見本 ──
const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId) => ({ id, type: 'text1', x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const STATE_NAMES = ['下書き', '申請中', '課長承認待ち', '部長承認待ち', '総務確認待ち', '発注待ち', '納品待ち', '検収待ち', '支払待ち', '完了', '差し戻し', '取り下げ'];
const STATES = STATE_NAMES.map((name, i) => ({ id: 'st' + i, name }));
const ACTIONS = Array.from({ length: 26 }, (_, i) => {
  const from = i % 10;
  return { id: 'ac' + i, name: ['申請する', '承認する', '差し戻す', '確認する', '発注する'][i % 5], from: 'st' + from, to: 'st' + (from + 1), role: ['申請者', '課長', '部長', '総務', '経理'][i % 5],
    cond: i % 2 ? '金額が 10 万円以上で、見積書が 2 社分そろっているとき。理由を書く' : '' };
});
const MEMO = '番号の付け方は総務課の申請台帳に合わせた（質問 A4）。年度が変わったら 1 から付け直す。差し戻しのあとに出し直しても番号は変えない。'
  + '取り下げた申請の番号は欠番のままにし、使い回さない。年度の切り替えは 4 月 1 日（会計年度）で、暦の年ではない。';
const NAMES = ['申請番号', '申請日', '申請者', '部署', '品名', '数量', '単価', '金額', '購入理由', '購入先', '希望納期', '見積書', '承認者'];
const SAMPLE = {
  schemaVersion: 3,
  settings: { customTargets: [], mapPos: {} },
  designs: [{
    id: 'd1', name: '備品購入申請', target: 'kintone', description: '備品を買うときの申請と承認（架空の業務）。', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    trashedAt: null, revisions: [], mapPos: {},
    items: [
      item('st', 'ステータス', 'status', { props: { states: STATES, actions: ACTIONS } }),
      ...NAMES.map((n, i) => item('i' + i, n, 'text1', { required: i % 2 === 0, memo: i % 3 ? MEMO : '', props: { maxLen: '100' } })),
      ...Array.from({ length: 30 }, (_, i) => item('m' + i, `明細の項目 ${i + 1}`, 'text1', { props: { maxLen: '50', initial: '前の申請の同じ欄の値。前の申請がないときは、申請者の部署で最後に出した申請の値。どちらもないときは空' } })),
    ],
    screens: [
      screen('s1', '購入申請の入力', [
        { id: 'p0', type: 'steps', x: 32, y: 56, w: 1216, h: 40, no: 1, labelPos: 'top', sample: '', placeholder: '', itemId: 'st', view: { current: 'st1', showWord: true } },
        ...NAMES.map((n, i) => ipart('p' + (i + 1), 32 + (i % 2) * 400, 120 + Math.floor(i / 2) * 88, i + 2, 'i' + i)),
        { id: 'b1', type: 'button', x: 32, y: 720, w: 96, h: 40, no: 15, label: '申請する', props: { style: 'primary', action: 'ステータスを申請中にする', to: '', designId: '', screenId: '', url: '' }, memo: '差し戻しのときだけ出す。' },
      ]),
      screen('s2', 'まとめて購入申請', Array.from({ length: 30 }, (_, i) => ipart('q' + i, 32 + (i % 3) * 400, 64 + Math.floor(i / 3) * 72, i + 1, 'm' + i)), { height: 800 }),
      screen('s3', '申請の詳細', [ipart('r1', 32, 112, 1, 'i4'), ipart('r2', 32, 200, 2, 'i5')]),
    ],
  }],
};

function launch() {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA, MIM_EXPORT_DIR: OUT };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}
async function connect() {
  for (let i = 0; i < 60; i++) {
    try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }); } catch (_) { await sleep(250); }
  }
  throw new Error('Electron に接続できませんでした');
}
async function appPage(browser) {
  for (let i = 0; i < 40; i++) {
    const page = (await browser.pages()).find((p) => /mock_v.*\.html$/.test(p.url()));
    if (page) { await page.waitForSelector('#home-cards'); return page; }
    await sleep(250);
  }
  throw new Error('アプリの画面が見つかりません');
}
const countPdfPages = (file) => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

(async () => {
  // fs.rmSync は使わない（Windows の Node v24.12.0 では、日本語の名前を渡すと Node ごと落ちる）
  for (const f of [PDF_FILE, PRINT_FILE, PRINT_DIFF_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(SAMPLE));
  const child = launch();
  let ok = true;
  const check = (cond, label, note = '') => { console.log(`${cond ? 'OK' : 'NG'} ${label}${note ? ' … ' + note : ''}`); if (!cond) ok = false; };
  try {
    const browser = await connect();
    const page = await appPage(browser);
    await page.evaluateOnNewDocument(() => { window.__test__ = {}; });
    await page.reload();
    await page.waitForFunction(() => window.__test__ && window.__test__.ready);
    await page.click('.card-open[data-id="d1"]');
    const opts = { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true };
    const facts = await page.evaluate((o) => {
      const T = window.__test__;
      const d = T.store.state.designs.find((x) => x.id === 'd1');
      const doc = T.exportDocument(d, T.store.state, o);
      const heads = doc.pages.map((h) => (h.match(/<h2>([^<]*)<\/h2>/) || [])[1] || '（表紙）');
      window.__printHtml = doc.html;
      return { total: doc.total, count: T.exportDocument(d, T.store.state, { ...o, countOnly: true }).total, heads, all: doc.pages.join('\n') };
    }, opts);
    console.log('ページの見出し: ' + facts.heads.join(' → '));
    check(facts.total === facts.count, 'アプリの数え方（countOnly）と組んだページ数が同じ', `${facts.total}・${facts.count}`);
    check(!facts.heads.includes('1　購入申請の入力　設定一覧'), '購入申請の入力は、繰り返しを外した文で同じページに収まる');
    check(facts.heads.some((h) => /^2　まとめて購入申請　設定一覧/.test(h)), 'まとめて購入申請は、設定一覧を次のページへ分ける');
    check(!facts.heads.some((h) => /^3　申請の詳細　設定一覧/.test(h)), '申請の詳細は、同じページのまま');
    check(/メモは項目一覧（\d+ ページ）/.test(facts.all) && /「ステータスの流れ」（\d+ ページ）/.test(facts.all), '設定一覧の文に、載っているページを書く');
    // 印刷用の文書を保存する（Electron を閉じた後に、ページごとに画像にする）
    fs.writeFileSync(PRINT_FILE, await page.evaluate(() => window.__printHtml));
    // 出力の窓から PDF（A4 横）を出力し、ページ数がアプリの数え方と同じか（はみ出したページがないか）を見る
    await page.click('#toolbar [data-action="export"]');
    await page.waitForSelector('.modal .xp-kinds');
    await page.click('[data-xkind="pdf"]');
    await page.click('[name="xp-paper"][value="A4"]');
    await page.click('[name="xp-orient"][value="landscape"]');
    await page.click('.modal [data-dlg="ok"]');
    for (let i = 0; i < 300 && !(fs.existsSync(PDF_FILE) && fs.statSync(PDF_FILE).size > 0); i++) await sleep(200);
    await sleep(500);
    const n = countPdfPages(PDF_FILE);
    check(n === facts.total, 'PDF のページ数がアプリの数え方と同じ', `PDF ${n} ページ・アプリ ${facts.total} ページ`);
    // 変更マーク: 第 1 版を残してから、まとめて購入申請のアイテムを 1 つ消し、第 1 版と比べたページを組む。削除したアイテムの欄は、最後の設定一覧のページの下
    const df = await page.evaluate((o) => {
      const T = window.__test__;
      const rid = T.actions.addRevision('d1', { note: '確認用' });
      T.actions.deletePart('d1', 's2', 'q0');
      const d = T.store.state.designs.find((x) => x.id === 'd1');
      const doc = T.exportDocument(d, T.store.state, { ...o, diffRevId: rid });
      window.__printDiff = doc.html;
      const sets = doc.pages.filter((h) => /まとめて購入申請　設定一覧/.test(h));
      return { total: doc.total, count: T.exportDocument(d, T.store.state, { ...o, diffRevId: rid, countOnly: true }).total, last: sets[sets.length - 1] || '', first: sets[0] || '' };
    }, opts);
    check(df.total === df.count, '変更マーク: アプリの数え方と組んだページ数が同じ', `${df.total}・${df.count}`);
    check(/削除したアイテム/.test(df.last) && !/削除したアイテム/.test(df.first), '変更マーク: 削除したアイテムの欄は、最後の設定一覧のページの下');
    fs.writeFileSync(PRINT_DIFF_FILE, await page.evaluate(() => window.__printDiff));
    await page.evaluate(() => window.close()).catch(() => {});
    await browser.disconnect();
  } catch (e) {
    ok = false;
    console.error('NG', e);
  } finally {
    await Promise.race([child.exited, sleep(5000)]);
    if (child.exitCode == null) child.kill();
  }
  // 印刷用の文書を、headless の Chrome でページごとに画像にする（PDF を画像にする道具がない PC でも、目で見て確かめられるように。窓は出ない）
  for (const [file, head] of [[PRINT_FILE, 'page'], [PRINT_DIFF_FILE, 'diff']]) {
    if (!fs.existsSync(file)) continue;
    const chrome = await puppeteer.launch({ headless: true, ...(process.env.MIM_CHROME_PATH ? { executablePath: process.env.MIM_CHROME_PATH } : { channel: 'chrome' }),
      userDataDir: path.join(ROOT, '.devdata', 'chrome-profile'), args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
    try {
      const doc = await chrome.newPage();
      await doc.setViewport({ width: 1200, height: 900 });
      await doc.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      const pgs = await doc.$$('body > .pg');
      for (let i = 0; i < pgs.length; i++) await pgs[i].screenshot({ path: path.join(OUT, `${head}_${String(i + 1).padStart(2, '0')}.png`) });
      console.log(`ページの画像: ${pgs.length} 枚（${path.relative(ROOT, OUT)}\\${head}_NN.png）`);
    } finally {
      await chrome.close();
    }
  }
  console.log(ok ? 'OK' : 'NG');
  console.log('出力したファイル: ' + path.relative(ROOT, PDF_FILE));
  process.exit(ok ? 0 : 1);
})();
