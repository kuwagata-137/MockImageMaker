'use strict';
// AI の窓口の第 9 段階の道具のテスト（T4）: システムを読む（list_systems・get_system）・作る・直す（create_system・update_system・
// add_to_system・remove_from_system・set_swimlane）・create_design の system・get_view_image の swimlane と、
// システムの「AI が直す前の状態」の行（q65）・人が戻す restoreSystemRevision・元に戻すの履歴の決め方（q66）。
// 名前は架空の業務（顧客管理・受注管理・営業管理システムなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { systemState, system, swStep, OLD, STORAGE_KEY, plain } = require('./ai-fixtures');
const { TOOLS } = require('../mcp-tools');
const { INSTRUCTIONS, GUIDES } = require('../mcp-guide');

async function boot(state = systemState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}, session = 's-1', client = 'claude-code') => plain(await T.aiDispatch(tool, args, { session, client }));
  const sys = (id) => plain(T.store.state.systems.find((y) => y.id === id));
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  return { app, T, call, sys, d };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r.result)); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };
const aiRows = (y) => y.revisions.filter((r) => r.kind === 'ai');
const stepOf = (y, id) => y.swimlane.steps.find((w) => w.id === id);

// ── 読む ──
test('list_systems: ごみ箱にないシステムを並べる（id・名前・説明の頭・画面設計と役割と作業の数・更新の印）。query で名前を探し、trashed でごみ箱のものも出す', async () => {
  const st = systemState();
  st.systems[1].description = 'あ'.repeat(100);
  const { app, call } = await boot(st);
  const r = ok(await call('list_systems'));
  const stages = { read: 'todo', flow: 'todo', items: 'todo', screens: 'todo', docs: 'todo' }; // 設計ノートの段階ごとの進み具合（第 10 段階。test/ai-notes.test.js）
  assert.deepEqual(r.systems, [
    { id: 'y1', name: '営業管理システム', description: '顧客の登録から受注までをまとめる。', designs: 2, roles: 2, steps: 3, materials: 1, stages, updatedAt: OLD },
    { id: 'y2', name: '請求管理システム', description: 'あ'.repeat(60) + '…', designs: 1, roles: 0, steps: 0, materials: 0, stages, updatedAt: OLD },
  ]);
  assert.deepEqual([r.total, r.nextCursor], [2, null]);
  assert.deepEqual(ok(await call('list_systems', { query: '請求' })).systems.map((y) => y.id), ['y2']);
  const t = ok(await call('list_systems', { trashed: true }));
  assert.deepEqual(t.systems.map((y) => [y.id, !!y.trashed]), [['y1', false], ['y2', false], ['y3', true]]);
  assert.deepEqual(ok(await call('list_systems', { query: '古い', trashed: true })).systems.map((y) => y.id), ['y3']);
  app.close();
});

test('get_system: 名前・説明・役割（作業の数）・画面設計の並び（ほかに入っているシステム・ごみ箱の印）・作業（役割の名前と指す先の名前）・矢印・履歴の行・更新の印', async () => {
  const st = systemState();
  st.systems[0].swimlane.steps[2].ref.screenId = 's-nai';
  st.systems[1].designIds.push('d3'); // ごみ箱の画面設計
  const { app, call } = await boot(st);
  const r = ok(await call('get_system', { system: '営業管理システム' }));
  assert.deepEqual([r.id, r.name, r.description, r.updatedAt], ['y1', '営業管理システム', '顧客の登録から受注までをまとめる。', OLD]);
  assert.deepEqual(r.roles, [{ id: 'l1', name: '営業', memo: '', steps: 2 }, { id: 'l2', name: '上長', memo: '課長以上', steps: 1 }]);
  assert.deepEqual(r.designs, [
    { id: 'd1', name: '顧客管理', target: 'kintone', screens: 2, sharedWith: ['請求管理システム'] },
    { id: 'd2', name: '受注管理', target: 'kintone', screens: 1, sharedWith: [] },
  ]);
  assert.equal(r.steps[0].ref, null);
  assert.deepEqual(r.steps[1], {
    id: 'w2', role: '営業', roleId: 'l1', col: 1, kind: 'input', text: '顧客を登録する', memo: '',
    ref: { design: { id: 'd1', name: '顧客管理' }, screen: { id: 's1', name: '新規登録' }, state: { id: 't1', name: '申請' } },
  });
  assert.deepEqual(r.steps[2].ref.screen, { id: 's-nai', name: '（ない画面）' });
  assert.deepEqual(r.edges, [{ id: 'e1', from: 'w1', to: 'w2', label: '' }, { id: 'e2', from: 'w2', to: 'w3', label: '' }]);
  assert.deepEqual(r.revisions, []);
  assert.deepEqual([r.rolesTotal, r.designsTotal, r.stepsTotal, r.edgesTotal, r.nextCursor], [2, 2, 3, 2, null]);
  assert.deepEqual([r.materials, r.materialsTotal], [[{ id: 'm1', name: '受注の流れ.txt', kind: 'text', kindName: '文字', size: 10, addedAt: OLD, memo: '' }], 1], '資料（第 9 段階の後半。test/ai-materials.test.js）');
  const r2 = ok(await call('get_system', { system: 'y2' }));
  assert.deepEqual(r2.designs[1], { id: 'd3', name: '出張申請', target: 'その他', screens: 1, trashed: true, sharedWith: [] });
  assert.equal(ok(await call('get_system', { system: '古いシステム' })).trashed, true, 'ごみ箱のシステムも読める');
  app.close();
});

test('get_system: 大きいときは 役割・画面設計・作業・矢印 の順に分けて nextCursor を付ける（どのページも目安の 24,000 字に収まる）', async () => {
  const st = systemState();
  const y = st.systems[0];
  y.swimlane.steps = Array.from({ length: 300 }, (_, i) => swStep(`wx${i}`, 'l1', i, 'task', `顧客の連絡先を確かめて受注の見込みを書く作業の見本 ${i}`));
  y.swimlane.edges = y.swimlane.steps.slice(1).map((w, i) => ({ id: `ex${i}`, from: `wx${i}`, to: w.id, label: '次へ' }));
  const { app, call } = await boot(st);
  const pages = [];
  let cursor = null;
  do {
    const r = ok(await call('get_system', { system: 'y1', ...(cursor ? { cursor } : {}) }));
    assert.ok(JSON.stringify(r).length <= 24000, `${JSON.stringify(r).length} 字`);
    pages.push(r);
    cursor = r.nextCursor;
  } while (cursor);
  assert.ok(pages.length >= 2);
  assert.equal(pages.flatMap((p) => p.roles).length, 2);
  assert.equal(pages.flatMap((p) => p.designs).length, 2);
  assert.equal(pages.flatMap((p) => p.steps).length, 300);
  assert.equal(pages.flatMap((p) => p.edges).length, 299);
  assert.equal(pages[0].stepsTotal, 300);
  app.close();
});

