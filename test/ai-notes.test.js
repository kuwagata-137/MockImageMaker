'use strict';
// AI の窓口の第 10 段階の前半の道具のテスト（T3）: 設計ノートを読む（get_notes）・書く（update_notes）・段階の進み具合を変える（set_stage）と、
// list_systems・get_system の stages、設計ノートだけを直したときの知らせ（紫の帯の件数・オレンジの帯の文とボタン）と「AI が直す前の状態」の行。
// 名前は架空の業務（営業管理システムなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { systemState, OLD, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = systemState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}, session = 's-1', client = 'claude-code') => plain(await T.aiDispatch(tool, args, { session, client }));
  const sys = (id) => plain(T.store.state.systems.find((y) => y.id === id));
  return { app, T, call, sys };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r.result)); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };
const aiRows = (y) => y.revisions.filter((r) => r.kind === 'ai');
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const TODO = { state: 'todo', confirmedAt: null };
const AT = '2026-10-02T00:00:00.000Z';

// 営業管理システム（y1）に、決めたこと 1 行・まだ決まっていないこと 2 行（段階 items と flow）の設計ノートを入れた見本
function notedState() {
  const st = systemState();
  st.systems[0].notes = {
    stages: { read: { state: 'done', confirmedAt: AT }, flow: { state: 'review', confirmedAt: null } },
    findings: '営業が顧客を登録し、上長が確かめる。', memo: '設計ノートのメモ',
    decisions: [{ id: 'nd1', date: '2026-10-02', stage: 'flow', text: '確かめるのは上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' }],
    questions: [
      { id: 'nq1', date: '2026-10-02', stage: 'items', text: '区分に「団体」はあるか', answer: '', resolvedAt: null },
      { id: 'nq2', date: '2026-10-02', stage: 'flow', text: '上長が不在のときはだれが確かめるか', answer: '', resolvedAt: null },
    ],
  };
  return st;
}

// ── 読む ──
test('get_notes: 段階ごとの進捗（state と確認の日時）・読み取ったこと・メモ・決めたこと・まだ決まっていないこと・更新日時を返す。ごみ箱のシステムも読める', async () => {
  const { app, call } = await boot(notedState());
  const r = ok(await call('get_notes', { system: '営業管理システム' }));
  assert.deepEqual(r, {
    system: { id: 'y1', name: '営業管理システム' },
    stages: { read: { state: 'done', confirmedAt: AT }, flow: { state: 'review', confirmedAt: null }, items: TODO, screens: TODO, docs: TODO },
    findings: '営業が顧客を登録し、上長が確かめる。', memo: '設計ノートのメモ',
    decisions: [{ id: 'nd1', date: '2026-10-02', stage: 'flow', text: '確かめるのは上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' }], decisionsTotal: 1,
    questions: [
      { id: 'nq1', date: '2026-10-02', stage: 'items', text: '区分に「団体」はあるか', answer: '', resolvedAt: null },
      { id: 'nq2', date: '2026-10-02', stage: 'flow', text: '上長が不在のときはだれが確かめるか', answer: '', resolvedAt: null },
    ],
    questionsTotal: 2,
    updatedAt: OLD, nextCursor: null,
  });
  const t = ok(await call('get_notes', { system: '古いシステム' }));
  assert.deepEqual([t.system.id, t.trashed, t.stages.read, t.decisions, t.questions], ['y3', true, TODO, [], []], 'ごみ箱のシステムも読める');
  ng(await call('get_notes', { system: 'ないシステム' }), 'not_found');
  app.close();
});

