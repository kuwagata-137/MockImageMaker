// material-image.js — 画像を、AI に渡せる大きさの PNG にする
// 役割:
//  - toPng: 画像（png・jpg・gif・webp・bmp）を、長い辺が maxSide 以下の PNG にする（長い辺が超えるときだけ縮める。大きくはしない）
//  - fitPngToBase64Limit: base64 にして上限（既定 5MB）を超える PNG を、長い辺を 0.75 倍ずつ縮めて作り直す
//  - pngSize: PNG の頭から幅と高さを読む（material-reader.js が、描き終えた PNG の大きさを知るために使う）
//  - Electron に触らない。@napi-rs/canvas だけで動く（node だけでテストできる）
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { MaterialError } = require('./material-error');

const IMAGE_MAX_SIDE = 1566;
const MAX_BASE64_BYTES = 5 * 1024 * 1024;
const SHRINK_FACTOR = 0.75;
// PNG の頭: 署名 8 バイト + 長さ 4 バイト + 'IHDR' 4 バイトの次に、幅（4 バイト）と高さ（4 バイト）が続く
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;

function base64Length(bytes) {
  return Math.ceil(bytes.length / 3) * 4;
}

function readFailed() {
  return new MaterialError('read_failed', 'この画像は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
}

function pngSize(png) {
  if (png.length < HEIGHT_OFFSET + 4) return { width: 0, height: 0 };
  return { width: png.readUInt32BE(WIDTH_OFFSET), height: png.readUInt32BE(HEIGHT_OFFSET) };
}

async function decodeImage(bytes) {
  try {
    return await loadImage(bytes);
  } catch (_) {
    throw readFailed();
  }
}

function drawPng(image, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return { png: canvas.toBuffer('image/png'), width, height };
}

function scaled(size, scale) {
  return Math.max(1, Math.round(size * scale));
}

// 画像のバイト列 → { png, width, height }。読めない画像は MaterialError('read_failed')
async function toPng(bytes, { maxSide = IMAGE_MAX_SIDE } = {}) {
  const image = await decodeImage(bytes);
  const longSide = Math.max(image.width, image.height);
  const scale = longSide > maxSide ? maxSide / longSide : 1;
  return drawPng(image, scaled(image.width, scale), scaled(image.height, scale));
}

// base64 にして maxBase64Bytes に収まる PNG はそのまま返す。収まらなければ、元の絵から 0.75 倍・0.75² 倍…と縮めて作り直す。
async function fitPngToBase64Limit(png, maxBase64Bytes = MAX_BASE64_BYTES) {
  const { width, height } = pngSize(png);
  if (base64Length(png) <= maxBase64Bytes) return { png, width, height };
  const image = await decodeImage(png);
  for (let step = 1; ; step += 1) {
    const scale = SHRINK_FACTOR ** step;
    const shrunk = drawPng(image, scaled(width, scale), scaled(height, scale));
    if (base64Length(shrunk.png) <= maxBase64Bytes || (shrunk.width === 1 && shrunk.height === 1)) return shrunk;
  }
}

module.exports = { IMAGE_MAX_SIDE, toPng, fitPngToBase64Limit, pngSize };
