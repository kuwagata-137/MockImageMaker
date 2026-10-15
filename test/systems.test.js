'use strict';
// 第 9 段階の前半（T1）: システム（いくつかの画面設計をまとめる入れ物）のデータと操作のテスト。見た目はまだない。
// 決めごとは AI設計基盤_設計書.md の 5-3（システムの形）と 5-6（共通の画面設計〔案B〕の扱い）。
// 画面設計とシステムの名前は架空の業務（出張申請・経費精算・社員マスタ）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const design = (id, name, extra = {}) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-' + id, '一覧')], mapPos: {}, processPos: {}, flowPos: {}, ...extra,
});
const NO_REF = { designId: null, screenId: null, stateId: null };
const step = (id, roleId, col, kind, text, ref = NO_REF) => ({ id, roleId, col, kind, text, memo: '', ref: { ...ref }, src: null });
const edge = (id, from, to, label = '') => ({ id, from, to, label });
const system = (id, name, designIds, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds, roles: [], swimlane: { steps: [], edges: [] }, materials: [], notes: {}, ...extra,
});
// 出張申請システム（出張申請・社員マスタ）と経費精算システム（社員マスタ）。社員マスタは 2 つのシステムで使う共通の画面設計
function sampleState() {
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d-trip', '出張申請', {
        screens: [screen('s-list', '一覧'), screen('s-form', '申請の入力')],
        items: [{ id: 'i-st', name: 'ステータス', type: 'status', required: false, memo: '', lookup: null, link: null,
          props: { states: [{ id: 't-a', name: '申請' }, { id: 't-b', name: '承認待ち' }, { id: 't-c', name: '完了' }], actions: [] } }],
      }),
      design('d-emp', '社員マスタ'),
    ],
    systems: [
      system('y-trip', '出張申請システム', ['d-trip', 'd-emp'], {
        roles: [{ id: 'l-app', name: '申請者', memo: '' }, { id: 'l-boss', name: '上長', memo: '' }],
        swimlane: {
          steps: [
            step('w-1', 'l-app', 0, 'start', '始まり'),
            step('w-2', 'l-app', 1, 'input', '申請を入力する', { designId: 'd-trip', screenId: 's-form', stateId: 't-a' }),
            step('w-3', 'l-boss', 2, 'decision', '承認する', { designId: 'd-trip', screenId: 's-list', stateId: 't-b' }),
            step('w-4', 'l-app', 3, 'end', '終わり'),
          ],
          edges: [edge('e-1', 'w-1', 'w-2'), edge('e-2', 'w-2', 'w-3'), edge('e-3', 'w-3', 'w-4', '承認'), edge('e-4', 'w-3', 'w-2', '差し戻し')],
        },
      }),
      system('y-exp', '経費精算システム', ['d-emp'], {
        roles: [{ id: 'l-app', name: '申請者', memo: '' }],
        swimlane: {
          steps: [
            step('w-1', 'l-app', 0, 'task', '社員を選ぶ', { designId: 'd-emp', screenId: 's-d-emp', stateId: null }),
            // 別の画面設計の、同じ id の画面・ステータスを指す作業（出張申請の画面やステータスを消しても外れない）
            step('w-2', 'l-app', 1, 'task', '名前の同じ id を指す', { designId: 'd-emp', screenId: 's-form', stateId: 't-b' }),
          ],
          edges: [edge('e-1', 'w-1', 'w-2')],
        },
      }),
    ],
  };
}

async function boot(t, state = null) {
  const app = bootApp(state ? { localStorage: { [KEY]: JSON.stringify(state) } } : {});
  t.after(() => app.close());
  const api = await app.api();
  const S = () => api.store.state;
  return {
    app, api, S,
    sys: (id) => S().systems.find((y) => y.id === id),
    d: (id) => S().designs.find((x) => x.id === id),
    stepOf: (sysId, stepId) => S().systems.find((y) => y.id === sysId).swimlane.steps.find((w) => w.id === stepId),
  };
}
const ids = (list) => plain(list.map((x) => x.id));

