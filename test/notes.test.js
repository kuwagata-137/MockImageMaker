'use strict';
// 第 10 段階の前半（T2）: システムの設計ノート（notes）のデータと操作のテスト。見た目はまだない（入口・画面は T4、AI の道具は T3）。
// 決めごとは AI設計基盤_設計書.md の 5-3（notes の形）と 10 章（段階）。
// システムと設計ノートの文は架空の業務（出張申請・経費精算）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const DONE_AT = '2026-10-02T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-form', '申請の入力')], mapPos: {}, processPos: {}, flowPos: {},
});
const system = (id, name, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: [], roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
const todo = () => ({ state: 'todo', confirmedAt: null });
// 設計ノートの既定の形（5 つの段階が todo・文は空・行は空）
const emptyNotes = () => ({ stages: { read: todo(), flow: todo(), items: todo(), screens: todo(), docs: todo() }, findings: '', decisions: [], questions: [], memo: '' });

// 出張申請システム（設計ノートに書き込みがある・システムの履歴の行が 1 つ）・経費精算システム（前の版のデータ: notes が {}）・ごみ箱の古いシステム
function sampleState() {
  const roles = [{ id: 'l-app', name: '申請者', memo: '' }];
  const swimlane = { steps: [{ id: 'w-1', roleId: 'l-app', col: 0, kind: 'start', text: '始まり', memo: '', ref: { designId: null, screenId: null, stateId: null }, src: null }], edges: [] };
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [design('d-trip', '出張申請')],
    systems: [
      system('y-trip', '出張申請システム', {
        designIds: ['d-trip'], roles, swimlane,
        notes: {
          stages: { read: { state: 'done', confirmedAt: DONE_AT }, flow: { state: 'review', confirmedAt: null }, items: todo(), screens: todo(), docs: todo() },
          findings: '出張の申請から精算までの流れ。',
          decisions: [{ id: 'nd-1', date: '2026-10-02', stage: 'flow', text: '承認は上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' }],
          questions: [{ id: 'nq-1', date: '2026-10-02', stage: 'read', text: '宿泊費の上限は役職で変わるか', answer: '', resolvedAt: null }],
          memo: '様式の欄は後で確かめる',
        },
        revisions: [{ id: 'r-1', kind: 'ai', date: OLD, note: 'Claude Code が直す前の状態', aiSession: 's-0',
          snapshot: { name: '出張申請システム', description: '前の説明', roles: plain(roles), swimlane: plain(swimlane), designIds: ['d-trip'] } }],
      }),
      system('y-exp', '経費精算システム'),
      system('y-gone', '古いシステム', { trashedAt: OLD, notes: { memo: 'ごみ箱の中のメモ' } }),
    ],
  };
}

async function boot(t, state = sampleState()) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) } });
  t.after(() => app.close());
  const api = await app.api();
  const S = () => api.store.state;
  return { app, api, S, sys: (id) => S().systems.find((y) => y.id === id) };
}
const notesOf = (sys, id) => plain(sys(id).notes);

// ── 定数 ──
test('定数: 段階の鍵と順・段階の名前・状態・文の上限。SCHEMA_VERSION は 3 のまま', async (t) => {
  const { api } = await boot(t);
  assert.equal(api.SCHEMA_VERSION, 3);
  assert.deepEqual(plain(api.NOTE_STAGES), ['read', 'flow', 'items', 'screens', 'docs']);
  assert.deepEqual(plain(api.NOTE_STAGE_NAMES), {
    read: '① 資料から読み取る', flow: '② 業務の流れ', items: '③ データベースの項目', screens: '④ 画面', docs: '⑤ 説明書と出力',
  });
  assert.deepEqual(plain(api.NOTE_STATES), ['todo', 'doing', 'review', 'done', 'skipped']);
  assert.equal(api.NOTE_TEXT_MAX, 8000);
});