test('get_notes: 決めたこと・まだ決まっていないことが多いときは、この順に分けて nextCursor を付ける（どのページも目安の 24,000 字に収まる）。読み取ったこと・メモは最初のページにだけ入れる', async () => {
  const st = systemState();
  st.systems[0].notes = {
    findings: 'あ'.repeat(6000), memo: 'い'.repeat(2000),
    decisions: Array.from({ length: 200 }, (_, i) => ({ id: `nd${i}`, date: '2026-10-02', stage: 'items', text: `顧客の連絡先の項目を、受注の画面と請求の画面で分けて持つ決めごとの見本 ${i}`, reason: '受注と請求で、書く人と書く時が違うため' })),
    questions: Array.from({ length: 100 }, (_, i) => ({ id: `nq${i}`, date: '2026-10-02', stage: 'screens', text: `一覧の画面に出す項目と並びの順を、だれに確かめるかの問いの見本 ${i}`, answer: '', resolvedAt: null })),
  };
  const { app, call } = await boot(st);
  const pages = [];
  let cursor = null;
  do {
    const r = ok(await call('get_notes', { system: 'y1', ...(cursor ? { cursor } : {}) }));
    assert.ok(JSON.stringify(r).length <= 24000, `${JSON.stringify(r).length} 字`);
    pages.push(r);
    cursor = r.nextCursor;
  } while (cursor);
  assert.ok(pages.length >= 2, `${pages.length} ページ`);
  assert.deepEqual([pages[0].findings.length, pages[0].memo.length], [6000, 2000]);
  assert.ok(pages.slice(1).every((p) => !('findings' in p) && !('memo' in p)), '続きのページには入れない');
  assert.ok(pages.every((p) => p.decisionsTotal === 200 && p.questionsTotal === 100 && p.stages.read.state === 'todo'));
  const ids = pages.flatMap((p) => [...p.decisions, ...p.questions].map((x) => x.id));
  assert.deepEqual(ids, [...Array.from({ length: 200 }, (_, i) => `nd${i}`), ...Array.from({ length: 100 }, (_, i) => `nq${i}`)], '決めたこと → まだ決まっていないこと の順');
  app.close();
});

test('list_systems・get_system: 段階ごとの進捗の名前（stages）を返す', async () => {
  const { app, call } = await boot(notedState());
  const all = { read: 'done', flow: 'review', items: 'todo', screens: 'todo', docs: 'todo' };
  const rows = ok(await call('list_systems', { trashed: true })).systems;
  assert.deepEqual(rows.map((y) => [y.id, y.stages]), [
    ['y1', all],
    ['y2', { read: 'todo', flow: 'todo', items: 'todo', screens: 'todo', docs: 'todo' }],
    ['y3', { read: 'todo', flow: 'todo', items: 'todo', screens: 'todo', docs: 'todo' }],
  ]);
  assert.deepEqual(ok(await call('get_system', { system: 'y1' })).stages, all);
  ok(await call('set_stage', { system: 'y1', stage: 'items', state: 'doing' }));
  assert.equal(ok(await call('get_system', { system: 'y1' })).stages.items, 'doing');
  assert.equal(ok(await call('list_systems')).systems[0].stages.items, 'doing');
  app.close();
});

