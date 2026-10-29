'use strict';
// レコード一覧のかんばん（第 15 段階。画像 q123 の案A）のテスト。表とかんばんの切り替え・列とカード・合計・高さ・右のパネル・設定一覧・見た目。
// 画面設計の名前は架空の業務（営業管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { design, item, STORAGE_KEY } = require('./ai-fixtures');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const partEl = (app, id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);
function fire(app, el, value) {
  if (value === undefined) el.checked = true;
  else el.value = value;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

const ITEMS = [
  item('i-name', '商談名', 'text1'), item('i-acct', '取引先名', 'text1'),
  item('i-amt', '金額', 'number', { props: { unit: '万円', min: '', max: '', decimals: '', initial: '' } }),
  item('i-stage', '段階', 'status', { props: { states: ['見込み', '提案', '見積', '交渉', '受注'].map((name, i) => ({ id: 't' + i, name })), actions: [] } }),
  item('i-kind', '種別', 'dropdown', { props: { options: ['新規', '既存'], initial: '' } }),
];
const COLS = ['i-name', 'i-acct', 'i-amt', 'i-stage', 'i-kind'];
const SAMPLES = {
  'c-i-name': ['照明の LED 化', '太陽光パネルの設置', '空調の入れ替え', '防犯カメラの設置'],
  'c-i-acct': ['見本物産株式会社', '株式会社サンプル商事'],
  'c-i-amt': ['220', '1,200', '480万円', 'ご相談'],
  'c-i-stage': ['見込み', '見込み', '提案', '保留'],
  'c-i-kind': ['新規', '既存', '新規'],
};

// 営業管理（項目 5 つ）の画面に、レコード一覧（列 5 つ・サンプルの行 4 つ）を 1 つ置いて開いた状態で起動する
async function bootKanban(t, cols = COLS) {
  const st = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, designs: [design('d-sales', '営業管理', 'other', { items: ITEMS })], systems: [] };
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(st) } });
  const api = await app.api();
  t.after(() => app.close());
  const did = 'd-sales';
  api.openDesign(did);
  const sid = api.currentScreen().id;
  const id = api.actions.addPart(did, sid, 'table', { x: 32, y: 56 });
  api.actions.setTableKind(did, sid, id, 'records');
  const update = (patch) => api.actions.updatePart(did, sid, id, patch);
  update({ label: '商談の一覧', props: { columns: cols.map((itemId) => ({ id: 'c-' + itemId, ref: { itemId, name: '' } })) } });
  update({ view: { rows: 4, samples: SAMPLES } });
  const part = () => api.currentScreen().parts.find((p) => p.id === id);
  const show = (display) => update({ props: { display } });
  const el = () => partEl(app, id);
  const lanes = () => [...el().querySelectorAll('.pkb-lane')].map((l) => [l.querySelector('.pkb-h b').textContent, l.querySelectorAll('.pkb-card').length]);
  return { app, api, did, sid, id, part, update, show, el, lanes };
}

