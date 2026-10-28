'use strict';
// 表の見本の値を AI が書く（第 13 段階。q114 の ⑤）のテスト。
// layout の部品と edit_parts の update に samples（{ 列名か列の id: [値, …] }）を書ける。値の数が見本の行の数より多いときは行を増やす（20 まで）。
// get_screen の表の部品は rows と samples（列名ごと）を返す。AI がレコード一覧の列を書き直しても、同じ名前の列の見本の値は残す。
// 画面設計の名前は架空の業務（顧客管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot() {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  const T = await app.api();
  const raw = async (tool, args) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const call = async (tool, args = {}) => {
    const r = await raw(tool, args);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const part = (no) => plain(T.store.state.designs[0].screens.find((s) => s.id === 's2').parts.find((p) => p.no === no));
  return { app, T, raw, call, part };
}
const tablePart = (r) => r.parts.find((p) => p.type === 'table');

test('layout: テーブルに列名でサンプル値を書くと、列の id ごとに入り、値の数に合わせて行を増やす。get_screen で列名ごとに読める', async () => {
  const { app, T, call, part } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{
    item: '明細', type: 'table', tableKind: 'subtable', props: { columns: [{ name: '品名' }, { name: '数量', type: 'number' }] },
    samples: { 品名: ['ボールペン', 'ノート', '付箋', 'ファイル'], 数量: [10, 5] },
  }]] } });
  const p = part(1);
  const cols = plain(T.store.state.designs[0].items.find((x) => x.name === '明細').props.columns);
  assert.equal(p.view.rows, 4);
  assert.equal(p.h, 200); // 項目名の行 28 ＋ 見出しと見本の 5 行 × 34 ＋ 2 を 8 の倍数に切り上げ
  assert.deepEqual(p.view.samples, { [cols[0].id]: ['ボールペン', 'ノート', '付箋', 'ファイル'], [cols[1].id]: ['10', '5'] });
  const g = await call('get_screen', { design: 'd1', screen: 's2' });
  assert.deepEqual([tablePart(g).rows, tablePart(g).samples], [4, { 品名: ['ボールペン', 'ノート', '付箋', 'ファイル'], 数量: ['10', '5'] }]);
  app.close();
});

test('edit_parts: レコード一覧にサンプル値を書ける。列を書き直しても、同じ名前の列のサンプル値は残る', async () => {
  const { app, call, part } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ type: 'table', tableKind: 'records', props: { columns: ['顧客コード', '顧客名'] } }]] } });
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', part: 1, samples: { 顧客名: ['株式会社サンプル', '見本商事'] } }] });
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', part: 1, props: { columns: ['顧客名', '区分'] } }] });
  const g = await call('get_screen', { design: 'd1', screen: 's2' });
  assert.deepEqual(tablePart(g).samples, { 顧客名: ['株式会社サンプル', '見本商事'] });
  assert.equal(part(1).view.rows, 3, '値がサンプルの行数より少ないときは、行の数を変えない');
  app.close();
});

test('samples の断り: 表でないアイテム・ない列・20 行を超える値', async () => {
  const { app, raw, call } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ type: 'table', tableKind: 'records', props: { columns: ['顧客名'] } }], [{ item: '顧客名' }]] } });
  const ng = async (op) => {
    const r = await raw('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', ...op }] });
    assert.equal(r.ok, false);
    return r.error.message;
  };
  assert.match(await ng({ part: 2, samples: { 顧客名: ['x'] } }), /表だけ/);
  assert.match(await ng({ part: 1, samples: { 住所: ['x'] } }), /「住所」という列は、この表にありません/);
  assert.match(await ng({ part: 1, samples: { 顧客名: Array.from({ length: 21 }, (_, i) => `見本${i}`) } }), /20 行まで/);
  const SC = require('../mcp-schemas');
  assert.equal(SC.layout.safeParse({ rows: [[{ type: 'table', samples: { 顧客名: ['a', 1] } }]] }).success, true);
  app.close();
});
