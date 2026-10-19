'use strict';
// AI の見た目（第 7 段階の T10。仕様_細かい決めごと.md の「AI の見た目の細かい決めごと」・画像 q48〜q51）のテスト。
// 紫の札・紫の帯（AI が直した・作った）・オレンジの帯（元に戻すの履歴を消した）・光らせ方と札・画面の一覧の「AI」の印・
// 一覧の画面のカードの札・「AI が直す前の状態」の行の上限・「AI とつなぐ」の窓。タスクトレイは test/automation-tray.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, STORAGE_KEY, plain, tick } = require('./ai-fixtures');

// preload の aiAPI の身代わり。onStatus で受け取った関数を statusCb に控え、copyText で写した文を copied に残す
function fakeAiAPI(info = { claudeCommand: "claude mcp add --env ELECTRON_RUN_AS_NODE=1 --scope user mockimagemaker 'C:\\x\\MockImageMaker.exe' 'C:\\x\\mcp-server.js'", json: '{ "mcpServers": {} }', dev: false }) {
  const f = {
    statusCb: null,
    copied: [],
    onRequest() {},
    ready() {},
    onStatus(cb) { f.statusCb = cb; },
    connectInfo: async () => info,
    copyText: async (t) => { f.copied.push(t); return true; },
  };
  return f;
}
async function boot({ state = sampleState(), ai = fakeAiAPI() } = {}) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) }, aiAPI: ai });
  const T = await app.api();
  const call = async (tool, args = {}, session = 's-1', client = 'claude-code') => plain(await T.aiDispatch(tool, args, { session, client }));
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  const click = (sel) => { const el = $(sel); assert.ok(el, `${sel} がない`); el.click(); };
  return { app, T, call, $, $$, click, ai };
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

test('紫の札: AI がつながっている間だけ、いちばん上の帯の右に出す（一覧の画面と編集の画面）。押すと「AI とつなぐ」の窓', async () => {
  const { app, T, $, click, ai } = await boot();
  assert.equal($('#ai-chip').hidden, true);
  ai.statusCb({ clients: [{ session: 's-1', client: 'claude-code' }] });
  assert.equal($('#ai-chip').hidden, false);
  assert.equal(text($('#ai-chip')), 'Claude Code がつながっています');
  T.openDesign('d1');
  assert.equal(text($('#ai-chip')), 'Claude Code がつながっています', '編集の画面にも出る');
  ai.statusCb({ clients: [{ session: 's-1', client: 'claude-code' }, { session: 's-2', client: 'cursor' }] });
  assert.equal(text($('#ai-chip')), 'AI が 2 つつながっています（Claude Code・cursor）');
  click('#ai-chip');
  await tick();
  assert.match(text($('#dialog-root .modal')), /AI とつなぐ.*今つながっている AI：Claude Code・cursor/);
  ai.statusCb({ clients: [] });
  assert.match(text($('#aic-status')), /今つながっている AI はありません。/, '窓を開いている間も、つながりの数を描き直す');
  assert.equal($('#ai-chip').hidden, true);
  app.close();
});

test('「AI とつなぐ」の窓: main の登録の文を出し、コピーできる。ブラウザで開いたとき（aiAPI がない）は出さない。開いている間も AI の書く頼みは通る', async () => {
  const { app, T, call, $, $$, ai } = await boot();
  T.runCommand('aiConnect');
  await tick();
  const modal = $('#dialog-root .modal');
  assert.match(text(modal), /Claude Code に登録する.*PowerShell に下の文を貼り付けて/);
  assert.match(text($('[data-code="claude"]')), /^claude mcp add --env ELECTRON_RUN_AS_NODE=1 --scope user mockimagemaker/);
  assert.equal(text($('[data-code="json"]')), '{ "mcpServers": {} }');
  assert.equal($('.aic-dev'), null, 'インストールした版では開発版の断りを出さない');
  assert.deepEqual($$('.modal-actions button:not([hidden])').map((b) => b.textContent), ['閉じる']);
  $('[data-copy="claude"]').click();
  await tick();
  assert.deepEqual(ai.copied, [ai.copied[0]]);
  assert.match(ai.copied[0], /^claude mcp add/);
  assert.equal(text($('[data-copy="claude"]')), '✓ コピーしました');
  // 見るだけの窓なので、開いている間も AI は直せる
  assert.equal((await call('update_design', { design: 'd1', description: '窓が開いている間' })).ok, true);
  $('[data-dlg="cancel"]').click();
  app.close();
  // 開発版の文には断りを付ける
  const dev = await boot({ ai: fakeAiAPI({ claudeCommand: 'claude mcp add --scope user mockimagemaker-dev node x', json: '{}', dev: true }) });
  dev.T.runCommand('aiConnect');
  await tick();
  assert.match(text(dev.$('.aic-dev')), /開発版/);
  dev.app.close();
  // ブラウザで開いたとき
  const web = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  const W = await web.api();
  W.runCommand('aiConnect');
  await tick();
  assert.equal(web.document.querySelector('#dialog-root .modal'), null);
  assert.equal(web.document.querySelector('#ai-chip').hidden, true);
  web.close();
});

