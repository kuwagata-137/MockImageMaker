'use strict';
// storage.js（メインプロセス側のファイル保存）のテスト。
// Electron を起動せず、app と ipcMain を差し替えて IPC の受け口を直接呼ぶ。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMainStorage } = require('./harness');

test('storage.js — ファイルへの保存', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  const file = path.join(st.dataDir, 'designs.json');
  const state = (id) => JSON.stringify({ schemaVersion: 1, settings: { customTargets: [] }, designs: [{ id }] });

  await t.test('初めての読み込みは json: null を返す', async () => {
    const r = await st.ipc('storage:load');
    assert.equal(r.ok, true);
    assert.equal(r.json, null);
  });

  await t.test('保存して読むと同じ中身が返る（designs.json に書かれる）', async () => {
    assert.equal((await st.ipc('storage:save', state('a'))).ok, true);
    assert.equal((await st.ipc('storage:load')).json, state('a'));
    assert.equal(fs.readFileSync(file, 'utf8'), state('a'));
  });

  await t.test('2 回目の保存で、直前の中身が .bak に残る', async () => {
    await st.ipc('storage:save', state('b'));
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), state('a'));
  });

  await t.test('本体の JSON が壊れていたら .bak を読み、知らせを返し、壊れた本体を別の名前で残す', async () => {
    fs.writeFileSync(file, '{broken');
    const r = await st.ipc('storage:load');
    assert.equal(r.ok, true);
    assert.equal(r.json, state('a'));
    assert.match(r.notice, /読めなかった/);
    const kept = fs.readdirSync(st.dataDir).filter((n) => n.startsWith('designs.json.unreadable-'));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(st.dataDir, kept[0]), 'utf8'), '{broken');
  });

  await t.test('空や文字列でないデータは保存しない', async () => {
    assert.equal((await st.ipc('storage:save', '')).ok, false);
    assert.equal((await st.ipc('storage:save', { a: 1 })).ok, false);
  });

  await t.test('同時に保存しても 1 つずつ書かれ、最後の中身が残る', async () => {
    await Promise.all([st.ipc('storage:save', state('x')), st.ipc('storage:save', state('y')), st.ipc('storage:save', state('z'))]);
    assert.equal((await st.ipc('storage:load')).json, state('z'));
  });

  await t.test('whenIdle は、並んでいる書き込みが終わってから解決する', async () => {
    st.ipc('storage:save', state('last'));
    await st.whenIdle();
    assert.equal(fs.readFileSync(file, 'utf8'), state('last'));
  });

  await t.test('本体が無く .bak だけあるときは .bak を読み、知らせを返す', async () => {
    fs.rmSync(file);
    const r = await st.ipc('storage:load');
    assert.equal(r.ok, true);
    assert.ok(r.json);
    assert.match(r.notice, /見つからない/);
  });

  await t.test('本体も .bak も読めないときは ok: false を返す（ページは保存を止める）', async () => {
    fs.writeFileSync(file, '{broken');
    fs.writeFileSync(file + '.bak', '{broken too');
    const r = await st.ipc('storage:load');
    assert.equal(r.ok, false);
    assert.match(r.error, /読めません/);
  });
});

// デバッグとリリースの見直し①-1: Windows では、ほかのアプリ（ウイルス対策・エクスプローラーのプレビューなど）が一瞬ファイルをつかんでいると、
// rename・writeFile が EPERM・EBUSY・EACCES で失敗する。少し待ってやり直す。やり直しても本体へ置き換えられなかったときは、
// 書き終わった .tmp が残るので、次の起動で本体がなければ .tmp を読む（.bak より新しい）
test('storage.js — 一時的に書けないときのやり直しと、書きかけの .tmp からの読み込み（見直し①-1）', async (t) => {
  const st = createMainStorage();
  t.after(() => st.cleanup());
  const fsp = fs.promises;
  const file = path.join(st.dataDir, 'designs.json');
  const state = (id) => JSON.stringify({ schemaVersion: 1, settings: { customTargets: [] }, designs: [{ id }] });
  const busy = (code) => Object.assign(new Error(`${code}: resource busy or locked`), { code });
  // fs.promises の関数を、条件に合う呼び出しで n 回だけ失敗させる
  const failNext = (name, n, code, when = () => true) => {
    const orig = fsp[name];
    let left = n;
    fsp[name] = async (...args) => {
      if (left > 0 && when(...args)) { left -= 1; throw busy(code); }
      return orig.apply(fsp, args);
    };
    return () => { fsp[name] = orig; };
  };
  assert.equal((await st.ipc('storage:save', state('a'))).ok, true);

  await t.test('tmp を本体へ置き換える rename が 2 回 EPERM で失敗しても、やり直して保存できる', async () => {
    const restore = failNext('rename', 2, 'EPERM', (from) => from.endsWith('.tmp'));
    try {
      assert.equal((await st.ipc('storage:save', state('b'))).ok, true);
    } finally { restore(); }
    assert.equal(fs.readFileSync(file, 'utf8'), state('b'));
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), state('a'));
    assert.equal(fs.existsSync(file + '.tmp'), false);
  });

  await t.test('tmp を書く writeFile が EBUSY で 1 回失敗しても、やり直して保存できる', async () => {
    const restore = failNext('writeFile', 1, 'EBUSY');
    try {
      assert.equal((await st.ipc('storage:save', state('c'))).ok, true);
    } finally { restore(); }
    assert.equal(fs.readFileSync(file, 'utf8'), state('c'));
  });

  await t.test('本体を .bak へ回した後に置き換えられず本体がないときは、次の起動で書き終わった .tmp を読む', async () => {
    fs.writeFileSync(file + '.tmp', state('d'));
    fs.renameSync(file, file + '.bak');
    const r = await st.ipc('storage:load');
    assert.equal(r.ok, true);
    assert.equal(r.json, state('d'), '.bak（c）より新しい .tmp（d）を読む');
  });

  await t.test('.tmp が書きかけ（JSON が壊れている）なら、今までどおり .bak を読む', async () => {
    fs.writeFileSync(file + '.tmp', '{"schemaVersion":1,"desi');
    const r = await st.ipc('storage:load');
    assert.equal(r.json, state('c'));
    assert.match(r.notice, /見つからない/);
  });
});