// ── 作る・直す ──
test('create_system: 作ったシステムの id を返す。同じ名前があれば知らせる。新しいシステムには「AI が直す前の状態」の行を残さず、元に戻すの履歴は消す', async () => {
  const { app, T, call, sys } = await boot();
  T.openDesign('d1');
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  const r = ok(await call('create_system', { name: ' 出張申請  システム ', description: '出張の申請をまとめる' }));
  assert.match(r.id, /^y-/);
  assert.deepEqual([r.name, r.updatedAt, r.changed], ['出張申請 システム', sys(r.id).updatedAt, true]);
  assert.deepEqual([sys(r.id).description, sys(r.id).revisions], ['出張の申請をまとめる', []]);
  assert.equal(T.store.undoStack.length, 0);
  const warn = app.document.querySelector('#ai-warn').textContent;
  assert.match(warn, /Claude Code が「出張申請 システム」を作ったので、元に戻す（Ctrl\+Z）の履歴を消しました。開いている「顧客管理」は変わっていません。/);
  assert.doesNotMatch(warn, /から戻せます/);
  const same = ok(await call('create_system', { name: '営業管理システム' }));
  assert.match(same.warnings[0], /同じ名前のシステムがもうあります（y1）/);
  ng(await call('create_system', { name: '  ' }), 'bad_request');
  app.close();
});

test('update_system: 名前・説明と役割の ops（足す・名前を変える・メモ・並べ替える）を 1 回の変更で行う。役割は id か名前で指す', async () => {
  const { app, T, call, sys } = await boot();
  const u0 = T.store.undoStack.length;
  const r = ok(await call('update_system', { system: '営業管理システム', expect: OLD, name: '営業管理システム（新）', description: '説明を直した', ops: [
    { op: 'add', name: '経理', memo: '月末に締める' },
    { op: 'rename', role: '上長', name: '課長' },
    { op: 'set_memo', role: 'l1', memo: '外回り' },
    { op: 'move', role: '経理', to: 0 },
  ] }));
  const y = sys('y1');
  assert.deepEqual([y.name, y.description], ['営業管理システム（新）', '説明を直した']);
  assert.deepEqual(y.roles.map((x) => [x.name, x.memo]), [['経理', '月末に締める'], ['営業', '外回り'], ['課長', '課長以上']]);
  assert.deepEqual(r.roles, y.roles);
  assert.deepEqual(r.ops[0], { op: 'add', id: y.roles[0].id, name: '経理' });
  assert.deepEqual(r.ops[3], { op: 'move', id: y.roles[0].id, name: '経理', index: 0 });
  assert.equal(r.updatedAt, y.updatedAt);
  assert.notEqual(y.updatedAt, OLD);
  assert.equal(aiRows(y).length, 1, '直す前の行は 1 回の変更に 1 行');
  assert.ok(T.store.undoStack.length <= u0 + 1);
  app.close();
});

test('update_system: 役割を消すと、その役割の作業と矢印も消え、返事で数を知らせる。断るとき（同じ名前・ない役割・並びの外・直す欄がない）は何も変わらない', async () => {
  const { app, call, sys } = await boot();
  const r = ok(await call('update_system', { system: 'y1', ops: [{ op: 'delete', role: '上長' }] }));
  assert.deepEqual(r.ops[0], { op: 'delete', id: 'l2', name: '上長', removedSteps: 1, removedEdges: 1 });
  assert.match(r.warnings[0], /役割「上長」の作業 1 つと矢印 1 本も消しました/);
  assert.deepEqual(sys('y1').swimlane.steps.map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(sys('y1').swimlane.edges.map((e) => e.id), ['e1']);
  const before = sys('y1');
  ng(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }, { op: 'add', name: '営業' }] }), 'same_name');
  ng(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }, { op: 'rename', role: '経理', name: '営業' }] }), 'same_name');
  const e = ng(await call('update_system', { system: 'y1', ops: [{ op: 'set_memo', role: '社長', memo: 'x' }] }), 'not_found');
  assert.match(e.message, /^ops\[0\]（set_memo）: 「社長」という「営業管理システム」の役割は見つかりません/);
  ng(await call('update_system', { system: 'y1', ops: [{ op: 'move', role: '営業', to: 5 }] }), 'bad_request');
  ng(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '  ' }] }), 'bad_request');
  ng(await call('update_system', { system: 'y1', ops: [{ op: 'swap' }] }), 'bad_request');
  ng(await call('update_system', { system: 'y1' }), 'bad_request');
  ng(await call('update_system', { system: 'y1', name: '' }), 'bad_request');
  assert.deepEqual(sys('y1'), before, '断った頼みでは何も変わらない');
  app.close();
});

test('システムの指し方: 名前が 2 つに当たれば候補を付けて断る。ない名前は not_found。ごみ箱のシステムは読めるが直せない。読んだ後に直されていれば stale', async () => {
  const st = systemState();
  st.systems.push(system('y4', '請求管理システム', []));
  const { app, T, call } = await boot(st);
  const a = ng(await call('update_system', { system: '請求管理システム', description: 'x' }), 'ambiguous');
  assert.deepEqual(a.candidates.map((c) => c.id), ['y2', 'y4']);
  ng(await call('get_system', { system: 'ないシステム' }), 'not_found');
  const t = ng(await call('update_system', { system: '古いシステム', description: 'x' }), 'trashed');
  assert.match(t.message, /「古いシステム」はごみ箱にあるため、直せません。アプリのごみ箱から一覧に戻してから/);
  ng(await call('set_swimlane', { system: 'y3', steps: [] }), 'trashed');
  const read = ok(await call('get_system', { system: 'y1' }));
  T.actions.updateSystem('y1', { description: '人が直した' });
  const s = ng(await call('update_system', { system: 'y1', expect: read.updatedAt, description: 'AI の古い中身' }), 'stale');
  assert.match(s.message, /「営業管理システム」は、読んだ後にアプリで直されました。読み直してから頼んでください/);
  ok(await call('update_system', { system: 'y1', expect: ok(await call('get_system', { system: 'y1' })).updatedAt, description: '読み直した' }));
  app.close();
});

