'use strict';
// 第 9 段階の後半（T5）: システムの資料（materials）のデータと操作のテスト。見た目はまだない（入口・表・窓は T7）。
// 決めごとは AI設計基盤_設計書.md の 5-3（資料の行の形）。資料のファイルを写す・消すのは main の側（materialsAPI）で、ここでは身代わりを使う。
// システムと資料の名前は架空の業務（出張申請・経費精算）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-form', '申請の入力')], mapPos: {}, processPos: {}, flowPos: {},
});
const NO_REF = { designId: null, screenId: null, stateId: null };
const box = (id, x) => ({ id, x, y: 20, w: 100, h: 40 });
// 資料から読んだ BDM の箱（src.material はどの資料から読んだか）。BDM の箱の id は図ごとに e1・e2… と数えるので、別の資料にも同じ id の箱がある
const BDM = 'm-bdm';
const boxOf = (id, x, material) => ({ ...box(id, x), material });
const step = (id, roleId, col, kind, text, extra = {}) => ({ id, roleId, col, kind, text, memo: '', ref: { ...NO_REF }, src: null, ...extra });
const edge = (id, from, to, label = '') => ({ id, from, to, label });
const material = (id, name, kind, file, extra = {}) => ({ id, name, kind, size: 1024, addedAt: OLD, memo: '', file, ...extra });
const system = (id, name, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: [], roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
// 出張申請システム（資料 1 つ・BDM の資料 m-bdm から読んだ作業 2 つと手で足した作業 1 つ。m-bdm の行は、ほかの確かめを短くするため見本の資料の並びから省いた）・経費精算システム（資料なし）・ごみ箱の古いシステム（資料 1 つ）
function sampleState() {
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [design('d-trip', '出張申請')],
    systems: [
      system('y-trip', '出張申請システム', {
        designIds: ['d-trip'],
        roles: [{ id: 'l-app', name: '申請者', memo: '' }, { id: 'l-boss', name: '上長', memo: '課長以上' }, { id: 'l-acc', name: '経理', memo: '' }],
        swimlane: {
          steps: [
            step('w-1', 'l-app', 0, 'start', '始まり', { src: boxOf('n1', 10, BDM) }),
            step('w-2', 'l-app', 1, 'task', '申請を入力する', { ref: { designId: 'd-trip', screenId: 's-form', stateId: null }, src: boxOf('n2', 130, BDM) }),
            step('w-3', 'l-acc', 2, 'task', '手で足した作業'),
          ],
          edges: [edge('e-1', 'w-1', 'w-2'), edge('e-9', 'w-2', 'w-3')],
        },
        materials: [material('m-old', '出張申請書.xlsx', 'excel', 'm-old.xlsx', { memo: '今の様式' })],
      }),
      system('y-exp', '経費精算システム'),
      system('y-gone', '古いシステム', { trashedAt: OLD, materials: [material('m-t', '旧規程.pdf', 'pdf', 'm-t.pdf')] }),
    ],
  };
}

// 資料の窓口（preload.js の materialsAPI）の身代わり。呼ばれた引数を calls に控える（jsdom の中の値は plain で写す）
function fakeMaterialsAPI(over = {}) {
  const calls = { sweep: [], removeSystem: [] };
  const api = {
    available: true,
    pick: async () => ({ ok: false, canceled: true }),
    addDropped: async () => ({ ok: false, canceled: true }),
    read: async () => ({ ok: false, error: { code: 'unavailable', message: '身代わり' } }),
    bdmPlan: async () => ({ ok: false, error: { code: 'unavailable', message: '身代わり' } }),
    sweep: async (keep) => { calls.sweep.push(plain(keep)); return { ok: true, removedFiles: 0, removedDirs: 0 }; },
    removeSystem: async (id) => { calls.removeSystem.push(id); return { ok: true, removed: 0 }; },
    ...over,
  };
  return { api, calls };
}

// storage.js の身代わり（bootApp は ipc だけを使う）。notice を返したり、保存の終わりを手で決めたりする
function fakeStorage(state, { notice = null, saveResult = { ok: true } } = {}) {
  const saves = [];
  return {
    saves,
    ipc: async (ch, json) => {
      if (ch === 'storage:load') return { ok: true, json: JSON.stringify(state), notice };
      return new Promise((resolve) => saves.push({ json, done: () => resolve(saveResult) }));
    },
  };
}

