// materials-main.js — メインプロセス側の資料（システムに入れるファイル）の受け口（第 9 段階の後半）
// 役割:
//  - ページから IPC で届く資料の頼み 6 つを受ける: materials:pick（開く窓で選んで入れる）・materials:addPaths（落としたファイルを入れる）・
//    materials:read（資料の中身を読む）・materials:bdmPlan（BDM の HTML からスイムレーン図の案を作る）・
//    materials:sweep（一覧にないファイルの掃除）・materials:removeSystem（システムを完全に削除したときのフォルダ消し）
//  - ファイルの置き場（material-files.js）は <userData>/data/files/<システムの id>/。資料の中身は designs.json に入れない
//  - 読む部品 reader（material-reader.js）と BDM を読む部品 bdm（bdm-swimlane.js）は、つなぐまでは null。
//    null のときの読む頼みは unavailable の失敗を返す
//  - finishRead は AI の read_material の仕上げ（automation-render.js から呼ぶ）。画面の窓口と同じ中身を、AI の返事の形で返す
// どの受け口も例外を投げず、{ ok: true, … } か { ok: false, error: { code, message } }（取りやめは { ok: false, canceled: true }）を返す。
// 失敗の文にパソコンの中のファイルの場所（パス）を入れない。MaterialError の文はそのまま、ほかの失敗は定型の文にして、原因は console に残す。
// 確かめの起動（headless か、パッケージにしていない起動）では、環境変数 MIM_MATERIAL_FILES（パスの JSON の並び）があれば、
// 開く窓を出さずにそのファイルを入れる（export.js の MIM_IMPORT_FILE と同じ考え）。
// Electron の dialog・BrowserWindow は使うときだけ読み込む（dialog は引数でも渡せる。テストで Electron なしに動かすため）。
'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { createMaterialFiles, checkSystemId, SYSTEM_ID_PATTERN } = require('./material-files');
const { MaterialError } = require('./material-error');
const { STATE_FILE_NAME } = require('./storage');

const DIALOG_FILTERS = [
  {
    name: '資料（画像・PDF・Word・Excel・HTML・文字）',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'html', 'htm', 'txt', 'csv', 'tsv', 'md', 'json', 'log'],
  },
  { name: 'すべてのファイル', extensions: ['*'] },
];
const UNAVAILABLE_MESSAGE = '資料を読む機能は、まだ使えません。';
const FAILED = { add: '資料を入れられませんでした。', read: '資料を読めませんでした。', cleanup: '資料のファイルを片付けられませんでした。' };

// 失敗を { code, message } にする。MaterialError の文はそのまま。ほかは fallbackMessage の定型文（原因は console に残す）
function errorOf(err, fallbackMessage) {
  if (err instanceof MaterialError) return { code: err.code, message: err.message };
  console.warn('資料の処理で予期しない失敗:', err);
  return { code: 'read_failed', message: fallbackMessage };
}

async function guarded(fallbackMessage, task) {
  try {
    return await task();
  } catch (err) {
    return { ok: false, error: errorOf(err, fallbackMessage) };
  }
}

// fs の失敗（パスを含む文）を、パスを含まない MaterialError にする
function fileFailure(err) {
  if (err && err.code === 'ENOENT') return new MaterialError('file_missing', '資料のファイルが見つかりません。');
  return new MaterialError('read_failed', '資料のファイルを読めませんでした。');
}

// 1 つ前の保存（designs.json.bak）の systems から { [システムの id]: [file, …] } を作る（読めない・形が違うときは空）
async function readPreviousGeneration(storage) {
  let state;
  try {
    state = JSON.parse(await fsp.readFile(path.join(storage.dataDir(), `${STATE_FILE_NAME}.bak`), 'utf8'));
  } catch (_) {
    return {};
  }
  const keep = {};
  for (const system of Array.isArray(state && state.systems) ? state.systems : []) {
    if (!system || typeof system.id !== 'string' || !SYSTEM_ID_PATTERN.test(system.id)) continue;
    const materials = Array.isArray(system.materials) ? system.materials : [];
    keep[system.id] = (keep[system.id] || []).concat(materials.map((m) => m && m.file).filter((f) => typeof f === 'string'));
  }
  return keep;
}

// 確かめの起動で窓を出さずに入れるファイル（MIM_MATERIAL_FILES の JSON の並び）。使わないときは null
function fixedFilesOf(checking) {
  if (!checking || !process.env.MIM_MATERIAL_FILES) return null;
  let list;
  try {
    list = JSON.parse(process.env.MIM_MATERIAL_FILES);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(list)) return null;
  return list.filter((p) => typeof p === 'string' && p).map((p) => path.resolve(p));
}

