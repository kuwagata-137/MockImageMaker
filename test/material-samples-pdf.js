'use strict';
// material-samples-pdf.js — 日本語の PDF の見本を作る関数（テスト用）。
// 字体を埋め込まない CID 字体（HeiseiKakuGo-W5・文字コード表 UniJIS-UCS2-H・Adobe-Japan1）なので、読むには pdfjs の cMap が要る。
// pdf-lib の標準の字体では日本語を組めないので、PDF の文字を直接組む。

// 文字（BMP の字）を UTF-16BE の 16 進（大文字）にする
function utf16beHex(text) {
  return Buffer.from(text, 'utf16le').swap16().toString('hex').toUpperCase();
}

// ToUnicode（字の符号 → pdfjs が返す文字）。map は { 組む字: 返ってくる文字 }
function toUnicodeCMap(map) {
  const entries = Object.entries(map).map(([code, shown]) => `<${utf16beHex(code)}> <${utf16beHex(shown)}>`);
  return [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${entries.length} beginbfchar`,
    ...entries,
    'endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
}

const stream = (body) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;

// text を 1 ページに組んだ PDF。toUnicode を渡すと、その字は ToUnicode で別の文字に読まれる
// （游ゴシック・メイリオの PDF が「日」を康熙部首「⽇」と読ませるのを、同じ形で作るため）。
function makeJapanesePdf(text, { toUnicode = {} } = {}) {
  const hasToUnicode = Object.keys(toUnicode).length > 0;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream(`BT /F1 20 Tf 20 200 Td <${utf16beHex(text)}> Tj ET`),
    `<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R]${hasToUnicode ? ' /ToUnicode 7 0 R' : ''} >>`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /DW 1000 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> >>',
  ];
  if (hasToUnicode) objects.push(stream(toUnicodeCMap(toUnicode)));
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makeJapanesePdf };
