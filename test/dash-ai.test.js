'use strict';
// AI の道具の第 15 段階の分（レコード一覧のかんばん・グラフの種類 4 つ・カレンダー・メールの作成欄・ひな形 2 つ）のテスト。
// get_catalog・layout_screen のかんばん（同じ頼みで作る項目も laneItem に書ける）とダッシュボード・edit_parts の laneItem と sumItem・
// get_kintone_app の warnings と manualSteps・手引き（mcp-guide.js）。画面設計の名前は架空の業務（営業管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { screen, item, design, STORAGE_KEY, plain } = require('./ai-fixtures');
const { layout: layoutSchema } = require('../mcp-schemas');

const STAGES = ['見込み', '提案', '見積', '交渉', '受注'];
const ITEMS = [
  item('i1', '商談名', 'text1'), item('i2', '金額', 'number', { props: { unit: '万円', min: '', max: '', decimals: '', initial: '' } }),
  item('i3', '段階', 'status', { props: { states: STAGES.map((name, i) => ({ id: 't' + i, name })), actions: [] } }),
  item('i4', '種別', 'dropdown', { props: { options: ['新規', '既存'], initial: '' } }),
];
// 営業管理（項目 4 つ・空の画面 2 つ）
function dealState(extra = {}) {
  return { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [],
    designs: [design('d1', '営業管理', 'kintone', { items: ITEMS, screens: [screen('s1', '商談の一覧'), screen('s2', 'ホーム')], ...extra })] };
}
async function boot(state = dealState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const send = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const call = async (tool, args = {}) => {
    const r = await send(tool, args);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const parts = (sid) => plain(T.store.state.designs[0].screens.find((s) => s.id === sid).parts);
  return { app, T, send, call, parts };
}
const valid = (schema, v, what) => {
  const r = schema.safeParse(v);
  assert.ok(r.success, `${what}: ${JSON.stringify(r.error && r.error.issues.slice(0, 3))}`);
};
// 手引きの節（見出し）の中の最初の JSON の例
function guideExample(text, heading) {
  const block = text.split(heading)[1];
  assert.ok(block, `${heading} の節がある`);
  return JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}') + 2));
}
// 表示のしかたを表にしてから戻し、アプリが合わせ直した高さ（AI が置いた高さと同じはず）
function refitHeight(T, sid, id) {
  T.actions.updatePart('d1', sid, id, { props: { display: 'table' } });
  T.actions.updatePart('d1', sid, id, { props: { display: 'kanban' } });
  return T.store.state.designs[0].screens.find((s) => s.id === sid).parts.find((p) => p.id === id).h;
}

test('get_catalog: グラフの種類 8 つ・カレンダーとメールの作成欄（組・中に入れる印・props）・レコード一覧の laneItem と sumItem・ひな形 2 つ', async () => {
  const { app, call } = await boot();
  const c = await call('get_catalog');
  const by = Object.fromEntries(c.parts.map((p) => [p.type, p]));
  for (const k of ['"stacked"（積み上げ棒グラフ）', '"funnel"（じょうごグラフ）', '"gauge"（メーター）', '"metric"（大きな数字）']) assert.ok(by.graph.props.chart.includes(k), k);
  assert.ok(['target', 'series'].every((k) => by.graph.props[k]), 'メーターの目標の値・積み上げ棒の凡例');
  assert.deepEqual([[by.calendar.name, by.calendar.group, !!by.calendar.container], [by.mail.name, by.mail.group, !!by.mail.container]],
    [['カレンダー', '一覧画面用', false], ['メールの作成欄', '詳細画面用', true]]);
  assert.deepEqual(Object.keys(by.calendar.props).sort(), ['hours', 'mode', 'samples', 'today']);
  assert.deepEqual(Object.keys(by.mail.props).sort(), ['body', 'color', 'from', 'subject', 'to', 'toolbar']);
  assert.match(by.calendar.props.mode, /"month"（月/);
  assert.match(by.table.props.display, /"kanban"（かんばん/);
  assert.ok(by.table.props.laneItem && by.table.props.sumItem);
  assert.deepEqual(c.templates.filter((t) => ['crmKanban', 'crmHome'].includes(t.id)).map((t) => t.id), ['crmKanban', 'crmHome']);
  app.close();
});

