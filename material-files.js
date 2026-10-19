// material-files.js — 資料（システムに入れるファイル）の置き場
// 役割:
//  - 人が選んだファイルを <root>/<システムの id>/<資料の id>.<拡張子> に写す（root は <userData>/data/files）。
//    写す途中は <名前>.part に書き、終わってから名前を変える（途中で落ちても、半端なファイルが資料として残らない）
//  - システムを完全に削除したとき、フォルダごと消す（removeSystem）
//  - ページの資料の一覧にないファイルを掃除する（sweep。.part・どの一覧にもないファイル・どの一覧にもないシステムのフォルダ）。
//    この起動で入れたファイルは、一覧になくても必ず残す（入れた直後に、古い一覧で掃除が来ても消さないため。呼ぶ時をページに頼らない）。
//    一覧から消した行のファイルは、次の起動の掃除で消える
//  - 写す・消す・掃除するは 1 つずつ行う（掃除が、写している途中の .part を消さないため）
//  - Electron に触らない。node だけでテストできる
// ファイルの中身は designs.json に入れない。ページは資料の行（id・名前・種類・大きさ・file）だけを持つ。
// 返す文・失敗の文に、パソコンの中のファイルの場所（パス）を入れない（fs の失敗の文はパスを含むので、そのまま返さない）。
// 消すときは unlinkSync と rmdirSync だけを使う（fs.rmSync は、Windows の Node v24.12.0 で日本語の名前のファイルを渡すと Node ごと落ちる）。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectKind, storedName, MATERIAL_MAX_BYTES } = require('./material-kind');
const { MaterialError } = require('./material-error');

const fsp = fs.promises;

// システムの id は y- ＋英数字と -（ページの newId('y')）。資料のファイルの名前は m-<資料の id>.<拡張子>（storedName の形）
const SYSTEM_ID_PATTERN = /^y-[A-Za-z0-9-]{1,80}$/;
const STORED_FILE_PATTERN = /^m-[A-Za-z0-9-]{1,80}\.[a-z0-9]{1,8}$/;
const PART_SUFFIX = '.part';
const HEAD_BYTES = 64 * 1024; // 種類を決めるために読む先頭の大きさ（HTML だけは全体）
const HTML_NAME_PATTERN = /\.html?$/i;

const MESSAGE = {
  tooLarge: 'ファイルが大きすぎます（50MB まで）',
  missing: 'ファイルが見つかりません',
  notFile: 'ふつうのファイルではありません',
  unreadable: 'ファイルを読めません',
  copyFailed: 'ファイルを写せませんでした',
  badSource: 'ファイルの指定が正しくありません',
};

function checkSystemId(systemId) {
  if (typeof systemId !== 'string' || !SYSTEM_ID_PATTERN.test(systemId)) {
    throw new MaterialError('bad_name', 'システムの id の形が正しくありません。');
  }
}

// 残すファイルの一覧 { [システムの id]: [file, …] } の形を検める。形が違うものを空の一覧と取り違えて、全部消さないため
function checkKeepList(list) {
  const valid = list !== null && typeof list === 'object' && !Array.isArray(list) && Object.values(list).every(Array.isArray);
  if (!valid) throw new MaterialError('bad_name', '残すファイルの一覧の形が正しくありません。');
}

const hasKey = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const skip = (name, reason) => ({ skipped: { name, reason } });

function listEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    throw new MaterialError('read_failed', '資料のフォルダを読めませんでした。');
  }
}

