'use strict';
// kintone の準備（第 13 段階。業務アプリの見た目とCRM_設計書.md の 6 章・画像 q111〜q114）のテスト。
// 項目とテーブルの列の kintone のフィールドの情報（kintone の種類・フィールドコード・kintone の計算式）の持ち方、
// 右の欄の「kintone のフィールド」の欄、kintone の種類での描き分け、部品の設定の一覧表の行。
// 画面設計の名前は架空の業務（備品の貸し出し・顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, item, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp(state ? { localStorage: { [STORAGE_KEY]: JSON.stringify(state) } } : {});
  const T = await app.api();
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  return { app, T, d };
}

test('kintone の種類の選択肢は部品の種類ごとに決まり、先頭が既定（自動で入る種類には印がある）', async () => {
  const { app, T } = await boot();
  const ids = (type) => plain(T.kintoneChoices(type)).map((k) => k.id);
  assert.deepEqual(ids('text1'), ['SINGLE_LINE_TEXT', 'LINK', 'RECORD_NUMBER']);
  assert.deepEqual(ids('text2'), ['MULTI_LINE_TEXT', 'RICH_TEXT']);
  assert.deepEqual(ids('number'), ['NUMBER', 'RECORD_NUMBER']);
  assert.deepEqual(ids('calc'), ['CALC', 'SINGLE_LINE_TEXT']);
  assert.deepEqual(ids('date'), ['DATE']);
  assert.deepEqual(ids('datetime'), ['DATETIME', 'TIME', 'CREATED_TIME', 'UPDATED_TIME']);
  assert.deepEqual(ids('dropdown'), ['DROP_DOWN']);
  assert.deepEqual(ids('radio'), ['RADIO_BUTTON']);
  assert.deepEqual(ids('checkbox'), ['CHECK_BOX', 'MULTI_SELECT']);
  assert.deepEqual(ids('user'), ['USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT', 'CREATOR', 'MODIFIER']);
  assert.deepEqual(ids('file'), ['FILE']);
  assert.deepEqual(ids('table'), ['SUBTABLE']);
  assert.deepEqual(ids('status'), [], 'ステータスは kintone ではプロセス管理で作るので、選択肢はない');
  assert.deepEqual(ids('button'), []);
  const auto = plain(T.kintoneChoices('user')).filter((k) => k.auto).map((k) => k.name);
  assert.deepEqual(auto, ['作成者', '更新者']);
  assert.equal(plain(T.kintoneChoices('user'))[1].name, '組織選択');
  app.close();
});

test('項目とテーブルの列の kintone の欄は、文字でない値を空にして前後の空白を取り、3 つとも空なら持たない（標準の出力の埋め込みを変えないため）。知らない欄は残す', async () => {
  const st = sampleState();
  const items = st.designs[0].items;
  items[0].kintone = { type: 'RECORD_NUMBER', code: ' 顧客番号 ', formula: '', extra: 1 };
  items[1].kintone = { type: '', code: '', formula: '' };
  items[2].kintone = { type: 3, code: null };
  items.push(item('tb', '明細', 'table', { props: { columns: [
    { id: 'c1', name: '品名', type: 'text1', required: false, memo: '', props: {}, kintone: { code: '品名コード' } },
    { id: 'c2', name: '数量', type: 'number', required: false, memo: '', props: {}, kintone: {} },
  ] } }));
  const { app, d } = await boot(st);
  const it = d('d1').items;
  assert.deepEqual(it[0].kintone, { type: 'RECORD_NUMBER', code: '顧客番号', formula: '', extra: 1 });
  assert.equal('kintone' in it[1], false);
  assert.equal('kintone' in it[2], false);
  assert.deepEqual(it[3].props.columns[0].kintone, { type: '', code: '品名コード', formula: '' });
  assert.equal('kintone' in it[3].props.columns[1], false);
  app.close();
});

test('選んでいる kintone の種類は、部品の種類の選択肢にないとき既定に戻して読む（データは消さない）', async () => {
  const st = sampleState();
  st.designs[0].items[0].kintone = { type: 'ORGANIZATION_SELECT', code: '', formula: '' };
  const { app, T, d } = await boot(st);
  const it = T.store.state.designs[0].items[0];
  assert.equal(T.kintoneTypeOf(it), 'SINGLE_LINE_TEXT');
  assert.equal(d('d1').items[0].kintone.type, 'ORGANIZATION_SELECT');
  assert.equal(T.kintoneTypeOf(T.store.state.designs[0].items[2]), 'DROP_DOWN', '欄がない項目は既定');
  app.close();
});

test('項目名から作るフィールドコード: 文字と数字と _ のほかは _ にし、数字で始まるときは頭に _、128 字まで', async () => {
  const { app, T } = await boot();
  assert.equal(T.kintoneCodeOf('貸し出し日数'), '貸し出し日数');
  assert.equal(T.kintoneCodeOf('数量（個）'), '数量_個_');
  assert.equal(T.kintoneCodeOf('E-mail アドレス'), 'E_mail_アドレス');
  assert.equal(T.kintoneCodeOf('2026年度の予算'), '_2026年度の予算');
  assert.equal(T.kintoneCodeOf('・'), '_');
  assert.equal(T.kintoneCodeOf('あ'.repeat(200)).length, 128);
  assert.equal(T.kintoneCodeOk('貸出日数'), true);
  assert.equal(T.kintoneCodeOk('1件目'), false);
  assert.equal(T.kintoneCodeOk('数量-個'), false);
  assert.equal(T.kintoneCodeOk(''), false);
  app.close();
});

test('画面設計のフィールドコードの一覧: 書いたコードはそのまま、書いていない項目は項目名から作り、重なるときは _2・_3 を付ける（テーブルの列も同じアプリの中で数える）', async () => {
  const st = sampleState();
  const items = st.designs[0].items;
  items[0].kintone = { type: '', code: '顧客名', formula: '' };
  items.push(item('tb', '明細', 'table', { props: { columns: [
    { id: 'c1', name: '顧客名', type: 'text1', required: false, memo: '', props: {} },
    { id: 'c2', name: '区分', type: 'text1', required: false, memo: '', props: {}, kintone: { code: '区分' } },
  ] } }));
  items.push(item('st', 'ステータス', 'status', { props: { states: [{ id: 't1', name: '申請' }], actions: [] } }));
  const { app, T } = await boot(st);
  const codes = plain(T.kintoneCodes(T.store.state.designs[0]));
  assert.deepEqual(codes, { i1: '顧客名', i2: '顧客名_2', i3: '区分_2', tb: '明細', c1: '顧客名_3', c2: '区分' },
    '書いたコードを先に取り、作るコードはそれと重ならないようにする。ステータスは数えない');
  app.close();
});

test('kintone の画面設計: 作る先が kintone か、見た目が kintone のとき', async () => {
  const { app, T } = await boot();
  const k = (target, look) => T.isKintoneDesign({ target, look });
  assert.deepEqual([k('kintone', 'standard'), k('salesforce', 'kintone'), k('salesforce', 'salesforce'), k('その他', undefined)], [true, true, false, false]);
  app.close();
});