// ── 読み込みの直し ──
test('読み込みの直し: 足りない欄を補い、知らない欄は残す。id の重なりを直し、端のない矢印と自分への矢印を外す。2 回通しても同じ', async (t) => {
  const { api } = await boot(t);
  const raw = {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [design('d-trip', '出張申請'), design('d-exp', '経費精算'), design('d-emp', '社員マスタ', { trashedAt: OLD })],
    systems: [
      {
        id: 'y-trip', name: '  出張申請   システム ', createdAt: OLD, future: { keep: 1 },
        designIds: ['d-trip', 'd-trip', 'd-nai', 42, 'd-emp'],
        roles: [{ id: 'l-a', name: '申請者' }, { id: 'l-a', name: '上長', memo: '課長以上', color: 'blue' }, 'こわれた役割'],
        swimlane: {
          steps: [
            { id: 'w-1', roleId: 'l-a', col: 0, kind: 'start', text: '始まり' },
            { id: 'w-2', roleId: 'l-a', col: '2', kind: 'ふしぎ', text: '申請書を書く', ref: { designId: 'd-trip', screenId: 's-d-trip', extra: 'x' }, src: { id: 'bdm-1', x: 1, y: 2, w: 3, h: 4 } },
            { id: 'w-2', roleId: 'l-nai', col: -3, kind: 'task', text: '役割の見つからない作業', ref: 'こわれた' },
            { roleId: 'l-a', col: 1.6, text: 'id のない作業', src: 'こわれた', memo: 5 },
            'こわれた作業',
          ],
          edges: [
            { id: 'e-1', from: 'w-1', to: 'w-2', label: '' },
            { id: 'e-1', from: 'w-2', to: 'w-1', label: '差し戻し' },
            { id: 'e-3', from: 'w-1', to: 'w-nai' },
            { id: 'e-4', from: 'w-1', to: 'w-1' },
            'こわれた矢印',
          ],
          lanesHint: 'のこす',
        },
      },
      { id: 'y-trip', name: '' },
      'こわれたシステム',
    ],
  };
  const { state, blockReason } = api.migrate(plain(raw));
  assert.equal(blockReason, null);
  assert.equal(state.systems.length, 2, 'オブジェクトでないシステムは外す');
  const [y, y2] = state.systems;
  assert.equal(y.id, 'y-trip');
  assert.equal(y.name, '出張申請 システム', '名前は前後の空白を取り、続く空白を 1 つにする');
  assert.deepEqual(plain([y.description, y.createdAt, y.updatedAt, y.trashedAt]), ['', OLD, OLD, null], '更新日時がなければ作った日時');
  assert.deepEqual(plain(y.future), { keep: 1 }, '知らない欄は残す');
  assert.deepEqual(plain(y.designIds), ['d-trip', 'd-emp'], '文字だけ・重なりなし・ある画面設計（ごみ箱のものも）だけ');
  // 役割
  assert.equal(y.roles.length, 2);
  assert.deepEqual(plain(y.roles[0]), { id: 'l-a', name: '申請者', memo: '' });
  assert.match(y.roles[1].id, /^l-/);
  assert.notEqual(y.roles[1].id, 'l-a', '重なった id は付け直す');
  assert.deepEqual(plain([y.roles[1].name, y.roles[1].memo, y.roles[1].color]), ['上長', '課長以上', 'blue']);
  // 作業
  const steps = y.swimlane.steps;
  assert.equal(steps.length, 4);
  assert.deepEqual(plain(steps[0]), { id: 'w-1', roleId: 'l-a', col: 0, kind: 'start', text: '始まり', memo: '', ref: NO_REF, src: null });
  assert.deepEqual(plain([steps[1].kind, steps[1].col]), ['task', 2], '知らない種類は「作業」、列は数に直す');
  assert.deepEqual(plain(steps[1].ref), { designId: 'd-trip', screenId: 's-d-trip', stateId: null, extra: 'x' });
  assert.deepEqual(plain(steps[1].src), { id: 'bdm-1', x: 1, y: 2, w: 3, h: 4 });
  assert.match(steps[2].id, /^w-/);
  assert.notEqual(steps[2].id, 'w-2');
  assert.deepEqual(plain([steps[2].roleId, steps[2].col, steps[2].ref]), ['l-nai', 0, NO_REF], '役割が見つからない作業も消さずに残す');
  assert.match(steps[3].id, /^w-/);
  assert.deepEqual(plain([steps[3].col, steps[3].kind, steps[3].memo, steps[3].src]), [2, 'task', '', null]);
  // 矢印
  assert.deepEqual(plain(y.swimlane.edges.map((e) => [e.from, e.to, e.label])), [['w-1', 'w-2', ''], ['w-2', 'w-1', '差し戻し']]);
  assert.equal(y.swimlane.edges[0].id, 'e-1');
  assert.match(y.swimlane.edges[1].id, /^e-/);
  assert.notEqual(y.swimlane.edges[1].id, 'e-1');
  assert.equal(y.swimlane.lanesHint, 'のこす');
  assert.deepEqual(plain([y.materials, y.notes]), [[], {}]);
  // 2 つ目（id が重なる・ほとんど空）
  assert.match(y2.id, /^y-/);
  assert.notEqual(y2.id, 'y-trip');
  assert.deepEqual(plain({ ...y2, id: '' }), {
    id: '', name: '名前なし', description: '', createdAt: null, updatedAt: null, trashedAt: null,
    designIds: [], roles: [], swimlane: { steps: [], edges: [] }, materials: [], notes: {}, revisions: [],
  });
  assert.deepEqual(plain(api.migrate(plain(state)).state), plain(state), '2 回通しても同じ');
});

// ── システムを作る・同じ画面設計を 2 つのシステムに入れる（案B）──
test('システムを作り、同じ画面設計を 2 つのシステムに入れる: データは 1 件で、どちらから見ても同じもの。もう入っていれば何もしない', async (t) => {
  const { app, api, S, sys } = await boot(t);
  assert.equal(api.actions.createSystem({ name: '   ' }), null, '名前のないシステムは作らない');
  const trip = api.actions.createSystem({ name: ' 出張申請システム ', description: '出張の申請と精算をまとめる' });
  const exp = api.actions.createSystem({ name: '経費精算システム' });
  assert.match(trip, /^y-/);
  const y = sys(trip);
  assert.equal(typeof y.createdAt, 'string');
  assert.deepEqual(plain({ ...y, id: '', createdAt: '', updatedAt: '' }), {
    id: '', name: '出張申請システム', description: '出張の申請と精算をまとめる', createdAt: '', updatedAt: '', trashedAt: null,
    designIds: [], roles: [], swimlane: { steps: [], edges: [] }, materials: [], notes: {}, revisions: [],
  });
  assert.equal(y.updatedAt, y.createdAt);
  const emp = api.actions.createDesign('社員マスタ', 'kintone');
  assert.deepEqual(ids(api.loneDesigns(S())), [emp], 'まだどのシステムにも入っていない');
  assert.equal(api.actions.addDesignToSystem(trip, emp), true);
  assert.equal(api.actions.addDesignToSystem(exp, emp), true);
  assert.equal(S().designs.length, 1, 'データは 1 件');
  assert.equal(api.designsOfSystem(S(), sys(trip))[0], api.designsOfSystem(S(), sys(exp))[0], 'どちらのシステムからも同じもの');
  api.actions.renameDesign(emp, '社員マスタ（全社）');
  assert.equal(api.designsOfSystem(S(), sys(exp))[0].name, '社員マスタ（全社）', '直すと、どちらのシステムでも変わる');
  assert.deepEqual(plain(api.systemsOf(S(), emp).map((x) => x.name)), ['出張申請システム', '経費精算システム']);
  assert.equal(api.findSystem(S(), exp), sys(exp));
  assert.equal(api.findSystem(S(), 'y-nai'), null);
  assert.deepEqual(ids(api.loneDesigns(S())), []);
  const undos = api.store.undoStack.length;
  assert.equal(api.actions.addDesignToSystem(trip, emp), false, 'もう入っていれば何もしない');
  assert.equal(api.store.undoStack.length, undos, '履歴に積まない');
  assert.equal(api.actions.addDesignToSystem('y-nai', emp), false);
  assert.equal(api.actions.addDesignToSystem(trip, 'd-nai'), false);
  // 保存される
  const saved = JSON.parse(app.window.localStorage.getItem(KEY));
  assert.deepEqual(saved.systems.map((x) => [x.name, x.designIds]), [['出張申請システム', [emp]], ['経費精算システム', [emp]]]);
});

