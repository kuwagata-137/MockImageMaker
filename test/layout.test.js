'use strict';
// 部品の並べ方（第 7 段階の T3。設計書の 9-3）のテスト。
// ひな形の置き方が、並べ方を 1 つの関数にまとめる前と変わらないこと（test/fixtures/template-layout.json と比べる）と、
// layoutPlacements（行と列から位置と大きさを決める純関数）の決まり。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { design, plain } = require('./ai-fixtures');
const { ITEM_SETS, TEMPLATE_IDS, layoutSnapshot } = require('./template-layout-cases');
const GOLDEN = require('./fixtures/template-layout.json');

const stateWith = (items) => ({ schemaVersion: 2, settings: { customTargets: [], mapPos: {} }, designs: [design('d1', '顧客管理', 'kintone', { items })] });

for (const [setName, items] of Object.entries(ITEM_SETS)) {
  test(`ひな形の置き方が見本と同じ（項目の組: ${setName}）`, async () => {
    const app = bootApp({ localStorage: { 'mockimagemaker.v1': JSON.stringify(stateWith(items)) } });
    const T = await app.api();
    for (const tpl of TEMPLATE_IDS) {
      const before = T.store.state.designs[0].items.length;
      const sid = T.actions.addScreen('d1', tpl);
      const d = T.store.state.designs[0];
      const got = plain(layoutSnapshot(d, d.screens.find((s) => s.id === sid), before));
      assert.deepEqual(got, GOLDEN[`${tpl}/${setName}`], `${tpl}/${setName}`);
      T.store.undo();
    }
    app.close();
  });
}

// ── layoutPlacements（並べ方の純関数）──
const E = (t, w, h, extra = {}) => ({ t, w, h, ...extra });
const sizeOf = (e) => ({ type: e.t, w: e.w, h: e.h });
const at = (placed) => placed.map((p) => [p.type, p.x, p.y, p.w, p.h]);

test('layoutPlacements: パソコンは 2 列（左の端 32・480）。行の間は 24、次の行は前の行のいちばん下の部品の下から', async () => {
  const app = bootApp();
  const T = await app.api();
  const r = T.layoutPlacements({ columns: 2, rows: [[E('text1', 320, 64), E('text2', 400, 120)], [E('date', 200, 64)]] }, { width: 1280, startY: 64, sizeOf });
  assert.deepEqual(plain(at(r.placed)), [['text1', 32, 64, 320, 64], ['text2', 480, 64, 400, 120], ['date', 32, 208, 200, 64]]);
  assert.equal(r.nextY, 208 + 64 + 24);
  app.close();
});

test('layoutPlacements: 1 行に 3 つ書くと折り返す。幅 400 に入らない部品は 2 列をまたぎ、span:2 は 848 まで広げる', async () => {
  const app = bootApp();
  const T = await app.api();
  const r = T.layoutPlacements({ columns: 2, rows: [
    [E('text1', 320, 64), E('text1', 320, 64), E('text1', 320, 64)],
    [E('number', 200, 64), E('table', 640, 168), E('date', 200, 64)],
    [E('text2', 400, 120, { span: 2 })],
  ] }, { width: 1280, startY: 64, sizeOf });
  assert.deepEqual(plain(at(r.placed)), [
    ['text1', 32, 64, 320, 64], ['text1', 480, 64, 320, 64], ['text1', 32, 152, 320, 64],
    ['number', 32, 240, 200, 64], ['table', 32, 328, 640, 168], ['date', 32, 520, 200, 64],
    ['text2', 32, 608, 848, 120],
  ]);
  app.close();
});