// ── 書く ──
test('update_notes: 読み取ったこと・メモ・決めたことと理由・まだ決まっていないことを ops で 1 回の変更として書く。added は足した行の id。返事の updatedAt が新しい更新日時', async () => {
  const { app, call, sys } = await boot();
  const r = ok(await call('update_notes', { system: '営業管理システム', expect: OLD, ops: [
    { op: 'set_findings', text: '営業が顧客を登録し、上長が確かめる。\n様式「顧客登録票」の欄: 顧客名・区分' },
    { op: 'set_memo', text: '' },
    { op: 'add_decision', stage: 'flow', text: '確かめるのは上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' },
    { op: 'add_question', stage: 'items', text: '区分に「団体」はあるか' },
    { op: 'add_decision', stage: 'items', text: '顧客コードは自動で振る' },
  ] }));
  let n = sys('y1').notes;
  assert.deepEqual(r.ops.map((o) => o.op), ['set_findings', 'set_memo', 'add_decision', 'add_question', 'add_decision']);
  assert.deepEqual(r.added, [
    { op: 'add_decision', id: n.decisions[0].id }, { op: 'add_question', id: n.questions[0].id }, { op: 'add_decision', id: n.decisions[1].id },
  ]);
  assert.match(n.decisions[0].id, /^nd-/);
  assert.match(n.questions[0].id, /^nq-/);
  assert.deepEqual([n.findings, n.memo], ['営業が顧客を登録し、上長が確かめる。\n様式「顧客登録票」の欄: 顧客名・区分', '']);
  assert.deepEqual(n.decisions.map((x) => [x.stage, x.text, x.reason]), [
    ['flow', '確かめるのは上長の 1 段にする', '理念の「現場の手間を減らす」から'], ['items', '顧客コードは自動で振る', ''],
  ]);
  assert.deepEqual([n.questions[0].stage, n.questions[0].text, n.questions[0].answer, n.questions[0].resolvedAt], ['items', '区分に「団体」はあるか', '', null]);
  assert.equal(r.changed, true);
  assert.notEqual(r.updatedAt, OLD);
  assert.equal(r.updatedAt, sys('y1').updatedAt);
  // 続けて直す（直す・答える・消す）。古い印は断る
  const [d1, d2] = n.decisions.map((x) => x.id);
  const q1 = n.questions[0].id;
  ng(await call('update_notes', { system: 'y1', expect: OLD, ops: [{ op: 'remove_decision', id: d2 }] }), 'stale');
  const r2 = ok(await call('update_notes', { system: 'y1', expect: r.updatedAt, ops: [
    { op: 'edit_decision', id: d1, reason: '理念の「現場の手間を減らす」から。上長が不在のときは課長が確かめる' },
    { op: 'edit_question', id: q1, stage: 'flow' },
    { op: 'answer_question', id: q1, answer: '団体はない（法人と個人だけ）' },
    { op: 'remove_decision', id: d2 },
  ] }));
  assert.deepEqual(r2.ops, [{ op: 'edit_decision', id: d1 }, { op: 'edit_question', id: q1 }, { op: 'answer_question', id: q1 }, { op: 'remove_decision', id: d2 }]);
  assert.deepEqual(r2.added, []);
  assert.equal(r2.updatedAt, sys('y1').updatedAt);
  n = sys('y1').notes;
  assert.deepEqual(n.decisions.map((x) => [x.id, x.text, x.reason]), [[d1, '確かめるのは上長の 1 段にする', '理念の「現場の手間を減らす」から。上長が不在のときは課長が確かめる']]);
  assert.deepEqual([n.questions[0].stage, n.questions[0].text, n.questions[0].answer], ['flow', '区分に「団体」はあるか', '団体はない（法人と個人だけ）']);
  assert.match(n.questions[0].resolvedAt, ISO);
  // 中身が同じ頼みは、変わらなかったものとして扱う
  const same = ok(await call('update_notes', { system: 'y1', ops: [{ op: 'set_memo', text: '' }, { op: 'edit_decision', id: d1, text: '確かめるのは上長の 1 段にする' }] }));
  assert.deepEqual([same.changed, same.updatedAt], [false, r2.updatedAt]);
  app.close();
});