test('かんばん: 表示のしかたを「かんばん」にすると、段階の選択肢ごとの列にカードを並べる。列に分ける項目は選べる列の最初。表の列とサンプル値はそのまま', async (t) => {
  const { el, part, show, lanes } = await bootKanban(t);
  const before = plain(part().props);
  assert.ok(el().querySelector('table.ptbl'), '最初は表');
  show('kanban');
  assert.equal(el().querySelector('table.ptbl'), null);
  assert.equal(el().querySelector('.plabel-text').textContent, '商談の一覧', '項目名の行は表と同じ');
  assert.equal(part().props.laneItem, 'i-stage', 'かんばんに切り替えたとき、列に分ける項目は選べる列の最初（ステータス）');
  assert.deepEqual(lanes(), [['見込み', 2], ['提案', 1], ['見積', 0], ['交渉', 0], ['受注', 0], ['（なし）', 1]], 'どの選択肢とも同じでない行は、いちばん右の「（なし）」');
  assert.deepEqual([...el().querySelectorAll('.pkb-h span')].map((s) => s.textContent).slice(0, 2), ['（2）', '（1）']);
  assert.equal(el().querySelector('.pkb-h small'), null, '合計する項目を選ぶまで合計は出さない');
  const card = el().querySelector('.pkb-card');
  assert.equal(card.querySelector('a').textContent, '照明の LED 化', '1 行目は、列に分ける項目を除いた最初の列');
  assert.deepEqual([...card.querySelectorAll('div')].map((d) => d.textContent), ['見本物産株式会社', '220 万円', '新規'], '数だけの値には単位を付ける');
  const second = el().querySelectorAll('.pkb-card')[1];
  assert.deepEqual([...second.querySelectorAll('div')].map((d) => d.textContent), ['株式会社サンプル商事', '1,200 万円', '既存']);
  const third = el().querySelectorAll('.pkb-card')[2];
  assert.equal(third.querySelectorAll('div')[1].textContent, '480万円', '単位を書いた値には付けない');
  assert.equal(third.querySelectorAll('div')[0].querySelector('.pph').textContent, '文字列', 'サンプル値がない所は、表と同じ薄い字');
  const after = plain(part().props);
  assert.deepEqual([after.display, after.laneItem], ['kanban', 'i-stage']);
  delete after.display;
  delete after.laneItem;
  assert.deepEqual(after, before, '列・並び順などは変わらない');
  show('table');
  assert.ok(el().querySelector('table.ptbl'), '表に戻せる');
  assert.equal(part().props.laneItem, 'i-stage', '表に戻しても、かんばんの設定は残す');
});

test('かんばんの合計: 合計する項目を選ぶと、列の見出しに「合計 N 単位」。数として読める値だけを足す（「1,200」の桁の区切りは数に含める）', async (t) => {
  const { el, update, show } = await bootKanban(t);
  show('kanban');
  update({ props: { sumItem: 'i-amt' } });
  assert.deepEqual([...el().querySelectorAll('.pkb-h small')].map((s) => s.textContent),
    ['合計 1,420 万円', '合計 480 万円', '合計 0 万円', '合計 0 万円', '合計 0 万円', '合計 0 万円'], '「ご相談」は足さない');
  assert.ok(el().querySelector('.pkb-lanes.sum'));
  update({ props: { sumItem: 'i-name' } });
  assert.equal(el().querySelector('.pkb-h small'), null, '数値・自動計算でない項目は合計しない');
});

test('かんばんの高さ: 列の見出し・いちばん多い列のカードの枚数・カードの行の数から決め、サンプル値・合計・列を変えたときに合わせる。表のまま列を変えても高さは戻さない', async (t) => {
  const { api, did, sid, id, part, update, show } = await bootKanban(t);
  show('kanban');
  assert.equal(part().h, 288, '項目名の行 28＋見出し 36＋カード 2 枚×（16＋4 行×20＋8）＋8 を、8 ドットに切り上げる');
  update({ props: { sumItem: 'i-amt' } });
  assert.equal(part().h, 304, '合計を出すと見出しが 54');
  update({ props: { columns: COLS.filter((x) => x !== 'i-kind').map((itemId) => ({ id: 'c-' + itemId, ref: { itemId, name: '' } })) } });
  assert.equal(part().h, 264, '列を 1 つ外すと、カードの行が 3 行');
  update({ view: { samples: { ...SAMPLES, 'c-i-stage': ['見込み', '見込み', '見込み', '提案'] } } });
  assert.equal(part().h, 344, '見込みのカードが 3 枚');
  show('table');
  assert.equal(part().h, 200, '表に戻すと表の高さ（サンプルの行 4 つ）');
  api.actions.movePart(did, sid, id, { ...part(), h: 400 });
  update({ props: { columns: COLS.map((itemId) => ({ id: 'c-' + itemId, ref: { itemId, name: '' } })) } });
  assert.equal(part().h, 400, '表のときは、列を変えても人が伸ばした高さのまま');
});