test('システムから外す・並べ替える: 外しても画面設計は残る。並べ替えの位置は、ごみ箱の画面設計を除いた並びでの、動かした後の位置', async (t) => {
  const { api, S, sys, d } = await boot(t);
  const y = api.actions.createSystem({ name: '出張申請システム' });
  const [a, b, c, e] = ['出張申請', '社員マスタ', '経費精算', '承認の一覧'].map((n) => api.actions.createDesign(n, 'kintone'));
  [a, b, c, e].forEach((id) => api.actions.addDesignToSystem(y, id));
  assert.equal(api.actions.moveDesignInSystem(y, e, 1), true);
  assert.deepEqual(plain(sys(y).designIds), [a, e, b, c]);
  assert.equal(api.actions.moveDesignInSystem(y, e, 1), false, '動かないときは何もしない');
  assert.equal(api.actions.moveDesignInSystem(y, e, 4), false, '並びの外へは動かせない');
  api.actions.trashDesign(b);
  assert.deepEqual(ids(api.designsOfSystem(S(), sys(y))), [a, e, c]);
  assert.equal(api.actions.moveDesignInSystem(y, b, 0), false, 'ごみ箱の画面設計は動かせない');
  assert.equal(api.actions.moveDesignInSystem(y, c, 0), true);
  assert.deepEqual(ids(api.designsOfSystem(S(), sys(y))), [c, a, e]);
  assert.deepEqual(plain(sys(y).designIds), [c, a, b, e], 'ごみ箱の画面設計は、もとの場所のまま');
  assert.equal(api.actions.removeDesignFromSystem(y, a), true);
  assert.deepEqual(plain(sys(y).designIds), [c, b, e]);
  assert.ok(d(a), '画面設計は残る');
  assert.deepEqual(ids(api.loneDesigns(S())), [a]);
  assert.equal(api.actions.removeDesignFromSystem(y, a), false, '入っていなければ何もしない');
});

// ── 複製して入れる ──
test('今ある画面設計を複製して入れる: 別の id の新しい画面設計で、そのシステムにだけ入る。作る・複製するときにシステムを渡せる', async (t) => {
  const { api, S, sys, d } = await boot(t);
  const trip = api.actions.createSystem({ name: '出張申請システム' });
  const exp = api.actions.createSystem({ name: '経費精算システム' });
  const a = api.actions.createDesign('出張申請', 'kintone');
  api.actions.addDesignToSystem(trip, a);
  api.actions.addDesignToSystem(exp, a);
  const copy = api.actions.copyDesignIntoSystem(trip, a);
  assert.match(copy, /^d-/);
  assert.notEqual(copy, a);
  assert.equal(d(copy).name, '出張申請 のコピー');
  assert.deepEqual(plain(sys(trip).designIds), [a, copy]);
  assert.deepEqual(plain(sys(exp).designIds), [a], 'ほかのシステムには入らない');
  api.store.undo();
  assert.equal(d(copy), undefined, '元に戻す 1 回で、複製もシステムへ入れたのも戻る');
  assert.deepEqual(plain(sys(trip).designIds), [a]);
  assert.equal(api.actions.copyDesignIntoSystem('y-nai', a), null);
  assert.equal(api.actions.copyDesignIntoSystem(trip, 'd-nai'), null);
  const c2 = api.actions.duplicateDesign(a, { systemId: exp });
  assert.deepEqual(plain(sys(exp).designIds), [a, c2]);
  const c3 = api.actions.duplicateDesign(a);
  assert.deepEqual(ids(api.systemsOf(S(), c3)), [], 'システムを渡さなければ、どのシステムにも入れない');
  assert.deepEqual(ids(api.loneDesigns(S())), [c3]);
  const n = api.actions.createDesign('精算の入力', 'kintone', { systemId: trip });
  assert.deepEqual(plain(sys(trip).designIds), [a, n]);
  const count = S().designs.length;
  assert.equal(api.actions.createDesign('ないシステム', 'kintone', { systemId: 'y-nai' }), null, 'ないシステムを渡したときは作らない');
  assert.equal(api.actions.duplicateDesign(a, { systemId: 'y-nai' }), null);
  assert.equal(S().designs.length, count);
});

