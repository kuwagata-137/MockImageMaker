// export.js — メインプロセス側の出力と取り込み（第 5 段階。PDF の出力は CheckListMaker の main.js を手本にした）
// 役割:
//  - HTML の出力（export:saveHtml）: 保存の窓 → 書く
//  - PDF（export:pdf）: 保存の窓 → ページ側で組んだ印刷用の HTML を一時ファイルに書き、窓を出さない別の窓で開く
//    → 字の形が整うのを待つ → printToPDF（用紙の大きさはインチで渡す。余白 0・背景の色も出す）→ 書く → 開く
//  - PNG（export:png）: 画面ごとの HTML を、画面の外で描く窓（offscreen）で 2 倍の細かさに描いて撮る。
//    1 枚なら保存の窓、2 枚以上ならフォルダを選ぶ（同じ名前のファイルがあれば、まとめて 1 回確かめる）
//  - HTML の取り込み（export:openHtml）: 開く窓 → 読む（アプリのメニューからも開けるように、ページの input でなく main で開く）
// 確かめの道具（tools/check-export.js）のため、MIM_HEADLESS=1 のときだけ、環境変数 MIM_EXPORT_DIR があれば窓を出さずにそこへ書き（PDF も開かない）、
// MIM_IMPORT_FILE があれば開く窓を出さずにそのファイルを読む。
// ページ側の対になる処理は mock_v*.html の「8. 出力と取り込み」。
// HTML を PDF・PNG にする所は createPageRenderer に分けてあり、AI の出力と画面の画像（automation-main.js）でも使う（第 7 段階）。
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { BrowserWindow, dialog, shell } = require('electron');

const fsp = fs.promises;
const OPEN_MAX_BYTES = 50 * 1024 * 1024; // 取り込む HTML の大きさの上限
const PNG_SCALE = 2; // PNG の細かさ（2 倍）
const PNG_MAX_SIDE = 16000; // PNG の長い辺の上限（ピクセル）。超えるときは細かさを下げる
const PAINT_TIMEOUT = 20000;

// ファイルの名前に使えない字を「_」にする（ページ側でも直しているが、念のため）
function safeName(name, fallback) {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  if (!s) return fallback;
  // 長いときは、拡張子（.png など）を残して前のほうを切る
  const ext = (/\.[A-Za-z0-9]{1,5}$/.exec(s) || [''])[0];
  const base = s.slice(0, s.length - ext.length).slice(0, 120 - ext.length).replace(/[. ]+$/, '');
  return base ? base + ext : fallback;
}
const errText = (err) => String((err && err.message) || err);

// 印刷用の HTML を PDF・PNG にする（出力の窓と、AI の出力・画面の画像〔automation-main.js。第 7 段階〕の両方で使う）
function createPageRenderer(app) {
  // HTML を一時ファイルに書き、窓を出さない窓で開いて fn(win) を呼ぶ。終わったら窓と一時ファイルを片付ける
  async function withPageWindow(html, winOpts, fn) {
    const dir = path.join(app.getPath('temp'), 'mockimagemaker-export');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `page-${process.pid}-${crypto.randomBytes(6).toString('hex')}.html`);
    await fsp.writeFile(file, html, 'utf8');
    const win = new BrowserWindow({
      show: false,
      ...winOpts,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, ...(winOpts.webPreferences || {}) },
    });
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await win.loadFile(file);
      // 字の形（フォント）が整うのを待つ（整う前に印刷すると、字の幅がずれるため）
      await win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true', true);
      return await fn(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
      fsp.unlink(file).catch(() => {});
    }
  }

  // pageSize は用紙の大きさ { width, height }（インチ）
  function renderPdf({ html, pageSize }) {
    return withPageWindow(String(html), { width: 1280, height: 900 }, (win) => win.webContents.printToPDF({
      pageSize: { width: Number(pageSize.width), height: Number(pageSize.height) },
      landscape: false, // 幅と高さをそのまま渡している（横の用紙は幅が大きい）
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }));
  }

  // 画面 1 つ分の HTML を、画面の外で描く窓で細かさ scale 倍（長い辺が maxSide ピクセルを超えるときは下げる）に描いて撮る。
  // 窓の大きさは画面より大きくできないことがあるので、Chromium の開発者向けの命令（debugger）で表示の大きさを中身に合わせ、
  // 範囲を決めて撮る（Puppeteer の撮り方と同じ）
  function renderPng({ html, width, height, scale = PNG_SCALE, maxSide = PNG_MAX_SIDE }) {
    const w = Math.max(1, Math.ceil(Number(width) || 1));
    const h = Math.max(1, Math.ceil(Number(height) || 1));
    const k = Math.min(scale, maxSide / Math.max(w, h));
    return withPageWindow(String(html), { width: 800, height: 600, webPreferences: { offscreen: true } }, async (win) => {
      const dbg = win.webContents.debugger;
      dbg.attach('1.3');
      try {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: k, mobile: false });
        await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 255, b: 255, a: 1 } });
        const shot = await Promise.race([
          dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('画面を撮るのに時間がかかりすぎました')), PAINT_TIMEOUT)),
        ]);
        const buf = Buffer.from(shot.data, 'base64');
        if (!buf.length) throw new Error('画面を撮れませんでした');
        return buf;
      } finally {
        try { dbg.detach(); } catch (_) { /* もう外れている */ }
      }
    });
  }

  return { renderPdf, renderPng };
}

