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

// ── 右の欄の「kintone のフィールド」の欄（画像 q111 の案A）──
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
// 顧客管理（作る先 kintone）に、人を選ぶ欄・自動計算の値・テーブル・ステータスの項目と部品を足した見本
function kintoneState() {
  const st = sampleState();
  const d1 = st.designs[0];
  d1.items.push(
    item('iu', '担当部署', 'user', { props: { scope: '', multiple: false, initial: 'none' } }),
    item('ic', '日数', 'calc', { props: { formula: '終わりの日 − 始まりの日', unit: '日' } }),
    item('tb', '明細', 'table', { props: { columns: [{ id: 'c1', name: '品名', type: 'text1', required: false, memo: '', props: {} }] } }),
    item('st', 'ステータス', 'status', { props: { states: [{ id: 't1', name: '申請' }], actions: [] } }),
  );
  d1.screens[0].parts.push(
    { id: 'pu', type: 'user', x: 32, y: 240, w: 320, h: 64, no: 4, labelPos: 'top', sample: '', placeholder: '', itemId: 'iu' },
    { id: 'pc', type: 'calc', x: 400, y: 240, w: 200, h: 64, no: 5, labelPos: 'top', sample: '', placeholder: '', itemId: 'ic' },
    { id: 'pt', type: 'table', tableKind: 'subtable', x: 32, y: 336, w: 640, h: 168, no: 6, itemId: 'tb', view: { rows: 3, samples: {}, widths: {} } },
    { id: 'ps', type: 'status', x: 700, y: 64, w: 160, h: 32, no: 7, itemId: 'st', view: { current: 't1', showWord: true } },
  );
  return st;
}
async function selectOn(st, partId) {
  const b = await boot(st);
  b.T.openDesign('d1');
  b.T.openScreen('s1');
  b.T.selectPart(partId);
  return b;
}
const ktSel = (app) => $(app, '#side-settings select[data-pf="kintone.type"]');
const ktCode = (app) => $(app, '#side-settings input[data-pf="kintone.code"]');

test('右の欄: kintone の画面設計の項目に「kintone のフィールド」の欄（種類の選択肢は部品の種類ごと・既定に印・フィールドコードの薄い字は項目名から作ったコード）', async () => {
  const { app } = await selectOn(kintoneState(), 'pu');
  assert.ok($$(app, '#side-settings .pf-sep').some((e) => e.textContent === 'kintone のフィールド'));
  assert.deepEqual($$(app, '#side-settings select[data-pf="kintone.type"] option').map((o) => [o.value, o.textContent]), [
    ['USER_SELECT', 'ユーザー選択（既定）'], ['ORGANIZATION_SELECT', '組織選択'], ['GROUP_SELECT', 'グループ選択'],
    ['CREATOR', '作成者（自動で入る）'], ['MODIFIER', '更新者（自動で入る）'],
  ]);
  assert.equal(ktSel(app).value, 'USER_SELECT');
  assert.equal(ktCode(app).value, '');
  assert.equal(ktCode(app).placeholder, '担当部署');
  assert.equal($(app, '#side-settings [data-pf="kintone.formula"]'), null, '計算式の欄は自動計算の値だけ');
  app.close();
});

test('右の欄: kintone の種類とフィールドコードを書くと項目に入り、既定の種類を選び直すと空に戻す', async () => {
  const { app, d } = await selectOn(kintoneState(), 'pu');
  setValue(ktSel(app), 'ORGANIZATION_SELECT');
  assert.deepEqual(d('d1').items.find((x) => x.id === 'iu').kintone, { type: 'ORGANIZATION_SELECT', code: '', formula: '' });
  setValue(ktCode(app), ' 部署 ');
  assert.deepEqual(d('d1').items.find((x) => x.id === 'iu').kintone, { type: 'ORGANIZATION_SELECT', code: '部署', formula: '' });
  setValue(ktSel(app), 'USER_SELECT');
  setValue(ktCode(app), '');
  assert.equal('kintone' in d('d1').items.find((x) => x.id === 'iu'), false);
  app.close();
});

test('右の欄: 自動計算の値には kintone の計算式の欄。使えない文字・ほかの項目に書いたコードとの重なりは欄の下に赤い字で知らせる（保存は止めない）', async () => {
  const st = kintoneState();
  st.designs[0].items[1].kintone = { code: '顧客名' };
  const { app, d } = await selectOn(st, 'pc');
  setValue($(app, '#side-settings input[data-pf="kintone.formula"]'), '終了日 - 開始日');
  assert.equal(d('d1').items.find((x) => x.id === 'ic').kintone.formula, '終了日 - 開始日');
  const warn = () => $(app, '#side-settings [data-kt-warn]').textContent;
  assert.equal(warn(), '');
  setValue(ktCode(app), '日-数');
  assert.equal(d('d1').items.find((x) => x.id === 'ic').kintone.code, '日-数');
  assert.match(warn(), /使えない文字/);
  setValue(ktCode(app), '顧客名');
  assert.match(warn(), /「顧客名」と同じ/);
  app.close();
});

test('右の欄: テーブルは種類を選ばずフィールドコードだけ。選んだ列にも kintone の欄が出て、列に入る。ステータスには出さない', async () => {
  const { app, d } = await selectOn(kintoneState(), 'pt');
  assert.equal(ktSel(app), null);
  assert.ok(ktCode(app));
  click($(app, '#side-settings [data-action="tb-col"][data-id="c1"]'));
  setValue($(app, '#side-settings input[data-tb="col.kintone.code"]'), '品名コード');
  setValue($(app, '#side-settings select[data-tb="col.kintone.type"]'), 'LINK');
  assert.deepEqual(d('d1').items.find((x) => x.id === 'tb').props.columns[0].kintone, { type: 'LINK', code: '品名コード', formula: '' });
  app.close();
  const s = await selectOn(kintoneState(), 'ps');
  assert.equal($$(s.app, '#side-settings .pf-sep').some((e) => e.textContent === 'kintone のフィールド'), false);
  s.app.close();
});

test('右の欄: kintone の画面設計でないとき（作る先も見た目も kintone でない）は欄を出さない', async () => {
  const st = kintoneState();
  st.designs[0].target = 'salesforce';
  const { app } = await selectOn(st, 'pu');
  assert.equal(ktSel(app), null);
  assert.equal(ktCode(app), null);
  app.close();
});

test('kintone の画面設計: 作る先が kintone か、見た目が kintone のとき', async () => {
  const { app, T } = await boot();
  const k = (target, look) => T.isKintoneDesign({ target, look });
  assert.deepEqual([k('kintone', 'standard'), k('salesforce', 'kintone'), k('salesforce', 'salesforce'), k('その他', undefined)], [true, true, false, false]);
  app.close();
});