// ── ごみ箱・完全に削除 ──
test('ごみ箱: 画面設計をごみ箱へ移してもシステムからは外さず、戻すと元のシステムに戻る。ごみ箱のシステムは数えない', async (t) => {
  const { api, S, sys } = await boot(t, sampleState());
  api.actions.trashDesign('d-emp');
  assert.deepEqual(plain(sys('y-trip').designIds), ['d-trip', 'd-emp'], 'designIds からは外さない');
  assert.deepEqual(ids(api.designsOfSystem(S(), sys('y-trip'))), ['d-trip'], 'ごみ箱の画面設計は出さない');
  assert.deepEqual(ids(api.designsOfSystem(S(), 'y-exp')), []);
  assert.deepEqual(ids(api.loneDesigns(S())), [], 'ごみ箱の画面設計は「システムに入っていない」にも出さない');
  api.actions.restoreDesign('d-emp');
  assert.deepEqual(ids(api.designsOfSystem(S(), sys('y-exp'))), ['d-emp'], '戻すと元のシステムに戻る');
  assert.equal(api.actions.trashSystem('y-exp'), true);
  assert.equal(sys('y-exp').updatedAt, OLD, 'ごみ箱へ移しても更新日時は変えない');
  assert.equal(typeof sys('y-exp').trashedAt, 'string');
  assert.deepEqual(ids(api.systemsOf(S(), 'd-emp')), ['y-trip'], 'ごみ箱のシステムは除く');
  api.actions.trashSystem('y-trip');
  assert.deepEqual(ids(api.loneDesigns(S())), ['d-trip', 'd-emp'], 'ごみ箱のシステムにだけ入っている画面設計は「システムに入っていない」に出る');
  assert.equal(api.actions.restoreSystem('y-trip'), true);
  assert.equal(sys('y-trip').trashedAt, null);
  assert.equal(sys('y-trip').updatedAt, OLD);
  assert.deepEqual(ids(api.loneDesigns(S())), []);
});

test('画面設計を完全に削除すると、全部のシステムから外れ、作業の指す先も外れる（作業の文は残る。システムの更新日時は変えない）', async (t) => {
  const { api, sys, stepOf } = await boot(t, sampleState());
  api.actions.deleteDesignForever('d-emp');
  assert.deepEqual(plain(sys('y-trip').designIds), ['d-trip']);
  assert.deepEqual(plain(sys('y-exp').designIds), []);
  assert.deepEqual(plain(stepOf('y-exp', 'w-1').ref), NO_REF);
  assert.equal(stepOf('y-exp', 'w-1').text, '社員を選ぶ');
  assert.deepEqual(plain(stepOf('y-exp', 'w-2').ref), NO_REF);
  assert.deepEqual(plain(stepOf('y-trip', 'w-2').ref), { designId: 'd-trip', screenId: 's-form', stateId: 't-a' }, 'ほかの画面設計を指す作業はそのまま');
  assert.deepEqual(plain([sys('y-trip').updatedAt, sys('y-exp').updatedAt]), [OLD, OLD]);
});

test('システムを完全に削除しても、画面設計は残る（ほかのシステムか「システムに入っていない」に出る）', async (t) => {
  const { api, S, d } = await boot(t, sampleState());
  assert.equal(api.actions.deleteSystemForever('y-trip'), true);
  assert.deepEqual(ids(S().systems), ['y-exp']);
  assert.ok(d('d-trip') && d('d-emp'));
  assert.deepEqual(ids(api.loneDesigns(S())), ['d-trip']);
  assert.deepEqual(ids(api.systemsOf(S(), 'd-emp')), ['y-exp']);
  assert.equal(api.store.canUndo(), false, '完全に削除は戻せない（元に戻すの履歴も消す）');
  assert.equal(api.actions.deleteSystemForever('y-trip'), false);
});

// ── 役割 ──
test('役割を消すと、その役割の作業と、その作業につながる矢印も消える。元に戻す 1 回で全部戻る', async (t) => {
  const { api, S, sys } = await boot(t, sampleState());
  const before = plain(sys('y-trip'));
  assert.equal(api.actions.deleteRole('y-trip', 'l-boss'), true);
  assert.deepEqual(ids(sys('y-trip').roles), ['l-app']);
  assert.deepEqual(ids(sys('y-trip').swimlane.steps), ['w-1', 'w-2', 'w-4']);
  assert.deepEqual(ids(sys('y-trip').swimlane.edges), ['e-1']);
  assert.notEqual(sys('y-trip').updatedAt, OLD);
  assert.deepEqual(plain(S().systems.find((y) => y.id === 'y-exp').roles.map((r) => r.id)), ['l-app'], 'ほかのシステムは変わらない');
  api.store.undo();
  assert.deepEqual(plain(sys('y-trip')), before);
  assert.equal(api.actions.deleteRole('y-trip', 'l-nai'), false);
});

test('役割の名前は空にしない・同じシステムの中で同じ名前にしない。足す・名前を変える・並べ替える', async (t) => {
  const { api, sys } = await boot(t, sampleState());
  const undos = api.store.undoStack.length;
  assert.equal(api.actions.addRole('y-trip', '申請者'), null, '同じ名前は作れない');
  assert.equal(api.actions.addRole('y-trip', '   '), null, '空の名前は作れない');
  assert.equal(api.actions.addRole('y-nai', '経理'), null);
  assert.equal(api.store.undoStack.length, undos);
  const acc = api.actions.addRole('y-trip', ' 経理 ');
  assert.match(acc, /^l-/);
  assert.deepEqual(plain(sys('y-trip').roles.at(-1)), { id: acc, name: '経理', memo: '' });
  assert.match(api.actions.addRole('y-exp', '上長'), /^l-/, 'ほかのシステムにある名前なら作れる');
  assert.equal(api.actions.renameRole('y-trip', 'l-boss', '申請者'), false);
  assert.equal(api.actions.renameRole('y-trip', 'l-boss', ''), false);
  assert.equal(api.actions.renameRole('y-trip', 'l-nai', '課長'), false);
  assert.equal(api.actions.renameRole('y-trip', 'l-boss', ' 課長 '), true);
  assert.equal(sys('y-trip').roles[1].name, '課長');
  assert.equal(api.actions.moveRole('y-trip', acc, 0), true);
  assert.deepEqual(ids(sys('y-trip').roles), [acc, 'l-app', 'l-boss']);
  assert.equal(api.actions.moveRole('y-trip', acc, 0), false, '動かないときは何もしない');
  assert.equal(api.actions.moveRole('y-trip', acc, 3), false);
});