async function boot(t, { state = sampleState(), materialsAPI = null, storage = null } = {}) {
  const app = bootApp(storage ? { storage, materialsAPI } : { localStorage: { [KEY]: JSON.stringify(state) }, materialsAPI });
  t.after(() => app.close());
  const api = await app.api();
  const S = () => api.store.state;
  return {
    app, api, S,
    sys: (id) => S().systems.find((y) => y.id === id),
    $: (sel) => app.document.querySelector(sel),
  };
}

// ── 読み込みの直し ──
test('読み込み: オブジェクトでない行は外し、知らない欄は残す。kind・size・id の重なりを直す。2 回通しても同じ。SCHEMA_VERSION は 3 のまま', async (t) => {
  const { api } = await boot(t);
  assert.equal(api.SCHEMA_VERSION, 3);
  assert.deepEqual(plain(api.MATERIAL_KINDS), ['text', 'image', 'pdf', 'word', 'excel', 'bdm', 'other']);
  assert.deepEqual(plain(api.MATERIAL_KIND_NAMES), { text: '文字', image: '画像', pdf: 'PDF', word: 'Word', excel: 'Excel', bdm: 'MPD', other: 'そのほか' });
  const raw = sampleState();
  raw.systems[0].materials = [
    material('m-1', '出張申請書.xlsx', 'excel', 'm-1.xlsx', { size: 48213, future: { keep: 1 } }),
    'こわれた行', null, 42, ['配列'],
    material('m-1', '旅費規程.pdf', 'pdf', 'm-2.pdf'),
    material('m-3', 'ふしぎ.bin', 'ふしぎ', 'm-3.bin', { size: -5 }),
    { id: 'm-4', name: 5, kind: 'text', size: 12.5, memo: null, file: 7, addedAt: 3 },
    { name: 'id なし.txt', kind: 'text', size: '100', file: 'm-5.txt' },
  ];
  delete raw.systems[1].materials; // 資料の欄のないシステム
  const { state, blockReason } = api.migrate(plain(raw));
  assert.equal(blockReason, null);
  const list = plain(state.systems[0].materials);
  assert.equal(list.length, 5, 'オブジェクトでない行は外す');
  assert.deepEqual(list[0], material('m-1', '出張申請書.xlsx', 'excel', 'm-1.xlsx', { size: 48213, future: { keep: 1 } }), '知らない欄は残す');
  assert.notEqual(list[1].id, 'm-1', '重なった id は後の行を新しい id にする');
  assert.match(list[1].id, /^m-/);
  assert.equal(list[1].name, '旅費規程.pdf');
  assert.equal(list[2].kind, 'other', '知らない種類は「そのほか」');
  assert.equal(list[2].size, 0, '負の大きさは 0');
  assert.deepEqual([list[3].name, list[3].size, list[3].memo, list[3].file, list[3].addedAt], ['', 0, '', '', ''], '文字でない欄は空の文字・整数でない大きさは 0');
  assert.match(list[4].id, /^m-/, 'id のない行に id を付ける');
  assert.equal(list[4].size, 0, '文字の大きさは 0');
  assert.deepEqual(plain(state.systems[1].materials), [], '資料の欄のないシステムは []');
  const again = api.migrate(plain(state)).state;
  assert.deepEqual(plain(again.systems[0].materials), list, '2 回通しても同じ');
  assert.deepEqual(plain(api.normalizeMaterials('こわれた')), [], '並びでなければ []');
  assert.deepEqual(plain(api.createSystemData({ name: '新しいシステム' }).materials), []);
});

test('古い形（.doc・.xls）の資料はファイルの名前の拡張子で見分ける（行に legacy の欄は持たない）', async (t) => {
  const { api } = await boot(t);
  const legacy = (file) => api.isLegacyMaterial({ file });
  assert.deepEqual(['m-1.doc', 'm-1.xls', 'm-1.XLS'].map(legacy), [true, true, true]);
  assert.deepEqual(['m-1.docx', 'm-1.xlsx', 'm-1.pdf', '', 'm-1.doc.txt'].map(legacy), [false, false, false, false, false]);
  assert.equal(api.isLegacyMaterial(null), false);
});

