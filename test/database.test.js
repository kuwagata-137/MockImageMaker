'use strict';
// データベースの項目（第 3 段階の後半）のテスト。データの形 v2（項目は画面設計の items に持ち、入力欄の部品は itemId で指す）・
// 項目の一覧表・取り込み（つなげたまま）・ルックアップ・つながりの図。
// 画面設計の名前は架空の業務（顧客管理・取引先マスタなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

// 白紙の画面 1 つの画面設計を開いた状態で起動する
async function bootEditor(t, { name = '顧客管理', target = 'kintone' } = {}) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign(name, target);
  api.openDesign(id);
  const design = () => api.currentDesign();
  const screen = () => api.currentScreen();
  const items = () => design().items;
  const resolved = () => screen().parts.map((p) => api.resolvePart(design(), p));
  const add = (type) => api.actions.addPart(design().id, screen().id, type, { x: 0, y: 48 });
  return { app, api, id, design, screen, items, resolved, add };
}

// 画面設計に画面を 1 つ足す（画面を足す操作は第 4 段階で作るので、データを直接足す）
function addScreen(api, designId, name) {
  const sid = 's-' + name;
  api.store.commit((s) => {
    const d = s.designs.find((x) => x.id === designId);
    d.screens.push({ id: sid, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
  });
  return sid;
}

test('データの形 v1 → v2: 入力欄の部品 1 つから項目を 1 つ作り、部品は項目を指す（同じ名前でもまとめない）', async (t) => {
  const { api } = await bootEditor(t);
  const { state, blockReason } = api.migrate({
    schemaVersion: 1,
    designs: [{ id: 'd1', name: '顧客管理', screens: [
      { id: 's1', parts: [
        { id: 'p2', type: 'dropdown', x: 8, y: 120, no: 2, label: '区分', props: { options: ['法人', '個人'], initial: '法人' } },
        { id: 'p1', type: 'text1', x: 8, y: 48, no: 1, label: '顧客名', required: true, memo: '会社名を書く', props: { maxLen: '50' } },
        { id: 'p3', type: 'button', x: 8, y: 200, no: 3, label: '保存', props: { style: 'primary', action: '' } },
      ] },
      { id: 's2', parts: [{ id: 'p4', type: 'text1', x: 8, y: 48, no: 1, label: '顧客名' }] },
    ] }],
  });
  assert.equal(blockReason, null);
  assert.equal(state.schemaVersion, 2);
  const d = state.designs[0];
  assert.deepEqual(plain(d.items.map((it) => it.name)), ['顧客名', '区分', '顧客名'], '画面の順、画面の中は上から下の順。同じ名前でもまとめない');
  const [i1, i2, i3] = d.items;
  assert.deepEqual(plain([i1.type, i1.required, i1.memo, i1.props.maxLen, i1.lookup, i1.link]), ['text1', true, '会社名を書く', '50', null, null]);
  assert.deepEqual(plain([i2.props.options, i2.props.initial]), [['法人', '個人'], '法人']);
  const [p2, p1, p3] = d.screens[0].parts;
  assert.deepEqual(plain([p1.itemId, p2.itemId, d.screens[1].parts[0].itemId]), plain([i1.id, i2.id, i3.id]));
  assert.equal(p3.itemId, undefined, 'ボタンは項目にならない');
  assert.equal(p3.label, '保存');
  assert.equal(p1.label, undefined);
});

test('入力欄の部品を置くと項目が足され、設定の欄の変更は項目に書く。部品を消しても項目は残る', async (t) => {
  const { app, api, design, items, resolved, add } = await bootEditor(t);
  const pid = add('text1');
  add('button');
  assert.equal(items().length, 1, 'ボタンは項目にならない');
  const item = items()[0];
  assert.equal(api.findItem(design(), item.id).name, '項目名');
  api.selectPart(pid);
  setValue($(app, '#side-settings [data-pf="label"]'), '顧客名');
  check($(app, '#side-settings [data-pf="required"]'), true);
  assert.deepEqual(plain([items()[0].name, items()[0].required]), ['顧客名', true]);
  assert.equal(resolved()[0].label, '顧客名');
  assert.match($(app, '#stage .part').textContent, /顧客名/);
  assert.match($(app, '.ptable').textContent, /顧客名.*必須/s);
  api.runCommand('deletePart');
  assert.equal(design().screens[0].parts.length, 1);
  assert.equal(items().length, 1, '項目は一覧表に残る');
  api.store.undo();
  assert.equal(design().screens[0].parts.length, 2);
});

test('同じ項目は、ほかの画面の部品も同じ中身で描く。同じ画面へ貼り付けると項目も写す', async (t) => {
  const { api, design, items, add } = await bootEditor(t);
  const pid = add('text1');
  api.actions.updatePart(design().id, design().screens[0].id, pid, { label: '顧客名' });
  const sid2 = addScreen(api, design().id, '詳細');
  api.selectPart(pid);
  api.runCommand('copyPart');
  api.ui.screenId = sid2;
  api.runCommand('pastePart');
  const s2 = design().screens[1];
  assert.equal(s2.parts[0].itemId, items()[0].id, 'ほかの画面へは同じ項目を指して貼り付ける');
  api.actions.updatePart(design().id, sid2, s2.parts[0].id, { label: '顧客の名前' });
  assert.equal(api.resolvePart(design(), design().screens[0].parts[0]).label, '顧客の名前', '別の画面の部品も変わる');
  api.runCommand('pastePart');
  assert.equal(items().length, 2, '同じ画面には同じ項目を 2 回置かないので、項目を写す');
  assert.equal(items()[1].name, '顧客の名前');
  assert.notEqual(design().screens[1].parts[1].itemId, items()[0].id);
  api.runCommand('duplicatePart');
  assert.equal(items().length, 3, '複製も同じ');
});

test('ほかの画面設計へ貼り付けると、項目も一緒に足す', async (t) => {
  const { api, design, add } = await bootEditor(t);
  const pid = add('dropdown');
  api.actions.updatePart(design().id, design().screens[0].id, pid, { label: '区分', props: { options: ['法人', '個人'] } });
  api.selectPart(pid);
  api.runCommand('copyPart');
  const other = api.actions.createDesign('取引先マスタ', 'kintone');
  api.openDesign(other);
  api.runCommand('pastePart');
  api.runCommand('pastePart');
  const d2 = api.currentDesign();
  assert.equal(d2.items.length, 2, '1 回目は項目を足し、2 回目は同じ画面なので写す');
  assert.deepEqual(plain(d2.items.map((it) => [it.name, it.props.options])), [['区分', ['法人', '個人']], ['区分', ['法人', '個人']]]);
});

test('項目を指す部品の項目が見つからないときは、部品が持っている中身で描き、設定は書き換えない', async (t) => {
  const { app, api } = await bootEditor(t);
  const { state } = api.migrate({
    schemaVersion: 2,
    designs: [{ id: 'd1', name: '顧客管理', items: [], screens: [{ id: 's1', parts: [
      { id: 'p1', type: 'text1', x: 8, y: 48, no: 1, itemId: 'i-gone', label: '取引先名', required: true, props: { maxLen: '30' } },
    ] }] }],
  });
  api.store.commit((s) => { s.designs = state.designs; });
  api.openDesign('d1');
  const d = api.currentDesign();
  assert.equal(d.items.length, 0, '項目は作り直さない');
  const p = d.screens[0].parts[0];
  assert.equal(p.itemId, 'i-gone');
  assert.match($(app, '#stage .part').textContent, /取引先名/);
  assert.match($(app, '.ptable').textContent, /必須・最大 30 文字/);
  api.actions.updatePart('d1', 's1', 'p1', { label: '別の名前', labelPos: 'left' });
  const after = api.currentDesign().screens[0].parts[0];
  assert.deepEqual([after.label, after.labelPos], ['取引先名', 'left'], '項目名は固定。項目名の位置は直せる');
});

function check(el, on) {
  el.checked = on;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
