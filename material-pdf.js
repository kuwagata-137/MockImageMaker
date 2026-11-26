// material-pdf.js — PDF を「塊」の並びにする
// 役割:
//  - ページごとに、文字のあるページは「── 3 ページ ──」の見出しと文字の塊 { text }、
//    文字のないページ（白紙・スキャンなどの画像だけのページ）は画像の塊 { image: { page, caption, render } } にする
//  - 文字のあるページでも、文字が FEW_TEXT_CHARS 字以下のページと、貼り付けた画像が占める広さがページの IMAGE_RATIO_MIN 以上のページは、
//    文字の塊の後に、ページ画像の塊（見出し「── 3 ページの画像 ──」）も置く（v1.06・q193 案C）。図形と矢印で描いた図は、画像に数えない
//  - 戻り値の pageImage(n) は、指定したページのページ画像の塊を作る（AI が read_material の pages で指定したページ。v1.06・q193 案C）
//  - 画像の塊は、返すときに render() で初めて @napi-rs/canvas に描く（長い辺 1566 に合う倍率）。ここでは描かない。
//    画像の部品も、そのときに初めて読む（material-image.js の loadCanvas。文字のページだけの PDF は、画像の部品が動かなくても読める）
//  - pdfjs-dist（legacy の ESM）を await import で読む。字体・cMap・wasm はパッケージの中のフォルダを指し、ネットに行かない。
//    cmaps・standard_fonts のフォルダがあるかを、その場所で最初に読むときに 1 回だけ確かめ、なければ MaterialError('unavailable')
//    （ないまま読むと、pdfjs は警告も出さずに日本語のページから文字を取れず、全ページが画像の塊になるため）
//  - Electron に触らない。node だけでテストできる
// pdfjs が factory の場所に求める「末尾が /」の形にするため、場所の区切りは / にそろえる（Windows の fs も / を受け付ける）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MaterialError } = require('./material-error');
const { IMAGE_MAX_SIDE, loadCanvas } = require('./material-image');
const { normalizeRadicals } = require('./material-text');

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

// pdfjs が使う字体と文字コード表（cMap）のフォルダ。確かめ済みの場所は、2 回目からは見ない
const REQUIRED_ASSET_FOLDERS = ['cmaps', 'standard_fonts'];
const verifiedAssetsDirs = new Set();

async function isDirectory(folder) {
  try {
    return (await fs.promises.stat(folder)).isDirectory();
  } catch (_) {
    return false;
  }
}

async function assertAssetsAvailable(assetsDir) {
  if (verifiedAssetsDirs.has(assetsDir)) return;
  const found = await Promise.all(REQUIRED_ASSET_FOLDERS.map((name) => isDirectory(path.join(assetsDir, name))));
  if (!found.every(Boolean)) {
    throw new MaterialError('unavailable', 'PDF を読む機能の準備ができていません。（字体と文字コード表のフォルダ cmaps・standard_fonts が見つかりません。アプリをインストールし直してください。）');
  }
  verifiedAssetsDirs.add(assetsDir);
}

function assetUrl(assetsDir, name) {
  return `${path.join(assetsDir, name).split(path.sep).join('/')}/`;
}

