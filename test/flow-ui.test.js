'use strict';
// 第 8 段階の右の欄のテスト: ステータスと操作の欄（画像 q52 の案A）と、ボタン・リンクの文字の移る先の欄（画像 q53 の案A）。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

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
const tick = () => new Promise((r) => setTimeout(r, 0));

// 白紙の画面 1 つの画面設計を開いた状態で起動する
async function bootEditor(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理', 'kintone');
  api.openDesign(id);
  const parts = () => api.currentScreen().parts.map((p) => api.resolvePart(api.currentDesign(), p));
  const add = (type) => { click($(app, `.pal-btn[data-type="${type}"]`)); return parts()[parts().length - 1]; };
  const item = () => api.currentDesign().items.find((x) => x.type === 'status');
  const idOf = (name) => item().props.states.find((s) => s.name === name).id;
  const side = (sel) => $(app, '#side-settings ' + sel);
  return { app, api, id, parts, add, item, idOf, side };
}

// ── ステータスと操作の欄（q52 の案A）──
test('ステータスと操作の欄: ステータス表示を選ぶと、ステータスの行と操作のカードを出す。ステータスの名前を直す・並べ替える・足す', async (t) => {
  const { app, add, item, idOf, side } = await bootEditor(t);
  add('status');
  const rows = () => plain($$(app, '#side-settings [data-ps]').map((e) => e.value));
  assert.deepEqual(rows(), ['申請', '承認待ち', '承認済み', '完了']);
  assert.equal($$(app, '#side-settings .pa-card').length, 4, '見本の操作 4 つ');
  assert.equal(side('[data-pf="props.states"]'), null, '並びを書く文字の欄はなくした');
  // 名前を直すと、操作のカードの選ぶ欄の名前も変わる
  const first = idOf('申請');
  setValue(side(`[data-ps="${first}"]`), '下書き');
  assert.equal(item().props.states[0].name, '下書き');
  assert.equal(item().props.states[0].id, first, 'id はそのまま');
  assert.ok($$(app, `#side-settings select[data-k="from"] option[value="${first}"]`).every((o) => o.textContent === '下書き'));
  // 同じ名前・空の名前にはできない（欄を元に戻す）
  setValue(side(`[data-ps="${idOf('承認済み')}"]`), '承認待ち');
  assert.equal(side(`[data-ps="${idOf('承認済み')}"]`).value, '承認済み');
  setValue(side(`[data-ps="${first}"]`), '  ');
  assert.equal(item().props.states[0].name, '下書き');
  // ↓・↑ で並べ替え（いちばん上の ↑ と、いちばん下の ↓ は押せない）
  assert.equal(side(`[data-action="ps-up"][data-id="${first}"]`).disabled, true);
  assert.equal(side(`[data-action="ps-down"][data-id="${idOf('完了')}"]`).disabled, true);
  click(side(`[data-action="ps-down"][data-id="${first}"]`));
  assert.deepEqual(rows(), ['承認待ち', '下書き', '承認済み', '完了']);
  click(side(`[data-action="ps-up"][data-id="${idOf('完了')}"]`));
  assert.deepEqual(rows(), ['承認待ち', '下書き', '完了', '承認済み']);
  // 足すと、いちばん下に「新しいステータス」を足し、その名前の欄にフォーカスを置く
  click(side('[data-action="ps-add"]'));
  assert.deepEqual(rows(), ['承認待ち', '下書き', '完了', '承認済み', '新しいステータス']);
  assert.equal(app.document.activeElement.dataset.ps, idOf('新しいステータス'));
  click(side('[data-action="ps-add"]'));
  assert.equal(rows()[5], '新しいステータス 2');
});

