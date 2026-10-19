// material-text.js — 文字の資料を文字にする（文字コードの判定）と、文の重みの数え方・長い文の分け方
// 役割:
//  - decodeText: 資料のバイト列を文字にする。BOM つきの UTF-8・UTF-16LE・UTF-16BE はその形で、
//    BOM がなければ UTF-8 として読めるときは UTF-8・読めなければ Shift_JIS で読む。改行は \n にそろえる
//  - textWeight・splitText: 1 回の返事に入れる量（重み）を数え、1 つの塊が重くなりすぎるとき改行の所で分ける（material-reader.js が使う）
//  - Electron に触らない。node だけでテストできる
// 重みは「ASCII の字 0.3・それ以外の字 1」を 10 倍した整数で数える（0.3 の足し算の丸め誤差で上限の判定がずれないように）。
'use strict';

const WEIGHT_SCALE = 10;
const ASCII_WEIGHT = 3;
const OTHER_WEIGHT = 10;
const NEWLINE_WEIGHT = ASCII_WEIGHT;

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function startsWith(buf, signature) {
  return buf.length >= signature.length && signature.every((byte, i) => buf[i] === byte);
}

function decodeBytes(buf) {
  if (startsWith(buf, UTF8_BOM)) return new TextDecoder('utf-8').decode(buf.subarray(UTF8_BOM.length));
  if (startsWith(buf, UTF16LE_BOM)) return new TextDecoder('utf-16le').decode(buf.subarray(UTF16LE_BOM.length));
  if (startsWith(buf, UTF16BE_BOM)) return new TextDecoder('utf-16be').decode(buf.subarray(UTF16BE_BOM.length));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

// バイト列（Buffer・Uint8Array）→ 文字。改行（\r\n・\r）は \n にそろえる。
function decodeText(bytes) {
  return decodeBytes(toBuffer(bytes)).replace(/\r\n?/g, '\n');
}

// 文の重み（10 倍した整数）。字は 1 字ずつ（サロゲートペアは 1 字）数える。
function textWeight(text) {
  let weight = 0;
  for (const ch of text) weight += ch.codePointAt(0) < 128 ? ASCII_WEIGHT : OTHER_WEIGHT;
  return weight;
}

// 1 行が上限を超えるとき、重みの上限ごとに字で切る（サロゲートペアの途中では切らない）
function cutLine(line, maxWeight) {
  if (textWeight(line) <= maxWeight) return [line];
  const parts = [];
  let part = '';
  let weight = 0;
  for (const ch of line) {
    const charWeight = ch.codePointAt(0) < 128 ? ASCII_WEIGHT : OTHER_WEIGHT;
    if (weight + charWeight > maxWeight) {
      parts.push(part);
      part = '';
      weight = 0;
    }
    part += ch;
    weight += charWeight;
  }
  parts.push(part);
  return parts;
}

// 文を、重みが maxWeight 以下の塊の並びに分ける。行を詰めていき、上限を超える手前の改行で分ける
// （塊を \n でつなぐと元の文に戻る。1 行が上限を超えるときだけ、その行の中で切る）。空の文は空の並び。
function splitText(text, maxWeight) {
  const pieces = [];
  let lines = [];
  let weight = 0;
  for (const line of text.split('\n')) {
    for (const part of cutLine(line, maxWeight)) {
      const partWeight = textWeight(part);
      const added = partWeight + (lines.length ? NEWLINE_WEIGHT : 0);
      if (lines.length && weight + added > maxWeight) {
        pieces.push(lines.join('\n'));
        lines = [];
        weight = 0;
      }
      weight += partWeight + (lines.length ? NEWLINE_WEIGHT : 0);
      lines.push(part);
    }
  }
  pieces.push(lines.join('\n'));
  return pieces.filter((piece) => piece !== '');
}

module.exports = { WEIGHT_SCALE, decodeText, textWeight, splitText };