test('開いている画面設計を AI が直すと、紫の帯（件数）・開いている画面の部品の札と光り方・ほかの画面の縮小画像の「AI」の印を出す', async () => {
  const { app, T, call, $, $$, click } = await boot();
  T.openDesign('d1');
  assert.equal($('#ai-band'), null);
  const r = await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '区分', name: '顧客区分' }, { op: 'add', name: '電話番号', type: 'text1' }] });
  assert.equal(r.ok, true);
  await call('layout_screen', { design: 'd1', screen: '新規登録', mode: 'append', layout: { rows: [[{ item: '電話番号' }]] } });
  await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'search' }]] } });
  const band = $('#ai-band');
  assert.match(text(band), /^✦Claude Code が「顧客管理」を直しました（変更 \d+ 件）。直した部品を紫の枠で光らせています。/);
  assert.deepEqual($$('#ai-band button').map((b) => b.textContent), ['変更内容を見る', '元に戻す（Ctrl+Z）', '✕']);
  // 開いている画面（新規登録）の、直した部品と足した部品に札。光り方は今始まった
  const tagOf = (id) => text($(`#stage .part[data-part-id="${id}"] .ai-tag`));
  assert.equal(tagOf('p3'), 'AI が直した');
  assert.equal(tagOf('p1'), '');
  const added = $$('#stage .screen .part').find((el) => !['p1', 'p2', 'p3'].includes(el.dataset.partId));
  assert.equal(text(added.querySelector('.ai-tag')), 'AI が足した');
  assert.ok(added.classList.contains('ai-glow'));
  // ほかの画面（一覧）は切り替えず、縮小画像に「AI」の印。開くと印が消えて光る
  assert.equal(T.ui.screenId, 's1');
  const dotOf = (id) => $(`#screen-list .sl-item[data-id="${id}"] .ai-dot`);
  assert.ok(dotOf('s2'));
  assert.equal(dotOf('s1'), null);
  click('#screen-list .sl-item[data-id="s2"]');
  assert.equal(dotOf('s2'), null);
  assert.ok($('#stage .screen .part.ai-glow'));
  // 変更内容を見る（AI が最初に直す前と今の違い）
  click('[data-action="ai-show-changes"]');
  await tick();
  assert.match(text($('#dialog-root .modal h2')), /Claude Code が「顧客管理」を直した内容/);
  assert.match(text($('#dialog-root .modal')), /区分 → 顧客区分/);
  $('[data-dlg="cancel"]').click();
  app.close();
});