test('操作のカード: 名前・前と次のステータス・操作できる人・条件を直す。前と次を同じにはできない。並べ替え・消す・足す', async (t) => {
  const { app, api, add, item, idOf, side } = await bootEditor(t);
  add('status');
  const a = () => item().props.actions[0];
  const f = (k) => side(`[data-pa="${a().id}"][data-k="${k}"]`);
  setValue(f('name'), '申請を出す');
  setValue(f('role'), '申請者');
  setValue(f('cond'), '出張の 3 日前まで');
  setValue(f('to'), idOf('承認済み'));
  assert.deepEqual(plain([a().name, a().from, a().to, a().role, a().cond]), ['申請を出す', idOf('申請'), idOf('承認済み'), '申請者', '出張の 3 日前まで']);
  // 画面のアイテムの「設定一覧に出る文」は、操作を「ステータスの流れ」に載っていると書く（q138）。操作の文は項目一覧の文で確かめる
  assert.match(side('#pf-out').textContent, /全部のステータス \d+ 個と操作 \d+ 個は「ステータスの流れ」に載っています/);
  assert.match(api.describeItem(item()), /操作「申請を出す」＝申請から承認済みへ（申請者）・出張の 3 日前まで/);
  setValue(f('from'), idOf('承認済み'));
  assert.equal(a().from, idOf('申請'), '前と次が同じになる変更はしない');
  assert.equal(f('from').value, idOf('申請'), '選ぶ欄も元に戻す');
  setValue(f('name'), '');
  assert.equal(a().name, '申請を出す', '名前を空にはできない');
  // 戻る操作（差し戻す）は、矢印を橙にする
  const back = item().props.actions.find((x) => x.name === '差し戻す');
  assert.equal(side(`[data-pa="${back.id}"][data-k="to"]`).closest('.pa-card').querySelector('.ar').classList.contains('back'), true);
  const names = () => plain(item().props.actions.map((x) => x.name));
  click(side(`[data-action="pa-down"][data-id="${a().id}"]`));
  assert.deepEqual(names(), ['承認する', '申請を出す', '差し戻す', '完了にする']);
  click(side(`[data-action="pa-del"][data-id="${back.id}"]`));
  assert.deepEqual(names(), ['承認する', '申請を出す', '完了にする'], '操作はすぐ消す（元に戻すで戻せる）');
  click(side('[data-action="pa-add"]'));
  assert.deepEqual(names(), ['承認する', '申請を出す', '完了にする', '新しい操作']);
  assert.equal(app.document.activeElement.dataset.pa, item().props.actions[3].id);
  api.runCommand('undo');
  assert.equal(item().props.actions.length, 3);
});

test('ステータスを消す: 使う操作があれば確かめの窓（最初はキャンセル。消える操作の名前を書く）。なければすぐ消す。最後の 1 つは消せない', async (t) => {
  const { app, add, item, idOf, side } = await bootEditor(t);
  add('status');
  click(side(`[data-action="ps-del"][data-id="${idOf('承認待ち')}"]`));
  await tick();
  const dlg = $(app, '#dialog-root .modal');
  assert.ok(dlg, '確かめの窓を出す');
  assert.match(dlg.textContent, /ステータス「承認待ち」を削除しますか/);
  assert.match(dlg.textContent, /「申請する」・「承認する」・「差し戻す」/);
  assert.equal(app.document.activeElement.dataset.dlg, 'cancel');
  click($(app, '[data-dlg="cancel"]'));
  await tick();
  assert.equal(item().props.states.length, 4, 'キャンセルでは消さない');
  click(side(`[data-action="ps-del"][data-id="${idOf('承認待ち')}"]`));
  await tick();
  click($(app, '[data-dlg="ok"]'));
  await tick();
  assert.deepEqual(plain(item().props.states.map((s) => s.name)), ['申請', '承認済み', '完了']);
  assert.deepEqual(plain(item().props.actions.map((x) => x.name)), ['完了にする']);
  click(side(`[data-action="ps-del"][data-id="${idOf('申請')}"]`)); // 使う操作がない
  await tick();
  assert.equal($(app, '#dialog-root .modal'), null);
  assert.deepEqual(plain(item().props.states.map((s) => s.name)), ['承認済み', '完了']);
  click(side(`[data-action="ps-del"][data-id="${idOf('完了')}"]`));
  await tick();
  click($(app, '[data-dlg="ok"]'));
  await tick();
  assert.equal(item().props.states.length, 1);
  assert.equal(side('[data-action="ps-del"]').disabled, true, '最後の 1 つの ✕ は押せない');
});

