'use strict';
// 第 10 段階の前半（T4）: システムの画面の「設計ノート」の入口（画像 k75〔q75 の案B「段階ごとの札」と q78 の案A「人も変えられる」〕）のテスト。
// 左の入口と小さな字・段階ごとの札・この段階の進み具合のボタンとメニュー・読み取ったこと（① の札だけ）・まだ決まっていないことと決めたことと理由の表・
// メモ・右の欄の案内・欄の保存と打ちかけの文字・描き直したときのフォーカス・AI の帯の「設計ノートを開く」・文字の逃がし。
// システムと設計ノートの中身は架空の業務（出張申請・経費精算）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function key(app, target, init) {
  target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
// その日のその時刻（テストを動かす PC の時刻で作る。画面は PC の時刻の日付で出す）
const at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// ── 見本（架空の業務）──
const stage = (state, confirmedAt = null) => ({ state, confirmedAt });
const FINDINGS = '業務: 社員が出張の前に申請し、上長が承認する。\n登場人物（役割）: 申請者・上長・経理';
// 出張申請システムの設計ノート: ① ② 確認済み・③ 確認待ち・④ ⑤ まだ。③ のまだ決まっていないこと 2 つ（決まったもの 1 つ。データの並びでは真ん中）・
// ① の決まったもの 1 つ、決めたことと理由は ①・②・③ に 1 つずつ
function sampleNotes() {
  return {
    stages: { read: stage('done', at(19, 10, 0)), flow: stage('done', at(19, 11, 0)), items: stage('review'), screens: stage('todo'), docs: stage('todo') },
    findings: FINDINGS,
    memo: 'ベンダーとの打ち合わせは 10/25。',
    decisions: [
      { id: 'nd-1', date: '2026-10-19', stage: 'read', text: '役割は、申請者・上長・経理の 3 つにする', reason: '旅費規程の第 5 条から' },
      { id: 'nd-2', date: '2026-10-19', stage: 'flow', text: '承認は上長の 1 段にする', reason: '理念の「現場の手間を減らす」から' },
      { id: 'nd-3', date: '2026-10-19', stage: 'items', text: '経費精算は、出張申請と別の画面設計にする', reason: '精算は経理が確かめ、出張のない経費も入るため' },
    ],
    questions: [
      { id: 'nq-1', date: '2026-10-19', stage: 'items', text: '宿泊費の上限を、役職で変えるか', answer: '', resolvedAt: null },
      { id: 'nq-4', date: '2026-10-18', stage: 'items', text: '日当を払うか', answer: '払う', resolvedAt: at(18, 15, 0) },
      { id: 'nq-2', date: '2026-10-19', stage: 'read', text: '海外出張も、このシステムで申請するか', answer: '国内だけにする', resolvedAt: at(19, 9, 0) },
      { id: 'nq-3', date: '2026-10-19', stage: 'items', text: '「出張の目的」の欄を、必ず書く欄にするか', answer: '', resolvedAt: null },
    ],
  };
}
const system = (id, name, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: [], roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
function sampleState() {
  return plain({
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [],
    systems: [system('y-trip', '出張申請システム', { notes: sampleNotes() }), system('y-exp', '経費精算システム')],
  });
}
// 資料の窓口の身代わり（入口の数を見るだけ）
const MATERIALS_API = {
  available: true,
  pick: async () => ({ ok: false, canceled: true }), addDropped: async () => ({ ok: true, added: [], skipped: [] }),
  read: async () => ({ ok: false }), bdmPlan: async () => ({ ok: false }),
  sweep: async () => ({ ok: true, removedFiles: 0, removedDirs: 0 }), removeSystem: async () => ({ ok: true, removed: 0 }),
};

async function boot(t, { state = sampleState(), materials = false, sysId = 'y-trip', panel = 'notes' } = {}) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) }, materialsAPI: materials ? MATERIALS_API : null });
  t.after(() => app.close());
  const api = await app.api();
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  if (sysId) api.openSystem(sysId, { panel });
  const field = (sy, note) => $(`#sys-view [data-sy="${sy}"]${note ? `[data-note="${note}"]` : ''}`);
  return {
    app, api, $, $$, field,
    sys: (id = 'y-trip') => plain(api.store.state.systems.find((y) => y.id === id) || null),
    // 左の入口 [絵, 名前, 小さな字]
    entries: () => $$('#sys-list .db-entry').map((b) => [b.querySelector('.ic').textContent, b.querySelector('b').textContent, b.querySelector('small').textContent]),
    entry: (p) => $(`#sys-list .db-entry[data-panel="${p}"]`),
    // 札 [段階, 印, 状態の class, 選んでいるか]
    tabs: () => $$('#sys-view .nt-tab').map((b) => [b.dataset.stage, b.querySelector('i').textContent, ['done', 'review', 'doing', 'todo', 'skipped'].find((c) => b.classList.contains(c)), b.classList.contains('on')]),
    tab: (k) => $(`#sys-view .nt-tab[data-stage="${k}"]`),
    pill: () => $('#sys-view [data-action="sys-note-stage-menu"]'),
    stateText: () => $('#sys-view .nt-state-text').textContent,
    // 進み具合のメニュー [状態, 名前, 小さな字]
    menu: () => $$('#sys-menu-root [role="menuitem"]').map((b) => [b.dataset.state, b.querySelector('b').textContent, b.querySelector('small').textContent]),
    menuItem: (s) => $(`#sys-menu-root [data-action="sys-note-stage-set"][data-state="${s}"]`),
    // 小見出し [見出し, 小さな字]
    heads: () => $$('#sys-view .nt-sec h4').map((h) => [h.firstChild.textContent, h.querySelector('small') ? h.querySelector('small').textContent : '']),
    qRows: () => $$('#sys-view .nt-qs tbody tr').map((tr) => [tr.dataset.id, tr.querySelector('.nt-stg').textContent, tr.querySelector('[data-sy="note-q-text"]').value,
      tr.querySelector('[data-sy="note-q-answer"]').value, tr.querySelector('.ok') ? tr.querySelector('.ok').textContent : '', tr.classList.contains('resolved')]),
    dRows: () => $$('#sys-view .nt-ds tbody tr').map((tr) => [tr.dataset.id, tr.cells[0].textContent, tr.querySelector('.nt-stg').textContent,
      tr.querySelector('[data-sy="note-d-text"]').value, tr.querySelector('[data-sy="note-d-reason"]').value]),
    call: async (tool, args = {}) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' })),
  };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };

