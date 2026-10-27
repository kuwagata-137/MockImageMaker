// tools/shoot-app.js のシステムの説明書の場面（--only=doc。場面 158〜163）。第 10 段階の後半の説明書の窓と PDF のページが、
// 画像 q81_1（窓）・q81_2（システムの表紙）・q81_3（スイムレーン図のページ）・q80_3（設計ノートのページ）のとおりかを撮る。
// 見本は架空の出張申請システム（出張申請・経費精算。経費精算は経費精算システムでも使う）。AI の道具（テスト用の窓口 window.__test__ の aiDispatch）で組み立てる。
// 窓は Puppeteer で実際にマウスを押して開く（headless・窓を出さない）。PDF のページは、出力の窓口の身代わり（openDeskApp の window.__xp）が受け取った
// 印刷用の HTML を別のページに描いて、ページごとに撮る。どの場面も、撮るたびに大事な所が出ているかを need() で確かめる（出ていなければ止まる）。
//  158 システムの画面のメニューバーの「出力」と説明書の窓 ／ 159 最初の画面のシステムの「…」の「説明書を出力…」／
//  160 押せない印のある窓（作業の箱なし・設計ノートの行なし）／ 161 システムの表紙 ／ 162 スイムレーン図のページ ／ 163 設計ノートのページ
'use strict';

const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, message) => { if (!ok) throw new Error(message); };
const EMPTY = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] };