test('ステータスと操作の欄の打ちかけの文字は、ほかのアイテムを選ぶ前に保存される', async (t) => {
  const { app, api, add, item, idOf } = await bootEditor(t);
  const b = add('button');
  const st = add('status');
  api.selectPart(st.id);
  const inp = $(app, `#side-settings [data-ps="${idOf('完了')}"]`);
  inp.focus();
  inp.value = '精算済み';
  api.selectPart(b.id);
  assert.equal(item().props.states[3].name, '精算済み');
  api.selectPart(st.id);
  const role = $(app, `#side-settings [data-pa="${item().props.actions[1].id}"][data-k="role"]`);
  role.focus();
  role.value = '課長';
  api.runCommand('zoomIn');
  assert.equal(item().props.actions[1].role, '課長');
});

test('取り込んだステータスの項目は、ステータスと操作の欄を直せない（灰色の枠の中）', async (t) => {
  const { app, api, add, item } = await bootEditor(t);
  add('status');
  const src = api.currentDesign().id;
  const other = api.actions.createDesign('出張申請', 'kintone');
  api.actions.importItems(other, src, [item().id]);
  api.openDesign(other);
  const it = api.currentDesign().items.find((x) => x.type === 'status');
  api.openItemsPanel();
  api.selectItem(it.id);
  const sec = $(app, '#side-settings fieldset.pf-sec.locked');
  assert.ok(sec && sec.disabled);
  assert.ok(sec.querySelector('[data-ps]') && sec.querySelector('[data-pa]') && sec.querySelector('[data-action="ps-add"]'));
});

// ── 移る先の欄（q53 の案A）──
test('ボタンの移動先の欄: なし・画面・URL。画面を選ぶと、画面設計（この画面設計が先、ほかは名前の順、ごみ箱は出さない）と画面の 2 つの選ぶ欄', async (t) => {
  const { app, api, id, add, side } = await bootEditor(t);
  const s1 = api.currentScreen().id;
  const s2 = api.actions.addScreen(id, 'blank', s1);
  api.actions.updateScreen(id, s2, { name: '一覧' });
  const B = api.actions.createDesign('経費精算', 'kintone');
  api.actions.updateScreen(B, api.store.state.designs.find((x) => x.id === B).screens[0].id, { name: '精算の入力' });
  const C = api.actions.createDesign('売上管理', 'kintone');
  const T = api.actions.createDesign('アンケート', 'kintone');
  api.actions.trashDesign(T);
  api.openDesign(id);
  api.openScreen(s1);
  const b = add('button');
  const props = () => api.currentScreen().parts.find((p) => p.id === b.id).props;
  const opts = (sel) => plain($$(app, `#side-settings ${sel} option`).map((o) => o.textContent));
  assert.deepEqual(opts('[data-pf="props.to"]'), ['（なし）', '画面', 'URL を書く']);
  assert.equal(side('[data-pf="props.designId"]'), null);
  setValue(side('[data-pf="props.to"]'), 'screen');
  assert.deepEqual(opts('[data-pf="props.designId"]'), ['この画面設計（顧客管理）', '経費精算', '売上管理']);
  assert.deepEqual(opts('[data-pf="props.screenId"]'), ['（選んでください）', '一覧の画面'], '開いている画面は出さない');
  setValue(side('[data-pf="props.screenId"]'), s2);
  assert.deepEqual(plain([props().to, props().designId, props().screenId]), ['screen', '', s2]);
  // 画面設計を選び直すと、画面は「（選んでください）」に戻る
  setValue(side('[data-pf="props.designId"]'), B);
  assert.deepEqual(plain([props().designId, props().screenId]), [B, '']);
  assert.deepEqual(opts('[data-pf="props.screenId"]'), ['（選んでください）', '精算の入力の画面']);
  const bs = api.store.state.designs.find((x) => x.id === B).screens[0].id;
  setValue(side('[data-pf="props.screenId"]'), bs);
  assert.match(side('#pf-out').textContent, /移動先＝経費精算 ／ 精算の入力の画面/);
  setValue(side('[data-pf="props.designId"]'), '');
  assert.deepEqual(plain([props().designId, props().screenId]), ['', '']);
  setValue(side('[data-pf="props.to"]'), 'url');
  assert.equal(side('[data-pf="props.designId"]'), null);
  setValue(side('[data-pf="props.url"]'), 'https://example.com/help');
  assert.deepEqual(plain([props().to, props().url]), ['url', 'https://example.com/help']);
  assert.ok(side('[data-pf="props.action"]'), '「押したとき」の欄は残す');
  // リンクの文字も同じ欄
  add('link');
  setValue(side('[data-pf="props.to"]'), 'screen');
  assert.deepEqual(opts('[data-pf="props.designId"]'), ['この画面設計（顧客管理）', '経費精算', '売上管理']);
  void C;
});

