'use strict';
// テストの土台（CheckListMaker の test/harness.js から写した）。
// アプリの HTML を jsdom で丸ごと起動し、テスト用の窓口 window.__test__ から中の関数に触れる。
// 一時フォルダは作業フォルダの .devdata/test-tmp に作る（リポジトリの外に作らないため）。

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// アプリの HTML のファイル名は版ごとに変わるので、インストーラの設定（build.files）から取る
const HTML_NAME = PKG.build.files.find((f) => f.endsWith('.html'));
const TMP_ROOT = path.join(ROOT, '.devdata', 'test-tmp');

// 条件が真になるまで待つ（決まった時間だけ待つと、遅い PC で失敗するため）
async function waitFor(cond, { timeout = 5000, interval = 20, label = '条件' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`waitFor の時間切れ: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// storage.js（メインプロセス側）を Electron なしで動かす。
// 一時フォルダを userData に見立て、IPC の受け口を直接呼べる形で返す。
function createMainStorage() {
  const { initStorage } = require(path.join(ROOT, 'storage.js'));
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(TMP_ROOT, 'mim-test-'));
  const handlers = {};
  const storage = initStorage({ getPath: () => tmp }, { handle: (ch, fn) => { handlers[ch] = fn; } });
  return {
    dir: tmp,
    dataDir: path.join(tmp, 'data'),
    ipc: (ch, ...args) => handlers[ch](null, ...args),
    whenIdle: storage.whenIdle,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

// アプリの HTML を起動する。
//   storage      … createMainStorage() の戻り値。渡すと Electron で動いているとき（window.storageAPI あり）として起動する。
//                  省略するとブラウザで開いたときとして起動する（保存先は localStorage）。
//   localStorage … 起動前に localStorage へ入れる { キー: 値 }
//   html         … アプリの HTML の代わりに起動する HTML の文字（書き出した HTML を単体で開いたときのテストに使う）
//   exportAPI    … 書き出しの窓口（preload.js の exportAPI）の身代わり。渡すとデスクトップ版として PDF・PNG も選べる
// 戻り値の api() は、起動が終わって window.__test__ が埋まるのを待ってから返す。
// ページの中で起きた例外と console.error は errors に集め、close() のときに 1 件でもあれば失敗にする
// （クリックの処理の中の例外を見落とさないため）。
function bootApp({ storage = null, localStorage = null, url = 'https://localhost/app/' + HTML_NAME, html = null, exportAPI = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('error', (...args) => errors.push('console.error: ' + args.map(String).join(' ')));
  vc.on('jsdomError', (e) => errors.push('例外: ' + ((e && e.message) || e)));
  const menu = { handler: null };
  const source = html != null ? html : fs.readFileSync(path.join(ROOT, HTML_NAME), 'utf8');
  const dom = new JSDOM(source, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(window) {
      window.__test__ = {};
      window.alert = () => {};
      if (exportAPI) window.exportAPI = exportAPI;
      if (localStorage) {
        for (const [k, v] of Object.entries(localStorage)) window.localStorage.setItem(k, v);
      }
      if (!storage) return;
      window.storageAPI = {
        available: true,
        load: () => storage.ipc('storage:load'),
        save: (json) => storage.ipc('storage:save', json),
      };
      window.menuAPI = { onCommand: (cb) => { menu.handler = cb; } };
    },
  });
  const win = dom.window;
  return {
    dom,
    window: win,
    document: win.document,
    // アプリのメニューを押したときと同じ命令を送る（Electron で動いているときだけ）
    menuCommand: (cmd) => menu.handler && menu.handler(cmd),
    api: () => waitFor(() => win.__test__ && win.__test__.ready && win.__test__, { label: 'アプリの起動' }),
    errors,
    close: () => {
      win.close();
      if (errors.length) throw new Error('ページの中でエラーが出ました: ' + errors.join(' / '));
    },
  };
}

module.exports = { ROOT, PKG, HTML_NAME, waitFor, createMainStorage, bootApp };
