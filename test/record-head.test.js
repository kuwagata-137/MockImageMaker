'use strict';
// レコードの見出し（第 14 段階。画像 q116 の案A）のテスト。種類・見た目・右のパネル・設定一覧・上に重ねたボタン。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
const partEl = (app, id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);

// 項目が 4 つある画面設計（標準の見た目）を開いた状態で起動する
async function bootHead(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const did = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(did);
  const items = ['電話', '業種', '担当者', '地域'].map((name) => {
    const id = api.actions.addItem(did, 'text1');
    api.actions.updateItem(did, id, { label: name });
    return id;
  });
  const sid = () => api.currentScreen().id;
  const part = (id) => api.currentScreen().parts.find((p) => p.id === id);
  const put = (type, [x, y, w, h]) => {
    const id = api.actions.addPart(did, sid(), type, { x, y });
    if (w) api.actions.movePart(did, sid(), id, { x, y, w, h });
    return id;
  };
  return { app, api, did, sid, items, part, put };
}

test('レコードの見出し: 種類の名前と最初の大きさ（画面の幅いっぱいで、左右に 32 を空ける幅）。中にアイテムを入れられる', async (t) => {
  const { api, part, put } = await bootHead(t);
  const T = api.PART_TYPES.recordHead;
  assert.deepEqual(plain([T.name, T.h, T.container]), ['レコードの見出し', 96, true]);
  const h = put('recordHead', [32, 56]);
  assert.deepEqual(plain([part(h).x, part(h).w, part(h).h]), [32, 1216, 96]);
  assert.deepEqual(plain(part(h).props), { kind: '', name: 'レコードの名前', color: 'blue', items: [], values: [] });
});

test('レコードの見出しの見た目: アイコン・レコードの種類（空なら画面設計の名前）・レコードの名前・主な項目の項目名と値', async (t) => {
  const { app, api, did, sid, items, put } = await bootHead(t);
  const h = put('recordHead', [32, 56]);
  const el = () => partEl(app, h);
  assert.equal(el().querySelector('.prh-top small').textContent, '顧客管理', 'レコードの種類が空なら、画面設計の名前');
  assert.equal(el().querySelector('.prh-top b').textContent, 'レコードの名前');
  assert.ok(el().querySelector('.prh-ic.fc-blue svg'));
  assert.equal(el().querySelector('.prh-fields').textContent, '主な項目は右のパネルで選びます');
  api.actions.updatePart(did, sid(), h, { props: { kind: '顧客', name: '株式会社サンプル商事', items: [items[0], items[1]], values: ['03-1234-5678', '卸売業'] } });
  assert.equal(el().querySelector('.prh-top small').textContent, '顧客');
  assert.equal(el().querySelector('.prh-top b').textContent, '株式会社サンプル商事');
  assert.deepEqual($$(app, '#stage .prh-fields > div').map((d) => [d.querySelector('small').textContent, d.querySelector('span').textContent]),
    [['電話', '03-1234-5678'], ['業種', '卸売業']]);
  api.actions.updateItem(did, items[0], { label: '電話番号' });
  assert.equal(el().querySelector('.prh-fields small').textContent, '電話番号', '項目一覧で項目名を変えると、見出しの項目名も変わる');
  assert.ok(el().querySelector('.pno.pno-out'), '番号は左の外');
  const css = api.appStyle();
  assert.match(css, /\.look-sf \.prhead\{/);
  assert.match(css, /\.look-kt \.prhead\{/);
});

test('レコードの見出しの右のパネル: 種類・名前・アイコンの色・主な項目（絞り込み欄と同じ選び方）。設定一覧に出る文', async (t) => {
  const { app, api, items, part, put } = await bootHead(t);
  const h = put('recordHead', [32, 56]);
  api.selectPart(h);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  assert.match(side('.panel-title').textContent, /番号 1・レコードの見出し/);
  setValue(side('[data-pf="props.kind"]'), '顧客');
  setValue(side('[data-pf="props.name"]'), '株式会社サンプル商事');
  assert.deepEqual(plain([part(h).props.kind, part(h).props.name]), ['顧客', '株式会社サンプル商事']);
  assert.deepEqual($$(app, '#side-settings [data-pf="props.color"]').map((e) => e.value), ['blue', 'green', 'orange', 'red', 'purple', 'gray', 'none']);
  items.forEach((id) => setValue(side('[data-fl="add"]'), id));
  assert.deepEqual(plain(part(h).props.items), items);
  setValue($$(app, '#side-settings [data-fl="value"]')[0], '03-1234-5678');
  assert.equal(part(h).props.values[0], '03-1234-5678');
  click($$(app, '#side-settings [data-action="fl-down"]')[0]);
  assert.deepEqual(plain(part(h).props.items.slice(0, 2)), [items[1], items[0]]);
  assert.deepEqual(plain(part(h).props.values.slice(0, 2)), ['', '03-1234-5678'], '値も一緒に並べ替える');
  click($$(app, '#side-settings [data-action="fl-del"]')[3]);
  assert.equal(part(h).props.items.length, 3);
  assert.equal(side('#pf-out').textContent, 'レコードの種類＝顧客\n主な項目＝業種・電話・担当者');
});

test('レコードの見出し: 上に重ねたボタンは見出しに入り、見出しを動かすと一緒に動く。見出しはボタンの後ろに描く', async (t) => {
  const { app, api, did, sid, part, put } = await bootHead(t);
  const b = put('button', [1040, 72, 96, 40]);
  const h = put('recordHead', [32, 56]);
  assert.equal(part(b).inFrame, h, '全体が見出しの中にあるボタンを入れる');
  assert.deepEqual($$(app, '#stage .screen .part').map((e) => e.dataset.partId), [h, b]);
  api.actions.movePart(did, sid(), h, { x: 32, y: 120, w: 1216, h: 96 });
  assert.equal(part(b).y, 136);
});
