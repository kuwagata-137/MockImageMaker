'use strict';
// 関連レコード一覧の表示のしかた（第 14 段階。画像 q117 の案A）のテスト。表と並べて表示の切り替え・見た目・高さ・右のパネル・設定一覧。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const partEl = (app, id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);
function check(app, el) {
  el.checked = true;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

// 関連レコード一覧（一覧にないデータベース「問い合わせ」。列 4 つ・サンプルの行 3 つ）を 1 つ置いた画面設計を開いた状態で起動する
async function bootRelated(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const did = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(did);
  const sid = api.currentScreen().id;
  const id = api.actions.addPart(did, sid, 'table', { x: 32, y: 56 });
  api.actions.setTableKind(did, sid, id, 'related');
  const cols = [['c1', '問い合わせ番号'], ['c2', '件名'], ['c3', '状況'], ['c4', '受付日']];
  api.actions.updatePart(did, sid, id, { label: 'この顧客の問い合わせ', props: {
    db: { designId: null, name: '問い合わせ', free: true },
    columns: cols.map(([cid, name]) => ({ id: cid, ref: { itemId: null, name } })),
  } });
  api.actions.updatePart(did, sid, id, { view: { rows: 3, samples: { c1: ['00002934', '00002811'], c2: ['エアコンが冷えない', 'リモコンの交換'], c3: ['対応中'], c4: ['2026-10-20'] } } });
  const part = () => api.currentScreen().parts.find((p) => p.id === id);
  const show = (display) => api.actions.updatePart(did, sid, id, { props: { display } });
  return { app, api, did, sid, id, part, show };
}

test('関連レコード一覧: 表示のしかたを「並べて表示」にすると、同じアイテムが 1 件ずつ並べる形に変わる。元のデータベース・条件・列はそのまま残る', async (t) => {
  const { app, id, part, show } = await bootRelated(t);
  const before = plain(part().props);
  assert.ok(partEl(app, id).querySelector('table.ptbl'), '最初は表');
  show('tiles');
  const el = partEl(app, id);
  assert.equal(el.querySelector('table.ptbl'), null);
  const head = el.querySelector('.ptiles .pfr-head');
  assert.equal(head.querySelector('b').textContent, 'この顧客の問い合わせ');
  assert.equal(head.querySelector('.ptl-cnt').textContent, '（3）', '件数はサンプルの行数');
  assert.equal(head.querySelector('.ptl-new').textContent, '新規');
  assert.ok(head.querySelector('.pfr-ic.fc-orange svg'), '最初のアイコンの色は橙');
  const recs = $$(app, '#stage .ptl-rec');
  assert.equal(recs.length, 3);
  assert.equal(recs[0].querySelector('a').textContent, '00002934', '1 列目の値はリンクの色で出す');
  assert.deepEqual([...recs[0].querySelectorAll('.ptl-kv')].map((k) => [k.querySelector('small').textContent, k.querySelector('span').textContent]),
    [['件名:', 'エアコンが冷えない'], ['状況:', '対応中'], ['受付日:', '2026-10-20']]);
  assert.equal(recs[2].querySelector('a').textContent, '文字列', 'サンプル値がない所は、表と同じ薄い字');
  assert.equal(el.querySelector('.ptl-foot').textContent, 'すべて表示');
  const after = plain(part().props);
  assert.equal(after.display, 'tiles');
  delete after.display;
  assert.deepEqual(after, before, '元のデータベース・条件・列は変わらない');
  show('table');
  assert.ok(partEl(app, id).querySelector('table.ptbl'), '表に戻せる');
});

test('関連レコード一覧の並べて表示: 高さは件数と列の数から決め、表示のしかたとサンプルの行数を変えたときに合わせる', async (t) => {
  const { api, did, sid, id, part, show } = await bootRelated(t);
  const tableH = part().h;
  show('tiles');
  assert.equal(part().h, 376, '見出し 44・1 件ごとに 16＋列 4 つ×20・下の「すべて表示」36 を、8 ドットに切り上げる');
  api.actions.updatePart(did, sid, id, { view: { rows: 2 } });
  assert.equal(part().h, 280);
  show('table');
  assert.equal(part().h, 136, '表に戻すと、表の高さ');
  assert.ok(tableH > 0);
});

test('関連レコード一覧の右のパネル: 「表示のしかた」を元のデータベースの上に出す。並べて表示のときだけアイコンの色を出す。設定一覧に出る文', async (t) => {
  const { app, api, did, sid, id, part } = await bootRelated(t);
  api.selectPart(id);
  const radios = () => $$(app, '#side-settings [data-pf="props.display"]');
  assert.deepEqual(radios().map((e) => [e.value, e.checked]), [['table', true], ['tiles', false]]);
  const order = $$(app, '#side-settings [data-pf="props.display"], #side-settings [data-tb="db"]').map((e) => e.dataset.pf || e.dataset.tb);
  assert.deepEqual(order, ['props.display', 'props.display', 'db'], '表示のしかたは、元のデータベースの上');
  assert.equal($(app, '#side-settings [data-pf="props.color"]'), null, '表のときはアイコンの色を出さない');
  assert.doesNotMatch($(app, '#pf-out').textContent, /表示のしかた/);
  check(app, radios()[1]);
  assert.equal(part().props.display, 'tiles');
  const green = $$(app, '#side-settings [data-pf="props.color"]').find((e) => e.value === 'green');
  check(app, green);
  assert.equal(part().props.color, 'green');
  assert.match($(app, '#pf-out').textContent, /表示のしかた＝並べて表示/);
  api.actions.setTableKind(did, sid, id, 'records');
  api.selectPart(null);
  api.selectPart(id);
  assert.equal(radios().length, 0, 'レコード一覧には表示のしかたを出さない');
  assert.ok(partEl(app, id).querySelector('table.ptbl'), 'レコード一覧は表で描く');
});

test('関連レコード一覧の並べて表示の見た目: Salesforce と kintone の形', async (t) => {
  const { api } = await bootRelated(t);
  const css = api.appStyle();
  assert.match(css, /\.look-sf \.ptl-rec a\{[^}]*color:#0176d3/);
  assert.match(css, /\.look-kt \.ptl-rec a\{[^}]*color:#3498db/);
});