test('update_notes: 断る（空の文の add・知らない段階・知らない id・直す欄のない edit・8000 字を超える文・知らない op）。断られたら、前の操作も入らず何も変わらない', async () => {
  const { app, call, sys } = await boot(notedState());
  const before = JSON.stringify(sys('y1'));
  const bad = async (op, code, re) => {
    const e = ng(await call('update_notes', { system: 'y1', ops: [{ op: 'add_decision', stage: 'read', text: '先に入る操作' }, op] }), code);
    assert.match(e.message, new RegExp(`^ops\\[1\\]（${op.op}）: `), e.message);
    if (re) assert.match(e.message, re);
    assert.equal(JSON.stringify(sys('y1')), before, JSON.stringify(op));
  };
  await bad({ op: 'add_decision', stage: 'flow', text: '  ' }, 'bad_request', /決めたこと/);
  await bad({ op: 'add_question', stage: 'flow', text: '' }, 'bad_request', /まだ決まっていないこと/);
  await bad({ op: 'add_decision', stage: 'design', text: '画面を分ける' }, 'bad_request', /段階「design」はありません.*read/);
  await bad({ op: 'add_question', text: '段階を書かない' }, 'bad_request', /段階（stage）を書いてください/);
  await bad({ op: 'edit_decision', id: 'nd1', stage: 'later' }, 'bad_request', /段階「later」はありません/);
  await bad({ op: 'edit_decision', id: 'nd-nai', text: '直す' }, 'not_found', /「nd-nai」/);
  await bad({ op: 'edit_question', id: 'nd1', text: '決めたことの id で指す' }, 'not_found');
  await bad({ op: 'remove_decision', id: 'nq1' }, 'not_found');
  await bad({ op: 'remove_question', id: 'nq-nai' }, 'not_found');
  await bad({ op: 'answer_question', id: 'nq-nai', answer: 'ある' }, 'not_found');
  await bad({ op: 'edit_decision', id: 'nd1' }, 'bad_request', /変更する欄（stage・text・reason）/);
  await bad({ op: 'edit_question', id: 'nq1' }, 'bad_request', /変更する欄（stage・text）/);
  await bad({ op: 'edit_question', id: 'nq1', text: ' ' }, 'bad_request', /空/);
  await bad({ op: 'set_findings', text: 'あ'.repeat(8001) }, 'bad_request', /8000 字まで.*8001 字/);
  await bad({ op: 'set_memo', text: 'い'.repeat(8001) }, 'bad_request', /8000 字まで/);
  await bad({ op: 'set_findings' }, 'bad_request', /text/);
  await bad({ op: 'erase_question', id: 'nq1' }, 'bad_request', /「erase_question」という操作はありません（使える操作: set_findings・/);
  ng(await call('update_notes', { system: 'y1', ops: [] }), 'bad_request');
  assert.equal(JSON.stringify(sys('y1')), before);
  // ちょうど 8000 字は入る。答えを空にすると、まだ決まっていないことに戻る
  ok(await call('update_notes', { system: 'y1', ops: [{ op: 'set_findings', text: 'あ'.repeat(8000) }, { op: 'answer_question', id: 'nq1', answer: 'ある' }] }));
  assert.equal(sys('y1').notes.findings.length, 8000);
  assert.match(sys('y1').notes.questions[0].resolvedAt, ISO);
  ok(await call('update_notes', { system: 'y1', ops: [{ op: 'answer_question', id: 'nq1', answer: '' }] }));
  assert.deepEqual([sys('y1').notes.questions[0].answer, sys('y1').notes.questions[0].resolvedAt], ['', null]);
  // ごみ箱のシステムは直せない（読むのはよい）
  ng(await call('update_notes', { system: '古いシステム', ops: [{ op: 'set_memo', text: 'x' }] }), 'trashed');
  ng(await call('set_stage', { system: '古いシステム', stage: 'read', state: 'doing' }), 'trashed');
  app.close();
});