// ── 入口 ──
test('入口: 資料の窓口があれば 6 つ（資料と履歴の間に「設計ノート」）。札は 📓・「設計ノート」・今の段階、title は開くものの説明', async (t) => {
  const { api, $, entries, entry } = await boot(t, { materials: true, panel: 'swimlane' });
  assert.deepEqual(plain(api.SYS_PANELS), ['overview', 'roles', 'swimlane', 'materials', 'notes', 'history']);
  assert.deepEqual(entries().map((e) => e[1]), ['概要', '役割', 'スイムレーン図', '資料', '設計ノート', '履歴']);
  assert.deepEqual(entries()[4], ['📓', '設計ノート', '③ 確認待ち']);
  assert.equal(entry('notes').title, '段階ごとの進み具合・決めたことと理由・まだ決まっていないことを開きます');
  assert.equal(entry('notes').classList.contains('active'), false);
  click(entry('notes'));
  assert.equal(api.ui.sysPanel, 'notes');
  assert.equal(entry('notes').classList.contains('active'), true);
  assert.equal(entry('notes').getAttribute('aria-pressed'), 'true');
  assert.equal($('#sys-view h3').textContent, '設計ノート（出張申請システム）');
});

test('入口: 資料の窓口がないとき（ブラウザで開いたとき）は 5 つで、設計ノートは出る。設計ノートの入口で開ける', async (t) => {
  const { api, $, entries } = await boot(t);
  assert.deepEqual(entries().map((e) => e[1]), ['概要', '役割', 'スイムレーン図', '設計ノート', '履歴']);
  assert.equal(api.ui.sysPanel, 'notes');
  assert.equal($('#sys-view h3').textContent, '設計ノート（出張申請システム）');
  api.openSystemPanel('roles');
  api.openSystemPanel('notes');
  assert.equal(api.ui.sysPanel, 'notes');
  api.goHome();
  api.openSystem('y-trip');
  assert.equal(api.ui.sysPanel, 'notes', '最後に開いた入口として覚える');
});

test('入口の小さな字: 確認待ち・作業中の段階があれば最初のもの、全部まだなら「まだ始めていません」、全部済みなら「⑤ まで済み」、ほかはまだの段階の最初', async (t) => {
  const { api, entries } = await boot(t);
  const note = () => entries()[3][2];
  assert.equal(note(), '③ 確認待ち');
  api.actions.setNoteStage('y-trip', 'flow', 'doing');
  assert.equal(note(), '② 作業中', '確認待ちより前の段階の作業中');
  api.actions.setNoteStage('y-trip', 'flow', 'done');
  api.actions.setNoteStage('y-trip', 'items', 'done');
  assert.equal(note(), '④ まだ');
  api.actions.setNoteStage('y-trip', 'read', 'todo');
  assert.equal(note(), '① まだ');
  api.actions.setNoteStage('y-trip', 'read', 'skipped');
  api.actions.setNoteStage('y-trip', 'screens', 'done');
  api.actions.setNoteStage('y-trip', 'docs', 'skipped');
  assert.equal(note(), '⑤ まで済み', '確認済みと確認を飛ばしただけ');
  api.actions.setNoteStage('y-trip', 'docs', 'review');
  assert.equal(note(), '⑤ 確認待ち');
  api.openSystem('y-exp');
  assert.equal(note(), 'まだ始めていません');
});

// ── 札 ──
test('札: 5 つ（段階の名前と印〔確認済み ✓・確認待ち ●・作業中 ▶・まだ –・確認を飛ばした ⤼〕）。最初に開く札は、確認待ち・作業中の段階の最初のもの', async (t) => {
  const { api, tabs, tab } = await boot(t);
  assert.deepEqual(tabs(), [
    ['read', '✓', 'done', false], ['flow', '✓', 'done', false], ['items', '●', 'review', true], ['screens', '–', 'todo', false], ['docs', '–', 'todo', false],
  ]);
  assert.deepEqual(['read', 'flow', 'items', 'screens', 'docs'].map((k) => tab(k).firstChild.textContent),
    ['① 資料から読み取る', '② 業務の流れ', '③ データベースの項目', '④ 画面', '⑤ 説明書と出力']);
  assert.equal(tab('items').getAttribute('aria-pressed'), 'true');
  assert.equal(api.ui.notesStages['y-trip'], 'items');
  api.actions.setNoteStage('y-trip', 'flow', 'doing');
  api.actions.setNoteStage('y-trip', 'screens', 'skipped');
  assert.deepEqual(tabs().map((x) => x.slice(1, 3)), [['✓', 'done'], ['▶', 'doing'], ['●', 'review'], ['⤼', 'skipped'], ['–', 'todo']]);
  // 全部まだなら ①
  api.openSystem('y-exp', { panel: 'notes' });
  assert.equal(api.ui.notesStages['y-exp'], 'read');
  // 確認待ち・作業中がなければ、まだの段階の最初のもの。全部済みなら ⑤
  const reopen = () => { delete api.ui.notesStages['y-exp']; api.renderSystem(); return api.ui.notesStages['y-exp']; };
  api.actions.setNoteStage('y-exp', 'read', 'done');
  api.actions.setNoteStage('y-exp', 'flow', 'skipped');
  assert.equal(reopen(), 'items');
  api.actions.setNoteStage('y-exp', 'items', 'doing');
  assert.equal(reopen(), 'items');
  ['items', 'screens', 'docs'].forEach((k) => api.actions.setNoteStage('y-exp', k, 'done'));
  assert.equal(reopen(), 'docs');
  assert.equal(JSON.stringify(api.store.state).includes('notesStages'), false, '開いている札は保存しない');
});

