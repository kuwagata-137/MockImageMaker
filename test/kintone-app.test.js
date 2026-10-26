'use strict';
// get_kintone_app（第 13 段階。q113 の案A）のテスト。画面設計を、kintone の MCP サーバーの道具（kintone-add-app・kintone-add-form-fields・
// kintone-update-form-fields・kintone-update-form-layout・kintone-update-general-settings・kintone-deploy-app）にそのまま渡せる形にして返す。
// 返事は test/kintone-mcp-shapes.js（kintone の MCP サーバーの入力の形を写したもの）と見比べる。
// 画面設計の名前は架空の業務（備品の貸し出し）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { screen, item, design, STORAGE_KEY, plain } = require('./ai-fixtures');
const KT = require('./kintone-mcp-shapes');

const part = (id, type, x, y, extra = {}) => ({ id, type, x, y, w: 320, h: 64, no: null, labelPos: 'top', sample: '', placeholder: '', ...extra });
const ip = (id, itemId, type, x, y, extra = {}) => part(id, type, x, y, { itemId, ...extra });
const col = (id, name, type, props = {}) => ({ id, name, type, required: false, memo: '', props });

// 備品の貸し出し（kintone の見た目）と、ルックアップ元の備品台帳
function lendingState() {
  const items = [
    item('i0', '貸出番号', 'text1', { kintone: { type: 'RECORD_NUMBER', code: '貸出番号' } }),
    item('i1', '備品コード', 'text1', {
      required: true,
      lookup: { db: { designId: 'd2', name: '備品台帳', free: false }, key: { itemId: 'm1', name: '備品コード' }, copies: [{ from: { itemId: 'm2', name: '備品名' }, to: { itemId: 'i2', name: '備品名' } }] },
    }),
    item('i2', '備品名', 'text1'),
    item('i3', '借りる人', 'user', { props: { scope: '', multiple: false, initial: 'me' } }),
    item('i4', '所属', 'user', { kintone: { type: 'ORGANIZATION_SELECT' } }),
    item('i5', '貸出日', 'date', { required: true, props: { initial: 'today', initialDate: '' } }),
    item('i6', '返却予定日', 'date', { props: { initial: 'date', initialDate: '2026-11-30' } }),
    item('i7', '日数', 'calc', { props: { formula: '返却予定日から貸出日を引いた日数', unit: '日' }, kintone: { formula: '(返却予定日 - 貸出日) / 86400' } }),
    item('i8', '区分', 'radio', { props: { options: ['社内', '社外'], initial: '', dir: 'h' } }),
    item('i9', '付属品', 'checkbox', { props: { options: ['充電器', 'ケース'], initial: ['充電器'], dir: 'v' } }),
    item('i10', '数量', 'number', { props: { unit: '個', min: '1', max: '10', decimals: '0', initial: '1' } }),
    item('i11', '明細', 'table', { props: { columns: [col('c1', '品名', 'text1', { maxLen: '20', initial: '' }), col('c2', '金額', 'number', { unit: '円' }), col('c3', '備考', 'text2')] } }),
    item('i12', '登録者', 'user', { kintone: { type: 'CREATOR' } }),
    item('i13', '目的', 'text2'),
    item('i14', '合計', 'calc', { props: { formula: '明細の金額の合計', unit: '' } }),
    item('st', 'ステータス', 'status', { props: {
      states: [{ id: 't1', name: '申請' }, { id: 't2', name: '承認待ち' }, { id: 't3', name: '承認済み' }],
      actions: [{ id: 'a1', name: '申請する', from: 't1', to: 't2', role: '借りる人', cond: '' }, { id: 'a2', name: '承認する', from: 't2', to: 't3', role: '管理者', cond: '' }],
    } }),
  ];
  const s1 = screen('s1', '貸出の申請', [
    part('h1', 'heading', 32, 64, { w: 400, h: 32, label: '貸出の申請' }),
    ip('p0', 'i0', 'text1', 32, 104), ip('p1', 'i1', 'text1', 480, 104),
    ip('p2', 'i2', 'text1', 32, 184),
    ip('p3', 'i3', 'user', 32, 264), ip('p4', 'i4', 'user', 480, 264),
    ip('p5', 'i5', 'date', 32, 344, { w: 200 }), ip('p6', 'i6', 'date', 480, 344, { w: 200 }),
    ip('p7', 'i7', 'calc', 32, 424, { w: 200 }), ip('p8', 'i8', 'radio', 480, 424),
    ip('p9', 'i9', 'checkbox', 32, 504, { w: 400 }), ip('p10', 'i10', 'number', 480, 504, { w: 200 }),
    part('hr', 'divider', 32, 584, { w: 336, h: 16, label: '' }),
    ip('p11', 'i11', 'table', 32, 616, { w: 640, h: 168, tableKind: 'subtable', label: '明細', view: { rows: 3 } }),
    ip('p12', 'i12', 'user', 32, 800), ip('p14', 'i14', 'calc', 480, 800, { w: 200 }),
    ip('ps', 'st', 'status', 900, 64, { w: 160, h: 32, view: { current: 't2' } }),
    part('b1', 'button', 32, 880, { w: 96, h: 40, label: '申請する', props: { style: 'primary', action: '申請して承認を待つ', to: '', designId: '', screenId: '', url: '' } }),
  ]);
  const s2 = screen('s2', '貸出の一覧', [
    part('r1', 'table', 32, 64, { w: 640, h: 168, tableKind: 'records', label: '貸出の一覧', props: { columns: [{ id: 'k1', ref: { itemId: 'i2', name: '備品名' } }], sort: '貸出日の新しい順', perPage: '20' }, view: { rows: 3 } }),
    part('g1', 'graph', 32, 264, { w: 480, h: 320, label: '月ごとの貸出', props: { chart: 'bar', byItem: 'i5', byUnit: '月', agg: 'count', aggItem: '', samples: '', unit: '' } }),
  ]);
  const s3 = screen('s3', '備品の詳細', [
    ip('q1', 'i1', 'text1', 32, 64),
    part('rel', 'table', 32, 152, { w: 640, h: 168, tableKind: 'related', label: '同じ備品の貸出', props: {
      columns: [{ id: 'k2', ref: { itemId: 'm2', name: '備品名' } }], sort: '', limit: '4',
      db: { designId: 'd2', name: '備品台帳', free: false }, cond: { from: { itemId: 'm1', name: '備品コード' }, to: { itemId: 'i1', name: '備品コード' } },
    }, view: { rows: 3 } }),
  ]);
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d1', '備品の貸し出し', 'kintone', { look: 'kintone', description: '備品を貸し出し、返ってくるまでを管理する。', items, screens: [s1, s2, s3] }),
      design('d2', '備品台帳', 'kintone', { items: [item('m1', '備品コード', 'text1', { kintone: { code: 'equipment_code' } }), item('m2', '備品名', 'text1')] }),
    ],
    systems: [],
  };
}