test('set_stage: doing・review・done・skipped に変える。done と skipped で確認の日時が入り、同じ進捗は changed: false で確認の日時も変わらない。todo と知らない段階・進捗は断る（断りの文は NOTE_STATE_NAMES の名前）', async () => {
  const { app, call, sys } = await boot();
  const r1 = ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'doing' }));
  assert.deepEqual([r1.stage, r1.state, r1.confirmedAt, r1.changed], ['read', 'doing', null, true]);
  assert.notEqual(r1.updatedAt, OLD);
  assert.equal(r1.updatedAt, sys('y1').updatedAt);
  const r2 = ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'review', expect: r1.updatedAt }));
  assert.deepEqual([r2.state, r2.confirmedAt], ['review', null]);
  ng(await call('set_stage', { system: 'y1', stage: 'read', state: 'done', expect: r1.updatedAt }), 'stale');
  const r3 = ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'done', expect: r2.updatedAt }));
  assert.equal(r3.state, 'done');
  assert.match(r3.confirmedAt, ISO);
  assert.equal(sys('y1').notes.stages.read.confirmedAt, r3.confirmedAt);
  assert.equal(r3.warnings, undefined);
  const again = ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'done' }));
  assert.deepEqual([again.changed, again.state, again.confirmedAt, again.updatedAt], [false, 'done', r3.confirmedAt, r3.updatedAt], '同じ進捗は何も変えない');
  const sk = ok(await call('set_stage', { system: 'y1', stage: 'flow', state: 'skipped' }));
  assert.match(sk.confirmedAt, ISO);
  const todo = ng(await call('set_stage', { system: 'y1', stage: 'read', state: 'todo' }), 'bad_request');
  assert.equal(todo.message, '段階を "todo"（未着手）には戻せません。前の段階を変更するときは "review"（確認待ち）に戻してください。');
  ng(await call('set_stage', { system: 'y1', stage: 'design', state: 'doing' }), 'bad_request');
  const unknown = ng(await call('set_stage', { system: 'y1', stage: 'items', state: 'finished' }), 'bad_request');
  assert.equal(unknown.message, '進捗「finished」は使えません（使える進捗: doing（作業中）・review（確認待ち）・done（確認済み）・skipped（確認を飛ばした））。');
  ng(await call('set_stage', { system: 'y1', state: 'doing' }), 'bad_request');
  assert.deepEqual(Object.values(sys('y1').notes.stages).map((s) => s.state), ['done', 'skipped', 'todo', 'todo', 'todo']);
  // 前の段階を直すときは review に戻す（確認の日時は消える）
  const back = ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'review' }));
  assert.deepEqual([back.state, back.confirmedAt, sys('y1').notes.stages.read.confirmedAt], ['review', null, null]);
  app.close();
});

test('set_stage: まだ決まっていないこと（答えのない行）がその段階に残っているのに done にすると、warnings で知らせる（変えることはできる）', async () => {
  const st = notedState();
  st.systems[0].notes.questions.push(
    { id: 'nq3', date: '2026-10-02', stage: 'items', text: '顧客コードの桁は', answer: '10 桁', resolvedAt: AT },
    { id: 'nq4', date: '2026-10-02', stage: 'items', text: '担当者の項目は要るか', answer: '', resolvedAt: null },
  );
  const { app, call, sys } = await boot(st);
  const r = ok(await call('set_stage', { system: 'y1', stage: 'items', state: 'done' }));
  assert.equal(r.state, 'done');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^段階 ③（データベースの項目）に、まだ決まっていないことが 2 つ残っています。/);
  assert.equal(sys('y1').notes.stages.items.state, 'done', '変えることはできる');
  assert.equal(ok(await call('set_stage', { system: 'y1', stage: 'flow', state: 'review' })).warnings, undefined, 'done でなければ知らせない');
  assert.equal(ok(await call('set_stage', { system: 'y1', stage: 'screens', state: 'done' })).warnings, undefined, 'その段階に残っていなければ知らせない');
  assert.match(ok(await call('set_stage', { system: 'y1', stage: 'flow', state: 'done' })).warnings[0], /^段階 ②（業務の流れ）に、まだ決まっていないことが 1 つ残っています。/);
  app.close();
});

test('書けない間（前の版を見ている間・保存を止めている間）は、update_notes・set_stage を断る（get_notes は読める）', async () => {
  const { app, T, call, sys } = await boot();
  const writes = [['update_notes', { system: 'y1', ops: [{ op: 'set_memo', text: 'x' }] }], ['set_stage', { system: 'y1', stage: 'read', state: 'doing' }]];
  T.store.startViewing(T.store.state);
  for (const [tool, args] of writes) ng(await call(tool, args), 'viewing');
  assert.equal(ok(await call('get_notes', { system: 'y1' })).memo, '設計ノートのメモ');
  T.store.stopViewing();
  T.store.blockReason = '保存データを読み込めませんでした（壊れています）。';
  for (const [tool, args] of writes) assert.match(ng(await call(tool, args), 'blocked').message, /理由: 保存データを読み込めませんでした/);
  T.store.blockReason = null;
  assert.deepEqual([sys('y1').notes.memo, sys('y1').notes.stages.read.state, sys('y1').updatedAt], ['設計ノートのメモ', 'todo', OLD]);
  for (const [tool, args] of writes) ok(await call(tool, args));
  app.close();
});

