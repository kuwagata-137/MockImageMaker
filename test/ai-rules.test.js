'use strict';
// AI の窓口の決まり（第 7 段階の T5。設計書の 8 章）のテスト。
// 断るとき（8-4）・元に戻すの決まり（8-2）・「AI が直す前の状態」の行（8-3）・人の打ちかけの文字（8-5）・保存の失敗（8-1）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, systemState, design, item, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}, session = 's-1', client = 'claude-code') => plain(await T.aiDispatch(tool, args, { session, client }));
  const d = (id) => T.store.state.designs.find((x) => x.id === id);
  return { app, T, call, d };
}
const desc = (text) => ['update_design', { design: 'd1', description: text }];
const aiRows = (d) => d.revisions.filter((r) => r.kind === 'ai');

test('前の版を見ている間・保存を止めている間・確かめの窓が開いている間は、書く頼みを断る（読む頼みは通る）', async () => {
  const { app, T, call } = await boot();
  T.openDesign('d1');
  T.actions.addRevision('d1', { note: '第 1 版' });
  T.store.startViewing(T.store.state);
  let r = await call(...desc('見ている間'));
  assert.equal(r.error.code, 'viewing');
  assert.match(r.error.message, /「顧客管理」の前の版を見ているため、今は直せません。.*「見るのをやめる」/);
  assert.equal((await call('get_design', { design: 'd1' })).ok, true);
  T.store.stopViewing();
  T.store.blockReason = '保存データを読み込めませんでした（壊れています）。';
  r = await call(...desc('止めている間'));
  assert.equal(r.error.code, 'blocked');
  assert.match(r.error.message, /理由: 保存データを読み込めませんでした（壊れています）。/);
  T.store.blockReason = null;
  app.document.querySelector('#dialog-root').innerHTML = '<div class="modal-overlay"></div>';
  r = await call(...desc('窓'));
  assert.equal(r.error.code, 'dialog');
  app.document.querySelector('#dialog-root').innerHTML = '';
  assert.equal((await call(...desc('通る'))).ok, true);
  app.close();
});

test('人がドラッグしている間は約 2 秒待って断る。日本語の変換中は待ち、2 秒以内に終われば実行する', async () => {
  const { app, T, call, d } = await boot();
  T.setDragForTest({ kind: 'move' });
  const t0 = Date.now();
  const r = await call(...desc('ドラッグ中'));
  assert.equal(r.error.code, 'busy');
  assert.ok(Date.now() - t0 >= 1900);
  T.setDragForTest(null);
  const doc = app.document;
  doc.dispatchEvent(new app.window.Event('compositionstart'));
  assert.equal(T.imeComposing(), true);
  const p = call(...desc('変換の後'));
  setTimeout(() => doc.dispatchEvent(new app.window.Event('compositionend')), 300);
  const r2 = await p;
  assert.equal(r2.ok, true);
  assert.equal(d('d1').description, '変換の後');
  app.close();
});

test('読んだ後に人が直したとき（expect が今の更新の印と違う）と、ごみ箱の画面設計は断る', async () => {
  const { app, T, call } = await boot();
  const read = await call('get_design', { design: 'd1' });
  T.actions.updateDesignInfo('d1', { description: '人が直した' });
  const r = await call('update_design', { design: 'd1', expect: read.result.updatedAt, description: 'AI の古い中身' });
  assert.equal(r.error.code, 'stale');
  assert.match(r.error.message, /「顧客管理」は、読んだ後にアプリで直されました。読み直してから頼んでください/);
  const fresh = await call('get_design', { design: 'd1' });
  assert.equal((await call('update_design', { design: 'd1', expect: fresh.result.updatedAt, description: '読み直した' })).ok, true);
  const t = await call('update_design', { design: '出張申請', description: 'x' });
  assert.equal(t.error.code, 'trashed');
  assert.match(t.error.message, /ごみ箱から一覧に戻してから/);
  app.close();
});

test('どの道具を呼んだ後も、確かめの窓は開いていない（AI の窓口は窓を出さない）', async () => {
  const { app, T, call } = await boot();
  T.openDesign('d1');
  const calls = [
    ['create_design', { name: '出張申請 2' }], ['update_design', { design: 'd1', name: '顧客台帳' }],
    ['edit_items', { design: 'd1', ops: [{ op: 'delete', item: '区分' }] }], ['add_screen', { design: 'd1', template: 'detail' }],
    ['edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '一覧' }] }], ['layout_screen', { design: 'd1', screen: '新規登録', layout: { rows: [[{ type: 'heading', label: '見出し' }]] } }],
    ['edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'delete', part: 1 }] }], ['edit_callouts', { design: 'd1', screen: '新規登録', ops: [{ op: 'add', text: 'メモ' }] }],
    ['add_revision', { design: 'd1', note: '版' }], ['restore_revision', { design: 'd1', revision: 1 }],
  ];
  for (const [tool, args] of calls) {
    const r = await call(tool, args);
    assert.equal(r.ok, true, `${tool}: ${JSON.stringify(r.error)}`);
    assert.equal(app.document.querySelector('#dialog-root .modal-overlay'), null, tool);
  }
  app.close();
});

test('8-2: 開いている画面設計への AI の 1 回の頼みは、Ctrl+Z 1 回で戻る（取り込んでいる画面設計の項目も一緒に戻る）', async () => {
  const { app, T, call, d } = await boot();
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  const undo0 = T.store.undoStack.length;
  assert.equal((await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '顧客名', name: '顧客の名前' }, { op: 'add', name: '電話番号', type: 'text1' }] })).ok, true);
  assert.equal(d('d2').items[0].name, '顧客の名前'); // 受注管理が取り込んでいる項目もそろう
  assert.equal(T.store.undoStack.length, undo0 + 1);
  T.store.undo();
  assert.equal(d('d1').items.find((x) => x.id === 'i2').name, '顧客名');
  assert.equal(d('d1').items.length, 3);
  assert.equal(d('d2').items[0].name, '顧客名');
  assert.equal(d('d1').description, '人の変更'); // 人の変更は残る
  app.close();
});