test('layout_screen: 手引きのかんばんの例は、そのまま通り、レコード一覧をかんばんで置く（列に分ける項目＝段階・合計する項目＝金額・高さは中身から）', async () => {
  const { GUIDES } = require('../mcp-guide');
  const example = guideExample(GUIDES.layout.text, '## かんばんの書き方の例');
  valid(layoutSchema, example, '手引きのかんばんの例');
  const { app, T, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's1', layout: example });
  const ps = parts('s1');
  assert.deepEqual(ps.map((p) => p.type), ['heading', 'search', 'button', 'table']);
  const kb = ps[3];
  assert.deepEqual([kb.tableKind, kb.props.display, kb.props.laneItem, kb.props.sumItem, kb.props.columns.map((col) => col.ref.itemId)],
    ['records', 'kanban', 'i3', 'i2', ['i1', 'i2', 'i3']]);
  assert.deepEqual([kb.x, kb.w, kb.view.rows], [32, 1200, 4], '4 列の span 4 は 4 つの列の幅（列の幅 264 ×4＋列の間 48 ×3）');
  assert.equal(kb.h, refitHeight(T, 's1', kb.id), '高さは、アプリが右のパネルで切り替えたときと同じ');
  T.openDesign('d1');
  const lanes = [...app.document.querySelectorAll(`#stage .part[data-part-id="${kb.id}"] .pkb-lane`)].map((l) => l.querySelector('.pkb-h b').textContent);
  assert.deepEqual(lanes, STAGES, '段階の選択肢ごとの列');
  app.close();
});

test('layout_screen: かんばんの列と列に分ける項目は、同じ並べ方の後ろの行で作る項目も書ける。かんばんで laneItem を書かないと、選べる列の最初', async () => {
  const { app, call, parts, T } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's1', layout: { rows: [
    [{ type: 'table', tableKind: 'records', label: '問い合わせの一覧', props: { display: 'kanban', columns: ['件名', '状況'], laneItem: '状況' } }],
    [{ type: 'table', tableKind: 'records', label: '商談の一覧', props: { display: 'kanban', columns: ['商談名', '種別', '段階'] } }],
    [{ item: '件名', type: 'text1' }, { item: '状況', type: 'radio', props: { options: ['受付', '対応中', '完了'] } }],
  ] } });
  const d = T.store.state.designs[0];
  const id = (name) => d.items.find((it) => it.name === name).id;
  const [a, b] = parts('s1');
  assert.deepEqual([a.props.columns.map((col) => col.ref.itemId), a.props.laneItem], [[id('件名'), id('状況')], id('状況')]);
  assert.equal(b.props.laneItem, 'i4', '書かないときは、列のうち最初のステータス・ドロップダウン・ラジオボタン（種別）');
  app.close();
});

test('layout_screen: 手引きのダッシュボードの例は、そのまま通り、大きな数字 4 つ（高さ 136）・メーター・じょうご・積み上げ棒・表を並べる', async () => {
  const { GUIDES } = require('../mcp-guide');
  const example = guideExample(GUIDES.layout.text, '## ダッシュボードの書き方の例');
  valid(layoutSchema, example, '手引きのダッシュボードの例');
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: example });
  const ps = parts('s2');
  assert.deepEqual(ps.map((p) => p.type === 'graph' ? p.props.chart : p.type),
    ['metric', 'metric', 'metric', 'metric', 'gauge', 'funnel', 'stacked', 'table']);
  assert.deepEqual(ps.slice(0, 4).map((p) => [p.x, p.w, p.h]), [[32, 264, 136], [344, 264, 136], [656, 264, 136], [968, 264, 136]]);
  const [gauge, funnel, stacked, table] = ps.slice(4);
  assert.deepEqual([gauge.props.target, gauge.props.unit, stacked.props.series, stacked.w], ['5000', '万円', '新規\n既存', 576]);
  assert.equal(funnel.props.samples.split('\n').length, 5);
  assert.equal(gauge.y, ps[0].y + 136 + 24, '大きな数字の行の下に 24 ドット空ける');
  assert.deepEqual([table.view.rows, table.props.sort], [4, '完了予定日の近い順']);
  app.close();
});

