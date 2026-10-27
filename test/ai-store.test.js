'use strict';
// AI の窓口の土台（第 7 段階の T2）のテスト。store.batch()（1 回の頼み＝1 回の変更。設計書の 8-1）・store.whenSaved()・
// 保存を止めた理由（store.blockReason）・改訂履歴の自動の行 'ai'・画面設計の中身の項目の並び（DESIGN_CONTENT_KEYS）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bootApp, createMainStorage, waitFor } = require('./harness');
const { sampleState, STORAGE_KEY, plain } = require('./ai-fixtures');

async function bootSample() {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  const T = await app.api();
  const saves = { n: 0 };
  const save = T.store.adapter.save.bind(T.store.adapter);
  T.store.adapter.save = (st) => { saves.n++; return save(st); };
  const notes = { n: 0 };
  T.store.subscribe(() => { notes.n++; });
  return { app, T, saves, notes };
}

test('batch の中の何回の commit も、元に戻すの 1 回・保存の 1 回・描き直しの 1 回にまとまる', async () => {
  const { app, T, saves, notes } = await bootSample();
  const undo0 = T.store.undoStack.length;
  const r = T.store.batch(() => {
    T.actions.updateDesignInfo('d1', { description: '一' });
    T.actions.addItem('d1', 'number');
    T.actions.updateScreen('d1', 's2', { name: '顧客の一覧' });
    return 'できた';
  });
  assert.deepEqual(plain(r), { result: 'できた', changed: true });
  assert.equal(T.store.undoStack.length, undo0 + 1);
  assert.equal(saves.n, 1);
  assert.equal(notes.n, 1);
  const saved = JSON.parse(app.window.localStorage.getItem(STORAGE_KEY));
  const d1 = saved.designs.find((d) => d.id === 'd1');
  assert.equal(d1.description, '一');
  assert.equal(d1.items.length, 4);
  // 元に戻す 1 回で、3 つの変更がまとめて戻る
  T.store.undo();
  const back = T.store.state.designs.find((d) => d.id === 'd1');
  assert.equal(back.description, '取引先と顧客の連絡先を管理する。');
  assert.equal(back.items.length, 3);
  assert.equal(back.screens[1].name, '一覧');
  app.close();
});

test('batch の中で例外が出たら、始める前の中身に戻し、保存も描き直しもしない', async () => {
  const { app, T, saves, notes } = await bootSample();
  const before = T.stateWithRefs(T.store.state).json;
  const undo0 = T.store.undoStack.length;
  assert.throws(() => T.store.batch(() => {
    T.actions.updateDesignInfo('d1', { description: '途中まで' });
    T.actions.addItem('d1', 'number');
    throw new Error('途中で失敗');
  }), /途中で失敗/);
  assert.equal(T.stateWithRefs(T.store.state).json, before);
  assert.equal(T.store.undoStack.length, undo0);
  assert.equal(saves.n, 0);
  assert.equal(notes.n, 0);
  assert.equal(T.store.batching, false);
  // その後の変更は今までどおり通る
  T.actions.updateDesignInfo('d1', { description: '次の変更' });
  assert.equal(saves.n, 1);
  app.close();
});

test('commit の中で例外が出たら、始める前の中身に戻し、保存も描き直しもしない（history: false でも。デバッグとリリースの見直し①-4）', async () => {
  const { app, T, saves, notes } = await bootSample();
  const before = T.stateWithRefs(T.store.state).json;
  const undo0 = T.store.undoStack.length;
  for (const history of [true, false]) {
    assert.throws(() => T.store.commit((s) => {
      s.designs[0].description = '途中まで';
      throw new Error('途中で失敗');
    }, { history }), /途中で失敗/);
    assert.equal(T.stateWithRefs(T.store.state).json, before, `history: ${history}`);
  }
  assert.equal(T.store.undoStack.length, undo0);
  assert.equal(saves.n, 0);
  assert.equal(notes.n, 0);
  T.actions.updateDesignInfo('d1', { description: '次の変更' });
  assert.equal(saves.n, 1, 'その後の変更は今までどおり通る');
  app.close();
});

test('batch の fn が Promise を返したら、戻して例外にする（待つ処理は batch の外で行う）', async () => {
  const { app, T, saves } = await bootSample();
  const before = T.stateWithRefs(T.store.state).json;
  assert.throws(() => T.store.batch(() => {
    T.actions.updateDesignInfo('d1', { description: '待つ前' });
    return Promise.resolve();
  }), /待てません/);
  assert.equal(T.stateWithRefs(T.store.state).json, before);
  assert.equal(saves.n, 0);
  app.close();
});

test('batch の history: false は積まない・clear は元に戻すの履歴を消す・関数は fn の後の中身で決める', async () => {
  const { app, T } = await bootSample();
  T.actions.updateDesignInfo('d1', { description: '人の変更' });
  const undo1 = T.store.undoStack.length;
  assert.ok(undo1 >= 1);
  T.store.batch(() => T.actions.updateDesignInfo('d1', { description: '積まない' }), { history: false });
  assert.equal(T.store.undoStack.length, undo1);
  let seen = null;
  T.store.batch(() => T.actions.updateDesignInfo('d1', { description: '関数' }), {
    history: (st) => { seen = st.designs.find((d) => d.id === 'd1').description; return true; },
  });
  assert.equal(seen, '関数');
  assert.equal(T.store.undoStack.length, undo1 + 1);
  T.store.undo();
  assert.equal(T.store.redoStack.length, 1);
  T.store.batch(() => T.actions.updateDesignInfo('d2', { description: 'ほかの画面設計' }), { history: 'clear' });
  assert.equal(T.store.undoStack.length, 0);
  assert.equal(T.store.redoStack.length, 0);
  app.close();
});

