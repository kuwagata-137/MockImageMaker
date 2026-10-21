// bdm-materials-main.js — MPD（MultipurposeDiagramMaker で保存した HTML）の資料の、main の側の受け口の中身
// （第 9 段階の後半の「スイムレーン図の案」を materials-main.js から移し、第 11 段階の「MPD に出力」を足した。IPC の登録は materials-main.js）
//  - plan({ systemId, file }): 資料の MPD を読んで、スイムレーン図の案を返す（materials:bdmPlan）
//  - build({ systemId, file, plan }): 資料の MPD を元に、出力する HTML を作る → { html, warnings, counts }（bdm-export.js。AI の export_bdm の仕上げと saveExport が使う）
//  - saveExport(e, { systemId, file, plan, name }): build してから保存の窓（export.js の askSavePath）で書く → { ok, path, warnings, counts }（materials:bdmExport）
//    HTML を作れないとき（図の中身がない・作業がないなど）は、保存の窓を出す前に断る。保存の先がアプリのデータのフォルダ（<userData>/data）の中なら断る
//    （資料の元のファイルを上書きしないため）。元の資料のファイルは書き換えない。
//    保存の窓を開く前と閉じた後に、頼んだページへ materials:saveDialog（{ open }）を送る（ページは、開いている間は返事を待つ時間を数えない）
// 失敗は MaterialError で投げる（materials-main.js の guarded が { ok: false, error } にする）。文にパスを入れない。
'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { MaterialError } = require('./material-error');

// p の本当の場所（ジャンクション・シンボリックリンク・8.3 形式の短い名前をほどく）。まだないファイルは、入るフォルダの本当の場所に名前をつなぐ。
// フォルダもなければ path.resolve のまま
async function realPathOf(p) {
  const abs = path.resolve(p);
  try {
    return await fsp.realpath(abs);
  } catch {
    try {
      return path.join(await fsp.realpath(path.dirname(abs)), path.basename(abs));
    } catch {
      return abs;
    }
  }
}

// file が dir の中（dir そのものを含む）か。どちらも本当の場所にそろえてから比べる。「..memo.html」のような「..」で始まる名前は中に数える
async function isInside(dir, file) {
  const rel = path.relative(await realPathOf(dir), await realPathOf(file));
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// files: 置き場（material-files.js）・bdm: { planFromHtml, exportHtml }（createReadingParts()。null なら unavailable）・
// fileFailure: fs の失敗をパスのない MaterialError にする関数・askSavePath: 保存の窓（export.js の initExport の戻り値。null なら saveExport は unavailable）・dataDir: <userData>/data
function createBdmMaterials({ files, bdm, fileFailure, unavailableMessage, askSavePath = null, dataDir }) {
  const need = (name) => {
    if (!bdm || typeof bdm[name] !== 'function') throw new MaterialError('unavailable', unavailableMessage);
  };

  async function readHtml({ systemId, file }) {
    const filePath = files.pathOf(systemId, file);
    try {
      return await fsp.readFile(filePath, 'utf8');
    } catch (err) {
      throw fileFailure(err);
    }
  }

  async function plan(req) {
    need('planFromHtml');
    return bdm.planFromHtml(await readHtml(req));
  }

  async function build(req) {
    need('exportHtml');
    return bdm.exportHtml(await readHtml(req), req.plan);
  }

  async function saveExport(e, req) {
    if (!askSavePath) throw new MaterialError('unavailable', '保存の窓を使えません。アプリを起動し直してください。');
    const out = await build(req);
    tellSaveDialog(e, true);
    let file;
    try {
      file = await askSavePath(e, { title: 'MPD に出力する', name: req.name, ext: 'html', label: 'HTML ファイル' });
    } finally {
      tellSaveDialog(e, false);
    }
    if (!file) return { ok: false, canceled: true };
    if (await isInside(dataDir, file)) throw new MaterialError('bad_name', 'アプリのデータのフォルダには保存できません。別のフォルダを選んでください。');
    try {
      await fsp.writeFile(file, out.html, 'utf8');
    } catch (err) {
      console.warn('MPD を書けませんでした:', err);
      throw new MaterialError('write_failed', 'ファイルを書けませんでした（書き込みの許可がないか、ほかのアプリで開いているかもしれません）。');
    }
    return { ok: true, path: file, warnings: out.warnings, counts: out.counts };
  }

  return { plan, build, saveExport };
}

// 保存の窓を開く前（open: true）と閉じた後（open: false）に、頼んだページへ知らせる（ページは、保存の窓が開いている間は返事を待つ時間を数えない。
// デバッグとリリースの直し①。preload.js の materialsAPI.onSaveDialog）。頼んだページがない（e が null）・閉じた窓には送らない
function tellSaveDialog(e, open) {
  const sender = e && e.sender;
  if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) return;
  sender.send('materials:saveDialog', { open });
}

module.exports = { createBdmMaterials };
