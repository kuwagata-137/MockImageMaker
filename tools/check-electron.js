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
  await page.click('[data-action="open-map"]');
  const mapBox = await page.$eval('#design-map .mnode', (e) => `${e.style.left}, ${e.style.top}`);
  await page.evaluate(() => window.close());
  browser.disconnect();
  await withTimeout(child.exited, 15000, '起動し直したアプリが閉じない');
  return { names, name, desc, parts, callouts, items, mapBox, screens };
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
  const firstOk = r.firstAlive && saved.designs.length === 1 && d0.name === '顧客管理' && d0.screens[0].parts.length === 1
    && d0.items.length === 1 && d0.screens[0].parts[0].itemId === d0.items[0].id && d0.screens[0].callouts.length === 1 && Object.keys(d0.mapPos).length === 1
    && d0.screens.map((s) => s.name).join() === '画面 1,入力,一覧' && d0.screens[1].parts.some((p) => p.itemId === d0.items[0].id);
  const typedOk = await checkTypingCases();
  const again = await secondRun();
  console.log('起動し直したときの一覧:', again.names.join('、'));
  console.log(`起動し直したときの右の欄: 名前「${again.name}」／ 説明「${again.desc}」 ／ 画面の部品: ${again.parts} つ ／ 吹き出し: ${again.callouts} つ`,
    `／ データベースの項目: ${again.items} ／ つながりの図の箱の位置: ${again.mapBox} ／ 画面の一覧: ${again.screens.join('・')}`);
  const want = { name: '顧客管理', description: '' };
  TYPING_CASES.forEach((c) => { want[c.key] += c.text; });
  const [mx, my] = [d0.mapPos[Object.keys(d0.mapPos)[0]].x, d0.mapPos[Object.keys(d0.mapPos)[0]].y];
  const againOk = again.names.join() === want.name && again.name === want.name && again.desc === want.description && again.parts === 1
    && again.callouts === 1 && again.items === '1 個' && again.mapBox === `${mx}px, ${my}px` && again.screens.join() === '画面 1,入力,一覧';
  const m = await migrateRun();
  const md = m.saved.designs[0];
  console.log('v1 の形の designs.json: 一覧', m.names.join('、'), '／ 画面の部品の項目名', m.labels.join('・'), '／ 項目の一覧表', m.rows.join('・'));
  console.log('項目を 1 つ足して保存した後: 形の版', m.saved.schemaVersion, '／ 項目', md.items.map((it) => `${it.name}（${it.type}${it.required ? '・必須' : ''}）`).join('、'),
    '／ 部品が指す項目', md.screens[0].parts.map((p) => (p.itemId ? md.items.find((it) => it.id === p.itemId).name : `なし（${p.label}）`)).join('・'), '／ .bak の形の版', m.bakVersion);
  const migrateOk = m.labels.join() === '顧客名,区分' && m.rows.join() === '顧客名,区分' && m.saved.schemaVersion === 2 && md.items.length === 3
    && md.screens[0].parts[0].itemId === md.items[0].id && md.screens[0].parts[1].itemId === md.items[1].id && !md.screens[0].parts[2].itemId
    && md.items[0].required === true && md.items[1].props.options.join() === '法人,個人' && m.bakVersion === 1;
  const ok = firstOk && typedOk && againOk && migrateOk;
  console.log(ok ? 'OK' : 'NG');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