// ── 画面とステータスを消したとき ──
test('画面を消すと作業の screenId が、ステータスを消すと作業の stateId が外れる（同じ画面設計を指す作業だけ）', async (t) => {
  const { api, stepOf } = await boot(t, sampleState());
  assert.equal(api.actions.deleteScreen('d-trip', 's-form'), true);
  assert.deepEqual(plain(stepOf('y-trip', 'w-2').ref), { designId: 'd-trip', screenId: null, stateId: 't-a' });
  assert.deepEqual(plain(stepOf('y-trip', 'w-3').ref), { designId: 'd-trip', screenId: 's-list', stateId: 't-b' });
  assert.deepEqual(plain(stepOf('y-exp', 'w-2').ref), { designId: 'd-emp', screenId: 's-form', stateId: 't-b' }, 'ほかの画面設計の同じ id はそのまま');
  assert.equal(api.actions.deleteState('d-trip', 'i-st', 't-b'), true);
  assert.deepEqual(plain(stepOf('y-trip', 'w-3').ref), { designId: 'd-trip', screenId: 's-list', stateId: null });
  assert.deepEqual(plain(stepOf('y-exp', 'w-2').ref), { designId: 'd-emp', screenId: 's-form', stateId: 't-b' });
  assert.equal(stepOf('y-trip', 'w-3').text, '承認する', '作業の文は残る');
  api.store.undo();
  assert.equal(stepOf('y-trip', 'w-3').ref.stateId, 't-b', '元に戻すで戻る');
});

// ── 更新日時 ──
test('システムの更新日時は、中身が変わったときだけ変える（同じ値を書いても変えず、履歴にも積まない）', async (t) => {
  const { api, sys } = await boot(t, sampleState());
  const undos = api.store.undoStack.length;
  assert.equal(api.actions.updateSystem('y-trip', { name: ' 出張申請システム ', description: '' }), true);
  assert.equal(sys('y-trip').updatedAt, OLD);
  assert.equal(api.store.undoStack.length, undos, '何も変わらなければ履歴に積まない');
  assert.equal(api.actions.updateSystem('y-trip', { name: '' }), true);
  assert.equal(sys('y-trip').name, '出張申請システム', '空の名前にはしない');
  assert.equal(sys('y-trip').updatedAt, OLD);
  api.actions.updateSystem('y-trip', { description: '出張の申請から精算まで' });
  assert.equal(sys('y-trip').description, '出張の申請から精算まで');
  assert.notEqual(sys('y-trip').updatedAt, OLD);
  assert.equal(api.actions.updateSystem('y-nai', { name: 'x' }), false);
  assert.equal(sys('y-exp').updatedAt, OLD, 'ほかのシステムは変わらない');
  api.actions.addRole('y-exp', '経理');
  assert.notEqual(sys('y-exp').updatedAt, OLD, '役割を足すと変わる');
});

// ── スイムレーンの作業と矢印 ──
test('作業: 役割のある作業だけ足せる。列を書かなければいちばん右の次。直す・動かす・消す（つながる矢印も消える）', async (t) => {
  const { api, sys, stepOf } = await boot(t, sampleState());
  assert.equal(api.actions.addStep('y-trip', { roleId: 'l-nai', text: '出張する' }), null, '役割が見つからないと足さない');
  assert.equal(api.actions.addStep('y-trip', { roleId: 'l-app', kind: 'ふしぎ', text: '出張する' }), null, '知らない種類は足さない');
  assert.equal(api.actions.addStep('y-trip', { roleId: 'l-app', col: -1, text: '出張する' }), null);
  const w = api.actions.addStep('y-trip', { roleId: 'l-app', text: ' 出張する ' });
  assert.match(w, /^w-/);
  assert.deepEqual(plain(stepOf('y-trip', w)), { id: w, roleId: 'l-app', col: 4, kind: 'task', text: '出張する', memo: '', ref: NO_REF, src: null });
  const doc = api.actions.addStep('y-trip', { roleId: 'l-boss', col: 1, kind: 'doc', text: '出張報告書', memo: '紙', ref: { designId: 'd-trip' } });
  assert.deepEqual(plain(stepOf('y-trip', doc)), { id: doc, roleId: 'l-boss', col: 1, kind: 'doc', text: '出張報告書', memo: '紙', ref: { designId: 'd-trip', screenId: null, stateId: null }, src: null });
  assert.equal(api.actions.updateStep('y-trip', w, { text: '出張に行く', memo: '新幹線', kind: 'end', ref: { designId: 'd-trip', screenId: 's-list' } }), true);
  assert.deepEqual(plain(stepOf('y-trip', w)), { id: w, roleId: 'l-app', col: 4, kind: 'end', text: '出張に行く', memo: '新幹線', ref: { designId: 'd-trip', screenId: 's-list', stateId: null }, src: null });
  assert.equal(api.actions.updateStep('y-trip', w, { kind: 'ふしぎ' }), false);
  assert.equal(api.actions.updateStep('y-trip', 'w-nai', { text: 'x' }), false);
  assert.equal(api.actions.moveStep('y-trip', w, { roleId: 'l-boss', col: 5 }), true);
  assert.deepEqual(plain([stepOf('y-trip', w).roleId, stepOf('y-trip', w).col]), ['l-boss', 5]);
  assert.equal(api.actions.moveStep('y-trip', w, { col: 2 }), true);
  assert.deepEqual(plain([stepOf('y-trip', w).roleId, stepOf('y-trip', w).col]), ['l-boss', 2]);
  assert.equal(api.actions.moveStep('y-trip', w, { roleId: 'l-nai' }), false);
  assert.equal(api.actions.moveStep('y-trip', w, { col: 1.5 }), false);
  const before = plain(sys('y-trip').swimlane);
  assert.equal(api.actions.deleteStep('y-trip', 'w-2'), true);
  assert.deepEqual(ids(sys('y-trip').swimlane.edges), ['e-3'], 'w-2 につながる矢印も消える');
  api.store.undo();
  assert.deepEqual(plain(sys('y-trip').swimlane), before, '元に戻す 1 回で戻る');
  assert.equal(api.actions.deleteStep('y-trip', 'w-nai'), false);
});

