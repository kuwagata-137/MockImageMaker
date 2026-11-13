'use strict';
// v1.05（q181 案A）: 最初の画面の画面設計の「…」メニューの「この画面設計をシステムに追加する…」のテスト。
// 追加先のシステムと追加方法（画面設計を移動する・画面設計を複製して追加する）を選ぶ。画面設計とシステムの名前は架空の業務だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

// 顧客管理システム（顧客管理）・営業支援システム（空）と、システムに入っていない訪問記録を作り、最初の画面で起動する
async function boot(t, { systems = true } = {}) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const $ = (sel) => app.document.querySelector(sel);
  const a = api.actions;
  const customer = a.createDesign('顧客管理', 'kintone');
  const visit = a.createDesign('訪問記録', 'kintone');
  const ys = systems ? [a.createSystem({ name: '顧客管理システム' }), a.createSystem({ name: '営業支援システム' })] : [];
  if (systems) a.addDesignToSystem(ys[0], customer);
  api.goHome();
  const sys = (id) => api.store.state.systems.find((y) => y.id === id);
  const group = (id) => click($(`[data-action="home-group"][data-group="${id}"]`));
  // カードの「…」→「この画面設計をシステムに追加する…」を押し、ウィンドウが出るまで待つ
  const openDialog = async (designId) => {
    click($(`.card-more[data-id="${designId}"]`));
    click($('.card-menu [data-action="add-to-system"]'));
    await waitFor(() => $('.modal'));
  };
  const ok = async () => { click($('[data-dlg="ok"]')); await new Promise((r) => setTimeout(r, 10)); };
  return { app, api, $, customer, visit, ys, sys, group, openDialog, ok };
}

test('メニューの項目: システムが 1 つもないときは出さない。あるときは「この画面設計を複製する」の下に出す', async (t) => {
  const none = await boot(t, { systems: false });
  click(none.$(`.card-more[data-id="${none.visit}"]`));
  assert.equal(none.$('.card-menu [data-action="add-to-system"]'), null);
  const { $, visit, group } = await boot(t);
  group('lone');
  click($(`.card-more[data-id="${visit}"]`));
  const items = [...$('.card-menu').querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(items.slice(0, 3), ['この画面設計の名前を変更する', 'この画面設計を複製する', 'この画面設計をシステムに追加する…']);
});

test('ウィンドウ: 追加先のシステムと追加方法を選ぶ。ボタンは［画面設計を追加する］が左、［キャンセル］が右', async (t) => {
  const { $, visit, ys, group, openDialog } = await boot(t);
  group('lone');
  await openDialog(visit);
  assert.equal($('.modal h2').textContent, 'この画面設計をシステムに追加する（訪問記録）');
  assert.deepEqual([...$('.modal [name="system"]').options].map((o) => o.textContent), ['顧客管理システム', '営業支援システム']);
  assert.equal($('.modal [name="system"]').value, ys[0]);
  assert.deepEqual([...$('.modal').querySelectorAll('.how-pick b')].map((b) => b.textContent), ['画面設計を移動する', '画面設計を複製して追加する（コピー）']);
  assert.equal($('.modal [name="how"]:checked').value, 'move');
  assert.match($('.modal .how-pick').textContent, /「システムに入っていない」からなくなり、追加先のシステムに並ぶ/);
  assert.deepEqual([...$('.modal-actions').querySelectorAll('button')].map((b) => b.textContent), ['画面設計を追加する', 'キャンセル']);
  click($('[data-dlg="cancel"]'));
});

test('画面設計を移動する（システムに入っていない画面設計）: 追加先のシステムに並び、「システムに入っていない」からなくなる。元に戻す 1 回で戻る', async (t) => {
  const { api, $, visit, customer, ys, sys, group, openDialog, ok } = await boot(t);
  group('lone');
  await openDialog(visit);
  await ok();
  assert.deepEqual(plain(sys(ys[0]).designIds), [customer, visit]);
  assert.equal($(`.card[data-id="${visit}"]`), null, '「システムに入っていない」のまとまりからなくなる');
  assert.match($('#toast').textContent, /「訪問記録」を顧客管理システムに移動しました。/);
  api.runCommand('undo');
  assert.deepEqual(plain(sys(ys[0]).designIds), [customer]);
});

test('画面設計を移動する（システムの中の画面設計）: 元のシステムから外し、追加先のシステムに追加する。元に戻す 1 回で両方戻る', async (t) => {
  const { api, $, customer, ys, sys, group, openDialog, ok } = await boot(t);
  group(ys[0]);
  await openDialog(customer);
  assert.equal($('.modal [name="system"]').value, ys[1], '最初は、この画面設計が入っていないシステム');
  assert.match($('.modal .how-pick').textContent, /「顧客管理システム」から外し、追加先のシステムに追加する/);
  await ok();
  assert.deepEqual(plain(sys(ys[0]).designIds), []);
  assert.deepEqual(plain(sys(ys[1]).designIds), [customer]);
  api.runCommand('undo');
  assert.deepEqual(plain(sys(ys[0]).designIds), [customer]);
  assert.deepEqual(plain(sys(ys[1]).designIds), []);
});

test('画面設計を複製して追加する（コピー）: 複製が追加先のシステムに並び、元の画面設計は残る', async (t) => {
  const { api, $, visit, ys, sys, group, openDialog, ok } = await boot(t);
  group('lone');
  await openDialog(visit);
  $('.modal [name="system"]').value = ys[1];
  click($('.modal [name="how"][value="copy"]'));
  await ok();
  const ids = plain(sys(ys[1]).designIds);
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0], visit);
  assert.equal(api.store.state.designs.find((d) => d.id === ids[0]).name, '訪問記録 のコピー');
  assert.ok($(`.card[data-id="${visit}"]`), '元の画面設計は「システムに入っていない」に残る');
  assert.match($('#toast').textContent, /「訪問記録」を複製して、営業支援システムに追加しました。/);
});

test('移動先にもう入っているとき: ウィンドウを閉じずに理由を表示する。複製して追加するのはできる', async (t) => {
  const { api, $, customer, ys, sys, group, openDialog, ok } = await boot(t);
  group(ys[0]);
  await openDialog(customer);
  $('.modal [name="system"]').value = ys[0];
  await ok();
  assert.ok($('.modal'), 'ウィンドウは閉じない');
  assert.match($('.modal-error').textContent, /「顧客管理」は、すでに顧客管理システムに入っています。/);
  click($('.modal [name="how"][value="copy"]'));
  await ok();
  assert.equal($('.modal'), null);
  assert.equal(sys(ys[0]).designIds.length, 2);
  assert.equal(api.actions.moveDesignToSystem(null, ys[0], customer), false, 'もう入っているシステムへは移動しない');
});