// ── 「AI が直す前の状態」の行と知らせ ──
test('設計ノートだけを直しても、システムの履歴に「AI が変更する前の状態」の行は増えない（設計ノートは写しに入らない）。中身を直したときは今までどおり 1 行', async () => {
  const { app, call, sys } = await boot();
  ok(await call('update_notes', { system: 'y1', ops: [{ op: 'set_findings', text: '読み取ったこと' }, { op: 'add_question', stage: 'read', text: '問い' }] }));
  ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'review' }));
  assert.equal(aiRows(sys('y1')).length, 0);
  ok(await call('update_system', { system: 'y1', description: '説明を直した' }));
  const rows = aiRows(sys('y1'));
  assert.equal(rows.length, 1);
  assert.equal('notes' in rows[0].snapshot, false);
  app.close();
});

test('notesChangeCount: 段階（進捗と確認の日時）・読み取ったこと・メモと、決めたこと・まだ決まっていないことの行の足す・消す・直すを 1 件ずつ数える', async () => {
  const { app, T } = await boot();
  const row = (id, extra = {}) => ({ id, date: '2026-10-02', stage: 'items', text: `行 ${id}`, reason: '', ...extra });
  const a = plain(T.normalizeNotes({ decisions: [row('nd1'), row('nd2')], questions: [{ ...row('nq1'), answer: '', resolvedAt: null }] }));
  assert.equal(T.notesChangeCount(a, plain(a)), 0);
  const b = plain(a);
  b.stages.read = { state: 'done', confirmedAt: AT };
  b.stages.flow.state = 'doing';
  b.findings = '読み取ったこと';
  b.memo = 'メモ';
  b.decisions[0].text = '直した行';
  b.decisions.splice(1, 1);
  b.decisions.push(row('nd3'));
  b.questions[0].answer = '答え';
  assert.equal(T.notesChangeCount(a, b), 2 + 1 + 1 + 3 + 1);
  app.close();
});

test('知らせ: システムの画面で開いているシステムの設計ノートを直すと、紫の帯の件数に設計ノートの変更を数える（最初に直す前と比べる）。元に戻す 1 回で戻る', async () => {
  const { app, T, call, sys } = await boot();
  T.openSystem('y1');
  const u0 = T.store.undoStack.length;
  ok(await call('update_notes', { system: 'y1', ops: [
    { op: 'set_findings', text: '読み取ったこと' }, { op: 'add_decision', stage: 'read', text: '決めたこと' }, { op: 'add_question', stage: 'read', text: '問い' },
  ] }));
  assert.equal(T.store.undoStack.length, u0 + 1);
  assert.deepEqual(plain([T.aiView.band.kind, T.aiView.band.systemId, T.aiView.band.count, T.aiView.band.undoable, T.aiView.warn]), ['system', 'y1', 3, true, null]);
  assert.match(app.document.querySelector('#ai-band').textContent, /Claude Code が「営業管理システム」を変更しました（変更点 3 件）。/);
  ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'doing' }));
  assert.equal(T.aiView.band.count, 4, '最初に直す前と比べた件数');
  ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'review' }));
  assert.equal(T.aiView.band.count, 4, '同じ段階が変わり続けても 1 件');
  assert.equal(T.store.undoStack.length, u0 + 3);
  T.store.undo();
  assert.equal(sys('y1').notes.stages.read.state, 'doing');
  T.store.undo();
  T.store.undo();
  assert.deepEqual([sys('y1').notes.findings, sys('y1').notes.decisions.length, sys('y1').notes.stages.read.state, sys('y1').updatedAt], ['', 0, 'todo', OLD]);
  app.close();
});