test('矢印: 同じ向きの同じ 2 つの作業の間に 2 本目は作らない・自分への矢印は作らない。文を直す・消す。まとめて置き換える', async (t) => {
  const { api, sys } = await boot(t, sampleState());
  assert.equal(api.actions.addEdge('y-trip', 'w-1', 'w-2'), null, '同じ向きの 2 本目は作らない');
  assert.equal(api.actions.addEdge('y-trip', 'w-2', 'w-2'), null, '自分への矢印は作らない');
  assert.equal(api.actions.addEdge('y-trip', 'w-1', 'w-nai'), null);
  const back = api.actions.addEdge('y-trip', 'w-2', 'w-1', ' 取り下げ ');
  assert.match(back, /^e-/, '逆向きなら作れる');
  assert.deepEqual(plain(sys('y-trip').swimlane.edges.at(-1)), { id: back, from: 'w-2', to: 'w-1', label: '取り下げ' });
  assert.equal(api.actions.updateEdge('y-trip', back, '申請を取り下げる'), true);
  assert.equal(sys('y-trip').swimlane.edges.at(-1).label, '申請を取り下げる');
  assert.equal(api.actions.updateEdge('y-trip', 'e-nai', 'x'), false);
  assert.equal(api.actions.deleteEdge('y-trip', back), true);
  assert.deepEqual(ids(sys('y-trip').swimlane.edges), ['e-1', 'e-2', 'e-3', 'e-4']);
  assert.equal(api.actions.deleteEdge('y-trip', back), false);
  // まとめて置き換える（読み込むときと同じ直し方をする）
  assert.equal(api.actions.setSwimlane('y-trip', {
    steps: [{ id: 'w-a', roleId: 'l-app', col: 0, kind: 'start', text: '始まり' }, { id: 'w-b', roleId: 'l-boss', col: 1, kind: 'ふしぎ', text: '見る' }],
    edges: [{ id: 'e-a', from: 'w-a', to: 'w-b' }, { id: 'e-b', from: 'w-b', to: 'w-nai' }, { from: 'w-b', to: 'w-a', label: '戻す' }],
  }), true);
  const sw = sys('y-trip').swimlane;
  assert.deepEqual(plain(sw.steps.map((w) => [w.id, w.kind, w.ref])), [['w-a', 'start', NO_REF], ['w-b', 'task', NO_REF]]);
  assert.deepEqual(plain(sw.edges.map((e) => [e.from, e.to, e.label])), [['w-a', 'w-b', ''], ['w-b', 'w-a', '戻す']]);
  assert.match(sw.edges[1].id, /^e-/);
  assert.equal(api.actions.setSwimlane('y-nai', { steps: [], edges: [] }), false);
});

// ── HTML の取り込み ──
test('HTML の取り込み: 新しく足すとき（一覧にない・別の画面設計として足す）だけ、渡したシステムに入れる。置き換えではシステムを変えない', async (t) => {
  const { app, api, S, sys, d } = await boot(t);
  const y = api.actions.createSystem({ name: '出張申請システム' });
  const a = api.actions.createDesign('出張申請', 'kintone');
  api.actions.updateDesignInfo(a, { description: '出張の申請をする' });
  const html = api.buildStandaloneHtml(d(a), S());
  const edited = html.split('出張の申請をする').join('出張の申請をする（直した）');
  api.actions.deleteDesignForever(a);
  const added = await api.importHtmlText(html, { systemId: y });
  assert.deepEqual(plain(added), { status: 'added', designId: a });
  assert.deepEqual(plain(sys(y).designIds), [a], '一覧になければ、渡したシステムに入れる');
  assert.equal((await api.importHtmlText(html, { systemId: y })).status, 'same');
  // 別の画面設計として足す
  let done = api.importHtmlText(edited, { systemId: y });
  await tick();
  click(app.document.querySelector('[name="imp-how"][value="copy"]'));
  click(app.document.querySelector('[data-dlg="ok"]'));
  const copied = await done;
  assert.equal(copied.status, 'copied');
  assert.deepEqual(plain(sys(y).designIds), [a, copied.designId]);
  // 置き換え（ほかのシステムを渡しても、入っているシステムは変えない）
  const other = api.actions.createSystem({ name: '経費精算システム' });
  done = api.importHtmlText(edited, { systemId: other });
  await tick();
  click(app.document.querySelector('[data-dlg="ok"]'));
  assert.equal((await done).status, 'replaced');
  assert.equal(d(a).description, '出張の申請をする（直した）');
  assert.deepEqual(plain(sys(y).designIds), [a, copied.designId]);
  assert.deepEqual(plain(sys(other).designIds), []);
  // システムを渡さなければ、どのシステムにも入れない
  api.actions.deleteDesignForever(a);
  assert.equal((await api.importHtmlText(html)).status, 'added');
  assert.deepEqual(ids(api.systemsOf(S(), a)), []);
});

