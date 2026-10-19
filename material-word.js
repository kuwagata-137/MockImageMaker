// material-word.js — Word（.docx）を文にする
// 役割:
//  - mammoth で .docx を読み、文書の木（段落・表）を上から順にたどって、見出し・段落・表を行の並びにする
//    （convertToHtml の結果を文字に直す方法ではなく、mammoth の transformDocument で受け取った文書の木をたどる方法）
//  - 見出しは「# 」「## 」…の印・箇条書きは「- 」・表は 1 行を 1 行にして、欄を「 | 」でつなぐ（1 つの欄に段落が複数あれば空白でつなぐ）
//  - 画像・図は読まない。Electron に触らない。node だけでテストできる
// 見出しの段落は、Word の段落の名前（heading 1〜9・見出し 1〜9・Title）で見分ける。
'use strict';

const mammoth = require('mammoth');
const { MaterialError } = require('./material-error');

const HEADING_STYLE = /^(?:heading|見出し)\s*([1-9])$/i;
const TITLE_STYLE = /^(?:title|表題|タイトル)$/i;
const CELL_SEPARATOR = ' | ';

function readFailed() {
  return new MaterialError('read_failed', 'この Word 文書（.docx）は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
}

// 段落・見出し・欄の中の字（文字・タブ・改行）を 1 本の文字にする。表の入れ子はその中の字を空白でつなぐ。
function inlineText(element) {
  if (element.type === 'text') return element.value;
  if (element.type === 'tab' || element.type === 'break') return ' ';
  return (element.children || []).map(inlineText).join('');
}

function headingLevel(styleName) {
  if (!styleName) return 0;
  const match = HEADING_STYLE.exec(styleName.trim());
  if (match) return Number(match[1]);
  return TITLE_STYLE.test(styleName.trim()) ? 1 : 0;
}

function paragraphLine(paragraph) {
  const text = inlineText(paragraph).trim();
  if (!text) return null;
  const level = headingLevel(paragraph.styleName);
  if (level) return `${'#'.repeat(level)} ${text}`;
  if (paragraph.numbering) return `${'  '.repeat(Number(paragraph.numbering.level) || 0)}- ${text}`;
  return text;
}

// 欄の中の段落（と入れ子の表の行）を空白でつないだ 1 本の文字にする
function cellText(cell) {
  return blockLines(cell.children || []).join(' ');
}

function tableLines(table) {
  const lines = [];
  for (const row of table.children || []) {
    if (row.type !== 'tableRow') continue;
    const cells = (row.children || []).filter((cell) => cell.type === 'tableCell').map(cellText);
    if (cells.some((cell) => cell !== '')) lines.push(cells.join(CELL_SEPARATOR));
  }
  return lines;
}

function blockLines(children) {
  const lines = [];
  for (const child of children) {
    if (child.type === 'paragraph') {
      const line = paragraphLine(child);
      if (line !== null) lines.push(line);
    } else if (child.type === 'table') {
      lines.push(...tableLines(child));
    }
  }
  return lines;
}

// mammoth に文書を読ませ、transformDocument で文書の木を受け取る（HTML への変換の結果は使わない。画像は読み込まない）
async function readDocumentTree(bytes) {
  let tree = null;
  await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      transformDocument: (document) => { tree = document; return document; },
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  );
  if (!tree) throw readFailed();
  return tree;
}

// .docx のバイト列 → 塊の並び（1 つの塊に、文書の全部の行）。読めなければ MaterialError('read_failed')
async function readWordBlocks(bytes) {
  let tree;
  try {
    tree = await readDocumentTree(bytes);
  } catch (_) {
    throw readFailed();
  }
  return [{ text: blockLines(tree.children || []).join('\n') }];
}

module.exports = { readWordBlocks };
