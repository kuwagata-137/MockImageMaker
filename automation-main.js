// automation-main.js — AI の頼みの受け口（automation.js）を、Electron の main とページにつなぐ（第 7 段階）
// 役割:
//  - パイプの受け口を起動のすぐ後に始め、頼みを preload の aiAPI（IPC の ai:request・ai:response）でページの AI の窓口へ渡す。
//    ページの準備（ai:ready）を最大 30 秒待つ。ページを読み直したら、待っている頼みを失敗にする
//  - AI のつながりの数をページへ知らせる（ai:status。窓の上の帯の紫の札に使う）。つながりと窓の見え方の変わり目をタスクトレイに知らせる
//  - 「AI とつなぐ」の窓の登録の文（automation-connect.js）とコピー（IPC の ai:connect-info・ai:copy）
//  - アプリが終わる時を決める（設計書 7-5）: AI のつながりが 0 で窓が見えていなければ 30 秒の時計を回し、実行中の頼みがなければ終わる。
//    AI がつながっている間の窓の × は、終わらずに窓を隠す。「ファイル > 終了」は隠さずに終わる
// 設計は AI設計基盤_設計書.md の 7-3・7-5。やりとりの決まりは automation-protocol.js、パイプの受け口は automation.js。
'use strict';

const { createAutomationServer } = require('./automation');
const { createRenderFinisher } = require('./automation-render');
const { connectInfo } = require('./automation-connect');

const READY_WAIT_MS = 30000; // ページの準備を待つ時間
const IDLE_QUIT_MS = 30000; // AI のつながりが 0 で窓が見えていないとき、終わるまでの時間
// 時間のかかる道具（出力・画像・資料を読む）。受け口の時間切れを 5 分にする
const SLOW_TOOLS = new Set(['export_design', 'export_system_doc', 'export_bdm', 'get_screen_image', 'get_view_image', 'read_material', 'swimlane_from_bdm']);

const fail = (code, message) => ({ ok: false, error: { code, message } });

