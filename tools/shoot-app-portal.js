// tools/shoot-app.js の小さなウィンドウとお客さまポータルの場面（--only=portal。場面 237〜256）。第 16 段階（画像 q128〜q131 のとおりか）を撮る。
// 見本は架空の業務（問い合わせ管理・サポートサイト）。画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、右のパネル・アイテム一覧・ウィンドウは編集の画面で撮る。
// 並べ方は、テスト用の窓口の aiDispatch（create_design・add_screen・edit_screen・layout_screen）で組み立てる。AI が並べた例は、手引き（mcp-guide.js）の例をそのまま使う。
// ポータル画面用のアイテム 4 つを並べた画面（場面 236）は、shoot-app.js の buildParts2 の「ポータル」の画面にある。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { GUIDES } = require('../mcp-guide');

async function openPortalApp(browser, { ROOT, HTML_NAME }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 860 });
  await page.evaluateOnNewDocument(() => {
    window.__test__ = {};
    localStorage.clear();
  });
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  return page;
}
const ai = async (page, tool, args) => {
  const r = await page.evaluate((t, a) => window.__test__.aiDispatch(t, a, { session: 's-1', client: 'claude-code' }), tool, args);
  if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
  return r.result;
};
// 手引きの節の最初の JSON の例（test/window-ai.test.js と同じ取り出し方）
function guideExample(heading) {
  const block = GUIDES.layout.text.split(heading)[1];
  return JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}') + 2));
}

// 見本を組む。戻り値は画面設計と画面の id
async function buildPortal(page) {
  // 問い合わせ管理: 問い合わせ対応の 3 列の画面に、承認申請のウィンドウ（真ん中）と作業報告のウィンドウ（右の端）を重ねる
  const inq = await ai(page, 'create_design', { name: '問い合わせ管理', target: 'salesforce', look: 'standard', description: '架空の会社の問い合わせの管理' });
  const detail = await ai(page, 'add_screen', { design: inq.id, template: 'crmCase', name: '問い合わせの詳細' });
  await ai(page, 'edit_screen', { design: inq.id, ops: [{ op: 'delete', screen: inq.firstScreen.id }] });
  const approval = await ai(page, 'add_screen', { design: inq.id, template: 'winApproval', after: detail.screen.id });
  const report = await ai(page, 'add_screen', { design: inq.id, name: '作業報告', after: approval.screen.id });
  await ai(page, 'edit_screen', { design: inq.id, ops: [{ op: 'update', screen: report.screen.id, overlay: { under: detail.screen.id, pos: 'right', width: 480 } }] });
  await ai(page, 'layout_screen', { design: inq.id, screen: report.screen.id, layout: { rows: [
    [{ item: '作業の日', type: 'date', sample: '2026-10-22' }],
    [{ item: '作業の内容', type: 'text2', sample: '室外機の温度の部品を交換した。運転して、冷房が効くことを確かめた。' }],
    [{ item: '写真', type: 'file' }],
    { align: 'right', parts: [{ type: 'button', label: '報告する' }, { type: 'button', label: 'キャンセル', to: detail.screen.id }] },
  ] } });
  // サポートサイト: お客さまポータルのトップに、AI のチャットのウィンドウ（右下）を重ねる
  const site = await ai(page, 'create_design', { name: 'サポートサイト', target: 'Claude で作るアプリ', look: 'standard', description: '架空の会社のお客さま向けのサポートサイト' });
  const top = await ai(page, 'add_screen', { design: site.id, template: 'portalTop' });
  await ai(page, 'edit_screen', { design: site.id, ops: [{ op: 'delete', screen: site.firstScreen.id }] });
  await ai(page, 'update_design', { design: site.id, portal: { menu: ['ホーム', 'よくある質問', '修理の申し込み', 'お問い合わせ'] } });
  const chat = await ai(page, 'add_screen', { design: site.id, template: 'winChat', after: top.screen.id });
  // AI が手引きの例で並べたお客さまポータルと承認申請のウィンドウ（Salesforce の見た目）
  const made = await ai(page, 'create_design', { name: 'サポートサイト（AI）', target: 'salesforce', look: 'salesforce' });
  await ai(page, 'edit_screen', { design: made.id, ops: [{ op: 'update', screen: made.firstScreen.id, name: 'トップ', headerKind: 'portal' }] });
  await ai(page, 'layout_screen', { design: made.id, screen: made.firstScreen.id, layout: guideExample('## お客さまポータルの書き方の例') });
  const madeDetail = await ai(page, 'add_screen', { design: made.id, template: 'crmCase', name: '問い合わせの詳細' });
  const madeWin = await ai(page, 'add_screen', { design: made.id, name: '承認申請' });
  await ai(page, 'edit_screen', { design: made.id, ops: [{ op: 'update', screen: madeWin.screen.id, overlay: { under: madeDetail.screen.id, pos: 'center' } }] });
  await ai(page, 'layout_screen', { design: made.id, screen: madeWin.screen.id, layout: guideExample('## 小さなウィンドウの書き方の例') });
  // AI の紫の印（一覧の札・帯）を消すため、最初の画面へ戻る
  await page.evaluate(() => window.__test__.goHome());
  return {
    detail: { id: inq.id, screen: detail.screen.id }, approval: { id: inq.id, screen: approval.screen.id }, report: { id: inq.id, screen: report.screen.id },
    top: { id: site.id, screen: top.screen.id }, chat: { id: site.id, screen: chat.screen.id },
    madeTop: { id: made.id, screen: made.firstScreen.id }, madeWin: { id: made.id, screen: madeWin.screen.id },
  };
}