// ── 「AI が直す前の状態」の行（q65）──
test('q65: システムの「AI が直す前の状態」の行は、接続ごと・システムごとに最初の 1 回だけ。写しは名前・説明・役割・スイムレーン・画面設計の並びだけで、凍らせてある', async () => {
  const { app, T, call, sys } = await boot();
  ok(await call('update_system', { system: 'y1', description: '1 回目' }));
  ok(await call('update_system', { system: 'y1', description: '2 回目' }));
  let rows = aiRows(sys('y1'));
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^r-/);
  assert.deepEqual([rows[0].note, rows[0].aiSession, typeof rows[0].date], ['Claude Code が直す前の状態', 's-1', 'string']);
  assert.deepEqual(Object.keys(rows[0].snapshot).sort(), ['description', 'designIds', 'name', 'roles', 'swimlane']);
  assert.equal(rows[0].snapshot.description, '顧客の登録から受注までをまとめる。');
  assert.deepEqual(rows[0].snapshot.designIds, ['d1', 'd2']);
  assert.equal(rows[0].snapshot.swimlane.steps.length, 3);
  const live = T.store.state.systems.find((y) => y.id === 'y1').revisions[0].snapshot;
  assert.ok(Object.isFrozen(live) && Object.isFrozen(live.swimlane.steps[0]), '写しは凍らせる');
  ok(await call('update_system', { system: 'y1', description: '別の接続' }, 's-2', 'cursor'));
  rows = aiRows(sys('y1'));
  assert.deepEqual(rows.map((r) => [r.note, r.snapshot.description]), [['Claude Code が直す前の状態', '顧客の登録から受注までをまとめる。'], ['cursor が直す前の状態', '2 回目']]);
  // 何も変わらない頼みでは、行も更新の印も変わらない
  const at = sys('y2').updatedAt;
  assert.equal(ok(await call('update_system', { system: 'y2', name: '請求管理システム' })).changed, false);
  assert.deepEqual([sys('y2').revisions, sys('y2').updatedAt], [[], at]);
  app.close();
});

test('q65: 「AI が直す前の状態」の行はシステムごとに新しい方から 10 行まで（戻す前の状態の行は消さない）', async () => {
  const { app, T, call, sys } = await boot();
  ok(await call('update_system', { system: 'y1', description: '第 0 回' }, 's-0'));
  T.actions.restoreSystemRevision('y1', aiRows(sys('y1'))[0].id);
  for (let i = 1; i < 12; i++) ok(await call('update_system', { system: 'y1', description: `第 ${i} 回` }, `s-${i}`));
  const rows = aiRows(sys('y1'));
  assert.equal(rows.length, 10);
  assert.deepEqual([rows[0].aiSession, rows[9].aiSession], ['s-2', 's-11']);
  assert.equal(rows[9].snapshot.description, '第 10 回');
  assert.equal(sys('y1').revisions.filter((r) => r.kind === 'restore').length, 1);
  app.close();
});

test('restoreSystemRevision: 今の中身を「戻す前の状態」の行に残してから写しの中身に置き換える（今ない画面設計は外す）。元に戻す 1 回で戻る', async () => {
  const { app, T, call, sys } = await boot();
  ok(await call('update_system', { system: 'y1', name: '営業システム', description: 'AI の変更', ops: [{ op: 'delete', role: '上長' }] }));
  T.actions.deleteDesignForever('d2');
  const row = aiRows(sys('y1'))[0];
  assert.deepEqual(row.snapshot.designIds, ['d1', 'd2']);
  assert.equal(T.actions.restoreSystemRevision('y-nai', row.id), false);
  assert.equal(T.actions.restoreSystemRevision('y1', 'r-nai'), false);
  const u0 = T.store.undoStack.length;
  assert.equal(T.actions.restoreSystemRevision('y1', row.id), true);
  let y = sys('y1');
  assert.deepEqual([y.name, y.description, y.roles.length, y.swimlane.steps.length, y.swimlane.edges.length], ['営業管理システム', '顧客の登録から受注までをまとめる。', 2, 3, 2]);
  assert.deepEqual(y.designIds, ['d1'], '今ない画面設計は外す');
  const back = y.revisions.at(-1);
  assert.equal(back.kind, 'restore');
  assert.match(back.note, /^「Claude Code が直す前の状態（\d{4}-\d{2}-\d{2}）」に戻す前の状態$/);
  assert.deepEqual([back.snapshot.name, back.snapshot.description, back.snapshot.roles.length], ['営業システム', 'AI の変更', 1]);
  assert.equal(T.store.undoStack.length, u0 + 1);
  T.store.undo();
  y = sys('y1');
  assert.deepEqual([y.name, y.roles.length, y.revisions.filter((r) => r.kind === 'restore').length], ['営業システム', 1, 0]);
  // 「戻す前の状態」の行からも戻せる（行の名前は「戻す前の状態」）
  T.actions.restoreSystemRevision('y1', row.id);
  assert.equal(T.actions.restoreSystemRevision('y1', sys('y1').revisions.at(-1).id), true);
  assert.equal(sys('y1').name, '営業システム');
  assert.match(sys('y1').revisions.at(-1).note, /^「戻す前の状態（\d{4}-\d{2}-\d{2}）」に戻す前の状態$/);
  app.close();
});

// ── 元に戻すの履歴（q66）──
test('q66: 人がそのシステムの画面を開いていて、変わったのがそのシステムだけなら、元に戻すの 1 回分として積む（紫の帯は件数を足して出し直す）', async () => {
  const { app, T, call, sys } = await boot();
  T.ui.view = 'system';
  T.ui.systemId = 'y1';
  T.actions.updateSystem('y1', { description: '人の変更' });
  const u0 = T.store.undoStack.length;
  ok(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }] }));
  assert.equal(T.store.undoStack.length, u0 + 1);
  assert.equal(T.aiView.warn, null);
  assert.deepEqual(plain([T.aiView.band.kind, T.aiView.band.systemId, T.aiView.band.count, T.aiView.band.undoable]), ['system', 'y1', 1, true]);
  ok(await call('remove_from_system', { system: 'y1', design: '受注管理' }));
  assert.equal(T.store.undoStack.length, u0 + 2);
  assert.equal(T.aiView.band.count, 2, '最初に直す前と比べた件数');
  T.store.undo();
  T.store.undo();
  const y = sys('y1');
  assert.deepEqual([y.roles.length, y.designIds, y.description, aiRows(y).length], [2, ['d1', 'd2'], '人の変更', 0]);
  app.close();
});

test('q66: ほかのシステム・画面設計も変わるとき・システムの画面を開いていないとき・新しいシステムは、元に戻すの履歴を消す', async () => {
  const { app, T, call } = await boot();
  const clearedBy = async (tool, args) => {
    T.actions.updateSystem('y1', { description: `人の変更 ${Math.random()}` });
    assert.ok(T.store.undoStack.length > 0);
    ok(await call(tool, args));
    return T.store.undoStack.length === 0;
  };
  T.ui.view = 'system';
  T.ui.systemId = 'y1';
  assert.equal(await clearedBy('update_system', { system: 'y2', description: 'ほかのシステム' }), true);
  assert.equal(await clearedBy('add_to_system', { system: 'y1', design: '顧客管理', mode: 'copy' }), true, '画面設計を作った');
  assert.equal(await clearedBy('create_system', { name: '出張申請システム' }), true);
  T.ui.view = 'home';
  assert.equal(await clearedBy('update_system', { system: 'y1', description: '一覧の画面' }), true);
  T.openDesign('d1');
  assert.equal(await clearedBy('update_system', { system: 'y1', description: '編集の画面' }), true);
  app.close();
});