// ── 読み込みの直し ──
test('読み込み: 設計ノートがオブジェクトでない（null・配列・文字・数・ない）ときは既定の形。前の版のデータ（notes が {}）も既定の形。createSystemData の既定も同じ', async (t) => {
  const { api, sys } = await boot(t);
  for (const raw of [null, undefined, [], 'こわれた', 42, true]) {
    assert.deepEqual(plain(api.normalizeNotes(raw)), emptyNotes(), `normalizeNotes(${JSON.stringify(raw)})`);
  }
  assert.deepEqual(plain(api.normalizeNotes({})), emptyNotes());
  assert.deepEqual(notesOf(sys, 'y-exp'), emptyNotes(), '起動で読んだ前の版のデータ（notes が {}）');
  assert.deepEqual(plain(api.createSystemData({ name: '新しいシステム' }).notes), emptyNotes());
  const a = api.createSystemData({ name: 'A' });
  const b = api.createSystemData({ name: 'B' });
  a.notes.stages.read.state = 'done';
  a.notes.decisions.push({});
  assert.deepEqual(plain(b.notes), emptyNotes(), '作るたびに別の入れ物（片方を直しても、もう片方は変わらない）');
  const raw = sampleState();
  [raw.systems[0].notes, raw.systems[1].notes] = ['こわれた', [1, 2]];
  const { state, blockReason } = api.migrate(plain(raw));
  assert.equal(blockReason, null);
  assert.deepEqual(plain([state.systems[0].notes, state.systems[1].notes]), [emptyNotes(), emptyNotes()], 'migrate: 文字・配列も既定の形');
  delete raw.systems[0].notes;
  assert.deepEqual(plain(api.migrate(plain(raw)).state.systems[0].notes), emptyNotes(), 'notes の欄がないシステム');
});

test('読み込み: 段階は 5 つの鍵を必ず持ち、知らない状態は todo・confirmedAt は文字だけ残す（付け直さない）。知らない段階の鍵と知らない欄は残る', async (t) => {
  const { api } = await boot(t);
  const out = plain(api.normalizeNotes({
    stages: {
      read: { state: 'ふしぎ', confirmedAt: 42, future: 1 },
      flow: 'こわれた',
      items: { state: 'done', confirmedAt: DONE_AT },
      screens: { state: 'done' },
      extra: { state: 'ふしぎ', note: 'のこす' },
      other: 'もじ',
    },
    future: { keep: 1 },
  }));
  assert.deepEqual(Object.keys(out.stages), ['read', 'flow', 'items', 'screens', 'docs', 'extra', 'other'], '5 つの鍵が順に並び、知らない鍵はその後ろ');
  assert.deepEqual(out.stages.read, { state: 'todo', confirmedAt: null, future: 1 }, '知らない状態は todo・数の confirmedAt は null・段階の中の知らない欄は残る');
  assert.deepEqual(out.stages.flow, todo(), '段階がオブジェクトでなければ todo');
  assert.deepEqual(out.stages.items, { state: 'done', confirmedAt: DONE_AT });
  assert.deepEqual(out.stages.screens, { state: 'done', confirmedAt: null }, 'done でも confirmedAt は読み込みでは付け直さない');
  assert.deepEqual(out.stages.docs, todo(), 'ない段階は todo');
  assert.deepEqual(out.stages.extra, { state: 'ふしぎ', note: 'のこす' }, '知らない段階の鍵は直さずに残す');
  assert.equal(out.stages.other, 'もじ', 'オブジェクトでない知らない段階の鍵も消さない');
  assert.deepEqual(out.future, { keep: 1 }, 'notes の中の知らない欄は残す');
  for (const stages of [[], 'こわれた', null, 7]) {
    assert.deepEqual(plain(api.normalizeNotes({ stages })).stages, emptyNotes().stages, `stages が ${JSON.stringify(stages)}`);
  }
});