test('かんばんの列に分ける項目: ドロップダウンを選ぶと、その選択肢が列になる。選べる列がないときは薄い字で知らせる', async (t) => {
  const { el, update, show, lanes } = await bootKanban(t);
  show('kanban');
  update({ props: { laneItem: 'i-kind' } });
  assert.deepEqual(lanes(), [['新規', 2], ['既存', 1], ['（なし）', 1]]);
  assert.deepEqual([...el().querySelector('.pkb-card').querySelectorAll('div')].map((d) => d.textContent), ['見本物産株式会社', '220 万円', '見込み'], '列に分ける項目でなくなった段階は、カードの文に出す');
  update({ props: { laneItem: 'i-gone' } });
  assert.equal(lanes()[0][0], '見込み', '使えない項目を指しているときは、選べる列の最初で描く');
  update({ props: { columns: ['i-name', 'i-amt'].map((itemId) => ({ id: 'c-' + itemId, ref: { itemId, name: '' } })) } });
  assert.equal(el().querySelector('.pkb-lane'), null);
  assert.match(el().querySelector('.pkb-hint').textContent, /列に分ける項目（ステータス・ドロップダウン・ラジオボタン）を、表の列に追加してください/);
});

test('かんばんの右のパネル: レコード一覧の表示のしかたは 表・かんばん。かんばんのときだけ「列に分ける項目」「列ごとに合計する項目」を出す。設定一覧の文', async (t) => {
  const { app, api, id, part } = await bootKanban(t);
  api.selectPart(id);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  const radios = () => $$(app, '#side-settings [data-pf="props.display"]');
  assert.deepEqual(radios().map((e) => [e.value, e.checked]), [['table', true], ['kanban', false]]);
  assert.equal(side('[data-pf="props.laneItem"]'), null, '表のときは出さない');
  assert.doesNotMatch(side('#pf-out').textContent, /表示のしかた/);
  fire(app, radios()[1]);
  assert.equal(part().props.display, 'kanban');
  const opts = (key) => [...side(`[data-pf="${key}"]`).options].map((o) => [o.value, o.textContent, o.selected]);
  assert.deepEqual(opts('props.laneItem'), [['i-stage', '段階', true], ['i-kind', '種別', false]]);
  assert.deepEqual(opts('props.sumItem'), [['', '（合計しない）', true], ['i-amt', '金額', false]]);
  assert.match(side('[data-pf="props.sumItem"]').closest('label').nextElementSibling.textContent, /列は「段階」の選択肢（見込み・提案・見積・交渉・受注）/);
  fire(app, side('[data-pf="props.sumItem"]'), 'i-amt');
  assert.equal(part().props.sumItem, 'i-amt');
  const out = side('#pf-out').textContent;
  assert.match(out, /表示のしかた＝かんばん/);
  assert.match(out, /列に分ける項目＝段階/);
  assert.match(out, /合計する項目＝金額/);
});

test('レコード一覧の「列を追加する」で、ステータスの項目も選べる（かんばんの列に分けるため）', async (t) => {
  const { app, api, id } = await bootKanban(t, ['i-name', 'i-amt']);
  api.selectPart(id);
  const add = [...$(app, '#side-settings [data-tb="addCol"]').options].map((o) => o.textContent);
  assert.ok(add.includes('段階'), add.join('|'));
  assert.ok(add.includes('種別'));
});

test('かんばんのレコード一覧を関連レコード一覧にすると表で描き、高さも表の高さに戻す。設定は保存して読み直しても残る', async (t) => {
  const { app, api, did, sid, id, part, update, show } = await bootKanban(t);
  show('kanban');
  update({ props: { sumItem: 'i-amt' } });
  const st = plain(api.store.state);
  const again = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(st) } });
  const T = await again.api();
  t.after(() => again.close());
  const p = T.store.state.designs.find((d) => d.id === did).screens[0].parts.find((x) => x.id === id);
  assert.deepEqual(plain([p.props.display, p.props.laneItem, p.props.sumItem]), ['kanban', 'i-stage', 'i-amt']);
  api.actions.setTableKind(did, sid, id, 'related');
  assert.ok(partEl(app, id).querySelector('table.ptbl'));
  assert.equal(part().h, 200);
});

test('かんばんの見た目: Salesforce と kintone の形', async (t) => {
  const { api } = await bootKanban(t);
  const css = api.appStyle();
  assert.match(css, /\.look-sf \.pkb-card a\{[^}]*color:#0176d3/);
  assert.match(css, /\.look-kt \.pkb-card a\{[^}]*color:#3498db/);
  assert.match(css, /\.look-kt \.pkb-lane\{[^}]*border:1px solid #e3e7e8/);
});