// ── 操作 ──
test('addMaterials: 足した行を返す（legacy は行に入れない）。元に戻す 1 回で全部消え、やり直すで戻る。更新日時が変わる。足すものがなければ何もしない', async (t) => {
  const { api, sys } = await boot(t);
  const undo0 = api.store.undoStack.length;
  const rows = api.actions.addMaterials('y-trip', [
    { id: 'm-a', name: '出張旅費規程.pdf', kind: 'pdf', size: 48213, file: 'm-a.pdf', legacy: false },
    { id: 'm-b', name: '旧様式.xls', kind: 'excel', size: 2048, file: 'm-b.xls', legacy: true },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['addedAt', 'file', 'id', 'kind', 'memo', 'name', 'size']);
  assert.deepEqual({ ...plain(rows[1]), addedAt: 'x' }, { id: 'm-b', name: '旧様式.xls', kind: 'excel', size: 2048, addedAt: 'x', memo: '', file: 'm-b.xls' });
  assert.ok(rows[0].addedAt > OLD, '入れた日時');
  assert.equal(api.isLegacyMaterial(rows[1]), true, '古い形はファイルの名前で分かる');
  assert.deepEqual(plain(sys('y-trip').materials.map((m) => m.id)), ['m-old', 'm-a', 'm-b'], '後ろに足す');
  assert.notEqual(sys('y-trip').updatedAt, OLD, '更新日時が変わる');
  assert.equal(api.store.undoStack.length, undo0 + 1, '1 つの操作＝元に戻す 1 回');
  rows[0].memo = '返した行を書き換えても';
  assert.equal(sys('y-trip').materials[1].memo, '', '中身は変わらない（写しを返す）');
  api.store.undo();
  assert.deepEqual(plain(sys('y-trip').materials.map((m) => m.id)), ['m-old'], '元に戻すで全部消える');
  assert.equal(sys('y-trip').updatedAt, OLD);
  api.store.redo();
  assert.deepEqual(plain(sys('y-trip').materials.map((m) => m.id)), ['m-old', 'm-a', 'm-b'], 'やり直すで戻る');
  const undo1 = api.store.undoStack.length;
  assert.deepEqual(plain(api.actions.addMaterials('y-trip', [])), []);
  assert.deepEqual(plain(api.actions.addMaterials('y-trip', [null, 'こわれた', { id: 'm-x', name: 'ファイルなし.txt', kind: 'text', size: 1 }])), [], 'file のない行は足さない');
  assert.deepEqual(plain(api.actions.addMaterials('y-nai', [{ id: 'm-c', name: 'x.txt', kind: 'text', size: 1, file: 'm-c.txt' }])), []);
  assert.equal(api.store.undoStack.length, undo1, '足すものがなければ履歴に積まない');
});

test('addMaterials: 今ある行と同じ id は新しい id にして足す（返す行も新しい id）', async (t) => {
  const { api, sys } = await boot(t);
  const [row] = api.actions.addMaterials('y-trip', [{ id: 'm-old', name: '出張申請書（新）.xlsx', kind: 'excel', size: 10, file: 'm-old2.xlsx' }]);
  assert.notEqual(row.id, 'm-old');
  assert.equal(sys('y-trip').materials[1].id, row.id);
  assert.equal(sys('y-trip').materials[1].file, 'm-old2.xlsx');
});

test('setMaterialMemo: 前後の空白を取る。同じ文なら履歴に積まず、更新日時も変えない。ない資料は false', async (t) => {
  const { api, sys } = await boot(t);
  const undo0 = api.store.undoStack.length;
  assert.equal(api.actions.setMaterialMemo('y-trip', 'm-old', '  旅費の上限の表がある  '), true);
  assert.equal(sys('y-trip').materials[0].memo, '旅費の上限の表がある');
  assert.equal(api.store.undoStack.length, undo0 + 1);
  const at = sys('y-trip').updatedAt;
  assert.notEqual(at, OLD);
  api.actions.setMaterialMemo('y-trip', 'm-old', '旅費の上限の表がある ');
  assert.equal(api.store.undoStack.length, undo0 + 1, '同じ文なら履歴に積まない');
  assert.equal(sys('y-trip').updatedAt, at, '同じ文なら更新日時を変えない');
  assert.equal(api.actions.setMaterialMemo('y-trip', 'm-nai', 'x'), false);
  assert.equal(api.actions.setMaterialMemo('y-nai', 'm-old', 'x'), false);
  api.store.undo();
  assert.equal(sys('y-trip').materials[0].memo, '今の様式');
});

test('deleteMaterial: 行だけを消す（ファイルは消さない）。元に戻すで行が戻る。ない資料は false', async (t) => {
  const { api, sys } = await boot(t, { materialsAPI: fakeMaterialsAPI().api });
  const before = plain(sys('y-trip').materials);
  assert.equal(api.actions.deleteMaterial('y-trip', 'm-old'), true);
  assert.deepEqual(plain(sys('y-trip').materials), []);
  assert.notEqual(sys('y-trip').updatedAt, OLD);
  api.store.undo();
  assert.deepEqual(plain(sys('y-trip').materials), before, '元に戻すで行が戻る');
  const undo0 = api.store.undoStack.length;
  assert.equal(api.actions.deleteMaterial('y-trip', 'm-nai'), false);
  assert.equal(api.store.undoStack.length, undo0);
});

test('「AI が変更する前の状態」の写し（systemContentOf）に資料は入らない', async (t) => {
  const { api, sys } = await boot(t);
  assert.deepEqual(plain(api.SYSTEM_CONTENT_KEYS), ['name', 'description', 'roles', 'swimlane', 'designIds']);
  assert.equal('materials' in api.systemContentOf(sys('y-trip')), false);
  assert.equal('materials' in api.systemRevisionRow(sys('y-trip'), 'ai').snapshot, false);
});

// ── BDM の案でスイムレーン図を置き換える ──
// 出張申請の流れ（総務は今のシステムにない役割。「上長」は前後に空白、「総務」は 2 回出る。n4 → n-nai は端のない矢印）
const PLAN = {
  diagramType: 'swimlane', diagramName: '出張申請の流れ', orientation: 'horizontal',
  roles: ['  上長 ', '総務', '申請者', '総務'],
  steps: [
    { key: 'n1', role: '申請者', col: 0, kind: 'start', text: '始まり', memo: '', src: box('n1', 10) },
    { key: 'n2', role: '申請者', col: 1, kind: 'input', text: '申請書を書く', memo: '様式あり', src: box('n2', 130) },
    { key: 'n3', role: '上長', col: 2, kind: 'decision', text: '承認する', memo: '', src: box('n3', 250) },
    { key: 'n4', role: '総務', col: 3, kind: 'end', text: '手配する', memo: '', src: box('n4', 370) },
  ],
  edges: [
    { from: 'n1', to: 'n2', label: '' }, { from: 'n2', to: 'n3', label: '' }, { from: 'n3', to: 'n4', label: '承認' },
    { from: 'n3', to: 'n2', label: '差し戻し' }, { from: 'n4', to: 'n-nai', label: '' },
  ],
  warnings: [],
};

test('swimlaneFromPlan: 同じ名前の役割は使い回し、ない役割は後ろに足す（今の並びは変えない）。同じ資料の同じ箱（src.material と src.id）の作業は id と ref が残り、同じ「元 → 先」の矢印は id が残る', async (t) => {
  const { api, sys } = await boot(t);
  const undo0 = api.store.undoStack.length;
  const res = plain(api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: BDM }));
  assert.deepEqual(res, { addedRoles: ['総務'], reusedRoles: ['上長', '申請者'], steps: 4, edges: 4, changed: true });
  const y = plain(sys('y-trip'));
  assert.deepEqual(y.roles.map((r) => r.name), ['申請者', '上長', '経理', '総務'], '今の役割の並びは変えず、後ろに足す');
  assert.deepEqual(y.roles.slice(0, 3).map((r) => r.id), ['l-app', 'l-boss', 'l-acc']);
  assert.equal(y.roles[1].memo, '課長以上', '使い回した役割のメモは残る');
  assert.deepEqual(y.roles[3], { id: y.roles[3].id, name: '総務', memo: '' }, '足す役割の形は addRole と同じ');
  const [w1, w2, w3, w4] = y.swimlane.steps;
  assert.deepEqual([w1.id, w2.id], ['w-1', 'w-2'], 'src.id の同じ作業の id が残る');
  assert.deepEqual(w2, { id: 'w-2', roleId: 'l-app', col: 1, kind: 'input', text: '申請書を書く', memo: '様式あり', ref: { designId: 'd-trip', screenId: 's-form', stateId: null }, src: boxOf('n2', 130, BDM) }, 'ref が残り、ほかは案のとおり（src には資料の id）');
  assert.match(w3.id, /^w-/);
  assert.ok(![w1.id, w2.id].includes(w3.id));
  assert.deepEqual({ ...w3, id: 'x' }, { id: 'x', roleId: 'l-boss', col: 2, kind: 'decision', text: '承認する', memo: '', ref: NO_REF, src: boxOf('n3', 250, BDM) });
  assert.equal(w4.roleId, y.roles[3].id, '足した役割の作業');
  assert.equal(y.swimlane.steps.some((w) => w.id === 'w-3'), false, '案にない作業は消える');
  const pairs = y.swimlane.edges.map((e) => [e.from, e.to, e.label]);
  assert.deepEqual(pairs, [['w-1', 'w-2', ''], ['w-2', w3.id, ''], [w3.id, w4.id, '承認'], [w3.id, 'w-2', '差し戻し']], '端のない矢印は外す');
  assert.equal(y.swimlane.edges[0].id, 'e-1', '同じ「元 → 先」の矢印の id が残る');
  assert.equal(y.swimlane.edges.some((e) => e.id === 'e-9'), false, '案にない矢印は消える');
  assert.notEqual(y.updatedAt, OLD);
  assert.equal(api.store.undoStack.length, undo0 + 1, '1 つの操作＝元に戻す 1 回');
});