test('札: 押すとその段階の中身に変わる。AI が段階を変えても開いている札は動かない。同じアプリの間は、システムごとに開いていた札を覚える', async (t) => {
  const { api, tabs, tab, heads, call } = await boot(t);
  click(tab('read'));
  assert.equal(api.ui.notesStages['y-trip'], 'read');
  assert.deepEqual(tabs().map((x) => x[3]), [true, false, false, false, false]);
  assert.deepEqual(heads().map((h) => h[0]), ['読み取ったこと', 'まだ決まっていないこと（①）', '決めたことと理由（①）', 'メモ']);
  // AI が段階を変える: 札の印は変わるが、開いている札は ① のまま
  ok(await call('set_stage', { system: 'y-trip', stage: 'items', state: 'done' }));
  ok(await call('set_stage', { system: 'y-trip', stage: 'screens', state: 'review' }));
  assert.equal(api.ui.notesStages['y-trip'], 'read');
  assert.deepEqual(tabs().map((x) => [x[1], x[3]]), [['✓', true], ['✓', false], ['✓', false], ['●', false], ['–', false]]);
  click(tab('docs'));
  assert.deepEqual(heads().map((h) => h[0]), ['まだ決まっていないこと（⑤）', '決めたことと理由（⑤）', 'メモ']);
  api.goHome();
  api.openSystem('y-trip');
  assert.equal(api.ui.notesStages['y-trip'], 'docs');
  assert.equal(tab('docs').classList.contains('on'), true);
});

test('札を押すと、描き直した後の選んだ札にフォーカスを置く（キーボードで続けて札を選べる。終わりの見直し A の Minor 3）', async (t) => {
  const { app, field, tab } = await boot(t);
  tab('items').focus();
  click(tab('read'));
  assert.equal(app.document.activeElement, tab('read'));
  assert.ok(app.document.activeElement.classList.contains('on'));
  // 欄にフォーカスがあるときに札を押しても、選んだ札へ
  field('note-memo').focus();
  click(tab('flow'));
  assert.equal(app.document.activeElement, tab('flow'));
});

// ── 見出し・右の欄 ──
test('真ん中の見出しと案内の文、右の欄「設計ノートについて」の案内', async (t) => {
  const { $, $$ } = await boot(t);
  assert.equal($('#sys-view h3').textContent, '設計ノート（出張申請システム）');
  assert.equal($('#sys-view .map-note').textContent,
    'AI が資料からこのシステムを作るときに、段階ごとに読み取ったこと・決めたことと理由・まだ決まっていないことを書きます。人も直せます（欄を離れると保存します）。');
  assert.equal($('#sys-side .panel-title').textContent, '設計ノートについて');
  assert.deepEqual($$('#sys-side .hint').map((p) => p.textContent), [
    'AI は段階の終わりに、案をチャットに出して止まり、段階の札を「確認待ち」（オレンジ）にします。チャットで「よい」と答えると、AI が「確認済み」（緑）にして次の段階へ進みます。',
    '札の色: 緑＝確認済み・オレンジ＝確認待ち・青＝作業中・灰色＝まだ・点線の枠＝確認を飛ばした。',
    '① の札を押すと、① で資料から読み取ったこと（業務の要約・登場人物・今の手順・様式の欄）が出ます。',
    'AI とつないでいないときは、「この段階の進み具合」のボタンを押して、進み具合を変えられます。',
    'まだ決まっていないことに答えを書くと「決まった」になり、表の下へ移ります。',
    '決めたことと理由は、システムの説明書（PDF）の最後のページに入ります。',
  ]);
});

// ── この段階の進み具合 ──
test('進み具合: ボタン（状態の名前と ▾）と説明の文。押すとメニュー（確認待ちなら 3 つ）。外を押す・Esc で閉じる', async (t) => {
  const { app, api, $, pill, stateText, menu, tab } = await boot(t);
  assert.equal(pill().textContent, '確認待ち ▾');
  assert.ok(pill().classList.contains('nt-pill') && pill().classList.contains('review'));
  assert.equal(pill().getAttribute('aria-haspopup'), 'menu');
  assert.equal(pill().getAttribute('aria-expanded'), 'false');
  assert.equal(stateText(), 'AI が案を出して、あなたの答えを待っています。');
  click(pill());
  assert.equal(api.ui.sysMenu, 'stage:y-trip');
  assert.deepEqual(menu(), [
    ['done', '✓ 確認済みにする', 'この段階の案でよい（AI は次の段階へ進める）'],
    ['skipped', '⤼ 確かめずに進めたことにする', '「確認を飛ばした」にする'],
    ['todo', '↺ まだに戻す', 'この段階をやり直す'],
  ]);
  assert.ok($('#sys-menu-root .pop-menu.sys-pop'));
  assert.equal(pill().getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, $('#sys-menu-root [role="menuitem"]'), 'キーボードでも選べるように、最初の項目にフォーカス');
  // 外を押すと閉じる
  click($('#sys-view h3'));
  assert.equal(api.ui.sysMenu, null);
  assert.deepEqual(menu(), []);
  assert.equal(pill().getAttribute('aria-expanded'), 'false');
  // もう一度押すと閉じる
  click(pill());
  click(pill());
  assert.deepEqual(menu(), []);
  // Esc で閉じて、ボタンにフォーカスを戻す
  click(pill());
  key(app, app.document.activeElement, { key: 'Escape' });
  assert.deepEqual(menu(), []);
  assert.equal(app.document.activeElement, pill());
  // 札を切り替えると閉じる
  click(pill());
  click(tab('flow'));
  assert.equal(api.ui.sysMenu, null);
  assert.deepEqual(menu(), []);
  // 作業中の説明の文
  api.actions.setNoteStage('y-trip', 'flow', 'doing');
  assert.equal(pill().textContent, '作業中 ▾');
  assert.equal(stateText(), 'AI がこの段階を進めています。');
  click(pill());
  assert.equal(menu().length, 3);
});