test('edit_parts: レコード一覧の laneItem と sumItem を変える。列にない項目・選べない種類・レコード一覧に "tiles"・関連レコード一覧に laneItem は断る', async () => {
  const { app, T, call, send, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's1', layout: { rows: [
    [{ type: 'table', tableKind: 'records', label: '商談の一覧', props: { columns: ['商談名', '金額', '段階', '種別'] }, rows: 3 }],
    [{ type: 'table', tableKind: 'related', label: '関連', props: { db: '営業管理', columns: ['商談名'] } }],
  ] } });
  const [rec, rel] = parts('s1');
  const h0 = rec.h;
  await call('edit_parts', { design: 'd1', screen: 's1', ops: [{ op: 'update', part: rec.id, props: { display: 'kanban', laneItem: '種別', sumItem: '金額' } }] });
  let p = parts('s1')[0];
  assert.deepEqual([p.props.display, p.props.laneItem, p.props.sumItem], ['kanban', 'i4', 'i2']);
  assert.notEqual(p.h, h0, 'かんばんにすると、高さを中身に合わせる');
  await call('edit_parts', { design: 'd1', screen: 's1', ops: [{ op: 'update', part: rec.id, props: { laneItem: 'i3', sumItem: '' } }] });
  p = parts('s1')[0];
  assert.deepEqual([p.props.laneItem, p.props.sumItem], ['i3', '']);
  const ng = async (props, part = rec.id) => {
    const r = await send('edit_parts', { design: 'd1', screen: 's1', ops: [{ op: 'update', part, props }] });
    assert.equal(r.ok, false, JSON.stringify(props));
    return r.error.message;
  };
  assert.match(await ng({ laneItem: '商談名' }), /laneItem に書けるのは、ステータス・ドロップダウン・ラジオボタンの項目です（「商談名」はテキスト（1行））/);
  assert.match(await ng({ sumItem: '段階' }), /sumItem に書けるのは、数値・自動計算の項目です/);
  assert.match(await ng({ columns: ['商談名', '金額'], laneItem: '種別' }), /laneItem の「種別」は、表の列にありません。columns に「種別」を入れてください/);
  assert.match(await ng({ display: 'tiles' }), /レコード一覧の display に書ける値は "table"（表）・"kanban"（かんばん）です/);
  assert.match(await ng({ laneItem: '段階' }, rel.id), /関連レコード一覧の設定に「laneItem」という欄はありません/);
  assert.deepEqual([parts('s1')[0].props.laneItem, T.store.state.designs[0].screens[0].parts.length], ['i3', 2], '断った頼みは何も変えない');
  app.close();
});

// kintone の営業管理: 入力の画面（項目・カレンダー・メールの作成欄）・かんばんの一覧・グラフ 4 つのホーム
function kintoneState() {
  const p = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, w, h, no: null, labelPos: 'top', sample: '', placeholder: '', ...extra });
  const graph = (id, x, chart, label) => p(id, 'graph', x, 64, 264, 320, { label, props: { chart, byItem: '', byUnit: '', agg: 'sum', aggItem: '', samples: 'a, 1', unit: '', target: '', series: '' } });
  const columns = ['i1', 'i2', 'i3'].map((itemId) => ({ id: 'c-' + itemId, ref: { itemId, name: '' } }));
  const s1 = screen('s1', '商談の入力', [
    p('p1', 'text1', 32, 64, 320, 64, { itemId: 'i1' }), p('p2', 'number', 32, 152, 320, 64, { itemId: 'i2' }),
    p('p3', 'calendar', 400, 64, 800, 520, { label: '訪問の予定', props: { mode: 'month', today: '2026-10-22', hours: '8:00-18:00', samples: '' } }),
    p('p4', 'mail', 32, 600, 560, 440, { label: 'メールを作成', props: { color: 'blue', from: '', to: '', subject: '', body: '', toolbar: true } }),
  ], { height: 1100 });
  const s2 = screen('s2', '商談の一覧', [p('k1', 'table', 32, 64, 1216, 400, { tableKind: 'records', label: '商談のかんばん',
    props: { columns, sort: '', perPage: '', display: 'kanban', laneItem: 'i3', sumItem: 'i2' }, view: { rows: 3 } })]);
  const s3 = screen('s3', 'ホーム', [graph('g1', 32, 'funnel', '段階ごとの件数'), graph('g2', 344, 'gauge', '目標の達成'), graph('g3', 656, 'metric', '受注額'), graph('g4', 968, 'stacked', '月ごとの受注額')]);
  return dealState({ look: 'kintone', screens: [s1, s2, s3] });
}

