// tools/shoot-app.js のシステムとスイムレーン図の場面（--only=systems。場面 107〜133）。第 9 段階の前半（画像 q61〜q66）のとおりかを撮る。
// 見本は架空の業務（出張申請システム・経費精算システム）で、AI の道具（テスト用の窓口の aiDispatch）で組み立てる。
// 撮る場面の操作は、どれも Puppeteer で実際にマウスとキーを動かす（headless・窓を出さない）。
'use strict';

const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] };
const SYS_A = '出張申請システム';
const SYS_B = '経費精算システム';

// 見本の画面設計（出張申請・社員マスタ・経費精算と、システムに入っていない 3 つ）
async function buildDesigns(call) {
  await call('create_design', { name: '出張申請', target: 'kintone', description: '出張の申請と承認', system: SYS_A });
  await call('edit_items', { design: '出張申請', ops: [
    { op: 'add', name: '申請者', type: 'user' }, { op: 'add', name: '行き先', type: 'text1' }, { op: 'add', name: '出発日', type: 'date' },
    { op: 'add', name: '帰着日', type: 'date' }, { op: 'add', name: '概算の金額', type: 'number', props: { unit: '円' } },
  ] });
  await call('edit_process', { design: '出張申請', ops: [{ op: 'set_states', states: ['申請', '承認待ち', '承認済み', '完了'] }] });
  await call('edit_screen', { design: '出張申請', ops: [{ op: 'update', screen: '画面 1', name: '一覧' }] });
  await call('layout_screen', { design: '出張申請', screen: '一覧', layout: { columns: 2, rows: [
    [{ type: 'search' }, { type: 'filter' }],
    [{ type: 'table', label: '出張申請の一覧', tableKind: 'records', rows: 6, span: 2, props: { columns: ['申請者', '行き先', '出発日', '概算の金額'] } }],
  ] } });
  await call('add_screen', { design: '出張申請', name: '新規申請', layout: { columns: 2, rows: [
    [{ item: '申請者' }, { item: '行き先' }], [{ item: '出発日' }, { item: '帰着日' }], [{ item: '概算の金額' }],
    { align: 'right', parts: [{ type: 'button', label: '申請する', style: 'primary' }] },
  ] } });
  await call('add_screen', { design: '出張申請', name: '詳細', layout: { columns: 2, rows: [[{ type: 'steps', span: 2 }], [{ item: '申請者' }, { item: '行き先' }]] } });
  await call('create_design', { name: '社員マスタ', target: 'kintone', description: '社員の名前と部署', system: SYS_A });
  await call('edit_items', { design: '社員マスタ', ops: [
    { op: 'add', name: '社員番号', type: 'text1' }, { op: 'add', name: '氏名', type: 'text1' }, { op: 'add', name: '部署', type: 'text1' },
  ] });
  await call('edit_screen', { design: '社員マスタ', ops: [{ op: 'update', screen: '画面 1', name: '一覧' }] });
  await call('layout_screen', { design: '社員マスタ', screen: '一覧', layout: { columns: 2, rows: [
    [{ type: 'search' }], [{ type: 'table', label: '社員の一覧', tableKind: 'records', rows: 6, span: 2, props: { columns: ['社員番号', '氏名', '部署'] } }],
  ] } });
  await call('create_design', { name: '経費精算', target: 'kintone', description: '立て替えた経費の精算', system: SYS_B });
  await call('edit_screen', { design: '経費精算', ops: [{ op: 'update', screen: '画面 1', name: '精算の入力' }] });
  await call('layout_screen', { design: '経費精算', screen: '精算の入力', layout: { columns: 2, rows: [
    [{ type: 'text1', label: '精算の件名' }, { type: 'number', label: '精算の金額' }], [{ type: 'text2', label: '内訳', span: 2 }],
  ] } });
  await call('add_to_system', { system: SYS_B, design: '社員マスタ', mode: 'same' });
  // システムに入っていない画面設計（会議室予約〔古い案〕は、あとで画面からごみ箱へ移す）
  await call('create_design', { name: '取引先マスタ', target: 'Salesforce' });
  await call('layout_screen', { design: '取引先マスタ', screen: '画面 1', layout: { rows: [[{ type: 'search' }], [{ type: 'table', tableKind: 'records', rows: 5, span: 2 }]] } });
  await call('create_design', { name: '日報', target: 'Claude で作るアプリ' });
  await call('layout_screen', { design: '日報', screen: '画面 1', layout: { columns: 2, rows: [[{ type: 'date', label: '日付' }, { type: 'text1', label: '書いた人' }], [{ type: 'text2', label: '今日したこと', span: 2 }]] } });
  await call('create_design', { name: '会議室予約（古い案）', target: 'kintone' });
}

