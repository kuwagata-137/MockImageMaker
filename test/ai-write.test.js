'use strict';
// AI の窓口の書く道具（第 7 段階の T5）のテスト。道具ごとのうまくいく場合と、入力の誤りを断る場合。
// 断る場合（8-4）・元に戻すの決まり（8-2）・「AI が直す前の状態」の行（8-3）・打ちかけの文字（8-5）は test/ai-rules.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, item, ipart, screen, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  return { app, T, call, d };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };

test('create_design: 名前・作る先・説明で作り、最初の画面の id を返す。同じ名前は注意を添える。名前がなければ断る', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('create_design', { name: '出張申請', target: 'KINTONE', description: '出張の申請と承認。' }));
  assert.equal(r.name, '出張申請');
  assert.equal(r.target, 'kintone');
  assert.equal(r.changed, true);
  assert.equal(d(r.id).description, '出張の申請と承認。');
  assert.equal(r.firstScreen.id, d(r.id).screens[0].id);
  assert.equal(d(r.id).revisions.length, 0); // 新しい画面設計には「AI が直す前の状態」を残さない
  const same = ok(await call('create_design', { name: '顧客管理' }));
  assert.match(same.warnings[0], /同じ名前の画面設計がもうあります（d1）/);
  ng(await call('create_design', { name: '  ' }), 'bad_request');
  app.close();
});

test('update_design: 名前・作る先・説明を直す。空の名前・直す欄がないときは断る。変わらなければ changed が false', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('update_design', { design: '顧客管理', name: '顧客台帳', target: '社内のシステム', description: '' }));
  assert.equal(d('d1').name, '顧客台帳');
  assert.equal(d('d1').target, '社内のシステム');
  assert.equal(d('d1').description, '');
  assert.equal(r.updatedAt, d('d1').updatedAt);
  ng(await call('update_design', { design: 'd1', name: '' }), 'bad_request');
  ng(await call('update_design', { design: 'd1' }), 'bad_request');
  const same = ok(await call('update_design', { design: 'd1', name: '顧客台帳' }));
  assert.equal(same.changed, false);
  assert.equal(same.updatedAt, r.updatedAt);
  app.close();
});

test('edit_items: 足す（設定を検める）・直す・種類を変える・並べ替える・消す・戻す。1 回の頼みは 1 回の変更', async () => {
  const { app, T, call, d } = await boot();
  T.openDesign('d1'); // 開いている画面設計を AI が直すと、元に戻すの 1 回分として積む（8-2）
  const undo0 = T.store.undoStack.length;
  const r = ok(await call('edit_items', { design: 'd1', ops: [
    { op: 'add', name: '電話番号', type: 'text1', required: true, props: { maxLen: 13 } },
    { op: 'add', name: '連絡方法', type: 'radio', props: { options: ['電話', 'メール'], initial: 'メール', dir: 'v' } },
    { op: 'update', item: '顧客名', name: '顧客の名前', memo: '正式な名前' },
    { op: 'update', item: '区分', type: 'radio' },
    { op: 'move', item: '電話番号', before: '顧客コード' },
  ] }));
  assert.deepEqual(r.items.map((x) => [x.op, x.name]), [['add', '電話番号'], ['add', '連絡方法'], ['update', '顧客の名前'], ['update', '区分'], ['move', '電話番号']]);
  const items = d('d1').items;
  assert.deepEqual(items.map((x) => x.name), ['電話番号', '顧客コード', '顧客の名前', '区分', '連絡方法']);
  assert.deepEqual([items[0].required, items[0].props.maxLen], [true, '13']);
  assert.deepEqual(items[4].props, { options: ['電話', 'メール'], initial: 'メール', dir: 'v' });
  assert.equal(items.find((x) => x.name === '区分').type, 'radio');
  assert.equal(d('d1').screens[0].parts.find((p) => p.id === 'p3').type, 'radio'); // 置いた部品の種類も変わる
  assert.equal(T.store.undoStack.length, undo0 + 1);
  // 消すと、置いた部品は消したときの中身で残る。restore で一覧表に戻る
  ok(await call('edit_items', { design: 'd1', ops: [{ op: 'delete', item: '顧客コード' }] }));
  assert.equal(d('d1').items.some((x) => x.id === 'i1'), false);
  assert.equal(d('d1').screens[0].parts.find((p) => p.id === 'p1').label, '顧客コード');
  ok(await call('edit_items', { design: 'd1', ops: [{ op: 'restore', item: 'i1' }] }));
  assert.equal(d('d1').items.find((x) => x.id === 'i1').name, '顧客コード');
  ok(await call('edit_items', { design: 'd1', ops: [{ op: 'move', item: '顧客コード', index: 0 }] }));
  assert.equal(d('d1').items[0].name, '顧客コード');
  app.close();
});

