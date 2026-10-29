'use strict';
// ひな形「商談のかんばん」「ホームのダッシュボード」（第 15 段階。画像 q127）と「画面を追加する」のウィンドウの小さな絵のテスト。
// 並び・番号・サンプルの項目・項目があるときの列・見た目ごとのずらし。画面設計の名前は架空の業務（営業管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rect = (p) => [p.x, p.y, p.w, p.h];
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];

async function boot(t, name, look = 'standard') {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign(name, 'salesforce', { look });
  api.openDesign(id);
  const design = () => api.store.state.designs.find((d) => d.id === id);
  const add = (tpl) => {
    const sid = api.actions.addScreen(id, tpl, design().screens[0].id);
    return design().screens.find((s) => s.id === sid);
  };
  const nameOf = (itemId) => (design().items.find((it) => it.id === itemId) || {}).name;
  const addItem = (type, label, props) => {
    const iid = api.actions.addItem(id, type);
    api.actions.updateItem(id, iid, { label, ...(props ? { props } : {}) });
    return iid;
  };
  return { app, api, id, design, add, nameOf, addItem };
}
function assertNoOverlap(sc) {
  sc.parts.forEach((a, i) => sc.parts.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${a.type}（${a.no}）と ${b.type}（${b.no}）が重なる`)));
  assert.ok(sc.parts.every((p) => p.y + p.h <= sc.height), 'アイテムは画面からはみ出さない');
}
const colNames = (p, nameOf) => p.props.columns.map((c) => nameOf(c.ref.itemId));
const samplesOf = (p, i) => p.view.samples[p.props.columns[i].id] || [];

test('ひな形: 「商談のかんばん」「ホームのダッシュボード」を、問い合わせ対応の 3 列の後ろに追加した', async (t) => {
  const { api } = await boot(t, '営業管理');
  assert.deepEqual(plain(api.SCREEN_TEMPLATES.filter((x) => ['crmKanban', 'crmHome'].includes(x.id)).map((x) => [x.id, x.name, x.note])), [
    ['crmKanban', '商談のかんばん', '検索欄・新規のボタン・かんばん'], ['crmHome', 'ホームのダッシュボード', '大きな数字 4 つ・グラフ 3 つ・表']]);
});

test('商談のかんばん: 項目がなければサンプルの項目 5 つ（段階はステータス）を追加し、番号のない見出し・検索欄・新規のボタン・かんばんを画像の位置に置く', async (t) => {
  const { app, api, design, add, nameOf } = await boot(t, '営業管理');
  const sc = add('crmKanban');
  assert.deepEqual(plain(design().items.map((it) => [it.type, it.name])), [['text1', '商談名'], ['text1', '取引先名'], ['number', '金額'], ['date', '完了予定日'], ['status', '段階']]);
  assert.deepEqual(plain(design().items.find((it) => it.name === '段階').props.states.map((s) => s.name)), ['見込み', '提案', '見積', '交渉', '受注']);
  assert.equal(design().items.find((it) => it.name === '金額').props.unit, '万円');
  assert.deepEqual(plain(sc.parts.map((p) => [p.no, p.type === 'table' ? `${p.tableKind}:${p.props.display}` : p.type, p.label])), [
    [null, 'heading', 'すべての商談'], [1, 'search', ''], [2, 'button', '新規'], [3, 'records:kanban', '商談の一覧']]);
  const [head, search, btn, kb] = sc.parts;
  assert.deepEqual(plain([rect(head), rect(search), rect(btn)]), [[32, 56, 400, 32], [816, 56, 304, 40], [1152, 56, 96, 40]]);
  assert.equal(search.placeholder, '商談名・取引先名で検索');
  assert.deepEqual(plain(search.props.items.map(nameOf)), ['商談名', '取引先名']);
  assert.equal(btn.props.style, 'normal');
  assert.deepEqual(plain(rect(kb)), [32, 112, 1216, 408], '幅いっぱい。高さは中身（見込みのカード 3 枚・カード 4 行・合計あり）から');
  assert.deepEqual(plain(colNames(kb, nameOf)), ['商談名', '取引先名', '金額', '完了予定日', '段階']);
  assert.deepEqual(plain([nameOf(kb.props.laneItem), nameOf(kb.props.sumItem)]), ['段階', '金額']);
  assert.equal(kb.view.rows, 9);
  assert.deepEqual(plain(samplesOf(kb, 4)), ['提案', '交渉', '見込み', '見積', '受注', '見込み', '提案', '見積', '見込み']);
  api.openScreen(sc.id);
  const el = $$(app, '#stage .screen .part').find((e) => e.dataset.partId === kb.id);
  assert.deepEqual([...el.querySelectorAll('.pkb-h b')].map((b) => b.textContent), ['見込み', '提案', '見積', '交渉', '受注']);
  assert.equal(el.querySelector('.pkb-h small').textContent, '合計 2,060 万円');
  assertNoOverlap(sc);
});

test('ホームのダッシュボード: 見出し・大きな数字 4 つ（4 列）・メーター・じょうご・積み上げ棒（3 列）・完了予定日の近い商談の表を、画像の番号の順に置く', async (t) => {
  const { design, add, nameOf } = await boot(t, '営業管理');
  const sc = add('crmHome');
  assert.equal(design().items.length, 5);
  assert.deepEqual(plain(sc.parts.map((p) => [p.no, p.type === 'graph' ? `graph:${p.props.chart}` : p.type === 'table' ? `${p.tableKind}:${p.props.display || 'table'}` : p.type, p.label])), [
    [null, 'heading', '営業のダッシュボード'],
    [1, 'graph:metric', '今月の受注額'], [2, 'graph:metric', '進行中の商談'], [3, 'graph:metric', '受注率'], [4, 'graph:metric', '未対応の問い合わせ'],
    [5, 'graph:gauge', '今期の目標の達成'], [6, 'graph:funnel', '段階ごとの商談の件数'], [7, 'graph:stacked', '月ごとの受注額'],
    [8, 'records:table', '完了予定日の近い商談'],
  ]);
  const graphs = sc.parts.filter((p) => p.type === 'graph');
  assert.deepEqual(plain(graphs.slice(0, 4).map(rect)), [[32, 104, 264, 136], [344, 104, 264, 136], [656, 104, 264, 136], [968, 104, 264, 136]]);
  assert.deepEqual(plain(graphs.slice(4).map(rect)), [[32, 264, 368, 320], [448, 264, 368, 320], [864, 264, 368, 320]]);
  assert.deepEqual(plain(graphs.slice(0, 4).map((g) => [g.props.samples, g.props.unit])), [['今月の受注額, 1280', '万円'], ['進行中の商談, 24', '件'], ['受注率, 32', '%'], ['未対応の問い合わせ, 7', '件']]);
  assert.deepEqual(plain([graphs[0].props.agg, nameOf(graphs[0].props.aggItem), graphs[1].props.agg]), ['sum', '金額', 'count']);
  assert.deepEqual(plain([graphs[4].props.target, graphs[6].props.series, nameOf(graphs[6].props.byItem)]), ['5,000', '新規\n既存', '完了予定日']);
  const table = sc.parts[8];
  assert.deepEqual(plain(rect(table)), [32, 608, 1216, 200]);
  assert.equal(table.props.sort, '完了予定日の近い順');
  assert.deepEqual(plain(samplesOf(table, 0)), ['給湯器の交換', '換気設備の点検', '保守の契約の更新', '床暖房の工事'], '完了予定日の近い 4 件');
  assert.ok(sc.height >= 840, '表の下まで画面を伸ばす');
  assertNoOverlap(sc);
});

test('商談のかんばん: 項目があればサンプルの項目は作らず、入力の項目の最初の 4 つを列にし、ドロップダウンで列に分ける。サンプル値は列に分ける列だけ', async (t) => {
  const { design, add, nameOf, addItem } = await boot(t, '営業管理');
  addItem('text1', '案件名');
  addItem('dropdown', '確度', { options: ['高', '中', '低'], initial: '' });
  addItem('number', '見込み額', { unit: '円', min: '', max: '', decimals: '', initial: '' });
  addItem('text1', '担当');
  addItem('text1', 'メモ');
  const sc = add('crmKanban');
  assert.equal(design().items.length, 5, '項目は増えない');
  const kb = sc.parts.find((p) => p.type === 'table');
  assert.deepEqual(plain(colNames(kb, nameOf)), ['案件名', '確度', '見込み額', '担当']);
  assert.deepEqual(plain([nameOf(kb.props.laneItem), nameOf(kb.props.sumItem)]), ['確度', '見込み額']);
  assert.deepEqual(plain(samplesOf(kb, 1)), ['高', '中', '低', '高', '中', '低', '高', '中', '低']);
  assert.deepEqual(plain(samplesOf(kb, 0)), []);
  assert.deepEqual(plain(sc.parts.find((p) => p.type === 'search').props.items.map(nameOf)), ['案件名', '担当']);
});

test('商談のかんばん: ステータスの項目があればそれで列に分ける。選択肢のある項目がなければ、サンプルの「段階」（ステータス）だけを追加する', async (t) => {
  const { design, add, nameOf, addItem } = await boot(t, '営業管理');
  addItem('text1', '案件名');
  addItem('date', '締め切り');
  const sc = add('crmKanban');
  assert.deepEqual(plain(design().items.map((it) => [it.type, it.name])), [['text1', '案件名'], ['date', '締め切り'], ['status', '段階']]);
  const kb = sc.parts.find((p) => p.type === 'table');
  assert.deepEqual(plain(colNames(kb, nameOf)), ['案件名', '締め切り', '段階']);
  assert.equal(kb.props.sumItem, '', '数値・自動計算の項目がなければ合計しない');
  const again = add('crmKanban');
  assert.equal(design().items.filter((it) => it.type === 'status').length, 1, 'ステータスは画面設計に 1 つだけ');
  assert.equal(nameOf(again.parts.find((p) => p.type === 'table').props.laneItem), '段階');
});

test('ひな形 2 つを続けて追加すると、2 つ目は 1 つ目が追加した項目を使い（項目は 5 つのまま）、同じ名前の列には商談のサンプル値を入れる', async (t) => {
  const { design, add, nameOf } = await boot(t, '営業管理');
  add('crmKanban');
  const sc = add('crmHome');
  assert.equal(design().items.length, 5);
  const table = sc.parts[8];
  assert.deepEqual(plain(colNames(table, nameOf)), ['商談名', '取引先名', '金額', '完了予定日', '段階']);
  assert.deepEqual(plain(samplesOf(table, 0)), ['給湯器の交換', '換気設備の点検', '保守の契約の更新', '床暖房の工事']);
  assert.deepEqual(plain(samplesOf(table, 4)), ['受注', '提案', '交渉', '見積']);
  assert.equal(nameOf(sc.parts[1].props.aggItem), '金額', 'グラフの集計も同じ名前の項目を指す');
});

test('Salesforce と kintone の見た目では、ヘッダーの高さの差（48）だけ下へずらす', async (t) => {
  const { add } = await boot(t, '営業管理', 'salesforce');
  const kb = add('crmKanban');
  assert.deepEqual(plain(kb.parts.map((p) => p.y)), [104, 104, 104, 160]);
  const home = add('crmHome');
  assert.deepEqual(plain([home.parts[1].y, home.parts[5].y, home.parts[8].y]), [152, 312, 656]);
  assertNoOverlap(kb);
  assertNoOverlap(home);
});

test('「画面を追加する」のウィンドウ: ひな形の小さな絵の枠は高さ 88（1280×800 でウィンドウ全体が見えるように。q127）', async (t) => {
  const { app, api } = await boot(t, '営業管理');
  assert.match(api.appStyle(), /\.tpl \.th\{height:88px;/);
  api.runCommand('addScreen');
  const cards = $$(app, '.modal .tpl');
  assert.equal(cards.length, 14);
  const th = cards.find((c) => c.dataset.tpl === 'crmKanban').querySelector('.thumb');
  assert.match(th.getAttribute('style'), /width:\d+px;height:\d+px/);
  const [w, h] = th.getAttribute('style').match(/\d+/g).map(Number);
  assert.ok(w <= 150 && h <= 80, `小さな絵は 150×80 に収める（${w}×${h}）`);
});