test('進み具合: メニューを開いたまま真ん中を送ると閉じる（ボタンから離れるため）。左の「＋ 画面設計を入れる ▾」のメニューは、真ん中を送っても閉じない', async (t) => {
  const { app, api, $, pill, menu } = await boot(t);
  const scroll = (el) => el.dispatchEvent(new app.window.Event('scroll'));
  click(pill());
  assert.equal(menu().length, 3);
  scroll($('#sys-view'));
  assert.equal(api.ui.sysMenu, null);
  assert.deepEqual(menu(), []);
  assert.equal(pill().getAttribute('aria-expanded'), 'false');
  // 左の欄を送っても閉じる（今の決まり）
  click(pill());
  scroll($('#sys-list'));
  assert.equal(api.ui.sysMenu, null);
  // 左の「＋ 画面設計を入れる ▾」のメニューは、錨が左の欄なので、真ん中を送っても閉じない
  click($('#sys-list .sys-add'));
  assert.equal(api.ui.sysMenu, 'add:y-trip');
  scroll($('#sys-view'));
  assert.equal(api.ui.sysMenu, 'add:y-trip');
  assert.ok($('#sys-menu-root .sys-pop'));
});

test('進み具合: メニューで押すと状態が変わる（確認済み・確認を飛ばしたは日付も）。メニューは今の状態を除いた 2 つ。元に戻すで戻る', async (t) => {
  const { app, api, pill, stateText, menu, menuItem, tabs, sys } = await boot(t);
  const today = api.todayDay();
  click(pill());
  click(menuItem('done'));
  assert.equal(api.ui.sysMenu, null, '押したら閉じる');
  assert.equal(app.document.activeElement, pill(), '描き直した進み具合のボタンにフォーカスを戻す（Esc で閉じたときと同じ）');
  assert.equal(sys().notes.stages.items.state, 'done');
  assert.match(sys().notes.stages.items.confirmedAt, ISO);
  assert.equal(pill().textContent, `確認済み（${today}） ▾`);
  assert.ok(pill().classList.contains('done'));
  assert.equal(stateText(), 'この段階の案は確かめました。');
  assert.deepEqual(tabs()[2].slice(1), ['✓', 'done', true]);
  click(pill());
  assert.deepEqual(menu().map((m) => m[0]), ['skipped', 'todo']);
  click(menuItem('skipped'));
  assert.equal(pill().textContent, `確認を飛ばした（${today}） ▾`);
  assert.equal(stateText(), '確かめずに次へ進めました。');
  assert.deepEqual(tabs()[2].slice(1, 3), ['⤼', 'skipped']);
  click(pill());
  assert.deepEqual(menu().map((m) => m[0]), ['done', 'todo']);
  click(menuItem('todo'));
  assert.deepEqual(plain(sys().notes.stages.items), { state: 'todo', confirmedAt: null });
  assert.equal(pill().textContent, 'まだ ▾');
  assert.equal(stateText(), 'まだ始めていません。');
  click(pill());
  assert.deepEqual(menu().map((m) => m[0]), ['done', 'skipped']);
  click(app.document.body);
  // ① の確認済みの日付（PC の時刻の日付）
  click(app.document.querySelector('#sys-view .nt-tab[data-stage="read"]'));
  assert.equal(pill().textContent, '確認済み（2026-10-19） ▾');
  // 元に戻す（Ctrl+Z）で 1 つずつ戻る
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys().notes.stages.items.state, 'skipped');
});

test('進み具合: AI が書いて描き直しても、開いているメニューの中のフォーカスは同じ項目に戻る。その項目がなくなったら進み具合のボタンへ（終わりの見直し A の Minor 5）', async (t) => {
  const { app, api, pill, menu, menuItem, call } = await boot(t);
  click(pill());
  menuItem('skipped').focus();
  ok(await call('update_notes', { system: 'y-trip', ops: [{ op: 'set_memo', text: 'AI のメモ' }] }));
  assert.equal(api.ui.sysMenu, 'stage:y-trip', 'メニューは開いたまま');
  assert.equal(app.document.activeElement, menuItem('skipped'));
  // AI が開いている札の段階を「確認を飛ばした」にした: メニューから「確かめずに進めたことにする」がなくなるので、進み具合のボタンへ
  ok(await call('set_stage', { system: 'y-trip', stage: 'items', state: 'skipped' }));
  assert.deepEqual(menu().map((m) => m[0]), ['done', 'todo']);
  assert.equal(app.document.activeElement, pill());
});

// ── 読み取ったこと・メモ ──
test('① の札だけ「読み取ったこと」（長さの上限は NOTE_TEXT_MAX）。メモは札によらず、札の外の下に出る', async (t) => {
  const { api, $, field, tab, heads } = await boot(t);
  assert.equal(field('note-findings'), null, '③ の札には出さない');
  assert.deepEqual(heads(), [['まだ決まっていないこと（③）', '2 つ（決まったもの 1 つ）'], ['決めたことと理由（③）', '1 つ'], ['メモ', '段階によらない']]);
  assert.equal(field('note-memo').value, 'ベンダーとの打ち合わせは 10/25。');
  assert.equal(field('note-memo').maxLength, api.NOTE_TEXT_MAX);
  assert.equal(field('note-memo').closest('.nt-tabbody'), null, 'メモは札の外');
  click(tab('read'));
  const f = field('note-findings');
  assert.equal(f.tagName, 'TEXTAREA');
  assert.equal(f.value, FINDINGS);
  assert.equal(f.maxLength, api.NOTE_TEXT_MAX);
  assert.ok(f.closest('.nt-tabbody'), '読み取ったことは札の中');
  assert.deepEqual(heads()[0], ['読み取ったこと', '① で資料から読み取ったこと（業務の要約・登場人物・今の手順・様式の欄）']);
  assert.equal(field('note-memo').value, 'ベンダーとの打ち合わせは 10/25。');
  for (const k of ['flow', 'screens', 'docs']) {
    click(tab(k));
    assert.equal(field('note-findings'), null, k);
    assert.ok(field('note-memo'), k);
  }
  assert.ok($('#sys-view .nt-tabs + .nt-tabbody'));
});

