// tools/shoot-app.js のステータスの移り方と画面の移り方の場面（--only=flow。場面 54〜59・101〜106）。第 8 段階（画像 q52〜q60 のとおりか）を撮る。
// 見本は架空の業務（出張申請・経費精算）で、AI の道具（テスト用の窓口の aiDispatch）で組み立てる（移る先も操作も AI の道具で書ける）。
'use strict';

const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] };

async function buildSample(page) {
  const call = async (tool, args) => {
    const r = await page.evaluate((t, a) => window.__test__.aiDispatch(t, a, { session: 's-1', client: 'claude-code' }), tool, args);
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  // 画面を先に作る（移る先は、あとで並べるときに画面の名前で指す）
  await call('create_design', { name: '出張申請', target: 'kintone', description: '出張の申請と承認' });
  await call('edit_items', { design: '出張申請', ops: [
    { op: 'add', name: '申請者', type: 'user' }, { op: 'add', name: '行き先', type: 'text1' }, { op: 'add', name: '出発日', type: 'date' },
    { op: 'add', name: '帰着日', type: 'date' }, { op: 'add', name: '概算の金額', type: 'number', props: { unit: '円' } }, { op: 'add', name: '出張の目的', type: 'text2' },
  ] });
  await call('edit_process', { design: '出張申請', ops: [
    { op: 'set_states', states: ['申請', '承認待ち', '承認済み', '完了'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' },
    { op: 'add_action', name: '承認する', from: '承認待ち', to: '承認済み', role: '上長' },
    { op: 'add_action', name: '差し戻す', from: '承認待ち', to: '申請', role: '上長', cond: '書き直してほしいとき' },
    { op: 'add_action', name: '精算を終える', from: '承認済み', to: '完了', role: '経理', cond: '経費精算が済んだとき' },
  ] });
  await call('edit_screen', { design: '出張申請', ops: [{ op: 'update', screen: '画面 1', name: '一覧' }] });
  await call('add_screen', { design: '出張申請', name: '新規申請' });
  await call('add_screen', { design: '出張申請', name: '詳細' });
  await call('create_design', { name: '経費精算', target: 'kintone' });
  await call('edit_screen', { design: '経費精算', ops: [{ op: 'update', screen: '画面 1', name: '精算の入力' }] });
  await call('add_screen', { design: '経費精算', name: '一覧', template: 'list' });
  // 並べる（ボタンとリンクの文字に移る先を書く）
  await call('layout_screen', { design: '出張申請', screen: '一覧', layout: { columns: 2, rows: [
    [{ type: 'search' }, { type: 'filter' }],
    [{ type: 'table', label: '出張申請の一覧', tableKind: 'records', rows: 6, span: 2, props: { columns: ['申請者', '行き先', '出発日', '概算の金額'] } }],
    { align: 'right', parts: [{ type: 'button', label: '＋ 新規申請', style: 'primary', to: '新規申請' }] },
  ] } });
  await call('layout_screen', { design: '出張申請', screen: '新規申請', layout: { columns: 2, rows: [
    [{ item: '申請者' }, { item: '行き先' }], [{ item: '出発日' }, { item: '帰着日' }], [{ item: '概算の金額' }], [{ item: '出張の目的', span: 2 }],
    { align: 'right', parts: [{ type: 'button', label: '申請する', style: 'primary', to: '詳細' }, { type: 'button', label: 'キャンセル', style: 'normal', to: '一覧' }] },
  ] } });
  await call('layout_screen', { design: '出張申請', screen: '詳細', layout: { columns: 2, rows: [
    [{ type: 'steps', span: 2 }], [{ type: 'status' }],
    [{ item: '申請者' }, { item: '行き先' }], [{ item: '出発日' }, { item: '帰着日' }],
    { align: 'right', parts: [{ type: 'button', label: '承認する', style: 'primary', to: '一覧' }, { type: 'button', label: '差し戻す', style: 'normal', to: '一覧' }] },
    [{ type: 'link', label: '経費精算を入力する', to: { design: '経費精算', screen: '精算の入力' } }],
  ] } });
  await call('layout_screen', { design: '経費精算', screen: '精算の入力', layout: { columns: 2, rows: [
    [{ type: 'text1', label: '精算の件名' }, { type: 'number', label: '精算の金額' }],
    [{ type: 'link', label: '出張申請の一覧へ戻る', to: { design: '出張申請', screen: '一覧' } }],
    { align: 'right', parts: [{ type: 'button', label: '保存', style: 'primary', to: '一覧' }] },
  ] } });
  return page.evaluate(() => Object.fromEntries(window.__test__.store.state.designs.map((d) => [d.name, d.id])));
}

module.exports = async function shootFlow(browser, env) {
  const { shot, openDeskApp, OUT, VERSION, ROOT } = env;
  const elShot = async (page, sel, name) => {
    const file = path.join(OUT, `v${VERSION}_${name}.png`);
    await (await page.$(sel)).screenshot({ path: file });
    console.log('saved', path.relative(ROOT, file));
  };
  const page = await openDeskApp(browser, EMPTY);
  const ids = await buildSample(page);
  const A = ids['出張申請'];
  // 54: ステータスの移り方の図。右の欄にステータスと操作（q54 の案B）
  await page.setViewport({ width: 1600, height: 1000 });
  await page.evaluate((id) => { window.__test__.openDesign(id); window.__test__.runCommand('openProcess'); }, A);
  await sleep(150);
  await shot(page, '54_流れ_ステータスの流れの図（右のパネルにステータスと操作）');
  // 55: 箱をドラッグで動かした後（位置を覚える）
  const box = await page.evaluate(() => {
    const d = window.__test__.currentDesign();
    const st = d.items.find((x) => x.type === 'status').props.states.find((s) => s.name === '完了');
    const r = document.querySelector(`#design-map .mnode[data-node="t:${st.id}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y - 40, { steps: 10 });
  await page.mouse.up();
  await sleep(100);
  console.log('覚えた位置（ステータスの流れ）:', JSON.stringify(await page.evaluate(() => window.__test__.currentDesign().processPos)));
  await shot(page, '55_流れ_ステータスの流れの図_箱を動かした後');
  // 56: 画面の移り方の図（ほかの画面設計の画面は、行き先も来る元も灰色の点線の箱。q55 の案A・q58）
  await page.setViewport({ width: 1780, height: 760 });
  await page.evaluate(() => window.__test__.runCommand('openFlow'));
  await sleep(150);
  await shot(page, '56_流れ_画面遷移図の図');
  // 57・58: 右の欄（リンクの文字の移る先の欄〔q53 の案A〕・ステータスの印の欄〔q52 の案A〕）。部品の箱の組を閉じて、右の欄を縦に長く撮る
  await page.setViewport({ width: 1440, height: 1500 });
  const pick = async (label, type) => {
    await page.evaluate((l, t) => {
      const T = window.__test__;
      const d = T.currentDesign();
      T.openScreen(d.screens.find((s) => s.name === '詳細').id);
      T.selectPart(T.currentScreen().parts.find((p) => (t ? p.type === t : p.label === l)).id);
      for (let i = 0; i < 12; i++) {
        const b = document.querySelector('#side-box .pal-head[aria-expanded="true"]');
        if (!b) break;
        b.click();
      }
    }, label, type);
    await sleep(150);
  };
  await pick('経費精算を入力する');
  await elShot(page, '#side-panel', '57_流れ_リンクの移動先の欄');
  await pick(null, 'status');
  await elShot(page, '#side-panel', '58_流れ_ステータス表示の右のパネル（ステータスと操作）');
  // 59: 画面を消す確かめの窓（ほかの画面設計の分も、画面設計ごとに数える。q60）
  await page.setViewport({ width: 1400, height: 860 });
  await page.evaluate(() => {
    const T = window.__test__;
    T.openScreen(T.currentDesign().screens.find((s) => s.name === '一覧').id);
    T.runCommand('deleteScreen');
  });
  await page.waitForSelector('.modal');
  await shot(page, '59_流れ_画面を消す確かめの窓');
  await page.click('.modal [data-dlg="cancel"]');
  // 101: 出力の窓（入れるページに「ステータスの移り方」「画面の移り方」。q59）
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('.modal .xp-kinds');
  await shot(page, '101_流れ_出力の窓（入れるページ）');
  await page.click('.modal [data-dlg="cancel"]');
  // 102〜104: PDF のページ（印刷用の文書を、用紙の大きさのページごとに撮る）
  for (const [orient, scenes] of [['landscape', { ステータスの移り方: '102_流れ_PDF_ステータスの流れ（A4横）', 画面の移り方: '104_流れ_PDF_画面遷移図（A4横）' }],
    ['portrait', { ステータスの移り方: '103_流れ_PDF_ステータスの流れ（A4縦）' }]]) {
    const html = await page.evaluate((id, o) => {
      const T = window.__test__;
      return T.exportDocument(T.store.state.designs.find((x) => x.id === id), T.store.state, { paper: 'A4', orient: o, cover: true, map: true, items: true, process: true, flow: true }).html;
    }, A, orient);
    const doc = await browser.newPage();
    await doc.setViewport({ width: 1200, height: 1200 });
    await doc.setContent(html, { waitUntil: 'load' });
    const titles = await doc.$$eval('body > .pg', (els) => els.map((e) => (e.querySelector('.pg-head h2') || e.querySelector('.cv-title')).textContent));
    console.log(`PDF（A4 ${orient === 'landscape' ? '横' : '縦'}）のページ:`, titles.join('・'));
    const pages = await doc.$$('body > .pg');
    for (const [i, t] of titles.entries()) {
      if (!scenes[t]) continue;
      const file = path.join(OUT, `v${VERSION}_${scenes[t]}.png`);
      await pages[i].screenshot({ path: file });
      console.log('saved', path.relative(ROOT, file));
    }
    await doc.close();
  }
  // 105・106: AI の図の画像（get_view_image）
  for (const [view, name] of [['process', '105_流れ_AIの図の画像（ステータスの流れ）'], ['screenflow', '106_流れ_AIの図の画像（画面遷移図）']]) {
    const r = await page.evaluate((id, v) => window.__test__.aiDispatch('get_view_image', { design: id, view: v }, { session: 's-1', client: 'claude-code' }), A, view);
    if (!r.ok) throw new Error(`get_view_image: ${JSON.stringify(r.error)}`);
    console.log(`get_view_image（${view}）:`, JSON.stringify(r.result));
    const img = await browser.newPage();
    await img.setViewport({ width: r.render.width, height: r.render.height });
    await img.setContent(r.render.html, { waitUntil: 'load' });
    await shot(img, name);
    await img.close();
  }
  await page.close();
};
