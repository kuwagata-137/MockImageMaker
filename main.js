// main.js — Electron のメインプロセス（CheckListMaker の main.js から写した）
// 役割:
//  - アプリの窓（mock_v*.html）を作る。窓の位置と大きさを覚える（electron-window-state）
//  - 日本語のメニュー。元に戻す・やり直す・拡大・縮小は Electron の標準の動き（role）を使わず、
//    IPC（menu:command）でページへ送り、ページの runCommand() で受ける
//  - ファイルへの保存（storage.js）。終了の前に、並んでいる書き込みが終わるのを待つ
//  - 書き出し（PDF・PNG・HTML）と HTML の取り込みのファイルの窓（export.js）
//  - 2 つ目の起動を止める（2 つ動くと、互いの designs.json を丸ごと上書きするため）
//  - AI（Claude Code など）の頼みの受け口（automation-main.js。第 7 段階）。--background の起動では窓を出さずに動き、
//    AI がつながっている間の窓の × は、終わらずに窓を隠す
// CheckListMaker の録画・ガジェット・Word・Excel の書き出しは写していない。
'use strict';

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { initStorage } = require('./storage');
const { initExport, createPageRenderer } = require('./export');
const { initAutomation } = require('./automation-main');

const APP_HTML = 'mock_v1.00.html';
const APP_TITLE = 'モックイメージメーカー';
// 確かめのための起動（環境変数 MIM_HEADLESS=1）のときだけ、窓を画面に出さない
const HEADLESS = process.env.MIM_HEADLESS === '1';
// AI の入口（mcp-server.js）がアプリを起動したとき（--background）は、窓を作るが出さない（設計書 7-4）
const BACKGROUND = process.argv.includes('--background');
const APP_VERSION = APP_HTML.replace(/^mock_v|\.html$/g, '');

// npm start のときは、保存データを作業フォルダの .devdata/userData に置く
// （インストールしたアプリの %APPDATA%\MockImageMaker と混ざらないようにするため）。
// 確かめのための起動（tools/check-electron.js）は、環境変数 MIM_USER_DATA で別のフォルダを指す
if (!app.isPackaged) app.setPath('userData', process.env.MIM_USER_DATA || path.join(__dirname, '.devdata', 'userData'));

let mainWin = null;
let storage = null;
let quitWaiting = false; // 終わる前の待ち（受け口を止める・保存を待つ）の途中か
let automation = null;

// ── メニュー ───────────────────────────────────────────────
// registerAccelerator:false は、キーの表示だけをしてキーは横取りしない指定。
// Ctrl+Z などはページの keydown で受ける（入力欄の中では、文字の取り消しをブラウザに任せるため）。
function commandItem(label, command, accelerator) {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: () => mainWin && mainWin.webContents.send('menu:command', command),
  };
}

function buildAppMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        // 書き出す（PDF・HTML・PNG）は開いている画面設計を、取り込むは一覧へ戻ってから（第 5 段階）
        commandItem('書き出す…', 'exportDialog'),
        commandItem('HTML を取り込む…', 'importHtml'),
        { type: 'separator' },
        // 改訂する・改訂履歴は、開いている画面設計について行う（第 6 段階）
        commandItem('改訂する…', 'addRevision'),
        commandItem('改訂履歴…', 'openRevisions'),
        { type: 'separator' },
        commandItem('一覧へ戻る', 'goHome'),
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        commandItem('元に戻す', 'undo', 'CmdOrCtrl+Z'),
        commandItem('やり直す', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        { role: 'selectAll', label: 'すべて選択' },
        { type: 'separator' },
        // 部品の操作。Ctrl+C・Ctrl+V は上の文字のコピー・貼り付けと同じキーで、ページが入力欄の外のときだけ部品に使う
        commandItem('部品をコピー', 'copyPart'),
        commandItem('部品を貼り付け', 'pastePart'),
        commandItem('部品を複製', 'duplicatePart', 'CmdOrCtrl+D'),
        commandItem('部品を削除', 'deletePart', 'Delete'),
        // Ctrl+A は上の「すべて選択」と同じキーで、ページが入力欄の外のときだけ部品と吹き出しに使う
        commandItem('部品と吹き出しをすべて選ぶ', 'selectAll'),
        { type: 'separator' },
        commandItem('番号を振り直す', 'renumber'),
      ],
    },
    {
      // 画面の一覧の操作（メニューバーの「画面」の組と同じ）。PageUp・PageDown はページが入力欄の外のときだけ画面を移るのに使う
      label: '画面',
      submenu: [
        commandItem('画面を足す…', 'addScreen'),
        commandItem('画面を複製', 'duplicateScreen'),
        commandItem('画面を消す…', 'deleteScreen'),
        { type: 'separator' },
        commandItem('前の画面へ', 'prevScreen', 'PageUp'),
        commandItem('次の画面へ', 'nextScreen', 'PageDown'),
      ],
    },
    {
      // いくつか選んだ部品と吹き出しを、最初に選んだものに合わせて揃える（メニューバーの「揃える」の組と同じ）
      label: '揃える',
      submenu: [
        commandItem('左に揃える', 'alignLeft'),
        commandItem('左右の中央に揃える', 'alignHCenter'),
        commandItem('右に揃える', 'alignRight'),
        { type: 'separator' },
        commandItem('上に揃える', 'alignTop'),
        commandItem('上下の中央に揃える', 'alignVCenter'),
        commandItem('下に揃える', 'alignBottom'),
        { type: 'separator' },
        commandItem('横に等間隔に並べる', 'distributeH'),
        commandItem('縦に等間隔に並べる', 'distributeV'),
        { type: 'separator' },
        commandItem('同じ幅にする', 'sameWidth'),
        commandItem('同じ高さにする', 'sameHeight'),
      ],
    },
    {
      // データベースの項目（メニューバーの「項目」の組と、左の一覧のいちばん上と同じ）
      label: '項目',
      submenu: [
        commandItem('データベースの項目を開く', 'openItems'),
        commandItem('つながりの図を開く', 'openMap'),
        { type: 'separator' },
        commandItem('項目を足す', 'addItemMenu'),
        commandItem('ほかのモックから取り込む', 'importItems'),
      ],
    },
    {
      label: '表示',
      submenu: [
        commandItem('拡大', 'zoomIn', 'CmdOrCtrl+='),
        commandItem('縮小', 'zoomOut', 'CmdOrCtrl+-'),
        commandItem('100% に戻す', 'zoomReset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示' },
        // 再読み込みと開発者ツールは、開発中（npm start）だけ出す
        ...(app.isPackaged
          ? []
          : [{ type: 'separator' }, { role: 'reload', label: '再読み込み' }, { role: 'toggleDevTools', label: '開発者ツール' }]),
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '閉じる' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── 窓 ─────────────────────────────────────────────────────
function createMainWindow() {
  // 前回の窓の位置・大きさ・最大化を <userData>/window-state.json に覚えて戻す
  const winState = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 800 });
  mainWin = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 800,
    minHeight: 560,
    title: APP_TITLE,
    show: !HEADLESS && !BACKGROUND,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 窓を隠している間も、AI の頼みの処理（タイマー・描き直し）を遅らせない
      backgroundThrottling: false,
    },
  });
  winState.manage(mainWin);
  // AI がつながっている間の ×（「ファイル > 終了」でないとき）は、終わらずに窓を隠す（設計書 7-5）
  mainWin.on('close', (e) => {
    if (!automation || !automation.shouldHideOnClose()) return;
    e.preventDefault();
    mainWin.hide();
    automation.windowShownOrHidden(false); // 窓を出さない確かめの起動では hide の知らせが来ないので、ここでも知らせる
  });
  mainWin.on('show', () => automation && automation.windowShownOrHidden(true));
  mainWin.on('hide', () => automation && automation.windowShownOrHidden(false));
  // 窓へ HTML ファイルなどを落としたときに、アプリの画面が置き換わるのを止める
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.loadFile(APP_HTML);
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

function focusMainWindow() {
  if (!mainWin) return;
  if (HEADLESS) {
    if (automation) automation.noteShowRequested();
    return;
  }
  if (!mainWin.isVisible()) mainWin.show(); // 裏で動いていた（--background・× で隠した）ときは窓を出す
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
}

// ── 起動と終了 ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock({ background: BACKGROUND })) {
  // 2 つ目の起動は何もせずに終わる（1 つ目の窓は second-instance で前に出る）
  app.quit();
} else {
  // 2 つ目の起動が AI の入口からの --background なら、窓を前に出さない（人が使っている窓の邪魔をしない）
  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data && data.background) return;
    focusMainWindow();
  });

  app.whenReady().then(() => {
    storage = initStorage(app, ipcMain);
    const renderer = createPageRenderer(app); // PDF・PNG を作る（書き出しの窓と AI の書き出しで同じものを使う）
    initExport(app, ipcMain, { headless: HEADLESS, renderer });
    automation = initAutomation({ app, ipcMain, getWindow: () => mainWin, background: BACKGROUND, headless: HEADLESS, appVersion: APP_VERSION, renderer });
    buildAppMenu();
    createMainWindow();
    automation.windowCreated();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 閉じる直前の変更が保存されないのを防ぐため、並んでいる書き込みが終わってから終わる。
  // 待つのは will-quit（窓が全部閉じたあと）で、before-quit ではない。メニューの「ファイル > 終了」（app.quit()）では、
  // before-quit の時点でまだ窓が開いていて、右の欄の打ちかけの文字の保存（ページの beforeunload で送る）が届く前に
  // 待ち終わってしまい、書きかけのまま終わるため。窓の × のときは、窓が閉じてから app.quit() になるので、どちらでも同じ
  // AI の受け口は先に止める（automation.json を消し、つながりを閉じる）。
  // 待ち終わったら app.exit(0) で終わる（app.quit() をもう一度呼ぶと、will-quit を止めた直後〔数ミリ秒〕のときは Electron が受け付けず、
  // 窓のないアプリが残り続けた。2026-10-14。will-quit は窓が全部閉じた後に来るので、すぐ終わってよい）
  app.on('will-quit', (e) => {
    if (!storage) return;
    e.preventDefault();
    if (quitWaiting) return; // 待っている間にもう一度終わろうとしたときは、待ち終わるのを待つ
    quitWaiting = true;
    Promise.resolve(automation && automation.stop())
      .catch(() => {})
      .then(() => storage.whenIdle())
      .finally(() => app.exit(0));
  });
}
