// 使い方: node tools/check-electron.js
// Electron のアプリを窓を出さずに（MIM_HEADLESS=1）起動し、次の 5 つを確かめる。
//  1. 画面設計を作って名前を変え、部品の箱から部品を 1 つ（データベースの項目も 1 つ増える）と吹き出しを 1 つ置き、
//     つながりの図の箱をドラッグで動かし、ひな形から画面を 2 つ足して「…」のメニューで並べ替え、
//     窓を閉じたあと <userData>/data/designs.json に残っている
//  2. 1 つ目が動いている間に 2 つ目を起動すると、2 つ目はすぐに終わる
//  3. 右の欄の文字の欄に文字を打ち、欄を離れない（change が起きていない）まま閉じても、その文字が designs.json に残る。閉じ方は 3 つ。
//      - 窓の ×（BrowserWindow.close()。× を押したときと同じ流れ）: 「説明」と「名前」の欄で確かめる
//      - ファイル > 終了（app.quit()。メニューの「終了」〔role: quit〕と同じ呼び出し）: 「説明」の欄で確かめる
//      - ページの window.close(): 「説明」の欄で確かめる
//  4. 起動し直すと、作った画面設計が一覧に出て、3 で打った文字も右の欄に出る。1 で置いた部品・吹き出し・項目・箱の位置と、画面の並びも出る
//  5. データの形 v1（部品が項目名と設定を持つ形）の designs.json を、v2（データベースの項目に移す形）に直して読める。
//     直したデータを保存すると、v1 の形のファイルは .bak に残る（保存先は .devdata/check-userData-v1）
//  6. 1 でメニューバーの ▼ の「改訂する」から第 1 版を作ると、designs.json に版と写しが残り、起動し直しても改訂履歴の窓に出て、
//     「見る」で第 1 版（3 で文字を打つ前の中身）を開ける（第 6 段階）
//  7. データの形 v2（ステータスが名前の並び・見本で出すステータスが名前・ボタンに移る先がない形）の designs.json を、v3 に直して読める（第 8 段階）。
//     見本は版 2 のアプリで作った test/fixtures/v2-state.json。左の一覧の「ステータスの移り方」で操作を 1 つ足して保存させると、
//     designs.json は v3（ステータスに id・見本で出すステータスは id・ボタンとリンクの文字に移る先の欄）になり、.bak は v2 のまま。
//     起動し直しても同じ中身で読める（保存先は .devdata/check-userData-v2）
//  8. システム（第 9 段階）を 3 つ作る（架空の出張申請システム・経費精算システム・ごみ箱へ移した旧出張申請システム）。
//     出張申請システムは AI の道具（テスト用の窓口 window.__test__ の aiDispatch）で、経費精算システムは actions で組み立てる。
//     役割・スイムレーン（作業と矢印・作業の指す先〔画面設計・画面・ステータス〕）・画面設計の並び（社員マスタは 2 つのシステムで共通）と、
//     別の接続の AI の道具で直して作った履歴の行（AI が直す前の状態。写しつき）が、閉じた後の designs.json と、起動し直したページの中で同じ中身で残る。
//     起動し直した後、システムの画面（スイムレーン図・左の画面設計のカード・履歴）に出て、ごみ箱のシステムも残り、
//     履歴の行から restoreSystemRevision で戻せて、戻した中身と「戻す前の状態」の行が保存される（保存先は .devdata/check-userData-sys）
//  9. システムの画面の「概要」の名前の欄と、スイムレーン図の右の欄の作業の文字・メモの欄に文字を打ち、欄を離れないまま閉じても、
//     その文字が designs.json に残る。閉じ方は窓の × とファイル > 終了（3 と同じ作り）
// 10. 起動し直すと、9 で打った文字が、概要の名前の欄と右の欄の作業の文字・メモの欄に出る
// 窓の × と終了は、メインプロセスを --inspect で起動し、Node の inspector から呼んで再現する。
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
const USER_DATA_V1 = path.join(ROOT, '.devdata', 'check-userData-v1');
const STATE_FILE_V1 = path.join(USER_DATA_V1, 'data', 'designs.json');
const USER_DATA_V2 = path.join(ROOT, '.devdata', 'check-userData-v2');
const STATE_FILE_V2 = path.join(USER_DATA_V2, 'data', 'designs.json');
const V2_STATE = require('../test/fixtures/v2-state.json').state; // 版 2 のアプリで作った見本（架空の受注管理・経費精算・出張申請）
const PORT = 9333; // ページ（renderer）の remote debugging
const MAIN_PORT = 9334; // メインプロセスの inspector（窓の × と終了で使う）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 3 で打つ文字。how: 'x' は窓の ×、'quit' はファイル > 終了、'page' はページの window.close()。key は designs.json の項目
const TYPING_CASES = [
  { how: 'x', label: '窓の ×・説明', field: 'design-desc', key: 'description', text: '顧客の連絡先と商談を管理する。' },
  { how: 'x', label: '窓の ×・名前', field: 'design-name', key: 'name', text: 'アプリ' },
  { how: 'quit', label: 'ファイル > 終了・説明', field: 'design-desc', key: 'description', text: '月末に売上を集計する。' },
  { how: 'page', label: 'window.close()・説明', field: 'design-desc', key: 'description', text: '担当者ごとに一覧で見る。' },
];
const MAIN_CLOSE = { x: 'BrowserWindow.getAllWindows()[0].close()', quit: 'app.quit()' }; // メインプロセスで呼ぶ閉じ方

