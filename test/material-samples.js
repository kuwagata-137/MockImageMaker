'use strict';
// material-samples.js — 資料を読む部品（material-*.js）のテストで使う見本を作る関数。
// 見本のファイルは .devdata/test-tmp/material-reader/ の下に作る（Git に入れない）。中身は架空の出張申請だけ。
// Windows の Node v24.12.0 では、日本語の名前のファイルを fs.rmSync に渡すと Node ごと落ちるので、消すときは unlinkSync を使う。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas, ImageData } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, ImageRun } = require('docx');
const ExcelJS = require('exceljs');

const SAMPLE_ROOT = path.join(__dirname, '..', '.devdata', 'test-tmp', 'material-reader');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// ── 見本のフォルダ ──
function makeSampleDir() {
  fs.mkdirSync(SAMPLE_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(SAMPLE_ROOT, 'run-'));
}

function removeSampleDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
}

function writeSample(dir, name, bytes) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

// ── 文字（文字コードごとのバイトの並び）──
// 「出張申請」+ 改行 + OK。Shift_JIS は 16 進のバイトの並びから作る（8f6f=出・92a3=張・905c=申・90bf=請）。
const SHIFT_JIS_BYTES = Buffer.from('8f6f92a3905c90bf0d0a4f4b', 'hex');

function utf8Bytes(text) {
  return Buffer.from(text, 'utf8');
}

function utf8BomBytes(text) {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

function utf16leBytes(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function utf16beBytes(text) {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le);
  be.swap16();
  return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
}

// ── 画像 ──
function solidPng(width, height, color = '#336699') {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

// ほとんど縮まないランダムな絵の PNG（大きい画像の見本）
function noisePng(width, height) {
  const canvas = createCanvas(width, height);
  const pixels = crypto.randomBytes(width * height * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const data = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length);
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toBuffer('image/png');
}

// 大きさ（バイト数）と幅・高さだけが本物の PNG の頭（中身は読まない部品のテスト用。本当の画像としては開けない）
function fakePng(width, height, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  const head = Buffer.concat([PNG_SIGNATURE, Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), header]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
}

// ── PDF（pages: 'text'・{ image: PNG のバイト }・null〔白紙〕の並び）──
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage([300, 400]);
    if (typeof spec === 'string') page.drawText(spec, { x: 20, y: 200, size: 14, font });
    if (spec && spec.image) {
      const image = await doc.embedPng(spec.image);
      page.drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
    }
  }
  return Buffer.from(await doc.save());
}

// ── Word（見出し 1・段落・見出し 2・表 2 行）──
async function makeDocx() {
  const cell = (...lines) => new TableCell({ children: lines.map((line) => new Paragraph(line)) });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: '出張申請', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('申請者は 3 日前までに提出する。'),
        new Paragraph({ text: '承認', heading: HeadingLevel.HEADING_2 }),
        new Table({
          rows: [
            new TableRow({ children: [cell('項目'), cell('内容')] }),
            new TableRow({ children: [cell('期間'), cell('2 泊 3 日', '朝発')] }),
          ],
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// ── Word（画像のある段落・段落の中の改行・箇条書き 2 段）──
async function makeRichDocx() {
  const picture = new ImageRun({ data: solidPng(40, 30), transformation: { width: 40, height: 30 }, type: 'png' });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun('図の前の文'), picture, new TextRun('図の後の文')] }),
        new Paragraph({ children: [new TextRun('一行め'), new TextRun({ break: 1 }), new TextRun('二行め')] }),
        new Paragraph({ text: '箇条書き', bullet: { level: 0 } }),
        new Paragraph({ text: '箇条書きの下', bullet: { level: 1 } }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// ── Excel（「申請書」: 結合・日付・数・式の結果・式だけ・リッチテキスト・リンク・真偽・エラー・改行・日時／「内訳」: 隠しシート／「メモ」: 空）──
async function makeXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('申請書');
  sheet.getCell('A1').value = '出張申請書';
  sheet.mergeCells('A1:D1');
  sheet.getCell('A3').value = '申請日';
  sheet.getCell('B3').value = new Date(Date.UTC(2026, 9, 19));
  sheet.getCell('A4').value = '金額';
  sheet.getCell('B4').value = 1200;
  sheet.getCell('C4').value = 800;
  sheet.getCell('D4').value = { formula: 'B4+C4', result: 2000 };
  sheet.getCell('A5').value = { richText: [{ text: '赤' }, { text: '青', font: { bold: true } }] };
  sheet.getCell('A6').value = { formula: 'SUM(B4:C4)' };
  sheet.getCell('A7').value = { text: 'リンク', hyperlink: 'https://example.com' };
  sheet.getCell('A8').value = true;
  sheet.getCell('A9').value = '行1\n行2';
  sheet.getCell('A10').value = { error: '#REF!' };
  sheet.getCell('B5').value = new Date(Date.UTC(2026, 9, 19, 9, 30));
  workbook.addWorksheet('内訳', { state: 'hidden' }).getCell('A1').value = '交通費';
  workbook.addWorksheet('メモ');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// 日本の組み込みの書式番号（numFmtId 27〜36・50〜58。styles.xml に書式の文字がなく、番号だけで日付・時刻を表す）のセルを持つ .xlsx
// （デバッグとリリースの見直し③-1）。exceljs は組み込みでない書式しか書かないので、仮の書式「x31」などで書いてから、
// styles.xml の書式の番号を組み込みの番号に置き換え、仮の書式の定義を消す
async function makeXlsxJapaneseFormats() {
  const JSZip = require('jszip');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('申請書');
  const cells = [['A1', 45296, 31], ['A2', 9.5 / 24, 32], ['A3', 45296, 27], ['A4', 45296, 58], ['A5', 45292, 55], ['A6', 45296, 35]];
  for (const [at, value, id] of cells) {
    sheet.getCell(at).value = value;
    sheet.getCell(at).numFmt = `x${id}`;
  }
  sheet.getCell('A7').value = 45296; // 書式なし（標準）は数のまま
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  let styles = await zip.file('xl/styles.xml').async('string');
  const ids = {};
  for (const m of styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="x(\d+)"\/>/g)) ids[m[1]] = m[2];
  styles = styles.replace(/<numFmts[\s\S]*?<\/numFmts>/, '').replace(/numFmtId="(\d+)"/g, (all, id) => (ids[id] ? `numFmtId="${ids[id]}"` : all));
  zip.file('xl/styles.xml', styles);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// 古い Word・Excel（OLE2）の頭に見える中身
function ole2Bytes() {
  return Buffer.concat([OLE2_SIGNATURE, Buffer.alloc(512)]);
}

module.exports = {
  makeSampleDir,
  removeSampleDir,
  writeSample,
  SHIFT_JIS_BYTES,
  utf8Bytes,
  utf8BomBytes,
  utf16leBytes,
  utf16beBytes,
  solidPng,
  noisePng,
  fakePng,
  makePdf,
  makeDocx,
  makeRichDocx,
  makeXlsx,
  makeXlsxJapaneseFormats,
  ole2Bytes,
};