test('読み込み: 読み取ったこと・メモは文字（長さは切らない）。決めたこと・まだ決まっていないことはオブジェクトの行だけ残し、id・文字の欄を直す', async (t) => {
  const { api } = await boot(t);
  const long = 'あ'.repeat(9000);
  const out = plain(api.normalizeNotes({
    findings: long,
    memo: null,
    decisions: [
      { id: 'nd-1', date: '2026-10-02', stage: 'flow', text: '承認は 1 段', reason: '現場の手間を減らす', future: 'のこす' },
      'こわれた行', null, 42, ['配列'],
      { id: 'nd-1', date: 3, stage: 'zzz', text: 5, reason: null },
      { stage: 'items', text: 'id なし' },
    ],
    questions: [
      { id: 'nq-1', date: '2026-10-02', stage: 'read', text: '上限は？', answer: '一律', resolvedAt: DONE_AT, future: 1 },
      'こわれた行',
      { id: 'nq-1', text: '重なる', answer: 9, resolvedAt: 5 },
      { text: 'id なし' },
    ],
  }));
  assert.equal(out.findings, long, '読み込みでは長さを切らない');
  assert.equal(out.memo, '', '文字でなければ空');
  const [d0, d1, d2] = out.decisions;
  assert.equal(out.decisions.length, 3, 'オブジェクトでない行は捨てる');
  assert.deepEqual(d0, { id: 'nd-1', date: '2026-10-02', stage: 'flow', text: '承認は 1 段', reason: '現場の手間を減らす', future: 'のこす' }, '知らない欄は残す');
  assert.match(d1.id, /^nd-/);
  assert.notEqual(d1.id, 'nd-1', '重なった id は後の行を付け直す');
  assert.deepEqual({ ...d1, id: '' }, { id: '', date: '', stage: 'zzz', text: '', reason: '' }, '知らない段階の行も捨てない・文字でない欄は空');
  assert.match(d2.id, /^nd-/, 'id のない行に id を付ける');
  assert.notEqual(d2.id, d1.id);
  assert.deepEqual({ ...d2, id: '' }, { id: '', date: '', stage: 'items', text: 'id なし', reason: '' });
  const [q0, q1, q2] = out.questions;
  assert.equal(out.questions.length, 3);
  assert.deepEqual(q0, { id: 'nq-1', date: '2026-10-02', stage: 'read', text: '上限は？', answer: '一律', resolvedAt: DONE_AT, future: 1 });
  assert.match(q1.id, /^nq-/);
  assert.notEqual(q1.id, 'nq-1');
  assert.deepEqual({ ...q1, id: '' }, { id: '', date: '', stage: '', text: '重なる', answer: '', resolvedAt: null }, '答えが文字でなければ空・resolvedAt が文字でなければ null');
  assert.match(q2.id, /^nq-/);
  assert.deepEqual({ ...q2, id: '' }, { id: '', date: '', stage: '', text: 'id なし', answer: '', resolvedAt: null });
  assert.deepEqual(plain(api.normalizeNotes(plain(out))), out, '2 回通しても同じ');
  for (const bad of ['こわれた', null, {}, 3]) {
    const n = plain(api.normalizeNotes({ decisions: bad, questions: bad }));
    assert.deepEqual([n.decisions, n.questions], [[], []], `行の欄が ${JSON.stringify(bad)}`);
  }
});

test('読み込み: こわれた設計ノートでも起動でき（ページの中の例外なし）、ほかの欄は変わらない', async (t) => {
  const st = sampleState();
  st.systems[0].notes = { stages: [], decisions: ['x', null], questions: 5, findings: 3, memo: [], future: 'のこす' };
  const { sys } = await boot(t, st);
  assert.deepEqual(notesOf(sys, 'y-trip'), { ...emptyNotes(), future: 'のこす' });
  assert.equal(sys('y-trip').name, '出張申請システム');
  assert.equal(sys('y-trip').description, '');
  assert.equal(sys('y-trip').updatedAt, OLD, '読み込みで更新日時は変えない');
});

// ── 段階の状態 ──
test('setNoteStage: done・skipped になったときだけ confirmedAt を入れ、ほかの状態では null。同じ状態・知らない段階／状態・ないシステムは false', async (t) => {
  const { api, sys } = await boot(t);
  const stage = (k) => plain(sys('y-trip').notes.stages[k]);
  assert.deepEqual(stage('items'), todo());
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'doing'), true);
  assert.deepEqual(stage('items'), { state: 'doing', confirmedAt: null });
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'done'), true);
  const at = stage('items').confirmedAt;
  assert.match(at, /^\d{4}-\d{2}-\d{2}T/, 'done で confirmedAt が入る（日時の文字）');
  assert.ok(at > OLD);
  assert.equal(stage('items').state, 'done');
  const undo1 = api.store.undoStack.length;
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'done'), false, '同じ done をもう一度は false');
  assert.equal(stage('items').confirmedAt, at, 'confirmedAt は変わらない');
  assert.equal(api.store.undoStack.length, undo1, '履歴に積まない');
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'review'), true);
  assert.deepEqual(stage('items'), { state: 'review', confirmedAt: null }, 'review に戻すと null');
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'skipped'), true);
  assert.equal(typeof stage('items').confirmedAt, 'string', 'skipped でも入る');
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'todo'), true);
  assert.deepEqual(stage('items'), todo());
  // done → skipped（skipped → done）も「変わったとき」なので入れ直す。前の日時を古い値にして、入れ直したことを見る
  api.actions.setNoteStage('y-trip', 'items', 'done');
  sys('y-trip').notes.stages.items.confirmedAt = OLD;
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'skipped'), true);
  assert.ok(stage('items').confirmedAt > OLD, 'done → skipped で入れ直す');
  sys('y-trip').notes.stages.items.confirmedAt = OLD;
  assert.equal(api.actions.setNoteStage('y-trip', 'items', 'done'), true);
  assert.ok(stage('items').confirmedAt > OLD, 'skipped → done で入れ直す');
  // 変えられないとき
  const undo2 = api.store.undoStack.length;
  const before = notesOf(sys, 'y-trip');
  for (const args of [['y-trip', 'nai', 'done'], ['y-trip', undefined, 'done'], ['y-trip', 'items', 'ふしぎ'], ['y-trip', 'items', undefined], ['y-trip', 'extra', 'done'], ['y-nai', 'items', 'done']]) {
    assert.equal(api.actions.setNoteStage(...args), false, JSON.stringify(args));
  }
  assert.deepEqual(notesOf(sys, 'y-trip'), before);
  assert.equal(api.store.undoStack.length, undo2);
});