test('光らせるのは、その 1 回の頼みで変わった部品だけ。札（AI が足した・直した）は紫の帯が出ている間の合計。見ていない画面は、開いたときに見ていない間の分を光らせる', async () => {
  const { app, T, call, $, $$, click } = await boot();
  T.openDesign('d1');
  const el = (id) => $(`#stage .part[data-part-id="${id}"]`);
  await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: '区分', name: '顧客区分' }] });
  assert.ok(el('p3').classList.contains('ai-glow'));
  await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'move', part: 'p1', x: 32, y: 240 }] });
  assert.equal(text(el('p3').querySelector('.ai-tag')), 'AI が直した', '前の頼みで直した部品の札は残す');
  assert.equal(el('p3').classList.contains('ai-glow'), false, '前の頼みで直した部品は、光らせ直さない');
  assert.equal(text(el('p1').querySelector('.ai-tag')), 'AI が直した');
  assert.ok(el('p1').classList.contains('ai-glow'));
  // 見ていない画面（一覧）を 2 回直したら、開いたときに 2 回分を光らせる
  await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'search' }]] } });
  await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'pager' }]] } });
  assert.equal(el('p1').classList.contains('ai-glow'), true, 'ほかの画面を直しても、開いている画面の光り方は続く');
  click('#screen-list .sl-item[data-id="s2"]');
  const parts = $$('#stage .screen .part');
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.classList.contains('ai-glow')));
  app.close();
});

test('紫の帯は、AI が続けて直すと件数を足して出し直し、人が直す・✕ を押すと閉じる。「元に戻す」は AI の変更を 1 回戻す', async () => {
  const { app, T, call, $, click } = await boot();
  T.openDesign('d1');
  await call('update_design', { design: 'd1', description: 'AI の 1 回目' });
  const count = () => Number(text($('#ai-band')).match(/変更 (\d+) 件/)[1]);
  assert.equal(count(), 1);
  await call('update_design', { design: 'd1', name: '顧客台帳' });
  assert.equal(count(), 1, '同じ行（画面設計の設定変更）にまとまる');
  assert.match(text($('#ai-band')), /「顧客台帳」を直しました/);
  await call('edit_items', { design: 'd1', ops: [{ op: 'add', name: '備考', type: 'text2' }] });
  assert.equal(count(), 2);
  // 人が直すと閉じる
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  assert.equal($('#ai-band'), null);
  // ✕ で閉じる
  await call('update_design', { design: 'd1', description: 'AI の 2 回目' });
  click('[data-action="ai-band-close"]');
  assert.equal($('#ai-band'), null);
  // 「元に戻す」は AI の 1 回を戻し、帯は閉じる
  await call('update_design', { design: 'd1', description: 'AI の 3 回目' });
  click('#ai-band [data-action="undo"]');
  assert.equal(T.store.state.designs[0].description, 'AI の 2 回目');
  assert.equal($('#ai-band'), null);
  app.close();
});

test('オレンジの帯: AI がほかの画面設計を直して履歴を消したときは ✕ まで残す。その後の Ctrl+Z ではわけを知らせる', async () => {
  const { app, T, call, $, click } = await boot();
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  await call('update_design', { design: '受注管理', description: 'AI の変更' });
  const warn = $('#ai-warn');
  assert.match(text(warn), /Claude Code が「受注管理」を直したので、元に戻す（Ctrl\+Z）の履歴を消しました。開いている「顧客管理」は変わっていません。/);
  assert.match(text(warn), /「受注管理」の改訂履歴の「Claude Code が直す前の状態」から戻せます。/);
  assert.equal($('#ai-band'), null, '紫の帯は出さない');
  T.runCommand('undo');
  assert.equal(text($('#toast')), '元に戻せる操作はありません（AI が「受注管理」を直したときに、履歴を消しました）。');
  T.actions.updateDesignInfo('d1', { description: '人の変更 2' });
  assert.ok($('#ai-warn'), '人が直しても残る');
  // 「受注管理」の改訂履歴を開く
  click('[data-action="ai-open-revisions"]');
  await tick();
  assert.equal(T.ui.designId, 'd2');
  assert.match(text($('#dialog-root .modal')), /改訂履歴/);
  assert.match(text($('#dialog-root .modal')), /Claude Code が直す前の状態/);
  $('[data-dlg="cancel"]').click();
  assert.equal($('#ai-warn'), null, 'ほかの画面設計を開いたら片付ける');
  // ✕ で閉じる
  T.actions.updateDesignInfo('d2', { description: '人の変更 3' });
  await call('update_design', { design: '顧客管理', description: 'AI の変更 2' });
  click('[data-action="ai-warn-close"]');
  assert.equal($('#ai-warn'), null);
  app.close();
});