test('edit_items: 知らない設定の欄・違う形の値・同じ名前・使えない種類は、使える欄や値を添えて断り、何も変えない', async () => {
  const { app, T, call, d } = await boot();
  const before = T.stateWithRefs(T.store.state).json;
  let e = ng(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '金額', type: 'number' }, { op: 'add', name: '備考', type: 'text2', props: { rows: 3 } }] }), 'bad_request');
  assert.match(e.message, /^ops\[1\]（add）: 「テキスト（複数行）」の設定に「rows」という欄はありません（使える欄: maxLen・initial）。$/);
  assert.equal(T.stateWithRefs(T.store.state).json, before); // ops[0] の足した項目も残らない
  e = ng(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '開始日', type: 'date', props: { initial: 'tomorrow' } }] }));
  assert.match(e.message, /"none"・"today"・"date"/);
  e = ng(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '顧客名', type: 'text1' }] }), 'same_name');
  ok(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '顧客名', type: 'text1', allowSameName: true }] }));
  assert.equal(d('d1').items.filter((x) => x.name === '顧客名').length, 2);
  ng(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '見出し', type: 'heading' }] }), 'bad_request');
  ng(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '区分', type: 'table' }] }), 'bad_request');
  ng(await call('edit_items', { design: 'd1', ops: [{ op: 'rename', item: '区分' }] }), 'bad_request');
  ng(await call('edit_items', { design: 'd1', ops: [] }), 'bad_request');
  app.close();
});

test('edit_items: テーブルの列（同じ名前の列は id を残す）・ステータスの並び', async () => {
  const { app, call, d } = await boot();
  ok(await call('edit_items', { design: 'd1', ops: [
    { op: 'add', name: '明細', type: 'table', props: { columns: [{ name: '品名' }, { name: '数量', type: 'number', required: true }] } },
    { op: 'add', name: 'ステータス', type: 'status', props: { states: ['受付', '対応中', '完了'] } },
  ] }));
  const table = d('d1').items.find((x) => x.name === '明細');
  assert.deepEqual(table.props.columns.map((c) => [c.name, c.type, c.required]), [['品名', 'text1', false], ['数量', 'number', true]]);
  const qtyId = table.props.columns[1].id;
  ok(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '明細', props: { columns: [{ name: '数量' }, { name: '単価', type: 'number', props: { unit: '円' } }] } }] }));
  const t2 = d('d1').items.find((x) => x.name === '明細');
  assert.deepEqual(t2.props.columns.map((c) => c.name), ['数量', '単価']);
  assert.equal(t2.props.columns[0].id, qtyId);
  assert.equal(t2.props.columns[1].props.unit, '円');
  assert.deepEqual(d('d1').items.find((x) => x.type === 'status').props.states, ['受付', '対応中', '完了']);
  ng(await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '状態 2', type: 'status' }] }), 'bad_request');
  app.close();
});

