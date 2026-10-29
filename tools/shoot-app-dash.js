// tools/shoot-app.js のかんばんとダッシュボードの場面（--only=dash。場面 212〜234）。第 15 段階（画像 q123〜q127 のとおりか）を撮る。
// 見本は架空の業務（営業管理・訪問の予定）。画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、右のパネル・アイテム一覧・ウィンドウは編集の画面で撮る。
// 並べ方は、テスト用の窓口の aiDispatch（create_design・layout_screen・add_screen）で組み立てる。AI が並べたかんばんとダッシュボードは、手引き（mcp-guide.js）の例をそのまま使う。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { GUIDES } = require('../mcp-guide');

async function openDashApp(browser, { ROOT, HTML_NAME }) {
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
// 手引きの節の最初の JSON の例（test/dash-ai.test.js と同じ取り出し方）
function guideExample(heading) {
  const block = GUIDES.layout.text.split(heading)[1];
  return JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}') + 2));
}

// 見本を組む。戻り値は画面設計と画面の id
async function buildDash(page) {
  // ひな形 2 つは、項目のない画面設計に追加する（サンプルの項目が入る）
  const sales = await ai(page, 'create_design', { name: '営業管理', target: 'salesforce', look: 'standard', description: '架空の会社の商談の管理' });
  const kanban = await ai(page, 'add_screen', { design: sales.id, template: 'crmKanban', name: '商談のかんばん' });
  const home = await ai(page, 'add_screen', { design: sales.id, template: 'crmHome', name: 'ホーム' });
  await ai(page, 'edit_screen', { design: sales.id, ops: [{ op: 'delete', screen: sales.firstScreen.id }] });
  // カレンダー（月と週）とメールの作成欄
  const plan = await ai(page, 'create_design', { name: '訪問の予定', target: 'salesforce', look: 'standard' });
  await ai(page, 'edit_screen', { design: plan.id, ops: [{ op: 'update', screen: plan.firstScreen.id, name: '月の予定', height: 600 }] });
  await ai(page, 'layout_screen', { design: plan.id, screen: plan.firstScreen.id, layout: { columns: 1, rows: [[{ type: 'calendar', label: '訪問の予定', no: null }]] } });
  const week = await ai(page, 'add_screen', { design: plan.id, name: '週の予定', layout: { columns: 1, rows: [[{ type: 'calendar', label: '訪問の予定', no: null, props: { mode: 'week' } }]] } });
  const mail = await ai(page, 'add_screen', { design: plan.id, name: 'メール', layout: { columns: 1, rows: [[{ type: 'mail', no: null }]] } });
  // AI が手引きの例で並べたかんばんとダッシュボード（Salesforce の見た目）
  const made = await ai(page, 'create_design', { name: '営業管理（AI）', target: 'salesforce', look: 'salesforce' });
  await ai(page, 'edit_items', { design: made.id, ops: [
    { op: 'add', name: '商談名', type: 'text1' }, { op: 'add', name: '金額', type: 'number', props: { unit: '万円' } },
    { op: 'add', name: '段階', type: 'status', props: { states: ['見込み', '提案', '見積', '交渉', '受注'] } },
  ] });
  await ai(page, 'edit_screen', { design: made.id, ops: [{ op: 'update', screen: made.firstScreen.id, name: '商談の一覧' }] });
  await ai(page, 'layout_screen', { design: made.id, screen: made.firstScreen.id, layout: guideExample('## かんばんの書き方の例') });
  const madeHome = await ai(page, 'add_screen', { design: made.id, name: 'ホーム', layout: guideExample('## ダッシュボードの書き方の例') });
  // AI の紫の印（一覧の札・帯）を消すため、最初の画面へ戻る
  await page.evaluate(() => window.__test__.goHome());
  return {
    kanban: { id: sales.id, screen: kanban.screen.id }, home: { id: sales.id, screen: home.screen.id },
    month: { id: plan.id, screen: plan.firstScreen.id }, week: { id: plan.id, screen: week.screen.id }, mail: { id: plan.id, screen: mail.screen.id },
    madeKanban: { id: made.id, screen: made.firstScreen.id }, madeHome: { id: made.id, screen: madeHome.screen.id },
  };
}

