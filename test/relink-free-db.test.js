'use strict';
// 名前で書いた元を後でつなぐ（第 13 段階。q114 の ⑥）のテスト。
// ルックアップの元（lookup.db）と関連レコード一覧の元（props.db）を「一覧にないデータベース」（名前だけ）で書いた後に、
// ちょうど同じ名前の画面設計（ごみ箱にないもの・自分でないもの）が 1 つだけできたら、その画面設計につなぐ。
// つないだ元に、名前だけで書いた項目（探す項目・写す元の項目・列・条件の元の項目）と同じ名前の項目が 1 つだけあれば、その項目にもつなぐ。
// つないでも、つないだ側の画面設計の更新日時は変えない。画面設計の名前は架空の業務（顧客管理・会計システムなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}) => {
    const r = plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const design = (name) => T.store.state.designs.find((d) => d.name === name);
  return { app, T, call, design };
}
const addItems = (call, design, names) => call('edit_items', { design, ops: names.map((name) => ({ op: 'add', type: 'text1', name })) });

test('ルックアップ: 一覧にないデータベースの名前で書いた後に、その名前の画面設計を作るとつなぐ。元に項目を足すと、名前で書いた項目もつなぐ', async () => {
  const { app, call, design } = await boot();
  await call('edit_items', { design: 'd1', ops: [{ op: 'lookup', item: '顧客コード', lookup: { design: '会計システム', key: '取引先コード', copies: [{ from: '取引先名', to: '顧客名' }] } }] });
  const lk = () => plain(design('顧客管理').items.find((x) => x.name === '顧客コード').lookup);
  assert.deepEqual(lk().db, { designId: null, name: '会計システム', free: true });
  const at = design('顧客管理').updatedAt;

  await call('create_design', { name: '会計システム', target: 'kintone' });
  const src = design('会計システム');
  assert.deepEqual(lk().db, { designId: src.id, name: '会計システム', free: false });
  assert.equal(design('顧客管理').updatedAt, at, 'つないでも、つないだ側の更新日時は変えない');

  await addItems(call, '会計システム', ['取引先コード', '取引先名']);
  const ids = Object.fromEntries(design('会計システム').items.map((x) => [x.name, x.id]));
  assert.deepEqual(lk().key, { itemId: ids['取引先コード'], name: '取引先コード' });
  assert.deepEqual(lk().copies[0].from, { itemId: ids['取引先名'], name: '取引先名' });
  assert.equal(lk().copies[0].to.name, '顧客名');
  app.close();
});

test('関連レコード一覧: 一覧にないデータベースの名前で書いた元・列・条件の元の項目を、後から作った同じ名前の画面設計とその項目につなぐ', async () => {
  const { app, call, design } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{
    type: 'table', tableKind: 'related', props: { db: '請求管理', columns: ['請求番号', '金額'], cond: { from: '顧客コード', to: '顧客コード' } },
  }]] } });
  const pr = () => plain(design('顧客管理').screens.find((s) => s.id === 's2').parts[0].props);
  assert.equal(pr().db.free, true);

  await call('create_design', { name: '請求管理', target: 'kintone' });
  await addItems(call, '請求管理', ['請求番号', '金額', '顧客コード']);
  const src = design('請求管理');
  const ids = Object.fromEntries(src.items.map((x) => [x.name, x.id]));
  assert.deepEqual(pr().db, { designId: src.id, name: '請求管理', free: false });
  assert.deepEqual(pr().columns.map((c) => c.ref), [{ itemId: ids['請求番号'], name: '請求番号' }, { itemId: ids['金額'], name: '金額' }]);
  assert.deepEqual(pr().cond.from, { itemId: ids['顧客コード'], name: '顧客コード' });
  assert.equal(pr().cond.to.itemId, 'i1', '条件のこの画面設計の側の項目は変えない');
  app.close();
});

test('つながないとき: 同じ名前の画面設計が 2 つある・ごみ箱にある・自分の名前。読み込んだときも、同じ名前の画面設計が 1 つだけならつなぐ', async () => {
  const st = sampleState();
  st.designs[0].items[0].lookup = { db: { designId: null, name: '受注管理', free: true }, key: { itemId: null, name: '顧客名' }, copies: [] };
  st.designs[0].items[1].lookup = { db: { designId: null, name: '出張申請', free: true }, key: { itemId: null, name: '行き先' }, copies: [] };
  const { app, T, design } = await boot(st);
  const lk = (name) => plain(T.store.state.designs.find((d) => d.id === 'd1').items.find((x) => x.name === name).lookup);
  assert.deepEqual([lk('顧客コード').db, lk('顧客コード').key], [{ designId: 'd2', name: '受注管理', free: false }, { itemId: 'o1', name: '顧客名' }], '読み込んだときにつなぐ');
  assert.equal(lk('顧客名').db.free, true, 'ごみ箱にある画面設計にはつながない');
  assert.equal(design('顧客管理').updatedAt, '2026-10-01T00:00:00.000Z');

  // 元の名前を書き換えて、画面設計を書き換える操作（名前を直す）でつなぎ直す機会を作る
  const freeLookup = (name) => T.store.commit((s) => { s.designs[0].items[1].lookup = { db: { designId: null, name, free: true }, key: { itemId: null, name: '' }, copies: [] }; });
  T.actions.createDesign('経費精算', 'kintone');
  T.actions.createDesign('経費精算', 'kintone');
  freeLookup('経費精算');
  T.actions.renameDesign('d1', '顧客の管理');
  assert.equal(lk('顧客名').db.free, true, '同じ名前の画面設計が 2 つあるときは、どちらにもつながない（人が選ぶ）');

  freeLookup('顧客の管理');
  T.actions.renameDesign('d1', '顧客管理');
  T.actions.renameDesign('d1', '顧客の管理');
  assert.equal(lk('顧客名').db.free, true, '自分の名前の元にはつながない');
  app.close();
});