// ── 表 ──
test('表: まだ決まっていないこと（開いている札の段階だけ。決まった行は表の下に灰色で「M/D に決まった」と ✕）・決めたことと理由（日付・段階・決めたこと・理由・✕）', async (t) => {
  const { $, $$, field, tab, heads, qRows, dRows } = await boot(t);
  assert.deepEqual($$('#sys-view .nt-qs th').map((th) => th.textContent), ['段階', 'まだ決まっていないこと', '答え', '']);
  assert.deepEqual(qRows(), [
    ['nq-1', '③', '宿泊費の上限を、役職で変えるか', '', '', false],
    ['nq-3', '③', '「出張の目的」の欄を、必ず書く欄にするか', '', '', false],
    ['nq-4', '③', '日当を払うか', '払う', '10/18 に決まった', true],
  ]);
  assert.equal(field('note-q-answer', 'nq-1').placeholder, '答えを書くと「決まった」になる');
  // 行の欄は 1 行の textarea（改行を残し、長い文は折り返す。終わりの見直し A の Important 1・Minor 1）
  assert.deepEqual([['note-q-text', 'nq-1'], ['note-q-answer', 'nq-1'], ['note-d-text', 'nd-3'], ['note-d-reason', 'nd-3']].map(([sy, id]) => [field(sy, id).tagName, field(sy, id).rows]),
    [['TEXTAREA', 1], ['TEXTAREA', 1], ['TEXTAREA', 1], ['TEXTAREA', 1]]);
  assert.deepEqual($$('#sys-view .nt-qs [data-action="sys-note-del-q"]').map((b) => [b.dataset.id, b.textContent]), [['nq-1', '✕'], ['nq-3', '✕'], ['nq-4', '✕']]);
  assert.match($('#sys-view [data-action="sys-note-del-q"]').title, /^この行を消す/);
  assert.equal($('#sys-view [data-action="sys-note-add-q"]').textContent, '＋ まだ決まっていないことを足す');
  assert.deepEqual($$('#sys-view .nt-ds th').map((th) => th.textContent), ['日付', '段階', '決めたこと', '理由', '']);
  assert.deepEqual(dRows(), [['nd-3', '2026-10-19', '③', '経費精算は、出張申請と別の画面設計にする', '精算は経理が確かめ、出張のない経費も入るため']]);
  assert.deepEqual($$('#sys-view [data-action="sys-note-del-d"]').map((b) => b.dataset.id), ['nd-3']);
  assert.equal($('#sys-view [data-action="sys-note-add-d"]').textContent, '＋ 決めたことを足す');
  click(tab('read'));
  assert.deepEqual(heads().slice(1, 3), [['まだ決まっていないこと（①）', 'なし（決まったもの 1 つ）'], ['決めたことと理由（①）', '1 つ']]);
  assert.deepEqual(qRows(), [['nq-2', '①', '海外出張も、このシステムで申請するか', '国内だけにする', '10/19 に決まった', true]]);
  assert.deepEqual(dRows().map((r) => r[0]), ['nd-1']);
  click(tab('screens'));
  assert.deepEqual(heads().slice(0, 2), [['まだ決まっていないこと（④）', 'なし'], ['決めたことと理由（④）', 'なし']]);
  assert.equal($('#sys-view .nt-qs'), null, '行がなければ表を出さない');
  assert.equal($('#sys-view .nt-ds'), null);
  assert.ok($('#sys-view [data-action="sys-note-add-q"]') && $('#sys-view [data-action="sys-note-add-d"]'));
});

test('行を足す: 開いている札の段階の行を足し、その行の文字の欄にフォーカス。空の行も残る。✕ で消え、Ctrl+Z で戻る', async (t) => {
  const { app, api, $, field, tab, qRows, dRows, sys } = await boot(t);
  click($('#sys-view [data-action="sys-note-add-q"]'));
  const q = sys().notes.questions;
  assert.equal(q.length, 5);
  const nq = q[4];
  assert.deepEqual([nq.stage, nq.text, nq.answer, nq.resolvedAt], ['items', '', '', null]);
  assert.equal(app.document.activeElement, field('note-q-text', nq.id));
  assert.deepEqual(qRows().map((r) => r[0]), ['nq-1', 'nq-3', nq.id, 'nq-4'], 'まだの行の後ろ・決まった行の前');
  click($('#sys-view [data-action="sys-note-add-d"]'));
  const nd = sys().notes.decisions[3];
  assert.deepEqual([nd.stage, nd.date, nd.text, nd.reason], ['items', api.todayDay(), '', '']);
  assert.equal(app.document.activeElement, field('note-d-text', nd.id));
  assert.deepEqual(dRows().map((r) => r[0]), ['nd-3', nd.id]);
  // ほかの札では、その札の段階
  click(tab('screens'));
  click($('#sys-view [data-action="sys-note-add-q"]'));
  assert.equal(sys().notes.questions[5].stage, 'screens');
  click($('#sys-view [data-action="sys-note-add-d"]'));
  assert.equal(sys().notes.decisions[4].stage, 'screens');
  // ✕ で消える・元に戻す（Ctrl+Z）で戻る
  click(tab('items'));
  click($('#sys-view [data-action="sys-note-del-q"][data-id="nq-1"]'));
  assert.equal(sys().notes.questions.some((x) => x.id === 'nq-1'), false);
  assert.deepEqual(qRows().map((r) => r[0]), ['nq-3', nq.id, 'nq-4']);
  click($('#sys-view [data-action="sys-note-del-q"][data-id="nq-4"]'));
  assert.deepEqual(qRows().map((r) => r[0]), ['nq-3', nq.id], '決まった行も消せる');
  click($('#sys-view [data-action="sys-note-del-d"][data-id="nd-3"]'));
  assert.deepEqual(dRows().map((r) => r[0]), [nd.id]);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual(dRows().map((r) => r[0]), ['nd-3', nd.id]);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual(qRows().map((r) => r[0]), ['nq-1', 'nq-3', nq.id, 'nq-4']);
});

