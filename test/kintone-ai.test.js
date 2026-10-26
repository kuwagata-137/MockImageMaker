'use strict';
// kintone の準備（第 13 段階）の AI の道具のテスト: edit_items・layout の新しい項目・テーブルの列の kintone の欄、get_design・get_catalog の kintone。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, item, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp(state ? { localStorage: { [STORAGE_KEY]: JSON.stringify(state) } } : {});
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  const it = (id, itemId) => d(id).items.find((x) => x.id === itemId || x.name === itemId);
  return { app, T, call, d, it };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };
const ops = (...list) => ({ design: 'd1', ops: list });

test('edit_items: add と update で kintone の欄を書ける。書いた欄だけを重ね、既定の種類は空にし、null で外す', async () => {
  const { app, call, it } = await boot();
  ok(await call('edit_items', ops({ op: 'add', type: 'user', name: '担当部署', kintone: { type: 'ORGANIZATION_SELECT', code: '部署' } })));
  assert.deepEqual(it('d1', '担当部署').kintone, { type: 'ORGANIZATION_SELECT', code: '部署', formula: '' });
  ok(await call('edit_items', ops({ op: 'update', item: '担当部署', kintone: { code: '担当部署' } })));
  assert.deepEqual(it('d1', '担当部署').kintone, { type: 'ORGANIZATION_SELECT', code: '担当部署', formula: '' });
  ok(await call('edit_items', ops({ op: 'update', item: '担当部署', kintone: { type: 'USER_SELECT' } })));
  assert.deepEqual(it('d1', '担当部署').kintone, { type: '', code: '担当部署', formula: '' });
  ok(await call('edit_items', ops({ op: 'update', item: '担当部署', kintone: null })));
  assert.equal('kintone' in it('d1', '担当部署'), false);
  ok(await call('edit_items', ops({ op: 'add', type: 'calc', name: '日数', kintone: { formula: '終了日 - 開始日' } })));
  assert.equal(it('d1', '日数').kintone.formula, '終了日 - 開始日');
  app.close();
});

test('edit_items: kintone の欄の断り（部品の種類で選べない種類・自動計算の値でない項目の計算式・使えないコード・ほかに書いたコードとの重なり・ステータス・知らない欄）', async () => {
  const st = sampleState();
  st.designs[0].items.push(item('st', 'ステータス', 'status', { props: { states: [{ id: 't1', name: '申請' }], actions: [] } }));
  st.designs[0].items[1].kintone = { code: '顧客名' };
  const { app, call, d } = await boot(st);
  const before = JSON.stringify(d('d1').items);
  const bad = async (kt, item = '顧客コード') => ng(await call('edit_items', ops({ op: 'update', item, kintone: kt })), 'bad_request').message;
  assert.match(await bad({ type: 'ORGANIZATION_SELECT' }), /SINGLE_LINE_TEXT・LINK・RECORD_NUMBER/);
  assert.match(await bad({ formula: 'a + b' }), /自動計算の値/);
  assert.match(await bad({ code: '1件目' }), /フィールドコードに使えません/);
  assert.match(await bad({ code: '顧客名' }), /「顧客名」と同じフィールドコード/);
  assert.match(await bad({ code: 'x' }, 'ステータス'), /プロセス管理/);
  assert.match(await bad({ name: 'x' }), /使える欄: type・code・formula/);
  assert.equal(JSON.stringify(d('d1').items), before, '断ったときは何も変えない');
  app.close();
});