test('get_kintone_app: かんばん・kintone にないグラフ・カレンダー・メールの作成欄を warnings で知らせ、manualSteps にカスタマイズの一覧・カレンダー形式・積み上げを書く', async () => {
  const { app, call } = await boot(kintoneState());
  const r = await call('get_kintone_app', { design: 'd1' });
  assert.equal(r.formScreen.name, '商談の入力');
  assert.ok(['商談名', '金額'].every((k) => k in r.properties));
  assert.ok(!Object.values(r.properties).some((f) => /訪問の予定|メールを作成/.test(f.label)), 'カレンダーとメールの作成欄はフィールドにしない');
  const warn = r.warnings.join('\n');
  assert.match(warn, /「訪問の予定」（カレンダー）は kintone のフォームのフィールドにないので、フォームに入れていません。kintone では一覧の表示形式「カレンダー形式」で作ります/);
  assert.match(warn, /「メールを作成」（メールの作成欄）は kintone のフィールドにないので、フォームに入れていません/);
  assert.match(warn, /画面「商談の一覧」の「商談のかんばん」（レコード一覧のかんばん）は、kintone の一覧の表示形式（表形式・カレンダー形式）にないので、表示形式「カスタマイズ」の一覧かプラグインで作ります/);
  for (const [label, name] of [['段階ごとの件数', 'じょうごグラフ'], ['目標の達成', 'メーター'], ['受注額', '大きな数字']]) {
    assert.match(warn, new RegExp(`グラフ「${label}」（${name}）は、kintone のグラフの種類にない`));
  }
  assert.doesNotMatch(warn, /月ごとの受注額/, '積み上げ棒は kintone の縦棒グラフの積み上げで作れる');
  const steps = r.manualSteps.join('\n');
  assert.match(steps, /一覧: 画面「商談の一覧」のレコード一覧「商談のかんばん」.*表示形式「カスタマイズ」の一覧かプラグインで作る/);
  assert.match(steps, /一覧: 画面「商談の入力」のカレンダー「訪問の予定」を、kintone のアプリの設定の「一覧」で、表示形式「カレンダー形式」の一覧として作る/);
  assert.match(steps, /グラフ「月ごとの受注額」.*縦棒グラフの表示モード「積み上げ」で作る/);
  assert.match(steps, /グラフ「段階ごとの件数」.*じょうごグラフはないので/);
  app.close();
});

test('手引き: catalog にかんばん・グラフの 4 種類・カレンダー・メールの作成欄・ひな形 2 つ、kintone にカレンダー形式とかんばん', () => {
  const { GUIDES } = require('../mcp-guide');
  for (const w of ['"kanban"', 'laneItem', 'sumItem', '"stacked"', '"funnel"', '"gauge"', '"metric"', 'calendar', 'mail', 'crmKanban', 'crmHome']) {
    assert.ok(GUIDES.catalog.text.includes(w), `catalog の手引きに ${w}`);
  }
  for (const w of ['カレンダー形式', 'かんばん', 'メールの作成欄', '積み上げ']) assert.ok(GUIDES.kintone.text.includes(w), `kintone の手引きに ${w}`);
});