test('8-2: 取り込んだ項目をさらに取り込んでいる画面設計（顧客管理 → 受注管理 → 請求管理）もそろうときも、Ctrl+Z 1 回で戻る（取り込みが輪になっても止まる）', async () => {
  const st = sampleState();
  st.designs.push(design('d4', '請求管理', 'kintone', {
    items: [
      item('z1', '顧客名', 'text1', { props: { maxLen: '50', initial: '' }, link: { designId: 'd2', itemId: 'o1', designName: '受注管理', lost: false } }),
      item('z2', '請求番号', 'text1', { props: { maxLen: '20', initial: '' } }),
    ],
  }));
  // 輪: 顧客管理も、請求管理の項目を取り込んでいる
  st.designs[0].items.push(item('i9', '請求番号', 'text1', { props: { maxLen: '20', initial: '' }, link: { designId: 'd4', itemId: 'z2', designName: '請求管理', lost: false } }));
  const { app, T, call, d } = await boot(st);
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  const undo0 = T.store.undoStack.length;
  assert.equal((await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '顧客名', name: '顧客の名前' }] })).ok, true);
  assert.equal(d('d2').items[0].name, '顧客の名前');
  assert.equal(d('d4').items[0].name, '顧客の名前', '取り込んだ項目をさらに取り込んだ項目もそろう');
  assert.equal(T.store.undoStack.length, undo0 + 1, '履歴を消さずに積む');
  assert.equal(app.document.querySelector('#ai-warn'), null);
  T.store.undo();
  assert.deepEqual([d('d1').items[1].name, d('d2').items[0].name, d('d4').items[0].name], ['顧客名', '顧客名', '顧客名']);
  assert.equal(d('d1').description, '人の変更');
  app.close();
});

test('8-2: 開いていない画面設計・新しい画面設計を AI が変えたときは、元に戻すの履歴を消して知らせる', async () => {
  const { app, T, call, d } = await boot();
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  assert.ok(T.store.undoStack.length > 0);
  assert.equal((await call('update_design', { design: '受注管理', description: 'AI の変更' })).ok, true);
  assert.equal(T.store.undoStack.length, 0);
  assert.equal(T.store.redoStack.length, 0);
  // 知らせはメニューバーの下のオレンジの帯（q51 の案A。test/ai-view.test.js でくわしく確かめる）
  const warn = () => app.document.querySelector('#ai-warn');
  assert.match(warn().textContent, /Claude Code が「受注管理」を直したので、元に戻す（Ctrl\+Z）の履歴を消しました。開いている「顧客管理」は変わっていません。/);
  assert.equal(d('d1').description, '人の変更');
  T.actions.updateDesignInfo('d1', { description: '人の変更 2' });
  assert.equal((await call('create_design', { name: '経費精算' })).ok, true);
  assert.equal(T.store.undoStack.length, 0);
  assert.match(warn().textContent, /Claude Code が「経費精算」を作ったので、元に戻す（Ctrl\+Z）の履歴を消しました。/);
  app.close();
});

test('8-3: 「AI が直す前の状態」の行は、接続ごと・画面設計ごとに最初の 1 回だけ。写しは直す前の中身', async () => {
  const { app, call, d } = await boot();
  assert.equal((await call(...desc('1 回目'))).ok, true);
  assert.equal((await call(...desc('2 回目'))).ok, true);
  let rows = aiRows(d('d1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, 'Claude Code が直す前の状態');
  assert.equal(rows[0].no, null);
  assert.equal(rows[0].snapshot.description, '取引先と顧客の連絡先を管理する。');
  assert.equal((await call('update_design', { design: 'd1', description: '別の接続' }, 's-2', 'cursor')).ok, true);
  rows = aiRows(d('d1'));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].note, 'cursor が直す前の状態');
  assert.equal(rows[1].snapshot.description, '2 回目');
  // 新しく作った画面設計には残さない。受注管理は別の画面設計なので、最初の変更で 1 行
  const c = await call('create_design', { name: '出張申請 2' });
  await call('update_design', { design: c.result.id, description: '作った後に直す' });
  assert.equal(aiRows(d(c.result.id)).length, 1);
  app.close();
});