test('setNoteStage: 前の版のデータ（notes が {}）のシステムでも直せる', async (t) => {
  const { api, sys } = await boot(t);
  assert.equal(api.actions.setNoteStage('y-exp', 'read', 'doing'), true);
  assert.deepEqual(plain(sys('y-exp').notes.stages.read), { state: 'doing', confirmedAt: null });
  assert.deepEqual(plain(sys('y-exp').notes.stages.flow), todo());
});

// ── 読み取ったこと・メモ ──
test('setNoteFindings・setNoteMemo: 前後の空白と改行をそのまま入れ、8000 字を超える分は切る。同じ文なら false', async (t) => {
  const { api, sys } = await boot(t);
  const cases = [['setNoteFindings', 'findings'], ['setNoteMemo', 'memo']];
  for (const [action, key] of cases) {
    const undo0 = api.store.undoStack.length;
    const text = '  業務の要約\n  ・申請者が出張を申請する\n\n';
    assert.equal(api.actions[action]('y-trip', text), true, action);
    assert.equal(sys('y-trip').notes[key], text, '前後の空白と改行を取らない');
    assert.equal(api.store.undoStack.length, undo0 + 1);
    assert.equal(api.actions[action]('y-trip', text), false, '同じ文なら false');
    assert.equal(api.store.undoStack.length, undo0 + 1, '履歴に積まない');
    assert.equal(api.actions[action]('y-trip', 'あ'.repeat(api.NOTE_TEXT_MAX + 5)), true);
    assert.equal(sys('y-trip').notes[key].length, 8000, '8000 字を超える分は切る');
    assert.equal(api.actions[action]('y-trip', 'あ'.repeat(api.NOTE_TEXT_MAX + 50)), false, '切ると同じ文になるなら false');
    assert.equal(api.actions[action]('y-trip', 'あ'.repeat(api.NOTE_TEXT_MAX)), false);
    assert.equal(api.actions[action]('y-trip', 'い'.repeat(api.NOTE_TEXT_MAX)), true, '8000 字ちょうどは切らない');
    assert.equal(sys('y-trip').notes[key], 'い'.repeat(8000));
    assert.equal(api.actions[action]('y-trip', null), true, '文字でなければ空にする');
    assert.equal(sys('y-trip').notes[key], '');
    assert.equal(api.actions[action]('y-trip', ''), false);
    assert.equal(api.actions[action]('y-nai', 'x'), false, 'ないシステム');
  }
  assert.equal(sys('y-trip').notes.stages.read.state, 'done', 'ほかの欄は変わらない');
});

