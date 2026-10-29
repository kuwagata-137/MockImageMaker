// tools/shoot-app.js のレコードの画面のアイテムの場面（--only=crm。場面 193〜210）。第 14 段階（画像 q115〜q120 のとおりか）を撮る。
// 見本は架空の業務（顧客管理・問い合わせ管理・文書管理）。画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、
// 右のパネル・アイテム一覧・ウィンドウ・グループ枠のドラッグは編集の画面で撮る。
// 並べ方は、テスト用の窓口の aiDispatch（create_design・layout_screen・add_screen）で組み立てる。AI が並べたレコードの画面は、手引き（mcp-guide.js）の例をそのまま使う。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { GUIDES } = require('../mcp-guide');

async function openCrmApp(browser, { ROOT, HTML_NAME }) {
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
// 手引きの「レコードの画面の書き方の例」（test/crm-ai.test.js と同じ取り出し方）
function guideExample() {
  const block = GUIDES.layout.text.split('## レコードの画面の書き方の例')[1];
  return JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}\n') + 2));
}

// 見本を組む。戻り値は画面設計と画面の id
async function buildCrm(page) {
  const f = await ai(page, 'create_design', { name: '顧客管理', target: 'salesforce', look: 'standard', description: '架空の会社の顧客の情報' });
  await ai(page, 'edit_screen', { design: f.id, ops: [{ op: 'update', screen: f.firstScreen.id, name: 'グループ枠', height: 480 }] });
  const t = (item, type, sample) => ({ item, type, sample });
  await ai(page, 'layout_screen', { design: f.id, screen: f.firstScreen.id, layout: { columns: 3, rows: [
    [{ frame: '顧客の情報', span: 2, columns: 2, rows: [
      [t('顧客名', 'text1', '株式会社サンプル商事'), t('電話', 'text1', '03-1234-5678')],
      [t('担当者', 'user', '佐藤 花子'), t('地域', 'text1', '関東')],
    ] },
    { frame: 'メモ', color: 'green', rows: [[t('メモ', 'text2', '毎月の点検を希望している。')]] }],
  ] } });
  // ひな形は、項目のない画面設計に追加する（サンプルの項目が入る）
  const tplDesign = async (name, template, screenName) => {
    const d = await ai(page, 'create_design', { name, target: 'salesforce', look: 'standard' });
    const s = await ai(page, 'add_screen', { design: d.id, template, name: screenName });
    await ai(page, 'edit_screen', { design: d.id, ops: [{ op: 'delete', screen: d.firstScreen.id }] });
    return { id: d.id, screen: s.screen.id };
  };
  const detail = await tplDesign('顧客管理（ひな形）', 'crmDetail', '顧客の詳細');
  const kase = await tplDesign('問い合わせ管理', 'crmCase', '問い合わせの詳細');
  // ツリー（一覧画面用）: 左にツリー、右にレコード一覧
  const doc = await ai(page, 'create_design', { name: '文書管理', target: 'salesforce', look: 'standard' });
  await ai(page, 'edit_items', { design: doc.id, ops: [
    { op: 'add', name: '文書名', type: 'text1' }, { op: 'add', name: '分類', type: 'text1' }, { op: 'add', name: '更新日', type: 'date' },
  ] });
  await ai(page, 'edit_screen', { design: doc.id, ops: [{ op: 'update', screen: doc.firstScreen.id, name: '一覧', height: 480 }] });
  await ai(page, 'layout_screen', { design: doc.id, screen: doc.firstScreen.id, layout: { columns: 4, rows: [
    [{ type: 'tree' }, { type: 'table', tableKind: 'records', label: '文書の一覧', span: 3, rows: 5, props: { columns: ['文書名', '分類', '更新日'] } }],
  ] } });
  // AI が手引きの例で並べたレコードの画面（Salesforce の見た目）
  const made = await ai(page, 'create_design', { name: '顧客管理（AI）', target: 'salesforce', look: 'salesforce' });
  await ai(page, 'edit_screen', { design: made.id, ops: [{ op: 'update', screen: made.firstScreen.id, name: '顧客の詳細' }] });
  await ai(page, 'layout_screen', { design: made.id, screen: made.firstScreen.id, layout: guideExample() });
  // AI の紫の印（一覧の札・帯）を消すため、最初の画面へ戻る
  await page.evaluate(() => window.__test__.goHome());
  return { frames: { id: f.id, screen: f.firstScreen.id }, detail, kase, doc: { id: doc.id, screen: doc.firstScreen.id }, made: { id: made.id, screen: made.firstScreen.id } };
}

