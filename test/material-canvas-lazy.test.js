'use strict';
// @napi-rs/canvas（.node）が読めない PC でも、資料を読む部品が読み込めること（2026-10-24 の q89）。
// 前は material-image.js・material-pdf.js の先頭で読んでいたので、読めないと文字・Word・Excel も読めなかった。
// ここでは @napi-rs/canvas の読み込みを失敗させ、部品を読み直して確かめる（ほかの部品〔exceljs など〕は要らない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const fresh = (name) => {
  const file = require.resolve(path.join(ROOT, name));
  delete require.cache[file];
  return require(file);
};

// 小さな PNG（1×1）の頭。pngSize が幅と高さを読む
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('@napi-rs/canvas が読めなくても、画像と PDF を読む部品は読み込める（描くときに初めて読む）', (t) => {
  const load = Module._load;
  let asked = 0;
  Module._load = function (request, ...rest) {
    if (request === '@napi-rs/canvas') { asked += 1; throw new Error('この PC では .node を読めない（見本）'); }
    return load.call(this, request, ...rest);
  };
  t.after(() => {
    Module._load = load;
    for (const name of ['material-image.js', 'material-pdf.js']) delete require.cache[require.resolve(path.join(ROOT, name))];
  });
  const image = fresh('material-image.js');
  const pdf = fresh('material-pdf.js');
  assert.equal(asked, 0, '読み込んだだけでは @napi-rs/canvas を読まない');
  assert.equal(typeof pdf.loadPdfBlocks, 'function');
  assert.deepEqual(image.pngSize(PNG_1x1), { width: 1, height: 1 });
});

test('@napi-rs/canvas が読めないときは、画像だけが unavailable の失敗になる（小さな PNG はそのまま渡せる）', async (t) => {
  const image = fresh('material-image.js');
  let asked = 0;
  image.setCanvasLoaderForTest(() => { asked += 1; throw new Error('この PC では .node を読めない（見本）'); });
  t.after(() => image.setCanvasLoaderForTest(null));
  await assert.rejects(image.toPng(PNG_1x1), (e) => {
    assert.equal(e.code, 'unavailable');
    assert.match(e.message, /画像を読む部品の準備ができていません/);
    assert.match(e.message, /文字・Word・Excel と、PDF の文字は読めます/);
    assert.match(e.cause.message, /\.node/, '元の例外は cause に残す');
    return true;
  });
  await assert.rejects(image.toPng(PNG_1x1), { code: 'unavailable' });
  assert.equal(asked, 1, '2 回目は読み直さず、同じ失敗を返す');
  const small = await image.fitPngToBase64Limit(PNG_1x1);
  assert.equal(small.png, PNG_1x1, '上限に収まる PNG は、描かずにそのまま返す');
  assert.deepEqual([small.width, small.height], [1, 1]);
});