test('知らせ: 一覧の画面で AI がシステムを直すと、紫の帯（件数つき）か、履歴を消したときはオレンジの帯で、システムの名前と「履歴」の案内を出す。Ctrl+Z の知らせもシステムの名前', async () => {
  const { app, T, call } = await boot();
  ok(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }, { op: 'add', name: '総務' }] }));
  assert.match(app.document.querySelector('#ai-band').textContent, /Claude Code が「営業管理システム」を直しました（変更 2 件）。/);
  T.actions.updateSystem('y2', { description: '人の変更' });
  ok(await call('update_system', { system: 'y1', description: 'AI の変更' }));
  const warn = app.document.querySelector('#ai-warn').textContent;
  assert.match(warn, /Claude Code が「営業管理システム」を直したので、元に戻す（Ctrl\+Z）の履歴を消しました。/);
  assert.match(warn, /AI の変更を戻すときは、「営業管理システム」の履歴の「Claude Code が直す前の状態」から戻せます。/);
  T.runCommand('undo');
  assert.match(app.document.querySelector('#toast').textContent, /AI が「営業管理システム」を直したときに、履歴を消しました/);
  app.close();
});

// ── スイムレーン ──
test('set_swimlane: 作業と矢印をまとめて置き換える。key と id と文字で矢印をつなぎ、列を書かない作業には列を付ける。今ある作業の id を書くと、id とメモ・指す先・BDM の箱を残す', async () => {
  const st = systemState();
  Object.assign(st.systems[0].swimlane.steps[1], { memo: '電話で受けた分も', src: { id: 'bdm-2', x: 1, y: 2, w: 3, h: 4 } });
  const { app, call, sys } = await boot(st);
  const r = ok(await call('set_swimlane', { system: '営業管理システム', expect: OLD, steps: [
    { key: 'a', role: '営業', kind: 'start', text: '始まり' },
    { id: 'w2', role: 'l1', text: '顧客を登録する（直した）' },
    { key: 'chk', role: '上長', kind: 'decision', text: '確かめる', ref: { design: '顧客管理', screen: '一覧', state: '承認待ち' } },
    { role: '営業', kind: 'end', text: '終わり', col: 6 },
    { role: '上長', text: '差し戻しを書く', memo: '理由を書く' },
  ], edges: [
    { from: 'a', to: 'w2' },
    { from: 'w2', to: 'chk', label: '出す' },
    { from: 'chk', to: '終わり', label: '承認' },
    { from: 'chk', to: '顧客を登録する（直した）', label: '差し戻し' },
  ] }));
  const y = sys('y1');
  const steps = y.swimlane.steps;
  assert.deepEqual(r.steps.map((s) => [s.key, s.col]), [['a', 0], ['顧客を登録する（直した）', 1], ['chk', 2], ['終わり', 6], ['差し戻しを書く', 7]]);
  assert.deepEqual(r.steps.map((s) => s.id), steps.map((w) => w.id));
  assert.equal(r.steps[1].id, 'w2');
  assert.ok(steps.every((w) => /^w-|^w2$/.test(w.id)));
  assert.deepEqual(steps.map((w) => [w.roleId, w.col, w.kind, w.text]), [
    ['l1', 0, 'start', '始まり'], ['l1', 1, 'input', '顧客を登録する（直した）'], ['l2', 2, 'decision', '確かめる'], ['l1', 6, 'end', '終わり'], ['l2', 7, 'task', '差し戻しを書く'],
  ]);
  assert.deepEqual([steps[1].memo, steps[1].src, steps[1].ref], ['電話で受けた分も', { id: 'bdm-2', x: 1, y: 2, w: 3, h: 4 }, { designId: 'd1', screenId: 's1', stateId: 't1' }]);
  assert.deepEqual(steps[2].ref, { designId: 'd1', screenId: 's2', stateId: 't2' });
  assert.deepEqual([steps[0].ref, steps[4].memo], [{ designId: null, screenId: null, stateId: null }, '理由を書く']);
  const sid = (i) => steps[i].id;
  assert.deepEqual(y.swimlane.edges.map((e) => [e.from, e.to, e.label]), [[sid(0), 'w2', ''], ['w2', sid(2), '出す'], [sid(2), sid(3), '承認'], [sid(2), 'w2', '差し戻し']]);
  assert.equal(r.edgesTotal, y.swimlane.edges.length);
  assert.equal(r.updatedAt, y.updatedAt);
  // ref: null で指す先を外す・空にする
  ok(await call('set_swimlane', { system: 'y1', steps: [{ id: 'w2', role: '営業', text: 'x', ref: null }] }));
  assert.deepEqual(sys('y1').swimlane.steps[0].ref, { designId: null, screenId: null, stateId: null });
  ok(await call('set_swimlane', { system: 'y1', steps: [] }));
  assert.deepEqual(sys('y1').swimlane, { steps: [], edges: [] });
  app.close();
});