async function getApp(state, args = {}) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const r = plain(await T.aiDispatch('get_kintone_app', { design: 'd1', ...args }, { session: 's-1', client: 'claude-code' }));
  app.close();
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.result;
}
const valid = (schema, v, what) => {
  const r = schema.safeParse(v);
  assert.ok(r.success, `${what}: ${JSON.stringify(r.error && r.error.issues.slice(0, 3))}`);
};

test('get_kintone_app: フォームにする画面は、項目の部品がいちばん多い画面。アプリの名前と説明は kintone-add-app・kintone-update-general-settings の形', async () => {
  const r = await getApp(lendingState());
  assert.deepEqual(r.design, { id: 'd1', name: '備品の貸し出し' });
  assert.deepEqual(r.formScreen, { id: 's1', name: '貸出の申請' });
  assert.deepEqual(r.app, { name: '備品の貸し出し' });
  assert.deepEqual(r.generalSettings, { name: '備品の貸し出し', description: '備品を貸し出し、返ってくるまでを管理する。' });
  valid(KT.addApp, r.app, 'app');
  valid(KT.generalSettings, r.generalSettings, 'generalSettings');
  const r2 = await getApp(lendingState(), { screen: '備品の詳細' });
  assert.deepEqual(r2.formScreen, { id: 's3', name: '備品の詳細' });
});

