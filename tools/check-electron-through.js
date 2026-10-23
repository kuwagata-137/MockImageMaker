// 使い方: node tools/check-electron-through.js
//   クラウドのセッション（Linux・root）では ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node tools/check-electron-through.js
// 通しの確かめ（デバッグとリリースで足した）。Electron のアプリを窓を出さずに（MIM_HEADLESS=1）起動し、人が使う順に、架空の業務「出張申請」を
// 最初から最後まで画面の操作（本物のマウスとキー）で通す。ほかの確かめの道具は機能ごとに見本の designs.json を置いてから始めるが、これは空の保存先から始める。
//  1. システム（check-electron-through-system.js）: 最初の画面の「＋ 新しいシステム」で出張申請システムを作って開く
//  2. 画面設計（check-electron-through-design.js）: システムの左の「＋ 画面設計を入れる」から出張申請（部品・データベースの項目・ステータス・
//     ボタンの移る先・ひな形の画面・改訂する）と社員マスタを作る
//  3. システム: 資料を入れて読む → MPD の資料から「スイムレーン図にする」→ 役割を足す → 作業の箱を置いてつなぎ、画面設計を指す → 設計ノート
//  4. 出力と取り込み（check-electron-through-export.js）: 説明書（PDF）・MPD・画面設計の PDF・PNG・HTML。直した HTML を取り込んで置き換える
//  5. 閉じて起動し直す: 画面設計とシステムの中身が、閉じる前と同じ（designs.json もページの中も）。最初の画面・システムの画面（スイムレーン図・
//     資料・設計ノート）・改訂履歴の窓に出て、資料のファイルも置き場に残る
// 保存先・出力先は作業フォルダの .devdata/check-through（毎回消してから始める）。見本の資料は make-material-samples.js が .devdata/material-samples/ に作る。
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const electronPath = require('electron');
const { removeTree, ensureSamples, SAMPLES_DIR } = require('./material-sample-place');
const { SIX } = require('./check-electron-materials-read');
const { open, closeApp, killLeftovers, listFiles } = require('./check-electron-materials-app');
const { stateOf, whenSaved, report, results } = require('./check-electron-through-ui');
const { buildTrip, buildEmployee, backToSystem } = require('./check-electron-through-design');
const { createSystem, materialsToSwimlane, addRole, editSwimlane, writeNotes, SYSTEM, NEW_STEP, NOTE } = require('./check-electron-through-system');
const { exportSystem, exportDesign, importEdited } = require('./check-electron-through-export');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, '.devdata', 'check-through');
const USER_DATA = path.join(BASE, 'userData');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
const OUT = path.join(BASE, 'out');
const IMPORT_FILE = path.join(BASE, 'import.html');
const PORT = 9341; // ほかの確かめの道具（9333〜9335）と重ならないポート
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(extraArgs = [], userData = USER_DATA, extraEnv = {}) {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: userData, ...extraEnv };
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
    const page = (await browser.pages()).find((p) => /mock_v.*\.html$/.test(p.url()));
    if (page) {
      await page.waitForSelector('#home-cards');
      return page;
    }
    await sleep(250);
  }
  throw new Error('アプリの画面が見つかりません');
}

// テスト用の窓口（window.__test__）を出す。窓口はアプリの起動の前に置いたときだけ埋まるので、置いてからページを読み込み直す
async function enableTestHooks(page) {
  await page.evaluateOnNewDocument(() => { window.__test__ = {}; });
  await page.reload();
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
}

async function withTimeout(promise, ms, label) {
  return Promise.race([promise, sleep(ms).then(() => { throw new Error(`時間切れ: ${label}`); })]);
}

const h = { launch, connect, appPage, enableTestHooks, withTimeout, sleep, PORT };
// 今つないでいるページ（途中で止まったときに、そのときの画面の様子を .devdata/check-through/failed.txt に残すため。隠れた窓では画面の写しを撮れない）
let current = null;

// 止まったときの画面の様子（開いている画面・選んでいる物・窓・お知らせ・右の欄の文字）を書き出す
async function dumpPage(page) {
  const text = await page.evaluate(() => {
    const T = window.__test__ || {};
    const pick = (sel) => { const el = document.querySelector(sel); return el ? el.innerText : '（なし）'; };
    const ui = T.ui ? JSON.stringify({ view: T.ui.view, panel: T.ui.panel, sysPanel: T.ui.sysPanel, sel: T.ui.sel, screenId: T.ui.screenId }) : '';
    const parts = [...document.querySelectorAll('#stage .part')].map((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return `部品 ${el.dataset.partId.slice(0, 6)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} 真ん中の上: ${top ? top.className || top.tagName : 'なし'}（${top && top.closest('.part') ? top.closest('.part').dataset.partId.slice(0, 6) : '-'}）`;
    });
    return [`窓の大きさ ${innerWidth}×${innerHeight}`, ...parts, 'ui: ' + ui,'窓: ' + pick('.modal'), 'お知らせ: ' + pick('#toast'), '右の欄:', pick('#side-panel'), 'システムの右の欄:', pick('#sys-side')].join('\n');
  });
  fs.writeFileSync(path.join(BASE, 'failed.txt'), text);
}

