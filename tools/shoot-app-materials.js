// tools/shoot-app.js の資料の場面（--only=materials。場面 138〜149）。第 9 段階の後半の「資料」の入口（画像 q67 の案A「表」）のとおりかを撮る。
// 窓口 window.materialsAPI（デスクトップ版の preload.js が出す）は、ここで身代わりを置く。見本は架空の出張申請（make-material-samples.js が作る資料）。
//  - 「読む」の窓: 場面 142・143 は身代わりの 2 つの部分（続きを読む）、場面 144・145 は本物の読む部品（material-reader.js）で読んだ旅費規程.pdf（node 側の関数を ページから呼ぶ）
//  - 「スイムレーン図にする」: 本物の BDM を読む部品（bdm-swimlane.js）が出張申請の流れ.html から作った案
//  - ファイルを落とす: 実際のファイルは落とせないので、DataTransfer に File を入れた dragover・drop をページへ送る（Chrome の headless）
// どの場面も headless で撮る（窓を出さない）。画像は screenshots/ に置く。
'use strict';

const { ensureSamples } = require('./material-sample-place');
const { ID, openPage, realReading } = require('./shoot-app-materials-page');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 落とす操作（実際のファイルは落とせないので、File を入れた DataTransfer の dragover・drop をページへ送る）
const dragFiles = (page, type, names) => page.evaluate((t, ns) => {
  const dt = new DataTransfer();
  ns.forEach((n) => dt.items.add(new File(['x'], n)));
  const el = document.querySelector('#sys-view .mat-drop');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.top + 10 }));
}, type, names);
const waitToast = (page) => page.waitForFunction(() => !document.querySelector('#toast').hidden, { timeout: 4000 });
const need = (ok, message) => { if (!ok) throw new Error(message); };

// 138〜141: 資料の表・落とす枠（青く・落とした後）・資料がないとき
async function shootTable(ctx) {
  const { shot } = ctx;
  const page = await openPage(ctx);
  const rows = await page.$$eval('#sys-view .mat-tbl tbody tr', (trs) => trs.map((tr) => ({ old: tr.classList.contains('old'), swim: !!tr.querySelector('[data-action="sys-mat-swim"]') })));
  need(rows.length === 8 && rows.filter((r) => r.old).length === 1 && rows.filter((r) => r.swim).length === 1, `資料の表の行が見本と違う: ${JSON.stringify(rows)}`);
  await shot(page, '138_資料_表（資料 8 つ・古い形の札・MPD だけ「スイムレーン図にする」「MPD に出力…」）');
  await dragFiles(page, 'dragover', ['申請書の記入例（2）.png']);
  need(await page.$eval('#sys-view .mat-drop', (e) => e.classList.contains('drop-on')), 'ファイルを乗せても落とす枠が青くならない');
  await shot(page, '139_資料_ファイルを落とす枠の上に乗せたとき（枠が青い）');
  await dragFiles(page, 'drop', ['申請書の記入例（2）.png']);
  await waitToast(page);
  need(await page.$$eval('#sys-view .mat-tbl tbody tr', (t) => t.length) === 9, 'ファイルを落としても資料の行が増えない');
  need(!(await page.$('#sys-view .mat-drop.drop-on')), '落とした後も落とす枠が青いまま');
  await shot(page, '140_資料_ファイルを落とした後（行が 1 つ増えてお知らせが出る）');
  await page.close();
  const empty = await openPage(ctx, { withRows: false });
  need(!!(await empty.$('#sys-view .sys-empty')), '資料がないときの案内が出ない');
  await shot(empty, '141_資料_まだ資料がないとき');
  await empty.close();
}

// 142〜145: 「読む」の窓（身代わりの 2 つの部分・本物の読む部品で読んだ PDF）
async function shootReader(ctx) {
  const { shot } = ctx;
  const page = await openPage(ctx);
  const open = async () => { await page.click(`#sys-view [data-action="sys-mat-read"][data-id="${ID.pdf}"]`); await page.waitForSelector('.modal .rd-text .rd-pg'); await sleep(150); };
  await open();
  need(!!(await page.$('.modal [data-rd="more"]:not([hidden])')), '続きがあるのに「続きを読む」が出ない');
  await shot(page, '142_資料_「読む」の窓（続きがある。身代わりの文）');
  await page.click('.modal [data-rd="more"]');
  await page.waitForFunction(() => /4 ページ/.test(document.querySelector('.modal .rd-text').textContent), { timeout: 4000 });
  need(await page.$eval('.modal [data-rd="more"]', (b) => b.hidden), '最後まで読んだのに「続きを読む」が残る');
  await shot(page, '143_資料_「読む」の窓（続きを読んだ後。ボタンは「閉じる」だけ）');
  await page.click('.modal [data-dlg="cancel"]');
  await page.evaluate(() => { window.__readReal = true; });
  await open();
  const real3 = await page.$$eval('.modal .rd-text img.rd-img', (i) => i.map((x) => ({ w: x.naturalWidth, h: x.naturalHeight })));
  need(real3.length === 1 && /第 1 条/.test(await page.$eval('.modal .rd-text', (e) => e.textContent)), `本物の読む部品の返事が窓に出ていない（画像 ${real3.length} 枚）`);
  need(real3.every((x) => x.w > 0 && x.h > 0), '本物の PDF の画像が読み込めていない（naturalWidth が 0）');
  console.log('144・145: 本物の読む部品が返した PDF の画像:', real3.map((x) => `${x.w}x${x.h}`).join(','));
  await shot(page, '144_資料_「読む」の窓（本物の読む部品で読んだ旅費規程.pdf。1・2 ページ目の日本語の文字）');
  await page.$eval('.modal .rd-text', (box) => { const h = [...box.querySelectorAll('.rd-pg')].pop(); box.scrollTop = h.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8; }); // 3 ページ目の見出しを先頭に
  await sleep(150);
  await shot(page, '145_資料_「読む」の窓（同じ窓を下へ送った。文字のない 3 ページ目は画像）');
  await page.close();
}