test('swimlaneFromPlan: 同じ案を 2 回入れると 2 回目は changed:false（履歴に積まず、更新日時も変えない）。1 回の元に戻すで役割もスイムレーンも全部戻る', async (t) => {
  const { api, sys } = await boot(t);
  const before = plain(sys('y-trip'));
  api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: BDM });
  const after1 = plain(sys('y-trip'));
  const undo1 = api.store.undoStack.length;
  const res = plain(api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: BDM }));
  assert.deepEqual(res, { addedRoles: [], reusedRoles: ['上長', '総務', '申請者'], steps: 4, edges: 4, changed: false });
  assert.deepEqual(plain(sys('y-trip')), after1, '中身も更新日時も同じ');
  assert.equal(api.store.undoStack.length, undo1, '2 回目は履歴に積まない');
  api.store.undo();
  assert.deepEqual(plain(sys('y-trip')), before, '1 回の元に戻すで全部戻る');
});

test('swimlaneFromPlan: 別の資料の案（同じ key の箱）や、資料の id のない案では、今の作業の id と ref を残さない（src.material に資料の id か null）', async (t) => {
  const { api, sys } = await boot(t);
  const fresh = (y) => y.swimlane.steps.every((w) => !['w-1', 'w-2', 'w-3'].includes(w.id)) && y.swimlane.edges.every((e) => !['e-1', 'e-9'].includes(e.id));
  // 別の BDM の資料（m-new）にも n1・n2 の箱がある
  api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: 'm-new' });
  let y = plain(sys('y-trip'));
  assert.ok(fresh(y), '別の資料の案では、同じ key の作業でも id を残さない（矢印も新しい id）');
  assert.deepEqual(y.swimlane.steps[1].ref, NO_REF, '前の作業の画面へのつながりを受け継がない');
  assert.deepEqual(y.swimlane.steps.map((w) => w.src.material), ['m-new', 'm-new', 'm-new', 'm-new']);
  // 同じ資料（m-new）を読み直すと、こんどは id が残る
  const ids = y.swimlane.steps.map((w) => w.id);
  assert.equal(plain(api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: 'm-new' })).changed, false);
  assert.deepEqual(plain(sys('y-trip').swimlane.steps.map((w) => w.id)), ids);
  // 資料の id のない案は、同じ key でも残さない（src.material は null）
  api.store.undo();
  api.actions.swimlaneFromPlan('y-trip', plain(PLAN), null);
  y = plain(sys('y-trip'));
  assert.ok(fresh(y), '資料の id のない案では id を残さない');
  assert.deepEqual(y.swimlane.steps[1].ref, NO_REF);
  assert.deepEqual(y.swimlane.steps.map((w) => w.src.material), [null, null, null, null]);
});

