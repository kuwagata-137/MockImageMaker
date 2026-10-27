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

test('データの形 v1 → v2: 入力欄のアイテム 1 つから項目を 1 つ作り、アイテムは項目を指す（同じ名前でもまとめない）', async (t) => {
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
  assert.equal(state.schemaVersion, 3, '版 1 は、今の形（版 3）まで直す');
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

test('入力欄のアイテムを置くと項目が足され、設定の欄の変更は項目に書く。アイテムを消しても項目は残る', async (t) => {
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

test('同じ項目は、ほかの画面のアイテムも同じ中身で描く。同じ画面へ貼り付けると項目も写す', async (t) => {
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
  assert.equal(api.resolvePart(design(), design().screens[0].parts[0]).label, '顧客の名前', '別の画面のアイテムも変わる');
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

test('項目を指すアイテムの項目が見つからないときは、アイテムが持っている中身で描き、設定は書き換えない', async (t) => {
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

// ── データベースの項目の一覧表（画像 q19・q20）──

const rowNames = (app) => $$(app, '#db-view tbody tr').map((r) => r.children[1].textContent.trim());

test('項目一覧: 左の一覧のいちばん上から開き、項目・種類・設定・置いている画面を並べる', async (t) => {
  const { app, api, design, items, add } = await bootEditor(t);
  const pid = add('text1');
  api.actions.updatePart(design().id, design().screens[0].id, pid, { label: '顧客名', required: true, props: { maxLen: '50' } });
  api.actions.addItem(design().id, 'number');
  assert.match($(app, '.db-entry').textContent, /データベースの項目\s*2 個/);
  click($(app, '[data-action="open-items"]'));
  assert.equal(api.ui.panel, 'items');
  assert.ok($(app, '.db-entry').classList.contains('active'));
  assert.equal($(app, '.sl-item.active'), null, '画面の縮小画像は選んでいない形にする');
  assert.equal($(app, '#canvas-wrap').hidden, true);
  assert.equal($(app, '#side-box').hidden, true, 'アイテム一覧は出さない');
  assert.deepEqual(plain(rowNames(app)), ['顧客名', '項目名']);
  const cells = $$(app, '#db-view tbody tr')[0].children;
  assert.deepEqual(plain([...cells].slice(2, 6).map((c) => c.textContent.trim())), ['テキスト（1行）', '必須・最大 50 文字', '－', '画面 1']);
  assert.match($$(app, '#db-view tbody tr')[1].textContent, /どの画面にもない/);
  click($(app, '.sl-item'));
  assert.equal(api.ui.panel, 'screen', '画面の縮小画像を押すと画面に戻る');
  assert.equal(items().length, 2);
});

test('項目一覧: 「＋ 項目を足す」で種類を選んで足し、右のパネルで名前と種類を直すと画面のアイテムも変わる', async (t) => {
  const { app, api, design, items, add } = await bootEditor(t);
  const pid = add('text1');
  click($(app, '[data-action="open-items"]'));
  click($(app, '#db-view [data-action="add-item-menu"]'));
  assert.ok($(app, '#db-view .pop-menu'));
  assert.equal($$(app, '#db-view .pop-menu button').length, 12, '入力欄のアイテムの 11 種類と表（テーブル）');
  click($(app, '#db-view .pop-menu [data-type="date"]'));
  assert.equal($(app, '#db-view .pop-menu'), null);
  assert.equal(items().length, 2);
  assert.equal(api.ui.itemId, items()[1].id, '足した項目を選ぶ');
  assert.match($(app, '#side-settings .panel-title').textContent, /選んだ項目の設定/);
  // 1 つ目の項目（画面に置いてある）を選び、名前と種類を変える
  click($$(app, '#db-view tbody tr')[0]);
  setValue($(app, '#side-settings [data-pf="label"]'), '契約日');
  assert.equal(rowNames(app)[0], '契約日', '表もすぐ変わる');
  setValue($(app, '#side-settings [data-pf="type"]'), 'date');
  assert.equal(items()[0].type, 'date');
  assert.equal(design().screens[0].parts.find((p) => p.id === pid).type, 'date', '画面のアイテムの種類も変わる');
  assert.match($(app, '#side-settings .pf-used').textContent, /画面 1/);
  api.store.undo();
  assert.equal(items()[0].type, 'text1');
});

test('アイテム一覧の「データベースの項目」: 置いていない項目を先に並べ、押すと画面に置く。同じ画面には 2 回置けない', async (t) => {
  const { app, api, design, add } = await bootEditor(t);
  add('text1');
  const iid = api.actions.addItem(design().id, 'dropdown');
  api.actions.updateItem(design().id, iid, { label: '区分' });
  const names = () => $$(app, '.pal-item').map((e) => e.querySelector('span').textContent + (e.classList.contains('placed') ? '（置いた）' : ''));
  assert.deepEqual(plain(names()), ['区分', '項目名（置いた）']);
  click($(app, `.pal-item[data-item-id="${iid}"]`));
  const sc = design().screens[0];
  const placed = sc.parts.find((p) => p.itemId === iid);
  assert.ok(placed, '区分を置いた');
  assert.equal(placed.type, 'dropdown');
  assert.equal(api.ui.partId, placed.id);
  assert.deepEqual(plain(names()), ['項目名（置いた）', '区分（置いた）']);
  assert.equal(api.actions.addItemPart(design().id, sc.id, iid, { x: 0, y: 200 }), null, '同じ画面には置けない');
  assert.equal(design().items.length, 2, '項目は増えない');
});

test('アイテムを選んだときの右のパネルは「項目の設定」と「この画面だけの設定」に分ける', async (t) => {
  const { app, api, add } = await bootEditor(t);
  api.selectPart(add('text1'));
  const secs = $$(app, '#side-settings .pf-sec');
  assert.equal(secs.length, 2);
  assert.ok(secs[0].classList.contains('item'));
  assert.match(secs[0].textContent, /項目の設定\s*どの画面でも同じ/);
  assert.ok(secs[0].querySelector('[data-pf="label"]') && secs[0].querySelector('[data-pf="required"]') && secs[0].querySelector('[data-pf="memo"]'));
  assert.match(secs[1].textContent, /この画面だけの設定\s*画面 1の画面/);
  assert.ok(secs[1].querySelector('[data-pf="labelPos"]') && secs[1].querySelector('[data-pf="sample"]') && secs[1].querySelector('[data-pf="numbered"]'));
  assert.match($(app, '#side-settings').textContent, /この画面からアイテムを削除/);
  assert.match($(app, '#side-settings').textContent, /項目は、項目一覧に残ります/);
});

test('項目を消すと、画面のアイテムは消したときの中身で固定され、「項目一覧に戻す」で戻せる', async (t) => {
  const { app, api, design, items, add } = await bootEditor(t);
  const pid = add('text1');
  api.actions.updatePart(design().id, design().screens[0].id, pid, { label: '取引先名', required: true });
  const iid = items()[0].id;
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view [data-action="delete-item"][data-id="${iid}"]`));
  assert.match($(app, '.modal').textContent, /画面 1の画面にあるアイテムは残り/);
  click($(app, '.modal [data-dlg="ok"]'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(items().length, 0);
  const p = design().screens[0].parts[0];
  assert.deepEqual(plain([p.itemId, p.label, p.required]), [iid, '取引先名', true], 'アイテムに中身を写して残す');
  click($(app, '.sl-item'));
  assert.equal($(app, '#stage .part .tag.gone').textContent, '項目なし', '編集の画面ではアイテムに札を付ける');
  assert.equal($(app, '.sl-thumb .tag'), null, '縮小画像には付けない');
  api.selectPart(pid);
  assert.match($(app, '#side-settings .pf-banner.gone').textContent, /取引先名.*削除しました/);
  assert.ok($(app, '#side-settings fieldset.pf-sec.locked').disabled, '項目の設定は直せない');
  assert.equal($(app, '#side-settings .pf-sec.here [data-pf="labelPos"]').disabled, false, 'この画面だけの設定は直せる');
  click($(app, '#side-settings [data-action="restore-item"]'));
  assert.equal(items().length, 1);
  assert.deepEqual(plain([items()[0].id, items()[0].name, items()[0].required]), [iid, '取引先名', true]);
  assert.equal(design().screens[0].parts[0].label, undefined, 'アイテムはまた項目を指す');
  assert.equal($(app, '#side-settings .pf-banner.gone'), null);
});

test('項目一覧: 並べ替え（つまみのドラッグと同じ操作）と、Delete のキーで消す', async (t) => {
  const { app, api, design, items } = await bootEditor(t);
  const ids = ['text1', 'number', 'date'].map((type) => api.actions.addItem(design().id, type));
  assert.equal(api.actions.moveItem(design().id, ids[0], 3), true);
  assert.deepEqual(plain(items().map((it) => it.id)), plain([ids[1], ids[2], ids[0]]));
  assert.equal(api.actions.moveItem(design().id, ids[0], 3), false, '同じ位置へは動かさない（履歴に積まない）');
  assert.equal(api.actions.moveItem(design().id, ids[0], 0), true);
  assert.deepEqual(plain(items().map((it) => it.id)), plain(ids));
  click($(app, '[data-action="open-items"]'));
  click($$(app, '#db-view tbody tr')[1]);
  app.document.body.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(items().map((it) => it.id)), plain([ids[0], ids[2]]), '画面に置いていない項目は、確かめずに消す');
});

// ── ほかのモックから項目を取り込む（つなげたまま。画像 q21）──

// 「住所の共通項目」（郵便番号・都道府県・電話番号）と「顧客管理」（電話番号）を作り、顧客管理を開いた状態にする
async function bootTwo(t) {
  const ctx = await bootEditor(t, { name: '住所の共通項目', target: 'その他' });
  const { api } = ctx;
  const srcId = ctx.design().id;
  const mk = (type, label, props) => {
    const id = api.actions.addItem(srcId, type);
    api.actions.updateItem(srcId, id, { label, ...(props ? { props } : {}) });
    return id;
  };
  const zip = mk('text1', '郵便番号', { maxLen: '8' });
  const pref = mk('dropdown', '都道府県', { options: ['北海道', '青森県'] });
  const tel = mk('text1', '電話番号');
  const dstId = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(dstId);
  const dstTel = api.actions.addItem(dstId, 'text1');
  api.actions.updateItem(dstId, dstTel, { label: '電話番号' });
  const src = () => api.store.state.designs.find((d) => d.id === srcId);
  const dst = () => api.store.state.designs.find((d) => d.id === dstId);
  return { ...ctx, srcId, dstId, src, dst, ids: { zip, pref, tel } };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('取り込む窓: 元の画面設計を選んで項目にチェックを付けて取り込むと、一覧表のいちばん下につなげたまま足す', async (t) => {
  const { app, dst, srcId, ids } = await bootTwo(t);
  click($(app, '[data-action="open-items"]'));
  click($(app, '#db-view [data-action="import-items"]'));
  const m = $(app, '.modal.wide');
  assert.ok(m, '広い窓');
  assert.deepEqual(plain($$(app, '.imp-design .nm').map((e) => e.textContent)), ['住所の共通項目'], '自分は出さない');
  assert.ok($(app, '.imp-design').classList.contains('on'), '項目のあるモックを最初から選ぶ');
  const rowText = () => $$(app, '.imp-items tbody tr').map((r) => r.children[1].textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(plain(rowText()), ['郵便番号', '都道府県', '電話番号 同じ名前の項目があります']);
  click($(app, '.modal [data-dlg="ok"]'));
  assert.match($(app, '.modal-error').textContent, /チェックを付けて/);
  check($(app, `[data-imp-item="${ids.zip}"]`), true);
  check($(app, `[data-imp-item="${ids.pref}"]`), true);
  assert.match($(app, '[data-imp-foot]').textContent, /新しく 2 個/);
  click($(app, '.modal [data-dlg="ok"]'));
  await settle();
  const items = dst().items;
  assert.deepEqual(plain(items.map((it) => it.name)), ['電話番号', '郵便番号', '都道府県']);
  assert.deepEqual(plain([items[2].link.designId, items[2].link.itemId, items[2].link.designName, items[2].link.lost]), [srcId, ids.pref, '住所の共通項目', false]);
  assert.deepEqual(plain(items[2].props.options), ['北海道', '青森県']);
  assert.match($$(app, '#db-view tbody tr')[2].textContent, /取り込み\s*住所の共通項目 › 都道府県/);
  assert.match($(app, '#toast').textContent, /2 個の項目を取り込みました/);
  // もう一度開くと、取り込み済みは押せない
  click($(app, '#db-view [data-action="import-items"]'));
  assert.ok($(app, `[data-imp-item="${ids.pref}"]`).disabled);
  assert.match($(app, '.imp-items').textContent, /取り込み済み/);
  click($(app, '.modal [data-dlg="cancel"]'));
  await settle();
});

test('つながった項目: 元を直すと取り込んだ側も同じ操作で変わり、取り込んだ側では直せない。元に戻すで両方戻る', async (t) => {
  const { app, api, dst, srcId, dstId, ids } = await bootTwo(t);
  api.actions.importItems(dstId, srcId, [ids.pref]);
  const linked = () => dst().items[1];
  const pid = api.actions.addItemPart(dstId, dst().screens[0].id, linked().id, { x: 0, y: 48 });
  assert.equal(api.actions.updateItem(dstId, linked().id, { label: '県' }), false, '取り込んだ側の項目は直せない');
  api.actions.updatePart(dstId, dst().screens[0].id, pid, { label: '県', labelPos: 'left' });
  assert.deepEqual(plain([linked().name, dst().screens[0].parts[0].labelPos]), ['都道府県', 'left'], '項目名は変わらず、この画面だけの設定は変わる');
  const before = dst().updatedAt;
  api.actions.updateItem(srcId, ids.pref, { label: '都道府県名', props: { options: ['北海道', '青森県', '岩手県'] } });
  assert.equal(linked().name, '都道府県名');
  assert.deepEqual(plain(linked().props.options), ['北海道', '青森県', '岩手県']);
  assert.equal(dst().updatedAt, before, '取り込んだ側の更新日時は変えない');
  api.actions.updateItem(srcId, ids.pref, { type: 'radio' });
  assert.equal(dst().screens[0].parts[0].type, 'radio', '種類を変えると、取り込んだ側のアイテムの種類も変わる');
  api.store.undo();
  api.store.undo();
  assert.deepEqual(plain([linked().name, linked().type]), ['都道府県', 'dropdown'], '元に戻すで両方戻る');
  // 設定の欄: 灰色で直せず、元のモックを開く・つながりを切るがある
  api.openDesign(dstId);
  api.selectPart(pid);
  assert.match($(app, '#side-settings .pf-banner.link').textContent, /住所の共通項目.*連動しています/);
  assert.ok($(app, '#side-settings fieldset.pf-sec.locked').disabled);
  assert.equal($(app, '#stage .part .tag.link').textContent, '取り込み');
  click($(app, '#side-settings [data-action="open-link-source"]'));
  assert.equal(api.ui.designId, srcId, '元の画面設計を開く');
  assert.deepEqual([api.ui.panel, api.ui.itemId], ['items', ids.pref], '元の項目を選んだ一覧表');
});

test('つながりを切ると、そのときの中身のこの画面設計だけの項目になり、元を変更しても変わらない', async (t) => {
  const { app, api, dst, srcId, dstId, ids } = await bootTwo(t);
  api.actions.importItems(dstId, srcId, [ids.zip]);
  const id = dst().items[1].id;
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view tr[data-id="${id}"]`));
  assert.ok($(app, '#side-settings fieldset.pf-sec.locked').disabled);
  click($(app, '#side-settings [data-action="unlink-item"]'));
  assert.equal(dst().items[1].link, null);
  assert.equal($(app, '#side-settings fieldset.pf-sec.locked'), null, '直せるようになる');
  api.actions.updateItem(srcId, ids.zip, { label: '郵便番号（7 桁）' });
  assert.equal(dst().items[1].name, '郵便番号', '元を変更しても変わらない');
  assert.equal(api.actions.updateItem(dstId, id, { label: '〒' }), true);
});

test('元の画面設計を完全に削除すると、取り込んだ項目はそのときの中身で固定し、印で知らせる。ごみ箱へ移すときは確かめる', async (t) => {
  const { app, api, dst, src, srcId, dstId, ids } = await bootTwo(t);
  api.actions.importItems(dstId, srcId, [ids.pref, ids.tel]);
  api.goHome();
  click($(app, `.card-more[data-id="${srcId}"]`));
  click($(app, `[data-action="trash"][data-id="${srcId}"]`));
  await settle();
  assert.match($(app, '.modal').textContent, /顧客管理.*取り込んでいます/);
  click($(app, '.modal [data-dlg="ok"]'));
  await settle();
  assert.ok(src().trashedAt);
  assert.equal(dst().items[1].link.lost, false, 'ごみ箱の中にある間はつながったまま');
  api.actions.updateItem(srcId, ids.pref, { label: '県名' });
  assert.equal(dst().items[1].name, '県名');
  api.actions.deleteDesignForever(srcId);
  assert.deepEqual(plain(dst().items.slice(1).map((it) => [it.name, it.link.lost])), [['県名', true], ['電話番号', true]]);
  api.openDesign(dstId);
  click($(app, '[data-action="open-items"]'));
  assert.match($$(app, '#db-view tbody tr')[1].textContent, /取り込み・元なし.*もうありません/);
  click($$(app, '#db-view tbody tr')[1]);
  assert.match($(app, '#side-settings .pf-banner.gone').textContent, /元の画面設計（または元の項目）はもうありません/);
  assert.equal($(app, '#side-settings [data-action="open-link-source"]'), null);
});

test('元の項目を消したときも固定する。取り込んだ項目をさらに取り込んだ側にも、元の変更が届く', async (t) => {
  const { api, dst, srcId, dstId, ids } = await bootTwo(t);
  api.actions.importItems(dstId, srcId, [ids.zip, ids.tel]);
  const thirdId = api.actions.createDesign('受注管理', 'kintone');
  api.actions.importItems(thirdId, dstId, [dst().items[1].id]);
  const third = () => api.store.state.designs.find((d) => d.id === thirdId);
  assert.equal(third().items[0].link.designId, dstId);
  api.actions.updateItem(srcId, ids.zip, { label: '〒' });
  assert.deepEqual(plain([dst().items[1].name, third().items[0].name]), ['〒', '〒'], '2 段先まで届く');
  api.actions.deleteItem(srcId, ids.tel);
  assert.equal(dst().items[2].link.lost, true, '元の項目を消すと固定する');
  assert.equal(dst().items[2].name, '電話番号');
});

test('取り込んだ項目のアイテムを、元の画面設計へ貼り付けると、元の項目を指す', async (t) => {
  const { api, dst, src, srcId, dstId, ids } = await bootTwo(t);
  api.actions.importItems(dstId, srcId, [ids.zip]);
  const pid = api.actions.addItemPart(dstId, dst().screens[0].id, dst().items[1].id, { x: 0, y: 48 });
  api.selectPart(pid);
  api.runCommand('copyPart');
  api.openDesign(srcId);
  api.runCommand('pastePart');
  assert.equal(src().items.length, 3, '項目は増えない');
  assert.equal(src().screens[0].parts[0].itemId, ids.zip);
});

// ── ルックアップ（ほかのデータベースのレコードから値を引く。画像 q22 の案A）──

// 「取引先マスタ」（取引先コード・取引先名・住所）と、「顧客管理」（取引先コード・取引先名。画面に置いてある）を作り、顧客管理を開く
async function bootLookup(t) {
  const ctx = await bootEditor(t, { name: '取引先マスタ' });
  const { api } = ctx;
  const masterId = ctx.design().id;
  const mk = (designId, label, type = 'text1') => {
    const id = api.actions.addItem(designId, type);
    api.actions.updateItem(designId, id, { label });
    return id;
  };
  const m = { code: mk(masterId, '取引先コード'), name: mk(masterId, '取引先名'), addr: mk(masterId, '住所') };
  const custId = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(custId);
  const c = { code: mk(custId, '取引先コード'), name: mk(custId, '取引先名') };
  const sid = ctx.design().screens[0].id;
  const parts = { code: api.actions.addItemPart(custId, sid, c.code, { x: 0, y: 48 }), name: api.actions.addItemPart(custId, sid, c.name, { x: 400, y: 48 }) };
  const cust = () => api.store.state.designs.find((d) => d.id === custId);
  return { ...ctx, masterId, custId, m, c, parts, cust };
}

test('ルックアップ: 探す項目に、元のデータベース・探す元の項目・ほかの項目へのコピーを書き、写す先はその場で作れる', async (t) => {
  const { app, api, masterId, m, c, cust } = await bootLookup(t);
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view tr[data-id="${c.code}"]`));
  check($(app, '#side-settings [data-lk="on"]'), true);
  assert.deepEqual(plain(cust().items[0].lookup), { db: { designId: null, name: '', free: false }, key: { itemId: null, name: '' }, copies: [] });
  assert.deepEqual(plain($$(app, '#side-settings [data-lk="db"] option').map((o) => o.textContent)),
    ['（選んでください）', '取引先マスタ（kintone）', '✎ 一覧にないデータベース（名前を書く）'], '自分は出さない');
  setValue($(app, '#side-settings [data-lk="db"]'), 'd:' + masterId);
  setValue($(app, '#side-settings [data-lk="key"]'), m.code);
  click($(app, '#side-settings [data-action="lk-add"]'));
  setValue($(app, '#side-settings [data-lk="from"][data-i="0"]'), m.name);
  setValue($(app, '#side-settings [data-lk="to"][data-i="0"]'), c.name);
  click($(app, '#side-settings [data-action="lk-add"]'));
  setValue($(app, '#side-settings [data-lk="from"][data-i="1"]'), m.addr);
  setValue($(app, '#side-settings [data-lk="to"][data-i="1"]'), '__new__');
  const items = cust().items;
  assert.equal(items.length, 3, '「住所」を新しく作った');
  assert.deepEqual(plain([items[2].name, items[2].type]), ['住所', 'text1']);
  const lk = items[0].lookup;
  assert.deepEqual(plain([lk.db.designId, lk.key.itemId, lk.copies.map((x) => [x.from.itemId, x.to.itemId])]), plain([masterId, m.code, [[m.name, c.name], [m.addr, items[2].id]]]));
  assert.equal($(app, '#pf-out').textContent, 'ルックアップ＝取引先マスタの「取引先コード」で検索\nほかの項目へのコピー＝取引先名 → 取引先名、住所 → 住所');
  const row = (id) => $(app, `#db-view tr[data-id="${id}"]`).textContent.replace(/\s+/g, ' ');
  assert.match(row(c.code), /ルックアップ 取引先マスタ › 取引先コード ?（この値で取引先マスタを検索する）/);
  assert.match(row(c.name), /ルックアップ 取引先マスタ › 取引先名 ?（取引先コードで引く）/);
  api.store.undo();
  assert.equal(cust().items.length, 2, '元に戻すで、作った項目も消える');
});

test('ルックアップの印: 項目名の後ろに札、探す項目に「取得」、一緒に写される項目は灰色。一覧表に文を書く', async (t) => {
  const { app, api, masterId, m, c, parts, custId } = await bootLookup(t);
  api.actions.updateLookup(custId, c.code, { db: { designId: masterId }, key: { itemId: m.code }, copies: [{ from: { itemId: m.name }, to: { itemId: c.name } }] });
  const el = (id) => $(app, `#stage .part[data-part-id="${id}"]`);
  assert.equal(el(parts.code).querySelector('.reftag').textContent, '⇦ ルックアップ');
  assert.match(el(parts.code).querySelector('.pget').textContent, /取得/);
  assert.ok(el(parts.name).querySelector('.reftag'));
  assert.ok(el(parts.name).querySelector('.pbox.copied'));
  assert.equal(el(parts.name).querySelector('.pph').textContent, '（取引先コードから自動で入る）');
  assert.ok($(app, '.sl-thumb .reftag'), 'ルックアップの札は縮小画像（出力と同じ見た目）にも出す');
  const rows = $$(app, '.ptable tbody tr').map((r) => r.children[3].textContent);
  assert.deepEqual(plain(rows), ['ルックアップ＝取引先マスタの「取引先コード」で検索\nほかの項目へのコピー＝取引先名 → 取引先名', 'ルックアップ＝取引先マスタの「取引先名」（取引先コードで引く）']);
  // 一緒に写される項目の設定の欄から、探す項目の設定を開く
  api.selectPart(parts.name);
  assert.match($(app, '#side-settings .pf-banner.ref').textContent, /「取引先コード」のルックアップで、取引先マスタの「取引先名」が入ります/);
  assert.equal($(app, '#side-settings [data-lk="on"]'), null, '写される項目にはルックアップの欄を出さない');
  click($(app, '#side-settings [data-action="open-lookup-key"]'));
  assert.equal(api.ui.partId, parts.code, '同じ画面の探す項目のアイテムを選ぶ');
  // 元のデータベースの名前を変えると、文も変わる
  api.actions.renameDesign(masterId, '取引先台帳');
  assert.match($(app, '.ptable').textContent, /取引先台帳の「取引先コード」で検索/);
});

test('ルックアップ: 一覧にないデータベースは名前を書く。ルックアップを書けない種類にすると外れる', async (t) => {
  const { app, api, c, cust } = await bootLookup(t);
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view tr[data-id="${c.code}"]`));
  check($(app, '#side-settings [data-lk="on"]'), true);
  setValue($(app, '#side-settings [data-lk="db"]'), '__free__');
  setValue($(app, '#side-settings [data-lk="dbName"]'), '会計システム');
  setValue($(app, '#side-settings [data-lk="keyName"]'), '勘定科目コード');
  click($(app, '#side-settings [data-action="lk-add"]'));
  setValue($(app, '#side-settings [data-lk="fromName"][data-i="0"]'), '勘定科目名');
  setValue($(app, '#side-settings [data-lk="to"][data-i="0"]'), c.name);
  assert.equal($(app, '#pf-out').textContent, 'ルックアップ＝会計システムの「勘定科目コード」で検索\nほかの項目へのコピー＝勘定科目名 → 取引先名');
  click($(app, '#side-settings [data-action="lk-del"][data-i="0"]'));
  assert.equal(cust().items[0].lookup.copies.length, 0);
  setValue($(app, '#side-settings [data-pf="type"]'), 'dropdown');
  assert.equal(cust().items[0].lookup, null, 'ドロップダウンにはルックアップを書けない');
  assert.equal($(app, '#side-settings .lk-box'), null);
});

test('ルックアップのある項目を取り込むと、写す先は名前で指す（取り込んだ側の同じ名前の項目に印が付く）', async (t) => {
  const { api, masterId, m, c, custId } = await bootLookup(t);
  api.actions.updateLookup(custId, c.code, { db: { designId: masterId }, key: { itemId: m.code }, copies: [{ from: { itemId: m.name }, to: { itemId: c.name } }] });
  const orderId = api.actions.createDesign('受注管理', 'kintone');
  const nameId = api.actions.addItem(orderId, 'text1');
  api.actions.updateItem(orderId, nameId, { label: '取引先名' });
  api.actions.importItems(orderId, custId, [c.code]);
  const order = api.store.state.designs.find((d) => d.id === orderId);
  const linked = order.items[1];
  assert.deepEqual(plain(linked.lookup.copies[0].to), { itemId: null, name: '取引先名' });
  const ctx = { design: order, state: api.store.state };
  assert.match(api.describeItem(order.items[0], ctx), /ルックアップ＝取引先マスタの「取引先名」（取引先コードで引く）/);
});

// ── データベースどうしのつながりの図（画像 q23）──

function mouseAt(app, target, type, x, y) {
  target.dispatchEvent(new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}
// 箱を (dx, dy) だけドラッグする。0, 0 なら動かさずに放す（押しただけ）
function dragNode(app, el, dx, dy) {
  mouseAt(app, el, 'mousedown', 100, 100);
  if (dx || dy) mouseAt(app, app.document, 'mousemove', 100 + dx, 100 + dy);
  mouseAt(app, app.document, 'mouseup', 100 + dx, 100 + dy);
}

// 取引先マスタ →（ルックアップ）→ 顧客管理 →（項目の取り込み）→ 受注管理 ←（関連レコード一覧）← 会計システム（一覧にない）。
// つながりのない「日報」と、取引先マスタから取り込んでごみ箱に入れた「古い顧客台帳」も作る
async function bootMap(t) {
  const ctx = await bootLookup(t);
  const { api, masterId, custId, m, c } = ctx;
  api.actions.updateLookup(custId, c.code, { db: { designId: masterId }, key: { itemId: m.code }, copies: [{ from: { itemId: m.name }, to: { itemId: c.name } }] });
  const orderId = api.actions.createDesign('受注管理', 'kintone');
  api.actions.importItems(orderId, custId, [c.name]);
  const order = () => api.store.state.designs.find((d) => d.id === orderId);
  const sid = order().screens[0].id;
  const tid = api.actions.addPart(orderId, sid, 'table', { x: 0, y: 48 });
  api.actions.setTableKind(orderId, sid, tid, 'related');
  api.actions.updatePart(orderId, sid, tid, { label: '請求の履歴', props: { db: { designId: null, name: '会計システム', free: true } } });
  const dailyId = api.actions.createDesign('日報', 'その他');
  const oldId = api.actions.createDesign('古い顧客台帳', 'kintone');
  api.actions.importItems(oldId, masterId, [m.addr]);
  api.actions.trashDesign(oldId);
  const node = (key) => $(ctx.app, `.mnode[data-node="${key}"]`);
  return { ...ctx, orderId, dailyId, oldId, order, node };
}

test('関連図の箱と矢印: ルックアップ・関連レコード一覧は元 → 引く側、取り込みは元 → 取り込んだ側。ごみ箱のものは描かない', async (t) => {
  const { api, masterId, custId, orderId, dailyId } = await bootMap(t);
  const model = api.mapModel(api.store.state);
  const keyName = Object.fromEntries(model.nodes.map((n) => [n.key, n.name]));
  assert.deepEqual(plain(Object.values(keyName).sort()), plain(['取引先マスタ', '顧客管理', '受注管理', '日報', '会計システム'].sort()), '古い顧客台帳（ごみ箱）は描かない');
  assert.equal(model.nodes.find((n) => n.key === 'x:会計システム').design, null, '一覧にないデータベースは名前だけの箱');
  // 矢印の並びは画面設計の並び（更新の新しい順）によるので、種類の順にそろえて比べる
  const kinds = ['lookup', 'link', 'related'];
  assert.deepEqual(plain(model.edges.map((e) => [e.from, e.to, e.kind, e.labels]).sort((a, b) => kinds.indexOf(a[2]) - kinds.indexOf(b[2]))), plain([
    ['d:' + masterId, 'd:' + custId, 'lookup', ['取引先コードで引く\n取引先名']],
    ['d:' + custId, 'd:' + orderId, 'link', ['取引先名']],
    ['x:会計システム', 'd:' + orderId, 'related', ['請求の履歴']],
  ]));
  // 自動で並べる位置: 元を左、引く側を右の列。いちばん元の箱は矢印の先のすぐ左の列へ寄せる。つながりのない箱は、つながった箱の下
  const pos = api.mapLayout(model);
  assert.deepEqual(plain(['d:' + masterId, 'x:会計システム', 'd:' + custId, 'd:' + orderId].map((k) => pos[k].x)), [40, 440, 440, 840],
    '会計システムは受注管理のすぐ左の列（列の幅 400）');
  assert.deepEqual(plain(pos['d:' + dailyId]), { x: 40, y: 296 }, '日報は、いちばん多い列（2 段）の下に 32 あけて置く');
  assert.deepEqual(plain([pos['d:' + custId].y, pos['x:会計システム'].y].sort((a, b) => a - b)), [40, 152], '同じ列は上から 112 ずつ');
  // 編集の画面の図（顧客管理）は、直接つながる箱だけ
  const focus = api.mapModel(api.store.state, custId);
  assert.deepEqual(plain(focus.nodes.map((n) => n.name).sort()), plain(['取引先マスタ', '顧客管理', '受注管理'].sort()));
  assert.deepEqual(plain(focus.edges.map((e) => e.kind).sort()), ['link', 'lookup']);
});

test('関連図: 矢印が輪になっても（ルックアップと関連レコード一覧の行きと帰り）、列は右へ送られ続けず、2 本の線は重ねない', async (t) => {
  const { app, api, masterId, custId, orderId, dailyId } = await bootMap(t);
  // 顧客管理に「受注の履歴」（受注管理のレコードを並べる関連レコード一覧）を置く。受注管理 → 顧客管理 の矢印で輪になる
  const sid = api.store.state.designs.find((d) => d.id === custId).screens[0].id;
  const tid = api.actions.addPart(custId, sid, 'table', { x: 0, y: 200 });
  api.actions.setTableKind(custId, sid, tid, 'related');
  api.actions.updatePart(custId, sid, tid, { label: '受注の履歴', props: { db: { designId: orderId, name: '', free: false } } });
  const model = api.mapModel(api.store.state);
  assert.equal(model.edges.length, 4);
  const pos = api.mapLayout(model);
  assert.deepEqual(plain(['d:' + masterId, 'd:' + custId, 'd:' + orderId].map((k) => pos[k].x)), [40, 440, 840],
    '輪を閉じる矢印（受注管理 → 顧客管理）は列の決め方から外す');
  // 編集の画面の図: 顧客管理と受注管理の間の 2 本は、上下にずらして引く
  api.openDesign(custId);
  click($(app, '[data-action="open-map"]'));
  const starts = $$(app, '#design-map svg > path').map((p) => ({ green: p.getAttribute('stroke') === '#16a34a', m: p.getAttribute('d').match(/^M([\d.]+),([\d.]+)/).slice(1).map(Number) }));
  assert.equal(starts.length, 3, 'ルックアップ・取り込み・関連レコード一覧');
  const link = starts.find((s) => s.green); // 顧客管理 → 受注管理（右向き。顧客管理の右の縁から）
  const back = starts.find((s) => !s.green && s.m[0] === 840); // 受注管理 → 顧客管理（左向き。受注管理の左の縁から）
  assert.deepEqual(plain([link.m[0], [link.m[1], back.m[1]].sort((a, b) => a - b)]), [640, [64, 80]], '箱の真ん中（72）から上下に 8 ずつずらす');
  const orderNode = $(app, `#design-map .mnode[data-node="d:${orderId}"]`);
  assert.match(orderNode.textContent, /関連レコード一覧の元・この画面設計から取り込んでいる/);
  assert.equal(orderNode.style.height, '96px', '役目の行が長いときは 2 行に折り返し、箱も高くする');
});

test('関連図: 線がほかの箱に重なるときは、その箱の上か下の隙間を通す', async (t) => {
  const { app, api, masterId, custId, orderId, dailyId } = await bootMap(t);
  api.goHome();
  click($(app, '[data-action="home-map"]'));
  // 取引先マスタ・日報・顧客管理・受注管理を横 1 列に並べる（取引先マスタ → 顧客管理 の線が、日報の箱に重なる）
  [[masterId, 40], [dailyId, 400], [custId, 760], [orderId, 1120]].forEach(([id, x]) => api.actions.setMapPos(null, 'd:' + id, { x, y: 296 }));
  api.actions.setMapPos(null, 'x:会計システム', { x: 760, y: 40 });
  const ds = $$(app, '#home-map svg > path').map((p) => p.getAttribute('d'));
  const lookup = ds.find((d) => d.startsWith('M240.0,328.0'));
  assert.equal(lookup, 'M240.0,328.0 C306.0,328.0 306.0,272.0 372.0,272.0 L628.0,272.0 C694.0,272.0 694.0,328.0 760.0,328.0',
    '日報の箱（400〜600）の手前で上の隙間（箱の上の 24 上）へ曲がり、過ぎてから顧客管理へ下りる');
  assert.ok(ds.filter((d) => d !== lookup).every((d) => !d.includes(' L')), 'ほかの線は重ならないので、そのまま引く');
});

test('最初の画面: 「関連図」に切り替えると、名前で検索欄・カード・ごみ箱の代わりに図を出す。箱を押すとその画面設計を開く', async (t) => {
  const { app, api, masterId, node } = await bootMap(t);
  api.goHome();
  click($(app, '[data-action="home-map"]'));
  assert.equal(api.ui.homeMap, true);
  assert.ok($(app, '[data-action="home-map"]').classList.contains('on'));
  assert.equal($(app, '#home-search'), null);
  assert.equal($(app, '#home-cards'), null);
  assert.equal($(app, '#home-trash'), null);
  assert.equal($$(app, '#home-map .mnode').length, 5);
  assert.match(node('x:会計システム').textContent, /会計システム\s*一覧にないデータベース/);
  assert.ok(node('x:会計システム').classList.contains('ext'), '一覧にないデータベースは点線の箱');
  assert.match(node('d:' + masterId).textContent, /取引先マスタ.*項目 3 個・画面 1/);
  assert.equal($$(app, '#home-map svg > path').length, 3, '矢印 3 本');
  const num = '-?[\\d.]+,-?[\\d.]+';
  $$(app, '#home-map svg > path').forEach((p) => assert.match(p.getAttribute('d'), new RegExp(`^M${num} C${num} ${num} ${num}$`), '曲線は始まりの点・2 つの曲げる点・終わりの点'));
  assert.ok($(app, '.home').classList.contains('wide'), '図のときは横の幅を画面いっぱいに使う');
  const svgText = $(app, '#home-map svg').textContent;
  ['取引先コードで引く', '取り込み: 取引先名', '関連レコード一覧', '請求の履歴'].forEach((s) => assert.ok(svgText.includes(s), s));
  // 一覧にないデータベースの箱は、押しても開かない
  dragNode(app, node('x:会計システム'), 0, 0);
  assert.equal(api.ui.view, 'home');
  // 画面設計の箱を押すと開く
  dragNode(app, node('d:' + masterId), 0, 0);
  assert.equal(api.ui.view, 'editor');
  assert.equal(api.ui.designId, masterId);
  // 最初の画面に戻っても、図のままにしておく。カードに戻せる
  api.goHome();
  assert.ok($(app, '#home-map'));
  click($(app, '[data-action="home-cards"]'));
  assert.equal(api.ui.homeMap, false);
  assert.ok($(app, '#home-cards'));
  assert.ok($(app, '#home-search'));
});

test('最初の画面の図: ボックスをドラッグで動かすと位置を覚え（マス目に吸い付く）、更新日時は変えない。「自動で並べ直す」で戻す', async (t) => {
  const { app, api, dailyId, node } = await bootMap(t);
  api.goHome();
  click($(app, '[data-action="home-map"]'));
  const before = api.store.state.designs.find((d) => d.id === dailyId).updatedAt;
  assert.deepEqual([node('d:' + dailyId).style.left, node('d:' + dailyId).style.top], ['40px', '296px']);
  dragNode(app, node('d:' + dailyId), 50, 30);
  assert.deepEqual(plain(api.store.state.settings.mapPos), { ['d:' + dailyId]: { x: 88, y: 328 } }, '8 ドットのマス目に吸い付く');
  assert.equal(api.ui.view, 'home', '動かしたときは開かない');
  assert.deepEqual([node('d:' + dailyId).style.left, node('d:' + dailyId).style.top], ['88px', '328px'], '描き直しても動かした位置');
  assert.equal(api.store.state.designs.find((d) => d.id === dailyId).updatedAt, before);
  click($(app, '[data-action="map-reset"]'));
  assert.deepEqual(plain(api.store.state.settings.mapPos), {});
  assert.equal(node('d:' + dailyId).style.left, '40px');
  api.store.undo();
  assert.deepEqual(plain(api.store.state.settings.mapPos), { ['d:' + dailyId]: { x: 88, y: 328 } }, '元に戻すで、覚えた位置も戻る');
  // 左や上へは 0 より外に出さない
  dragNode(app, node('d:' + dailyId), -5000, -5000);
  assert.deepEqual(plain(api.store.state.settings.mapPos['d:' + dailyId]), { x: 0, y: 0 });
});

test('編集の画面: 左の一覧の「関連図」で、この画面設計と直接つながる画面設計だけの図を出し、位置は画面設計ごとに覚える', async (t) => {
  const { app, api, masterId, custId, orderId, node, cust } = await bootMap(t);
  api.openDesign(custId);
  assert.match($(app, '[data-action="open-map"]').textContent, /関連図\s*2 つと関連している/);
  click($(app, '[data-action="open-map"]'));
  assert.equal(api.ui.panel, 'map');
  assert.ok($(app, '[data-action="open-map"]').classList.contains('active'));
  assert.equal($(app, '#db-view').hidden, false);
  assert.equal($(app, '#canvas-wrap').hidden, true);
  assert.equal($(app, '#side-panel').hidden, true, '右のパネルは隠して、図を広く見せる');
  assert.match($(app, '#db-view .map-note').textContent, /「顧客管理」と、直接関連する画面設計を描きます/);
  assert.equal($$(app, '#design-map .mnode').length, 3);
  assert.ok(node('d:' + custId).classList.contains('cur'));
  assert.match(node('d:' + custId).textContent, /顧客管理（この画面設計）/);
  assert.match(node('d:' + masterId).textContent, /ルックアップ元/);
  assert.match(node('d:' + orderId).textContent, /この画面設計から取り込んでいる/);
  assert.deepEqual([node('d:' + masterId).style.height, node('d:' + orderId).style.height], ['80px', '80px'], '役目の行の分だけ箱を高くする');
  // 動かすと、この画面設計に位置を覚える（最初の画面の図とは別。更新日時は変えない）
  const before = cust().updatedAt;
  dragNode(app, node('d:' + masterId), 16, 16);
  assert.deepEqual(plain(cust().mapPos), { ['d:' + masterId]: { x: 56, y: 56 } });
  assert.deepEqual(plain(api.store.state.settings.mapPos), {});
  assert.equal(cust().updatedAt, before);
  assert.equal(api.ui.panel, 'map', '描き直しても図のまま');
  // この画面設計の箱は押しても開かない。ほかの画面設計の箱を押すと開く
  dragNode(app, node('d:' + custId), 0, 0);
  assert.equal(api.ui.designId, custId);
  click($(app, '#db-view [data-action="map-reset"]'));
  assert.deepEqual(plain(cust().mapPos), {});
  dragNode(app, node('d:' + orderId), 0, 0);
  assert.equal(api.ui.designId, orderId);
  assert.equal($(app, '#side-panel').hidden, false, '開いた画面設計は画面を出すので、右のパネルも出す');
  assert.match($(app, '[data-action="open-map"]').textContent, /2 つと関連している/, '受注管理は、顧客管理と会計システムにつながる');
});

test('関連図の位置: 読み込むときに、形の合わない位置は捨てる。画面設計がないときは案内を出す', async (t) => {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const { state } = api.migrate({
    schemaVersion: 2,
    settings: { mapPos: { 'd:a': { x: '16', y: 8 }, 'd:b': { x: 'あ', y: 1 }, 'd:c': 3 } },
    designs: [{ id: 'd1', name: '顧客管理', screens: [{ id: 's1', parts: [] }], mapPos: { 'x:会計システム': { x: 40, y: 152 }, bad: null } }],
  });
  assert.deepEqual(plain(state.settings.mapPos), { 'd:a': { x: 16, y: 8 } });
  assert.deepEqual(plain(state.designs[0].mapPos), { 'x:会計システム': { x: 40, y: 152 } });
  click($(app, '[data-action="home-map"]'));
  assert.match($(app, '#home-map').textContent, /まだ画面設計がありません/);
});

// ── 見直し用のエージェントが見つけた不具合（データの形と項目）──

test('何も変わらなかった変更は、元に戻すの履歴に積まない（打ちかけの欄の保存し直しで、元に戻すが空振りしない）', async (t) => {
  const { api, design, items, add } = await bootEditor(t);
  add('text1');
  const id = items()[0].id;
  api.actions.updateItem(design().id, id, { label: '顧客名' });
  const n = api.store.undoStack.length;
  api.actions.updateItem(design().id, id, { label: '顧客名' });
  assert.equal(api.store.undoStack.length, n, '同じ名前で直しても積まない');
  api.store.undo();
  assert.equal(items()[0].name, '項目名', '1 回の元に戻すで、名前を直す前に戻る');
  assert.equal(api.store.canRedo(), true);
  api.actions.updateItem(design().id, id, { label: '項目名' });
  assert.equal(api.store.canRedo(), true, '何も変わらない保存では、やり直すも消えない');
});

test('貼り付け: コピーした後で項目の種類を変えていたら、貼ったアイテムの種類も項目に合わせる', async (t) => {
  const { app, api, design, items, add } = await bootEditor(t);
  const pid = add('text1');
  api.selectPart(pid);
  api.runCommand('copyPart');
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view tr[data-id="${items()[0].id}"]`));
  setValue($(app, '#side-settings [data-pf="type"]'), 'number');
  const sid2 = addScreen(api, design().id, '詳細');
  api.openDesign(design().id);
  click($(app, `[data-action="select-screen"][data-id="${sid2}"]`));
  api.runCommand('pastePart');
  const pasted = api.currentScreen().parts[0];
  assert.deepEqual(plain([pasted.itemId, pasted.type]), plain([items()[0].id, 'number']), 'ほかの画面へは同じ項目を指し、種類は数値');
});

test('貼り付け: 一覧表から消した項目のアイテムをコピーしていても、消した項目は生き返らない', async (t) => {
  const { api, design, screen, items, add } = await bootEditor(t);
  const pid = add('text1');
  const oldId = items()[0].id;
  api.selectPart(pid);
  api.runCommand('copyPart');
  api.actions.deleteItem(design().id, oldId);
  api.runCommand('pastePart');
  const [orphan, pasted] = screen().parts;
  assert.equal(api.findItem(design(), oldId), null, '消した項目は一覧表に戻らない');
  assert.equal(orphan.label, '項目名', '消した後に残ったアイテムは、固定したまま');
  assert.notEqual(pasted.itemId, oldId);
  assert.ok(api.findItem(design(), pasted.itemId), '貼ったアイテムは、新しい id の写しを指す');
});

test('ステータスの項目は画面設計に 1 つだけ: ほかの画面設計へ貼る・取り込む・一覧表に戻すのどれでも 2 つにならない', async (t) => {
  const { api, design, add } = await bootEditor(t, { name: '受注管理' });
  const aId = design().id;
  api.selectPart(add('status'));
  api.runCommand('copyPart');
  const bId = api.actions.createDesign('案件管理', 'kintone');
  api.openDesign(bId);
  add('steps');
  const statusOf = () => design().items.filter((it) => it.type === 'status');
  const bStatus = statusOf()[0].id;
  api.runCommand('pastePart');
  assert.equal(statusOf().length, 1, '貼っても 1 つ');
  assert.ok(api.currentScreen().parts.every((p) => p.itemId === bStatus), '貼ったアイテムは、案件管理のステータスを指す');
  // 取り込む: 案件管理にはもうあるので、受注管理のステータスは取り込まない
  const aStatus = api.store.state.designs.find((d) => d.id === aId).items[0].id;
  assert.equal(api.actions.importItems(bId, aId, [aStatus]), 0);
  // 一覧表に戻す: 消した後に新しいステータスができていたら、残った部品はそのステータスへつなぎ直す
  api.actions.deleteItem(bId, bStatus);
  add('status');
  const fresh = statusOf()[0].id;
  assert.notEqual(fresh, bStatus);
  api.actions.restoreItem(bId, bStatus);
  assert.deepEqual(plain(statusOf().map((it) => it.id)), [fresh]);
  assert.ok(api.currentScreen().parts.every((p) => p.itemId === fresh && p.label === undefined), '3 つとも新しいステータスを指す');
});

test('項目一覧に戻す: 1 つの画面に同じ項目のアイテムが 2 つ残っていたら、2 つ目は項目の写しを指す', async (t) => {
  const { api, design, screen, items, add } = await bootEditor(t);
  add('text1');
  const id = items()[0].id;
  api.actions.deleteItem(design().id, id);
  api.selectPart(screen().parts[0].id);
  api.runCommand('duplicatePart');
  assert.equal(screen().parts.length, 2);
  assert.notEqual(screen().parts[1].itemId, id, '同じ画面に複製すると、別の項目として残す');
  // 読み込んだデータなどで、同じ項目の部品が 1 つの画面に 2 つ残っているとき
  api.store.commit((s) => { s.designs[0].screens[0].parts[1].itemId = id; });
  api.actions.restoreItem(design().id, id);
  const ids = screen().parts.map((p) => p.itemId);
  assert.equal(ids[0], id);
  assert.notEqual(ids[1], id);
  assert.equal(items().length, 2, '写しの項目が 1 つ増える');
  assert.deepEqual(plain(items().map((it) => it.name)), ['項目名', '項目名']);
});

test('画面設計の複製: 吹き出しのつなぐアイテムと、リンクの移動先を、複製の中のアイテムと画面に付け直す', async (t) => {
  const { api, design, screen, add } = await bootEditor(t);
  const did = design().id;
  const sid = screen().id;
  const pid = add('text1');
  api.actions.addCallout(did, sid, { x: -232, y: 48 }, pid);
  const lid = api.actions.addPart(did, sid, 'link', { x: 0, y: 400 });
  api.actions.updatePart(did, sid, lid, { props: { to: 'screen', screenId: sid } });
  const copyId = api.actions.duplicateDesign(did);
  const copy = api.store.state.designs.find((d) => d.id === copyId);
  const cs = copy.screens[0];
  assert.notEqual(cs.id, sid);
  assert.equal(cs.callouts[0].target, cs.parts[0].id, '吹き出しは複製のアイテムにつなぐ');
  assert.equal(cs.parts.find((p) => p.type === 'link').props.screenId, cs.id, 'リンクは複製の画面へ移る');
  assert.equal(screen().callouts[0].target, pid, '元はそのまま');
});

test('壊れた保存データ: 項目を指さないアイテムの itemId・項目を消した後のアイテムの壊れたルックアップ・重なった画面設計の id でも落ちない', async (t) => {
  const { app, api } = await bootEditor(t);
  const { state } = api.migrate({
    schemaVersion: 2,
    designs: [
      { id: 'd1', name: '顧客管理', items: [{ id: 'i1', name: '明細', type: 'table', props: { columns: [] } }], screens: [{ id: 's1', parts: [
        { id: 'p1', type: 'table', tableKind: 'records', itemId: 'i1', x: 0, y: 48, label: '一覧', props: {} },
        { id: 'p2', type: 'text1', itemId: 'gone', x: 0, y: 240, label: '取引先コード', lookup: {}, link: 'x' },
      ] }] },
      { id: 'd1', name: '顧客管理（重なった id）', screens: [{ id: 's1', parts: [] }] },
    ],
  });
  const [d1, d2] = state.designs;
  assert.equal(d1.screens[0].parts[0].itemId, undefined, 'レコード一覧の表は項目を指さない');
  assert.deepEqual(plain(d1.screens[0].parts[1].lookup.key), { itemId: null, name: '' }, 'ルックアップを直す');
  assert.equal(d1.screens[0].parts[1].link, null);
  assert.notEqual(d2.id, d1.id, '重なった画面設計の id は付け直す');
  api.store.commit((s) => { s.designs = state.designs; });
  api.openDesign(d1.id);
  assert.equal($$(app, '#stage .part').length, 2, '開いて描ける');
});

test('表の中身をテーブルから変えても、ほかの画面設計が取り込んでいる表の項目は消さない', async (t) => {
  const { api, design, screen, items, add } = await bootEditor(t, { name: '取引先マスタ' });
  const masterId = design().id;
  const tid = add('table');
  const tableItem = items()[0].id;
  const orderId = api.actions.createDesign('受注管理', 'kintone');
  api.actions.importItems(orderId, masterId, [tableItem]);
  api.actions.setTableKind(masterId, screen().id, tid, 'records');
  assert.ok(api.findItem(design(), tableItem), '取り込まれている表の項目は残す');
  const order = api.store.state.designs.find((d) => d.id === orderId);
  assert.equal(order.items[0].link.lost, false, '取り込んだ側は「元なし」にならない');
});

test('項目一覧で表の項目を選んだとき、右のパネルの「設定」の文は一覧表の文と同じ', async (t) => {
  const { app, items, add } = await bootEditor(t);
  add('table');
  click($(app, '[data-action="open-items"]'));
  click($(app, `#db-view tr[data-id="${items()[0].id}"]`));
  const row = $(app, `#db-view tr[data-id="${items()[0].id}"]`);
  assert.notEqual($(app, '#pf-out').textContent, '（まだありません）');
  assert.ok(row.textContent.replace(/\s+/g, '').includes($(app, '#pf-out').textContent.replace(/\s+/g, '')));
});

// ── 見直し用のエージェントが見つけた不具合（つながりの図）──

test('関連図: 箱を押すときに手が少しぶれても（吸い付けた位置が元と同じなら）、押しただけとして開き、履歴にも積まない', async (t) => {
  const { app, api, masterId, node } = await bootMap(t);
  api.goHome();
  click($(app, '[data-action="home-map"]'));
  const n = api.store.undoStack.length;
  dragNode(app, node('d:' + masterId), 3, 1);
  assert.equal(api.ui.view, 'editor');
  assert.equal(api.ui.designId, masterId);
  assert.deepEqual(plain(api.store.state.settings.mapPos), {}, '位置は覚えない');
  assert.ok(api.store.undoStack.length <= n);
});

test('関連図: 後から足した画面設計の箱は、ドラッグして覚えた箱と重ならない所に置く', async (t) => {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  ['顧客管理', '受注管理', '日報'].forEach((name) => api.actions.createDesign(name, 'kintone'));
  click($(app, '[data-action="home-map"]'));
  const first = $$(app, '#home-map .mnode')[0];
  api.actions.setMapPos(null, first.dataset.node, { x: 760, y: 40 }); // 4 つ目の箱が自動で置かれる所
  api.actions.createDesign('予定表', 'kintone');
  const rects = $$(app, '#home-map .mnode').map((e) => [parseFloat(e.style.left), parseFloat(e.style.top), parseFloat(e.style.height)]);
  assert.equal(rects.length, 4);
  rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
    const apart = a[0] + 200 <= b[0] || b[0] + 200 <= a[0] || a[1] + a[2] <= b[1] || b[1] + b[2] <= a[1];
    assert.ok(apart, `重ならない: ${JSON.stringify([a, b])}`);
  }));
});