// 見本を AI の道具で組み立てる。組み立てた後は、AI の紫の印（カードの札・帯）を外して最初の画面に戻る
async function buildSample(page) {
  const call = async (tool, args, session = 's-1') => {
    const r = await page.evaluate((t, a, ss) => window.__test__.aiDispatch(t, a, { session: ss, client: 'claude-code' }), tool, args, session);
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r;
  };
  await call('create_system', { name: SYS_A, description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。' });
  await call('update_system', { system: SYS_A, ops: [{ op: 'add', name: '申請者' }, { op: 'add', name: '上長', memo: '申請者の課の課長' }, { op: 'add', name: '経理' }] });
  await call('create_system', { name: SYS_B, description: '立て替えた経費を申請し、経理が支払うシステム。' });
  await call('update_system', { system: SYS_B, ops: [{ op: 'add', name: '申請者' }, { op: 'add', name: '経理' }] });
  await buildDesigns(call);
  const ref = (screen, state) => ({ design: '出張申請', screen, ...(state ? { state } : {}) });
  await call('set_swimlane', {
    system: SYS_A,
    steps: [
      { key: 'a', role: '申請者', kind: 'start', text: '出張が決まる' },
      { key: 'b', role: '申請者', kind: 'input', text: '出張申請を入力する', ref: ref('新規申請', '申請') },
      { key: 'c', role: '上長', kind: 'decision', text: '申請を確かめる', ref: ref('詳細', '承認待ち') },
      { key: 'd', role: '上長', kind: 'input', text: '承認する', ref: ref('詳細', '承認済み') },
      { key: 'e', role: '申請者', kind: 'task', text: '出張に行く' },
      { key: 'f', role: '経理', kind: 'task', text: '旅費を精算する', ref: ref('一覧') },
      { key: 'g', role: '経理', kind: 'doc', text: '精算書を出す' },
      { key: 'h', role: '経理', kind: 'end', text: '終わり' },
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: '承認' }, { from: 'c', to: 'b', label: '差し戻し' },
      { from: 'd', to: 'e' }, { from: 'e', to: 'f' }, { from: 'f', to: 'g' }, { from: 'g', to: 'h' }],
  });
  await page.evaluate(() => {
    const T = window.__test__;
    T.aiView.cards.clear();
    T.aiView.band = null;
    T.goHome();
  });
  await sleep(100);
  return call;
}

// ── 押す所を探す・押す ──
// sel に当たる要素のうち、文字 text を含むもの（text が null なら最初のもの）の画面の上の四角
const rectOf = (page, sel, text = null) => page.evaluate((s, t) => {
  const el = [...document.querySelectorAll(s)].find((x) => t == null || x.textContent.includes(t));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height };
}, sel, text);
async function clickAt(page, sel, text = null, opts = {}) {
  const c = await rectOf(page, sel, text);
  if (!c) throw new Error(`押す所が見つからない: ${sel} ${text || ''}`);
  await page.mouse.click(c.x, c.y, opts);
  await sleep(120);
  return c;
}
// スイムレーン図の作業の箱（文字がちょうど text のもの）
const stepBox = (page, text) => page.evaluate((t) => {
  const n = [...document.querySelectorAll('#sys-swim .mnode.sw')].find((x) => x.querySelector('b').textContent === t);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height };
}, text);
// スイムレーン図を横に動かして、作業の箱 text の左の縁を図の欄の左から left ドットの所に置く
const scrollSwimTo = (page, text, left) => page.evaluate((t, px) => {
  const box = document.querySelector('#sys-swim');
  const n = [...box.querySelectorAll('.mnode.sw')].find((x) => x.querySelector('b').textContent === t);
  box.scrollLeft += n.getBoundingClientRect().left - (box.getBoundingClientRect().left + px);
}, text, left);
// 矢印の文字（label）の付いた矢印の、押す所（文字の下地）
const edgeLabelAt = (page, label) => page.evaluate((lab) => {
  const T = window.__test__;
  const y = T.store.state.systems.find((x) => x.id === T.ui.systemId);
  const e = y.swimlane.edges.find((x) => x.label === lab);
  const r = document.querySelector(`#sys-swim .sw-edge[data-edge="${e.id}"] rect.sw-hit`).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, label);
// 開いているシステムのスイムレーンの中身（作業の帯と列・矢印「元→先（文字）」）。元に戻した後に見本のままかを比べる
const swimNow = (page) => page.evaluate(() => {
  const T = window.__test__;
  const y = T.store.state.systems.find((x) => x.id === T.ui.systemId);
  const name = (id) => (y.swimlane.steps.find((w) => w.id === id) || {}).text;
  return y.swimlane.steps.map((w) => `${w.text}@${w.roleId}:${w.col}`).join('・') + ' / '
    + y.swimlane.edges.map((e) => `${name(e.from)}→${name(e.to)}${e.label ? `（${e.label}）` : ''}`).join('・');
});
async function undo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(120);
}
// ドラッグの途中を撮る（from から to へ動かし、放す前に撮る）。放した後は元に戻し、見本のままかを確かめる
async function dragShot(page, shot, name, from, to) {
  const before = await swimNow(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await sleep(80);
  await shot(page, name);
  await page.mouse.up();
  await sleep(120);
  if ((await swimNow(page)) === before) throw new Error(`${name}: 放した後に中身が変わらない（ドラッグが効いていない）`);
  await undo(page);
  if ((await swimNow(page)) !== before) throw new Error(`${name}: 元に戻しても見本のままにならない`);
}
// 画面設計の名前から id
const idOf = (page, name) => page.evaluate((n) => window.__test__.store.state.designs.find((d) => d.name === n).id, name);
// 下の黒い帯のお知らせ（3.5 秒で消える）が消えるのを待つ（前の画面のお知らせが、次の場面に写り込まないように）
const waitToast = (page) => page.waitForFunction(() => document.querySelector('#toast').hidden, { timeout: 8000 });
const cancelDialog = async (page) => { await page.click('.modal [data-dlg="cancel"]'); await sleep(100); };

// 107〜115: 最初の画面（システムのまとまり・入れる窓・ごみ箱・新しいシステムの窓）
async function shootHome(page, shot) {
  const group = (name) => clickAt(page, '.sys-list .sys-item', name);
  await group(SYS_A);
  await shot(page, '107_システム_最初の画面（出張申請システムを選んだ）');
  await group(SYS_B);
  await shot(page, '108_システム_最初の画面（経費精算システム・共通の札）');
  await group('システムに入っていない');
  await shot(page, '109_システム_最初の画面（システムに入っていない）');
  await group(SYS_B);
  await page.click('.sys-head [data-action="sys-add-menu"]');
  await sleep(100);
  await shot(page, '110_システム_画面設計を入れるメニュー');
  await page.click('.sys-pop [data-action="sys-add-same"]');
  await page.waitForSelector('.modal .pick-card');
  await page.click(`.modal .pick-card[data-pick="${await idOf(page, '出張申請')}"]`);
  await shot(page, '111_システム_今ある画面設計を追加する窓（1つ選んだ）');
  await cancelDialog(page);
  await page.click('.sys-head [data-action="sys-add-menu"]');
  await page.click('.sys-pop [data-action="sys-add-copy"]');
  await page.waitForSelector('.modal .pick-card');
  await page.click(`.modal .pick-card[data-pick="${await idOf(page, '取引先マスタ')}"]`);
  await shot(page, '112_システム_今ある画面設計を複製して追加する窓（1つ選んだ）');
  await cancelDialog(page);
  // 113: 共通の画面設計（社員マスタ）をごみ箱へ移す確かめの窓
  const emp = await idOf(page, '社員マスタ');
  await page.click(`.sys-block .card-more[data-id="${emp}"]`);
  await page.click('.card-menu [data-action="trash"]');
  await page.waitForSelector('.modal');
  await shot(page, '113_システム_共通の画面設計をごみ箱へ移す確かめの窓');
  await cancelDialog(page);
  // 115: 新しいシステムの窓（書いて「作る」を押す。作ったシステムは、114 のためにごみ箱へ移す）
  await page.click('.sys-list [data-action="new-system"]');
  await page.waitForSelector('.modal [name=name]');
  await page.type('.modal [name=name]', '会議室予約システム');
  await page.type('.modal [name=description]', '会議室の予約と、使った後の報告をまとめる（古い案）。');
  await shot(page, '115_システム_新しいシステムの窓');
  await page.click('.modal [data-dlg="ok"]');
  await sleep(150);
  await page.click('.sys-head [data-action="sys-menu"]');
  await page.click('.sys-pop [data-action="sys-trash"]');
  await sleep(100);
  // 114: ごみ箱（システムと画面設計）
  await group('システムに入っていない');
  const old = await idOf(page, '会議室予約（古い案）');
  await page.click(`.card-more[data-id="${old}"]`);
  await page.click('.card-menu [data-action="trash"]');
  await sleep(100);
  await page.click('.trash-toggle');
  await page.evaluate(() => document.querySelector('.home-scroll').scrollTo(0, 9999));
  await sleep(100);
  await shot(page, '114_システム_ごみ箱を開いたところ（システムも入っている）');
  await page.click('.trash-toggle');
  await page.evaluate(() => document.querySelector('.home-scroll').scrollTo(0, 0));
}

// 116〜125: システムの画面のスイムレーン図（最初の倍率・100% で選ぶ・つなぐ・付け替え・ドラッグ・置き場・文字の欄）
async function shootSwimlane(page, shot) {
  await waitToast(page);
  await clickAt(page, '.sys-list .sys-item', SYS_A);
  await page.click('.sys-head [data-action="open-system"]');
  await page.waitForSelector('#sys-swim .mnode.sw');
  await sleep(200);
  await shot(page, '116_システム_スイムレーン図（最初の倍率）');
  await page.click('#toolbar [data-action="zoom-reset"]');
  await sleep(100);
  await scrollSwimTo(page, '出張申請を入力する', 70);
  await clickAt(page, '#sys-swim .mnode.sw', '承認する');
  await page.mouse.move(700, 900); // 箱から離す（箱の上では青い ○＋ が出る）
  await sleep(80);
  await shot(page, '117_システム_スイムレーン図_100%で箱を選んだ（右のパネルに作業の設定）');
  await page.keyboard.press('Escape');
  // 118・119: 箱の右の縁に近づくと出る青い ○＋ と、押した後のつなぐ途中の青い破線
  const b = await stepBox(page, '出張申請を入力する');
  await page.mouse.move(b.l + b.w + 6, b.y - 8);
  await sleep(100);
  const plus = await rectOf(page, '#swim-plus');
  if (!plus) throw new Error('青い ○＋ が出ない');
  await shot(page, '118_システム_スイムレーン図_青い○＋');
  await page.mouse.click(plus.x, plus.y);
  const e = await stepBox(page, '出張に行く');
  await page.mouse.move(e.l - 40, e.t + 50, { steps: 6 });
  await sleep(80);
  if (!(await rectOf(page, '#swim-prev .sw-guide'))) throw new Error('つなぐ途中の破線が出ない');
  await shot(page, '119_システム_スイムレーン図_つなぐ途中の青い破線');
  await page.keyboard.press('Escape');
  // 120: 接続モード（C キー → つなぐ元の箱を押す → カーソルを動かす）
  await page.keyboard.press('c');
  const c = await stepBox(page, '申請を確かめる');
  await page.mouse.click(c.x, c.y);
  await page.mouse.move(c.x + 220, c.y + 130, { steps: 6 });
  await sleep(80);
  await shot(page, '120_システム_スイムレーン図_接続モード');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  // 121・122: 矢印（承認）を選ぶ → 先の端のオレンジの ○ を「出張に行く」へ付け替える途中
  const lab = await edgeLabelAt(page, '承認');
  await page.mouse.click(lab.x, lab.y);
  await sleep(120);
  await shot(page, '121_システム_スイムレーン図_矢印を選んだ（両端のオレンジの○と右のパネル）');
  const end = await rectOf(page, '#sys-swim .sw-ends.sel .sw-end[data-end="to"]');
  await dragShot(page, shot, '122_システム_スイムレーン図_付け替えのドラッグの途中', end, { x: e.l + 30, y: e.t + 25 });
  await page.keyboard.press('Escape');
  // 123: 箱のドラッグ（「承認する」を経理の帯へ動かす途中）
  const d = await stepBox(page, '承認する');
  const f = await stepBox(page, '旅費を精算する');
  await dragShot(page, shot, '123_システム_スイムレーン図_箱のドラッグの途中', { x: d.l + 40, y: d.t + 20 }, { x: d.l + 60, y: f.t + 30 });
  // 124: 置き場の「判断」を、上長の帯の「承認する」の右の列へドラッグする途中
  const pal = await rectOf(page, '#sys-box .pal-btn[data-kind="decision"]');
  const c2 = await stepBox(page, '申請を確かめる');
  await dragShot(page, shot, '124_システム_スイムレーン図_置き場からのドラッグ', pal, { x: c2.x, y: f.y }); // 経理の帯の、申請を確かめるの下の空いた所
  // 125: 箱のダブルクリックで出る文字の欄
  const d2 = await stepBox(page, '承認する');
  await page.mouse.click(d2.x, d2.y, { count: 2 });
  await sleep(100);
  if (!(await rectOf(page, '#sys-swim .swim-edit'))) throw new Error('箱の文字の欄が出ない');
  await shot(page, '125_システム_スイムレーン図_箱の文字の欄（ダブルクリック）');
  await page.keyboard.press('Escape');
}

// 126〜132: 概要・役割・役割を消す確かめの窓・履歴（AI が直した後）・戻す確かめの窓・左のカードの「…」・編集の画面の「← システムへ」
async function shootPanels(page, shot, call) {
  await page.click('#sys-list [data-panel="overview"]');
  await shot(page, '126_システム_概要');
  await page.click('#sys-list [data-panel="roles"]');
  await shot(page, '127_システム_役割');
  await clickAt(page, '#sys-view [data-action="sys-role-del"][aria-label*="経理"]');
  await page.waitForSelector('.modal');
  await shot(page, '128_システム_役割を消す確かめの窓');
  await cancelDialog(page);
  await call('update_system', { system: SYS_A, description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。日帰りの出張も含む。',
    ops: [{ op: 'set_memo', role: '経理', memo: '経理課の旅費の担当' }] }, 's-2'); // 別の会話から直す（履歴に 2 つ目の行が残る）
  await sleep(100);
  await page.click('#sys-list [data-panel="history"]');
  await shot(page, '129_システム_履歴（AIが直した後の紫の帯と行）');
  await clickAt(page, '#sys-view [data-action="sys-rev-restore"]');
  await page.waitForSelector('.modal');
  await shot(page, '130_システム_履歴の行に戻す確かめの窓');
  await cancelDialog(page);
  const emp = await idOf(page, '社員マスタ');
  await page.hover(`#sys-list .sys-dwrap[data-id="${emp}"] .sys-dcard`);
  await page.click(`#sys-list .sys-dwrap[data-id="${emp}"] .sl-more`);
  await page.waitForSelector('#sys-menu-root .sys-dmenu');
  await shot(page, '131_システム_左のカードの「…」のメニュー');
  await page.keyboard.press('Escape');
  if (await rectOf(page, '#sys-menu-root .sys-dmenu')) await clickAt(page, '#sys-title');
  await clickAt(page, '#sys-list .sys-dcard', '出張申請');
  await page.waitForFunction(() => window.__test__.ui.view === 'editor');
  await sleep(150);
  await shot(page, '132_システム_システムの画面から開いた編集の画面（←システムへ）');
}

// 133: AI の図の画像（get_view_image の system・view "swimlane"）
async function shootSwimImage(browser, page, shot) {
  const r = await page.evaluate((s) => window.__test__.aiDispatch('get_view_image', { system: s, view: 'swimlane' }, { session: 's-1', client: 'claude-code' }), SYS_A);
  if (!r.ok) throw new Error(`get_view_image: ${JSON.stringify(r.error)}`);
  console.log('get_view_image（swimlane）:', JSON.stringify(r.result).slice(0, 400));
  const img = await browser.newPage();
  await img.setViewport({ width: r.render.width, height: r.render.height });
  await img.setContent(r.render.html, { waitUntil: 'load' });
  await shot(img, '133_システム_AIの図の画像（スイムレーン図）');
  await img.close();
}

module.exports = async function shootSystems(browser, env) {
  const { openDeskApp } = env;
  const shot = async (p, name) => { await sleep(120); await env.shot(p, name); };
  const page = await openDeskApp(browser, EMPTY);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  const call = await buildSample(page);
  await shootSwimImage(browser, page, shot); // 見本のままのスイムレーン図（後の場面で AI が直す前）
  await shootHome(page, shot);
  await page.setViewport({ width: 1600, height: 960 });
  await shootSwimlane(page, shot);
  await shootPanels(page, shot, call);
  await page.close();
};