// 146・147: 「スイムレーン図にする」の置き換えの確かめの窓と、置き換えた後のスイムレーン図（本物の BDM の読み取りの案）
async function shootReplace(ctx) {
  const { shot, real } = ctx;
  const page = await openPage(ctx);
  await page.click(`#sys-view [data-action="sys-mat-swim"][data-id="${ID.bdm}"]`);
  await page.waitForSelector('.modal [data-dlg="ok"]');
  await sleep(150);
  need(/作業の箱 7 つ・矢印 8 本/.test(await page.$eval('.modal', (e) => e.textContent)), '置き換えの確かめの窓に今の作業と矢印の数が出ない');
  await shot(page, '146_資料_「スイムレーン図にする」の置き換えの確かめの窓');
  await page.click('.modal [data-dlg="ok"]');
  await page.waitForSelector('#sys-swim .mnode.sw');
  await waitToast(page);
  await sleep(250);
  const done = await page.evaluate(() => {
    const T = window.__test__;
    const y = T.store.state.systems.find((x) => x.id === T.ui.systemId);
    return { panel: T.ui.sysPanel, steps: y.swimlane.steps.length, edges: y.swimlane.edges.length, roles: y.roles.map((r) => r.name).join('・'), toast: document.querySelector('#toast').textContent };
  });
  console.log('147:', JSON.stringify(done));
  need(done.panel === 'swimlane' && done.steps === real.plan.steps.length && done.edges === real.plan.edges.length, `置き換えた図が案と違う: ${JSON.stringify(done)}`);
  await shot(page, '147_資料_置き換えた後のスイムレーン図（出張申請の流れ.html から作った。お知らせつき）');
  await page.close();
}

// 148・149: ブラウザで開いたとき（窓口なし）は資料の入口が出ない・幅 1280 の窓。
// 入口は 概要・役割・スイムレーン図・設計ノート・履歴の 5 つ（第 10 段階の前半で、設計ノートの入口が足された。設計ノートは資料の窓口がなくても出る）
async function shootNarrow(ctx) {
  const { shot } = ctx;
  const web = await openPage(ctx, { api: false, panel: 'materials' });
  const inside = await web.evaluate(() => ({ entry: !!document.querySelector('#sys-list [data-panel="materials"]'), panel: window.__test__.ui.sysPanel,
    entries: [...document.querySelectorAll('#sys-list .db-entry[data-panel]')].map((e) => e.dataset.panel) }));
  need(!inside.entry && inside.panel === 'swimlane' && inside.entries.join() === 'overview,roles,swimlane,notes,history', `窓口がないのに資料の入口が出ている・入口の並びが違う: ${JSON.stringify(inside)}`);
  await shot(web, '148_資料_ブラウザで開いたとき（資料の窓口がないので、左の入口は 5 つで「資料」が出ない）');
  await web.close();
  const narrow = await openPage(ctx, { width: 1280, height: 800 });
  const m = await narrow.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    return { inside: Math.round(r(document.querySelector('#sys-view .itable')).right - r(document.querySelector('#sys-view .mat-tbl')).right),
      names: [...document.querySelectorAll('#sys-view .mat-name b')].filter((b) => r(b).height > 30).map((b) => b.textContent) };
  });
  need(m.inside >= 0 && !m.names.length, `幅 1280 で表が枠からはみ出す・名前が折り返す: ${JSON.stringify(m)}`);
  await shot(narrow, '149_資料_幅 1280 の窓（表が枠に収まる）');
  await narrow.close();
}

module.exports = async function shootMaterials(browser, env) {
  await ensureSamples();
  const ctx = { browser, real: realReading(), root: env.ROOT, htmlName: env.HTML_NAME, shot: async (p, name) => { await sleep(120); await env.shot(p, name); } };
  await shootTable(ctx);
  await shootReader(ctx);
  await shootReplace(ctx);
  await shootNarrow(ctx);
};
