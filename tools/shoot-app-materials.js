// tools/shoot-app.js の資料の場面（--only=materials。場面 138〜149・164〜170）。第 9 段階の後半の「資料」の入口（画像 q67 の案A「表」）と、
// 第 11 段階の「MPD に出力」（画像 q82。メニューバーの「出力」の小さなメニュー・元にする MPD を選ぶ窓）と、
// デバッグとリリースの直し①（画像 q86。返事を待つ間の印と時間切れ）のとおりかを撮る。
// 窓口 window.materialsAPI（デスクトップ版の preload.js が出す）は、ここで身代わりを置く。見本は架空の出張申請（make-material-samples.js が作る資料）。
//  - 「読む」の窓: 場面 142・143 は身代わりの 2 つの部分（続きを読む）、場面 144・145 は本物の読む部品（material-reader.js）で読んだ旅費規程.pdf（node 側の関数を ページから呼ぶ）
//  - 「スイムレーン図にする」: 本物の BDM を読む部品（bdm-swimlane.js）が出張申請の流れ.html から作った案
//  - ファイルを落とす: 実際のファイルは落とせないので、DataTransfer に File を入れた dragover・drop をページへ送る（Chrome の headless）
//  - MPD に出力: 本物の出力の部品（bdm-export.js）が出張申請の流れ.html を元に作る（保存の窓は出さず、.devdata/shoot-mpd-export に書く）
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
  const rows = await page.$$eval('#sys-view .mat-tbl tbody tr', (trs) => trs.map((tr) => ({ old: tr.classList.contains('old'), swim: !!tr.querySelector('[data-action="sys-mat-swim"]'),
    mpd: !!tr.querySelector('[data-action="sys-mat-export"]') })));
  need(rows.length === 8 && rows.filter((r) => r.old).length === 1 && rows.filter((r) => r.swim).length === 1 && rows.filter((r) => r.mpd).length === 1, `資料の表の行が見本と違う: ${JSON.stringify(rows)}`);
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

// 164〜167: MPD に出力（第 11 段階。画像 q82）。メニューバーの「出力」の小さなメニュー・元にする MPD を選ぶ窓・出力した後のお知らせ・資料に MPD がないとき
async function shootMpdExport(ctx) {
  const { shot } = ctx;
  const page = await openPage(ctx, { panel: 'swimlane' });
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('#sys-menu-root .sys-pop');
  const items = await page.$$eval('#sys-menu-root [role="menuitem"]', (bs) => bs.map((b) => `${b.querySelector('b').textContent}${b.disabled ? '（×）' : ''}`));
  need(items.join() === '説明書（PDF）を出力…,MPD に出力…', `小さなメニューの項目が違う: ${items.join()}`);
  await shot(page, '164_MPD_メニューバーの「出力」の小さなメニュー');
  await page.click('#sys-menu-root [data-action="sys-export-mpd"]');
  await page.waitForSelector('.modal .mpd-pick');
  const d = await page.evaluate(() => ({ title: document.querySelector('.modal h2').textContent, rows: document.querySelectorAll('.mpd-pick label').length,
    buttons: [...document.querySelectorAll('.modal-actions button')].filter((b) => !b.hidden).map((b) => b.textContent) }));
  need(d.title === '「出張申請システム」のスイムレーン図を MPD に出力' && d.buttons.join() === '出力…,キャンセル' && d.rows === 1, `元にする MPD を選ぶ窓が違う: ${JSON.stringify(d)}`);
  await shot(page, '165_MPD_元にする MPD を選ぶ窓');
  await page.click('.modal [data-dlg="ok"]');
  await waitToast(page);
  const toast = await page.$eval('#toast', (e) => e.textContent);
  need(/^MPD に出力しました（.+出張申請システム_スイムレーン\.html）。$/.test(toast), `出力した後のお知らせが違う（読み直しの注意が出た？）: ${toast}`);
  await shot(page, '166_MPD_出力した後のお知らせ');
  await page.close();
  const none = await openPage(ctx, { withRows: false, panel: 'swimlane' });
  await none.click('#toolbar [data-action="export"]');
  await none.waitForSelector('#sys-menu-root .sys-pop');
  const why = await none.$eval('#sys-menu-root [data-action="sys-export-mpd"]', (b) => [b.disabled, b.querySelector('small').textContent]);
  need(why[0] && why[1] === '資料に MPD がありません（左の「資料」から入れます）', `資料に MPD がないときの項目が違う: ${why.join(' ／ ')}`);
  await shot(none, '167_MPD_資料に MPD がないとき（「MPD に出力…」は押せず、理由を小さな字で出す）');
  await none.close();
}