test('swimlaneFromPlan: 作業の src.material は、読み込み（2 回通す）と「AI が変更する前の状態」の写しの直しでも残る', async (t) => {
  const { api } = await boot(t);
  api.actions.swimlaneFromPlan('y-trip', plain(PLAN), { materialId: BDM });
  const once = api.migrate(plain(api.store.state)).state;
  const twice = api.migrate(plain(once)).state;
  const srcOf = (state) => plain(state.systems.find((y) => y.id === 'y-trip').swimlane.steps.map((w) => w.src));
  assert.deepEqual(srcOf(twice), [boxOf('n1', 10, BDM), boxOf('n2', 130, BDM), boxOf('n3', 250, BDM), boxOf('n4', 370, BDM)]);
  assert.deepEqual(srcOf(twice), srcOf(once));
  const snap = api.systemContentFrom(plain(api.systemContentOf(twice.systems.find((y) => y.id === 'y-trip'))));
  assert.deepEqual(plain(snap.swimlane.steps.map((w) => w.src.material)), [BDM, BDM, BDM, BDM]);
});

test('swimlaneFromPlan: 列のない作業は矢印の順で列を付ける。案の役割にない作業の役割も足す。案の形が違うときは null', async (t) => {
  const { api, sys } = await boot(t);
  const plan = {
    roles: ['申請者'],
    steps: [
      { key: 'a', role: '申請者', col: 0, kind: 'start', text: '始まり', memo: '', src: box('a', 0) },
      { key: 'b', role: '（レーンなし）', kind: 'ふしぎ', text: '列のない作業', memo: '', src: box('b', 0) },
    ],
    edges: [{ from: 'a', to: 'b', label: '' }],
  };
  const res = plain(api.actions.swimlaneFromPlan('y-trip', plan));
  assert.deepEqual(res.addedRoles, ['（レーンなし）']);
  const [a, b] = plain(sys('y-trip').swimlane.steps);
  assert.equal(a.col, 0);
  assert.equal(b.col, 1, '前の作業の次の列');
  assert.equal(b.kind, 'task', '知らない種類は「作業」');
  const undo0 = api.store.undoStack.length;
  assert.equal(api.actions.swimlaneFromPlan('y-trip', null), null);
  assert.equal(api.actions.swimlaneFromPlan('y-trip', { roles: [], steps: 'こわれた' }), null);
  assert.equal(api.actions.swimlaneFromPlan('y-nai', plain(PLAN)), null);
  assert.equal(api.store.undoStack.length, undo0);
});