// 読めなかったときの失敗。元の例外（pdfjs のもの）は cause に残す（調べるため。文には入れない）
function readFailed(err) {
  const passwordProtected = err && err.name === 'PasswordException';
  const failure = new MaterialError('read_failed', passwordProtected
    ? 'この PDF はパスワードで守られているので読めません。パスワードをはずした PDF を追加してください。'
    : 'この PDF は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
  failure.cause = err;
  return failure;
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

// 1 ページの文字（hasEOL の所で改行する。康熙部首の字は通常の漢字に直す）。読めないページは空の文字（画像のページとして扱う）
async function pageText(page) {
  try {
    const content = await page.getTextContent();
    const text = content.items.map((item) => (item.str || '') + (item.hasEOL ? '\n' : '')).join('');
    return normalizeRadicals(text.trim());
  } catch (_) {
    return '';
  }
}

// ページを、長い辺が IMAGE_MAX_SIDE の PNG に描く。描けないときは read_failed（元の例外は cause）。画像の部品が動かないときは loadCanvas の unavailable。
// 読む部品（material-reader.js）は、その塊を「（N ページの画像を作れませんでした）」などの文の行にして、後ろのページへ進む
async function renderPage(pdf, pageNumber) {
  const { createCanvas } = loadCanvas();
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

// ページ画像の塊。見出しは、文字のないページなら「── 3 ページ（文字がないので画像で渡します）──」（今までの見出し）、
// 文字のあるページなら「── 3 ページの画像 ──」（v1.06）。アプリの「読む」のウィンドウは、どちらも画像の見出しとして扱う。
// hasText は、読む部品（material-reader.js）が画像を作れなかった時の行を書き分けるのに使う
function imageBlock(pdf, pageNumber, hasText) {
  const caption = hasText ? `── ${pageNumber} ページの画像 ──` : `── ${pageNumber} ページ（文字がないので画像で渡します）──`;
  return { image: { page: pageNumber, caption, hasText, render: () => renderPage(pdf, pageNumber) } };
}

// 文字のあるページでも、ページ画像も渡すかの決まり（v1.06・q193 案C）。文字の数は、空白と改行を除いた字の数
const FEW_TEXT_CHARS = 50;
const IMAGE_RATIO_MIN = 0.1;
const countChars = (text) => [...text.replace(/\s+/g, '')].length;

// 変換行列の掛け算（pdfjs の [a, b, c, d, e, f] の並び。m に n を掛ける順序は、pdfjs の transform と同じ）
function multiply(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

// 画像 1 つが占める広さ。画像は、単位正方形を変換行列 ctm で写した所に描かれるので、4 つの角を囲む四角の広さを求める（ページの外にはみ出した分は数えない）
function imageArea(ctm, [x0, y0, x1, y1]) {
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
  const xs = corners.map(([x]) => Math.min(Math.max(x, x0), x1));
  const ys = corners.map(([, y]) => Math.min(Math.max(y, y0), y1));
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

// ページの広さに対して、貼り付けた画像（写真・スキャン・画面のコピー）が占める広さの割合（0〜1）。pdfjs の命令の並び（getOperatorList）をたどり、
// 画像を描く命令ごとの広さを合計する（重なった画像は重ねて数え、1 を上限にする）。命令の並びを作れないページは 0
async function pageImageRatio(page, OPS) {
  try {
    const [x0, y0, x1, y1] = page.view;
    const pageArea = (x1 - x0) * (y1 - y0);
    if (!(pageArea > 0)) return 0;
    const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((op) => op != null));
    const { fnArray, argsArray } = await page.getOperatorList();
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let area = 0;
    for (let i = 0; i < fnArray.length; i += 1) {
      const fn = fnArray[i];
      const args = argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = multiply(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (args && args[0] && args[0].length === 6) ctm = multiply(ctm, Array.from(args[0]));
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (imageOps.has(fn)) area += imageArea(ctm, page.view);
    }
    return Math.min(1, area / pageArea);
  } catch (_) {
    return 0;
  }
}

// 文字のあるページで、ページ画像も渡すか。文字の数を先に見て、画像の広さは、文字が多いページの時だけ測る
async function needsPageImage(page, text, OPS) {
  if (countChars(text) <= FEW_TEXT_CHARS) return true;
  return (await pageImageRatio(page, OPS)) >= IMAGE_RATIO_MIN;
}

// PDF のバイト列 → { blocks, dispose, pageCount, pageImage }。dispose() は開いた PDF を閉じる（控えから外すとき。閉じた後は画像の塊を描けない）。
// pageCount は PDF のページ数。pageImage(n) は n ページのページ画像の塊（AI が read_material の pages で指定したページ）
async function loadPdfBlocks(bytes, { assetsDir } = {}) {
  const dir = assetsDir || defaultPdfAssetsDir();
  await assertAssetsAvailable(dir);
  const { OPS } = await loadPdfjs();
  const { pdf, task } = await openDocument(bytes, dir);
  const dispose = () => task.destroy().catch(() => {});
  try {
    const blocks = [];
    const textPages = new Set();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await pageText(page);
      const also = text !== '' && await needsPageImage(page, text, OPS);
      page.cleanup();
      if (!text) {
        blocks.push(imageBlock(pdf, pageNumber, false));
        continue;
      }
      textPages.add(pageNumber);
      blocks.push({ text: `── ${pageNumber} ページ ──\n${text}` });
      if (also) blocks.push(imageBlock(pdf, pageNumber, true));
    }
    return { blocks, dispose, pageCount: pdf.numPages, pageImage: (n) => imageBlock(pdf, n, textPages.has(n)) };
  } catch (err) {
    await dispose();
    throw readFailed(err);
  }
}

module.exports = { loadPdfBlocks, defaultPdfAssetsDir, pageImageRatio, FEW_TEXT_CHARS, IMAGE_RATIO_MIN };