// ── 欄の保存 ──
test('欄を離れると保存する（読み取ったこと・メモ・行の文字・答え・理由）。真ん中は描き直さない。中身が変わらなければ履歴に積まない', async (t) => {
  const { api, field, tab, sys } = await boot(t);
  const undo = () => api.store.undoStack.length;
  const u0 = undo();
  const qText = field('note-q-text', 'nq-1');
  setValue(qText, '宿泊費の上限を、役職と行き先で変えるか');
  assert.equal(sys().notes.questions[0].text, '宿泊費の上限を、役職と行き先で変えるか');
  assert.equal(qText.isConnected, true, '真ん中は描き直さない');
  setValue(field('note-d-text', 'nd-3'), '経費精算は別の画面設計にする');
  setValue(field('note-d-reason', 'nd-3'), '  前後の空白もそのまま  ');
  assert.deepEqual([sys().notes.decisions[2].text, sys().notes.decisions[2].reason], ['経費精算は別の画面設計にする', '  前後の空白もそのまま  ']);
  setValue(field('note-memo'), 'メモを直した');
  assert.equal(sys().notes.memo, 'メモを直した');
  assert.equal(undo(), u0 + 4);
  setValue(field('note-memo'), 'メモを直した');
  assert.equal(undo(), u0 + 4, '同じ文字なら積まない');
  click(tab('read'));
  setValue(field('note-findings'), '読み取ったことを直した');
  assert.equal(sys().notes.findings, '読み取ったことを直した');
  assert.notEqual(sys().updatedAt, '2026-10-01T00:00:00.000Z');
});

test('答えを書いて欄を離れると「決まった」になる。離れた直後は行が動かず、次に描き直すと表の下（灰色）へ移る', async (t) => {
  const { api, field, qRows, sys } = await boot(t);
  const ans = field('note-q-answer', 'nq-1');
  setValue(ans, '役職では変えない');
  const q = sys().notes.questions.find((x) => x.id === 'nq-1');
  assert.equal(q.answer, '役職では変えない');
  assert.match(q.resolvedAt, ISO);
  assert.equal(ans.isConnected, true);
  assert.deepEqual(qRows().map((r) => [r[0], r[5]]), [['nq-1', false], ['nq-3', false], ['nq-4', true]], '離れた直後は動かない');
  api.renderSystem();
  const md = api.todayDay().slice(5).split('-').map(Number).join('/');
  assert.deepEqual(qRows(), [
    ['nq-3', '③', '「出張の目的」の欄を、必ず書く欄にするか', '', '', false],
    ['nq-1', '③', '宿泊費の上限を、役職で変えるか', '役職では変えない', `${md} に決まった`, true],
    ['nq-4', '③', '日当を払うか', '払う', '10/18 に決まった', true],
  ]);
  // 答えを空にすると、決まっていない行に戻る
  setValue(field('note-q-answer', 'nq-1'), '');
  assert.equal(sys().notes.questions.find((x) => x.id === 'nq-1').resolvedAt, null);
  api.renderSystem();
  assert.deepEqual(qRows().map((r) => [r[0], r[5]]), [['nq-1', false], ['nq-3', false], ['nq-4', true]]);
});

test('答えがあって resolvedAt が null の行（読み込んだデータ）も「決まった」（日付なし）で表の下に出る。AI の set_stage の warnings に数えない（終わりの見直し A の Minor 2）', async (t) => {
  const state = sampleState();
  state.systems[0].notes.questions.push({ id: 'nq-5', date: '2026-10-19', stage: 'items', text: '日当の額を、行き先で変えるか', answer: '変えない', resolvedAt: null });
  // 答えが空で resolvedAt だけがある行は、まだ決まっていない
  state.systems[0].notes.questions.push({ id: 'nq-6', date: '2026-10-19', stage: 'items', text: '前払いを認めるか', answer: ' ', resolvedAt: at(18, 10, 0) });
  const { api, heads, qRows, call } = await boot(t, { state });
  assert.deepEqual(qRows(), [
    ['nq-1', '③', '宿泊費の上限を、役職で変えるか', '', '', false],
    ['nq-3', '③', '「出張の目的」の欄を、必ず書く欄にするか', '', '', false],
    ['nq-6', '③', '前払いを認めるか', ' ', '', false],
    ['nq-4', '③', '日当を払うか', '払う', '10/18 に決まった', true],
    ['nq-5', '③', '日当の額を、行き先で変えるか', '変えない', '決まった', true],
  ]);
  assert.deepEqual(heads()[0], ['まだ決まっていないこと（③）', '3 つ（決まったもの 2 つ）']);
  assert.equal(api.noteQuestionDecided({ answer: '変えない', resolvedAt: null }), true);
  assert.equal(api.noteQuestionDecided({ answer: ' ', resolvedAt: at(18, 10, 0) }), false);
  const r = ok(await call('set_stage', { system: 'y-trip', stage: 'items', state: 'done' }));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^段階 ③（データベースの項目）に、まだ決まっていないことが 3 つ残っています。/);
});