test('edit_items: ルックアップ（写す先を新しく作る）・取り込み・つながりを切る。取り込んだ項目は直せない', async () => {
  const st = sampleState();
  st.designs.push({ ...st.designs[2], id: 'd5', name: '取引先マスタ', trashedAt: null, items: [item('m1', '取引先コード', 'text1'), item('m2', '取引先名', 'text1'), item('m3', '住所', 'text2')] });
  const { app, call, d } = await boot(st);
  const r = ok(await call('edit_items', { design: '受注管理', ops: [
    { op: 'add', name: '取引先コード', type: 'text1' },
    { op: 'lookup', item: '取引先コード', lookup: { design: '取引先マスタ', key: '取引先コード', copies: [{ from: '取引先名', to: '取引先名', create: true }, { from: '住所', to: '住所', create: true }] } },
  ] }));
  assert.deepEqual(r.items[1].createdItems.map((x) => x.name), ['取引先名', '住所']);
  const o = d('d2');
  const key = o.items.find((x) => x.name === '取引先コード');
  assert.equal(key.lookup.db.designId, 'd5');
  assert.equal(key.lookup.key.itemId, 'm1');
  assert.deepEqual(key.lookup.copies.map((c) => [c.from.name, c.to.name]), [['取引先名', '取引先名'], ['住所', '住所']]);
  assert.equal(o.items.find((x) => x.name === '住所').type, 'text2');
  ng(await call('edit_items', { design: 'd2', ops: [{ op: 'lookup', item: '取引先コード', lookup: { design: '取引先マスタ', key: '取引先コード', copies: [{ from: '電話', to: '電話' }] } }] }), 'not_found');
  // 取り込み（つなげたまま）・取り込んだ項目は直せない・つながりを切ると直せる
  const imp = ok(await call('edit_items', { design: 'd2', ops: [{ op: 'import', from: '顧客管理', items: ['顧客コード'] }] }));
  assert.deepEqual(imp.items[0].items.map((x) => x.name), ['顧客コード']);
  assert.equal(d('d2').items.find((x) => x.name === '顧客コード').link.designId, 'd1');
  ng(await call('edit_items', { design: 'd2', ops: [{ op: 'import', from: '顧客管理', items: ['顧客コード'] }] }), 'bad_request');
  ng(await call('edit_items', { design: 'd2', ops: [{ op: 'update', item: '顧客コード', memo: 'x' }] }), 'linked');
  ok(await call('edit_items', { design: 'd2', ops: [{ op: 'unlink', item: '顧客コード' }, { op: 'update', item: '顧客コード', memo: 'こちらで直す' }] }));
  assert.equal(d('d2').items.find((x) => x.name === '顧客コード').memo, 'こちらで直す');
  ng(await call('edit_items', { design: 'd2', ops: [{ op: 'import', from: '出張申請', items: ['x'] }] }), 'trashed');
  app.close();
});

test('add_screen: ひな形・複製・機器・名前・置く位置。パソコン以外の機器にひな形は断る。layout も付けられる', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('add_screen', { design: 'd1', template: 'input', name: '新規登録 2', after: '新規登録' }));
  assert.deepEqual(d('d1').screens.map((s) => s.name), ['新規登録', '新規登録 2', '一覧']);
  assert.equal(r.screen.name, '新規登録 2');
  assert.ok(d('d1').screens[1].parts.some((p) => p.itemId === 'i1'));
  const c = ok(await call('add_screen', { design: 'd1', copyOf: '新規登録', name: '確認' }));
  assert.equal(d('d1').screens[d('d1').screens.length - 1].name, '確認');
  assert.equal(d('d1').screens.find((s) => s.id === c.screen.id).parts.length, 3);
  const p = ok(await call('add_screen', { design: 'd1', device: 'phone', name: 'スマホの入力', layout: { rows: [[{ item: '顧客コード' }], [{ item: '顧客名' }]] } }));
  assert.deepEqual([p.screen.device, p.screen.width], ['phone', 375]);
  assert.deepEqual(p.parts.map((x) => [x.item, x.x, x.y, x.w]), [['顧客コード', 32, 64, 304], ['顧客名', 32, 152, 304]]);
  ng(await call('add_screen', { design: 'd1', device: 'tablet', template: 'list' }), 'bad_request');
  ng(await call('add_screen', { design: 'd1', template: 'chart' }), 'bad_request');
  const dup = ok(await call('add_screen', { design: 'd1', name: '一覧' }));
  assert.match(dup.warnings[0], /「一覧」という画面がもうあります/);
  app.close();
});