// ── 起動時の掃除 ──
test('起動時の掃除: 窓口があれば、ごみ箱のシステムも含めて資料の行のファイルを keep にして sweep を呼ぶ（資料のないシステムは []）', async (t) => {
  const { api, calls } = fakeMaterialsAPI();
  await boot(t, { materialsAPI: api });
  await waitFor(() => calls.sweep.length, { label: 'sweep' });
  assert.deepEqual(calls.sweep, [{ 'y-trip': ['m-old.xlsx'], 'y-exp': [], 'y-gone': ['m-t.pdf'] }]);
});

test('起動時の掃除: 保存を止めたとき（版 99 の保存データ）・知らせ（notice）があるとき・窓口がないときは呼ばない', async (t) => {
  const blocked = fakeMaterialsAPI();
  const b = await boot(t, { state: { ...sampleState(), schemaVersion: 99 }, materialsAPI: blocked.api });
  assert.ok(b.api.store.blockReason, '版 99 は保存を止める');
  const noticed = fakeMaterialsAPI();
  await boot(t, { storage: fakeStorage(sampleState(), { notice: '前の保存から戻しました。' }), materialsAPI: noticed.api });
  const none = await boot(t);
  assert.equal(none.app.window.materialsAPI, undefined);
  await tick();
  await tick();
  assert.equal(blocked.calls.sweep.length, 0, 'blockReason のときは呼ばない');
  assert.equal(noticed.calls.sweep.length, 0, 'notice のときは呼ばない');
});

test('起動時の掃除: 失敗しても起動は止めず、console.warn だけ（console.error にしない）', async (t) => {
  let fail = null;
  const { api } = fakeMaterialsAPI({ sweep: () => new Promise((_, reject) => { fail = reject; }) });
  const { app, api: page } = await boot(t, { materialsAPI: api });
  await waitFor(() => fail, { label: 'sweep' });
  const warns = [];
  app.window.console.warn = (...args) => warns.push(args.map(String).join(' '));
  fail(new Error('フォルダを開けません'));
  await waitFor(() => warns.length, { label: 'console.warn' });
  assert.match(warns[0], /資料のファイル/);
  assert.equal(page.store.blockReason, null);
  const bad = fakeMaterialsAPI({ sweep: async () => ({ ok: false, error: { code: 'unavailable', message: '使えません' } }) });
  await boot(t, { materialsAPI: bad.api }); // ok:false の返事も console.warn だけ（close で console.error がないことを確かめる）
});

