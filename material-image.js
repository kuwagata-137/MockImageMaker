// material-image.js — 画像を、AI に渡せる大きさの PNG にする
// 役割:
//  - toPng: 画像（png・jpg・gif・webp・bmp）を、長い辺が maxSide 以下の PNG にする（長い辺が超えるときだけ縮める。大きくはしない）
//  - fitPngToBase64Limit: base64 にして上限（既定 5MB）を超える PNG を、長い辺を 0.75 倍ずつ縮めて作り直す
//  - pngSize: PNG の頭から幅と高さを読む（material-reader.js が、描き終えた PNG の大きさを知るために使う）
//  - Electron に触らない。@napi-rs/canvas だけで動く（node だけでテストできる）
//  - @napi-rs/canvas は、絵を描くときに初めて読む（canvas()）。.node が読めない PC でも、文字・Word・Excel・PDF の文字は読めるようにするため
//    （2026-10-24 の q89。前はこのファイルの先頭で読んでいたので、読めないと資料を読む部品の全部が動かなかった）
'use strict';

const { MaterialError } = require('./material-error');

// @napi-rs/canvas を読む。読めないときは MaterialError('unavailable')（元の例外は cause）。2 回目からは同じ結果を返す
let canvasLib = null;
let canvasError = null;
let canvasLoader = () => require('@napi-rs/canvas');
function canvas() {
  if (canvasLib) return canvasLib;
  if (!canvasError) {
    try {
      canvasLib = canvasLoader();
      return canvasLib;
    } catch (err) {
      canvasError = err;
    }
  }
  const e = new MaterialError('unavailable', '画像を読む部品の準備ができていません。（この PC では画像を描く部品を読み込めませんでした。アプリを入れ直してください。文字・Word・Excel と、PDF の文字は読めます。）');
  e.cause = canvasError;
  throw e;
}
// テスト用: 読み込み方を差し替え、覚えた結果を消す
function setCanvasLoaderForTest(loader) {
  canvasLoader = loader || (() => require('@napi-rs/canvas'));
  canvasLib = null;
  canvasError = null;
}

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
  const { loadImage } = canvas();
  try {
    return await loadImage(bytes);
  } catch (_) {
    throw readFailed();
  }
}

function drawPng(image, width, height) {
  const board = canvas().createCanvas(width, height);
  const ctx = board.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return { png: board.toBuffer('image/png'), width, height };
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

module.exports = { IMAGE_MAX_SIDE, toPng, fitPngToBase64Limit, pngSize, canvas, setCanvasLoaderForTest };