test('8-3: 何も変わらない頼み・失敗した頼みでは行も更新の印も変わらない。元に戻すで行も一緒に消え、次の変更でまた残る', async () => {
  const { app, T, call, d } = await boot();
  T.openDesign('d1');
  const at0 = d('d1').updatedAt;
  const same = await call('update_design', { design: 'd1', name: '顧客管理' });
  assert.equal(same.result.changed, false);
  assert.equal(d('d1').updatedAt, at0);
  assert.equal(aiRows(d('d1')).length, 0);
  const bad = await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '金額', type: 'number' }, { op: 'add', name: 'x', type: 'nope' }] });
  assert.equal(bad.ok, false);
  assert.equal(aiRows(d('d1')).length, 0);
  assert.equal(d('d1').updatedAt, at0);
  await call(...desc('AI の変更'));
  assert.equal(aiRows(d('d1')).length, 1);
  T.store.undo();
  assert.equal(aiRows(d('d1')).length, 0);
  await call(...desc('もう一度'));
  assert.equal(aiRows(d('d1')).length, 1);
  app.close();
});

test('8-5: 右の欄の打ちかけの文字は、AI が書く前に人の 1 回の変更として確定する', async () => {
  const { app, T, call, d } = await boot();
  T.openDesign('d1');
  const ta = app.document.querySelector('#side-settings [data-field="design-desc"]');
  assert.ok(ta);
  ta.focus();
  ta.value = '人が打ちかけた説明';
  const undo0 = T.store.undoStack.length;
  assert.equal((await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '電話番号', type: 'text1' }] })).ok, true);
  assert.equal(d('d1').description, '人が打ちかけた説明');
  assert.equal(T.store.undoStack.length, undo0 + 2);
  T.store.undo();
  assert.equal(d('d1').description, '人が打ちかけた説明');
  assert.equal(d('d1').items.length, 3);
  app.close();
});

test('8-5: 日本語を変換している間は、画像・出力の道具で右の欄の打ちかけの文字を確定しない（変換が終われば、確定してから描く）', async () => {
  const { app, T, call, d } = await boot(systemState());
  T.openDesign('d1');
  assert.equal((await call(...desc('AI の変更'))).ok, true);
  const doc = app.document;
  assert.ok(doc.querySelector('#ai-band'));
  const ta = doc.querySelector('#side-settings [data-field="design-desc"]');
  ta.focus();
  ta.value = 'にゅうりょく';
  doc.dispatchEvent(new app.window.Event('compositionstart'));
  const undo0 = T.store.undoStack.length;
  for (const [tool, args] of [['get_screen_image', { design: 'd1', screen: 's1' }], ['export_design', { design: 'd1', format: 'html' }], ['export_system_doc', { system: 'y1' }]]) {
    assert.equal((await call(tool, args)).ok, true, tool);
    assert.equal(d('d1').description, 'AI の変更', `${tool}: 変換中のかなは確定しない`);
    assert.equal(T.store.undoStack.length, undo0, `${tool}: 人の変更として履歴に入れない`);
    assert.ok(doc.querySelector('#ai-band'), `${tool}: 紫の帯は閉じない`);
  }
  doc.dispatchEvent(new app.window.Event('compositionend'));
  ta.value = '入力';
  assert.equal((await call('get_screen_image', { design: 'd1', screen: 's1' })).ok, true);
  assert.equal(d('d1').description, '入力', '変換が終われば、確定してから描く');
  app.close();
});

test('保存に失敗したときは、save_failed を返す', async () => {
  const { app, T, call } = await boot();
  T.store.adapter.save = () => false;
  const r = await call(...desc('保存できない'));
  assert.equal(r.error.code, 'save_failed');
  assert.match(r.error.message, /ファイルへの保存に失敗しました/);
  app.close();
});

test('重さ: 書く頼み 1 回で、描き直しは 1 回・違いの計算（designDiff）は最初の頼みで 1 回。「AI が直す前の状態」の行がもうあれば、写しの行（revisionRow）を作らない', async () => {
  const { app, T, call } = await boot();
  T.openDesign('d1');
  const win = app.window;
  const count = {};
  ['revisionRow', 'updateEditor', 'designDiff'].forEach((name) => {
    const orig = win[name];
    count[name] = 0;
    win[name] = function (...a) { count[name]++; return orig.apply(this, a); };
  });
  const reset = () => Object.keys(count).forEach((k) => { count[k] = 0; });
  assert.equal((await call(...desc('1 回目'))).ok, true);
  assert.deepEqual({ ...count }, { revisionRow: 1, updateEditor: 1, designDiff: 1 });
  reset();
  assert.equal((await call(...desc('2 回目'))).ok, true);
  assert.equal(count.revisionRow, 0, '行がもうあるときは、写しの行を作らない');
  assert.equal(count.updateEditor, 1);
  assert.equal(aiRows(T.store.state.designs.find((d) => d.id === 'd1')).length, 1);
  assert.match(app.document.querySelector('#ai-band').textContent, /変更 1 件/);
  app.close();
});