// ── 完全に削除 ──
async function openDeleteForever(ctx, id) {
  click(ctx.$('.trash-toggle'));
  click(ctx.$(`.trash-row.sys [data-action="delete-system-forever"][data-id="${id}"]`));
  await waitFor(() => ctx.$('.modal'), { label: '確かめの窓' });
  return ctx.$('.modal-body').textContent.trim();
}

test('完全に削除: 確かめの窓で資料のファイルの数を知らせ、保存が済んでから removeSystem を呼ぶ', async (t) => {
  const storage = fakeStorage(sampleState());
  const { api, calls } = fakeMaterialsAPI();
  const ctx = await boot(t, { storage, materialsAPI: api });
  const text = await openDeleteForever(ctx, 'y-gone');
  assert.equal(text, '「古いシステム」を完全に削除します。システムの役割とスイムレーン図が消えます。資料のファイル（1 つ）も消えます。'
    + '入っていた画面設計は消えません。元に戻せません（元に戻す〔Ctrl+Z〕の履歴も消えます）。');
  const saves0 = storage.saves.length;
  click(ctx.$('[data-dlg="ok"]'));
  await waitFor(() => !ctx.sys('y-gone') && storage.saves.length > saves0, { label: '完全に削除の保存' });
  await tick();
  assert.deepEqual(calls.removeSystem, [], '保存が済むまでは呼ばない');
  storage.saves.forEach((s) => s.done());
  await waitFor(() => calls.removeSystem.length, { label: 'removeSystem' });
  assert.deepEqual(calls.removeSystem, ['y-gone']);
});

test('完全に削除: 資料のないシステムの窓には資料の文を出さない（removeSystem は呼ぶ）。保存に失敗したときは呼ばない', async (t) => {
  const storage = fakeStorage(sampleState());
  const { api, calls } = fakeMaterialsAPI();
  const ctx = await boot(t, { storage, materialsAPI: api });
  ctx.api.actions.trashSystem('y-exp');
  storage.saves.forEach((s) => s.done());
  const text = await openDeleteForever(ctx, 'y-exp');
  assert.doesNotMatch(text, /資料/);
  click(ctx.$('[data-dlg="ok"]'));
  await waitFor(() => !ctx.sys('y-exp'), { label: '完全に削除' });
  storage.saves.forEach((s) => s.done());
  await waitFor(() => calls.removeSystem.length, { label: 'removeSystem' });
  assert.deepEqual(calls.removeSystem, ['y-exp']);

  const failing = fakeStorage(sampleState(), { saveResult: { ok: false, error: '書き込めません' } });
  const f = fakeMaterialsAPI();
  const ctx2 = await boot(t, { storage: failing, materialsAPI: f.api });
  await openDeleteForever(ctx2, 'y-gone');
  click(ctx2.$('[data-dlg="ok"]'));
  await waitFor(() => !ctx2.sys('y-gone') && failing.saves.length, { label: '完全に削除' });
  const warns = [];
  ctx2.app.window.console.warn = (...args) => warns.push(args.map(String).join(' '));
  failing.saves.forEach((s) => s.done());
  await waitFor(() => warns.length, { label: 'console.warn' });
  assert.deepEqual(f.calls.removeSystem, [], '保存に失敗したときは資料のファイルを消さない');
  ctx2.app.errors.length = 0; // 保存の失敗（console.error と赤い帯）は、この確かめの外
});

test('完全に削除: 窓口がないとき（ブラウザで開いたとき）は資料の文を出さず、何も呼ばない。removeSystem の失敗は console.warn だけ', async (t) => {
  const ctx = await boot(t);
  const text = await openDeleteForever(ctx, 'y-gone');
  assert.doesNotMatch(text, /資料/, '窓口がなければ資料の行があっても出さない');
  click(ctx.$('[data-dlg="ok"]'));
  await waitFor(() => !ctx.sys('y-gone'), { label: '完全に削除' });

  const { api } = fakeMaterialsAPI({ removeSystem: async () => { throw new Error('消せません'); } });
  const ctx2 = await boot(t, { materialsAPI: api });
  const warns = [];
  ctx2.app.window.console.warn = (...args) => warns.push(args.map(String).join(' '));
  await openDeleteForever(ctx2, 'y-gone');
  click(ctx2.$('[data-dlg="ok"]'));
  await waitFor(() => warns.length, { label: 'console.warn' });
  assert.match(warns[0], /資料のファイル/);
});