function launch(extraArgs = [], userData = USER_DATA) {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: userData };
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

const savedDesign = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).designs[0];

async function openFirstDesign(page) {
  await page.click('[data-action="open"]');
  await page.waitForSelector('#side-panel [data-field="design-desc"]');
}

// メインプロセスの inspector につなぎ、式を 1 つ評価する。
// 評価のあとはすぐ切る（つないだままだと、終わるときに inspector の切断を待って止まるため）
async function evalInMain(expression) {
  let list = null;
  for (let i = 0; i < 40 && !list; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json/list`)).json();
    } catch (_) {
      await sleep(250);
    }
  }
  if (!list || !list[0]) throw new Error('メインプロセスの inspector に接続できませんでした');
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = new Promise((resolve) => {
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id === 1) resolve(msg); };
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true } }));
  const msg = await withTimeout(reply, 5000, 'メインプロセスで式を評価できない');
  ws.close();
  const err = msg.error || (msg.result && msg.result.exceptionDetails);
  if (err) throw new Error('メインプロセスでの評価に失敗しました: ' + JSON.stringify(err));
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
  await page.click('.pal-btn[data-type="text1"]');
  await page.click('.pal-btn[data-type="callout"]');
  // つながりの図の箱（この画面設計）を、右へ 80・下へ 40 ドラッグする
  await page.click('[data-action="open-map"]');
  const box = await (await page.waitForSelector('#design-map .mnode')).boundingBox();
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
  await page.mouse.up();
  // ひな形から「一覧」と「入力」を足し（足した画面のすぐ後ろに入る）、「入力」を「…」のメニューで上へ動かす → 画面 1・入力・一覧
  for (const tpl of ['list', 'input']) {
    await page.click('.sl-add');
    await page.waitForSelector(`.modal .tpl[data-tpl="${tpl}"]`);
    await page.click(`.modal .tpl[data-tpl="${tpl}"]`);
    await page.click('.modal [data-dlg="ok"]');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  }
  const inputId = await page.$eval('.sl-item.active', (e) => e.dataset.id);
  await page.hover(`.sl-wrap[data-id="${inputId}"]`);
  await page.click(`.sl-more[data-id="${inputId}"]`);
  await page.click('.screen-menu [data-action="screen-up"]');
  await page.click('.sl-item[data-action="select-screen"]');
  // メニューバーの ▼ の「改訂する」で、第 1 版を作る
  await page.click('#tb-rev-arrow');
  await page.click('#rev-menu-root [data-action="add-revision"]');
  await page.waitForSelector('.modal [name="rv-note"]');
  await page.type('.modal [name="rv-note"]', '最初の版。');
  await page.click('.modal [data-dlg="ok"]');
  await page.waitForFunction(() => !document.querySelector('.modal'));
  const title = await page.$eval('#ed-title', (e) => e.textContent);

  const second = launch();
  const secondCode = await withTimeout(second.exited, 15000, '2 つ目の起動が終わらない');
  const firstAlive = child.exitCode === null;

  await page.evaluate(() => window.close());
  browser.disconnect();
  const code = await withTimeout(child.exited, 15000, '1 つ目が閉じない');
  return { title, secondCode, firstAlive, code };
}

// 右の欄の文字の欄の終わりに文字を打ち、欄を離れないまま閉じる。
// 戻り値 { before: 閉じる前の designs.json の値, after: 閉じたあとの値, focused: 閉じる直前もその欄にいたか, code }
async function typeThenClose({ how, field, key, text }) {
  const args = [`--remote-debugging-port=${PORT}`];
  if (MAIN_CLOSE[how]) args.push(`--inspect=${MAIN_PORT}`);
  const child = launch(args);
  const browser = await connect();
  const page = await appPage(browser);
  await openFirstDesign(page);
  const sel = `#side-panel [data-field="${field}"]`;
  await page.focus(sel);
  await page.$eval(sel, (el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(text);
  await sleep(500);
  const before = savedDesign()[key];
  const focused = await page.$eval(sel, (el) => document.activeElement === el);
  if (MAIN_CLOSE[how]) await evalInMain(`require('electron').${MAIN_CLOSE[how]}`);
  else await page.evaluate(() => window.close());
  browser.disconnect();
  const code = await withTimeout(child.exited, 15000, `閉じない（${how}）`);
  return { before, after: savedDesign()[key], focused, code };
}

async function secondRun() {
  const child = launch([`--remote-debugging-port=${PORT}`]);
  const browser = await connect();
  const page = await appPage(browser);
  const names = await page.$$eval('.card-name', (els) => els.map((e) => e.textContent));
  await openFirstDesign(page);
  const name = await page.$eval('[data-field="design-name"]', (e) => e.value);
  const desc = await page.$eval('[data-field="design-desc"]', (e) => e.value);
  const parts = await page.$$eval('#stage .part', (els) => els.length);
  const callouts = await page.$$eval('#stage .callout', (els) => els.length);
  const items = await page.$eval('[data-action="open-items"] small', (e) => e.textContent);
  const screens = await page.$$eval('.sl-name', (els) => els.map((e) => e.textContent.replace(/^\d+\s+/, '')));
  // 改訂履歴の窓に第 1 版が出て、「見る」で第 1 版（文字を打つ前の説明）を開ける
  await page.click('#toolbar [data-action="open-revisions"]');
  await page.waitForSelector('.modal .rv-list');
  const revs = await page.$$eval('.modal .rv-list tbody tr', (els) => els.map((tr) => `${tr.children[0].textContent.trim()}・${tr.children[2].textContent.trim()}`));
  await page.click('.modal [data-rv="view"]');
  await page.waitForSelector('#rv-band:not([hidden])');
  const band = await page.$eval('#rv-band', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const viewDesc = await page.$eval('[data-field="design-desc"]', (e) => e.value);
  await page.click('#rv-band [data-action="rev-stop-view"]');
  await page.click('[data-action="open-map"]');
  const mapBox = await page.$eval('#design-map .mnode', (e) => `${e.style.left}, ${e.style.top}`);
  await page.evaluate(() => window.close());
  browser.disconnect();
  await withTimeout(child.exited, 15000, '起動し直したアプリが閉じない');
  return { names, name, desc, parts, callouts, items, mapBox, screens, revs, band, viewDesc };
}

// データの形 v1 の designs.json（部品が項目名と設定を持つ。入力欄 2 つとボタン 1 つ）
const V1_STATE = {
  schemaVersion: 1,
  settings: { customTargets: [] },
  designs: [{
    id: 'd1', name: '顧客管理（v1 の形）', target: 'kintone', description: '', createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
    trashedAt: null, revisions: [],
    screens: [{
      id: 's1', name: '新規登録', device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right',
      parts: [
        { id: 'p1', type: 'text1', x: 24, y: 64, w: 320, h: 64, no: 1, label: '顧客名', labelPos: 'top', sample: '', placeholder: '', required: true, memo: '', props: { maxLen: '50', initial: '' } },
        { id: 'p2', type: 'dropdown', x: 24, y: 152, w: 320, h: 64, no: 2, label: '区分', labelPos: 'top', sample: '', placeholder: '', required: false, memo: '', props: { options: ['法人', '個人'], initial: '法人' } },
        { id: 'p3', type: 'button', x: 24, y: 240, w: 96, h: 40, no: 3, label: '保存', labelPos: 'top', sample: '', placeholder: '', required: false, memo: '', props: { style: 'primary', action: '' } },
      ],
    }],
  }],
};

// v1 の形の designs.json を置いて起動し、データベースの項目の一覧表を開いて、項目を 1 つ足して（保存させるため）閉じる
async function migrateRun() {
  fs.rmSync(USER_DATA_V1, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(STATE_FILE_V1), { recursive: true });
  fs.writeFileSync(STATE_FILE_V1, JSON.stringify(V1_STATE), 'utf8');
  const child = launch([`--remote-debugging-port=${PORT}`], USER_DATA_V1);
  const browser = await connect();
  const page = await appPage(browser);
  const names = await page.$$eval('.card-name', (els) => els.map((e) => e.textContent));
  await page.click('[data-action="open"]');
  await page.waitForSelector('#stage .part');
  const labels = await page.$$eval('#stage .part .plabel-text', (els) => els.map((e) => e.textContent));
  await page.click('[data-action="open-items"]');
  const rows = await page.$$eval('#db-view tbody tr', (els) => els.map((r) => r.children[1].textContent.trim()));
  await page.click('#db-view [data-action="add-item-menu"]');
  await page.click('#db-view .pop-menu [data-type="date"]');
  await sleep(500);
  await page.evaluate(() => window.close());
  browser.disconnect();
  await withTimeout(child.exited, 15000, 'v1 の形を読んだアプリが閉じない');
  const saved = JSON.parse(fs.readFileSync(STATE_FILE_V1, 'utf8'));
  const bak = JSON.parse(fs.readFileSync(STATE_FILE_V1 + '.bak', 'utf8'));
  return { names, labels, rows, saved, bakVersion: bak.schemaVersion };
}

// v2 の形の designs.json で起動し、受注管理を開いて、ステータスの見え方と左の一覧の数を読む。add なら「ステータスの移り方」で操作を 1 つ足して（保存させるため）閉じる
async function v2Run({ add }) {
  const child = launch([`--remote-debugging-port=${PORT}`], USER_DATA_V2);
  const browser = await connect();
  const page = await appPage(browser);
  await page.click('.card-open[data-id="d-order"]');
  await page.waitForSelector('#stage .pstatus');
  const badge = await page.$eval('#stage .pstatus .pbadge', (e) => e.textContent);
  const notes = await page.$$eval('#screen-list .db-entry small', (els) => els.map((e) => e.textContent));
  await page.click('[data-action="open-process"]');
  await page.waitForSelector('#side-settings [data-ps]');
  const states = await page.$$eval('#side-settings [data-ps]', (els) => els.map((e) => e.value));
  if (add) {
    await page.click('#side-settings [data-action="pa-add"]');
    await page.waitForSelector('#side-settings .pa-card');
  }
  const cards = await page.$$eval('#side-settings .pa-card', (els) => els.length);
  await sleep(500);
  await page.evaluate(() => window.close());
  browser.disconnect();
  await withTimeout(child.exited, 15000, 'v2 の形を読んだアプリが閉じない');
  return { badge, notes, states, cards };
}
async function migrateV2() {
  fs.rmSync(USER_DATA_V2, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(STATE_FILE_V2), { recursive: true });
  fs.writeFileSync(STATE_FILE_V2, JSON.stringify(V2_STATE), 'utf8');
  const first = await v2Run({ add: true });
  const saved = JSON.parse(fs.readFileSync(STATE_FILE_V2, 'utf8'));
  const bak = JSON.parse(fs.readFileSync(STATE_FILE_V2 + '.bak', 'utf8'));
  const again = await v2Run({ add: false });
  const after = JSON.parse(fs.readFileSync(STATE_FILE_V2, 'utf8'));
  return { first, again, saved, after, bakVersion: bak.schemaVersion };
}

async function checkTypingCases() {
  let ok = true;
  for (const c of TYPING_CASES) {
    const r = await typeThenClose(c);
    const saved = r.focused && !r.before.includes(c.text) && r.after.includes(c.text);
    console.log(`打ちかけのまま閉じる（${c.label}）: 打った「${c.text}」 ／ 閉じる直前も欄にいたか: ${r.focused}`,
      `／ 閉じる前の designs.json「${r.before}」→ 閉じたあと「${r.after}」 ／ 終了コード ${r.code} → ${saved ? '保存された' : '保存されなかった'}`);
    ok = ok && saved;
  }
  return ok;
}

// ── システム（第 9 段階。上の 8〜10）──
const USER_DATA_SYS = path.join(ROOT, '.devdata', 'check-userData-sys');
const STATE_FILE_SYS = path.join(USER_DATA_SYS, 'data', 'designs.json');
const SYS_CONTENT_KEYS = ['name', 'description', 'roles', 'swimlane', 'designIds']; // ページの SYSTEM_CONTENT_KEYS と同じ（履歴の行の写しの中身）
const STEP_IN = '出張申請を入力する'; // 9 で文字を打つ作業（出張申請システムのスイムレーンの作業）
const AI_ROW_NOTE = 'Claude Code が直す前の状態';

// キーを並べ替えた JSON（読み込み直してキーの順が変わっても、同じ中身なら同じ文字になる）
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const sysContent = (y) => canonical(Object.fromEntries(SYS_CONTENT_KEYS.map((k) => [k, y[k]])));
const savedSysState = () => JSON.parse(fs.readFileSync(STATE_FILE_SYS, 'utf8'));
const copyJson = (v) => JSON.parse(JSON.stringify(v));

// テスト用の窓口（window.__test__）を出す。窓口はアプリの起動の前に置いたときだけ埋まるので、置いてからページを読み込み直す
async function enableTestHooks(page) {
  await page.evaluateOnNewDocument(() => { window.__test__ = {}; });
  await page.reload();
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
}
async function openSysApp(extraArgs = []) {
  const child = launch([`--remote-debugging-port=${PORT}`, ...extraArgs], USER_DATA_SYS);
  const browser = await connect();
  const page = await appPage(browser);
  await enableTestHooks(page);
  return { child, browser, page };
}
// how: 'x' は窓の ×、'quit' はファイル > 終了（どちらもメインプロセスで呼ぶ。--inspect で起動したとき）、'page' はページの window.close()
async function closeSysApp({ child, browser, page }, how = 'page') {
  if (MAIN_CLOSE[how]) await evalInMain(`require('electron').${MAIN_CLOSE[how]}`);
  else await page.evaluate(() => window.close());
  browser.disconnect();
  return withTimeout(child.exited, 15000, `システムの確かめのアプリが閉じない（${how}）`);
}
// AI の道具を呼ぶ。接続（session）ごとに、前からあるシステムへの最初の変更で「AI が直す前の状態」の行が入る
async function aiCall(page, session, tool, args) {
  const r = await page.evaluate((t, a, s) => window.__test__.aiDispatch(t, a, { session: s, client: 'claude-code' }), tool, args, session);
  if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
  return r.result;
}

// 画面設計 3 つ（出張申請〔ステータスあり〕・経費精算・社員マスタ）と、出張申請システム（役割・画面設計の並び・スイムレーン）を AI の道具で作る。
// 戻り値は出張申請システムの id
async function buildTripSystem(page) {
  const ai = (tool, args) => aiCall(page, 's-build', tool, args);
  for (const name of ['出張申請', '経費精算', '社員マスタ']) await ai('create_design', { name, target: 'kintone' });
  await ai('add_screen', { design: '出張申請', name: '新規申請' });
  await ai('edit_process', { design: '出張申請', ops: [{ op: 'set_states', states: ['申請中', '承認待ち', '承認済み'] }] });
  await ai('add_screen', { design: '経費精算', name: '精算の入力' });
  const A = (await ai('create_system', { name: '出張申請システム', description: '出張の事前申請と上長の承認をまとめる。' })).id;
  await ai('update_system', { system: A, ops: [{ op: 'add', name: '申請者', memo: '出張する社員' }, { op: 'add', name: '上長' }] });
  for (const design of ['出張申請', '社員マスタ']) await ai('add_to_system', { system: A, design });
  await ai('set_swimlane', {
    system: A,
    steps: [
      { key: 's', role: '申請者', kind: 'start', text: '出張が決まる' },
      { key: 'in', role: '申請者', kind: 'input', text: STEP_IN, ref: { design: '出張申請', screen: '新規申請', state: '申請中' } },
      { key: 'ok', role: '上長', kind: 'decision', text: '承認する', memo: '10 万円以上は部長も見る', ref: { design: '出張申請', state: '承認待ち' } },
      { key: 'e', role: '申請者', kind: 'end', text: '出張する' },
    ],
    edges: [{ from: 's', to: 'in' }, { from: 'in', to: 'ok' }, { from: 'ok', to: 'in', label: '差し戻し' }, { from: 'ok', to: 'e', label: '承認' }],
  });
  return A;
}
// 経費精算システム（社員マスタを出張申請システムと共通で入れ、並びを入れ替える）と、ごみ箱へ移す旧出張申請システムを actions で作る
function buildExpenseSystems(page) {
  return page.evaluate(() => {
    const { actions: a, store } = window.__test__;
    const design = (n) => store.state.designs.find((d) => d.name === n);
    const B = a.createSystem({ name: '経費精算システム', description: '立て替えた経費を精算する。' });
    a.addDesignsToSystem(B, [design('経費精算').id, design('社員マスタ').id]);
    a.moveDesignInSystem(B, design('社員マスタ').id, 0);
    const [r1, r2] = [a.addRole(B, '申請者'), a.addRole(B, '経理')];
    a.setRoleMemo(B, r2, '経理課');
    const screenId = design('経費精算').screens.find((s) => s.name === '精算の入力').id;
    const w1 = a.addStep(B, { roleId: r1, col: 0, kind: 'input', text: '精算を入力する', ref: { designId: design('経費精算').id, screenId } });
    const w2 = a.addStep(B, { roleId: r2, col: 1, text: '振り込む', memo: '月末にまとめて振り込む。' });
    a.addEdge(B, w1, w2, '確かめた後');
    const C = a.createSystem({ name: '旧出張申請システム' });
    a.addDesignToSystem(C, design('出張申請').id);
    a.trashSystem(C);
    return { B, C };
  });
}

// 1 回目: 組み立ててから、別の接続（s-fix）の AI の道具で出張申請システムを直し（直す前の中身の写しを持つ行が入る）、ページの中身を控えて閉じる
async function sysFirstRun() {
  fs.rmSync(USER_DATA_SYS, { recursive: true, force: true });
  const app = await openSysApp();
  const A = await buildTripSystem(app.page);
  const { B, C } = await buildExpenseSystems(app.page);
  await aiCall(app.page, 's-fix', 'update_system', {
    system: A, description: '出張の事前申請と上長の承認、旅費の精算までをまとめる。', ops: [{ op: 'add', name: '経理' }],
  });
  const inPage = await app.page.evaluate(() => JSON.parse(JSON.stringify(window.__test__.store.state)));
  const code = await closeSysApp(app);
  return { ids: { A, B, C }, inPage, saved: savedSysState(), code };
}

// ページの中で: 最初の画面のごみ箱、共通の画面設計と、システムの画面（スイムレーン図・左の画面設計のカード・履歴）の見え方を読む
function readSystemView(A) {
  const T = window.__test__;
  const S = T.store.state;
  document.querySelector('[data-action="toggle-trash"]').click();
  const trashRows = [...document.querySelectorAll('.trash-row.sys .trash-name')].map((e) => e.textContent);
  const shared = S.designs.filter((d) => T.systemsOf(S, d.id).length > 1).map((d) => d.name);
  T.openSystem(A, { panel: 'swimlane' });
  const title = document.querySelector('#sys-title').textContent;
  const boxes = document.querySelectorAll('#sys-view .mnode.sw').length;
  const cards = [...document.querySelectorAll('#sys-list .sys-dcard b')].map((b) => b.textContent);
  const sharedCards = document.querySelectorAll('#sys-list .sys-dcard.shared').length;
  T.openSystemPanel('history');
  const history = [...document.querySelectorAll('#sys-view .sys-hist tbody tr')].map((tr) => tr.children[1].textContent.trim());
  return { trashRows, trashed: T.trashedSystems(S).map((y) => y.name), shared, title, boxes, cards, sharedCards, history };
}
// ページの中で: 出張申請システムの履歴の、いちばん新しい「AI が直す前の状態」の行から戻す
function restoreLastAiRow(A) {
  const T = window.__test__;
  const rows = T.findSystem(T.store.state, A).revisions.filter((r) => r.kind === 'ai');
  const row = rows[rows.length - 1];
  const ok = T.actions.restoreSystemRevision(A, row.id);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  return { ok, row: copy(row), now: copy(T.findSystem(T.store.state, A)) };
}
// 2 回目（起動し直す）: 読み込んだ中身と見え方を読み、履歴の行から戻して閉じる
async function sysSecondRun(A) {
  const app = await openSysApp();
  const loaded = await app.page.evaluate(() => JSON.parse(JSON.stringify(window.__test__.store.state.systems)));
  const view = await app.page.evaluate(readSystemView, A);
  const restored = await app.page.evaluate(restoreLastAiRow, A);
  await sleep(300);
  const code = await closeSysApp(app);
  return { loaded, view, restored, saved: savedSysState(), code };
}

// 1 回目に閉じた後の designs.json が、閉じる前のページの中身と同じで、組み立てたとおりか
function checkBuiltSystems(r) {
  const S = r.saved;
  const [A, B, C] = [r.ids.A, r.ids.B, r.ids.C].map((id) => S.systems.find((y) => y.id === id));
  const dName = (id) => (S.designs.find((d) => d.id === id) || {}).name;
  const trip = S.designs.find((d) => d.name === '出張申請');
  const stateId = (n) => trip.items.find((it) => it.type === 'status').props.states.find((s) => s.name === n).id;
  const [win, wok] = [STEP_IN, '承認する'].map((t) => A.swimlane.steps.find((w) => w.text === t));
  const aiRows = A.revisions.filter((x) => x.kind === 'ai');
  const last = aiRows[aiRows.length - 1] || {};
  const roles = (y) => y.roles.map((x) => x.name + (x.memo ? `（${x.memo}）` : '')).join('・');
  const swim = (y) => `作業 ${y.swimlane.steps.length} つ・矢印 ${y.swimlane.edges.length} 本（${y.swimlane.edges.map((e) => e.label).filter(Boolean).join('・')}）`;
  console.log('システムの designs.json は閉じる前のページの中身と同じか:', canonical(S.systems) === canonical(r.inPage.systems), '／ 終了コード', r.code);
  [A, B, C].forEach((y) => console.log(`  ${y.name}${y.trashedAt ? '（ごみ箱）' : ''}: 役割 ${roles(y)} ／ 画面設計 ${y.designIds.map(dName).join('・')} ／ ${swim(y)}`,
    `／ 履歴 ${y.revisions.map((x) => `${x.kind}（写し: 役割 ${x.snapshot ? x.snapshot.roles.length : 'なし'}・作業 ${x.snapshot ? x.snapshot.swimlane.steps.length : 'なし'}）`).join('、') || 'なし'}`));
  console.log(`  作業「${STEP_IN}」の指す先: ${JSON.stringify(win.ref)} ／ 作業「承認する」の指す先: ${JSON.stringify(wok.ref)}`);
  return canonical(S.systems) === canonical(r.inPage.systems) && r.code === 0 && S.systems.length === 3
    && roles(A) === '申請者（出張する社員）・上長・経理' && A.designIds.map(dName).join() === '出張申請,社員マスタ' && swim(A) === '作業 4 つ・矢印 4 本（差し戻し・承認）'
    && win.ref.designId === trip.id && win.ref.screenId === trip.screens.find((s) => s.name === '新規申請').id && win.ref.stateId === stateId('申請中')
    && wok.ref.designId === trip.id && wok.ref.screenId === null && wok.ref.stateId === stateId('承認待ち') && wok.memo === '10 万円以上は部長も見る'
    && aiRows.length === 2 && aiRows.every((x) => x.snapshot && x.note === AI_ROW_NOTE)
    && last.snapshot.roles.map((x) => x.name).join() === '申請者,上長' && last.snapshot.swimlane.steps.length === 4 && last.snapshot.designIds.length === 2
    && roles(B) === '申請者・経理（経理課）' && B.designIds.map(dName).join() === '社員マスタ,経費精算' && swim(B) === '作業 2 つ・矢印 1 本（確かめた後）'
    && dName(B.swimlane.steps[0].ref.designId) === '経費精算' && !!B.swimlane.steps[0].ref.screenId && B.revisions.length === 0
    && !!C.trashedAt && C.designIds.map(dName).join() === '出張申請';
}
// 起動し直したページの中身が designs.json と同じで、システムの画面に出て、履歴の行から戻した中身が保存されたか
function checkReloadedSystems(first, r) {
  const A = first.saved.systems.find((y) => y.id === first.ids.A);
  const aiRows = A.revisions.filter((x) => x.kind === 'ai');
  const want = aiRows[aiRows.length - 1];
  const after = r.saved.systems.find((y) => y.id === first.ids.A);
  const lastRow = after.revisions[after.revisions.length - 1];
  const v = r.view;
  console.log('起動し直したページのシステムは designs.json と同じか:', canonical(r.loaded) === canonical(first.saved.systems),
    `／ ごみ箱 ${v.trashRows.join('・')}（${v.trashed.join('・')}） ／ 共通の画面設計 ${v.shared.join('・')}`);
  console.log(`起動し直したシステムの画面: 題名「${v.title}」 ／ 作業の箱 ${v.boxes} つ ／ 画面設計のカード ${v.cards.join('・')}（共通の印 ${v.sharedCards} つ） ／ 履歴 ${v.history.join('、')}`);
  console.log(`履歴の行（${want.date}）から戻す: ${r.restored.ok} ／ 戻した中身は行の写しと同じか ${sysContent(r.restored.now) === sysContent(want.snapshot)}`,
    `／ 閉じた後の designs.json: 役割 ${after.roles.map((x) => x.name).join('・')}・履歴 ${after.revisions.map((x) => x.kind).join('・')}・終了コード ${r.code}`);
  return canonical(r.loaded) === canonical(first.saved.systems)
    && v.trashRows.join() === '旧出張申請システム' && v.trashed.join() === '旧出張申請システム' && v.shared.join() === '社員マスタ'
    && v.title.startsWith('出張申請システム') && v.boxes === 4 && v.cards.join() === '出張申請,社員マスタ' && v.sharedCards === 1
    && v.history.length === 2 && v.history.every((t) => t === AI_ROW_NOTE)
    && r.restored.ok && r.restored.row.id === want.id && sysContent(r.restored.now) === sysContent(want.snapshot)
    && sysContent(after) === sysContent(want.snapshot) && after.revisions.length === 3 && lastRow.kind === 'restore'
    && sysContent(lastRow.snapshot) === sysContent(A) && r.code === 0;
}

// 9 で打つ文字。of: 'system' は出張申請システム、'step' はその作業「出張申請を入力する」。key は designs.json の項目
const SYS_TYPING_CASES = [
  { how: 'x', label: '窓の ×・概要の名前', panel: 'overview', sel: '#sys-view [data-sy="name"]', of: 'system', key: 'name', text: '・本社' },
  { how: 'x', label: '窓の ×・作業の文字', panel: 'swimlane', sel: '#sys-side [data-sw="text"]', of: 'step', key: 'text', text: '（国内）' },
  { how: 'x', label: '窓の ×・作業のメモ', panel: 'swimlane', sel: '#sys-side [data-sw="memo"]', of: 'step', key: 'memo', text: '行き先と日程も書く。' },
  { how: 'quit', label: 'ファイル > 終了・概要の名前', panel: 'overview', sel: '#sys-view [data-sy="name"]', of: 'system', key: 'name', text: '・支店' },
  { how: 'quit', label: 'ファイル > 終了・作業の文字', panel: 'swimlane', sel: '#sys-side [data-sw="text"]', of: 'step', key: 'text', text: '（海外）' },
  { how: 'quit', label: 'ファイル > 終了・作業のメモ', panel: 'swimlane', sel: '#sys-side [data-sw="memo"]', of: 'step', key: 'memo', text: '宿の予約も書く。' },
];
function savedSysValue(c, ids) {
  const y = savedSysState().systems.find((x) => x.id === ids.A);
  return (c.of === 'step' ? y.swimlane.steps.find((w) => w.id === ids.stepIn) : y)[c.key];
}
// システムの画面を開き（スイムレーン図なら作業を選んで右の欄に設定を出し）、欄の終わりに文字を打って、欄を離れないまま閉じる
async function sysTypeThenClose(c, ids) {
  const app = await openSysApp([`--inspect=${MAIN_PORT}`]);
  const { page } = app;
  await page.evaluate((A, panel, step) => {
    window.__test__.openSystem(A, { panel });
    if (step) window.__test__.selectStep(step);
  }, ids.A, c.panel, c.of === 'step' ? ids.stepIn : null);
  await page.waitForSelector(c.sel);
  await page.focus(c.sel);
  await page.$eval(c.sel, (el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(c.text);
  await sleep(500);
  const before = savedSysValue(c, ids);
  const focused = await page.$eval(c.sel, (el) => document.activeElement === el);
  const code = await closeSysApp(app, c.how);
  return { before, after: savedSysValue(c, ids), focused, code };
}
async function checkSysTypingCases(ids) {
  let ok = true;
  for (const c of SYS_TYPING_CASES) {
    const r = await sysTypeThenClose(c, ids);
    const saved = r.focused && !r.before.includes(c.text) && r.after.includes(c.text);
    console.log(`システムの画面で打ちかけのまま閉じる（${c.label}）: 打った「${c.text}」 ／ 閉じる直前も欄にいたか: ${r.focused}`,
      `／ 閉じる前の designs.json「${r.before}」→ 閉じたあと「${r.after}」 ／ 終了コード ${r.code} → ${saved ? '保存された' : '保存されなかった'}`);
    ok = ok && saved && r.code === 0;
  }
  return ok;
}
// 3 回目（起動し直す）: 打った文字が、概要の名前の欄と、右の欄の作業の文字・メモの欄に出るか
async function sysThirdRun(ids) {
  const app = await openSysApp();
  const shown = await app.page.evaluate((A, step) => {
    const T = window.__test__;
    T.openSystem(A, { panel: 'overview' });
    const name = document.querySelector('#sys-view [data-sy="name"]').value;
    T.openSystemPanel('swimlane');
    T.selectStep(step);
    return { name, text: document.querySelector('#sys-side [data-sw="text"]').value, memo: document.querySelector('#sys-side [data-sw="memo"]').value };
  }, ids.A, ids.stepIn);
  await closeSysApp(app);
  return shown;
}

async function checkSystems() {
  const first = await sysFirstRun();
  const builtOk = checkBuiltSystems(first);
  const again = await sysSecondRun(first.ids.A);
  const againOk = checkReloadedSystems(first, again);
  const A = again.saved.systems.find((y) => y.id === first.ids.A);
  const ids = { ...first.ids, stepIn: A.swimlane.steps.find((w) => w.text === STEP_IN).id };
  const typedOk = await checkSysTypingCases(ids);
  const shown = await sysThirdRun(ids);
  const want = { name: A.name, text: STEP_IN, memo: A.swimlane.steps.find((w) => w.id === ids.stepIn).memo };
  SYS_TYPING_CASES.forEach((c) => { want[c.key] += c.text; });
  console.log(`起動し直したシステムの画面: 概要の名前「${shown.name}」 ／ 作業の文字「${shown.text}」 ／ 作業のメモ「${shown.memo}」`);
  const shownOk = canonical(shown) === canonical(want);
  return builtOk && againOk && typedOk && shownOk;
}

(async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const r = await firstRun();
  console.log('編集の画面の題名:', r.title);
  console.log('2 つ目の起動: 終了コード', r.secondCode, '／ そのとき 1 つ目は動いていたか:', r.firstAlive);
  console.log('1 つ目を閉じたときの終了コード:', r.code);
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  console.log('designs.json の画面設計:', saved.designs.map((d) => `${d.name}（${d.target}・画面 ${d.screens.length} つ・部品 ${d.screens[0].parts.length} つ）`).join('、'));
  console.log('designs.json の画面の並び:', saved.designs[0].screens.map((s) => `${s.name}（部品 ${s.parts.length} つ）`).join('、'));
  const d0 = saved.designs[0];
  console.log('designs.json の項目・吹き出し・つながりの図の箱の位置:', d0.items.map((it) => it.name).join('、'), '／ 吹き出し', d0.screens[0].callouts.length, 'つ ／', JSON.stringify(d0.mapPos));
  const rev = d0.revisions[0] || {};
  console.log('designs.json の改訂履歴:', d0.revisions.map((x) => `${x.kind}・第 ${x.no} 版・${x.note}・写しの画面 ${x.snapshot ? x.snapshot.screens.length : 'なし'} つ`).join('、'));
  const firstOk = r.firstAlive && saved.designs.length === 1 && d0.name === '顧客管理' && d0.screens[0].parts.length === 1
    && d0.items.length === 1 && d0.screens[0].parts[0].itemId === d0.items[0].id && d0.screens[0].callouts.length === 1 && Object.keys(d0.mapPos).length === 1
    && d0.screens.map((s) => s.name).join() === '画面 1,入力,一覧' && d0.screens[1].parts.some((p) => p.itemId === d0.items[0].id)
    && d0.revisions.length === 1 && rev.kind === 'revision' && rev.no === 1 && rev.note === '最初の版。' && !!rev.snapshot && rev.snapshot.screens.length === 3;
  const typedOk = await checkTypingCases();
  const again = await secondRun();
  console.log('起動し直したときの一覧:', again.names.join('、'));
  console.log(`起動し直したときの右の欄: 名前「${again.name}」／ 説明「${again.desc}」 ／ 画面の部品: ${again.parts} つ ／ 吹き出し: ${again.callouts} つ`,
    `／ データベースの項目: ${again.items} ／ つながりの図の箱の位置: ${again.mapBox} ／ 画面の一覧: ${again.screens.join('・')}`);
  console.log(`起動し直したときの改訂履歴: ${again.revs.join('、')} ／ 見たときの帯「${again.band}」 ／ 第 1 版の説明「${again.viewDesc}」`);
  const want = { name: '顧客管理', description: '' };
  TYPING_CASES.forEach((c) => { want[c.key] += c.text; });
  const [mx, my] = [d0.mapPos[Object.keys(d0.mapPos)[0]].x, d0.mapPos[Object.keys(d0.mapPos)[0]].y];
  const againOk = again.names.join() === want.name && again.name === want.name && again.desc === want.description && again.parts === 1
    && again.callouts === 1 && again.items === '1 個' && again.mapBox === `${mx}px, ${my}px` && again.screens.join() === '画面 1,入力,一覧'
    && again.revs.join() === '第 1 版・最初の版。' && /第 1 版（.+）を見ています/.test(again.band) && again.viewDesc === '';
  const m = await migrateRun();
  const md = m.saved.designs[0];
  console.log('v1 の形の designs.json: 一覧', m.names.join('、'), '／ 画面の部品の項目名', m.labels.join('・'), '／ 項目の一覧表', m.rows.join('・'));
  console.log('項目を 1 つ足して保存した後: 形の版', m.saved.schemaVersion, '／ 項目', md.items.map((it) => `${it.name}（${it.type}${it.required ? '・必須' : ''}）`).join('、'),
    '／ 部品が指す項目', md.screens[0].parts.map((p) => (p.itemId ? md.items.find((it) => it.id === p.itemId).name : `なし（${p.label}）`)).join('・'), '／ .bak の形の版', m.bakVersion);
  const migrateOk = m.labels.join() === '顧客名,区分' && m.rows.join() === '顧客名,区分' && m.saved.schemaVersion === 3 && md.items.length === 3
    && md.screens[0].parts[0].itemId === md.items[0].id && md.screens[0].parts[1].itemId === md.items[1].id && !md.screens[0].parts[2].itemId
    && md.items[0].required === true && md.items[1].props.options.join() === '法人,個人' && m.bakVersion === 1;
  const v = await migrateV2();
  const od = v.saved.designs.find((d) => d.id === 'd-order');
  const st = od.items.find((it) => it.id === 'i-st');
  const part = (id) => od.screens.flatMap((s) => s.parts).find((p) => p.id === id);
  const idOf = (n) => (st.props.states.find((s) => s.name === n) || {}).id;
  console.log('v2 の形の designs.json: ステータスの印', v.first.badge, '／ 左の一覧', v.first.notes.join('・'), '／ ステータス', v.first.states.join('・'), '／ 操作を足した後のカード', v.first.cards);
  console.log('保存した後: 形の版', v.saved.schemaVersion, '／ ステータス', JSON.stringify(st.props.states), '／ 操作', st.props.actions.length,
    '／ 見本で出すステータス', JSON.stringify(part('p-st1').view.current), '／ リンクの文字', JSON.stringify(part('p-l1').props), '／ ボタン', JSON.stringify(part('p-b1').props),
    '／ .bak の形の版', v.bakVersion);
  console.log('起動し直したとき: ステータスの印', v.again.badge, '／ ステータス', v.again.states.join('・'), '／ 操作のカード', v.again.cards,
    '／ 閉じた後の designs.json は同じか', JSON.stringify(v.after.designs) === JSON.stringify(v.saved.designs));
  const v2Ok = v.first.badge === '確認待ち' && v.first.states.join() === '受付,確認待ち,確認済み,完了' && v.first.cards === 1
    && v.first.notes.includes('操作なし') && v.first.notes.includes('移る先 1 本')
    && v.saved.schemaVersion === 3 && st.props.states.every((s) => /^t-/.test(s.id)) && st.props.actions.length === 1
    && part('p-st1').view.current === idOf('確認待ち') && part('p-l1').props.designId === '' && part('p-l1').props.screenId === 's-detail'
    && part('p-b1').props.to === '' && part('p-b1').props.action === '新規登録の画面を開く' && Array.isArray(v.saved.systems)
    && v.bakVersion === 2 && v.again.badge === '確認待ち' && v.again.states.join() === v.first.states.join() && v.again.cards === 1
    && JSON.stringify(v.after.designs) === JSON.stringify(v.saved.designs);
  const sysOk = await checkSystems();
  const ok = firstOk && typedOk && againOk && migrateOk && v2Ok && sysOk;
  console.log(ok ? 'OK' : 'NG');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