test('layoutPlacements: 2 列はパソコン（幅 912 以上）だけ。タブレットは 1 列、スマホは画面の幅に入るように縮める', async () => {
  const app = bootApp();
  const T = await app.api();
  const rows = [[E('text1', 320, 64), E('text1', 320, 64)], [E('table', 640, 168), E('text2', 400, 120, { span: 2 })]];
  assert.equal(T.layoutPlacements({ columns: 2, rows }, { width: 912, startY: 64, sizeOf }).placed[1].x, 480);
  const tab = T.layoutPlacements({ columns: 2, rows }, { width: 768, startY: 64, sizeOf });
  assert.deepEqual(plain(at(tab.placed)), [['text1', 32, 64, 320, 64], ['text1', 32, 152, 320, 64], ['table', 32, 240, 640, 168], ['text2', 32, 432, 704, 120]]);
  const narrow = T.layoutPlacements({ columns: 2, rows }, { width: 904, startY: 64, sizeOf });
  assert.equal(narrow.placed[1].x, 32);
  const phone = T.layoutPlacements({ columns: 2, rows }, { width: 375, startY: 24, sizeOf });
  assert.deepEqual(plain(at(phone.placed)), [['text1', 32, 24, 304, 64], ['text1', 32, 112, 304, 64], ['table', 32, 200, 304, 168], ['text2', 32, 392, 304, 120]]);
  app.close();
});

test('layoutPlacements: align の行は部品の間を 32 空けて横に並べ、左・真ん中・右に寄せる。前の行との間は 32', async () => {
  const app = bootApp();
  const T = await app.api();
  const btns = [E('button', 96, 40), E('button', 96, 40)];
  const run = (align, first = false) => T.layoutPlacements({ columns: 2, rows: first ? [{ align, parts: btns }] : [[E('text1', 320, 64)], { align, parts: btns }] }, { width: 1280, startY: 64, sizeOf });
  assert.deepEqual(plain(at(run('left').placed).slice(1)), [['button', 32, 160, 96, 40], ['button', 160, 160, 96, 40]]);
  assert.deepEqual(plain(at(run('right').placed).slice(1)), [['button', 1024, 160, 96, 40], ['button', 1152, 160, 96, 40]]);
  assert.deepEqual(plain(at(run('center').placed).slice(1)), [['button', 528, 160, 96, 40], ['button', 656, 160, 96, 40]]);
  assert.deepEqual(plain(at(run('left', true).placed)), [['button', 32, 64, 96, 40], ['button', 160, 64, 96, 40]]);
  assert.equal(run('left').nextY, 160 + 40 + 24);
  // 入りきらないときは、次の行へ続ける（スマホにボタン 3 つ）
  const phone = T.layoutPlacements({ rows: [{ align: 'left', parts: [...btns, E('button', 96, 40)] }] }, { width: 375, startY: 24, sizeOf });
  assert.deepEqual(plain(at(phone.placed)), [['button', 32, 24, 96, 40], ['button', 160, 24, 96, 40], ['button', 32, 88, 96, 40]]);
  app.close();
});

test('placeParts: 決めた位置に部品を置き、番号を順に付け、下からはみ出すときは画面を伸ばす（元に戻す 1 回で戻る）', async () => {
  const app = bootApp({ localStorage: { 'mockimagemaker.v1': JSON.stringify(stateWith([])) } });
  const T = await app.api();
  const sid = T.store.state.designs[0].screens[0].id;
  const ids = T.actions.placeParts('d1', sid, [
    { type: 'heading', x: 32, y: 64, w: 400, h: 32, label: '旅費の見込み' },
    { type: 'button', x: 32, y: 800, w: 96, h: 40, label: '申請する' },
  ]);
  const sc = T.store.state.designs[0].screens[0];
  assert.equal(ids.length, 2);
  assert.deepEqual(plain(sc.parts.map((p) => [p.type, p.x, p.y, p.w, p.h, p.no, p.label])), [['heading', 32, 64, 400, 32, null, '旅費の見込み'], ['button', 32, 800, 96, 40, 1, '申請する']]);
  assert.ok(sc.height >= 800 + 40 + 32);
  T.store.undo();
  assert.equal(T.store.state.designs[0].screens[0].parts.length, 0);
  app.close();
});