test('set_swimlane: 断る（ない役割・知らない種類・ない作業の id・同じ id や key・システムにない画面設計・ない画面とステータス・矢印の端・2 つに当たる文字・自分への矢印・同じ向きの 2 本目）。何も変わらない', async () => {
  const { app, call, sys } = await boot();
  const before = sys('y1');
  const set = (steps, edges = []) => call('set_swimlane', { system: 'y1', steps, edges });
  const role = ng(await set([{ role: '経理', text: '締める' }]), 'not_found');
  assert.match(role.message, /update_system/);
  assert.match(role.message, /営業・上長/);
  ng(await set([{ role: '営業', kind: 'ふしぎ', text: 'x' }]), 'bad_request');
  ng(await set([{ role: '営業', text: 'x', col: -1 }]), 'bad_request');
  ng(await set([{ role: '営業', text: 'x', col: 1.5 }]), 'bad_request');
  ng(await set([{ id: 'w-nai', role: '営業', text: 'x' }]), 'not_found');
  ng(await set([{ id: 'w1', role: '営業', text: 'x' }, { id: 'w1', role: '営業', text: 'y' }]), 'bad_request');
  ng(await set([{ key: 'k', role: '営業', text: 'x' }, { key: 'k', role: '営業', text: 'y' }]), 'bad_request');
  const des = ng(await set([{ role: '営業', text: 'x', ref: { design: '出張申請' } }]), 'bad_request');
  assert.deepEqual(des.candidates, [{ id: 'd1', name: '顧客管理' }, { id: 'd2', name: '受注管理' }]);
  const scr = ng(await set([{ role: '営業', text: 'x', ref: { design: '顧客管理', screen: '詳細' } }]), 'bad_request');
  assert.deepEqual(scr.candidates, [{ id: 's1', name: '新規登録' }, { id: 's2', name: '一覧' }]);
  ng(await set([{ role: '営業', text: 'x', ref: { design: '顧客管理', state: '完了' } }]), 'bad_request');
  ng(await set([{ role: '営業', text: 'x', ref: { design: '受注管理', state: '申請' } }]), 'bad_request');
  ng(await set([{ role: '営業', text: 'x', ref: { screen: '一覧' } }]), 'bad_request');
  ng(await set([{ role: '営業', text: 'x' }], [{ from: 'x', to: 'y' }]), 'bad_request');
  const amb = ng(await set([{ role: '営業', text: '確かめる' }, { role: '上長', text: '確かめる' }, { key: 'z', role: '営業', text: '終わり' }], [{ from: '確かめる', to: 'z' }]), 'ambiguous');
  assert.equal(amb.candidates.length, 2);
  ng(await set([{ key: 'a', role: '営業', text: 'x' }], [{ from: 'a', to: 'a' }]), 'bad_request');
  ng(await set([{ key: 'a', role: '営業', text: 'x' }, { key: 'b', role: '営業', text: 'y' }], [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', label: '2 本目' }]), 'bad_request');
  ng(await call('set_swimlane', { system: 'y1', steps: 'x' }), 'bad_request');
  assert.deepEqual(sys('y1'), before);
  app.close();
});

// ── 画面設計を入れる・外す ──
test('add_to_system: same は同じ画面設計を入れ（ほかのシステムと共通）、copy は複製してそのシステムにだけ入れる。ごみ箱の画面設計は断る。remove_from_system は外すだけ', async () => {
  const { app, T, call, sys, d } = await boot();
  const n0 = T.store.state.designs.length;
  const r = ok(await call('add_to_system', { system: '請求管理システム', design: '受注管理' }));
  assert.deepEqual([r.design, r.mode], [{ id: 'd2', name: '受注管理', updatedAt: OLD }, 'same']);
  assert.deepEqual(sys('y2').designIds, ['d1', 'd2']);
  const again = ok(await call('add_to_system', { system: 'y2', design: 'd2' }));
  assert.deepEqual([again.changed, again.alreadyIn], [false, true]);
  const c = ok(await call('add_to_system', { system: 'y2', design: '顧客管理', mode: 'copy' }));
  assert.notEqual(c.design.id, 'd1');
  assert.deepEqual([c.design.name, c.mode, c.copiedFrom], ['顧客管理 のコピー', 'copy', { id: 'd1', name: '顧客管理' }]);
  assert.deepEqual(sys('y2').designIds, ['d1', 'd2', c.design.id]);
  assert.deepEqual(sys('y1').designIds, ['d1', 'd2'], 'ほかのシステムには入らない');
  assert.equal(T.store.state.designs.length, n0 + 1);
  ng(await call('add_to_system', { system: 'y2', design: '出張申請' }), 'trashed');
  ng(await call('add_to_system', { system: 'y2', design: '出張申請', mode: 'copy' }), 'trashed');
  ng(await call('add_to_system', { system: 'y2', design: 'd2', mode: 'move' }), 'bad_request');
  const rm = ok(await call('remove_from_system', { system: 'y1', design: '顧客管理' }));
  assert.deepEqual(rm.design, { id: 'd1', name: '顧客管理' });
  assert.match(rm.warnings[0], /スイムレーンの作業 2 つが、この画面設計を指しています/);
  assert.deepEqual(sys('y1').designIds, ['d2']);
  assert.ok(d('d1'), '画面設計は残る');
  ng(await call('remove_from_system', { system: 'y1', design: '顧客管理' }), 'not_found');
  app.close();
});

test('create_design の system: 作ってすぐそのシステムに入れる（システムにも直す前の行が残る）。ごみ箱・ないシステムは断り、画面設計も作らない', async () => {
  const { app, T, call, sys } = await boot();
  const r = ok(await call('create_design', { name: '請求書', system: '請求管理システム' }));
  assert.deepEqual(r.system, { id: 'y2', name: '請求管理システム', updatedAt: sys('y2').updatedAt });
  assert.deepEqual(sys('y2').designIds, ['d1', r.id]);
  const d = T.store.state.designs.find((x) => x.id === r.id);
  assert.equal(r.updatedAt, d.updatedAt, '更新の印は作った画面設計のもの');
  assert.deepEqual(aiRows(sys('y2')).map((x) => x.snapshot.designIds), [['d1']]);
  const n = T.store.state.designs.length;
  ng(await call('create_design', { name: '請求書 2', system: '古いシステム' }), 'trashed');
  ng(await call('create_design', { name: '請求書 3', system: 'ないシステム' }), 'not_found');
  assert.equal(T.store.state.designs.length, n);
  app.close();
});

test('画面設計の道具がシステムも変えるとき（画面・ステータスを消して作業の指す先が外れる）も落ちず、システムに直す前の行を残して知らせる', async () => {
  const { app, call, sys } = await boot();
  const r = ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }));
  assert.equal(stepOf(sys('y1'), 'w2').ref.screenId, null);
  assert.ok(r.warnings.some((w) => /システム「営業管理システム」/.test(w)), JSON.stringify(r.warnings));
  const rows = aiRows(sys('y1'));
  assert.equal(rows.length, 1);
  assert.equal(stepOf(rows[0].snapshot, 'w2').ref.screenId, 's1');
  assert.deepEqual(sys('y2').revisions, [], '変わらないシステムには残さない');
  ok(await call('edit_process', { design: 'd1', ops: [{ op: 'delete_state', state: '承認待ち' }] }));
  assert.equal(stepOf(sys('y1'), 'w3').ref.stateId, null);
  assert.equal(aiRows(sys('y1')).length, 1, '同じ接続では 1 行だけ');
  app.close();
});

// ── 図の画像 ──
test('get_view_image の swimlane: システムのスイムレーン図を PNG にする文書で返す。swimlane には system、ほかの図には design が要る（取り違えは断る）', async () => {
  const { app, call } = await boot();
  const p = await call('get_view_image', { system: '営業管理システム', view: 'swimlane' });
  assert.equal(p.ok, true, JSON.stringify(p.error));
  assert.deepEqual(p.result, { system: { id: 'y1', name: '営業管理システム', updatedAt: OLD }, view: 'swimlane', boxes: 3, arrows: 2 });
  assert.equal(p.render.kind, 'image');
  assert.match(p.render.html, /data-view="swimlane"/);
  assert.match(p.render.html, /顧客を登録する/);
  assert.match(ng(await call('get_view_image', { view: 'swimlane' }), 'bad_request').message, /system/);
  ng(await call('get_view_image', { design: 'd1', view: 'swimlane' }), 'bad_request');
  assert.match(ng(await call('get_view_image', { system: 'y1', view: 'map' }), 'bad_request').message, /design/);
  ng(await call('get_view_image', { view: 'map' }), 'bad_request');
  ok(await call('get_view_image', { design: 'd1', view: 'process' }));
  app.close();
});

