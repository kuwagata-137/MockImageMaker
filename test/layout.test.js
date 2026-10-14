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