module.exports = async function shootPortal(browser, env) {
  const { ROOT, shot, OUT, VERSION } = env;
  const page = await openPortalApp(browser, env);
  const ids = await buildPortal(page);
  const setLook = (did, look) => page.evaluate((id, lk) => window.__test__.actions.updateDesignInfo(id, { look: lk }), did, look);
  // 画面を PNG の出力と同じ HTML で開いて撮る（小さなウィンドウの画面は下の画面ごと、画面の高さいっぱいに撮る）
  const shootScreen = async ({ id, screen }, name) => {
    const doc = await page.evaluate((did, sid) => {
      const T = window.__test__;
      const d = T.store.state.designs.find((x) => x.id === did);
      const x = T.exportPngDocs(d, T.store.state, [sid], null, { table: false, callouts: false })[0];
      return { html: x.html, width: x.width, height: x.height };
    }, id, screen);
    const p = await browser.newPage();
    await p.setViewport({ width: doc.width, height: doc.height });
    await p.setContent(doc.html, { waitUntil: 'load' });
    const file = path.join(OUT, `v${VERSION}_${name}.png`);
    await p.screenshot({ path: file });
    console.log('saved', path.relative(ROOT, file));
    await p.close();
  };
  const threeLooks = async (target, no, name) => {
    const looks = [['standard', '標準'], ['salesforce', 'Salesforce'], ['kintone', 'kintone']];
    for (let i = 0; i < looks.length; i++) {
      await setLook(target.id, looks[i][0]);
      await shootScreen(target, `${no + i}_portal_${name}_${looks[i][1]}`);
    }
    await setLook(target.id, 'standard');
  };
  const openEditor = async ({ id, screen }, zoomOut) => {
    await page.evaluate((did, sid) => { const T = window.__test__; T.openDesign(did); T.openScreen(sid); T.selectPart(null); }, id, screen);
    for (let i = 0; i < zoomOut; i++) await page.click('[data-action="zoom-out"]');
  };
  // 右のパネルを、その文字で始まる見出しの欄が上から 8 ドットの所に来るまで送る（shoot-app-dash.js と同じ。
  // 欄の見出し〔最初の span〕で探す。「見た目」の欄の説明にも「ヘッダーの形」が入るため）
  const scrollPanelTo = (text) => page.evaluate((tx) => {
    const el = [...document.querySelectorAll('#side-settings .field')].find((x) => (x.querySelector('span') || x).textContent.startsWith(tx));
    let c = el && el.parentElement;
    while (c && !(c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    if (c) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - 8;
  }, text);

  // 237〜245: ひな形 3 つ（お客さまポータルのトップ・承認申請のウィンドウ・AI のチャットのウィンドウ）を 3 つの見た目で
  await threeLooks(ids.top, 237, 'ひな形_お客さまポータルのトップ');
  await threeLooks(ids.approval, 240, 'ひな形_承認申請のウィンドウ');
  await threeLooks(ids.chat, 243, 'ひな形_AIのチャットのウィンドウ');
  // 246: 右の端のウィンドウ（作業報告。Salesforce の見た目は見出しが青）
  await setLook(ids.report.id, 'salesforce');
  await shootScreen(ids.report, '246_portal_右の端のウィンドウ_作業報告_Salesforce');
  await setLook(ids.report.id, 'standard');

  // 247〜250: 小さなウィンドウ（承認申請）を、編集の画面・PDF のページ・最初の画面の縮小画像・画面遷移図で
  await openEditor(ids.approval, 2);
  await shot(page, '247_portal_小さなウィンドウ_編集の画面');
  const pdf = await page.evaluate((did) => {
    const T = window.__test__;
    const d = T.store.state.designs.find((x) => x.id === did);
    return T.exportDocument(d, T.store.state, { paper: 'A4', orient: 'landscape', cover: false, map: false, items: true, process: false, flow: false }).html;
  }, ids.approval.id);
  const pp = await browser.newPage();
  await pp.setViewport({ width: 1123, height: 794 });
  await pp.setContent(pdf, { waitUntil: 'load' });
  const pages = await pp.$$('.pg');
  let pageShot = null;
  for (const el of pages) if (await el.evaluate((e) => e.textContent.includes('の上に開く小さなウィンドウ'))) { pageShot = el; break; }
  const pdfFile = path.join(OUT, `v${VERSION}_248_portal_小さなウィンドウ_PDFのページ.png`);
  if (pageShot) await pageShot.screenshot({ path: pdfFile });
  else await pp.screenshot({ path: pdfFile, fullPage: true });
  console.log('saved', path.relative(ROOT, pdfFile));
  await pp.close();
  // 最初の画面の縮小画像は、画面設計のいちばん上の画面を描くので、ウィンドウの画面をいちばん上へ動かして撮り、元に戻す
  await page.evaluate((did, sid) => window.__test__.actions.moveScreen(did, sid, 0), ids.approval.id, ids.approval.screen);
  await page.evaluate(() => window.__test__.goHome());
  await shot(page, '249_portal_小さなウィンドウ_最初の画面の縮小画像');
  await page.evaluate((did, sid) => window.__test__.actions.moveScreen(did, sid, 2), ids.approval.id, ids.approval.screen);
  await page.evaluate((did) => { window.__test__.openDesign(did); window.__test__.runCommand('openFlow'); }, ids.approval.id);
  await shot(page, '250_portal_小さなウィンドウ_画面遷移図');
  await page.evaluate(() => window.__test__.goHome());

  // 251・252: 右のパネル（下に重ねる画面とウィンドウの位置／ヘッダーの形とお客さまポータルの欄）
  await openEditor(ids.approval, 2);
  await scrollPanelTo('下に重ねる画面');
  await shot(page, '251_portal_右のパネル_下に重ねる画面');
  await openEditor(ids.top, 3);
  await scrollPanelTo('ヘッダーの形');
  await shot(page, '252_portal_右のパネル_ヘッダーの形');
  // 253: アイテム一覧の「ポータル画面用」の組
  await page.evaluate(() => {
    const box = document.querySelector('#side-box');
    const head = [...box.querySelectorAll('.pal-head')].find((h) => h.textContent.includes('ポータル画面用'));
    box.scrollTop += head.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  });
  await shot(page, '253_portal_アイテム一覧のポータル画面用の組');
  await page.evaluate(() => window.__test__.goHome());

  // 254: 「画面を追加する」のウィンドウ（ひな形 14 個を 5 つずつ 3 段。アプリを初めて開いたときの中の大きさ 1280×750 で、ウィンドウの下まで見える）
  await page.setViewport({ width: 1280, height: 750 });
  await openEditor(ids.detail, 0);
  await page.evaluate(() => window.__test__.runCommand('addScreen'));
  await page.waitForSelector('.modal .tpl');
  await shot(page, '254_portal_画面を追加するのウィンドウ_ひな形14個_1280x750');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__test__.goHome());
  await page.setViewport({ width: 1400, height: 860 });

  // 255・256: AI が手引きの例（read_guide の "layout"）で並べたお客さまポータルと承認申請のウィンドウ（Salesforce の見た目）
  await shootScreen(ids.madeTop, '255_portal_AIが並べたお客さまポータル_Salesforce');
  await shootScreen(ids.madeWin, '256_portal_AIが並べた承認申請のウィンドウ_Salesforce');
  await page.close();
};