test('打ちかけの文字（読み取ったこと・メモ・行の文字・答え・理由）は、札の切り替え・入口の切り替え・行を足す・一覧へ戻るで保存する', async (t) => {
  const { $, api, field, tab, entry, sys } = await boot(t);
  const type = (el, v) => { el.focus(); el.value = v; };
  type(field('note-q-answer', 'nq-3'), '必須にする');
  click(tab('read'));
  assert.equal(sys().notes.questions.find((x) => x.id === 'nq-3').answer, '必須にする', '札の切り替え');
  type(field('note-findings'), '打ちかけの読み取ったこと');
  click(tab('flow'));
  assert.equal(sys().notes.findings, '打ちかけの読み取ったこと');
  type(field('note-d-reason', 'nd-2'), '打ちかけの理由');
  click($('#sys-view [data-action="sys-note-add-d"]'));
  assert.equal(sys().notes.decisions.find((x) => x.id === 'nd-2').reason, '打ちかけの理由', '行を足す');
  type(field('note-memo'), '打ちかけのメモ');
  click(entry('roles'));
  assert.equal(sys().notes.memo, '打ちかけのメモ', '入口の切り替え');
  click(entry('notes'));
  type(field('note-d-text', 'nd-2'), '打ちかけの決めたこと');
  click($('#toolbar [data-action="home"]'));
  assert.equal(api.ui.view, 'home');
  assert.equal(sys().notes.decisions.find((x) => x.id === 'nd-2').text, '打ちかけの決めたこと', '一覧へ戻る');
});

// ── 人が打っていない欄は保存しない（終わりの見直し A の Important 1）──
// 欄に出した文は、保存してある文と違う形になることがある（CRLF の改行は LF にそろう・8,000 字を超える文は保存するときに切る。
// 前は行の欄が 1 行の欄で、改行が消えていた）。欄にフォーカスして離れるだけでは保存しない
const NL = '理由A\n理由B';
const CRLF = '一行目\r\n二行目';
const LONG = '出張の手順。'.repeat(1335); // 8,010 字
// 6 つの欄 [data-sy, 行の id, 開く札, 設計ノートから読む]
const SIX_FIELDS = [
  ['note-findings', null, 'read', (n) => n.findings],
  ['note-memo', null, 'items', (n) => n.memo],
  ['note-q-text', 'nq-x', 'items', (n) => n.questions[0].text],
  ['note-q-answer', 'nq-x', 'items', (n) => n.questions[0].answer],
  ['note-d-text', 'nd-x', 'items', (n) => n.decisions[0].text],
  ['note-d-reason', 'nd-x', 'items', (n) => n.decisions[0].reason],
];
// 読み取ったこと・メモが text、行の文が row の設計ノート（③ 確認待ち）
const oddNotes = (text, row = text) => ({
  stages: { read: stage('done', at(19, 10, 0)), flow: stage('todo'), items: stage('review'), screens: stage('todo'), docs: stage('todo') },
  findings: text, memo: text,
  decisions: [{ id: 'nd-x', date: '2026-10-19', stage: 'items', text: row, reason: row }],
  questions: [{ id: 'nq-x', date: '2026-10-19', stage: 'items', text: row, answer: row, resolvedAt: at(19, 9, 0) }],
});
const oddState = (notes) => plain({ ...sampleState(), systems: [system('y-trip', '出張申請システム', { notes }), system('y-exp', '経費精算システム')] });

for (const [label, text, row, fields] of [
  ['改行を含む文', NL, NL, SIX_FIELDS],
  ['CRLF の改行を含む文', CRLF, CRLF, SIX_FIELDS],
  ['8,000 字を超える文', LONG, '宿泊費の上限を、役職で変えるか', SIX_FIELDS.slice(0, 2)],
]) {
  test(`人が打っていない欄は保存しない（${label}）: 欄にフォーカスして ② の札を押すだけでは、文も元に戻すの履歴の数も更新日時も変わらない`, async (t) => {
    const { api, field, tab, sys } = await boot(t, { state: oddState(oddNotes(text, row)) });
    for (const [sy, note, open] of fields) {
      click(tab(open));
      const before = JSON.stringify(sys().notes);
      const [u0, t0] = [api.store.undoStack.length, sys().updatedAt];
      field(sy, note).focus();
      click(tab('flow'));
      assert.equal(JSON.stringify(sys().notes), before, sy);
      assert.equal(api.store.undoStack.length, u0, `${sy}: 履歴に積まない`);
      assert.equal(sys().updatedAt, t0, `${sy}: 更新日時を変えない`);
    }
  });
}

test('行の欄（まだ決まっていないことの文と答え・決めたことの文と理由）は改行をそのまま出す。高さは中身に合わせる（field-sizing:content）', async (t) => {
  const { api, field } = await boot(t, { state: oddState(oddNotes('', NL)) });
  for (const [sy, note] of SIX_FIELDS.slice(2)) assert.equal(field(sy, note).value, NL, sy);
  assert.match(api.appStyle(), /\.nt-tbl textarea\{[^}]*field-sizing:content/);
});

test('打って変えた文は保存する。打って保存した後に元の文へ打ち戻すと、元の文を保存する（窓を離れて戻ったときに focusin が出なくても・欄を離れたとき）', async (t) => {
  const { app, api, field, tab, sys } = await boot(t);
  const undo = () => api.store.undoStack.length;
  const fields = [
    ['note-findings', null, 'read', (n) => n.findings],
    ['note-memo', null, 'items', (n) => n.memo],
    ['note-q-text', 'nq-1', 'items', (n) => n.questions.find((q) => q.id === 'nq-1').text],
    ['note-q-answer', 'nq-1', 'items', (n) => n.questions.find((q) => q.id === 'nq-1').answer],
    ['note-d-text', 'nd-3', 'items', (n) => n.decisions.find((d) => d.id === 'nd-3').text],
    ['note-d-reason', 'nd-3', 'items', (n) => n.decisions.find((d) => d.id === 'nd-3').reason],
  ];
  for (const [sy, note, open, read] of fields) {
    click(tab(open));
    const el = field(sy, note);
    el.focus();
    const orig = el.value;
    const u0 = undo();
    el.value = orig + '（直した）';
    app.window.dispatchEvent(new app.window.Event('blur')); // ほかの窓へ移る（打ちかけの文字を保存する。戻っても focusin は出さない）
    assert.equal(read(sys().notes), orig + '（直した）', sy);
    el.value = orig; // 元の文へ打ち戻す
    click(tab('flow'));
    assert.equal(read(sys().notes), orig, `${sy}: 打ち戻した元の文を保存する`);
    assert.equal(undo(), u0 + 2, sy);
  }
  // 欄を離れたとき（change）も同じ
  const memo = field('note-memo');
  memo.focus();
  setValue(memo, 'メモを直した');
  assert.equal(sys().notes.memo, 'メモを直した');
  setValue(memo, 'ベンダーとの打ち合わせは 10/25。');
  assert.equal(sys().notes.memo, 'ベンダーとの打ち合わせは 10/25。', '打ち戻した元の文を保存する');
});