test('edit_screen: 名前・機器・高さ・帯・一覧表の位置を直す・並べ替える・消す。最後の 1 つは消せない', async () => {
  const { app, call, d } = await boot();
  ok(await call('edit_screen', { design: 'd1', ops: [
    { op: 'update', screen: '一覧', name: '顧客の一覧', device: 'tablet', height: 1100, showHeader: false, tablePos: 'bottom' },
    { op: 'move', screen: '顧客の一覧', index: 0 },
  ] }));
  const s = d('d1').screens[0];
  assert.deepEqual([s.name, s.device, s.width, s.height, s.showHeader, s.tablePos], ['顧客の一覧', 'tablet', 768, 1104, false, 'bottom']);
  ng(await call('edit_screen', { design: 'd1', ops: [{ op: 'update', screen: '新規登録', tablePos: 'left' }] }), 'bad_request');
  ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '顧客の一覧' }] }));
  assert.deepEqual(d('d1').screens.map((x) => x.name), ['新規登録']);
  ng(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }), 'last_screen');
  app.close();
});

test('layout_screen: 2 列・span・幅の広い部品・ボタンの行（右寄せ・見た目・移る先）・項目を作る・画面を伸ばす', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('layout_screen', { design: 'd1', screen: '一覧', mode: 'replace', layout: { columns: 2, rows: [
    [{ item: '顧客コード' }, { item: '顧客名' }],
    [{ item: '住所', type: 'text2', span: 2 }],
    [{ type: 'heading', label: '取引の履歴' }],
    [{ type: 'table', label: '受注の一覧', props: { columns: ['顧客コード', '顧客名'], sort: '受注日の新しい順' }, rows: 12 }],
    { align: 'right', parts: [{ type: 'button', label: '保存', style: 'primary', to: { screen: '一覧' } }, { type: 'button', label: 'キャンセル', style: 'normal' }] },
  ] } }));
  assert.deepEqual(r.parts.map((p) => [p.type, p.item || p.label, p.x, p.y, p.w, p.h, p.no]), [
    ['text1', '顧客コード', 32, 64, 320, 64, 1], ['text1', '顧客名', 480, 64, 320, 64, 2],
    ['text2', '住所', 32, 152, 848, 120, 3], ['heading', '取引の履歴', 32, 296, 400, 32, null],
    ['table', '受注の一覧', 32, 352, 640, 472, 4], ['button', '保存', 1024, 856, 96, 40, 5], ['button', 'キャンセル', 1152, 856, 96, 40, 6],
  ]);
  assert.deepEqual(r.createdItems.map((x) => [x.name, x.type]), [['住所', 'text2']]);
  const sc = d('d1').screens[1];
  assert.ok(sc.height >= 856 + 40 + 32);
  const table = sc.parts.find((p) => p.type === 'table');
  assert.equal(table.tableKind, 'records');
  assert.deepEqual(table.props.columns.map((c) => c.ref.itemId), ['i1', 'i2']);
  const save = sc.parts.find((p) => p.label === '保存');
  assert.deepEqual(save.props, { style: 'primary', action: '「一覧」の画面へ移る' });
  assert.match(r.warnings[0], /ボタンの移る先（to）は第 8 段階/);
  app.close();
});

