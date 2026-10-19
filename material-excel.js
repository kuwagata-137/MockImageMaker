// material-excel.js — Excel（.xlsx・.xlsm）を文にする
// 役割:
//  - exceljs で読み、シートごとに「── シート「申請書」──」の見出しと、値の入ったセルを「A3: 値」の行にする
//  - 日付は YYYY-MM-DD・式は結果の値（結果がなければ式の文字）・リッチテキストとリンクは文字だけ・セルの中の改行は「 ⏎ 」にする
//  - 結合した範囲は「結合: A1:D1」の行・隠したシートは見出しに「（隠しシート）」の印をつける
//  - 1 つのシート＝1 つの塊（長いときは material-reader.js が改行の所で分ける）。Electron に触らない
'use strict';

const ExcelJS = require('exceljs');
const { MaterialError } = require('./material-error');

const HIDDEN_STATES = new Set(['hidden', 'veryHidden']);
// 時刻だけのセルは、日付が 1899-12-30（Excel の日付の起点）で入っている
const TIME_ONLY_DATE = '1899-12-3';

function readFailed() {
  return new MaterialError('read_failed', 'この Excel ファイル（.xlsx）は読めませんでした。ファイルが壊れているか、対応していない形式かもしれません。');
}

function dateText(date) {
  if (Number.isNaN(date.getTime())) return '';
  const iso = date.toISOString();
  if (iso.startsWith(TIME_ONLY_DATE)) return iso.slice(11, 16);
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateText(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return objectValueText(value);
  return String(value);
}

// リッチテキスト・リンク・エラーの値
function objectValueText(value) {
  if (Array.isArray(value.richText)) return value.richText.map((run) => run.text).join('');
  if (value.error) return String(value.error);
  if ('text' in value) return valueText(value.text);
  return '';
}

function cellText(cell) {
  let text;
  if (cell.type === ExcelJS.ValueType.Formula) {
    const hasResult = cell.result !== undefined && cell.result !== null;
    text = hasResult ? valueText(cell.result) : (cell.formula ? `=${cell.formula}` : '');
  } else {
    text = valueText(cell.value);
  }
  return text.replace(/\r\n|\r|\n/g, ' ⏎ ');
}

function sheetText(sheet) {
  const hidden = HIDDEN_STATES.has(sheet.state) ? '（隠しシート）' : '';
  const lines = [`── シート「${sheet.name}」${hidden}──`];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      // 結合した範囲のうち左上以外のセルは、左上と同じ値が見えるだけなので行にしない
      if (cell.type === ExcelJS.ValueType.Merge) return;
      const text = cellText(cell);
      if (text !== '') lines.push(`${cell.address}: ${text}`);
    });
  });
  if (lines.length === 1) lines.push('（値の入ったセルはありません）');
  for (const range of sheet.model.merges || []) lines.push(`結合: ${range}`);
  return lines.join('\n');
}

// .xlsx・.xlsm のバイト列 → シートごとの塊の並び。読めなければ MaterialError('read_failed')
async function readExcelBlocks(bytes) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes));
    return workbook.worksheets.map((sheet) => ({ text: sheetText(sheet) }));
  } catch (_) {
    throw readFailed();
  }
}

module.exports = { readExcelBlocks };