test('batch で何も変わらなかったときは、積まず・保存せず・描き直さず、changed が false', async () => {
  const { app, T, saves, notes } = await bootSample();
  const undo0 = T.store.undoStack.length;
  const r = T.store.batch(() => T.actions.updateDesignInfo('d1', { name: '顧客管理' }));
  assert.equal(r.changed, false);
  assert.equal(T.store.undoStack.length, undo0);
  assert.equal(saves.n, 0);
  assert.equal(notes.n, 0);
  assert.equal(T.store.state.designs[0].updatedAt, '2026-10-01T00:00:00.000Z');
  app.close();
});

test('batch の入れ子は外の batch に任せる。前の版を見ている間は batch を断る', async () => {
  const { app, T, saves } = await bootSample();
  const undo0 = T.store.undoStack.length;
  T.store.batch(() => {
    T.actions.updateDesignInfo('d1', { description: '外' });
    T.store.batch(() => T.actions.updateDesignInfo('d1', { description: '内' }));
  });
  assert.equal(T.store.undoStack.length, undo0 + 1);
  assert.equal(saves.n, 1);
  T.store.startViewing(T.store.state);
  assert.throws(() => T.store.batch(() => {}), /前の版を見ている間/);
  T.store.stopViewing();
  app.close();
});

test('whenSaved は、デスクトップ版でファイルに書き終わってから終わる', async () => {
  const storage = createMainStorage();
  try {
    const app = bootApp({ storage });
    const T = await app.api();
    T.store.batch(() => T.actions.createDesign('顧客管理', 'kintone'));
    await T.store.whenSaved();
    const json = JSON.parse(fs.readFileSync(path.join(storage.dataDir, 'designs.json'), 'utf8'));
    assert.equal(json.designs.length, 1);
    assert.equal(json.designs[0].name, '顧客管理');
    app.close();
  } finally {
    await storage.whenIdle();
    storage.cleanup();
  }
});

test('whenSaved は、ファイルへの保存に失敗していたら reject する', async () => {
  const storage = createMainStorage();
  try {
    const app = bootApp({ storage });
    const T = await app.api();
    app.window.storageAPI.save = async () => ({ ok: false, error: 'ディスクがいっぱいです' });
    T.store.batch(() => T.actions.createDesign('顧客管理', 'kintone'));
    await assert.rejects(() => T.store.whenSaved(), /ディスクがいっぱいです/);
    await waitFor(() => app.errors.length > 0, { label: '保存の失敗の知らせ' });
    app.errors.length = 0; // 保存の失敗は console.error に出る（わざと失敗させた）
    app.close();
  } finally {
    await storage.whenIdle();
    storage.cleanup();
  }
});

test('whenSaved は、ブラウザで保存できなかったとき（localStorage がいっぱい）に reject する', async () => {
  const { app, T } = await bootSample();
  T.store.adapter.save = () => false;
  T.store.batch(() => T.actions.updateDesignInfo('d1', { description: '入らない' }));
  await assert.rejects(() => T.store.whenSaved(), /保存に失敗しました/);
  app.close();
});

test('保存データを読めなかったときは、store.blockReason に理由が入る', async () => {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: '{壊れた JSON' } });
  const T = await app.api();
  assert.match(T.store.blockReason, /保存データを読み込めませんでした/);
  app.close();
  const ok = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  const T2 = await ok.api();
  assert.equal(T2.store.blockReason, null);
  ok.close();
});

test('改訂履歴の自動の行 ai は「AI が変更する前の状態」と出て、版の番号は付かない', async () => {
  const { app, T } = await bootSample();
  const d1 = T.store.state.designs.find((d) => d.id === 'd1');
  const row = T.revisionRow(d1, 'ai', { note: 'Claude Code が変更する前の状態' });
  assert.equal(row.kind, 'ai');
  assert.equal(row.no, null);
  assert.equal(T.revisionTitle(row), 'AI が変更する前の状態');
  assert.equal(T.nextVersionNo(d1), 1);
  app.close();
});

test('DESIGN_CONTENT_KEYS で、画面設計の中身だけを抜き出す（copy のときは写す）', async () => {
  const { app, T } = await bootSample();
  assert.deepEqual(plain(T.DESIGN_CONTENT_KEYS), ['name', 'target', 'look', 'bandTabs', 'description', 'items', 'screens', 'mapPos', 'processPos', 'flowPos']);
  const d1 = T.store.state.designs.find((d) => d.id === 'd1');
  const same = T.designContentOf(d1);
  assert.equal(same.items, d1.items);
  const copy = T.designContentOf(d1, true);
  assert.notEqual(copy.items, d1.items);
  assert.deepEqual(plain(copy.items), plain(d1.items));
  assert.deepEqual(Object.keys(copy), plain(T.DESIGN_CONTENT_KEYS));
  assert.equal(T.designContent(d1), T.designContent({ ...d1, revisions: [{ id: 'r9' }], updatedAt: 'x' }));
  app.close();
});
