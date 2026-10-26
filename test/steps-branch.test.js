'use strict';
// 進み具合の矢印の分かれる終わり（第 13 段階。q114 の ①・画像 q114）のテスト。
// 分かれる終わり（そこから先へ進む操作がなく、そこへ来る操作があり、本線の終わりでないステータス）は、本線から外して、
// 点線の区切りと「〇〇から分かれる終わり」の字の後に、赤い枠の丸い札で右に置く。見本のステータスが分かれる終わりのときは札を赤く塗り、
// 本線は分かれる元のステータスまで済んだ色にする。本線の終わりは、最初のステータスから操作をたどっていちばん長く進めた先
// （同じ長さなら、操作の並びで先に書いた操作でたどった先）。
// 画面設計の名前は架空の業務（備品の貸し出し）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { screen, item, design, STORAGE_KEY } = require('./ai-fixtures');

const st = (id, name) => ({ id, name });
const act = (id, name, from, to) => ({ id, name, from, to, role: '', cond: '' });
// 画像 q114 の見本と同じステータスと操作
const LENDING = {
  states: [st('t1', '申請'), st('t2', '承認待ち'), st('t3', '貸し出し中'), st('t4', '返却済み'), st('t5', '却下')],
  actions: [act('a1', '申請する', 't1', 't2'), act('a2', '承認する', 't2', 't3'), act('a3', '却下する', 't2', 't5'), act('a4', '返却を記録する', 't3', 't4')],
};

async function stepsHtml(props, current, look = 'standard') {
  const parts = [{ id: 'pa', type: 'steps', x: 32, y: 64, w: 800, h: 40, no: 1, itemId: 'st', view: { current } }];
  const state = {
    schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [],
    designs: [design('d1', '備品の貸し出し', 'kintone', { look, items: [item('st', 'ステータス', 'status', { props })], screens: [screen('s1', '貸出の詳細', parts)] })],
  };
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const d = T.store.state.designs[0];
  const html = T.screenHtml(d, d.screens[0]);
  app.close();
  const m = html.match(/<div class="psteps[^"]*">([\s\S]*?)<\/div>/);
  assert.ok(m, '進み具合の矢印がない');
  return m[1];
}
const END = (name, from, on = false) => `<i class="pst-sep"></i><em class="pst-from">${from}から分かれる終わり</em><b class="pst-end${on ? ' on' : ''}">${name}</b>`;

test('分かれる終わり（却下）は本線から外して右に置く。見本が本線のステータスのときは、札は赤い枠だけ', async () => {
  const h = await stepsHtml(LENDING, 't2');
  assert.equal(h, '<span class="done">申請</span><span class="on">承認待ち</span><span class="">貸し出し中</span><span class="">返却済み</span>' + END('却下', '承認待ち'));
});

test('見本が分かれる終わりのときは、札を赤く塗り、本線は分かれる元のステータスまで済んだ色にする', async () => {
  const h = await stepsHtml(LENDING, 't5');
  assert.equal(h, '<span class="done">申請</span><span class="done">承認待ち</span><span class="">貸し出し中</span><span class="">返却済み</span>' + END('却下', '承認待ち', true));
});

test('並びの途中にある分かれる終わりも外す。本線の終わりは、同じ長さなら操作の並びで先に書いた操作でたどった先', async () => {
  const props = {
    states: [st('t1', '申請'), st('t2', '承認待ち'), st('t3', '却下'), st('t4', '承認済み')],
    actions: [act('a1', '申請する', 't1', 't2'), act('a2', '承認する', 't2', 't4'), act('a3', '却下する', 't2', 't3')],
  };
  const h = await stepsHtml(props, 't4');
  assert.equal(h, '<span class="done">申請</span><span class="done">承認待ち</span><span class="on">承認済み</span>' + END('却下', '承認待ち'));
});

test('操作がないとき・分かれる終わりがないとき（差し戻しで戻るだけ）は、今と同じく 1 列に並べる', async () => {
  const none = await stepsHtml({ states: LENDING.states, actions: [] }, 't5');
  assert.equal(none, '<span class="done">申請</span><span class="done">承認待ち</span><span class="done">貸し出し中</span><span class="done">返却済み</span><span class="on">却下</span>');
  const back = {
    states: [st('t1', '申請'), st('t2', '承認待ち'), st('t3', '承認済み')],
    actions: [act('a1', '申請する', 't1', 't2'), act('a2', '差し戻す', 't2', 't1'), act('a3', '承認する', 't2', 't3')],
  };
  assert.equal(await stepsHtml(back, 't2'), '<span class="done">申請</span><span class="on">承認待ち</span><span class="">承認済み</span>');
});

test('Salesforce と kintone の見た目でも、同じ形で描く', async () => {
  for (const look of ['salesforce', 'kintone']) {
    const h = await stepsHtml(LENDING, 't5', look);
    assert.ok(h.endsWith(END('却下', '承認待ち', true)), look);
  }
});
