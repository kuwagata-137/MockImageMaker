// bdm-materials-main.js — MPD（MultipurposeDiagramMaker で保存した HTML）の資料の、main の側の受け口の中身
// （第 9 段階の後半の「スイムレーン図の案」を materials-main.js から移し、第 11 段階の「MPD に出力」を足した。IPC の登録は materials-main.js）
//  - plan({ systemId, file }): 資料の MPD を読んで、スイムレーン図の案を返す（materials:bdmPlan）
//  - build({ systemId, file, plan }): 資料の MPD を元に、出力する HTML を作る → { html, warnings, counts }（bdm-export.js。AI の export_bdm の仕上げと saveExport が使う）
//  - saveExport(e, { systemId, file, plan, name }): build してから保存の窓（export.js の askSavePath）で書く → { ok, path, warnings, counts }（materials:bdmExport）
//    HTML を作れないとき（図の中身がない・作業がないなど）は、保存の窓を出す前に断る。保存の先がアプリのデータのフォルダ（<userData>/data）の中なら断る
//    （資料の元のファイルを上書きしないため）。元の資料のファイルは書き換えない
// 失敗は MaterialError で投げる（materials-main.js の guarded が { ok: false, error } にする）。文にパスを入れない。
'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { MaterialError } = require('./material-error');

// file が dir の中（dir そのものを含む）か
function isInside(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
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
    const file = await askSavePath(e, { title: 'MPD に出力する', name: req.name, ext: 'html', label: 'HTML ファイル' });
    if (!file) return { ok: false, canceled: true };
    if (isInside(dataDir, file)) throw new MaterialError('bad_name', 'アプリのデータのフォルダには保存できません。別のフォルダを選んでください。');
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

module.exports = { createBdmMaterials };