// ── 第 9 段階の見直し（T9）──
test('指す先（画面・ステータス）がなくなる操作では、どれでも作業の指す先を外す（ステータスの項目を消す・並びを書き直す・前の版に戻す）。同じ画面設計を指す作業だけ。システムの更新日時は変えず、元に戻すで一緒に戻る', async (t) => {
  const { api, sys, stepOf } = await boot(t, sampleState());
  assert.equal(api.actions.deleteItem('d-trip', 'i-st'), true);
  assert.deepEqual(plain(stepOf('y-trip', 'w-2').ref), { designId: 'd-trip', screenId: 's-form', stateId: null });
  assert.deepEqual(plain(stepOf('y-trip', 'w-3').ref), { designId: 'd-trip', screenId: 's-list', stateId: null });
  assert.deepEqual(plain(stepOf('y-exp', 'w-2').ref), { designId: 'd-emp', screenId: 's-form', stateId: 't-b' }, 'ほかの画面設計を指す作業はそのまま');
  assert.deepEqual(plain([sys('y-trip').updatedAt, sys('y-exp').updatedAt]), [OLD, OLD], 'システムの更新日時は変えない');
  api.store.undo();
  assert.deepEqual(plain([stepOf('y-trip', 'w-2').ref.stateId, stepOf('y-trip', 'w-3').ref.stateId]), ['t-a', 't-b'], '元に戻すで一緒に戻る');
  // ステータスの並びを名前の並びで書き直す（右の欄の「ステータスの並び」）
  assert.equal(api.actions.updateItem('d-trip', 'i-st', { props: { states: ['申請', '完了'] } }), true);
  assert.deepEqual(plain([stepOf('y-trip', 'w-2').ref.stateId, stepOf('y-trip', 'w-3').ref.stateId]), ['t-a', null]);
  api.store.undo();
  // 前の版に戻して、画面が減る
  const rv = api.actions.addRevision('d-trip', { note: '最初' });
  const sc = api.actions.addScreen('d-trip', 'blank');
  api.actions.updateStep('y-trip', 'w-4', { ref: { designId: 'd-trip', screenId: sc, stateId: 't-c' } });
  assert.equal(api.actions.restoreRevision('d-trip', rv), true);
  assert.deepEqual(plain(stepOf('y-trip', 'w-4').ref), { designId: 'd-trip', screenId: null, stateId: 't-c' });
  api.store.undo();
  assert.equal(stepOf('y-trip', 'w-4').ref.screenId, sc);
});

test('HTML の取り込みで置き換えて画面が減ると、なくなった画面を指していた作業の指す先を外す', async (t) => {
  const { app, api, S, d, stepOf } = await boot(t, sampleState());
  const html = api.buildStandaloneHtml(d('d-trip'), S());
  const sc = api.actions.addScreen('d-trip', 'blank');
  api.actions.updateStep('y-trip', 'w-4', { ref: { designId: 'd-trip', screenId: sc, stateId: null } });
  const done = api.importHtmlText(html);
  await tick();
  click(app.document.querySelector('[data-dlg="ok"]'));
  assert.equal((await done).status, 'replaced');
  assert.deepEqual(plain(stepOf('y-trip', 'w-4').ref), { designId: 'd-trip', screenId: null, stateId: null });
  assert.equal(stepOf('y-trip', 'w-2').ref.screenId, 's-form', '残った画面を指す作業はそのまま');
});

test('取り込んだステータスの項目: 元の画面設計でステータスを消すと、取り込んだ側のステータスを指す作業の指す先も外れる', async (t) => {
  const st = sampleState();
  const src = st.designs[0].items[0];
  st.designs.push(design('d-sub', '出張の報告', { items: [{ ...plain(src), id: 'o-st', link: { designId: 'd-trip', itemId: 'i-st', designName: '出張申請', lost: false } }] }));
  st.systems[0].designIds.push('d-sub');
  st.systems[0].swimlane.steps.push(step('w-5', 'l-app', 4, 'task', '報告する', { designId: 'd-sub', screenId: 's-d-sub', stateId: 't-b' }));
  const { api, stepOf } = await boot(t, st);
  assert.equal(api.actions.deleteState('d-trip', 'i-st', 't-b'), true);
  assert.deepEqual(plain(stepOf('y-trip', 'w-5').ref), { designId: 'd-sub', screenId: 's-d-sub', stateId: null });
});

