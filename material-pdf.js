// material-pdf.js — PDF を「塊」の並びにする
// 役割:
//  - ページごとに、文字のあるページは「── 3 ページ ──」の見出しと文字の塊 { text }、
//    文字のないページ（白紙・スキャンなどの画像だけのページ）は画像の塊 { image: { page, caption, render } } にする
//  - 画像の塊は、返すときに render() で初めて @napi-rs/canvas に描く（長い辺 1566 に合う倍率）。ここでは描かない
//  - pdfjs-dist（legacy の ESM）を await import で読む。字体・cMap・wasm はパッケージの中のフォルダを指し、ネットに行かない
//  - Electron に触らない。node だけでテストできる
// pdfjs が factory の場所に求める「末尾が /」の形にするため、場所の区切りは / にそろえる（Windows の fs も / を受け付ける）。
'use strict';

const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { MaterialError } = require('./material-error');
const { IMAGE_MAX_SIDE } = require('./material-image');

// pdfjs の警告（字体・wasm の場所など）を出さない。値は pdfjs の VerbosityLevel.ERRORS と同じ
const VERBOSITY_ERRORS = 0;

let pdfjsLoading = null;
function loadPdfjs() {
  if (!pdfjsLoading) pdfjsLoading = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLoading;
}

// pdfjs-dist のパッケージのフォルダ（この下に cmaps・standard_fonts・wasm・iccs がある）
function defaultPdfAssetsDir() {
  return path.dirname(require.resolve('pdfjs-dist/package.json'));
}

function assetUrl(assetsDir, name) {
  return `${path.join(assetsDir, name).split(path.sep).join('/')}/`;
}

function readFailed(err) {
  if (err && err.name === 'PasswordException') {
    return new MaterialError('read_failed', 'この PDF はパスワードで守られているので読めません。パスワードをはずした PDF を入れてください。');
  }
  return new MaterialError('read_failed', 'この PDF は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
}

async function openDocument(bytes, assetsDir) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    cMapUrl: assetUrl(assetsDir, 'cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl(assetsDir, 'standard_fonts'),
    wasmUrl: assetUrl(assetsDir, 'wasm'),
    iccUrl: assetUrl(assetsDir, 'iccs'),
    verbosity: VERBOSITY_ERRORS,
  });
  try {
    return { pdf: await task.promise, task };
  } catch (err) {
    await task.destroy().catch(() => {});
    throw readFailed(err);
  }
}

// 1 ページの文字（hasEOL の所で改行する）。読めないページは空の文字（画像のページとして扱う）
async function pageText(page) {
  try {
    const content = await page.getTextContent();
    const text = content.items.map((item) => (item.str || '') + (item.hasEOL ? '\n' : '')).join('');
    return text.trim();
  } catch (_) {
    return '';
  }
}

// ページを、長い辺が IMAGE_MAX_SIDE の PNG に描く
async function renderPage(pdf, pageNumber) {
  try {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = IMAGE_MAX_SIDE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    page.cleanup();
    return canvas.toBuffer('image/png');
  } catch (err) {
    throw readFailed(err);
  }
}

function imageBlock(pdf, pageNumber) {
  return {
    image: {
      page: pageNumber,
      caption: `── ${pageNumber} ページ（文字がないので画像で渡します）──`,
      render: () => renderPage(pdf, pageNumber),
    },
  };
}

// PDF のバイト列 → { blocks, dispose }。dispose() は開いた PDF を閉じる（控えから外すとき。閉じた後は画像の塊を描けない）。
async function loadPdfBlocks(bytes, { assetsDir } = {}) {
  const { pdf, task } = await openDocument(bytes, assetsDir || defaultPdfAssetsDir());
  const dispose = () => task.destroy().catch(() => {});
  try {
    const blocks = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await pageText(page);
      page.cleanup();
      blocks.push(text ? { text: `── ${pageNumber} ページ ──\n${text}` } : imageBlock(pdf, pageNumber));
    }
    return { blocks, dispose };
  } catch (err) {
    await dispose();
    throw readFailed(err);
  }
}

module.exports = { loadPdfBlocks, defaultPdfAssetsDir };
