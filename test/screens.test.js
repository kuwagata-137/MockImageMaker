'use strict';
// 複数の画面（第 4 段階）のテスト。ひな形から画面を足す・複製・並べ替え・消す、画面の一覧の「…」のメニュー、
// 「画面を足す」の窓、PageUp・PageDown、保存して開き直したときの順番。
// 画面の縮小画像のドラッグでの並べ替えは、jsdom では要素の位置が取れないので tools/shoot-app.js（--only=screens）で確かめる。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const dblclick = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('dblclick', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (app, target, init) => target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 白紙の画面 1 つの画面設計を開いた状態で起動する
async function bootEditor(t, opts = {}) {
  const app = bootApp(opts);
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(id);
  const design = () => api.currentDesign();
  const names = () => plain(design().screens.map((s) => s.name));
  const screenOf = (sid) => design().screens.find((s) => s.id === sid);
  // 項目を指す入力欄の部品を置き、項目名を付ける
  const addItem = (sid, type, label, y = 48) => {
    const pid = api.actions.addPart(id, sid, type, { x: 0, y });
    api.actions.updatePart(id, sid, pid, { label });
    return pid;
  };
  return { app, api, id, design, names, screenOf, addItem };
}

test('ひな形から画面を足す: 開いている画面のすぐ後ろに入り、名前はひな形の名前（重なれば「一覧 2」）。白紙は番号の名前', async (t) => {
  const { api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  assert.deepEqual(plain(api.SCREEN_TEMPLATES.map((x) => x.name)), ['白紙', '入力', '詳細', '一覧', 'グラフ', '集計', '進み具合']);
  const a = api.actions.addScreen(id, 'list', s1);
  assert.deepEqual(names(), ['画面 1', '一覧']);
  api.actions.addScreen(id, 'list', s1);
  assert.deepEqual(names(), ['画面 1', '一覧 2', '一覧'], 'すぐ後ろに入る。同じ名前があれば番号を付ける');
  const b = api.actions.addScreen(id, 'blank', a);
  assert.deepEqual(names(), ['画面 1', '一覧 2', '一覧', '画面 4']);
  const s = design().screens.find((x) => x.id === b);
  assert.deepEqual(plain([s.device, s.width, s.height, s.showHeader, s.tablePos, s.parts.length]), ['pc', 1280, 800, true, 'right', 0], '機器はパソコン。白紙は帯だけ');
  assert.equal(api.actions.addScreen(id, 'nothing', s1), null, '知らないひな形では足さない');
  api.store.undo();
  assert.deepEqual(names(), ['画面 1', '一覧 2', '一覧'], '元に戻すで消える');
});

test('ひな形の中身: 入力・詳細・進み具合は、項目がなければ見本の項目を 3 つ作り、項目を 2 列で並べる', async (t) => {
  const { api, id, design, screenOf } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const input = screenOf(api.actions.addScreen(id, 'input', s1));
  assert.deepEqual(plain(design().items.map((it) => [it.type, it.name])), [['text1', '項目名 1'], ['date', '項目名 2'], ['dropdown', '項目名 3']]);
  const [i1, i2, i3] = design().items.map((it) => it.id);
  const pos = (p) => [p.x, p.y];
  assert.deepEqual(plain(input.parts.map((p) => p.itemId || p.label)), [i1, i2, i3, '保存', 'キャンセル']);
  assert.deepEqual(plain(input.parts.map(pos)), [[32, 64], [480, 64], [32, 152], [32, 248], [160, 248]], '2 列で並べ、下にボタン');
  assert.deepEqual(plain(input.parts.filter((p) => p.type === 'button').map((p) => p.props.style)), ['primary', 'normal']);
  assert.deepEqual(plain(input.parts.map((p) => p.no)), [1, 2, 3, 4, 5], '番号は置いた順');

  const detail = screenOf(api.actions.addScreen(id, 'detail', input.id));
  assert.equal(design().items.length, 3, '項目がもうあれば、見本の項目は作らない');
  assert.deepEqual(plain(detail.parts.map((p) => p.itemId || p.label)), ['編集', '削除', i1, i2, i3]);
  assert.deepEqual(plain(detail.parts.slice(0, 2).map(pos)), [[1024, 56], [1152, 56]], '右上に編集・削除');

  const steps = screenOf(api.actions.addScreen(id, 'steps', detail.id));
  const status = design().items.find((it) => it.type === 'status');
  assert.ok(status, 'ステータスの項目がなければ作る');
  const waiting = status.props.states.find((s) => s.name === '承認待ち').id; // 見本で出すステータスは id で持つ（データの形の版 3）
  assert.deepEqual(plain(steps.parts.slice(0, 2).map((p) => [p.type, p.itemId, p.view.current])), [['steps', status.id, waiting], ['status', status.id, waiting]]);
  assert.deepEqual(plain(steps.parts.slice(-2).map((p) => p.label)), ['承認する', '差し戻す']);
  api.actions.addScreen(id, 'steps', steps.id);
  assert.equal(design().items.filter((it) => it.type === 'status').length, 1, 'ステータスの項目は 1 つだけ');
});

test('ひな形の中身: 項目の一覧表の項目を全部並べ、テーブルは下に置き、画面が足りなければ下へ伸ばす。部品は重ならない', async (t) => {
  const { api, id, design, screenOf, addItem } = await bootEditor(t);
  const s1 = design().screens[0].id;
  ['顧客コード', '顧客名', '電話番号', 'メール', '住所', '担当者', '業種', '従業員数', '資本金', '設立日', '取引開始日', '備考'].forEach((n, i) => addItem(s1, i === 11 ? 'text2' : 'text1', n, 48 + i * 72));
  api.actions.addPart(id, s1, 'table', { x: 0, y: 48 });
  const items = design().items;
  const input = screenOf(api.actions.addScreen(id, 'input', s1));
  assert.equal(design().items.length, items.length, '項目は増えない');
  assert.deepEqual(plain(input.parts.filter((p) => p.itemId).map((p) => p.itemId)), plain(items.map((it) => it.id)), '一覧表の順に全部');
  const table = input.parts.find((p) => p.type === 'table');
  const lastInput = input.parts.filter((p) => p.itemId && p.type !== 'table').pop();
  assert.ok(table.y > lastInput.y, 'テーブルは入力欄の下');
  assert.equal(table.tableKind, 'subtable');
  assert.ok(input.height > 800, '画面を下へ伸ばす');
  assert.ok(input.parts.every((p) => p.y + p.h <= input.height), '部品は画面からはみ出さない');
  // 項目名のない部品（ボタン・検索・絞り込みなど）の番号の札は、部品の左の外（左 28 ドットから 24 ドットの幅）に付く。札が隣の部品に重ならないこと
  // （一覧のひな形で、絞り込みの札が検索の欄の「検索」ボタンに重なっていた。デバッグとリリースの見直し⑥-1）
  const OUT_NO_TYPES = ['button', 'search', 'filter', 'pager', 'status', 'steps', 'tabs', 'link'];
  const outNoRect = (p) => ({ x: p.x - 28, y: p.y + p.h / 2 - 10, w: 24, h: 20 });
  for (const tid of ['input', 'detail', 'list', 'graph', 'agg', 'steps']) {
    const s = screenOf(api.actions.addScreen(id, tid, s1));
    s.parts.forEach((a, i) => s.parts.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${tid}: ${a.type} と ${b.type} が重なる`)));
    s.parts.filter((a) => a.no != null && a.x >= 28 && OUT_NO_TYPES.includes(a.type)).forEach((a) => s.parts.filter((b) => b !== a)
      .forEach((b) => assert.ok(!overlaps(outNoRect(a), b), `${tid}: ${a.type} の番号の札が ${b.type} に重なる`)));
  }
});

test('ひな形の中身: 一覧はレコード一覧（列は項目の最初の 4 つ）、グラフは棒と円、集計は表と横棒。どれも項目にはならない', async (t) => {
  const { api, id, design, screenOf, addItem } = await bootEditor(t);
  const s1 = design().screens[0].id;
  ['顧客コード', '顧客名', '区分', '担当者', '電話番号'].forEach((n, i) => addItem(s1, 'text1', n, 48 + i * 72));
  const n = design().items.length;
  const list = screenOf(api.actions.addScreen(id, 'list', s1));
  assert.deepEqual(plain(list.parts.map((p) => [p.type, p.no])), [['search', 1], ['filter', 2], ['button', 3], ['table', 4], ['pager', 5]]);
  const tb = list.parts[3];
  assert.deepEqual(plain([tb.tableKind, tb.w, tb.view.rows, tb.props.columns.map((c) => c.ref.name)]), ['records', 1216, 8, ['顧客コード', '顧客名', '区分', '担当者']]);
  assert.equal(list.parts[2].label, '＋ 新規登録');
  const graph = screenOf(api.actions.addScreen(id, 'graph', s1));
  assert.deepEqual(plain(graph.parts.map((p) => p.type === 'graph' ? p.props.chart : p.type)), ['filter', 'bar', 'pie']);
  const agg = screenOf(api.actions.addScreen(id, 'agg', s1));
  assert.deepEqual(plain(agg.parts.map((p) => p.type === 'graph' ? p.props.chart : p.tableKind || p.type)), ['filter', 'records', 'hbar']);
  assert.equal(design().items.length, n, '項目は増えない');
});

test('画面の複製: すぐ後ろに入り「◯◯ のコピー」。部品と吹き出しの id は新しく、同じ項目を指す。吹き出しのつなぐ部品と、自分を指すリンクの文字は付け直す', async (t) => {
  const { api, id, design, names, screenOf, addItem } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const pid = addItem(s1, 'text1', '顧客名');
  const toSelf = api.actions.addPart(id, s1, 'link', { x: 0, y: 200 });
  api.actions.updatePart(id, s1, toSelf, { props: { to: 'screen', screenId: s1 } });
  const toOther = api.actions.addPart(id, s1, 'link', { x: 0, y: 240 });
  api.actions.updatePart(id, s1, toOther, { props: { to: 'screen', screenId: s2 } });
  api.actions.addCallout(id, s1, { x: 600, y: 100 }, pid);
  const c = screenOf(api.actions.duplicateScreen(id, s1));
  assert.deepEqual(names(), ['画面 1', '画面 1 のコピー', '画面 2']);
  const src = screenOf(s1);
  assert.ok(c.parts.every((p) => !src.parts.some((q) => q.id === p.id)), '部品の id は新しい');
  assert.notEqual(c.callouts[0].id, src.callouts[0].id);
  assert.equal(c.callouts[0].target, c.parts[0].id, '吹き出しは写した部品につながる');
  assert.equal(c.parts[0].itemId, src.parts[0].itemId, '同じ項目を指す');
  assert.equal(design().items.length, 1, '項目は増えない');
  assert.deepEqual(plain(c.parts.slice(1).map((p) => p.props.screenId)), [c.id, s2], '自分を指すリンクの文字は新しい画面へ、ほかの画面へのものはそのまま');
  api.actions.duplicateScreen(id, s1);
  assert.equal(names()[1], '画面 1 のコピー 2', '名前が重なれば番号を付ける');
});

test('画面設計の複製でも、画面・部品・吹き出し・リンクの文字の移る先を付け直す（画面の複製と同じ作りを使う）', async (t) => {
  const { api, id, design, addItem } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const pid = addItem(s1, 'text1', '顧客名');
  const link = api.actions.addPart(id, s1, 'link', { x: 0, y: 200 });
  api.actions.updatePart(id, s1, link, { props: { to: 'screen', screenId: s2 } });
  api.actions.addCallout(id, s1, { x: 600, y: 100 }, pid);
  const cid = api.actions.duplicateDesign(id);
  const copy = api.store.state.designs.find((d) => d.id === cid);
  const [c1, c2] = copy.screens;
  assert.ok(c1.id !== s1 && c2.id !== s2);
  assert.equal(c1.parts.find((p) => p.type === 'link').props.screenId, c2.id);
  assert.equal(c1.callouts[0].target, c1.parts[0].id);
  assert.equal(c1.parts[0].itemId, design().screens[0].parts[0].itemId, '項目の id はそのまま');
});

test('並べ替え: moveScreen と「…」のメニューの上へ・下へ。動かないときは履歴に積まない', async (t) => {
  const { app, api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const a = api.actions.addScreen(id, 'input', s1);
  const b = api.actions.addScreen(id, 'list', a);
  assert.deepEqual(names(), ['画面 1', '入力', '一覧']);
  assert.equal(api.actions.moveScreen(id, b, 0), true);
  assert.deepEqual(names(), ['一覧', '画面 1', '入力']);
  assert.equal(api.actions.moveScreen(id, b, 1), false, '同じ所へは動かさない');
  assert.equal(api.actions.moveScreen(id, b, 9), false);
  api.actions.moveScreen(id, b, 3);
  assert.deepEqual(names(), ['画面 1', '入力', '一覧']);
  api.store.undo();
  assert.deepEqual(names(), ['一覧', '画面 1', '入力'], '元に戻すで戻る');
  api.store.redo();
  // 「…」のメニュー
  click($(app, `.sl-more[data-id="${a}"]`));
  assert.ok($(app, '.screen-menu'), 'メニューが開く');
  click($(app, `.screen-menu [data-action="screen-up"]`));
  assert.equal($(app, '.screen-menu'), null, '押すと閉じる');
  assert.deepEqual(names(), ['入力', '画面 1', '一覧']);
  click($(app, `.sl-more[data-id="${a}"]`));
  assert.equal($(app, '.screen-menu [data-action="screen-up"]').disabled, true, 'いちばん上は上へ動かせない');
  click($(app, '.screen-menu [data-action="screen-down"]'));
  assert.deepEqual(names(), ['画面 1', '入力', '一覧']);
  click($(app, `.sl-more[data-id="${b}"]`));
  assert.equal($(app, '.screen-menu [data-action="screen-down"]').disabled, true, 'いちばん下は下へ動かせない');
  click($(app, '#stage'));
  assert.equal($(app, '.screen-menu'), null, '外を押すと閉じる');
  click($(app, `.sl-more[data-id="${b}"]`));
  key(app, app.document.body, { key: 'Escape' });
  assert.equal($(app, '.screen-menu'), null, 'Esc で閉じる');
});

test('画面を消す: 確かめの窓に部品・吹き出し・リンクの文字の数を書く。項目は残り、移る先は外れる。元に戻すで戻る', async (t) => {
  const { app, api, id, design, names, screenOf, addItem } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const s3 = api.actions.addScreen(id, 'blank', s2);
  addItem(s2, 'text1', '顧客名');
  api.actions.addCallout(id, s2, { x: 600, y: 100 });
  const link = api.actions.addPart(id, s1, 'link', { x: 0, y: 200 });
  api.actions.updatePart(id, s1, link, { props: { to: 'screen', screenId: s2 } });
  click($(app, `.sl-item[data-id="${s2}"]`));
  assert.equal(api.ui.screenId, s2);
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  const text = $(app, '.modal').textContent;
  assert.match(text, /「画面 2」の画面を削除しますか/);
  assert.match(text, /部品 1 個と吹き出し 1 個が消えます/);
  assert.match(text, /項目の一覧表に残ります/);
  assert.match(text, /リンクの文字 1 個が、この画面を移る先にしています/);
  assert.equal(app.document.activeElement, $(app, '.modal [data-dlg="cancel"]'), '最初はキャンセルを選んだ状態');
  click($(app, '.modal [data-dlg="cancel"]'));
  await tick();
  assert.equal(names().length, 3, 'キャンセルでは消さない');
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.deepEqual(names(), ['画面 1', '画面 3']);
  assert.equal(api.ui.screenId, s3, '消した画面のすぐ下の画面を開く');
  assert.equal(design().items.length, 1, '項目は一覧表に残る');
  assert.equal(screenOf(s1).parts.find((p) => p.id === link).props.screenId, '', 'リンクの文字の移る先は外れる');
  api.store.undo();
  assert.deepEqual(names(), ['画面 1', '画面 2', '画面 3'], '元に戻すで戻る');
  assert.equal(screenOf(s1).parts.find((p) => p.id === link).props.screenId, s2);
  // いちばん下の画面を消すと、すぐ上の画面を開く
  click($(app, `.sl-item[data-id="${s3}"]`));
  click($(app, `.sl-more[data-id="${s3}"]`));
  click($(app, '.screen-menu [data-action="screen-del"]'));
  await waitFor(() => $(app, '.modal'));
  assert.match($(app, '.modal').textContent, /部品も吹き出しもありません/);
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.equal(api.ui.screenId, s2);
});

test('画面を消す: 最後の 1 つの画面は消せない（ボタンとメニューは押せない・命令では知らせる）', async (t) => {
  const { app, api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  assert.equal($(app, '#tb-del-screen').disabled, true);
  click($(app, `.sl-more[data-id="${s1}"]`));
  assert.equal($(app, '.screen-menu [data-action="screen-del"]').disabled, true);
  api.runCommand('deleteScreen');
  await tick();
  assert.equal($(app, '.modal'), null, '窓は出さない');
  assert.match($(app, '#toast').textContent, /最後の 1 つの画面は消せません/);
  assert.equal(api.actions.deleteScreen(id, s1), false);
  assert.equal(design().screens.length, 1);
  api.actions.addScreen(id, 'blank', s1);
  assert.equal($(app, '#tb-del-screen').disabled, false, '2 つになれば押せる');
});

test('「画面を足す」の窓: ひな形 7 つの札。選んで「足す」・ダブルクリック・「今の画面を複製」。足した画面を開く', async (t) => {
  const { app, api, design, names } = await bootEditor(t);
  click($(app, '.sl-add'));
  await waitFor(() => $(app, '.modal'));
  assert.deepEqual($$(app, '.modal .tpl > b').map((b) => b.textContent), ['白紙', '入力', '詳細', '一覧', 'グラフ', '集計', '進み具合']);
  assert.equal($$(app, '.modal .tpl .thumb').length, 7, '縮小画像付き');
  assert.match($(app, '.modal').textContent, /今開いている「画面 1」の画面のすぐ後ろに足します/);
  assert.ok($(app, '.modal .tpl.sel[data-tpl="blank"]'), '最初は白紙を選んでいる');
  click($(app, '.modal .tpl[data-tpl="list"]'));
  assert.deepEqual($$(app, '.modal .tpl.sel').map((b) => b.dataset.tpl), ['list']);
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.deepEqual(names(), ['画面 1', '一覧']);
  assert.equal(api.currentScreen().name, '一覧', '足した画面を開く');
  // ダブルクリックで足す（開いている「一覧」のすぐ後ろ）
  click($(app, '[data-action="add-screen"]'));
  await waitFor(() => $(app, '.modal'));
  dblclick($(app, '.modal .tpl[data-tpl="graph"]'));
  await tick();
  assert.deepEqual(names(), ['画面 1', '一覧', 'グラフ']);
  // 今の画面を複製
  click($(app, `.sl-item[data-id="${design().screens[0].id}"]`));
  api.runCommand('addScreen');
  await waitFor(() => $(app, '.modal'));
  click($(app, '.modal [data-dup]'));
  await tick();
  assert.deepEqual(names(), ['画面 1', '画面 1 のコピー', '一覧', 'グラフ']);
  assert.equal(api.currentScreen().name, '画面 1 のコピー');
  // キャンセルでは足さない
  api.runCommand('addScreen');
  await waitFor(() => $(app, '.modal'));
  click($(app, '.modal [data-dlg="cancel"]'));
  await tick();
  assert.equal(names().length, 4);
});

test('画面の一覧: 番号と名前・「…」から名前を変える・メニューバーの「画面を複製」', async (t) => {
  const { app, api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  api.actions.addScreen(id, 'input', s1);
  assert.deepEqual($$(app, '.sl-name').map((e) => e.textContent), ['1　画面 1', '2　入力']);
  click($(app, `.sl-more[data-id="${s1}"]`));
  click($(app, '.screen-menu [data-action="screen-rename"]'));
  await waitFor(() => $(app, '.modal [name=name]'));
  assert.equal($(app, '.modal').textContent.includes('画面の名前'), true);
  $(app, '.modal [name=name]').value = '  顧客の一覧  ';
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.deepEqual(names(), ['顧客の一覧', '入力']);
  click($(app, `.sl-item[data-id="${s1}"]`));
  click($(app, '[data-action="duplicate-screen"]'));
  assert.deepEqual(names(), ['顧客の一覧', '顧客の一覧 のコピー', '入力']);
  assert.equal(api.currentScreen().name, '顧客の一覧 のコピー');
});

test('PageUp・PageDown で前後の画面へ（入力欄の中では使わない）。アプリのメニューの命令でも動く', async (t) => {
  const storage = require('./harness').createMainStorage();
  t.after(() => storage.cleanup());
  const { app, api, id, design } = await bootEditor(t, { storage });
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const s3 = api.actions.addScreen(id, 'blank', s2);
  click($(app, `.sl-item[data-id="${s1}"]`));
  key(app, app.document.body, { key: 'PageDown' });
  assert.equal(api.ui.screenId, s2);
  key(app, app.document.body, { key: 'PageDown' });
  key(app, app.document.body, { key: 'PageDown' });
  assert.equal(api.ui.screenId, s3, 'いちばん下より先へは行かない');
  key(app, app.document.body, { key: 'PageUp' });
  assert.equal(api.ui.screenId, s2);
  key(app, $(app, '[data-field="screen-name"]'), { key: 'PageUp' });
  assert.equal(api.ui.screenId, s2, '入力欄の中では使わない');
  app.menuCommand('prevScreen');
  assert.equal(api.ui.screenId, s1);
  app.menuCommand('addScreen');
  await waitFor(() => $(app, '.modal'));
  click($(app, '.modal [data-dlg="cancel"]'));
  await tick();
  click($(app, '[data-action="open-items"]'));
  app.menuCommand('nextScreen');
  assert.deepEqual([api.ui.panel, api.ui.screenId], ['screen', s2], '項目の一覧表を出しているときも、メニューからは画面へ移る');
  await api.store.adapter.pending;
  await storage.whenIdle();
});

test('リンクの文字の「移る画面」には、開いている画面を出さない', async (t) => {
  const { app, api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  click($(app, `.sl-item[data-id="${s1}"]`));
  const link = api.actions.addPart(id, s1, 'link', { x: 0, y: 200 });
  api.actions.updatePart(id, s1, link, { props: { to: 'screen' } });
  api.selectPart(link);
  const opts = $$(app, '[data-pf="props.screenId"] option').map((o) => o.value);
  assert.deepEqual(opts, ['', s2]);
});

test('保存して開き直しても、画面の順番と中身が残る', async (t) => {
  const storage = require('./harness').createMainStorage();
  t.after(() => storage.cleanup());
  const first = await bootEditor(t, { storage });
  const { api, id, design } = first;
  const s1 = design().screens[0].id;
  api.actions.addScreen(id, 'list', s1);
  const s3 = api.actions.addScreen(id, 'input', s1);
  api.actions.moveScreen(id, s3, 0);
  const before = plain(design().screens.map((s) => [s.name, s.parts.length]));
  assert.deepEqual(before.map((x) => x[0]), ['入力', '画面 1', '一覧']);
  await api.store.adapter.pending;
  await storage.whenIdle();
  const second = bootApp({ storage });
  const api2 = await second.api();
  t.after(() => second.close());
  await waitFor(() => api2.store.state.designs.length === 1, { label: '読み込み' });
  assert.deepEqual(plain(api2.store.state.designs[0].screens.map((s) => [s.name, s.parts.length])), before);
});

// ── 見直しで見つかったこと ──
test('白紙の画面の名前は、使われていない番号にする（画面を消した後でも「画面 3 2」にしない）', async (t) => {
  const { api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const s3 = api.actions.addScreen(id, 'blank', s2);
  api.actions.deleteScreen(id, s2);
  assert.deepEqual(names(), ['画面 1', '画面 3']);
  api.actions.addScreen(id, 'blank', s3);
  assert.deepEqual(names(), ['画面 1', '画面 3', '画面 4']);
});

test('移る先を「URL を書く」に変えたリンクの文字は、画面を消すときに数えない', async (t) => {
  const { app, api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  const link = api.actions.addPart(id, s1, 'link', { x: 0, y: 200 });
  api.actions.updatePart(id, s1, link, { props: { to: 'screen', screenId: s2 } });
  api.actions.updatePart(id, s1, link, { props: { to: 'url', url: 'https://example.com/' } });
  click($(app, `.sl-item[data-id="${s2}"]`));
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  assert.doesNotMatch($(app, '.modal').textContent, /リンクの文字/);
  click($(app, '.modal [data-dlg="cancel"]'));
  await tick();
});

test('長い名前の画面を複製しても、名前は 100 文字までで「のコピー」が残る', async (t) => {
  const { api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  api.actions.updateScreen(id, s1, { name: 'あ'.repeat(100) });
  api.actions.duplicateScreen(id, s1);
  api.actions.duplicateScreen(id, s1);
  const [, c2, c1] = design().screens.map((s) => s.name);
  assert.ok(c1.endsWith(' のコピー') && c1.length <= 100, c1);
  assert.ok(c2.endsWith(' のコピー 2') && c2.length <= 100, c2);
});

test('項目の一覧表・つながりの図を出している間は、開いている画面の複製・消すは使わない（「…」のメニューからは使える）', async (t) => {
  const { app, api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  click($(app, '[data-action="open-items"]'));
  assert.equal($(app, '#toolbar [data-action="duplicate-screen"]').disabled, true);
  assert.equal($(app, '#tb-del-screen').disabled, true);
  assert.equal(api.runCommand('duplicateScreen'), false);
  assert.equal(api.runCommand('deleteScreen'), false);
  assert.equal(names().length, 2);
  click($(app, `.sl-more[data-id="${s2}"]`));
  click($(app, '.screen-menu [data-action="screen-dup"]'));
  assert.deepEqual(names(), ['画面 1', '画面 2', '画面 2 のコピー']);
  assert.equal(api.ui.panel, 'screen', '複製した画面を開く');
  assert.equal($(app, '#tb-del-screen').disabled, false);
});

test('ドラッグの途中で PageDown を押しても、画面は移らない（放したときに、移った先の画面へ高さが書かれないように）', async (t) => {
  const { app, api, id, design, screenOf } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  click($(app, `.sl-item[data-id="${s1}"]`));
  const mouse = (el, type, init) => el.dispatchEvent(new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  mouse($(app, '.screen-resize'), 'mousedown', { clientY: 100 });
  key(app, app.document.body, { key: 'PageDown' });
  assert.equal(api.ui.screenId, s1, 'ドラッグの途中では移らない');
  mouse(app.document, 'mousemove', { clientY: 200 });
  mouse(app.document, 'mouseup', { clientY: 200 });
  assert.equal(screenOf(s2).height, 800, 'ほかの画面の高さは変わらない');
  assert.ok(screenOf(s1).height > 800, 'ドラッグした画面の高さが変わる');
});

test('画面を足して元に戻すと、足す前に開いていた画面へ戻る', async (t) => {
  const { app, api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  click($(app, `.sl-item[data-id="${s2}"]`));
  api.runCommand('duplicateScreen');
  assert.notEqual(api.ui.screenId, s2);
  api.store.undo();
  assert.equal(api.ui.screenId, s2, 'いちばん上の画面ではなく、複製する前の画面');
});

test('窓を Esc で閉じても、選んでいる部品は外れない', async (t) => {
  const { app, api, id, design } = await bootEditor(t);
  const s1 = design().screens[0].id;
  api.actions.addScreen(id, 'blank', s1);
  click($(app, `.sl-item[data-id="${s1}"]`));
  const pid = api.actions.addPart(id, s1, 'button', { x: 0, y: 48 });
  api.selectPart(pid);
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  key(app, $(app, '.modal [data-dlg="cancel"]'), { key: 'Escape' });
  await tick();
  assert.equal($(app, '.modal'), null, '窓は閉じる');
  assert.equal(api.ui.partId, pid, '部品は選んだまま');
});

test('「…」のメニューを開いたまま、ほかの画面の縮小画像を押すとメニューを閉じる。メニューの項目は押す前に打ちかけの文字を保存する', async (t) => {
  const { app, api, id, design, names } = await bootEditor(t);
  const s1 = design().screens[0].id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  click($(app, `.sl-item[data-id="${s1}"]`));
  click($(app, `.sl-more[data-id="${s2}"]`));
  assert.equal($(app, `.sl-more[data-id="${s2}"]`).getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, $(app, '.screen-menu [data-action="screen-rename"]'), '最初の項目にフォーカスを移す');
  $(app, `.sl-item[data-id="${s2}"]`).dispatchEvent(new app.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal($(app, '.screen-menu'), null);
  assert.equal(api.ui.screenId, s2);
  // 右の欄で画面の名前を打ちかけのまま、「…」から複製する
  const field = $(app, '[data-field="screen-name"]');
  field.focus();
  field.value = '詳細';
  click($(app, `.sl-more[data-id="${s2}"]`));
  click($(app, '.screen-menu [data-action="screen-dup"]'));
  assert.deepEqual(names(), ['画面 1', '詳細', '詳細 のコピー'], '打ちかけの名前を保存してから複製する');
});