// 1〜4: 空の保存先から、システム・画面設計・資料・スイムレーン図・設計ノートを作り、出力して取り込む。戻り値は閉じる前の状態とシステムの id
async function buildRun() {
  const env = { MIM_MATERIAL_FILES: JSON.stringify(SIX.map((n) => path.join(SAMPLES_DIR, n))), MIM_EXPORT_DIR: OUT, MIM_IMPORT_FILE: IMPORT_FILE };
  const app = await open(h, USER_DATA, env);
  const { page } = app;
  current = page;
  const sysId = await createSystem(page);
  const trip = await buildTrip(page);
  await backToSystem(page);
  await buildEmployee(page);
  await backToSystem(page);
  await materialsToSwimlane(page);
  await addRole(page);
  await editSwimlane(page);
  await writeNotes(page);
  await exportSystem(page, OUT, { systemName: SYSTEM, newStep: NEW_STEP, decision: NOTE.decision });
  const html = await exportDesign(page, OUT, (await stateOf(page)).designs.find((d) => d.id === trip.id));
  await importEdited(page, html, IMPORT_FILE, (await stateOf(page)).designs.find((d) => d.id === trip.id));
  await whenSaved(page);
  const before = await stateOf(page);
  const code = await closeApp(h, app);
  report(code === 0, '作り終えて閉じる', `終了コード ${code}`);
  return { before, sysId, tripId: trip.id };
}

// 5: 起動し直して、中身と画面を確かめる
async function reloadRun({ before, sysId, tripId }) {
  const app = await open(h, USER_DATA);
  const { page } = app;
  current = page;
  const now = await stateOf(page);
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  report(same(now.designs, before.designs) && same(now.systems, before.systems) && same(saved.designs, before.designs) && same(saved.systems, before.systems),
    '閉じて起動し直すと、画面設計とシステムの中身が閉じる前と同じ（designs.json もページの中も）', `画面設計 ${now.designs.length}・システム ${now.systems.length}`);
  const cards = await page.$$eval('.card-name', (els) => els.map((e) => e.textContent));
  await page.click(`[data-action="open-system"][data-id="${sysId}"]`);
  await page.waitForSelector('#sys-view', { visible: true });
  await page.click('#sys-list .db-entry[data-panel="swimlane"]');
  const nodes = await page.$$eval('#sys-swim .mnode[data-node^="w:"]', (n) => n.length);
  await page.click('#sys-list .db-entry[data-panel="materials"]');
  const rows = await page.$$eval('#sys-view .mat-tbl tbody tr', (t) => t.length);
  await page.click('#sys-list .db-entry[data-panel="notes"]');
  await page.click('#sys-view .nt-tab[data-stage="read"]');
  const findings = await page.$eval('#sys-view [data-sy="note-findings"]', (e) => e.value);
  const files = listFiles(path.join(USER_DATA, 'data', 'files', sysId));
  const y = before.systems.find((s) => s.id === sysId);
  report(cards.includes('出張申請') && cards.includes('社員マスタ') && nodes === y.swimlane.steps.length && rows === 6 && files.length === 6 && findings === NOTE.findings,
    '起動し直した画面: 最初の画面のカード・スイムレーン図の作業の箱・資料の行と置き場のファイル・設計ノートの読み取ったこと',
    `カード ${cards.join('・')} ／ 作業の箱 ${nodes} ／ 資料 ${rows} 行・ファイル ${files.length} ／ 読み取ったこと ${findings.length} 字`);
  await page.click(`.sys-dcard[data-id="${tripId}"]`);
  await page.click('#toolbar [data-action="open-revisions"]');
  await page.waitForSelector('.modal .rv-list');
  const revs = await page.$$eval('.modal .rv-list tbody tr', (trs) => trs.map((tr) => tr.children[2].textContent.trim()));
  report(revs.length === 2 && revs.some((r) => /最初の版/.test(r)) && revs.some((r) => /取り込む前の状態/.test(r)),
    '起動し直した改訂履歴の窓に、第 1 版と「取り込む前の状態」が出る', revs.join('・'));
  await page.click('.modal [data-dlg="cancel"]');
  const code = await closeApp(h, app);
  report(code === 0, '起動し直したアプリを閉じる', `終了コード ${code}`);
}

(async () => {
  removeTree(BASE);
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await ensureSamples();
    const built = await buildRun();
    await reloadRun(built);
  } catch (e) {
    if (current) await dumpPage(current).catch(() => {});
    throw e;
  } finally {
    await killLeftovers();
  }
  const ok = results.length > 0 && results.every(Boolean);
  console.log(ok ? 'OK' : 'NG');
  console.log('出力したファイル:', path.relative(ROOT, OUT));
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error('NG', e);
  await killLeftovers();
  process.exit(1);
});