// 168〜170: 資料の窓口の返事を待つ間の印と時間切れ（デバッグとリリースの直し①。画像 q86）。窓口の身代わりの read・bdmExport を、返事を返さない形に
// 差し替えて撮る。時間切れは待つ長さを短くして撮る（お知らせの文は 60 秒のまま）。押したボタンの文字が言葉の途中で折り返さないか（ほかのボタンと同じ高さか）も確かめる
async function shootWaiting(ctx) {
  const { shot } = ctx;
  const never = (name) => (pg) => pg.evaluate((n) => { window.materialsAPI[n] = () => new Promise(() => {}); }, name);
  const opsOf = (pg, id) => pg.$eval(`#sys-view tr[data-id="${id}"] .mat-ops`, (ops) => [...ops.querySelectorAll('button')].map((b) => b.textContent + (b.disabled ? '（×）' : '')));
  const oneLine = (pg) => pg.evaluate(() => {
    const hs = [...document.querySelectorAll('#sys-view .mat-ops button')].map((b) => Math.round(b.getBoundingClientRect().height));
    return Math.max(...hs) - Math.min(...hs) <= 1;
  });
  const page = await openPage(ctx);
  await never('read')(page);
  await page.click(`#sys-view [data-action="sys-mat-read"][data-id="${ID.pdf}"]`);
  await page.waitForSelector(`#sys-view .mat-busy[data-id="${ID.pdf}"]`);
  const busy = await opsOf(page, ID.pdf);
  need(busy.join() === '読んでいます…（×）,消す（×）' && await oneLine(page), `待つ間の行のボタンが違う・折り返している: ${busy.join()}`);
  await shot(page, '168_資料_「読む」を押して返事を待つ間（押したボタンが「読んでいます…」・その行のボタンは押せない）');
  await page.close();
  const late = await openPage(ctx);
  await late.evaluate(() => window.__test__.setMaterialWaitMs(300));
  await never('read')(late);
  await late.click(`#sys-view [data-action="sys-mat-read"][data-id="${ID.pdf}"]`);
  await late.waitForFunction(() => /待つのをやめました/.test(document.querySelector('#toast').textContent) && !document.querySelector('#toast').hidden, { timeout: 4000 });
  const back = await opsOf(late, ID.pdf);
  need(back.join() === '読む,消す', `時間切れの後にボタンが戻らない: ${back.join()}`);
  await shot(late, '169_資料_返事が 60 秒来ないとき（待つのをやめてお知らせ。ボタンは押せる形に戻る）');
  await late.close();
  const out = await openPage(ctx, { width: 1280, height: 800 });
  await never('bdmExport')(out);
  await out.click(`#sys-view [data-action="sys-mat-export"][data-id="${ID.bdm}"]`);
  await out.waitForSelector(`#sys-view .mat-busy[data-id="${ID.bdm}"]`);
  const exp = await opsOf(out, ID.bdm);
  need(exp.join() === '読む（×）,スイムレーン図にする（×）,出力しています…（×）,消す（×）' && await oneLine(out), `出力を待つ間の行のボタンが違う・折り返している: ${exp.join()}`);
  await shot(out, '170_資料_「MPD に出力…」の返事を待つ間（幅 1280。押したボタンが「出力しています…」）');
  await out.close();
}

module.exports = async function shootMaterials(browser, env) {
  await ensureSamples();
  const ctx = { browser, real: realReading(), root: env.ROOT, htmlName: env.HTML_NAME, shot: async (p, name) => { await sleep(120); await env.shot(p, name); } };
  await shootTable(ctx);
  await shootReader(ctx);
  await shootReplace(ctx);
  await shootNarrow(ctx);
  await shootMpdExport(ctx);
  await shootWaiting(ctx);
};
