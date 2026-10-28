// material-image.js — 画像を、AI に渡せる大きさの PNG にする
// 役割:
//  - toPng: 画像（png・jpg・gif・webp・bmp）を、長い辺が maxSide 以下の PNG にする（長い辺が超えるときだけ縮める。大きくはしない）
//  - fitPngToBase64Limit: base64 にして上限（既定 5MB）を超える PNG を、長い辺を 0.75 倍ずつ縮めて作り直す
//  - pngSize: PNG の頭から幅と高さを読む（material-reader.js が、描き終えた PNG の大きさを知るために使う）
//  - loadCanvas: 画像の部品（@napi-rs/canvas）を、画像を描くときに初めて読む（material-pdf.js も使う）。読めないときは、何が使えないかを書いた
//    MaterialError('unavailable')。先頭で読まないのは、パソコンの守りの設定などが .node のファイルを止めたとき、画像の部品を使わない
//    文字・Word・Excel・MPD の資料まで読めなくなるのを防ぐため（デバッグとリリースの直し②。q89）
//  - 画素が 1 億を超える画像は、まるごと読み込む前に、頭（image-size で読む）の幅と高さで断る（MaterialError('too_large')。
//    読み込むと幅×高さ×4 バイトのメモリを使い、main が止まるおそれがあった。デバッグとリリースの見直し③-7）
//  - Electron に触らない。@napi-rs/canvas と image-size だけで動く（node だけでテストできる）
'use strict';

const { imageSize } = require('image-size');
const { MaterialError } = require('./material-error');

const IMAGE_MAX_SIDE = 1566;
const MAX_BASE64_BYTES = 5 * 1024 * 1024;
const SHRINK_FACTOR = 0.75;
const MAX_IMAGE_PIXELS = 100000000; // 1 億画素（読み込むと約 400 MB のメモリを使う）
// PNG の頭: 署名 8 バイト + 長さ 4 バイト + 'IHDR' 4 バイトの次に、幅（4 バイト）と高さ（4 バイト）が続く
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;

function base64Length(bytes) {
  return Math.ceil(bytes.length / 3) * 4;
}

function readFailed() {
  return new MaterialError('read_failed', 'この画像は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
}

const IMAGE_PART_MISSING = '画像を読む機能が、このパソコンでは動きません。画像の資料と、PDF の文字のないページは読めません（文字・Word・Excel・MPD の資料と、PDF の文字は読めます）。';

// 画像の部品。読めたものは 2 回目から使い回す（読めなかったときは控えないので、次に描くときにもう一度読む）。元の例外は cause に残す
let canvasLib = null;
function loadCanvas() {
  if (canvasLib) return canvasLib;
  try {
    canvasLib = require('@napi-rs/canvas');
  } catch (err) {
    const failure = new MaterialError('unavailable', IMAGE_PART_MISSING);
    failure.imagePartMissing = true;
    failure.cause = err;
    throw failure;
  }
  return canvasLib;
}

// 画像の部品が動かないための失敗か（material-reader.js が、PDF の文字のないページの行の文を選ぶために使う）
const isImagePartMissing = (err) => Boolean(err && err.imagePartMissing);

function pngSize(png) {
  if (png.length < HEIGHT_OFFSET + 4) return { width: 0, height: 0 };
  return { width: png.readUInt32BE(WIDTH_OFFSET), height: png.readUInt32BE(HEIGHT_OFFSET) };
}

// 画像の頭から幅と高さを読む。読めないとき（壊れている・知らない形）は null（読み込む部品に任せる）
function headerSize(bytes) {
  try {
    const size = imageSize(bytes);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch (_) {
    return null;
  }
}

async function decodeImage(bytes) {
  const size = headerSize(bytes);
  if (size && size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new MaterialError('too_large', `この画像は画素が多すぎるため（${size.width}×${size.height}）、読めません。画素が 1 億より少なくなるように小さくして保存し直してから、追加し直してください。`);
  }
  const { loadImage } = loadCanvas();
  try {
    return await loadImage(bytes);
  } catch (_) {
    throw readFailed();
  }
}

function drawPng(image, width, height) {
  const canvas = loadCanvas().createCanvas(width, height);
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

module.exports = { IMAGE_MAX_SIDE, toPng, fitPngToBase64Limit, pngSize, loadCanvas, isImagePartMissing };