// ── 保存と読み込み ──
test('システムの履歴の写しは、比べる JSON と元に戻すの履歴では写さずに同じものを指し、保存には中身ごと入る。読み込みは行と写しを直し、知らない欄は残す', async () => {
  const { app, T, call } = await boot();
  ok(await call('update_system', { system: 'y1', description: 'AI の変更' }));
  const { json, refs } = T.stateWithRefs(T.store.state);
  assert.ok(refs.size >= 1);
  assert.ok(!JSON.parse(json).systems[0].revisions[0].snapshot.swimlane, '写しは印に置き換える');
  const saved = JSON.parse(app.window.localStorage.getItem(STORAGE_KEY));
  assert.equal(saved.systems[0].revisions[0].snapshot.description, '顧客の登録から受注までをまとめる。');
  const raw = plain(T.store.state);
  raw.systems[0].revisions.push({
    id: 'r-x', kind: 'ai', date: OLD, note: 'n', extra: 'のこす',
    snapshot: { name: ' 名前  ', roles: [{ id: 'l1', name: 'a' }], swimlane: { steps: [{ id: 'w1', roleId: 'l1', col: 0, kind: 'ふしぎ', text: 't' }], edges: [] }, designIds: ['d1', 'd1', 5], future: 1 },
  }, 'こわれた行');
  const m = T.migrate(plain(raw)).state;
  const rows = m.systems[0].revisions;
  assert.equal(rows.length, 2);
  const x = plain(rows[1]);
  assert.equal(x.extra, 'のこす');
  assert.deepEqual([x.snapshot.name, x.snapshot.description, x.snapshot.roles[0].memo, x.snapshot.swimlane.steps[0].kind, x.snapshot.designIds, x.snapshot.future],
    ['名前', '', '', 'task', ['d1'], 1]);
  assert.deepEqual(plain(T.migrate(plain(m)).state), plain(m), '2 回通しても同じ');
  assert.deepEqual(plain(m.systems[1].revisions), []);
  app.close();
});

