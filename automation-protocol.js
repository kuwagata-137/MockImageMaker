// automation-protocol.js — AI の入口（mcp-server.js）とアプリ（automation.js）の両方が使う、パイプのやりとりの決まり（第 7 段階）
// 役割:
//  - パイプの名前（Windows は名前付きパイプ、ほかは Unix ソケットのファイル）と合言葉を作る
//  - 1 行に 1 つの JSON を読む（readLines）・書く（sendLine）
//  - <userData>/automation.json（パイプの名前・合言葉・pid など）を読み書きする
// Node の標準の部品だけを使う（入口は ELECTRON_RUN_AS_NODE で Node として動くため、Electron に頼らない）。
// 設計は AI設計基盤_設計書.md の 7-3。
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const fsp = fs.promises;
const PROTOCOL = 1; // やりとりの決まりの番号。決まりを変えたら上げる
const AUTOMATION_FILE = 'automation.json';
const MAX_LINE_BYTES = 16 * 1024 * 1024; // 1 行の大きさの上限（画面の画像の返事が入る大きさ）
const SOCKET_PATH_MAX = 100; // Unix ソケットの道の長さの上限（Linux 107・macOS 103 バイト）より少し短く

// パイプの道。Windows 以外で dir の中の道が長すぎるときは、一時フォルダに置く（長いと listen できないため）
function pipePathFor(id, dir) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\mockimagemaker-${id}`;
  const name = `mim-${id}.sock`;
  const p = path.resolve(dir, name);
  return Buffer.byteLength(p) <= SOCKET_PATH_MAX ? p : path.join(os.tmpdir(), name);
}

const newPipeId = () => crypto.randomBytes(8).toString('hex'); // 16 字（ソケットの道に収まる短さ）
const newToken = () => crypto.randomBytes(32).toString('hex'); // 64 字

// 1 行に 1 つの JSON を読み、onMessage(値) を呼ぶ。行は改行（\n）で区切り、前後の空白（\r も）は外し、空の行は飛ばす。
// 1 行が maxBytes を超えたら socket を壊す（改行なしで大きな塊を送られても、溜める量に上限を付けるため）。
// JSON でない行・上限を超えた行・onMessage の中の例外は onError(err, line) へ渡す（onError がなければ、例外だけ console.error に出す）。
function readLines(socket, onMessage, { maxBytes = MAX_LINE_BYTES, onError } = {}) {
  let parts = []; // まだ改行の来ていない行の切れ端（字が切れ端の境目で割れていてもよいように、Buffer のまま溜める）
  let size = 0;
  let dead = false;

  const deliver = (buf) => {
    const line = buf.toString('utf8').trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      if (onError) onError(err, line);
      return;
    }
    try {
      onMessage(msg);
    } catch (err) {
      if (onError) onError(err, line);
      else console.error('[automation] 行の処理で失敗しました:', err);
    }
  };

  const tooLong = () => {
    dead = true;
    parts = [];
    size = 0;
    socket.destroy();
    if (onError) onError(new Error(`1 行が上限（${maxBytes} バイト）を超えました。`));
  };

  socket.on('data', (chunk) => {
    let start = 0;
    while (!dead) {
      const nl = chunk.indexOf(0x0a, start);
      const piece = chunk.subarray(start, nl === -1 ? chunk.length : nl);
      if (size + piece.length > maxBytes) return tooLong();
      if (nl === -1) {
        if (piece.length) {
          parts.push(piece);
          size += piece.length;
        }
        return;
      }
      parts.push(piece);
      const buf = Buffer.concat(parts, size + piece.length);
      parts = [];
      size = 0;
      start = nl + 1;
      deliver(buf);
      if (socket.destroyed) dead = true; // onMessage の中で切ったら、残りの行は読まない
    }
  });
}

// obj を JSON にして 1 行で書く。socket が閉じていれば何もせず false を返す（JSON にできない obj は例外を投げる）
function sendLine(socket, obj) {
  if (!socket || socket.destroyed || !socket.writable) return false;
  socket.write(JSON.stringify(obj) + '\n');
  return true;
}

// ── automation.json ─────────────────────────────────────────
const automationFile = (dir) => path.join(dir, AUTOMATION_FILE);

// Windows では、ほかのプログラム（ウイルス対策など）が一瞬つかんでいて rename が失敗することがあるので、少し待って何回かやり直す
async function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (err) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// info = { pipe, token, pid, appVersion, protocol, startedAt }。tmp に書いてから rename する（読む側が書きかけを読まないように）
async function writeAutomationFile(dir, info) {
  await fsp.mkdir(dir, { recursive: true });
  const file = automationFile(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  return file;
}

// 中身を返す。ない・壊れている（JSON でない・pipe と token がない）ときは null
function readAutomationFile(dir) {
  try {
    const info = JSON.parse(fs.readFileSync(automationFile(dir), 'utf8'));
    if (!info || typeof info.pipe !== 'string' || typeof info.token !== 'string') return null;
    return info;
  } catch (_) {
    return null;
  }
}

// ファイルの pid が pid のときだけ消す（後から起動した別のアプリのファイルを消さないため）。消したら true
function removeAutomationFile(dir, pid = process.pid) {
  const info = readAutomationFile(dir);
  if (!info || info.pid !== pid) return false;
  try {
    fs.unlinkSync(automationFile(dir));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  PROTOCOL,
  AUTOMATION_FILE,
  MAX_LINE_BYTES,
  pipePathFor,
  newPipeId,
  newToken,
  readLines,
  sendLine,
  writeAutomationFile,
  readAutomationFile,
  removeAutomationFile,
};