module.exports = async function shootDash(browser, env) {
  const { ROOT, shot, OUT, VERSION } = env;
  const page = await openDashApp(browser, env);
  const ids = await buildDash(page);
  const setLook = (did, look) => page.evaluate((id, lk) => window.__test__.actions.updateDesignInfo(id, { look: lk }), did, look);
  // 画面を PNG の出力と同じ HTML で開いて撮る。いちばん下のアイテムの下 40 ドットまでを切り取る（画面の最小の高さで下が空くため）
  const shootScreen = async ({ id, screen }, name) => {
    const doc = await page.evaluate((did, sid) => {
      const T = window.__test__;
      const d = T.store.state.designs.find((x) => x.id === did);
      const x = T.exportPngDocs(d, T.store.state, [sid], null, { table: false, callouts: false })[0];
      const bottom = Math.max(...d.screens.find((sc) => sc.id === sid).parts.map((p) => p.y + p.h));
      return { html: x.html, width: x.width, height: x.height, bottom };
    }, id, screen);
    const p = await browser.newPage();
    await p.setViewport({ width: doc.width, height: doc.height });
    await p.setContent(doc.html, { waitUntil: 'load' });
    const file = path.join(OUT, `v${VERSION}_${name}.png`);
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: doc.width, height: Math.min(doc.height, 32 + doc.bottom + 40) } });
    console.log('saved', path.relative(ROOT, file));
    await p.close();
  };
  const threeLooks = async (target, no, name) => {
    const looks = [['standard', '標準'], ['salesforce', 'Salesforce'], ['kintone', 'kintone']];
    for (let i = 0; i < looks.length; i++) {
      await setLook(target.id, looks[i][0]);
      await shootScreen(target, `${no + i}_dash_${name}_${looks[i][1]}`);
    }
    await setLook(target.id, 'standard');
  };
  const openEditor = async ({ id, screen }, zoomOut) => {
    await page.evaluate((did, sid) => { const T = window.__test__; T.openDesign(did); T.openScreen(sid); }, id, screen);
    for (let i = 0; i < zoomOut; i++) await page.click('[data-action="zoom-out"]');
  };
  const partsOf = ({ id, screen }) => page.evaluate((did, sid) =>
    window.__test__.store.state.designs.find((d) => d.id === did).screens.find((s) => s.id === sid).parts.map((p) => ({ id: p.id, type: p.type, chart: p.props && p.props.chart })), id, screen);
  const select = (pid) => page.evaluate((x) => window.__test__.selectPart(x), pid);
  // 右のパネルを、その文字のある欄が上から 8 ドットの所に来るまで送る（パネルの中だけを送る。使用説明書の撮影の scrollInBox と同じ）
  const scrollPanelTo = (text) => page.evaluate((tx) => {
    const el = [...document.querySelectorAll('#side-settings .field, #side-settings .pf-sep')].find((x) => x.textContent.includes(tx));
    let c = el && el.parentElement;
    while (c && !(c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    if (c) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - 8;
  }, text);

  // 212〜217: ひな形 2 つ（商談のかんばん・ホームのダッシュボード）を 3 つの見た目で
  await threeLooks(ids.kanban, 212, 'ひな形_商談のかんばん');
  await threeLooks(ids.home, 215, 'ひな形_ホームのダッシュボード');
  // 218〜226: カレンダー（月・週）とメールの作成欄を 3 つの見た目で
  await threeLooks(ids.month, 218, 'カレンダー_月');
  await threeLooks(ids.week, 221, 'カレンダー_週');
  await threeLooks(ids.mail, 224, 'メールの作成欄');

  // 227・228: かんばんとメーターを選んだ右のパネル（表示のしかた・列に分ける項目・合計する項目／グラフの種類・目標の値）
  await openEditor(ids.kanban, 2);
  await select((await partsOf(ids.kanban)).find((p) => p.type === 'table').id);
  await scrollPanelTo('表示のしかた');
  await shot(page, '227_dash_かんばんと右のパネル');
  await openEditor(ids.home, 2);
  await select((await partsOf(ids.home)).find((p) => p.chart === 'gauge').id);
  await scrollPanelTo('サンプル値');
  await shot(page, '228_dash_メーターと右のパネル');
  // 229・230: カレンダーとメールの作成欄を選んだ右のパネル
  await openEditor(ids.week, 2);
  await select((await partsOf(ids.week)).find((p) => p.type === 'calendar').id);
  await scrollPanelTo('表示のしかた');
  await shot(page, '229_dash_カレンダーと右のパネル');
  await openEditor(ids.mail, 2);
  await select((await partsOf(ids.mail)).find((p) => p.type === 'mail').id);
  await scrollPanelTo('差出人');
  await shot(page, '230_dash_メールの作成欄と右のパネル');

  // 231: アイテム一覧の「一覧画面用」の組（カレンダーはツリーの後ろ）
  await page.evaluate(() => {
    window.__test__.selectPart(null);
    const box = document.querySelector('#side-box');
    const head = [...box.querySelectorAll('.pal-head')].find((h) => h.textContent.includes('一覧画面用'));
    box.scrollTop += head.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  });
  await shot(page, '231_dash_アイテム一覧の一覧画面用の組');
  await page.evaluate(() => window.__test__.goHome());

  // 232: 「画面を追加する」のウィンドウ（ひな形 11 個。アプリを初めて開いたときの中の大きさ 1280×750 で、ウィンドウの下まで見える）
  await page.setViewport({ width: 1280, height: 750 });
  await openEditor(ids.kanban, 0);
  await page.evaluate(() => window.__test__.runCommand('addScreen'));
  await page.waitForSelector('.modal .tpl');
  await shot(page, '232_dash_画面を追加するのウィンドウ_ひな形11個_1280x750');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__test__.goHome());
  await page.setViewport({ width: 1400, height: 860 });

  // 233・234: AI が手引きの例（read_guide の "layout"）で並べたかんばんとダッシュボード（Salesforce の見た目）
  await shootScreen(ids.madeKanban, '233_dash_AIが並べたかんばん_Salesforce');
  await shootScreen(ids.madeHome, '234_dash_AIが並べたダッシュボード_Salesforce');
  await page.close();
};