// ── 第 9 段階の見直し（T9）──
const swimInput = TOOLS.find((x) => x.name === 'set_swimlane').input;
const issues = (p) => (p.success ? [] : p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

test('set_swimlane: get_system で読んだ作業と矢印をそのまま渡すと、入口の形も通り、何も変わらない（矢印の id を使い回す。更新の印・元に戻す・直す前の行・帯を出さない）', async () => {
  const st = systemState();
  st.systems[0].swimlane.edges[0].color = 'red'; // 知らない欄
  const { app, T, call, sys } = await boot(st);
  T.ui.view = 'system';
  T.ui.systemId = 'y1';
  const g = ok(await call('get_system', { system: 'y1' }));
  assert.deepEqual(issues(swimInput.safeParse({ system: 'y1', expect: g.updatedAt, steps: g.steps, edges: g.edges })), []);
  const before = sys('y1');
  const u0 = T.store.undoStack.length;
  const r = ok(await call('set_swimlane', { system: 'y1', expect: g.updatedAt, steps: g.steps, edges: g.edges }));
  assert.equal(r.changed, false);
  assert.deepEqual(sys('y1'), before);
  assert.deepEqual([T.store.undoStack.length, aiRows(sys('y1')).length, T.aiView.band], [u0, 0, null]);
  // 矢印の id を書かなくても、同じ「元 → 先」の今の矢印の id と知らない欄を使い回す。label を省くと今の文字のまま、'' で消す
  ok(await call('set_swimlane', { system: 'y1', steps: g.steps, edges: [{ from: 'w1', to: 'w2', label: '出す' }, { from: 'w2', to: 'w3', label: '確かめてもらう' }] }));
  assert.deepEqual(sys('y1').swimlane.edges, [{ id: 'e1', from: 'w1', to: 'w2', label: '出す', color: 'red' }, { id: 'e2', from: 'w2', to: 'w3', label: '確かめてもらう' }]);
  ok(await call('set_swimlane', { system: 'y1', steps: g.steps, edges: [{ from: 'w1', to: 'w2' }, { from: 'w2', to: 'w3', label: '' }] }));
  assert.deepEqual(sys('y1').swimlane.edges.map((e) => [e.id, e.label]), [['e1', '出す'], ['e2', '']]);
  // id を書くと、その矢印の id のまま元・先を付け替える
  ok(await call('set_swimlane', { system: 'y1', steps: g.steps, edges: [{ id: 'e2', from: 'w1', to: 'w3' }] }));
  assert.deepEqual(sys('y1').swimlane.edges, [{ id: 'e2', from: 'w1', to: 'w3', label: '' }]);
  const e = ng(await call('set_swimlane', { system: 'y1', steps: g.steps, edges: [{ id: 'e-nai', from: 'w1', to: 'w2' }] }), 'not_found');
  assert.match(e.message, /^edges\[0\]: 「e-nai」という矢印は/);
  ng(await call('set_swimlane', { system: 'y1', steps: g.steps, edges: [{ id: 'e2', from: 'w1', to: 'w2' }, { id: 'e2', from: 'w2', to: 'w3' }] }), 'bad_request');
  app.close();
});

test('set_swimlane: 今ある作業を id で送り col を省くと、今の列を残す（人が動かした列を付け直さない）', async () => {
  const { app, T, call, sys } = await boot();
  T.actions.moveStep('y1', 'w3', { col: 5 });
  const g = ok(await call('get_system', { system: 'y1' }));
  const r = ok(await call('set_swimlane', { system: 'y1', expect: g.updatedAt, steps: g.steps.map((w) => ({ id: w.id, role: w.role, text: w.text })), edges: g.edges.map(({ from, to }) => ({ from, to })) }));
  assert.deepEqual(sys('y1').swimlane.steps.map((w) => [w.id, w.col]), [['w1', 0], ['w2', 1], ['w3', 5]]);
  assert.equal(r.changed, false);
  app.close();
});

test('set_swimlane: edges を省くと、今の矢印のうち両端の作業が残っているものを残す（外した数を知らせる）。[] を書いたときだけ全部消す', async () => {
  const { app, call, sys } = await boot();
  const r = ok(await call('set_swimlane', { system: 'y1', steps: [{ id: 'w1', role: '営業', text: '始まり' }, { id: 'w2', role: '営業', text: '顧客を登録する（直した）' }] }));
  assert.deepEqual(sys('y1').swimlane.edges, [{ id: 'e1', from: 'w1', to: 'w2', label: '' }]);
  assert.match(r.warnings.join('\n'), /edges を省いたので、今の矢印を残しました。両端の作業がなくなった矢印 1 本は外しました/);
  assert.equal(r.edgesTotal, 1);
  ok(await call('set_swimlane', { system: 'y1', steps: [{ id: 'w1', role: '営業', text: '始まり' }, { id: 'w2', role: '営業', text: '顧客を登録する（直した）' }], edges: [] }));
  assert.deepEqual(sys('y1').swimlane.edges, []);
  app.close();
});

test('set_swimlane: get_system の形も受け取る（作業の roleId・ref の { id, name }・矢印の id）。role と roleId が別の役割なら断る。今と同じ指す先は、システムから外した画面設計でもそのまま残す', async () => {
  const { app, call, sys } = await boot();
  const p = swimInput.safeParse({ system: 'y1', steps: [{ roleId: 'l2', role: null, text: 'x', ref: { design: { id: 'd1', name: '顧客管理' }, screen: { id: 's2' }, state: null } }], edges: [{ id: 'e1', from: 'x', to: 'x' }] });
  assert.deepEqual(issues(p), []);
  ok(await call('set_swimlane', { system: 'y1', steps: [
    { id: 'w2', roleId: 'l2', text: '顧客を登録する', ref: { design: { id: 'd1', name: '顧客管理' }, screen: { id: 's2', name: '一覧' }, state: null } },
    { key: 'n', roleId: 'l1', role: '営業', text: '新しい作業', ref: { design: { id: 'd2', name: '受注管理' }, screen: null, state: null } },
  ], edges: [] }));
  const steps = sys('y1').swimlane.steps;
  assert.deepEqual(steps.map((w) => [w.roleId, w.ref]), [['l2', { designId: 'd1', screenId: 's2', stateId: null }], ['l1', { designId: 'd2', screenId: null, stateId: null }]]);
  const mismatch = ng(await call('set_swimlane', { system: 'y1', steps: [{ role: '営業', roleId: 'l2', text: 'x' }] }), 'bad_request');
  assert.match(mismatch.message, /role.*roleId.*別の役割/);
  ng(await call('set_swimlane', { system: 'y1', steps: [{ roleId: 'l-nai', text: 'x' }] }), 'not_found');
  ng(await call('set_swimlane', { system: 'y1', steps: [{ text: 'x' }] }), 'bad_request');
  // システムから外した画面設計・ない画面を指す作業も、get_system で読んだまま送り直せる（指す先はそのまま）
  const { app: app2, call: call2, sys: sys2 } = await boot();
  ok(await call2('remove_from_system', { system: 'y1', design: '顧客管理' }));
  const g = ok(await call2('get_system', { system: 'y1' }));
  const r = ok(await call2('set_swimlane', { system: 'y1', expect: g.updatedAt, steps: g.steps, edges: g.edges }));
  assert.equal(r.changed, false);
  assert.deepEqual(sys2('y1').swimlane.steps[1].ref, { designId: 'd1', screenId: 's1', stateId: 't1' });
  const add = ng(await call2('set_swimlane', { system: 'y1', steps: [{ role: '営業', text: '新しい作業', ref: { design: '顧客管理' } }] }), 'bad_request');
  assert.match(add.message, /先に add_to_system でこのシステムに入れてください/);
  app.close();
  app2.close();
});

test('set_swimlane: 返事の作業は key・id・col だけ、矢印は数だけ（作業が多くても目安の 24,000 字に収まる）', async () => {
  const { app, call } = await boot();
  const steps = Array.from({ length: 150 }, (_, i) => ({ key: `k${i}`, role: i % 2 ? '上長' : '営業', text: `顧客の連絡先を確かめて受注の見込みを書く ${i}` }));
  const edges = steps.slice(1).map((s, i) => ({ from: `k${i}`, to: s.key, label: '次へ' }));
  const r = ok(await call('set_swimlane', { system: 'y1', steps, edges }));
  assert.deepEqual(Object.keys(r.steps[0]), ['key', 'id', 'col']);
  assert.equal(r.edgesTotal, 149);
  assert.equal(r.edges, undefined);
  assert.ok(JSON.stringify(r).length <= 24000, `${JSON.stringify(r).length} 字`);
  app.close();
});

test('set_swimlane: 矢印の端が 2 つに当たったときの候補は、新しい作業には id を出さず、key・文字・steps の何番目か（0 から）を出す', async () => {
  const { app, call } = await boot();
  const amb = ng(await call('set_swimlane', { system: 'y1', steps: [{ role: '営業', text: '確かめる' }, { id: 'w3', role: '上長', text: '確かめる' }, { key: 'z', role: '営業', text: '終わり' }], edges: [{ from: '確かめる', to: 'z' }] }), 'ambiguous');
  assert.deepEqual(amb.candidates, [{ key: '確かめる', text: '確かめる', index: 0 }, { key: '確かめる', id: 'w3', text: '確かめる', index: 1 }]);
  app.close();
});

test('ステータスの並びを書き直す・ステータスの項目を消すと、作業の指す先のステータスも外れる（set_states・edit_items の props.states・delete）。システムに直す前の行を残して知らせる', async () => {
  {
    const { app, call, sys } = await boot();
    const r = ok(await call('edit_process', { design: 'd1', ops: [{ op: 'set_states', states: ['申請', '承認済み'] }] }));
    assert.deepEqual([stepOf(sys('y1'), 'w2').ref.stateId, stepOf(sys('y1'), 'w3').ref], ['t1', { designId: 'd1', screenId: 's2', stateId: null }]);
    assert.ok(r.warnings.some((w) => /システム「営業管理システム」/.test(w)), JSON.stringify(r.warnings));
    assert.equal(aiRows(sys('y1')).length, 1);
    assert.equal(stepOf(aiRows(sys('y1'))[0].snapshot, 'w3').ref.stateId, 't2');
    app.close();
  }
  {
    const { app, call, sys } = await boot();
    ok(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: 'ステータス', props: { states: ['申請'] } }] }));
    assert.equal(stepOf(sys('y1'), 'w3').ref.stateId, null);
    app.close();
  }
  {
    const { app, call, sys } = await boot();
    ok(await call('edit_items', { design: 'd1', ops: [{ op: 'delete', item: 'ステータス' }] }));
    assert.deepEqual(sys('y1').swimlane.steps.map((w) => w.ref.stateId), [null, null, null]);
    app.close();
  }
});

test('restore_revision で画面が減って作業の指す先が外れたときも、システムに直す前の行を残して知らせる（画面設計には「戻す前の状態」の行だけ）', async () => {
  const { app, T, call, sys, d } = await boot();
  const rv = T.actions.addRevision('d1', { note: '最初' });
  const sc = T.actions.addScreen('d1', 'blank');
  T.actions.updateStep('y1', 'w1', { ref: { designId: 'd1', screenId: sc, stateId: null } });
  const r = ok(await call('restore_revision', { design: 'd1', revision: rv }));
  assert.deepEqual(stepOf(sys('y1'), 'w1').ref, { designId: 'd1', screenId: null, stateId: null });
  assert.ok(r.warnings.some((w) => /システム「営業管理システム」/.test(w)), JSON.stringify(r.warnings));
  assert.equal(stepOf(aiRows(sys('y1'))[0].snapshot, 'w1').ref.screenId, sc);
  assert.deepEqual(d('d1').revisions.map((x) => x.kind), ['revision', 'restore'], '画面設計には「AI が直す前の状態」の行を足さない');
  app.close();
});