// reader の返事を、ページへ返す形にする。画像の PNG（Buffer）は base64 の文字にする
function plainResult(r) {
  return {
    notice: r.notice,
    part: r.part,
    text: r.text,
    images: (r.images || []).map((img) => ({ page: img.page, width: img.width, height: img.height, data: Buffer.from(img.png).toString('base64') })),
    nextCursor: r.nextCursor == null ? null : r.nextCursor,
  };
}

// storage は initStorage の戻り値（whenIdle・dataDir）。reader は { read }、bdm は { planFromHtml }（つなぐまでは null）。
// 戻り値は { files（置き場）, finishRead(render)（AI の read_material の仕上げ）}
function initMaterials({ app, ipcMain, storage, headless = false, reader = null, bdm = null, dialog = null }) {
  const files = createMaterialFiles({ root: path.join(storage.dataDir(), 'files') });
  const checking = headless || !app.isPackaged; // 確かめの起動か
  let lastDir = null; // 前に資料を選んだフォルダ（アプリを閉じるまで覚える）

  function ownerWindow(e) {
    if (!e || !e.sender) return undefined;
    return require('electron').BrowserWindow.fromWebContents(e.sender) || undefined;
  }

  // 開く窓（いくつでも選べる）。戻り値は選んだパスの並び（取りやめは null）
  async function askPaths(e) {
    const options = { title: '資料を入れる', defaultPath: lastDir || app.getPath('documents'), filters: DIALOG_FILTERS, properties: ['openFile', 'multiSelections'] };
    const electronDialog = dialog || require('electron').dialog;
    const owner = ownerWindow(e);
    const answer = owner ? await electronDialog.showOpenDialog(owner, options) : await electronDialog.showOpenDialog(options);
    if (answer.canceled || !answer.filePaths.length) return null;
    lastDir = path.dirname(answer.filePaths[0]);
    return answer.filePaths;
  }

  async function pick(e, req) {
    const systemId = req && req.systemId;
    checkSystemId(systemId); // 窓を出す前に断る
    const paths = fixedFilesOf(checking) || (await askPaths(e));
    if (!paths) return { ok: false, canceled: true };
    return { ok: true, ...(await files.addFromPaths(systemId, paths)) };
  }

  async function readMaterial({ systemId, file, kind, name, cursor }) {
    if (!reader) throw new MaterialError('unavailable', UNAVAILABLE_MESSAGE);
    const filePath = files.pathOf(systemId, file);
    return plainResult(await reader.read({ path: filePath, kind, name, cursor: cursor == null ? null : cursor }));
  }

  async function bdmPlan({ systemId, file }) {
    if (!bdm) throw new MaterialError('unavailable', UNAVAILABLE_MESSAGE);
    const filePath = files.pathOf(systemId, file);
    let html;
    try {
      html = await fsp.readFile(filePath, 'utf8');
    } catch (err) {
      throw fileFailure(err);
    }
    return bdm.planFromHtml(html);
  }

  ipcMain.handle('materials:pick', (e, req) => guarded(FAILED.add, () => pick(e, req)));
  ipcMain.handle('materials:addPaths', (_e, req) => guarded(FAILED.add, async () => ({ ok: true, ...(await files.addFromPaths(req && req.systemId, req && req.paths)) })));
  ipcMain.handle('materials:read', (_e, req) => guarded(FAILED.read, async () => ({ ok: true, result: await readMaterial(req || {}) })));
  ipcMain.handle('materials:bdmPlan', (_e, req) => guarded(FAILED.read, async () => ({ ok: true, plan: await bdmPlan(req || {}) })));
  // 保存の書き込みが終わってから行う（掃除は、1 つ前の保存〔.bak〕の資料と、この起動で入れた資料〔files.sweep が控えている〕も残す）
  ipcMain.handle('materials:sweep', (_e, req) => guarded(FAILED.cleanup, async () => {
    await storage.whenIdle();
    return { ok: true, ...(await files.sweep(req && req.keep, await readPreviousGeneration(storage))) };
  }));
  ipcMain.handle('materials:removeSystem', (_e, req) => guarded(FAILED.cleanup, async () => {
    await storage.whenIdle();
    return { ok: true, ...(await files.removeSystem(req && req.systemId)) };
  }));

  // AI の read_material の仕上げ。render は { kind: 'material', systemId, file, materialKind, name, cursor }
  function finishRead(render) {
    const req = render || {};
    return guarded(FAILED.read, async () => {
      const r = await readMaterial({ systemId: req.systemId, file: req.file, kind: req.materialKind, name: req.name, cursor: req.cursor });
      const images = r.images.map(({ page, width, height }) => ({ page, width, height }));
      return { ok: true, content: { notice: r.notice, part: r.part, text: r.text, images, nextCursor: r.nextCursor }, images: r.images.map((img) => img.data) };
    });
  }

  return { files, finishRead };
}

module.exports = { initMaterials };
