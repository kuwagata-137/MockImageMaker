// tools/check-electron-through.js（通しの確かめ）の出力と取り込みの段。窓を出さない起動では、保存の窓の代わりに MIM_EXPORT_DIR に書き、
// 「HTML を取り込む」の開く窓の代わりに MIM_IMPORT_FILE を読む（export.js）。
//  システム: メニューバーの「出力」→「説明書を出力…」（PDF）・「MPD に出力…」（元にする MPD を選ぶ窓）
//  画面設計: システムの左のカードから出張申請を開き、メニューバーの「出力」の窓で PDF（A4 横）・PNG（画面ごと）・HTML
//  取り込み: 出力した HTML の説明を直したものを、最初の画面の「HTML を取り込む」で取り込み、置き換える
'use strict';

const fs = require('fs');
const path = require('path');
const { dialogOk, stateOf, report } = require('./check-electron-through-ui');
const { pdfPageTexts } = require('./check-export-doc');
const { planFromHtml } = require('../bdm-swimlane');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFile(file, label, timeout = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      await sleep(300); // 書き終わるのを少し待つ
      return file;
    }
    await sleep(200);
  }
  throw new Error(`時間切れ: ${label}（${path.basename(file)} ができない）`);
}

// PDF の全部のページの文字に、words がすべてあるか。戻り値 { pages, missing }
async function pdfHas(file, words) {
  const texts = await pdfPageTexts(file);
  const all = texts.join('');
  return { pages: texts.length, missing: words.filter((w) => !all.includes(w.replace(/\s+/g, ''))) };
}

// システムの画面のメニューバーの「出力」の小さなメニューから選ぶ
async function systemExportMenu(page, action) {
  await page.click('#toolbar [data-action="export"]');
  await page.click(`#sys-menu-root [data-action="${action}"]`);
}

async function exportSystem(page, out, { systemName, newStep, decision }) {
  await systemExportMenu(page, 'sys-export-doc');
  await page.waitForSelector('.modal [data-dpage]');
  await dialogOk(page);
  const doc = await waitFile(path.join(out, `${systemName}_説明書.pdf`), '説明書の PDF');
  const d = await pdfHas(doc, [systemName, '出張申請', '社員マスタ', '新規申請', newStep, decision]);
  report(!d.missing.length, 'システムの「出力」→「説明書を出力…」で説明書の PDF ができ、画面設計・作業・設計ノートの文字が入る',
    d.missing.length ? `見つからない: ${d.missing.join('・')}` : `${d.pages} ページ`);
  await systemExportMenu(page, 'sys-export-mpd');
  await page.waitForSelector('.modal input[name="mpd-pick"]');
  await dialogOk(page);
  await page.waitForFunction(() => /MPD に出力しました/.test(document.querySelector('#toast').textContent), { timeout: 60000 });
  const mpd = await waitFile(path.join(out, `${systemName}_スイムレーン.html`), 'MPD');
  const plan = planFromHtml(fs.readFileSync(mpd, 'utf8'));
  const y = (await stateOf(page)).systems.find((s) => s.name === systemName);
  report(plan.roles.join() === y.roles.map((r) => r.name).join() && plan.steps.length === y.swimlane.steps.length && plan.edges.length === y.swimlane.edges.length
    && plan.steps.some((s) => s.text === newStep),
  '「MPD に出力…」の窓で MPD を選んで出力すると、読み直した図がスイムレーン図と同じ（足した役割と作業も入る）',
  `役割 ${plan.roles.join('・')}・作業 ${plan.steps.length}・矢印 ${plan.edges.length}`);
}

// 出力の窓を開き、pick(page) で選んでから「出力…」を押す
async function exportVia(page, pick) {
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('.modal .xp-kinds');
  await pick(page);
  await dialogOk(page);
}

async function exportDesign(page, out, design) {
  await page.click(`.sys-dcard[data-id="${design.id}"]`);
  await page.waitForSelector('#side-panel [data-field="design-desc"]', { visible: true });
  await exportVia(page, async (p) => {
    await p.click('[data-xkind="pdf"]');
    await p.click('[name="xp-paper"][value="A4"]');
    await p.click('[name="xp-orient"][value="landscape"]');
  });
  const pdf = await waitFile(path.join(out, `${design.name}.pdf`), '画面設計の PDF');
  const screens = design.screens.map((s) => s.name);
  const p = await pdfHas(pdf, ['画面設計書', design.name, 'データベースの項目の一覧表', 'ステータスの移り方', '画面の移り方', ...screens]);
  report(!p.missing.length, '画面設計の「出力」の窓で PDF（A4 横）ができ、表紙・項目の一覧表・ステータスの移り方・画面の移り方・画面が入る',
    p.missing.length ? `見つからない: ${p.missing.join('・')}` : `${p.pages} ページ`);
  await exportVia(page, (q) => q.click('[data-xkind="png"]'));
  const pngs = screens.map((s, i) => path.join(out, `${design.name}_${String(i + 1).padStart(2, '0')}_${s}.png`));
  for (const f of pngs) await waitFile(f, path.basename(f));
  report(pngs.every((f) => fs.statSync(f).size > 20000), 'PNG が画面ごとに 1 枚できる', pngs.map((f) => path.basename(f)).join('・'));
  await exportVia(page, (q) => q.click('[data-xkind="html"]'));
  const html = await waitFile(path.join(out, `${design.name}.html`), 'HTML');
  const text = fs.readFileSync(html, 'utf8');
  report(/<script type="application\/json" id="mim-embedded">/.test(text) && text.includes(design.name), 'HTML に画面設計が入る');
  return html;
}

// 出力した HTML の説明を直して、最初の画面の「HTML を取り込む」で取り込み、置き換える
async function importEdited(page, html, importFile, design) {
  const edited = 'ベンダーが直した説明（通しの確かめ）。';
  fs.writeFileSync(importFile, fs.readFileSync(html, 'utf8').split(design.description).join(edited));
  await page.click('#tb-home'); // 編集の画面の「←システムへ」→ システムの画面の「←一覧へ」
  await page.waitForSelector('#sys-view', { visible: true });
  await page.click('#toolbar [data-action="home"]');
  await page.waitForSelector('[data-action="import-html"]', { visible: true });
  await page.click('[data-action="import-html"]');
  await page.waitForSelector('.modal .imp-cmp', { timeout: 15000 });
  await dialogOk(page);
  await page.waitForFunction(() => /置き換えました/.test(document.querySelector('#toast').textContent), { timeout: 15000 });
  const d = (await stateOf(page)).designs.find((x) => x.id === design.id);
  const imp = d.revisions.find((r) => r.kind === 'import');
  report(d.description === edited && imp && imp.snapshot.description === design.description,
    '説明を直した HTML を「HTML を取り込む」で取り込むと置き換わり、前の中身が改訂履歴に残る', d.revisions.map((r) => r.note || `第 ${r.no} 版`).join('・'));
}

module.exports = { exportSystem, exportDesign, importEdited };