test('知らせ: 開いていないシステムの設計ノートだけを直して元に戻すの履歴を消したときは、オレンジの帯に「戻せます」を書かず、ボタンを「設計ノートを開く」にする。中身も直したときは今までどおり', async () => {
  const { app, T, call } = await boot();
  const $ = (s) => app.document.querySelector(s);
  ok(await call('set_stage', { system: 'y1', stage: 'read', state: 'doing' }));
  assert.match($('#ai-band').textContent, /Claude Code が「営業管理システム」を変更しました（変更点 1 件）。/, '履歴がなければ紫の帯');
  T.actions.updateSystem('y2', { description: '人の変更' });
  ok(await call('update_notes', { system: 'y1', ops: [{ op: 'add_question', stage: 'read', text: '問い' }] }));
  const warn = $('#ai-warn');
  assert.match(warn.textContent, /Claude Code が「営業管理システム」を変更したので、元に戻す（Ctrl\+Z）の履歴を消しました。/);
  assert.doesNotMatch(warn.textContent, /戻せます/);
  assert.equal(warn.querySelector('[data-action="ai-open-system-history"]'), null);
  const btn = warn.querySelector('[data-action="ai-open-system-notes"]');
  assert.deepEqual([btn.textContent, btn.dataset.id], ['「営業管理システム」の設計ノートを開く', 'y1']);
  click(btn);
  assert.deepEqual([T.ui.view, T.ui.systemId], ['system', 'y1'], 'そのシステムを開く（設計ノートの入口は T4 で作る）');
  // 中身（役割）も直したときは、今までどおり「戻せます」と「履歴を開く」
  T.goHome();
  T.actions.updateSystem('y2', { description: '人の変更 2' });
  ok(await call('update_system', { system: 'y1', ops: [{ op: 'add', name: '経理' }] }));
  assert.match($('#ai-warn').textContent, /AI の変更を戻すときは、「営業管理システム」の履歴の「Claude Code が変更する前の状態」から戻せます。/);
  assert.ok($('#ai-warn [data-action="ai-open-system-history"]'));
  assert.equal($('#ai-warn [data-action="ai-open-system-notes"]'), null);
  app.close();
});

test('NOTE_STATE_NAMES: 段階の進捗の名前の表（データの区画。AI の断りの文と、設計ノートの画面が使う）', async () => {
  const { app, T } = await boot();
  assert.deepEqual(plain(T.NOTE_STATE_NAMES), { todo: '未着手', doing: '作業中', review: '確認待ち', done: '確認済み', skipped: '確認を飛ばした' });
  assert.deepEqual(Object.keys(T.NOTE_STATE_NAMES), plain(T.NOTE_STATES));
  app.close();
});

test('aiOnlyNotesChanged: システムの道具で、中身が変わらず設計ノートが変わったときだけ真（オレンジの帯の「設計ノートを開く」）。中身も設計ノートも変わらないとき・作ったとき・中身が変わったときは偽', async () => {
  const { app, T } = await boot();
  const sys = { id: 'y1', notes: { memo: '今' } };
  const seen = (notes, content = 'C') => ({ notes: notes == null ? null : JSON.stringify(notes), systems: new Map([['y1', content]]) });
  const after = new Map([['y1', 'C']]);
  assert.equal(T.aiOnlyNotesChanged(sys, false, seen({ memo: '前' }), after), true);
  assert.equal(T.aiOnlyNotesChanged(sys, false, seen({ memo: '今' }), after), false, '設計ノートも変わっていない（資料だけなど）');
  assert.equal(T.aiOnlyNotesChanged(sys, false, seen({ memo: '前' }, 'B'), after), false, '中身も変わった');
  assert.equal(T.aiOnlyNotesChanged(sys, true, seen({ memo: '前' }), after), false, '作った');
  assert.equal(T.aiOnlyNotesChanged(sys, false, seen(null), after), false, '直す前の設計ノートを控えていない');
  assert.equal(T.aiOnlyNotesChanged(null, false, seen({ memo: '前' }), after), false, 'システムの道具でない');
  app.close();
});