// ── 決めたことと理由 ──
test('addNoteDecision・editNoteDecision・removeNoteDecision: 行を足し、書いた欄だけ直し、消す。文は前後の空白を取らない', async (t) => {
  const { api, sys } = await boot(t);
  const rows = () => plain(sys('y-trip').notes.decisions);
  const id = api.actions.addNoteDecision('y-trip', { stage: 'items', text: '  宿泊費は金額の欄にする ', reason: 'マスタを分けると入力が増えるため\n' });
  assert.match(id, /^nd-/);
  assert.equal(rows().length, 2, '後ろに足す');
  assert.deepEqual(rows()[1], { id, date: api.todayDay(), stage: 'items', text: '  宿泊費は金額の欄にする ', reason: 'マスタを分けると入力が増えるため\n' }, '前後の空白を取らない・日付は今日');
  assert.match(rows()[1].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(rows()[1]), ['id', 'date', 'stage', 'text', 'reason']);
  const id2 = api.actions.addNoteDecision('y-trip', { stage: 'docs' });
  assert.deepEqual(plain(sys('y-trip').notes.decisions[2]), { id: id2, date: api.todayDay(), stage: 'docs', text: '', reason: '' }, 'text・reason は省ける');
  assert.notEqual(id2, id);
  // 足せないとき
  const before = notesOf(sys, 'y-trip');
  const undo0 = api.store.undoStack.length;
  for (const [sysId, spec] of [['y-trip', { stage: 'nai', text: 'x' }], ['y-trip', { text: 'x' }], ['y-trip', {}], ['y-trip', null], ['y-trip', 'こわれた'], ['y-nai', { stage: 'read' }]]) {
    assert.equal(api.actions.addNoteDecision(sysId, spec), null, JSON.stringify([sysId, spec]));
  }
  assert.equal(api.actions.addNoteDecision('y-trip'), null, '引数なし');
  assert.deepEqual(notesOf(sys, 'y-trip'), before);
  assert.equal(api.store.undoStack.length, undo0);
  // 直す
  assert.equal(api.actions.editNoteDecision('y-trip', id, { text: '宿泊費は一覧の列にする' }), true);
  assert.deepEqual(rows()[1], { id, date: api.todayDay(), stage: 'items', text: '宿泊費は一覧の列にする', reason: 'マスタを分けると入力が増えるため\n' }, '書いた欄だけ変わる');
  assert.equal(api.actions.editNoteDecision('y-trip', id, { stage: 'screens', reason: ' 画面の数を減らすため ' }), true);
  assert.deepEqual([rows()[1].stage, rows()[1].reason, rows()[1].text], ['screens', ' 画面の数を減らすため ', '宿泊費は一覧の列にする']);
  assert.equal(api.actions.editNoteDecision('y-trip', id, { text: '' }), true, '空にもできる');
  assert.equal(rows()[1].text, '');
  // 直せないとき（何も変えない）
  const before2 = notesOf(sys, 'y-trip');
  const undo1 = api.store.undoStack.length;
  for (const [sysId, rowId, patch] of [
    ['y-trip', id, { stage: 'nai' }], ['y-trip', id, { stage: 'nai', text: '書かない' }], ['y-trip', id, { stage: 7 }],
    ['y-trip', id, { text: '' }], ['y-trip', id, {}], ['y-trip', id, null], ['y-trip', id, { stage: 'screens' }],
    ['y-trip', 'nd-nai', { text: 'x' }], ['y-nai', id, { text: 'x' }], ['y-trip', id, { id: 'nd-bad', date: '1999-01-01' }],
  ]) {
    assert.equal(api.actions.editNoteDecision(sysId, rowId, patch), false, JSON.stringify([sysId, rowId, patch]));
  }
  assert.deepEqual(notesOf(sys, 'y-trip'), before2, 'id と日付は直せない');
  assert.equal(api.store.undoStack.length, undo1);
  // 消す
  assert.equal(api.actions.removeNoteDecision('y-trip', id), true);
  assert.deepEqual(plain(rows().map((r) => r.id)), ['nd-1', id2]);
  assert.equal(api.actions.removeNoteDecision('y-trip', id), false, 'もうない行');
  assert.equal(api.actions.removeNoteDecision('y-nai', id2), false);
  assert.equal(api.actions.removeNoteDecision('y-trip', undefined), false);
});

test('editNoteDecision: 知らない段階の行（読み込みで残したもの）も、段階を書かずに文だけ直せる。段階を書けば NOTE_STAGES の値だけ受ける', async (t) => {
  const st = sampleState();
  st.systems[0].notes.decisions.push({ id: 'nd-z', date: '2026-10-02', stage: 'zzz', text: '昔の段階の行', reason: '' });
  const { api, sys } = await boot(t, st);
  assert.equal(sys('y-trip').notes.decisions[1].stage, 'zzz', '読み込みで捨てない');
  assert.equal(api.actions.editNoteDecision('y-trip', 'nd-z', { text: '直した' }), true);
  assert.equal(sys('y-trip').notes.decisions[1].stage, 'zzz');
  assert.equal(api.actions.editNoteDecision('y-trip', 'nd-z', { stage: 'zzz' }), false, '知らない段階は書けない（今と同じ値でも）');
  assert.equal(api.actions.editNoteDecision('y-trip', 'nd-z', { stage: 'docs' }), true);
  assert.equal(sys('y-trip').notes.decisions[1].stage, 'docs');
});