test('layout_screen: append は今の部品の下から置く。同じ項目を同じ画面に 2 回は断る。ステータスの印は見本の状態を選べる', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('layout_screen', { design: 'd1', screen: '新規登録', layout: { rows: [[{ type: 'status', current: '承認済み' }], [{ type: 'date', label: '契約日', labelPos: 'left', sample: '2026-10-14' }]] } }));
  assert.equal(r.parts[0].y, 152 + 64 + 24); // 今のいちばん下（新規登録の顧客名 152＋64）の下に 24
  const sc = d('d1').screens[0];
  const st = sc.parts.find((p) => p.type === 'status');
  assert.equal(st.view.current, '承認済み');
  const date = sc.parts.find((p) => p.type === 'date');
  assert.deepEqual([date.labelPos, date.sample], ['left', '2026-10-14']);
  assert.ok(d('d1').items.some((x) => x.name === '契約日' && x.type === 'date'));
  const e = ng(await call('layout_screen', { design: 'd1', screen: '新規登録', layout: { rows: [[{ item: '顧客名' }]] } }), 'duplicate_item');
  assert.match(e.message, /^rows\[0\]\[0\]: 項目「顧客名」は、この画面にもう置いてあります/);
  ng(await call('layout_screen', { design: 'd1', screen: '新規登録', layout: { rows: [[{ item: '存在しない項目' }]] } }), 'not_found');
  ng(await call('layout_screen', { design: 'd1', screen: '新規登録', layout: { rows: [[{ type: 'slider' }]] } }), 'bad_request');
  ng(await call('layout_screen', { design: 'd1', screen: '新規登録', layout: { columns: 3, rows: [[{ type: 'heading' }]] } }), 'bad_request');
  app.close();
});

test('edit_parts: 項目名（項目に書く）・ボタンの見た目・位置（画面を伸ばす）・まとめて動かす・揃える・番号・消す', async () => {
  const st = sampleState();
  st.designs[1].screens = [screen('o-s1', '受注の入力', [ipart('q1', 32, 64, 1, 'o1')])];
  const { app, call, d } = await boot(st);
  ok(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [
    { op: 'update', part: 2, label: '顧客の名前', required: true, sample: '山田商事' },
    { op: 'move', part: 'p3', y: 896 },
    { op: 'align', parts: [1, 2], how: 'hcenter' },
  ] }));
  const sc = d('d1').screens[0];
  assert.equal(d('d1').items.find((x) => x.id === 'i2').name, '顧客の名前');
  assert.equal(d('d1').items.find((x) => x.id === 'i2').required, true);
  assert.equal(sc.parts.find((p) => p.id === 'p2').sample, '山田商事');
  assert.equal(sc.parts.find((p) => p.id === 'p3').y, 896);
  assert.ok(sc.height >= 960);
  ok(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'move_by', parts: ['p1', 'p2'], dx: 16, dy: 0 }, { op: 'number', parts: [3], on: false }, { op: 'renumber' }] }));
  assert.equal(d('d1').screens[0].parts.find((p) => p.id === 'p3').no, null);
  const del = ok(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'delete', part: 1 }] }));
  assert.equal(del.parts[0].label, '顧客コード');
  assert.equal(d('d1').screens[0].callouts[0].target, null); // つないでいた吹き出しは残り、線だけ外れる
  // 取り込んだ項目の部品は、項目名を直せない
  ng(await call('edit_parts', { design: 'd2', screen: '受注の入力', ops: [{ op: 'update', part: 1, label: '名前' }] }), 'linked');
  ok(await call('edit_parts', { design: 'd2', screen: '受注の入力', ops: [{ op: 'update', part: 1, labelPos: 'left' }] }));
  ng(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'update', part: 99, label: 'x' }] }), 'not_found');
  ng(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'align', parts: [2], how: 'left' }] }), 'bad_request');
  app.close();
});