test('edit_items: テーブルの列にも kintone の欄を書ける（列の props.columns[].kintone）', async () => {
  const { app, call, it } = await boot();
  ok(await call('edit_items', ops({ op: 'add', type: 'table', name: '明細', props: { columns: [
    { name: '品名', type: 'text1', kintone: { code: '品名' } },
    { name: '数量', type: 'number' },
  ] } })));
  const cols = it('d1', '明細').props.columns;
  assert.deepEqual(cols[0].kintone, { type: '', code: '品名', formula: '' });
  assert.equal('kintone' in cols[1], false);
  ok(await call('edit_items', ops({ op: 'update', item: '明細', props: { columns: [{ name: '品名' }, { name: '数量', kintone: { code: '数量' } }] } })));
  const cols2 = it('d1', '明細').props.columns;
  assert.deepEqual([cols2[0].kintone.code, cols2[1].kintone.code], ['品名', '数量'], '書かなかった列の kintone の欄は残す');
  ng(await call('edit_items', ops({ op: 'update', item: '明細', props: { columns: [{ name: '品名', kintone: { type: 'RECORD_NUMBER' } }] } })), 'bad_request');
  app.close();
});

test('layout: 新しく作る項目に kintone の欄を書ける。今ある項目に書くと、その項目の kintone の欄を直す', async () => {
  const { app, call, it } = await boot();
  ok(await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[
    { item: '登録した人', type: 'user', kintone: { type: 'CREATOR', code: '作成者' } },
    { item: '顧客名', kintone: { code: 'customer_name' } },
  ]] } }));
  assert.deepEqual(it('d1', '登録した人').kintone, { type: 'CREATOR', code: '作成者', formula: '' });
  assert.deepEqual(it('d1', '顧客名').kintone, { type: '', code: 'customer_name', formula: '' });
  ng(await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ item: '区分', kintone: { type: 'CREATOR' } }]] } }), 'bad_request');
  app.close();
});

test('入口の形: edit_items の add・update と layout の部品は kintone（{ type, code, formula } か null）を受け、kintone の知らない欄は断る', () => {
  const SC = require('../mcp-schemas');
  const ops = (o) => SC.itemOps.safeParse([o]).success;
  assert.equal(ops({ op: 'add', type: 'user', name: '担当部署', kintone: { type: 'ORGANIZATION_SELECT', code: '部署' } }), true);
  assert.equal(ops({ op: 'update', item: '日数', kintone: { formula: '終了日 - 開始日' } }), true);
  assert.equal(ops({ op: 'update', item: '日数', kintone: null }), true);
  assert.equal(ops({ op: 'update', item: '日数', kintone: { name: 'x' } }), false);
  const lay = (p) => SC.layout.safeParse({ rows: [[p]] }).success;
  assert.equal(lay({ item: '登録した人', type: 'user', kintone: { type: 'CREATOR' } }), true);
  assert.equal(lay({ item: '登録した人', kintone: { label: 'x' } }), false);
});

test('get_design: 項目とテーブルの列に、書いた kintone の欄（種類は今の部品の種類で読む種類と名前）。get_catalog: kintoneTypes', async () => {
  const st = sampleState();
  st.designs[0].items[0].kintone = { type: 'RECORD_NUMBER', code: '顧客番号' };
  st.designs[0].items.push(item('tb', '明細', 'table', { props: { columns: [{ id: 'c1', name: '品名', type: 'text1', required: false, memo: '', props: {}, kintone: { code: '品名' } }] } }));
  const { app, call } = await boot(st);
  const g = ok(await call('get_design', { design: 'd1' }));
  assert.deepEqual(g.items[0].kintone, { type: 'RECORD_NUMBER', typeName: 'レコード番号', code: '顧客番号', formula: '' });
  assert.equal('kintone' in g.items[1], false);
  assert.deepEqual(g.items[3].columns[0].kintone, { type: 'SINGLE_LINE_TEXT', typeName: '文字列（1行）', code: '品名', formula: '' });
  const c = ok(await call('get_catalog'));
  const rec = c.kintoneTypes.find((k) => k.type === 'RECORD_NUMBER');
  assert.deepEqual(rec, { type: 'RECORD_NUMBER', name: 'レコード番号', auto: true, parts: ['text1', 'number'], defaultFor: [] });
  assert.deepEqual(c.kintoneTypes.find((k) => k.type === 'SINGLE_LINE_TEXT').defaultFor, ['text1']);
  assert.equal(c.kintoneTypes.length, 23);
  app.close();
});
