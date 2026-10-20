'use strict';
// 人が打っていない欄は保存しない（第 10 段階の前半・終わりの見直し A の Important 1 を、設計ノート以外の欄でも確かめる）。
// 欄に出した文は、保存してある文と違う形になることがある（1 行の欄は改行を消す・複数行の欄は CRLF の改行を LF にそろえる・
// 前後の空白を取って保存する欄がある）。そのような文を読み込んだとき、欄にフォーカスしてほかの窓へ移る（window の blur）だけで、
// 文が書き換わって元に戻すの履歴に積まれていた（flushSideField が、人が打っていない欄でも保存を呼んでいた）。
// 設計ノートの欄は test/notes-ui.test.js。画面設計とシステムの名前は架空の業務（顧客管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const NL = '上の行\n下の行';
const CRLF = '一行目\r\n二行目';
const SPACES = '  前後の空白  ';

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const step = (id, roleId, col, text, memo) => ({ id, roleId, col, kind: 'task', text, memo, ref: { designId: null, screenId: null, stateId: null }, src: null });
function sampleState() {
  return plain({
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [{
      id: 'd-cust', name: '顧客管理', target: 'kintone', description: CRLF, createdAt: OLD, updatedAt: OLD, trashedAt: null, revisions: [], items: [],
      screens: [screen('s-list', '一覧')], mapPos: {}, processPos: {}, flowPos: {},
    }],
    systems: [{
      id: 'y-cust', name: '顧客管理システム', description: CRLF, createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: ['d-cust'],
      roles: [{ id: 'l-sales', name: '営業', memo: NL }, { id: 'l-boss', name: '上長', memo: SPACES }],
      swimlane: { steps: [step('w-1', 'l-sales', 0, NL, CRLF), step('w-2', 'l-boss', 1, '確かめる', '')], edges: [{ id: 'e-1', from: 'w-1', to: 'w-2', label: NL }] },
      materials: [{ id: 'm-1', name: '顧客台帳.xlsx', kind: 'excel', size: 4800, file: 'm-1.xlsx', memo: NL, addedAt: OLD }],
      notes: {}, revisions: [],
    }],
  });
}
// 資料の窓口の身代わり（資料の入口を出すだけ）
const MATERIALS_API = {
  available: true,
  pick: async () => ({ ok: false, canceled: true }), addDropped: async () => ({ ok: true, added: [], skipped: [] }),
  read: async () => ({ ok: false }), bdmPlan: async () => ({ ok: false }),
  sweep: async () => ({ ok: true, removedFiles: 0, removedDirs: 0 }), removeSystem: async () => ({ ok: true, removed: 0 }),
};

async function boot(t) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(sampleState()) }, materialsAPI: MATERIALS_API });
  t.after(() => app.close());
  const api = await app.api();
  const $ = (sel) => app.document.querySelector(sel);
  const blurWindow = () => app.window.dispatchEvent(new app.window.Event('blur'));
  const sys = () => plain(api.store.state.systems[0]);
  const design = () => plain(api.store.state.designs[0]);
  // 欄にフォーカスしてほかの窓へ移るだけでは、読んだ値も、元に戻すの履歴の数も、更新日時も変わらない
  const untyped = (sel, read, when) => {
    const el = $(sel);
    assert.ok(el, `${sel} がない`);
    const [v0, u0, t0] = [read(), api.store.undoStack.length, when()];
    el.focus();
    blurWindow();
    assert.equal(read(), v0, `${sel}: 文が変わった`);
    assert.equal(api.store.undoStack.length, u0, `${sel}: 履歴に積んだ`);
    assert.equal(when(), t0, `${sel}: 更新日時が変わった`);
    return el;
  };
  return { app, api, $, blurWindow, sys, design, untyped };
}

test('システムの概要の説明（CRLF の改行）: フォーカスしてほかの窓へ移るだけでは保存しない。打つと保存し、打ち戻すと元の文を保存する', async (t) => {
  const { api, blurWindow, sys, untyped } = await boot(t);
  api.openSystem('y-cust', { panel: 'overview' });
  const el = untyped('#sys-view [data-sy="desc"]', () => sys().description, () => sys().updatedAt);
  const shown = el.value;
  assert.equal(shown, '一行目\n二行目', '欄では LF にそろう');
  el.value = shown + '（直した）';
  blurWindow();
  assert.equal(sys().description, '一行目\n二行目（直した）');
  el.value = shown;
  blurWindow();
  assert.equal(sys().description, '一行目\n二行目', '打ち戻した文を保存する');
});

test('役割のメモ（改行・前後の空白）: フォーカスしてほかの窓へ移るだけでは保存しない', async (t) => {
  const { api, sys, untyped } = await boot(t);
  api.openSystem('y-cust', { panel: 'roles' });
  untyped('#sys-view [data-sy="role-memo"][data-role="l-sales"]', () => sys().roles[0].memo, () => sys().updatedAt);
  untyped('#sys-view [data-sy="role-memo"][data-role="l-boss"]', () => sys().roles[1].memo, () => sys().updatedAt);
});

test('資料のメモ（改行）: フォーカスしてほかの窓へ移るだけでは保存しない', async (t) => {
  const { api, sys, untyped } = await boot(t);
  api.openSystem('y-cust', { panel: 'materials' });
  untyped('#sys-view [data-sy="mat-memo"][data-mat="m-1"]', () => sys().materials[0].memo, () => sys().updatedAt);
});

test('スイムレーン図の作業の設定（作業の文字〔改行〕・メモ〔CRLF〕・矢印の文字〔改行〕）と矢印の設定の文字: フォーカスしてほかの窓へ移るだけでは保存しない', async (t) => {
  const { api, sys, untyped } = await boot(t);
  api.openSystem('y-cust', { panel: 'swimlane' });
  api.selectStep('w-1');
  untyped('#sys-side [data-sw="text"]', () => sys().swimlane.steps[0].text, () => sys().updatedAt);
  untyped('#sys-side [data-sw="memo"]', () => sys().swimlane.steps[0].memo, () => sys().updatedAt);
  untyped('#sys-side [data-sw="edge-label"][data-edge="e-1"]', () => sys().swimlane.edges[0].label, () => sys().updatedAt);
  api.selectEdge('e-1');
  untyped('#sys-side [data-sw="edge-label"][data-edge="e-1"]', () => sys().swimlane.edges[0].label, () => sys().updatedAt);
});

test('画面設計の説明（CRLF の改行）・部品の文字（改行）とメモ（CRLF）: フォーカスしてほかの窓へ移るだけでは保存しない', async (t) => {
  const { api, design, untyped } = await boot(t);
  api.openDesign('d-cust');
  untyped('#side-settings [data-field="design-desc"]', () => design().description, () => design().updatedAt);
  const id = api.actions.addPart('d-cust', 's-list', 'heading', { x: 24, y: 80 });
  api.actions.updatePart('d-cust', 's-list', id, { label: NL, memo: CRLF });
  api.selectPart(id);
  const part = () => design().screens[0].parts.find((p) => p.id === id);
  assert.deepEqual([part().label, part().memo], [NL, CRLF]);
  untyped('#side-settings [data-pf="label"]', () => part().label, () => design().updatedAt);
  untyped('#side-settings [data-pf="memo"]', () => part().memo, () => design().updatedAt);
});