// ── ページの中で動かす: 見本を AI の道具で組み立てる。戻り値 { main（出張申請システム）, other（経費精算システム） } ──
async function buildSample() {
  const T = window.__test__;
  const call = async (tool, args) => {
    const r = await T.aiDispatch(tool, args, { session: 'shoot-doc', client: 'claude-code' });
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const main = (await call('create_system', { name: '出張申請システム', description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。' })).id;
  await call('update_system', { system: main, ops: [{ op: 'add', name: '申請者' }, { op: 'add', name: '上長' }, { op: 'add', name: '経理' }] });
  await call('set_swimlane', { system: main,
    steps: [
      { key: 'a', role: '申請者', kind: 'start', text: '出張が決まる' }, { key: 'b', role: '申請者', kind: 'input', text: '出張申請を入力する' },
      { key: 'c', role: '上長', kind: 'decision', text: '申請を確かめる' }, { key: 'd', role: '上長', kind: 'task', text: '承認する' },
      { key: 'e', role: '経理', kind: 'task', text: '旅費を精算する' }, { key: 'f', role: '経理', kind: 'doc', text: '精算書を出す' }, { key: 'g', role: '経理', kind: 'end', text: '終わり' },
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: '承認' }, { from: 'c', to: 'b', label: '差し戻し' },
      { from: 'd', to: 'e' }, { from: 'e', to: 'f' }, { from: 'f', to: 'g' }] });
  await call('create_design', { name: '出張申請', target: 'kintone', description: '社員が出張の前に申請し、上長が承認する。', system: main });
  await call('edit_items', { design: '出張申請', ops: [{ op: 'add', name: '申請番号', type: 'text1' }, { op: 'add', name: '申請者', type: 'user' },
    { op: 'add', name: '行き先', type: 'text1' }, { op: 'add', name: '出発日', type: 'date' }] });
  await call('edit_process', { design: '出張申請', ops: [{ op: 'set_states', states: ['申請', '承認待ち', '完了'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' }, { op: 'add_action', name: '承認する', from: '承認待ち', to: '完了', role: '上長' },
    { op: 'add_action', name: '差し戻す', from: '承認待ち', to: '申請', role: '上長', cond: '書き直してほしいとき' }] });
  await call('layout_screen', { design: '出張申請', screen: '画面 1', layout: { columns: 2, rows: [[{ type: 'status' }], [{ item: '申請者' }, { item: '行き先' }], [{ item: '出発日' }]] } });
  await call('create_design', { name: '経費精算', target: 'kintone', description: '出張の旅費と、立て替えた経費を精算する。', system: main });
  await call('edit_items', { design: '経費精算', ops: [{ op: 'add', name: '出張申請の番号', type: 'text1' }] });
  await call('edit_items', { design: '経費精算', ops: [{ op: 'lookup', item: '出張申請の番号', lookup: { design: '出張申請', key: '申請番号', copies: [{ from: '行き先', to: '行き先', create: true }] } }] });
  await call('layout_screen', { design: '経費精算', screen: '画面 1', layout: { columns: 2, rows: [[{ item: '出張申請の番号' }, { item: '行き先' }], [{ type: 'number', label: '精算の金額' }]] } });
  const other = (await call('create_system', { name: '経費精算システム', description: '立て替えた経費を申請し、経理が支払うシステム。' })).id;
  await call('add_to_system', { system: other, design: '経費精算' });
  const w = await call('update_notes', { system: main, ops: [
    { op: 'add_question', stage: 'items', text: '宿泊費の上限（1 泊 9,000 円）を、役職で変えるか' },
    { op: 'add_question', stage: 'flow', text: '部長の承認は、金額が 10 万円以上のときだけにするか' },
    { op: 'add_question', stage: 'read', text: '海外出張も、このシステムで申請するか' },
    { op: 'add_decision', stage: 'read', text: '役割は、申請者・上長・経理の 3 つにする', reason: '旅費規程の第 5 条と、出張申請書の承認の欄から' },
    { op: 'add_decision', stage: 'flow', text: '承認は上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' },
    { op: 'add_decision', stage: 'items', text: '経費精算は、出張申請と別の画面設計にする', reason: '精算は経理が確かめ、出張のない経費も入るため' },
    { op: 'add_decision', stage: 'docs', text: 'システム設計書を出力した', reason: 'C:\\Users\\user\\Documents\\モックイメージメーカー\\AI の出力\\出張申請システム_システム設計書.pdf' },
  ] });
  const qRead = w.added.filter((a) => a.op === 'add_question')[2].id;
  await call('update_notes', { system: main, ops: [{ op: 'answer_question', id: qRead, answer: '国内だけにする（総務に確かめた）' }] });
  T.aiView.cards.clear(); // AI が作った印（紫の札・帯）を外す
  T.aiView.band = null;
  T.aiView.warn = null;
  T.goHome();
  return { main, other };
}

// 開いている説明書の窓 { title, buttons, pages: [鍵, 印があるか, 押せないか, 理由] }
const readDialog = (page) => page.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  return {
    title: m.querySelector('h2').textContent,
    buttons: [...m.querySelectorAll('.modal-actions button')].map((b) => b.textContent),
    note: m.querySelector('.xp-note').textContent,
    pages: [...m.querySelectorAll('[data-dpage]')].map((x) => [x.dataset.dpage, x.checked, x.disabled, (x.closest('label').querySelector('.sub') || {}).textContent || '']),
  };
});
const toastGone = (page) => page.waitForFunction(() => document.querySelector('#toast').hidden, { timeout: 8000 });

// 158〜160: 窓と入口
async function shootDialogs(ctx, page, ids) {
  // 158: システムの画面のメニューバーの「出力」を押した窓
  await page.evaluate((id) => window.__test__.openSystem(id), ids.main);
  await toastGone(page);
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('#sys-menu-root [data-action="sys-export-doc"]'); // 第 11 段階から、「出力」は小さなメニューを開く
  await page.click('#sys-menu-root [data-action="sys-export-doc"]');
  await page.waitForSelector('.modal [data-dpage]');
  let d = await readDialog(page);
  need(d.title === '「出張申請システム」のシステム設計書を出力する' && d.buttons.join() === 'システム設計書を出力…,キャンセル', `窓の題・ボタンの並びが違う: ${d.title} ／ ${d.buttons.join()}`);
  need(d.pages.length === 8 && d.pages.every(([, on, off]) => on && !off), `最初は 8 つの印が全部入って押せるはず: ${JSON.stringify(d.pages)}`);
  need(/入っている画面設計 2 つ（出張申請・経費精算）/.test(d.note), `窓の説明の文が違う: ${d.note}`);
  await sleep(150);
  await ctx.shot(page, '158_システム設計書_システムの画面のツールバーの「出力」と説明書の窓');
  // 説明書を出力する（161〜163 で撮る PDF のページ）
  await page.click('.modal [data-dlg="ok"]');
  await page.waitForFunction(() => window.__xp.some((x) => x[0] === 'pdf'), { timeout: 30000 });
  // 159: 最初の画面のシステムの「…」のメニュー
  await toastGone(page);
  await page.evaluate(() => window.__test__.goHome());
  await page.click(`.sys-block [data-action="sys-menu"][data-id="${ids.main}"]`);
  await sleep(150);
  const items = await page.evaluate(() => [...document.querySelectorAll('.sys-pop [role="menuitem"]')].map((b) => b.textContent));
  need(items.join() === '名前と説明の変更…,システム設計書を出力…,このシステムを削除する（ごみ箱へ移す）', `システムの「…」のメニューが違う: ${items.join()}`);
  await ctx.shot(page, '159_システム設計書_最初の画面のシステムの「…」の「システム設計書を出力…」');
  await page.keyboard.press('Escape');
  // 160: 作業の箱がなく、設計ノートに行がないシステム（経費精算システム）の窓
  await page.evaluate((id) => window.__test__.openSystem(id), ids.other);
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('#sys-menu-root [data-action="sys-export-doc"]'); // 第 11 段階から、「出力」は小さなメニューを開く
  await page.click('#sys-menu-root [data-action="sys-export-doc"]');
  await page.waitForSelector('.modal [data-dpage]');
  d = await readDialog(page);
  const off = d.pages.filter(([, , dis]) => dis).map(([k, , , why]) => `${k}:${why}`);
  need(off.join() === 'swimlane:工程がないので、出しません,notes:設計ノートに行がないので、出しません', `押せない印と理由が違う: ${off.join()}`);
  await sleep(150);
  await ctx.shot(page, '160_システム設計書_押せない印のある窓（作業の箱なし・設計ノートの行なし）');
  await page.click('.modal [data-dlg="cancel"]');
}

// 161〜163: 出力した PDF のページ（印刷用の HTML を別のページに描いて撮る）
async function shootPages(ctx, page) {
  const pdf = await page.evaluate(() => window.__xp.find((x) => x[0] === 'pdf')[1]);
  need(pdf.name === '出張申請システム_システム設計書.pdf', `ファイルの名前が違う: ${pdf.name}`);
  const doc = await ctx.browser.newPage();
  await doc.setViewport({ width: 1200, height: 900 });
  await doc.setContent(pdf.html, { waitUntil: 'load' });
  const facts = await doc.evaluate(() => {
    const pgs = [...document.querySelectorAll('body > .pg')];
    const last = pgs[pgs.length - 1];
    return {
      n: pgs.length,
      kicker: (pgs[0].querySelector('.cv-kicker') || {}).textContent,
      share: [...pgs[0].querySelectorAll('.share-tag')].map((x) => x.textContent),
      roles: pgs[0].querySelectorAll('.cv-revs tbody tr').length,
      swim: (pgs[1].querySelector('.pg-head h2') || {}).textContent, boxes: pgs[1].querySelectorAll('.mnode').length,
      notes: (last.querySelector('.pg-head h2') || {}).textContent, tables: last.querySelectorAll('table.xp-itable').length, done: last.querySelectorAll('tr.done').length,
      docsRow: document.body.textContent.includes('システム設計書を出力した'),
    };
  });
  need(facts.kicker === 'システム設計書' && facts.share.join() === '経費精算システムでも使っている' && facts.roles === 3, `システムの表紙が違う: ${JSON.stringify(facts)}`);
  need(facts.swim === 'スイムレーン図' && facts.boxes === 7, `スイムレーン図のページが違う: ${facts.swim}・箱 ${facts.boxes}`);
  need(facts.notes === '設計ノート' && facts.tables === 2 && facts.done === 1 && !facts.docsRow, `設計ノートのページが違う: ${JSON.stringify(facts)}`);
  const pages = await doc.$$('body > .pg');
  const shots = [[0, '161_システム設計書_PDF_システムの表紙'], [1, '162_システム設計書_PDF_スイムレーン図のページ'], [pages.length - 1, '163_システム設計書_PDF_設計ノートのページ']];
  for (const [i, label] of shots) {
    const file = path.join(ctx.OUT, `v${ctx.VERSION}_${label}.png`);
    await pages[i].screenshot({ path: file });
    console.log('saved', path.relative(ctx.ROOT, file));
  }
  console.log('説明書の PDF のページの数:', facts.n);
  await doc.close();
}

module.exports = async function shootDoc(browser, env) {
  const ctx = { browser, ROOT: env.ROOT, OUT: env.OUT, VERSION: env.VERSION, shot: async (p, name) => { await sleep(120); await env.shot(p, name); } };
  const page = await env.openDeskApp(browser, EMPTY);
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  const ids = await page.evaluate(buildSample);
  await shootDialogs(ctx, page, ids);
  await shootPages(ctx, page);
  await page.close();
  need(!errors.length, `ページで例外が出た: ${errors.join(' ／ ')}`);
};