// ── まだ決まっていないこと ──
test('addNoteQuestion・editNoteQuestion・removeNoteQuestion: 行を足し（答えは空・解決の日時は null）、書いた欄だけ直し、消す', async (t) => {
  const { api, sys } = await boot(t);
  const rows = () => plain(sys('y-trip').notes.questions);
  const id = api.actions.addNoteQuestion('y-trip', { stage: 'flow', text: ' 差し戻しは何回まで許すか ' });
  assert.match(id, /^nq-/);
  assert.equal(rows().length, 2);
  assert.deepEqual(rows()[1], { id, date: api.todayDay(), stage: 'flow', text: ' 差し戻しは何回まで許すか ', answer: '', resolvedAt: null });
  assert.deepEqual(Object.keys(rows()[1]), ['id', 'date', 'stage', 'text', 'answer', 'resolvedAt']);
  const id2 = api.actions.addNoteQuestion('y-trip', { stage: 'read' });
  assert.equal(plain(sys('y-trip').notes.questions[2]).text, '', 'text は省ける');
  assert.notEqual(id2, id);
  const before = notesOf(sys, 'y-trip');
  const undo0 = api.store.undoStack.length;
  for (const [sysId, spec] of [['y-trip', { stage: 'nai', text: 'x' }], ['y-trip', { text: 'x' }], ['y-trip', null], ['y-nai', { stage: 'read' }]]) {
    assert.equal(api.actions.addNoteQuestion(sysId, spec), null, JSON.stringify([sysId, spec]));
  }
  assert.deepEqual(notesOf(sys, 'y-trip'), before);
  assert.equal(api.store.undoStack.length, undo0);
  // 直す（答えは editNoteQuestion では直さない。answerNoteQuestion を使う）
  assert.equal(api.actions.editNoteQuestion('y-trip', id, { text: '差し戻しは 2 回まで', answer: '直せない', resolvedAt: '2026-01-01' }), true);
  assert.deepEqual(rows()[1], { id, date: api.todayDay(), stage: 'flow', text: '差し戻しは 2 回まで', answer: '', resolvedAt: null }, '直せるのは stage と text だけ');
  assert.equal(api.actions.editNoteQuestion('y-trip', id, { stage: 'screens' }), true);
  assert.equal(rows()[1].stage, 'screens');
  for (const [sysId, rowId, patch] of [
    ['y-trip', id, { stage: 'nai' }], ['y-trip', id, { stage: 'screens', text: '差し戻しは 2 回まで' }], ['y-trip', id, {}], ['y-trip', id, null],
    ['y-trip', 'nq-nai', { text: 'x' }], ['y-nai', id, { text: 'x' }], ['y-trip', id, { answer: 'だけ' }],
  ]) {
    assert.equal(api.actions.editNoteQuestion(sysId, rowId, patch), false, JSON.stringify([sysId, rowId, patch]));
  }
  assert.deepEqual([rows()[1].text, rows()[1].answer], ['差し戻しは 2 回まで', '']);
  // 消す
  assert.equal(api.actions.removeNoteQuestion('y-trip', id), true);
  assert.deepEqual(plain(rows().map((r) => r.id)), ['nq-1', id2]);
  assert.equal(api.actions.removeNoteQuestion('y-trip', id), false);
  assert.equal(api.actions.removeNoteQuestion('y-nai', id2), false);
});