test('システムの履歴の行に戻すとき、作業の指す先を今の中身で検める（ない画面設計なら 3 つとも外し、ない画面・ステータスはその欄だけ外す）', async (t) => {
  const st = sampleState();
  const y = st.systems[0];
  const swim = plain(y.swimlane);
  swim.steps[0].ref = { designId: 'd-emp', screenId: 's-d-emp', stateId: null };
  // 説明だけは今と違う（同じ中身の行には戻さないため。T9 の見直し）
  y.revisions = [{ id: 'r-1', kind: 'ai', date: OLD, note: 'Claude Code が直す前の状態', aiSession: 's-0',
    snapshot: { name: y.name, description: '前の説明', roles: plain(y.roles), swimlane: swim, designIds: ['d-trip', 'd-emp'] } }];
  const { api, sys, stepOf } = await boot(t, st);
  api.actions.deleteDesignForever('d-emp');
  api.actions.deleteScreen('d-trip', 's-form');
  api.actions.deleteState('d-trip', 'i-st', 't-b');
  assert.equal(api.actions.restoreSystemRevision('y-trip', 'r-1'), true);
  assert.equal(sys('y-trip').description, '前の説明');
  assert.deepEqual(plain(sys('y-trip').designIds), ['d-trip']);
  assert.deepEqual(plain(stepOf('y-trip', 'w-1').ref), NO_REF, '完全に削除した画面設計は指さない');
  assert.deepEqual(plain(stepOf('y-trip', 'w-2').ref), { designId: 'd-trip', screenId: null, stateId: 't-a' });
  assert.deepEqual(plain(stepOf('y-trip', 'w-3').ref), { designId: 'd-trip', screenId: 's-list', stateId: null });
});

test('「戻す前の状態」の行も、システムごとに新しい方から 10 行まで（「AI が直す前の状態」の行とは別に数える）', async (t) => {
  const st = sampleState();
  const y = st.systems[0];
  y.revisions = [{ id: 'r-ai', kind: 'ai', date: OLD, note: 'Claude Code が直す前の状態', aiSession: 's-0',
    snapshot: { name: y.name, description: '', roles: plain(y.roles), swimlane: plain(y.swimlane), designIds: plain(y.designIds) } }];
  const { api, sys } = await boot(t, st);
  for (let i = 0; i < 12; i++) {
    api.actions.renameRole('y-trip', 'l-app', `申請者 ${i}`);
    api.actions.restoreSystemRevision('y-trip', 'r-ai');
  }
  const rows = sys('y-trip').revisions;
  assert.deepEqual(plain(rows.map((r) => r.kind)), ['ai', ...Array(10).fill('restore')]);
  assert.deepEqual(plain(rows.slice(1).map((r) => r.snapshot.roles[0].name)), Array.from({ length: 10 }, (_, i) => `申請者 ${i + 2}`), '古い行から消す');
});

test('同じ向きの 2 本目の矢印は、読み込みと setSwimlane で外す。システムの履歴の行の id が重なっていれば、2 つ目からは新しい id にする（2 つ目の行にも戻せる）', async (t) => {
  const st = sampleState();
  const y = st.systems[0];
  y.swimlane.edges.push(edge('e-5', 'w-1', 'w-2', '2 本目'));
  const row = { id: 'r-1', kind: 'ai', date: OLD, note: 'n', snapshot: { name: y.name, description: '', roles: plain(y.roles), swimlane: plain(y.swimlane), designIds: plain(y.designIds) } };
  y.revisions = [row, { ...plain(row), snapshot: { ...plain(row.snapshot), name: '2 つ目の名前' } }];
  const { api, sys } = await boot(t, st);
  assert.deepEqual(ids(sys('y-trip').swimlane.edges), ['e-1', 'e-2', 'e-3', 'e-4'], '読み込み: 同じ向きの 2 本目は外す（1 本目を残す）');
  assert.equal(sys('y-trip').revisions[1].snapshot.swimlane.edges.length, 4, '履歴の行の写しも同じに直す');
  const revIds = ids(sys('y-trip').revisions);
  assert.equal(revIds[0], 'r-1');
  assert.match(revIds[1], /^r-/);
  assert.notEqual(revIds[1], 'r-1');
  assert.deepEqual(plain(api.migrate(plain(api.store.state)).state), plain(api.store.state), '2 回通しても同じ');
  assert.equal(api.actions.restoreSystemRevision('y-trip', revIds[1]), true);
  assert.equal(sys('y-trip').name, '2 つ目の名前');
  assert.equal(api.actions.setSwimlane('y-trip', { steps: plain(sys('y-trip').swimlane.steps), edges: [edge('e-a', 'w-1', 'w-2'), edge('e-b', 'w-1', 'w-2', '2 本目')] }), true);
  assert.deepEqual(plain(sys('y-trip').swimlane.edges.map((e) => [e.id, e.from, e.to])), [['e-a', 'w-1', 'w-2']], 'setSwimlane: 同じ向きの 2 本目は外す');
});

test('ごみ箱のシステムには、画面設計を入れない（作る・複製する・入れる・取り込む。見つからないときと同じ扱い）', async (t) => {
  const st = sampleState();
  st.systems.push(system('y-old', '古いシステム', [], { trashedAt: OLD }));
  const { api, S, sys, d } = await boot(t, st);
  const n = S().designs.length;
  assert.equal(api.actions.createDesign('出張の報告', 'kintone', { systemId: 'y-old' }), null);
  assert.equal(api.actions.duplicateDesign('d-emp', { systemId: 'y-old' }), null);
  assert.equal(api.actions.copyDesignIntoSystem('y-old', 'd-emp'), null);
  assert.equal(api.actions.addDesignToSystem('y-old', 'd-emp'), false);
  assert.deepEqual(plain(api.actions.addDesignsToSystem('y-old', ['d-emp'])), []);
  assert.equal(S().designs.length, n, '画面設計も作らない');
  const html = api.buildStandaloneHtml(d('d-emp'), S());
  api.actions.deleteDesignForever('d-emp');
  assert.equal((await api.importHtmlText(html, { systemId: 'y-old' })).status, 'added', '取り込みは、画面設計だけ足す');
  assert.deepEqual(plain([sys('y-old').designIds, sys('y-old').updatedAt]), [[], OLD]);
});
