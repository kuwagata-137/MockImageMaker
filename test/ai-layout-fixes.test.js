'use strict';
// AI の並べ方の使いにくさの直し（第 13 段階。q114 の ②③④・画像 q114）のテスト。
// ② AI が並べたボタン: 幅を文字から決め（全角 15・半角 9 で数え、左右に 16 ずつ足し、8 の倍数に切り上げ、96 より狭くしない）、
//    style を書かないボタンは、その行の最初のボタンだけ青（primary）、ほかは白（normal）。文字を直してはみ出すときは広げる（狭めない）。
// ③ AI が置いた吹き出し: 場所を書かないとき、つなぐ部品の真ん中が画面の左半分なら左の外（x = -224）、右半分なら右の外。
// ④ 並べ方の列: columns と span は 1〜4。1・2 列は今までどおり。3・4 列は、画面の幅から左右 32 を引き、列の間 48 で等しく分けた列（8 ドットのマス目に切り下げる）。
//    列が 160 より狭くなる機器では列を減らす。
// 画面設計の名前は架空の業務（顧客管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, screen, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}) => {
    const r = plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const parts = (sid) => plain(T.store.state.designs[0].screens.find((s) => s.id === sid).parts);
  return { app, T, call, parts };
}
const btn = (label, extra = {}) => ({ type: 'button', label, ...extra });

test('② AI が並べたボタンの幅は文字から決め、style を書かないときは行の最初のボタンだけ青', async () => {
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [
    { align: 'right', parts: [btn('下書きとして保存'), btn('申請する'), btn('キャンセル')] },
    { align: 'left', parts: [btn('OK'), btn('戻る', { style: 'primary' })] },
  ] } });
  const b = parts('s2');
  assert.deepEqual(b.map((p) => [p.label, p.w, p.props.style]), [
    ['下書きとして保存', 152, 'primary'], ['申請する', 96, 'normal'], ['キャンセル', 112, 'normal'],
    ['OK', 96, 'primary'], ['戻る', 96, 'primary'],
  ]);
  app.close();
});

test('② ボタンの文字を直してはみ出すときは幅を広げ、短くしたときは狭めない', async () => {
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [{ align: 'left', parts: [btn('保存')] }] } });
  const id = parts('s2')[0].id;
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', part: id, label: '下書きとして保存する' }] });
  assert.equal(parts('s2')[0].w, 184, '10 字 × 15 ＋ 32 ＝ 182 を 8 の倍数に切り上げる');
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', part: id, label: '保存' }] });
  assert.equal(parts('s2')[0].w, 184);
  app.close();
});

test('③ 場所を書かない吹き出しは、つなぐ部品の真ん中が画面の左半分なら左の外、右半分なら右の外に置く（重なるときは下へずらす）', async () => {
  const { app, call } = await boot();
  const r = await call('edit_callouts', { design: 'd1', screen: 's1', ops: [
    { op: 'add', text: '顧客コードの説明', target: 'p1' },
    { op: 'add', text: '顧客名の説明', target: 'p2' },
    { op: 'add', text: '区分の説明', target: 'p3' },
  ] });
  // p1（x 32・y 64）と p2（x 32・y 152）は左半分、p3（x 400・幅 320 で真ん中 560）は左半分、画面の幅は 1280
  assert.deepEqual(r.callouts.map((c) => [c.x, c.y]), [[-224, 64], [-224, 152], [-224, 64 + 80 + 16]]);
  const st = sampleState();
  st.designs[0].screens[0].parts[2].x = 800;
  const b = await boot(st);
  const r2 = await b.call('edit_callouts', { design: 'd1', screen: 's1', ops: [{ op: 'add', text: '区分の説明', target: 'p3' }] });
  assert.deepEqual([r2.callouts[0].x, r2.callouts[0].y], [1280 + 24, 64]);
  app.close();
  b.app.close();
});

test('④ 3 列・4 列の並べ方: 列の左の端と幅は画面の幅から決め、span で列をまたぐ。1・2 列の置き方は変えない', async () => {
  const { app, call, parts } = await boot();
  const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => ({ item: `項目${n}`, type: 'text1' }));
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { columns: 3, rows: [six.slice(0, 3), [six[3], { ...six[4], span: 2 }]] } });
  assert.deepEqual(parts('s2').map((p) => [p.x, p.y, p.w]), [[32, 64, 320], [448, 64, 320], [864, 64, 320], [32, 152, 320], [448, 152, 784]]);
  await call('layout_screen', { design: 'd1', screen: 's2', mode: 'replace', layout: { columns: 4, rows: [[...six.slice(0, 4).map((e) => ({ item: e.item })), { item: '項目E', span: 4 }]] } });
  assert.deepEqual(parts('s2').map((p) => [p.x, p.w]), [[32, 264], [344, 264], [656, 264], [968, 264], [32, 1200]]);
  await call('layout_screen', { design: 'd1', screen: 's2', mode: 'replace', layout: { columns: 2, rows: [[{ item: '項目A' }, { item: '項目B' }], [{ item: '項目C', span: 2 }]] } });
  assert.deepEqual(parts('s2').map((p) => [p.x, p.w]), [[32, 320], [480, 320], [32, 848]]);
  const cat = await call('get_catalog');
  assert.deepEqual(cat.layout.grid3, { columnsLeft: [32, 448, 864], columnWidth: 368 });
  assert.deepEqual(cat.layout.grid4, { columnsLeft: [32, 344, 656, 968], columnWidth: 264 });
  app.close();
});

test('④ 列が 160 より狭くなる機器では列を減らす（タブレットの 4 列は 3 列）。columns・span は 1〜4 だけ', async () => {
  const st = sampleState();
  st.designs[0].screens.push(screen('s3', 'タブレット', [], { device: 'tablet', width: 768, height: 1024 }));
  const { app, T, call, parts } = await boot(st);
  await call('layout_screen', { design: 'd1', screen: 's3', layout: { columns: 4, rows: [[{ item: '顧客コード' }, { item: '顧客名' }, { item: '区分' }]] } });
  assert.deepEqual(parts('s3').map((p) => [p.x, p.w]), [[32, 200], [280, 200], [528, 200]]);
  const bad = plain(await T.aiDispatch('layout_screen', { design: 'd1', screen: 's2', layout: { columns: 5, rows: [[{ item: '顧客名' }]] } }, { session: 's-1', client: 'claude-code' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /1〜4/);
  const SC = require('../mcp-schemas');
  assert.equal(SC.layout.safeParse({ columns: 4, rows: [[{ item: 'x', span: 3 }]] }).success, true);
  assert.equal(SC.layout.safeParse({ columns: 5, rows: [[{ item: 'x' }]] }).success, false);
  app.close();
});