function initExport(app, ipcMain, { headless = false, renderer = createPageRenderer(app) } = {}) {
  const fixedDir = headless && process.env.MIM_EXPORT_DIR ? path.resolve(process.env.MIM_EXPORT_DIR) : null;
  const fixedImport = headless && process.env.MIM_IMPORT_FILE ? path.resolve(process.env.MIM_IMPORT_FILE) : null;
  let lastDir = null; // 前に保存・読み込みしたフォルダ（アプリを閉じるまで覚える）
  const startDir = () => lastDir || app.getPath('documents');
  const winOf = (e) => BrowserWindow.fromWebContents(e.sender);

  // 保存の窓。戻り値は書く先のパス（キャンセルは null）
  async function askSavePath(e, { title, name, ext, label }) {
    const fileName = safeName(name, 'export.' + ext);
    if (fixedDir) {
      await fsp.mkdir(fixedDir, { recursive: true });
      return path.join(fixedDir, fileName);
    }
    const r = await dialog.showSaveDialog(winOf(e), { title, defaultPath: path.join(startDir(), fileName), filters: [{ name: label, extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    lastDir = path.dirname(r.filePath);
    return r.filePath;
  }

  ipcMain.handle('export:saveHtml', async (e, { name, html }) => {
    try {
      const file = await askSavePath(e, { title: 'HTML の保存先を選ぶ', name, ext: 'html', label: 'HTML ファイル' });
      if (!file) return { ok: false, canceled: true };
      await fsp.writeFile(file, String(html), 'utf8');
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  ipcMain.handle('export:pdf', async (e, { name, html, pageSize, open }) => {
    try {
      const file = await askSavePath(e, { title: 'PDF の保存先を選ぶ', name, ext: 'pdf', label: 'PDF' });
      if (!file) return { ok: false, canceled: true };
      const data = await renderer.renderPdf({ html, pageSize });
      await fsp.writeFile(file, data);
      if (open && !headless) {
        const msg = await shell.openPath(file);
        if (msg) console.warn('PDF を開けませんでした:', msg);
      }
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  ipcMain.handle('export:png', async (e, { files }) => {
    try {
      if (!Array.isArray(files) || !files.length) return { ok: false, error: '出力する画面がありません' };
      let targets;
      if (fixedDir) {
        await fsp.mkdir(fixedDir, { recursive: true });
        targets = files.map((f) => ({ file: path.join(fixedDir, safeName(f.name, 'screen.png')), page: f }));
      } else if (files.length === 1) {
        const file = await askSavePath(e, { title: 'PNG の保存先を選ぶ', name: files[0].name, ext: 'png', label: 'PNG 画像' });
        if (!file) return { ok: false, canceled: true };
        targets = [{ file, page: files[0] }];
      } else {
        const r = await dialog.showOpenDialog(winOf(e), { title: 'PNG を保存するフォルダを選ぶ', defaultPath: startDir(), properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
        const dir = r.filePaths[0];
        lastDir = dir;
        targets = files.map((f) => ({ file: path.join(dir, safeName(f.name, 'screen.png')), page: f }));
        const exists = targets.filter((t) => fs.existsSync(t.file));
        if (exists.length) {
          const ans = await dialog.showMessageBox(winOf(e), {
            type: 'question', buttons: ['ファイルを上書きする', 'キャンセル'], defaultId: 1, cancelId: 1, title: 'PNG の保存先を選ぶ',
            message: `同じ名前のファイルが ${exists.length} つあります。上書きしますか？`,
            detail: exists.slice(0, 10).map((t) => path.basename(t.file)).join('\n') + (exists.length > 10 ? '\n…' : ''),
          });
          if (ans.response !== 0) return { ok: false, canceled: true };
        }
      }
      for (const t of targets) await fsp.writeFile(t.file, await renderer.renderPng({ html: t.page.html, width: t.page.width, height: t.page.height }));
      return { ok: true, count: targets.length, path: targets[0].file, dir: path.dirname(targets[0].file) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  ipcMain.handle('export:openHtml', async (e) => {
    try {
      let file = fixedImport;
      if (!file) {
        const r = await dialog.showOpenDialog(winOf(e), { title: 'HTML を取り込む', defaultPath: startDir(), filters: [{ name: 'HTML ファイル', extensions: ['html', 'htm'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
        file = r.filePaths[0];
      }
      const st = await fsp.stat(file);
      if (st.size > OPEN_MAX_BYTES) return { ok: false, error: 'ファイルが大きすぎます（50MB まで）' };
      lastDir = path.dirname(file);
      return { ok: true, text: await fsp.readFile(file, 'utf8'), name: path.basename(file) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  return { askSavePath }; // 資料の置き場の「MPD に出力」（bdm-materials-main.js）も同じ保存の窓を使う（前のフォルダを覚える・確かめの起動では MIM_EXPORT_DIR）
}

module.exports = { initExport, createPageRenderer, safeName };