test('紫の帯の「元に戻す」は、その後に AI が元に戻すの履歴を消したら出さない（押しても戻らないため）', async () => {
  for (const next of [['create_design', { name: '経費精算' }], ['update_design', { design: '受注管理', description: 'AI がほかの画面設計を直す' }]]) {
    const { app, T, call, $, $$ } = await boot();
    T.openDesign('d1');
    await call('update_design', { design: 'd1', description: 'AI の変更' });
    assert.deepEqual($$('#ai-band button').map((b) => b.textContent), ['変更内容を見る', '元に戻す（Ctrl+Z）', '✕']);
    assert.equal((await call(...next)).ok, true);
    assert.ok($('#ai-warn'), `${next[0]}: オレンジの帯で、履歴を消したことを知らせる`);
    assert.equal(T.store.canUndo(), false);
    assert.match(text($('#ai-band')), /Claude Code が「顧客管理」を直しました（変更 1 件）。/, `${next[0]}: 紫の帯は残す`);
    assert.deepEqual($$('#ai-band button').map((b) => b.textContent), ['変更内容を見る', '✕'], `${next[0]}: 「元に戻す」は出さない`);
    app.close();
  }
});

test('前の版を見ている間は、画面の一覧の「AI」の印を出さず、開いても印と光らせ方を使わない。見るのをやめると元どおり働く', async () => {
  const { app, T, call, $, click } = await boot();
  T.openDesign('d1');
  await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'search' }]] } });
  const dotOf = (id) => $(`#screen-list .sl-item[data-id="${id}"] .ai-dot`);
  assert.ok(dotOf('s2'));
  const row = T.store.state.designs.find((d) => d.id === 'd1').revisions.find((r) => r.kind === 'ai');
  assert.equal(T.startViewRevision(row.id), true);
  assert.equal(T.store.isViewing, true);
  assert.equal(dotOf('s2'), null, '前の版の縮小画像には印を付けない');
  click('#screen-list .sl-item[data-id="s2"]');
  assert.equal(T.ui.screenId, 's2');
  assert.equal(T.aiView.unseen.has('s2'), true, '見ている間に開いても、印は消さない');
  assert.equal(T.aiView.glow.has('s2'), false, '見ている間に開いても、光らせ始めない');
  click('[data-action="rev-stop-view"]');
  assert.equal(T.store.isViewing, false);
  assert.equal(T.ui.screenId, 's1');
  assert.ok(dotOf('s2'), '見るのをやめると、印が戻る');
  click('#screen-list .sl-item[data-id="s2"]');
  assert.equal(dotOf('s2'), null);
  assert.ok($('#stage .screen .part.ai-glow'), '開くと光る');
  app.close();
});

test('前の版を見ている間の Ctrl+Z では、「AI が履歴を消しました」の知らせを出さない（元に戻せないのは見ているため）', async () => {
  const { app, T, call, $, click } = await boot();
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  await call('update_design', { design: '受注管理', description: 'AI の変更' }); // 履歴を消す
  await call('update_design', { design: 'd1', description: 'AI の変更 2' }); // 見るための「AI が直す前の状態」の行
  T.actions.updateDesignInfo('d1', { description: '人の変更 2' }); // 消した後に、人がまた直した（元に戻せる）
  const row = T.store.state.designs.find((d) => d.id === 'd1').revisions.find((r) => r.kind === 'ai');
  assert.equal(T.startViewRevision(row.id), true);
  $('#toast').textContent = '';
  T.runCommand('undo');
  assert.doesNotMatch(text($('#toast')), /履歴を消しました/);
  click('[data-action="rev-stop-view"]');
  assert.equal(T.store.isViewing, false);
  T.runCommand('undo');
  assert.equal(T.store.state.designs.find((d) => d.id === 'd1').description, 'AI の変更 2', '見るのをやめた後は元に戻せる');
  app.close();
});