test('get_kintone_app: properties は kintone-add-form-fields の形。部品の設定を写し、レコード番号・作成者などとルックアップと関連レコード一覧は入れない', async () => {
  const r = await getApp(lendingState());
  valid(KT.properties, r.properties, 'properties');
  Object.entries(r.properties).forEach(([k, v]) => assert.equal(v.code, k, 'キーはフィールドコード'));
  assert.deepEqual(Object.keys(r.properties), ['備品名', '借りる人', '所属', '貸出日', '返却予定日', '日数', '区分', '付属品', '数量', '明細', '目的', '合計']);
  const p = r.properties;
  assert.deepEqual(p['備品名'], { type: 'SINGLE_LINE_TEXT', code: '備品名', label: '備品名' });
  assert.deepEqual(p['借りる人'], { type: 'USER_SELECT', code: '借りる人', label: '借りる人', defaultValue: [{ code: 'LOGINUSER()', type: 'FUNCTION' }] });
  assert.deepEqual(p['所属'], { type: 'ORGANIZATION_SELECT', code: '所属', label: '所属' });
  assert.deepEqual(p['貸出日'], { type: 'DATE', code: '貸出日', label: '貸出日', required: true, defaultNowValue: true });
  assert.deepEqual(p['返却予定日'], { type: 'DATE', code: '返却予定日', label: '返却予定日', defaultValue: '2026-11-30' });
  assert.deepEqual(p['日数'], { type: 'CALC', code: '日数', label: '日数', expression: '(返却予定日 - 貸出日) / 86400', format: 'NUMBER', unit: '日', unitPosition: 'AFTER' });
  assert.deepEqual(p['区分'], { type: 'RADIO_BUTTON', code: '区分', label: '区分', options: { 社内: { label: '社内', index: '0' }, 社外: { label: '社外', index: '1' } }, defaultValue: '社内', align: 'HORIZONTAL' });
  assert.deepEqual(p['付属品'], { type: 'CHECK_BOX', code: '付属品', label: '付属品', options: { 充電器: { label: '充電器', index: '0' }, ケース: { label: 'ケース', index: '1' } }, defaultValue: ['充電器'], align: 'VERTICAL' });
  assert.deepEqual(p['数量'], { type: 'NUMBER', code: '数量', label: '数量', minValue: '1', maxValue: '10', displayScale: '0', defaultValue: '1', unit: '個', unitPosition: 'AFTER' });
  assert.deepEqual(p['明細'], { type: 'SUBTABLE', code: '明細', label: '明細', fields: {
    品名: { type: 'SINGLE_LINE_TEXT', code: '品名', label: '品名', maxLength: '20' },
    金額: { type: 'NUMBER', code: '金額', label: '金額', unit: '円', unitPosition: 'AFTER' },
    備考: { type: 'MULTI_LINE_TEXT', code: '備考', label: '備考' },
  } });
  assert.deepEqual(p['合計'], { type: 'CALC', code: '合計', label: '合計', expression: '', format: 'NUMBER' });
});

test('get_kintone_app: systemFields（最初からあるフィールドの直し）と needsAppId（元のアプリの ID が要るルックアップと関連レコード一覧）', async () => {
  const r = await getApp(lendingState());
  assert.deepEqual(r.systemFields, [{ type: 'RECORD_NUMBER', code: '貸出番号', label: '貸出番号' }, { type: 'CREATOR', code: '登録者', label: '登録者' }]);
  valid(KT.properties, Object.fromEntries(r.systemFields.map((f) => [f.code, f])), 'systemFields');
  assert.deepEqual(r.needsAppId.map((x) => [x.kind, x.code, x.sourceDesign]), [['lookup', '備品コード', '備品台帳'], ['related', '同じ備品の貸出', '備品台帳']]);
  const lk = r.needsAppId[0].property;
  assert.deepEqual(lk, { type: 'SINGLE_LINE_TEXT', code: '備品コード', label: '備品コード', required: true, lookup: {
    relatedApp: { app: '', code: '' }, relatedKeyField: 'equipment_code', fieldMappings: [{ field: '備品名', relatedField: '備品名' }],
    lookupPickerFields: ['equipment_code', '備品名'], filterCond: '', sort: '',
  } });
  const rel = r.needsAppId[1].property;
  assert.deepEqual(rel, { type: 'REFERENCE_TABLE', code: '同じ備品の貸出', label: '同じ備品の貸出', referenceTable: {
    relatedApp: { app: '', code: '' }, condition: { field: '備品コード', relatedField: 'equipment_code' }, filterCond: '', displayFields: ['備品名'], sort: '', size: '5',
  } });
  // 元のアプリの ID を入れれば、kintone-add-form-fields の形になる
  lk.lookup.relatedApp.app = '12';
  rel.referenceTable.relatedApp.app = '12';
  valid(KT.properties, { [lk.code]: lk, [rel.code]: rel }, 'needsAppId');
});

