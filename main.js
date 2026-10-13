// main.js — Electron のメインプロセス（CheckListMaker の main.js から写した）
// 役割:
//  - アプリの窓（mock_v*.html）を作る。窓の位置と大きさを覚える（electron-window-state）
//  - 日本語のメニュー。元に戻す・やり直す・拡大・縮小は Electron の標準の動き（role）を使わず、
//    IPC（menu:command）でページへ送り、ページの runCommand() で受ける
//  - ファイルへの保存（storage.js）。終了の前に、並んでいる書き込みが終わるのを待つ
//  - 2 つ目の起動を止める（2 つ動くと、互いの designs.json を丸ごと上書きするため）
// CheckListMaker の録画・ガジェット・Word・Excel の書き出しは写していない。
'use strict';

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { initStorage } = require('./storage');

const APP_HTML = 'mock_v1.00.html';
const APP_TITLE = 'モックイメージメーカー';
// 確かめのための起動（環境変数 MIM_HEADLESS=1）のときだけ、窓を画面に出さない
const HEADLESS = process.env.MIM_HEADLESS === '1';

// npm start のときは、保存データを作業フォルダの .devdata/userData に置く
// （インストールしたアプリの %APPDATA%\MockImageMaker と混ざらないようにするため）。
// 確かめのための起動（tools/check-electron.js）は、環境変数 MIM_USER_DATA で別のフォルダを指す
if (!app.isPackaged) app.setPath('userData', process.env.MIM_USER_DATA || path.join(__dirname, '.devdata', 'userData'));

let mainWin = null;
let storage = null;
let quitReady = false;

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
      submenu: [commandItem('一覧へ戻る', 'goHome'), { type: 'separator' }, { role: 'quit', label: '終了' }],
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
    show: !HEADLESS,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  winState.manage(mainWin);
  // 窓へ HTML ファイルなどを落としたときに、アプリの画面が置き換わるのを止める
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.loadFile(APP_HTML);
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

function focusMainWindow() {
  if (!mainWin || HEADLESS) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
}

// ── 起動と終了 ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  // 2 つ目の起動は何もせずに終わる（1 つ目の窓は second-instance で前に出る）
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    storage = initStorage(app, ipcMain);
    buildAppMenu();
    createMainWindow();
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
  app.on('will-quit', (e) => {
    if (quitReady || !storage) return;
    e.preventDefault();
    storage.whenIdle().finally(() => {
      quitReady = true;
      app.quit();
    });
  });
}
