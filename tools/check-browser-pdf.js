// 使い方: node tools/check-browser-pdf.js
// 出力した HTML（単体で開いた画面設計）から PDF を出力する処理（2026-11-16 の q186 案A・q187 案A）を、headless の Chrome で確かめる。窓は出さない。
//  1. アプリを開き、CRM の見本（buildCrmSample。架空の会社と人の名前だけ）の画面設計「顧客」を HTML に出力して、
//     .devdata/check-browser-pdf/顧客.html に書く
//  2. その HTML を file:// で開き、ツールバーの［PDF を出力する］→ 出力のウィンドウで用紙と向きを選ぶ →［PDF を出力…］を押す
//  3. headless の Chrome は印刷画面を開かないので、印刷の処理（printDocInBrowser）が置いた見えない iframe の print() を数えるだけにして、
//     iframe の文書を取り出す。その文書を Chrome の印刷（page.pdf の preferCSSPageSize。送信先「PDF に保存」と同じ印刷の処理）で PDF にする
//  4. アプリ（デスクトップ版の PDF と同じ exportDocument）で組んだ印刷用文書も同じく PDF にし、ページ数・用紙の大きさ・各ページの見出しをくらべる
// A4 横・A3 縦・スライド（16:9）の 3 つで確かめる。PDF は .devdata/check-browser-pdf/ に残す。
// 環境変数 MIM_CHROME_PATH にブラウザの場所を書くと、システムの Chrome の代わりにそれを使う（tools/shoot-app.js と同じ）。
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => f.endsWith('.html'));
const OUT = path.join(ROOT, '.devdata', 'check-browser-pdf');
const CASES = [
  { paper: 'A4', orient: 'landscape', label: 'A4 横' },
  { paper: 'A3', orient: 'portrait', label: 'A3 縦' },
  { paper: 'slide', orient: 'landscape', label: 'スライド（16:9）' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PDF のページ数と、1 ページ目の用紙の大きさ（pt）
function pdfInfo(buf) {
  const s = buf.toString('latin1');
  const count = Math.max(0, ...[...s.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1])), ...[...s.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)].map((m) => Number(m[1])));
  const box = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  return { pages: count, w: box ? Number(box[3]) - Number(box[1]) : 0, h: box ? Number(box[4]) - Number(box[2]) : 0, bytes: buf.length };
}

