// material-kind.js — 資料（システムに入れるファイル）の種類の見分けと、保存するファイルの名前
// 役割:
//  - 名前（拡張子）とファイルの先頭のバイトから、資料の種類（文字・画像・PDF・Word・Excel・BDM の HTML・そのほか）を決める
//  - 保存するファイルの名前 <資料の id>.<拡張子> を作る（置き場 material-files.js が使う）
//  - Electron に触らない。node だけでテストできる
// 名前（拡張子）だけでは決められないもの（OLE2・zip・PDF・BDM の HTML）は、先頭のバイトか HTML の中身も見る。
'use strict';

const { MaterialError } = require('./material-error');

const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
const MATERIAL_KINDS = Object.freeze(['text', 'image', 'pdf', 'word', 'excel', 'bdm', 'other']);

// 古い Word・Excel（OLE2）の先頭 8 バイト、zip（docx・xlsx・xlsm）の先頭 2 バイト、PDF の先頭 4 バイト
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from('PK', 'latin1');
const PDF_SIGNATURE = Buffer.from('%PDF', 'latin1');

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'json', 'log']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
// BDM（ビジネスダイアグラムメーカー）の HTML に入っている、図のデータの印
const BDM_STATE_MARKERS = ['__SWIMLANE_STATE__', 'id="swimlane-state"', '__SAVED_STATE__'];

const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,8}$/;

// 名前の最後の拡張子を小文字で返す。場所の区切り（/ と \）より前は見ない。
// 先頭だけが点の名前（.xlsx）・点で終わる名前（a.）・英数字 1〜8 字でない拡張子は ''。
function extensionOf(name) {
  const lastName = String(name == null ? '' : name).split(/[\\/]/).pop();
  const dot = lastName.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = lastName.slice(dot + 1);
  return EXTENSION_PATTERN.test(ext) ? ext.toLowerCase() : '';
}

// Buffer・Uint8Array・null のどれで渡されても Buffer にそろえる
function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.alloc(0);
}

function startsWith(buf, signature) {
  return buf.length >= signature.length && buf.subarray(0, signature.length).equals(signature);
}

function detectHtmlKind(buf) {
  const text = buf.toString('utf8');
  return BDM_STATE_MARKERS.some((marker) => text.includes(marker)) ? 'bdm' : 'other';
}

function result(kind, legacy = false) {
  return { kind, legacy };
}

// 名前と先頭のバイトから { kind, legacy } を返す。buf は先頭の 8 バイト以上（HTML のときはファイル全体）。
// legacy は古い形の Word・Excel（.doc・.xls。読めないので、呼ぶ側が断る）のとき true。
// 中身が OLE2 の .docx・.xlsx・.xlsm（パスワードで守ったファイルか、名前だけ変えた古い形）は Word・Excel にする（legacy にはしない）。
// 読むときに material-reader.js が理由（パスワード・古い形）を伝える（そのほかにすると、なぜ読めないかが分からなかった。デバッグとリリースの見直し③-4）
function detectKind(name, bytes) {
  const ext = extensionOf(name);
  const buf = toBuffer(bytes);

  if (startsWith(buf, OLE2_SIGNATURE) || ext === 'doc' || ext === 'xls') {
    if (ext === 'doc') return result('word', true);
    if (ext === 'xls') return result('excel', true);
    if (ext === 'docx') return result('word');
    if (ext === 'xlsx' || ext === 'xlsm') return result('excel');
    return result('other');
  }
  if (ext === 'pdf' || startsWith(buf, PDF_SIGNATURE)) return result('pdf');
  if (ext === 'docx') return result(startsWith(buf, ZIP_SIGNATURE) ? 'word' : 'other');
  if (ext === 'xlsx' || ext === 'xlsm') return result(startsWith(buf, ZIP_SIGNATURE) ? 'excel' : 'other');
  if (IMAGE_EXTENSIONS.has(ext)) return result('image');
  if (TEXT_EXTENSIONS.has(ext)) return result('text');
  if (HTML_EXTENSIONS.has(ext)) return result(detectHtmlKind(buf));
  return result('other');
}

// 保存するファイルの名前 <資料の id>.<拡張子>。拡張子は小文字の英数 1〜8 字で、ないか合わないときは bin。
function storedName(id, name) {
  return `${id}.${extensionOf(name) || 'bin'}`;
}

module.exports = { MATERIAL_MAX_BYTES, MATERIAL_KINDS, detectKind, storedName, MaterialError };