module.exports = async function shootCrm(browser, env) {
  const { ROOT, shot, OUT, VERSION } = env;
  const page = await openCrmApp(browser, env);
  const ids = await buildCrm(page);
  const setLook = (did, look) => page.evaluate((id, lk) => window.__test__.actions.updateDesignInfo(id, { look: lk }), did, look);
  // 画面を PNG の出力と同じ HTML で開いて撮る。clip のときは、いちばん下のアイテムの下 40 ドットまでを切り取る（画面の最小の高さで下が空くため）
  const shootScreen = async ({ id, screen }, name, clip = false) => {
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
    await p.screenshot({ path: file, ...(clip ? { clip: { x: 0, y: 0, width: doc.width, height: Math.min(doc.height, 32 + doc.bottom + 40) } } : {}) });
    console.log('saved', path.relative(ROOT, file));
    await p.close();
  };
  const threeLooks = async (target, no, name, clip = false) => {
    const looks = [['standard', '標準'], ['salesforce', 'Salesforce'], ['kintone', 'kintone']];
    for (let i = 0; i < looks.length; i++) {
      await setLook(target.id, looks[i][0]);
      await shootScreen(target, `${no + i}_crm_${name}_${looks[i][1]}`, clip);
    }
    await setLook(target.id, 'standard');
  };
  const openEditor = async ({ id, screen }, zoomOut) => {
    await page.evaluate((did, sid) => { const T = window.__test__; T.openDesign(did); T.openScreen(sid); }, id, screen);
    for (let i = 0; i < zoomOut; i++) await page.click('[data-action="zoom-out"]');
  };
  const partsOf = ({ id, screen }) => page.evaluate((did, sid) =>
    window.__test__.store.state.designs.find((d) => d.id === did).screens.find((s) => s.id === sid).parts.map((p) => ({ id: p.id, type: p.type, inFrame: p.inFrame || null, x: p.x, y: p.y })), id, screen);
  const select = (pid) => page.evaluate((x) => window.__test__.selectPart(x), pid);

  // 193〜195: グループ枠の 3 つの見た目（中に項目を 2 列で並べたグループ枠と、色を変えたグループ枠）
  await threeLooks(ids.frames, 193, 'グループ枠', true);

  // 196・197: グループ枠を動かす前と後（グループ名の行をマウスでドラッグすると、中のアイテムも一緒に動く）
  await openEditor(ids.frames, 1);
  const before = await partsOf(ids.frames);
  const frame = before.find((p) => p.type === 'frame');
  const box = await (await page.$(`#stage .part[data-part-id="${frame.id}"]`)).boundingBox();
  const from = { x: box.x + 120, y: box.y + 14 };
  await page.mouse.click(from.x, from.y);
  await shot(page, '196_crm_グループ枠を動かす前');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 160, { steps: 12 });
  await page.mouse.up();
  const after = await partsOf(ids.frames);
  const moved = before.filter((p) => p.inFrame === frame.id).map((p) => {
    const q = after.find((x) => x.id === p.id);
    return [q.x - p.x, q.y - p.y];
  });
  console.log('グループ枠と一緒に動いた中のアイテム（動いた量）:', JSON.stringify(moved));
  await shot(page, '197_crm_グループ枠を動かした後_中のアイテムも動く');
  await page.evaluate(() => window.__test__.goHome());

  // 198〜200: レコードの見出し・関連レコード一覧の並べて表示・活動履歴を選んだ右のパネル
  await openEditor(ids.detail, 2);
  const dp = await partsOf(ids.detail);
  await select(dp.find((p) => p.type === 'recordHead').id);
  await shot(page, '198_crm_レコードの見出しと右のパネル');
  await select(dp.find((p) => p.type === 'table').id);
  await shot(page, '199_crm_並べて表示と右のパネルの表示のしかた');
  await select(dp.find((p) => p.type === 'activity').id);
  await shot(page, '200_crm_活動履歴と右のパネル');
  await page.evaluate(() => window.__test__.goHome());

  // 201: ツリーを選んだ右のパネル（ツリーの行・選んでいる行・フォルダのアイコン）
  await openEditor(ids.doc, 1);
  await select((await partsOf(ids.doc)).find((p) => p.type === 'tree').id);
  await shot(page, '201_crm_ツリーと右のパネル');
  await page.evaluate(() => window.__test__.goHome());

  // 202〜207: ひな形 2 つを 3 つの見た目で
  await threeLooks(ids.detail, 202, 'ひな形_顧客の詳細');
  await threeLooks(ids.kase, 205, 'ひな形_問い合わせ対応の3列');

  // 208: アイテム一覧の「詳細画面用」の組（グループ枠・レコードの見出し・活動履歴）
  await openEditor(ids.detail, 3);
  await page.evaluate(() => {
    window.__test__.selectPart(null);
    const box2 = document.querySelector('#side-box');
    const head = [...box2.querySelectorAll('.pal-head')].find((h) => h.textContent.includes('詳細画面用'));
    box2.scrollTop += head.getBoundingClientRect().top - box2.getBoundingClientRect().top - 8;
  });
  await shot(page, '208_crm_アイテム一覧の詳細画面用の組');

  // 209: 「画面を追加する」のウィンドウ（ひな形 14 個。CRM のひな形 2 つは進捗の後ろ、第 15・16 段階のひな形はその後ろ）
  await page.evaluate(() => window.__test__.runCommand('addScreen'));
  await page.waitForSelector('.modal .tpl');
  await shot(page, '209_crm_画面を追加するのウィンドウ_ひな形14個');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__test__.goHome());

  // 210: AI が手引きの例（read_guide の "layout"）で並べたレコードの画面（Salesforce の見た目）
  await shootScreen(ids.made, '210_crm_AIが並べたレコードの画面_Salesforce');
  await page.close();
};