// フォルダへの印（symlink・junction）はたどらないので、本物のフォルダのときだけ true
function isRealDirectory(dir) {
  try {
    return fs.lstatSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

function tryUnlink(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (_) {
    return false; // 使用中など。残して、次の掃除で消す
  }
}

// フォルダの中のファイルを名前を問わず消してから、フォルダを消す。中のフォルダはたどらない
function removeFolder(dir) {
  let files = 0;
  for (const entry of listEntries(dir)) {
    if (!entry.isDirectory() && tryUnlink(path.join(dir, entry.name))) files += 1;
  }
  try {
    fs.rmdirSync(dir);
    return { files, dirRemoved: true };
  } catch (_) {
    return { files, dirRemoved: false };
  }
}

// 残すフォルダの中の掃除の対象か。置き場がつくる名前（m-….<拡張子>）で一覧にないものと、その .part だけ。ほかの名前には触らない
function isStray(name, keepNames) {
  if (STORED_FILE_PATTERN.test(name)) return !keepNames.has(name);
  return name.endsWith(PART_SUFFIX) && STORED_FILE_PATTERN.test(name.slice(0, -PART_SUFFIX.length));
}

function sweepFolder(dir, keepNames) {
  let removed = 0;
  for (const entry of listEntries(dir)) {
    if (!entry.isDirectory() && isStray(entry.name, keepNames) && tryUnlink(path.join(dir, entry.name))) removed += 1;
  }
  return removed;
}

// 種類を決めるためのバイト。HTML は図のデータの印が後ろにあることがあるので全体、ほかは先頭 64KB
async function readKindBytes(source, name, size) {
  if (HTML_NAME_PATTERN.test(name)) return fsp.readFile(source);
  const handle = await fsp.open(source, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// dest.part に写してから名前を変える。失敗したら .part を消す
async function copyIn(source, dest) {
  const part = dest + PART_SUFFIX;
  try {
    await fsp.copyFile(source, part);
    await fsp.rename(part, dest);
  } catch (err) {
    tryUnlink(part);
    throw err;
  }
}

// root は <userData>/data/files。maxBytes は 1 つのファイルの大きさの上限（確かめでは小さくする）
function createMaterialFiles({ root, maxBytes = MATERIAL_MAX_BYTES }) {
  const rootDir = path.resolve(root);
  const addedThisRun = Object.create(null); // この起動で写したファイル { [システムの id]: [file, …] }（掃除で必ず残す）
  let queue = Promise.resolve();
  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  // 保存したファイルの絶対パス。id・名前の形が合わなければ bad_name（.. や区切りで root の外には出られない）
  function pathOf(systemId, file) {
    checkSystemId(systemId);
    if (typeof file !== 'string' || !STORED_FILE_PATTERN.test(file)) {
      throw new MaterialError('bad_name', '資料のファイルの名前の形が正しくありません。');
    }
    return path.join(rootDir, systemId, file);
  }

  // 1 つのファイルを写す。写せたら { added }、写さなかったら { skipped: { name, reason } }
  async function addOne(systemId, source) {
    if (typeof source !== 'string' || !source) return skip('', MESSAGE.badSource);
    const name = path.basename(source);
    let st;
    try {
      st = await fsp.stat(source);
    } catch (err) {
      return skip(name, err.code === 'ENOENT' ? MESSAGE.missing : MESSAGE.unreadable);
    }
    if (!st.isFile()) return skip(name, MESSAGE.notFile);
    if (st.size > maxBytes) return skip(name, MESSAGE.tooLarge);
    try {
      const { kind, legacy } = detectKind(name, await readKindBytes(source, name, st.size));
      const id = `m-${crypto.randomUUID()}`;
      const file = storedName(id, name);
      await copyIn(source, pathOf(systemId, file));
      (addedThisRun[systemId] = addedThisRun[systemId] || []).push(file);
      return { added: { id, name, kind, size: st.size, file, legacy } };
    } catch (err) {
      console.warn('資料を写せませんでした:', err); // 元の例外（パスを含む）は console にだけ残す。返事の理由は定型の文
      return skip(name, MESSAGE.copyFailed);
    }
  }

  async function addAll(systemId, paths) {
    const result = { added: [], skipped: [] };
    if (!Array.isArray(paths) || !paths.length) return result;
    try {
      await fsp.mkdir(path.join(rootDir, systemId), { recursive: true });
    } catch (_) {
      throw new MaterialError('read_failed', 'システムの資料のフォルダを作れませんでした。');
    }
    for (const source of paths) {
      const one = await addOne(systemId, source);
      if (one.added) result.added.push(one.added);
      else result.skipped.push(one.skipped);
    }
    return result;
  }

  // paths のファイルを systemId のフォルダに写す。戻り値は { added: [{ id, name, kind, size, file, legacy }], skipped: [{ name, reason }] }
  async function addFromPaths(systemId, paths) {
    checkSystemId(systemId);
    return serial(() => addAll(systemId, paths));
  }

  // システムのフォルダをファイルごと消す。戻り値は消したファイルの数。フォルダがなければ 0、フォルダが消せなければ read_failed
  async function removeSystem(systemId) {
    checkSystemId(systemId);
    return serial(() => {
      const dir = path.join(rootDir, systemId);
      if (!isRealDirectory(dir)) return { removed: 0 };
      const { files, dirRemoved } = removeFolder(dir);
      if (!dirRemoved) throw new MaterialError('read_failed', 'システムの資料のフォルダを消せませんでした。');
      delete addedThisRun[systemId];
      return { removed: files };
    });
  }

  // alsoKeep に、この起動で写したファイルを足した一覧（alsoKeep は書き換えない）
  function withAddedThisRun(alsoKeep) {
    const merged = Object.create(null);
    for (const [id, list] of Object.entries(alsoKeep)) merged[id] = list;
    for (const [id, list] of Object.entries(addedThisRun)) merged[id] = (merged[id] || []).concat(list);
    return merged;
  }

  function sweepAll(keep, alsoKeep) {
    const result = { removedFiles: 0, removedDirs: 0 };
    if (!isRealDirectory(rootDir)) return result;
    for (const entry of listEntries(rootDir)) {
      if (!entry.isDirectory() || !SYSTEM_ID_PATTERN.test(entry.name)) continue;
      const dir = path.join(rootDir, entry.name);
      try {
        if (hasKey(keep, entry.name) || hasKey(alsoKeep, entry.name)) {
          const keepNames = new Set([...(keep[entry.name] || []), ...(alsoKeep[entry.name] || [])]);
          result.removedFiles += sweepFolder(dir, keepNames);
          continue;
        }
        const { files, dirRemoved } = removeFolder(dir);
        result.removedFiles += files;
        if (dirRemoved) result.removedDirs += 1;
      } catch (_) {
        /* 読めないフォルダは残す */
      }
    }
    return result;
  }

  // keep・alsoKeep は { [システムの id]: [file, …] }。どちらにもないシステムのフォルダは中ごと消し、
  // 残すフォルダの中では、どちらにもないファイルと .part を消す。この起動で写したファイル（とそのシステムのフォルダ）は、一覧になくても残す。
  // 戻り値は { removedFiles, removedDirs }
  async function sweep(keep, alsoKeep = {}) {
    checkKeepList(keep);
    checkKeepList(alsoKeep);
    return serial(() => sweepAll(keep, withAddedThisRun(alsoKeep))); // 写している最中のものが終わってから、控えを足す
  }

  return { pathOf, addFromPaths, removeSystem, sweep };
}

module.exports = { createMaterialFiles, checkSystemId, SYSTEM_ID_PATTERN, STORED_FILE_PATTERN };