test('edit_parts: 表の中身を変える・見本の行の数・ボタンの style と to・レコード一覧の列', async () => {
  const { app, call, d } = await boot();
  ok(await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'table' }], [{ type: 'button', label: '登録' }]] } }));
  ok(await call('edit_parts', { design: 'd1', screen: '一覧', ops: [
    { op: 'update', part: 1, rows: 5, props: { columns: ['区分'], perPage: '50' } },
    { op: 'update', part: 2, style: 'normal', to: { screen: '新規登録' } },
  ] }));
  const sc = d('d1').screens[1];
  const t = sc.parts.find((p) => p.type === 'table');
  assert.equal(t.view.rows, 5);
  assert.deepEqual(t.props.columns.map((c) => c.ref.name), ['区分']);
  assert.equal(t.props.perPage, '50');
  assert.deepEqual(sc.parts.find((p) => p.type === 'button').props, { style: 'normal', action: '「新規登録」の画面へ移る' });
  ok(await call('edit_parts', { design: 'd1', screen: '一覧', ops: [{ op: 'table_kind', part: 1, kind: 'subtable' }] }));
  assert.equal(d('d1').screens[1].parts.find((p) => p.type === 'table').tableKind, 'subtable');
  assert.ok(d('d1').items.some((x) => x.type === 'table'));
  ng(await call('edit_parts', { design: 'd1', screen: '一覧', ops: [{ op: 'update', part: 2, rows: 3 }] }), 'bad_request');
  app.close();
});

test('edit_callouts: 足す（つなぐ部品の右の画面の外）・直す・動かす・消す。色と線の先は検める', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('edit_callouts', { design: 'd1', screen: '新規登録', ops: [
    { op: 'add', text: '50 文字まで。', target: 2, color: 'red', tip: 'dot' },
    { op: 'add', text: '必須。', target: 2 },
  ] }));
  const [a, b] = r.callouts;
  assert.deepEqual([a.x, a.y, a.color, a.tip, a.target.no], [1280 + 24, 152, 'red', 'dot', 2]);
  assert.deepEqual([b.x, b.y], [1304, 152 + 96]); // 同じ位置には重ねず、下へずらす
  ok(await call('edit_callouts', { design: 'd1', screen: '新規登録', ops: [
    { op: 'update', callout: a.id, text: '最大 50 文字。', target: null },
    { op: 'move', callout: a.id, x: -100, y: 20, w: 240 },
    { op: 'delete', callout: 'k1' },
  ] }));
  const cs = d('d1').screens[0].callouts;
  assert.deepEqual(cs.map((c) => c.text), ['最大 50 文字。', '必須。']);
  assert.deepEqual([cs[0].x, cs[0].y, cs[0].w, cs[0].target], [-96, 24, 240, null]);
  ng(await call('edit_callouts', { design: 'd1', screen: '新規登録', ops: [{ op: 'add', text: 'x', color: 'green' }] }), 'bad_request');
  ng(await call('edit_callouts', { design: 'd1', screen: '新規登録', ops: [{ op: 'add', text: '' }] }), 'bad_request');
  ng(await call('edit_callouts', { design: 'd1', screen: '新規登録', ops: [{ op: 'delete', callout: 'k9' }] }), 'not_found');
  app.close();
});

test('add_revision と restore_revision: 版の番号を返す。戻すと「戻す前の状態」が残り、「AI が直す前の状態」は足さない', async () => {
  const { app, call, d } = await boot();
  const r1 = ok(await call('add_revision', { design: 'd1', note: '最初の版' }));
  assert.deepEqual([r1.revision.no, r1.revision.title], [1, '第 1 版']);
  assert.equal(d('d1').revisions.filter((x) => x.kind === 'ai').length, 0); // 改訂するだけでは中身は変わらない
  ok(await call('update_design', { design: 'd1', description: '直した説明' }));
  assert.equal(d('d1').revisions.filter((x) => x.kind === 'ai').length, 1);
  const back = ok(await call('restore_revision', { design: 'd1', revision: '第 1 版' }));
  assert.equal(back.restored.title, '第 1 版');
  assert.equal(back.beforeRow.title, '戻す前の状態');
  assert.equal(d('d1').description, '取引先と顧客の連絡先を管理する。');
  assert.equal(d('d1').revisions.filter((x) => x.kind === 'ai').length, 1);
  ng(await call('restore_revision', { design: 'd1', revision: 5 }), 'not_found');
  app.close();
});