test('answerNoteQuestion: 答えがあれば resolvedAt を入れ、空にしたら null。答えだけを変えても resolvedAt はそのまま。同じ答えは false', async (t) => {
  const { api, sys } = await boot(t);
  const q = () => plain(sys('y-trip').notes.questions[0]);
  assert.deepEqual([q().answer, q().resolvedAt], ['', null]);
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '役職ごとに変わる'), true);
  assert.equal(q().answer, '役職ごとに変わる');
  const at = q().resolvedAt;
  assert.match(at, /^\d{4}-\d{2}-\d{2}T/, '答えで resolvedAt が入る');
  // 答えだけを変える（前の resolvedAt を古い値にして、付け直していないことを見る）
  sys('y-trip').notes.questions[0].resolvedAt = OLD;
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '部長は一律'), true);
  assert.deepEqual([q().answer, q().resolvedAt], ['部長は一律', OLD], '答えを変えても resolvedAt はそのまま');
  const undo0 = api.store.undoStack.length;
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '部長は一律'), false, '同じ答え');
  assert.equal(api.store.undoStack.length, undo0);
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', ''), true);
  assert.deepEqual([q().answer, q().resolvedAt], ['', null], '空にしたら null');
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', ''), false);
  // 空白だけの答えは「答えなし」。答えの文字は前後の空白を取らずにそのまま入れる
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '  \n '), true);
  assert.deepEqual([q().answer, q().resolvedAt], ['  \n ', null], '空白だけでは resolvedAt を入れない');
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '  一律  '), true);
  assert.deepEqual([q().answer, typeof q().resolvedAt], ['  一律  ', 'string']);
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', '  '), true, '答えのあった問いを空白だけにすると null に戻す');
  assert.equal(q().resolvedAt, null);
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-1', null), true, '文字でなければ空として扱う（空白だけの答えが空に直る）');
  assert.deepEqual([q().answer, q().resolvedAt], ['', null]);
  assert.equal(api.actions.answerNoteQuestion('y-trip', 'nq-nai', 'x'), false, 'ない問い');
  assert.equal(api.actions.answerNoteQuestion('y-nai', 'nq-1', 'x'), false, 'ないシステム');
});

// ── 1 回の変更・更新日時 ──
test('どの操作も 1 回の変更: 元に戻す 1 回で戻り、やり直すで進む。更新日時は中身が変わったときだけ変わる', async (t) => {
  const { api, sys } = await boot(t);
  const steps = [
    ['setNoteStage', () => api.actions.setNoteStage('y-trip', 'items', 'doing')],
    ['setNoteFindings', () => api.actions.setNoteFindings('y-trip', '新しく読み取ったこと')],
    ['setNoteMemo', () => api.actions.setNoteMemo('y-trip', '新しいメモ')],
    ['addNoteDecision', () => api.actions.addNoteDecision('y-trip', { stage: 'items', text: '決めた', reason: '理由' })],
    ['editNoteDecision', () => api.actions.editNoteDecision('y-trip', 'nd-1', { text: '承認は 2 段にする' })],
    ['removeNoteDecision', () => api.actions.removeNoteDecision('y-trip', 'nd-1')],
    ['addNoteQuestion', () => api.actions.addNoteQuestion('y-trip', { stage: 'items', text: '決まっていない' })],
    ['editNoteQuestion', () => api.actions.editNoteQuestion('y-trip', 'nq-1', { text: '宿泊費の上限は地域で変わるか' })],
    ['answerNoteQuestion', () => api.actions.answerNoteQuestion('y-trip', 'nq-1', '変わらない')],
    ['removeNoteQuestion', () => api.actions.removeNoteQuestion('y-trip', 'nq-1')],
  ];
  for (const [name, run] of steps) {
    const before = plain(sys('y-trip'));
    const undo0 = api.store.undoStack.length;
    assert.ok(run(), `${name} は変えられる`);
    const after = plain(sys('y-trip'));
    assert.equal(api.store.undoStack.length, undo0 + 1, `${name}: 元に戻す 1 回分`);
    assert.notEqual(after.updatedAt, OLD, `${name}: 中身が変わったので更新日時が変わる`);
    assert.notDeepEqual(after.notes, before.notes);
    api.store.undo();
    assert.deepEqual(plain(sys('y-trip')), before, `${name}: 元に戻す 1 回で戻る（更新日時も）`);
    api.store.redo();
    assert.deepEqual(plain(sys('y-trip')), after, `${name}: やり直すで進む`);
    api.store.undo();
  }
});

test('中身が同じになる操作は履歴に積まず、更新日時も変えない', async (t) => {
  const { api, sys } = await boot(t);
  const before = plain(sys('y-trip'));
  const undo0 = api.store.undoStack.length;
  const same = [
    api.actions.setNoteStage('y-trip', 'read', 'done'),
    api.actions.setNoteFindings('y-trip', '出張の申請から精算までの流れ。'),
    api.actions.setNoteMemo('y-trip', '様式の欄は後で確かめる'),
    api.actions.editNoteDecision('y-trip', 'nd-1', { stage: 'flow', text: '承認は上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' }),
    api.actions.editNoteQuestion('y-trip', 'nq-1', { text: '宿泊費の上限は役職で変わるか' }),
    api.actions.answerNoteQuestion('y-trip', 'nq-1', ''),
  ];
  assert.deepEqual(same, [false, false, false, false, false, false]);
  assert.equal(api.store.undoStack.length, undo0);
  assert.deepEqual(plain(sys('y-trip')), before);
  assert.equal(sys('y-trip').updatedAt, OLD);
});