// ── 見直し（第 8 段階）で見つけた不具合 ──
test('進捗バーの「今のステータス（見本）」には「（なし）」がある（空のときは「（なし）」を選んだ形）。ステータス表示は、空のとき並びの 1 つ目を描くので、選択肢は並びだけ', async (t) => {
  const { add, api, idOf, side } = await bootEditor(t);
  const sp = add('steps');
  api.selectPart(sp.id);
  const sel = () => side('select[data-pf="view.current"]');
  assert.deepEqual(plain([sel().options[0].value, sel().options[0].textContent]), ['', '（なし）']);
  setValue(sel(), '');
  assert.equal(api.currentScreen().parts.find((p) => p.id === sp.id).view.current, '');
  assert.equal(sel().value, '');
  setValue(sel(), idOf('申請'));
  assert.equal(api.currentScreen().parts.find((p) => p.id === sp.id).view.current, idOf('申請'));
  const st = add('status');
  api.selectPart(st.id);
  assert.equal(sel().options[0].textContent, '申請');
});

test('ステータスの名前を直すと、同じ右のパネルの「表示するステータス（サンプル）」の選ぶ欄の名前もすぐ変わる', async (t) => {
  const { add, api, idOf, side } = await bootEditor(t);
  const st = add('status');
  api.selectPart(st.id);
  const first = idOf('申請');
  setValue(side(`[data-ps="${first}"]`), '下書き');
  assert.equal(side(`select[data-pf="view.current"] option[value="${first}"]`).textContent, '下書き');
});

test('ステータスと操作の名前の欄を空にして打ち直している途中に、ほかのウィンドウへ移っても、欄を元の名前に戻さない', async (t) => {
  const { app, add, api, item, idOf } = await bootEditor(t);
  const st = add('status');
  api.selectPart(st.id);
  const inp = $(app, `#side-settings [data-ps="${idOf('完了')}"]`);
  inp.focus();
  inp.value = '';
  app.window.dispatchEvent(new app.window.Event('blur'));
  assert.equal(inp.value, '', 'ステータスの名前の欄');
  assert.equal(item().props.states[3].name, '完了');
  const name = $(app, `#side-settings [data-pa="${item().props.actions[0].id}"][data-k="name"]`);
  name.focus();
  name.value = '';
  app.window.dispatchEvent(new app.window.Event('blur'));
  assert.equal(name.value, '', '操作の名前の欄');
  assert.equal(item().props.actions[0].name, '申請する');
});
