// storage.js — メインプロセス側のファイル保存（CheckListMaker の storage.js から写した）
// 役割:
//  - 画面設計の一覧全体を <userData>/data/designs.json に読み書きする
//  - 書き込みは tmp に書いてから置き換える。直前の世代を .bak に残す
//  - 本体が読めなければ .bak を読む（読めない本体は別の名前で残す）。どちらも読めなければ { ok: false } を返し、ページは保存を止める
//  - 書き込みは 1 本の列（saveChain）に並べる。終了の前に whenIdle() で書き終わりを待てる
// CheckListMaker の画像の保存（image:*・使われない画像の掃除）は写していない。
// ページ側の対になる処理は mock_v*.html の FileAdapter。
'use strict';

const path = require('path');
const fsp = require('fs').promises;

const STATE_FILE_NAME = 'designs.json';

function initStorage(app, ipcMain) {
  const dataDir = () => path.join(app.getPath('userData'), 'data');
  const stateFile = () => path.join(dataDir(), STATE_FILE_NAME);

  // ── 読み込み ─────────────────────────────────────────────
  // 戻り値 { status: 'ok', text } か { status: 'missing' }（ファイルが無い）か { status: 'bad', error }（読めない・壊れている）
  async function readJsonFile(file) {
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { status: 'missing' };
      return { status: 'bad', error: String(err.code || err.message || err) };
    }
    try {
      JSON.parse(text);
      return { status: 'ok', text };
    } catch (_) {
      return { status: 'bad', error: 'JSON が壊れています' };
    }
  }

  // 読めない本体を、消えないように別の名前で写しておく（次の保存で .bak へ回り、その次に消えるため）
  async function keepUnreadable(file) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    const copy = `${file}.unreadable-${stamp}`;
    await fsp.copyFile(file, copy);
    return path.basename(copy);
  }

  // 戻り値 { json, notice }。json が null なら初めての起動。notice があれば、ページの上の帯に出す。
  // 本体が読めず .bak も読めないとき、読めない本体を写せないときは例外（ページは保存を止める）。
  // CheckListMaker は「どちらも読めなければ初めての起動」とみなすため、壊れたデータを次の保存で上書きして消す。
  async function readStateJson() {
    const main = await readJsonFile(stateFile());
    if (main.status === 'ok') return { json: main.text, notice: null };
    const bak = await readJsonFile(stateFile() + '.bak');
    if (main.status === 'missing' && bak.status === 'missing') return { json: null, notice: null };
    if (bak.status !== 'ok') {
      throw new Error(`${STATE_FILE_NAME} を読めません（${main.error || 'ファイルがありません'}）。1 つ前の保存（.bak）も読めません`);
    }
    let notice = `${STATE_FILE_NAME} が見つからないため、1 つ前の保存（.bak）から読み込みました。最後の変更が抜けているかもしれません。`;
    if (main.status === 'bad') {
      const kept = await keepUnreadable(stateFile());
      notice = `${STATE_FILE_NAME} を読めなかった（${main.error}）ため、1 つ前の保存（.bak）から読み込みました。最後の変更が抜けているかもしれません。読めなかったファイルは ${kept} として残しました。`;
    }
    return { json: bak.text, notice };
  }

  // ── 書き込み（tmp に書く → 今の本体を .bak へ → tmp を本体へ）─────
  // どこで落ちても「前の版か新しい版のどちらか」が必ず読める。
  let saveChain = Promise.resolve();
  async function writeState(json) {
    await fsp.mkdir(dataDir(), { recursive: true });
    const file = stateFile();
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, json, 'utf8');
    try {
      await fsp.rename(file, file + '.bak');
    } catch (_) {
      /* 初回は本体が無い */
    }
    await fsp.rename(tmp, file);
  }

  ipcMain.handle('storage:load', async () => {
    try {
      return { ok: true, ...(await readStateJson()) };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('storage:save', (_e, json) => {
    if (typeof json !== 'string' || !json) {
      return { ok: false, error: '保存するデータが正しくありません。' };
    }
    // 書き込みは並べて 1 つずつ行う（rename の順が入れ替わると .bak が壊れるため）
    const task = saveChain.then(() => writeState(json));
    saveChain = task.catch(() => {});
    return task
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: String(err.message || err) }));
  });

  // 終了の前に、並んでいる書き込みが全部終わるのを待つ（main.js の will-quit）。
  // dataDir は data フォルダの場所を返す関数（資料の置き場 materials-main.js が、同じ data の下の files/ と designs.json.bak を使う）
  return { whenIdle: () => saveChain, dataDir };
}

module.exports = { initStorage, STATE_FILE_NAME };