test('get_system: 説明は最初のページ（cursor なし）にだけ入れる（説明が長くても、続きのページは目安の 24,000 字に収まる）', async () => {
  const st = systemState();
  const y = st.systems[0];
  y.description = 'あ'.repeat(30000);
  y.swimlane.steps = Array.from({ length: 200 }, (_, i) => swStep(`wx${i}`, 'l1', i, 'task', `顧客の連絡先を確かめて受注の見込みを書く作業の見本 ${i}`));
  const { app, call } = await boot(st);
  const first = ok(await call('get_system', { system: 'y1' }));
  assert.equal(first.description, 'あ'.repeat(30000));
  let cursor = first.nextCursor;
  let n = first.steps.length;
  assert.ok(cursor);
  while (cursor) {
    const r = ok(await call('get_system', { system: 'y1', cursor }));
    assert.equal(r.description, undefined);
    assert.ok(JSON.stringify(r).length <= 24000, `${JSON.stringify(r).length} 字`);
    n += r.steps.length;
    cursor = r.nextCursor;
  }
  assert.equal(n, 200);
  app.close();
});

test('add_to_system・remove_from_system は expect を受け取る（読んだ後に直されていれば stale）。入口の形も通る。expect の欄がない道具のことも手引きに書く', async () => {
  const { app, T, call } = await boot();
  for (const name of ['add_to_system', 'remove_from_system']) {
    assert.deepEqual(issues(TOOLS.find((x) => x.name === name).input.safeParse({ system: 'y1', design: 'd1', expect: OLD })), [], name);
  }
  T.actions.updateSystem('y2', { description: '人が直した' });
  ng(await call('add_to_system', { system: 'y2', design: '受注管理', expect: OLD }), 'stale');
  ng(await call('remove_from_system', { system: 'y2', design: '顧客管理', expect: OLD }), 'stale');
  const at = T.store.state.systems.find((y) => y.id === 'y2').updatedAt;
  const r = ok(await call('add_to_system', { system: 'y2', design: '受注管理', expect: at }));
  ok(await call('remove_from_system', { system: 'y2', design: '受注管理', expect: r.updatedAt }));
  assert.match(INSTRUCTIONS, /expect の欄がある書く道具には/);
  app.close();
});

test('返事の更新の印: create_design に system を書くと system.updatedAt（システムの新しい印）を返す。add_to_system は、システムの印と、入れた画面設計の印を分けて返す', async () => {
  const { app, T, call, sys, d } = await boot();
  const c = ok(await call('create_design', { name: '見積管理', system: '営業管理システム' }));
  assert.deepEqual(c.system, { id: 'y1', name: '営業管理システム', updatedAt: sys('y1').updatedAt });
  assert.notEqual(c.system.updatedAt, OLD);
  ok(await call('set_swimlane', { system: 'y1', expect: c.system.updatedAt, steps: [] }));
  const same = ok(await call('add_to_system', { system: 'y2', design: '受注管理' }));
  assert.deepEqual([same.updatedAt, same.design], [sys('y2').updatedAt, { id: 'd2', name: '受注管理', updatedAt: d('d2').updatedAt }]);
  const copy = ok(await call('add_to_system', { system: 'y2', design: '顧客管理', mode: 'copy' }));
  const made = T.store.state.designs.find((x) => x.id === copy.design.id);
  assert.deepEqual([copy.updatedAt, copy.design.updatedAt], [sys('y2').updatedAt, made.updatedAt]);
  assert.match(GUIDES.overview.text, /create_design に system を書くと、システムの更新の印も変わる/);
  app.close();
});

test('中身が変わらない頼み（役割を足して同じ頼みで消す・項目を足して消す）は、変わらなかったものとして扱う（更新の印・元に戻す・直す前の行・帯を出さない）', async () => {
  const { app, T, call, sys, d } = await boot();
  T.ui.view = 'system';
  T.ui.systemId = 'y1';
  T.actions.updateDesignInfo('d2', { description: '人の変更' });
  const u0 = T.store.undoStack.length;
  const r = ok(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }, { op: 'delete', role: '経理' }] }));
  assert.deepEqual([r.changed, r.updatedAt, sys('y1').updatedAt, aiRows(sys('y1')).length], [false, OLD, OLD, 0]);
  assert.deepEqual([T.store.undoStack.length, T.aiView.band, T.aiView.warn], [u0, null, null]);
  const r2 = ok(await call('edit_items', { design: 'd1', ops: [{ op: 'add', type: 'text1', name: 'メモ' }, { op: 'delete', item: 'メモ' }] }));
  assert.deepEqual([r2.changed, d('d1').updatedAt, d('d1').revisions.length], [false, OLD, 0]);
  assert.equal(T.store.undoStack.length, u0, '元に戻すの履歴も消さない');
  app.close();
});

test('人がシステムの画面を開いているときに、画面設計の道具がそのシステムを変えたら、帯にそのことを書く（作業の指す先が外れた・作った画面設計を入れた）', async () => {
  const note = '開いている「営業管理システム」のスイムレーン図の作業の指す先も外れました（履歴に「Claude Code が直す前の状態」を残しました）。';
  {
    const { app, T, call } = await boot();
    T.openSystem('y1');
    T.actions.updateSystem('y1', { description: '人の変更' });
    ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }));
    assert.ok(app.document.querySelector('#ai-warn').textContent.includes(note), app.document.querySelector('#ai-warn').textContent);
    app.close();
  }
  {
    const { app, T, call } = await boot();
    T.openSystem('y1');
    ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }));
    assert.ok(app.document.querySelector('#ai-band').textContent.includes(note), app.document.querySelector('#ai-band').textContent);
    ok(await call('create_design', { name: '見積管理', system: 'y1' }));
    assert.ok(app.document.querySelector('#ai-band').textContent.includes('開いている「営業管理システム」に「見積管理」を入れました（履歴に「Claude Code が直す前の状態」を残しました）。'),
      app.document.querySelector('#ai-band').textContent);
    app.close();
  }
  {
    const { app, T, call } = await boot();
    T.openSystem('y2');
    ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }));
    assert.ok(!app.document.querySelector('#ai-band').textContent.includes('開いている'), '開いているシステムが変わらなければ書かない');
    app.close();
  }
});

test('細かいもの: update_system でほかのシステムと同じ名前にすると知らせる。remove_from_system は、ごみ箱の画面設計を trashed で断る', async () => {
  const st = systemState();
  st.systems[1].designIds.push('d3');
  const { app, call, sys } = await boot(st);
  const r = ok(await call('update_system', { system: 'y2', name: '営業管理システム' }));
  assert.match(r.warnings[0], /同じ名前のシステムがもうあります（y1）/);
  assert.equal(ok(await call('update_system', { system: 'y2', name: '営業管理システム', description: 'x' })).warnings, undefined, '名前が変わらなければ知らせない');
  const t = ng(await call('remove_from_system', { system: 'y2', design: '出張申請' }), 'trashed');
  assert.match(t.message, /「出張申請」はごみ箱にあるため/);
  assert.deepEqual(sys('y2').designIds, ['d1', 'd3']);
  app.close();
});