// 印刷用文書を新しいタブで PDF にする（Chrome の「PDF に保存」と同じ印刷の処理）。見出しの一覧も返す
async function printToPdf(browser, html, file) {
  const p = await browser.newPage();
  try {
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
    const heads = await p.evaluate(() => [...document.querySelectorAll('.pg')].map((pg) => {
      const h = pg.querySelector('.pg-title, h1, h2, .pg-head');
      return (h || pg).textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }));
    const buf = Buffer.from(await p.pdf({ preferCSSPageSize: true, printBackground: false }));
    fs.writeFileSync(file, buf);
    return { ...pdfInfo(buf), heads };
  } finally {
    await p.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.MIM_CHROME_PATH ? { executablePath: process.env.MIM_CHROME_PATH } : { channel: 'chrome' }),
    userDataDir: path.join(ROOT, '.devdata', 'chrome-profile-browser-pdf'),
    args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); console.log(`${ok ? 'OK ' : 'NG '} ${msg}`); };
  try {
    // 1. アプリで見本を作り、画面設計「顧客」を HTML に出力する
    const app = await browser.newPage();
    await app.setViewport({ width: 1400, height: 860 });
    await app.evaluateOnNewDocument(() => { window.__test__ = {}; localStorage.clear(); });
    await app.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
    await app.waitForFunction(() => window.__test__ && window.__test__.ready);
    const { saHtml, designId } = await app.evaluate(() => {
      const T = window.__test__;
      const sysId = T.buildCrmSample({ name: '顧客管理システム', target: 'salesforce', look: 'salesforce' });
      const y = T.store.state.systems.find((s) => s.id === sysId);
      const d = T.store.state.designs.find((x) => y.designIds.includes(x.id) && x.name === '顧客');
      return { saHtml: T.buildStandaloneHtml(d, T.store.state), designId: d.id };
    });
    const saFile = path.join(OUT, '顧客.html');
    fs.writeFileSync(saFile, saHtml);

    // 2. 出力した HTML を開く（印刷の処理が置く iframe の print() を数える身代わりにする）
    const sa = await browser.newPage();
    await sa.setViewport({ width: 1280, height: 800 });
    await sa.evaluateOnNewDocument(() => {
      window.__test__ = {};
      window.__prints = [];
      new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.tagName !== 'IFRAME' || n.id !== 'mim-print-frame') return;
        // アプリの load の処理（フォントを待ってから print() を呼ぶ）より前に、print() を身代わりにする
        n.addEventListener('load', () => {
          n.contentWindow.print = () => window.__prints.push({
            title: document.title, frameTitle: n.contentDocument.title, sandbox: n.getAttribute('sandbox'),
            visibility: getComputedStyle(n).visibility, html: '<!DOCTYPE html>\n' + n.contentDocument.documentElement.outerHTML, srcdoc: n.srcdoc,
          });
        }, { once: true });
      }))).observe(document, { childList: true, subtree: true }); // 読み込みの前は documentElement がまだないので、document を見張る
    });
    await sa.goto(pathToFileURL(saFile).href, { waitUntil: 'load' });
    await sa.waitForFunction(() => window.__test__ && window.__test__.ready);
    check(!!(await sa.$('#toolbar [data-action="save-html"] + #tb-pdf')), 'ツールバーの［HTML を保存する］の右に［PDF を出力する］がある');

    for (const [i, c] of CASES.entries()) {
      console.log(`\n── ${c.label} ──`);
      await sa.click('#tb-pdf');
      await sa.waitForSelector('.modal [data-xbox="pdf"]');
      const head = await sa.$eval('.modal h2', (h) => h.textContent);
      check(head === '「顧客」を PDF に出力する', `ウィンドウの題名「${head}」`);
      await sa.click(`.modal [name="xp-paper"][value="${c.paper}"] + span`);
      if (c.paper !== 'slide') await sa.click(`.modal [name="xp-orient"][value="${c.orient}"] + span`);
      await sa.click('.modal [data-dlg="ok"]');
      await sa.waitForFunction((n) => window.__prints.length === n, { timeout: 30000 }, i + 1);
      const shot = await sa.evaluate(() => window.__prints[window.__prints.length - 1]);
      check(shot.title === '顧客' && shot.frameTitle === '顧客', `印刷画面を開いた時の題名（既定のファイル名）: ページ「${shot.title}」・iframe「${shot.frameTitle}」`);
      check(shot.sandbox === 'allow-same-origin allow-modals' && shot.visibility === 'hidden', `iframe は見えない・script は動かさない（${shot.sandbox}・${shot.visibility}）`);
      // デスクトップ版の PDF と同じ印刷用文書か（単体で開いた HTML の中で、同じ設定で組み直してくらべる）
      const same = await sa.evaluate((cs, srcdoc) => {
        const T = window.__test__;
        const r = T.exportDocument(T.currentDesign(), T.store.state, { paper: cs.paper, orient: cs.orient, cover: true, map: true, items: true, process: true, flow: true, settings: true });
        return r.html === srcdoc;
      }, c, shot.srcdoc);
      check(same, 'iframe に読み込んだ文書は、exportDocument の印刷用文書と同じ');
      // 3. ブラウザの印刷（「PDF に保存」と同じ処理）で PDF にする
      const b = await printToPdf(browser, shot.html, path.join(OUT, `ブラウザ_${c.paper}_${c.orient}.pdf`));
      // 4. アプリ（デスクトップ版）で組んだ印刷用文書
      const deskHtml = await app.evaluate((did, cs) => {
        const T = window.__test__;
        const d = T.store.state.designs.find((x) => x.id === did);
        return T.exportDocument(d, T.store.state, { paper: cs.paper, orient: cs.orient, cover: true, map: true, items: true, process: true, flow: true, settings: true }).html;
      }, designId, c);
      fs.writeFileSync(path.join(OUT, `デスクトップ版_${c.paper}_${c.orient}.html`), deskHtml); // Electron の printToPDF でくらべるときに使う
      const a = await printToPdf(browser, deskHtml, path.join(OUT, `デスクトップ版_${c.paper}_${c.orient}.pdf`));
      const P = await app.evaluate((cs) => window.__test__.paperSize(cs.paper, cs.orient), c);
      const ew = P.wi * 72;
      const eh = P.hi * 72;
      console.log(`  ブラウザ: ${b.pages} ページ・${b.w.toFixed(1)} × ${b.h.toFixed(1)} pt・${(b.bytes / 1024).toFixed(0)} KB`);
      console.log(`  デスクトップ版の文書: ${a.pages} ページ・${a.w.toFixed(1)} × ${a.h.toFixed(1)} pt`);
      check(b.pages > 0 && b.pages === a.pages && b.pages === b.heads.length, `ページ数が同じ（ブラウザ ${b.pages}・デスクトップ版 ${a.pages}・文書の .pg ${b.heads.length}）`);
      check(Math.abs(b.w - ew) < 2 && Math.abs(b.h - eh) < 2, `用紙の大きさが ${c.label}（${ew.toFixed(1)} × ${eh.toFixed(1)} pt）`);
      check(JSON.stringify(a.heads) === JSON.stringify(b.heads), 'ページの見出しが同じ');
      b.heads.forEach((h, k) => console.log(`   ${k + 1}. ${h}`));
      // 次の確認のため、残った iframe を消す（本物のブラウザでは、印刷画面を閉じた後に消える）
      await sa.evaluate(() => { const f = document.getElementById('mim-print-frame'); if (f) f.remove(); });
      await sleep(100);
    }
    // ブラウザのメニューから印刷した時の案内文
    await sa.emulateMediaType('print');
    const note = await sa.evaluate(() => getComputedStyle(document.body, '::before').content);
    check(/ツールバーの「PDF を出力する」（Ctrl\+P）で出力してください/.test(note), 'ブラウザのメニューから印刷した時は、［PDF を出力する］への案内文だけを印刷する');
    await sa.close();
    await app.close();
  } finally {
    await browser.close();
  }
  console.log(problems.length ? `\nNG が ${problems.length} 件あります。` : '\nすべて OK です。');
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