test('描き直してもフォーカスは同じ行の同じ欄に戻る（行の id〔data-note〕で見分ける）。AI が設計ノートを直すと真ん中を描き直す', async (t) => {
  const { app, field, qRows, call } = await boot(t);
  const el = field('note-q-text', 'nq-3');
  el.focus();
  el.setSelectionRange(2, 5);
  ok(await call('update_notes', { system: 'y-trip', ops: [{ op: 'add_question', stage: 'items', text: 'AI が足した問い' }] }));
  assert.deepEqual(qRows().map((r) => r[2]).slice(0, 3), ['宿泊費の上限を、役職で変えるか', '「出張の目的」の欄を、必ず書く欄にするか', 'AI が足した問い'], '真ん中を描き直した');
  const now = app.document.activeElement;
  assert.notEqual(now, el, '作り直した欄');
  assert.deepEqual([now.tagName, now.dataset.sy, now.dataset.note, now.selectionStart, now.selectionEnd], ['TEXTAREA', 'note-q-text', 'nq-3', 2, 5], '行の欄の textarea でも戻る');
  // 答えの欄・理由の欄
  field('note-d-reason', 'nd-3').focus();
  ok(await call('update_notes', { system: 'y-trip', ops: [{ op: 'set_memo', text: 'AI のメモ' }] }));
  assert.deepEqual([app.document.activeElement.dataset.sy, app.document.activeElement.dataset.note], ['note-d-reason', 'nd-3']);
  assert.equal(field('note-memo').value, 'AI のメモ');
});

// ── AI の帯 ──
test('オレンジの帯の「設計ノートを開く」: 開いていないシステムは設計ノートの入口で開き、もう開いていれば入口だけを設計ノートに切り替える', async (t) => {
  const { api, $, call } = await boot(t, { sysId: null });
  api.actions.updateSystem('y-exp', { description: '人の変更' });
  ok(await call('update_notes', { system: 'y-trip', ops: [{ op: 'add_question', stage: 'read', text: '問い' }] }));
  click($('#ai-warn [data-action="ai-open-system-notes"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-trip', 'notes']);
  // もう開いているとき（入口は役割）
  api.openSystemPanel('roles');
  api.aiView.warn = { designId: null, systemId: 'y-trip', name: '出張申請システム', label: 'Claude Code', created: false, openChanged: false, sysNote: '', notesOnly: true };
  api.renderSystem();
  click($('#ai-warn [data-action="ai-open-system-notes"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-trip', 'notes']);
});

test('紫の帯の「開く」: 設計ノートだけを直したときは設計ノートの入口で開く。中身も直したときは今までどおり（前に開いていた入口）', async (t) => {
  const { api, $, call } = await boot(t, { sysId: null });
  ok(await call('set_stage', { system: 'y-trip', stage: 'items', state: 'done' }));
  assert.equal($('#ai-band [data-action="ai-open-system"]'), null);
  const open = $('#ai-band [data-action="ai-open-system-notes"]');
  assert.deepEqual([open.textContent, open.dataset.id], ['開く', 'y-trip']);
  click(open);
  assert.deepEqual([api.ui.view, api.ui.systemId, api.ui.sysPanel], ['system', 'y-trip', 'notes']);
  // 設計ノートを直した後に中身も直した（同じ帯）: 前に開いていた入口で開く
  api.openSystemPanel('roles');
  api.goHome();
  ok(await call('set_stage', { system: 'y-trip', stage: 'screens', state: 'doing' }));
  ok(await call('update_system', { system: 'y-trip', description: 'AI が書いた説明' }));
  assert.equal($('#ai-band [data-action="ai-open-system-notes"]'), null);
  click($('#ai-band [data-action="ai-open-system"]'));
  assert.deepEqual([api.ui.view, api.ui.sysPanel], ['system', 'roles']);
});

// ── 文字の逃がし ──
test('文字は esc() で逃がす（<b> などを書いても要素にならない）', async (t) => {
  const { api, $, $$, field, tab, entries } = await boot(t);
  const tag = '<b>太字</b><img src="x">';
  api.actions.updateSystem('y-trip', { name: '<b>出張</b>システム' });
  api.actions.editNoteQuestion('y-trip', 'nq-1', { text: tag });
  api.actions.answerNoteQuestion('y-trip', 'nq-4', tag);
  api.actions.editNoteDecision('y-trip', 'nd-3', { text: tag, reason: '"引用" & \'記号\'' });
  api.actions.setNoteMemo('y-trip', '</textarea>' + tag);
  api.actions.setNoteFindings('y-trip', '</textarea>' + tag);
  assert.equal($('#sys-view h3').textContent, '設計ノート（<b>出張</b>システム）');
  assert.equal(field('note-q-text', 'nq-1').value, tag);
  assert.equal(field('note-q-answer', 'nq-4').value, tag);
  assert.equal(field('note-d-text', 'nd-3').value, tag);
  assert.equal(field('note-d-reason', 'nd-3').value, '"引用" & \'記号\'');
  assert.equal(field('note-memo').value, '</textarea>' + tag);
  click(tab('read'));
  assert.equal(field('note-findings').value, '</textarea>' + tag);
  assert.equal($$('#sys-view b, #sys-view img, #sys-list b img').length, 0);
  assert.deepEqual(entries()[3].slice(1), ['設計ノート', '③ 確認待ち']);
});
