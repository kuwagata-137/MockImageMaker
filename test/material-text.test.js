'use strict';
// material-text.js（文字コードの判定・重みの数え方・長い文の分け方）のテスト。
// 文字コードごとのバイトの並びは test/material-samples.js から受け取る（Shift_JIS は 16 進のバイト列から作ってある）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeText, textWeight, splitText, normalizeRadicals, WEIGHT_SCALE } = require('../material-text');
const samples = require('./material-samples');

const TRIP = '出張申請\nOK';

test('decodeText — 文字コードの見分け', async (t) => {
  await t.test('UTF-8（BOM なし）', () => {
    assert.equal(decodeText(samples.utf8Bytes(TRIP)), TRIP);
  });

  await t.test('UTF-8 の BOM は取り除く', () => {
    const text = decodeText(samples.utf8BomBytes(TRIP));
    assert.equal(text, TRIP);
    assert.notEqual(text.charCodeAt(0), 0xfeff);
  });

  await t.test('UTF-16LE の BOM', () => {
    assert.equal(decodeText(samples.utf16leBytes(TRIP)), TRIP);
  });

  await t.test('UTF-16BE の BOM', () => {
    assert.equal(decodeText(samples.utf16beBytes(TRIP)), TRIP);
  });

  await t.test('BOM がなく UTF-8 として読めなければ Shift_JIS（16 進のバイト列から作った見本）', () => {
    assert.equal(decodeText(samples.SHIFT_JIS_BYTES), '出張申請\nOK');
  });

  // デバッグとリリースの見直し③-5: 1 バイトでも壊れた所があると、ファイル全体を Shift_JIS で読んで化けていた
  await t.test('UTF-8 の文の中に壊れたバイトが少しだけあるときは、UTF-8 で読み、壊れた所だけを � にする', () => {
    const bytes = Buffer.concat([samples.utf8Bytes('出張の申請と、上長の承認の流れ。\n'.repeat(3)), Buffer.from([0xff]), samples.utf8Bytes('旅費の精算。')]);
    const text = decodeText(bytes);
    assert.equal(text, '出張の申請と、上長の承認の流れ。\n'.repeat(3) + '�旅費の精算。');
  });

  await t.test('空のバイト列は空の文字', () => {
    assert.equal(decodeText(Buffer.alloc(0)), '');
  });

  await t.test('Uint8Array でも読める', () => {
    assert.equal(decodeText(new Uint8Array(samples.utf8Bytes(TRIP))), TRIP);
  });
});

test('decodeText — 改行を \\n にそろえる', () => {
  assert.equal(decodeText(Buffer.from('a\r\nb\rc\nd', 'utf8')), 'a\nb\nc\nd');
  assert.equal(decodeText(samples.SHIFT_JIS_BYTES).includes('\r'), false);
});

test('textWeight — ASCII は 0.3・それ以外は 1（10 倍した整数で返す）', () => {
  assert.equal(WEIGHT_SCALE, 10);
  assert.equal(textWeight(''), 0);
  assert.equal(textWeight('abc'), 9);
  assert.equal(textWeight('出張'), 20);
  assert.equal(textWeight('出a'), 13);
  assert.equal(textWeight('\n'), 3);
  assert.equal(textWeight('𠮷'), 10);
});

test('splitText — 重みの上限ごとに改行の所で分ける', async (t) => {
  await t.test('上限に収まる文は 1 つのまま', () => {
    assert.deepEqual(splitText('出張\n申請', 30000), ['出張\n申請']);
  });

  await t.test('行を詰めていき、上限を超える手前の改行で分ける（つなげると元に戻る）', () => {
    const lines = Array.from({ length: 10 }, () => 'あ'.repeat(10));
    const text = lines.join('\n');
    const pieces = splitText(text, 400); // 1 行は重み 100・改行は 3 → 3 行で 306・4 行だと 409
    assert.equal(pieces.length, 4);
    assert.equal(pieces.join('\n'), text);
    for (const piece of pieces) assert.ok(textWeight(piece) <= 400, piece);
    assert.deepEqual(pieces.map((p) => p.split('\n').length), [3, 3, 3, 1]);
  });

  await t.test('改行のない長い文は、重みの上限ごとに字で切る', () => {
    const text = 'あ'.repeat(25) + 'x'.repeat(10);
    const pieces = splitText(text, 100); // あ なら 10 字・x なら 33 字ぶん
    for (const piece of pieces) assert.ok(textWeight(piece) <= 100);
    assert.equal(pieces.join(''), text);
    assert.ok(pieces.length >= 3);
  });

  await t.test('サロゲートペアの途中では切らない', () => {
    const text = '𠮷'.repeat(12);
    const pieces = splitText(text, 50); // 1 字が 10 なので 5 字ずつ
    assert.equal(pieces.join(''), text);
    for (const piece of pieces) assert.equal([...piece].length * 2, piece.length);
  });

  await t.test('空の文は空の並び・空行は残す', () => {
    assert.deepEqual(splitText('', 100), []);
    assert.deepEqual(splitText('a\n\nb', 1000), ['a\n\nb']);
  });
});

// 康熙部首（U+2F00〜U+2FDF）と CJK 部首補助（U+2E80〜U+2EFF）の字。見た目は漢字と同じだが、符号が違う
const radical = (code) => String.fromCodePoint(code);

test('normalizeRadicals — 康熙部首・CJK 部首補助の字だけを通常の漢字に直す', async (t) => {
  await t.test('康熙部首: 「⽇本」→「日本」・「⽬的」→「目的」', () => {
    assert.equal(normalizeRadicals(`${radical(0x2f47)}本`), '日本');
    assert.equal(normalizeRadicals(`${radical(0x2f6c)}的`), '目的');
    assert.equal(normalizeRadicals(radical(0x2f00)), '一');
  });

  await t.test('CJK 部首補助: 「⺟」→「母」', () => {
    assert.equal(normalizeRadicals(radical(0x2e9f)), '母');
  });

  await t.test('文の中の部首の字を 1 字ずつ直し、まわりの字・改行は変えない', () => {
    const text = `出張${radical(0x2f47)}程\n${radical(0x2f6c)}的: abc`;
    assert.equal(normalizeRadicals(text), '出張日程\n目的: abc');
  });

  await t.test('NFKC で変わる字でも、部首の範囲の外は変えない（「①」・全角の「Ａ」・半角のカナ・「㈱」・サロゲートペア）', () => {
    for (const same of ['①', 'Ａ', 'ｱ', '㈱', '𠮷', '出張申請', 'abc', '']) assert.equal(normalizeRadicals(same), same, same);
  });

  await t.test('NFKC で変わらない部首の字（U+2E80 など）はそのまま', () => {
    assert.equal(normalizeRadicals(radical(0x2e80)), radical(0x2e80));
  });
});