test('get_kintone_app: layout は kintone-update-form-layout の形。縦に重なる部品を 1 行にし、見出しはラベル・区切り線は罫線・表はテーブルの行。フォームの画面にないものは下に足す', async () => {
  const r = await getApp(lendingState());
  valid(KT.layout, r.layout, 'layout');
  const w = (n) => ({ width: String(n) });
  assert.deepEqual(r.layout.slice(0, 3), [
    { type: 'ROW', fields: [{ type: 'LABEL', label: '<b>貸出の申請</b>', size: w(400) }] },
    { type: 'ROW', fields: [{ type: 'RECORD_NUMBER', code: '貸出番号', size: w(320) }, { type: 'SINGLE_LINE_TEXT', code: '備品コード', size: w(320) }] },
    { type: 'ROW', fields: [{ type: 'SINGLE_LINE_TEXT', code: '備品名', size: w(320) }] },
  ]);
  assert.deepEqual(r.layout[7], { type: 'ROW', fields: [{ type: 'HR', size: w(336) }] });
  assert.deepEqual(r.layout[8], { type: 'SUBTABLE', code: '明細', fields: [{ type: 'SINGLE_LINE_TEXT', code: '品名' }, { type: 'NUMBER', code: '金額' }, { type: 'MULTI_LINE_TEXT', code: '備考' }] });
  assert.deepEqual(r.layout[9], { type: 'ROW', fields: [{ type: 'CREATOR', code: '登録者', size: w(320) }, { type: 'CALC', code: '合計', size: w(200) }] });
  assert.deepEqual(r.layout.slice(10), [
    { type: 'ROW', fields: [{ type: 'MULTI_LINE_TEXT', code: '目的' }] },
    { type: 'ROW', fields: [{ type: 'REFERENCE_TABLE', code: '同じ備品の貸出' }] },
  ]);
  // フィールドは、どれも layout にちょうど 1 回だけ出る
  const codes = r.layout.flatMap((row) => (row.type === 'SUBTABLE' ? [row.code] : row.fields.map((f) => f.code).filter(Boolean)));
  const all = [...Object.keys(r.properties), ...r.systemFields.map((f) => f.code), ...r.needsAppId.map((x) => x.code)];
  assert.deepEqual([...codes].sort(), [...all].sort());
});

test('get_kintone_app: howTo は kintone の MCP サーバーの道具を呼ぶ順、manualSteps は人が kintone の画面で設定すること、warnings は直してほしいこと', async () => {
  const r = await getApp(lendingState());
  const order = ['kintone-add-app', 'kintone-add-form-fields', 'kintone-update-form-fields', 'needsAppId', 'kintone-update-form-layout', 'kintone-update-general-settings', 'kintone-deploy-app', 'manualSteps'];
  const at = order.map((t) => r.howTo.findIndex((line) => line.includes(t)));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(r.howTo));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'この順に呼ぶ');
  const m = r.manualSteps.join('\n');
  assert.match(m, /プロセス管理.*申請／承認待ち／承認済み/);
  assert.match(m, /操作「承認する」＝承認待ちから承認済みへ（管理者）/);
  assert.match(m, /一覧.*「貸出の一覧」/);
  assert.match(m, /グラフ.*「月ごとの貸出」/);
  assert.match(m, /ボタン.*「申請する」/);
  assert.match(m, /アクセス権/);
  const wn = r.warnings.join('\n');
  assert.match(wn, /「合計」.*kintone の計算式が空.*明細の金額の合計/);
  assert.match(wn, /「目的」.*「貸出の申請」に置いていない/);
  assert.match(wn, /「同じ備品の貸出」.*「貸出の申請」に置いていない/);
  assert.match(wn, /「区分」.*初期値.*「社内」/);
});

test('get_kintone_app: 重なるフィールドコード・使えない文字は warnings で知らせる。kintone の画面設計でないときも返し、warnings で知らせる', async () => {
  const st = lendingState();
  st.designs[0].items[2].kintone = { code: '貸出番号' };
  st.designs[0].items[13].kintone = { code: '1件目' };
  st.designs[0].target = 'Salesforce';
  st.designs[0].look = 'salesforce';
  const r = await getApp(st);
  const wn = r.warnings.join('\n');
  assert.match(wn, /「貸出番号」と同じフィールドコード/);
  assert.match(wn, /「目的」.*使えない文字/);
  assert.match(wn, /作る先も見た目も kintone ではありません/);
});