// ── 履歴・ごみ箱・完全に削除 ──
test('設計ノートはシステムの履歴の写しに入らない（SYSTEM_CONTENT_KEYS・systemContentOf）。履歴の行に戻しても、設計ノートは変わらない', async (t) => {
  const { api, sys } = await boot(t);
  assert.deepEqual(plain(api.SYSTEM_CONTENT_KEYS), ['name', 'description', 'roles', 'swimlane', 'designIds']);
  assert.equal('notes' in api.systemContentOf(sys('y-trip')), false);
  const content = api.systemContent(sys('y-trip'));
  api.actions.setNoteMemo('y-trip', '設計ノートだけを直した');
  api.actions.setNoteStage('y-trip', 'flow', 'done');
  assert.equal(api.systemContent(sys('y-trip')), content, '設計ノートを直しても、システムの中身（写しにするもの）は変わらない');
  const notes = notesOf(sys, 'y-trip');
  assert.equal(api.actions.restoreSystemRevision('y-trip', 'r-1'), true);
  assert.equal(sys('y-trip').description, '前の説明', '履歴の行の中身には戻る');
  assert.deepEqual(notesOf(sys, 'y-trip'), notes, '設計ノートは変わらない');
  const row = sys('y-trip').revisions.find((r) => r.kind === 'restore');
  assert.equal('notes' in row.snapshot, false, '「戻す前の状態」の写しにも設計ノートは入らない');
  api.store.undo();
  assert.equal(sys('y-trip').description, '');
  assert.deepEqual(notesOf(sys, 'y-trip'), notes);
});

test('ごみ箱へ移す・戻すで設計ノートはそのまま。完全に削除するとシステムごと消える', async (t) => {
  const { api, S, sys } = await boot(t);
  const notes = notesOf(sys, 'y-trip');
  assert.equal(api.actions.trashSystem('y-trip'), true);
  assert.deepEqual(notesOf(sys, 'y-trip'), notes);
  assert.equal(api.actions.restoreSystem('y-trip'), true);
  assert.deepEqual(notesOf(sys, 'y-trip'), notes);
  assert.deepEqual(notesOf(sys, 'y-gone'), { ...emptyNotes(), memo: 'ごみ箱の中のメモ' }, 'ごみ箱のシステムも読み込みで直す');
  assert.equal(api.actions.deleteSystemForever('y-trip'), true);
  assert.equal(S().systems.some((y) => y.id === 'y-trip'), false, 'システムごと消える');
  assert.equal(api.actions.setNoteMemo('y-trip', 'x'), false);
  assert.equal(api.actions.addNoteDecision('y-trip', { stage: 'read' }), null);
});

// ── 前の版を見ている間 ──
test('前の版を見ている間（editableSystem が null）は、どの操作も直さず false／null を返す。見るのをやめると直せる', async (t) => {
  const { api, sys } = await boot(t);
  const before = plain(sys('y-trip'));
  const undo0 = api.store.undoStack.length;
  api.store.startViewing(api.store.state);
  assert.equal(api.store.isViewing, true);
  const a = api.actions;
  assert.deepEqual([
    a.setNoteStage('y-trip', 'items', 'doing'), a.setNoteFindings('y-trip', 'x'), a.setNoteMemo('y-trip', 'x'),
    a.addNoteDecision('y-trip', { stage: 'read', text: 'x' }), a.editNoteDecision('y-trip', 'nd-1', { text: 'x' }), a.removeNoteDecision('y-trip', 'nd-1'),
    a.addNoteQuestion('y-trip', { stage: 'read', text: 'x' }), a.editNoteQuestion('y-trip', 'nq-1', { text: 'x' }),
    a.answerNoteQuestion('y-trip', 'nq-1', 'x'), a.removeNoteQuestion('y-trip', 'nq-1'),
  ], [false, false, false, null, false, false, null, false, false, false]);
  assert.deepEqual(plain(sys('y-trip')), before);
  assert.equal(api.store.undoStack.length, undo0);
  api.store.stopViewing();
  assert.equal(a.setNoteStage('y-trip', 'items', 'doing'), true);
});
