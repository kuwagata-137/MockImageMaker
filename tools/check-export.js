// 使い方: node tools/check-export.js
//   クラウドのセッション（Linux・root）では ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node tools/check-export.js
// Electron のアプリを窓を出さずに（MIM_HEADLESS=1）起動し、書き出しと取り込み（第 5 段階）を確かめる。
//  1. 架空の見本（顧客管理・住所の共通項目・取引先マスタ・受注管理）の designs.json で起動し、顧客管理を開いて、
//     メニューバーの「書き出す」の窓から PDF・PNG・HTML を書き出す（MIM_EXPORT_DIR で、保存の窓を出さずに .devdata/check-export/out へ書く）
//  2. PDF: A4 横・A3 縦・スライド（16:9）の 3 つ。ページ数と用紙の大きさ（pdfinfo）、表紙と画面の名前が入っているか（pdftotext）、
//     表紙のほかのページの中身が用紙いっぱいに入っているか（いちばん下の文字〔下の端の行〕が、ページの下の 1 割の中にあるか。pdftotext -bbox）。
//     画面のページを transform で縮めていたときは、画面のページが 2 つ以上あると、印刷が全部のページを約 0.67 倍に縮めていた（2026-10-13）
//  3. PNG: 画面ごとに 1 枚。大きさが 2 倍か、白だけの小さなファイルでないか
//  4. HTML: 書き出した HTML を最初の画面の「HTML を取り込む」で取り込み直すと「同じ中身」と出て、何も変わらない（MIM_IMPORT_FILE で開く窓を出さない）。
//     説明を直した HTML を取り込むと確かめの窓が出て、置き換えると designs.json に直した説明と「取り込む前の状態」が残る
// pdfinfo・pdftotext（poppler-utils）がないとき（社内の Windows PC など）は、PDF はファイルの頭とページの数え方だけで確かめる。
// 保存先は作業フォルダの .devdata/check-export（毎回消してから始める。npm start のデータとは別）。
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const electronPath = require('electron');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, '.devdata', 'check-export');
const USER_DATA = path.join(BASE, 'userData');
const OUT = path.join(BASE, 'out');
const IMPORT_FILE = path.join(BASE, 'import.html');
const STATE_FILE = path.join(USER_DATA, 'data', 'designs.json');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 架空の見本 ──
const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId) => ({ id, type: 'text1', x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const design = (id, name, target, extra = {}) => ({
  id, name, target, description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: null, revisions: [], items: [], screens: [screen('s-' + id, '一覧')], mapPos: {}, ...extra,
});
const SAMPLE = {
  schemaVersion: 2,
  settings: { customTargets: [], mapPos: {} },
  designs: [
    design('d1', '顧客管理', 'kintone', {
      description: '取引先と顧客の連絡先を管理する。',
      items: [
        item('i1', '顧客コード', 'text1', { required: true }),
        item('i2', '取引先コード', 'text1', { lookup: { db: { designId: 'd3', name: '取引先マスタ', free: false }, key: { itemId: 'b1', name: '取引先コード' }, copies: [{ from: { itemId: 'b2', name: '取引先名' }, to: { itemId: 'i3', name: '取引先名' } }] } }),
        item('i3', '取引先名', 'text1'),
        item('i4', '郵便番号', 'text1', { link: { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false } }),
      ],
      screens: [
        screen('s1', '詳細', [ipart('p1', 32, 112, 1, 'i1'), ipart('p2', 32, 200, 2, 'i2'), ipart('p3', 32, 288, 3, 'i3'), ipart('p4', 400, 112, 4, 'i4')], {
          callouts: [{ id: 'k1', x: 1300, y: 100, w: 200, h: 80, text: '取引先コードで取引先名を引く。', color: 'yellow', tip: 'arrow', target: 'p2' }],
        }),
        screen('s2', '新規登録', [ipart('p5', 32, 112, 1, 'i1')]),
      ],
    }),
    design('d2', '住所の共通項目', 'その他の作る先', { items: [item('a1', '郵便番号', 'text1', { props: { maxLen: '8' } })] }),
    design('d3', '取引先マスタ', 'kintone', { items: [item('b1', '取引先コード', 'text1'), item('b2', '取引先名', 'text1')] }),
    design('d4', '受注管理', 'kintone', {
      items: [item('e1', '顧客コード', 'text1', { lookup: { db: { designId: 'd1', name: '顧客管理', free: false }, key: { itemId: 'i1', name: '顧客コード' }, copies: [] } })],
    }),
  ],
};

function launch() {
  const env = { ...process.env, MIM_HEADLESS: '1', MIM_USER_DATA: USER_DATA, MIM_EXPORT_DIR: OUT, MIM_IMPORT_FILE: IMPORT_FILE };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
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

async function waitFile(file, label, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      await sleep(300); // 書き終わるのを少し待つ
      return file;
    }
    await sleep(200);
  }
  throw new Error(`時間切れ: ${label}（${path.relative(ROOT, file)} ができない）`);
}

// 書き出しの窓を開き、pick(page) で選んでから「書き出す…」を押す
async function exportVia(page, pick) {
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('.modal .xp-kinds');
  await pick(page);
  await page.click('.modal [data-dlg="ok"]');
  await page.waitForFunction(() => !document.querySelector('.modal'));
}
const clickPaper = (paper, orient) => async (page) => {
  await page.click('[data-xkind="pdf"]');
  await page.click(`[name="xp-paper"][value="${paper}"]`);
  if (orient) await page.click(`[name="xp-orient"][value="${orient}"]`);
};

const hasTool = (cmd) => spawnSync(cmd, ['-v'], { encoding: 'utf8' }).error == null;
function pdfFacts(file) {
  if (hasTool('pdfinfo')) {
    const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' }).stdout;
    const pages = Number((info.match(/Pages:\s+(\d+)/) || [])[1]);
    const size = (info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/) || []).slice(1).map(Number);
    const text = hasTool('pdftotext') ? spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout : '';
    // ページごとの、いちばん下の文字の下の端（pt）
    const bottoms = [];
    if (hasTool('pdftotext')) {
      const bbox = spawnSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' }).stdout;
      bbox.split('<page ').slice(1).forEach((pg) => {
        bottoms.push(Math.max(0, ...[...pg.matchAll(/yMax="([\d.]+)"/g)].map((m) => Number(m[1]))));
      });
    }
    return { pages, size, text, bottoms, tool: true };
  }
  const buf = fs.readFileSync(file);
  return { pages: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, size: [], text: '', tool: false, head: buf.slice(0, 4).toString() };
}
const pngSize = (file) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }; };

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(SAMPLE));
  const child = launch();
  const browser = await connect();
  const page = await appPage(browser);
  const results = [];
  const check = (label, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'NG'} ${label}${detail ? ' … ' + detail : ''}`); };
  try {
    await page.click('.card-open[data-id="d1"]');
    await page.waitForSelector('#toolbar [data-action="export"]');
    // 1・2. PDF（A4 横・A3 縦・スライド）
    const pdfCases = [['A4', 'landscape', 'A4横', [841.92, 595.2]], ['A3', 'portrait', 'A3縦', [841.92, 1190.88]], ['slide', null, 'スライド', [960, 540]]];
    for (const [paper, orient, tag, want] of pdfCases) {
      const file = path.join(OUT, '顧客管理.pdf');
      fs.rmSync(file, { force: true });
      await exportVia(page, clickPaper(paper, orient));
      await waitFile(file, `PDF（${tag}）`);
      const dest = path.join(OUT, `顧客管理_${tag}.pdf`);
      fs.renameSync(file, dest);
      const f = pdfFacts(dest);
      if (f.tool) {
        const sizeOk = f.size.length === 2 && Math.abs(f.size[0] - want[0]) < 2 && Math.abs(f.size[1] - want[1]) < 2;
        check(`PDF（${tag}）のページ数と用紙`, f.pages === 5 && sizeOk, `${f.pages} ページ・${f.size.join(' × ')} pt（表紙・図・表・画面 2 つ）`);
        const words = ['画面設計書', '顧客管理', 'つながりの図', 'データベースの項目の一覧表', '詳細', '新規登録', '取引先コードで取引先名を引く'];
        const missing = words.filter((w) => !f.text.replace(/\s+/g, '').includes(w.replace(/\s+/g, '')));
        check(`PDF（${tag}）の文字`, !missing.length, missing.length ? `見つからない: ${missing.join('・')}` : words.join('・'));
        const low = f.bottoms.slice(1).map((b) => b / f.size[1]);
        check(`PDF（${tag}）の中身が用紙いっぱいに入っている`, low.length === f.pages - 1 && low.every((r) => r > 0.9),
          `表紙のほかのページの、いちばん下の文字の位置: ${low.map((r) => Math.round(r * 100) + '%').join('・')}`);
      } else {
        check(`PDF（${tag}）`, f.head === '%PDF' && f.pages === 5, `${f.pages} ページ（pdfinfo がないので数えただけ）`);
      }
    }
    // 3. PNG（画面ごとに 1 枚・2 倍）
    await exportVia(page, async (p) => { await p.click('[data-xkind="png"]'); });
    const pngs = ['顧客管理_01_詳細.png', '顧客管理_02_新規登録.png'].map((n) => path.join(OUT, n));
    for (const f of pngs) await waitFile(f, path.basename(f));
    const sizes = pngs.map(pngSize);
    check('PNG の大きさ（2 倍）と中身', sizes.every((s) => s.w >= 2 * 1280 && s.h >= 2 * 800 && s.bytes > 20000),
      sizes.map((s, i) => `${path.basename(pngs[i])} ${s.w}×${s.h}（${Math.round(s.bytes / 1024)}KB）`).join('、'));
    // 4. HTML（書き出して、取り込み直す）
    await exportVia(page, async (p) => { await p.click('[data-xkind="html"]'); });
    const htmlFile = await waitFile(path.join(OUT, '顧客管理.html'), 'HTML');
    const html = fs.readFileSync(htmlFile, 'utf8');
    check('HTML に画面設計が入っている', /<script type="application\/json" id="mim-embedded">/.test(html) && html.includes('顧客管理'));
    fs.copyFileSync(htmlFile, IMPORT_FILE);
    await page.click('#toolbar [data-action="home"]');
    await page.waitForSelector('[data-action="import-html"]');
    await page.click('[data-action="import-html"]');
    await page.waitForFunction(() => /同じ中身なので/.test(document.querySelector('#toast').textContent), { timeout: 15000 });
    check('書き出したままの HTML は「同じ中身」で取り込まない', true);
    fs.writeFileSync(IMPORT_FILE, html.replace('取引先と顧客の連絡先を管理する。', 'ベンダーが直した説明。'));
    await page.click('[data-action="import-html"]');
    await page.waitForSelector('.modal .imp-cmp', { timeout: 15000 });
    await page.click('.modal [data-dlg="ok"]');
    await page.waitForFunction(() => /置き換えました/.test(document.querySelector('#toast').textContent), { timeout: 15000 });
    await sleep(800); // designs.json への書き込みを待つ
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).designs.find((d) => d.id === 'd1');
    check('直した HTML を取り込むと置き換わり、前の中身が改訂の記録に残る', saved.description === 'ベンダーが直した説明。'
      && saved.revisions.length === 1 && saved.revisions[0].note === '取り込む前の状態' && saved.revisions[0].snapshot.description === '取引先と顧客の連絡先を管理する。',
    `説明「${saved.description}」・改訂の記録 ${saved.revisions.map((r) => r.note).join('・')}`);
  } finally {
    await page.evaluate(() => window.close()).catch(() => {});
    browser.disconnect();
    await Promise.race([child.exited, sleep(15000)]);
    if (child.exitCode === null) child.kill();
  }
  const ok = results.length > 0 && results.every(Boolean);
  console.log(ok ? 'OK' : 'NG');
  console.log('書き出したファイル:', path.relative(ROOT, OUT));
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