// background: --background で起動したか。headless: 確かめのための起動（MIM_HEADLESS=1）か。
// renderer: export.js の createPageRenderer（画面の画像と出力を PNG・PDF にする）。
// materials: materials-main.js の initMaterials の戻り値（AI の read_material で資料を読む。第 9 段階の後半）
function initAutomation({ app, ipcMain, getWindow, background = false, headless = false, appVersion, renderer, materials = null }) {
  const render = createRenderFinisher({ app, renderer, headless, materials });
  // 確かめのときだけ、終わるまでの時間を環境変数で縮められる（インストールした版では読まない）
  const idleMs = (headless || !app.isPackaged) && Number(process.env.MIM_IDLE_QUIT_MS) > 0 ? Number(process.env.MIM_IDLE_QUIT_MS) : IDLE_QUIT_MS;
  let quitting = false;
  let showRequested = false; // 確かめ用: 2 つ目の起動で窓を出すよう頼まれたか（headless では窓を出さないので印だけ残す）
  // 窓を出している（show）か隠している（hide・× で隠した）かの印。--background でない起動は、窓を出して始まる。
  // 確かめの起動（headless）は窓を画面に出さないので、この印だけで見えているかを決める（そうしないと、確かめの途中で終わる時計が回って 30 秒で終わる）
  let shownFlag = !background;
  let idleTimer = null;
  let rid = 0;
  const pending = new Map(); // rid → resolve
  const page = { wc: null, ready: false, waiters: [] };
  const stateWatchers = []; // AI のつながり・窓が見えているかが変わったときに呼ぶ（タスクトレイ。automation-tray.js）
  const notifyState = () => stateWatchers.forEach((fn) => fn());

  // ── ページとのやりとり ────────────────────────────────────
  const currentWc = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  };
  function failPending(code, message) {
    for (const resolve of pending.values()) resolve(fail(code, message));
    pending.clear();
  }
  function setReady(ready) {
    page.ready = ready;
    if (!ready) return;
    page.waiters.splice(0).forEach((w) => w(true));
    sendStatus();
  }
  // 窓（webContents）が変わったら、読み直し・落ちたときの見張りを付け直す
  function watch(wc) {
    if (!wc || page.wc === wc) return;
    page.wc = wc;
    page.ready = false;
    const lost = (message) => {
      if (page.wc !== wc) return;
      page.ready = false;
      failPending('page_reloaded', message);
    };
    wc.on('did-start-loading', () => lost('アプリの画面が読み込み直されました。もう一度頼んでください。'));
    wc.on('render-process-gone', () => lost('アプリの画面が止まりました。もう一度頼んでください。'));
    wc.once('destroyed', () => lost('アプリの窓が閉じました。もう一度頼んでください。'));
  }
  function waitReady() {
    watch(currentWc());
    if (page.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), READY_WAIT_MS);
      page.waiters.push((ok) => { clearTimeout(timer); resolve(ok); });
    });
  }
  ipcMain.on('ai:ready', (e) => {
    watch(currentWc());
    if (e.sender === page.wc) setReady(true);
  });
  ipcMain.on('ai:response', (e, msg) => {
    const resolve = msg && pending.get(msg.rid);
    if (!resolve) return; // 時間切れの後に届いた返事は捨てる
    pending.delete(msg.rid);
    resolve(msg.res && typeof msg.res === 'object' ? msg.res : fail('internal', 'アプリの画面からの返事の形が正しくありません。'));
  });

  async function onRequest({ tool, args, session, client }) {
    if (quitting) return fail('quitting', 'アプリを終わらせているところです。少し待ってから、もう一度頼んでください。');
    if (!(await waitReady())) return fail('not_ready', 'アプリの画面の準備ができませんでした。もう一度頼んでください。');
    const wc = page.wc;
    if (!wc || wc.isDestroyed()) return fail('page_reloaded', 'アプリの窓が閉じました。もう一度頼んでください。');
    const id = ++rid;
    const res = await new Promise((resolve) => {
      pending.set(id, resolve);
      wc.send('ai:request', { rid: id, tool, args, session, client });
    });
    return render.finish(res); // 画面の画像・出力は、ここで PNG・PDF にする
  }

  // ── つながりの数と、終わる時 ──────────────────────────────
  const server = createAutomationServer({
    dir: app.getPath('userData'),
    appVersion,
    onRequest,
    isSlow: (tool) => SLOW_TOOLS.has(tool),
    onClientsChanged: () => {
      if (quitting) return; // 終わる途中で閉じたつながりの知らせは拾わない
      sendStatus();
      notifyState();
      reconsiderIdle();
    },
    // onScreen: 窓が本当に画面に出ているか（確かめ用。headless でも、覚えた最大化などで窓が出てしまっていないかを見る）
    onStatus: () => ({ visible: windowVisible(), onScreen: onScreen(), background, showRequested, pageReady: page.ready, idleTimer: !!idleTimer }),
  });

  function sendStatus() {
    const wc = currentWc();
    if (wc && page.ready) wc.send('ai:status', { clients: server.clients() });
  }
  function onScreen() {
    const win = getWindow();
    return !!(win && !win.isDestroyed() && win.isVisible());
  }
  // Windows の isVisible() は、最小化した窓で false を返す。最小化しているだけの人の窓は見えているとみなす（30 秒で終わらせない）。
  // × で隠した窓は、最小化したままでも見えていない（印で見分ける）
  function windowVisible() {
    if (headless) return shownFlag;
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    return win.isVisible() || (shownFlag && win.isMinimized());
  }
  // AI のつながりが 0 で窓が見えていないときだけ時計を回す。時間になっても頼みを実行中なら、もう一回待つ
  function reconsiderIdle() {
    const idle = !quitting && server.clientCount() === 0 && !windowVisible() && !showRequested;
    if (!idle) {
      clearTimeout(idleTimer);
      idleTimer = null;
      return;
    }
    if (idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (server.inflight() > 0) return reconsiderIdle();
      if (server.clientCount() === 0 && !windowVisible() && !showRequested) app.quit();
    }, idleMs);
  }

  app.on('before-quit', () => { quitting = true; clearTimeout(idleTimer); });
  server.start().catch((err) => console.error('[automation] パイプの受け口を始められませんでした:', err));

  // 「AI とつなぐ」の窓（ページ）に出す登録の文と、その「コピー」（第 7 段階。q49）
  ipcMain.handle('ai:connect-info', () => connectInfo({ packaged: app.isPackaged, execPath: process.execPath, resourcesPath: process.resourcesPath, root: __dirname }));
  ipcMain.handle('ai:copy', (_e, text) => {
    require('electron').clipboard.writeText(String(text == null ? '' : text));
    return true;
  });

  return {
    clientCount: () => server.clientCount(),
    clients: () => server.clients(),
    windowVisible,
    onStateChange: (fn) => stateWatchers.push(fn),
    // 窓の × で、終わらずに窓を隠すか（AI がつながっていて、「ファイル > 終了」でないとき）
    shouldHideOnClose: () => !quitting && server.clientCount() > 0,
    // 窓を出した（shown: true）・隠した（false）ときに呼ぶ（終わる時計とタスクトレイを見直す）
    windowShownOrHidden: (shown) => {
      if (typeof shown === 'boolean') shownFlag = shown;
      reconsiderIdle();
      if (!quitting) notifyState();
    },
    // 2 つ目の起動で窓を出すよう頼まれた（headless のときの確かめ用の印）
    noteShowRequested: () => { showRequested = true; reconsiderIdle(); },
    // 窓を作った後に呼ぶ（--background の起動では、窓を出さないまま時計を回し始める）
    windowCreated: () => { watch(currentWc()); reconsiderIdle(); },
    stop: () => { quitting = true; clearTimeout(idleTimer); return server.stop(); },
  };
}

module.exports = { initAutomation, SLOW_TOOLS };