test('元に戻すの履歴がないときに AI がほかの画面設計を直したら、紫の帯で知らせ、その画面設計を開ける', async () => {
  const { app, T, call, $, click } = await boot();
  T.openDesign('d1');
  await call('update_design', { design: '受注管理', description: 'AI の変更' });
  assert.equal($('#ai-warn'), null);
  assert.match(text($('#ai-band')), /Claude Code が「受注管理」を直しました。開いている「顧客管理」は変わっていません。.*「受注管理」を開く/);
  click('[data-action="ai-open-design"]');
  assert.equal(T.ui.designId, 'd2');
  assert.equal($('#ai-band'), null);
  app.close();
});

test('一覧の画面: AI が作った・直したカードに紫の枠と札、帯に「開く」。画面設計を開くと消え、編集中に AI が直したカードは一覧に戻ったときに出す', async () => {
  const { app, T, call, $, click } = await boot();
  const c = await call('create_design', { name: '経費精算', target: 'kintone' });
  const card = (id) => $(`.card[data-id="${id}"]`);
  assert.ok(card(c.result.id).classList.contains('ai-mark'));
  assert.ok(card(c.result.id).classList.contains('ai-glow'));
  assert.equal(text(card(c.result.id).querySelector('.ai-card-tag')), 'AI が作った');
  assert.match(text($('#ai-band')), /Claude Code が「経費精算」を作りました。開く/);
  await call('update_design', { design: c.result.id, description: '立て替えた経費を申請する。' });
  assert.equal(text(card(c.result.id).querySelector('.ai-card-tag')), 'AI が作った', '作ったカードは「作った」のまま');
  await call('update_design', { design: 'd2', description: 'AI の変更' });
  assert.equal(text(card('d2').querySelector('.ai-card-tag')), 'AI が直した');
  click('#ai-band [data-action="ai-open-design"]');
  assert.equal(T.ui.designId, 'd2');
  // 編集中に AI がほかの画面設計を直す → 一覧に戻ったときにカードに出す
  await call('update_design', { design: 'd1', description: '編集中の AI の変更' });
  T.goHome();
  assert.equal(card(c.result.id).querySelector('.ai-card-tag'), null, '前に一覧で見せた印は消えている');
  assert.equal(text(card('d1').querySelector('.ai-card-tag')), 'AI が直した');
  assert.ok(card('d1').classList.contains('ai-glow'), '一覧に出したときに光らせる');
  app.close();
});

test('改訂履歴に版を足しただけのときは、お知らせ（黒い帯）で知らせる', async () => {
  const { app, T, call, $ } = await boot();
  T.openDesign('d1');
  await call('add_revision', { design: 'd1', note: '最初の版' });
  assert.equal(text($('#toast')), 'Claude Code が「顧客管理」を改訂しました（第 1 版）。');
  assert.equal($('#ai-band'), null);
  app.close();
});

test('「AI が直す前の状態」の行は、画面設計ごとに新しい方から 10 行まで（人の付けた版の行は消さない）', async () => {
  const { app, T, call } = await boot();
  T.actions.addRevision('d1', { note: '人の第 1 版' });
  for (let i = 1; i <= 12; i++) assert.equal((await call('update_design', { design: 'd1', description: `接続 ${i} の変更` }, `s-${i}`)).ok, true);
  const d1 = T.store.state.designs.find((d) => d.id === 'd1');
  const ai = d1.revisions.filter((r) => r.kind === 'ai');
  assert.equal(ai.length, T.AI_ROWS_MAX);
  assert.equal(T.AI_ROWS_MAX, 10);
  assert.deepEqual(plain(ai.map((r) => r.aiSession)), Array.from({ length: 10 }, (_, k) => `s-${k + 3}`), '古い 2 行（接続 1・2）が消える');
  assert.equal(ai[0].snapshot.description, '接続 2 の変更', '残った行の写しは、その接続が直す前の中身');
  assert.equal(d1.revisions.filter((r) => r.kind === 'revision').length, 1);
  app.close();
});

test('アプリのページの AI_CLIENT_NAMES は、タスクトレイ（main）の名前の対応と同じ', async () => {
  const { app, T } = await boot();
  const { CLIENT_NAMES } = require('../automation-tray');
  assert.deepEqual(plain(T.AI_CLIENT_NAMES), CLIENT_NAMES);
  app.close();
});
