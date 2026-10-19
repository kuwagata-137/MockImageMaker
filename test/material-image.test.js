'use strict';
// material-image.js（画像を長い辺 1566 の PNG にする・大きすぎる PNG を縮め直す）のテスト。

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPng, fitPngToBase64Limit, pngSize } = require('../material-image');
const { MaterialError } = require('../material-error');
const samples = require('./material-samples');

const base64Length = (buf) => Math.ceil(buf.length / 3) * 4;

test('toPng — 長い辺が 1566 を超えるときだけ縮める', async (t) => {
  await t.test('3000×1000 は 1566×522 になる', async () => {
    const result = await toPng(samples.solidPng(3000, 1000));
    assert.deepEqual([result.width, result.height], [1566, 522]);
    assert.deepEqual(pngSize(result.png), { width: 1566, height: 522 });
  });

  await t.test('縦長も長い辺が 1566 になる', async () => {
    const result = await toPng(samples.solidPng(1000, 3000));
    assert.deepEqual([result.width, result.height], [522, 1566]);
  });

  await t.test('小さい画像は大きくしない', async () => {
    const result = await toPng(samples.solidPng(300, 200));
    assert.deepEqual([result.width, result.height], [300, 200]);
    assert.deepEqual(pngSize(result.png), { width: 300, height: 200 });
  });

  await t.test('maxSide を変えられる', async () => {
    const result = await toPng(samples.solidPng(800, 400), { maxSide: 200 });
    assert.deepEqual([result.width, result.height], [200, 100]);
  });

  await t.test('返す物は PNG（JPEG を渡しても PNG になる）', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(64, 48);
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    const result = await toPng(canvas.toBuffer('image/jpeg'));
    assert.equal(result.png.subarray(1, 4).toString('latin1'), 'PNG');
    assert.deepEqual([result.width, result.height], [64, 48]);
  });
});

test('toPng — 読めない画像は read_failed（場所を文に入れない）', async (t) => {
  for (const [label, bytes] of [['壊れた中身', Buffer.from('これは画像ではありません')], ['空', Buffer.alloc(0)]]) {
    await t.test(label, async () => {
      await assert.rejects(toPng(bytes), (err) => {
        assert.ok(err instanceof MaterialError);
        assert.equal(err.code, 'read_failed');
        assert.match(err.message, /この画像は読めませんでした/);
        assert.doesNotMatch(err.message, /[\\/]/);
        return true;
      });
    });
  }
});

test('pngSize — PNG の頭から幅と高さを読む', () => {
  assert.deepEqual(pngSize(samples.solidPng(40, 30)), { width: 40, height: 30 });
  assert.deepEqual(pngSize(samples.fakePng(123, 456, 100)), { width: 123, height: 456 });
});

test('fitPngToBase64Limit — base64 で上限を超える PNG だけ、長い辺を 0.75 倍ずつ縮める', async (t) => {
  await t.test('上限に収まる PNG はそのまま返す', async () => {
    const png = samples.solidPng(200, 100);
    const result = await fitPngToBase64Limit(png, 1000000);
    assert.equal(result.png, png);
    assert.deepEqual([result.width, result.height], [200, 100]);
  });

  await t.test('上限を超える PNG は、収まるまで 0.75 倍ずつ縮める', async () => {
    const png = samples.noisePng(600, 400); // 約 840KB（base64 で約 1.1MB）
    const limit = 300 * 1024;
    assert.ok(base64Length(png) > limit);
    const result = await fitPngToBase64Limit(png, limit);
    assert.ok(base64Length(result.png) <= limit);
    assert.ok(result.width < 600 && result.height < 400);
    assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });
    // 0.75 倍を何回かかけた大きさになっている（600 → 450 → 338 …）
    assert.ok([450, 338, 253, 190].includes(result.width), String(result.width));
    assert.ok(Math.abs(result.height - (result.width * 400) / 600) <= 1, '縦横の比が保たれる');
  });

  await t.test('既定の上限は 5MB（base64）', async () => {
    const png = samples.fakePng(100, 100, Math.floor(5 * 1024 * 1024 * 3 / 4) - 100);
    const result = await fitPngToBase64Limit(png);
    assert.equal(result.png, png);
  });
});
