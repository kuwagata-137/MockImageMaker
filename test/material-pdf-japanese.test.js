'use strict';
// material-pdf.js のうち、日本語の PDF（字体を埋め込まない CID 字体・cMap）・pdfjs-dist の場所の確かめ（unavailable）・
// 康熙部首の字の読み直しのテスト。日本語の見本は test/material-samples-pdf.js が PDF の文字を直接組んで作る。
// 文字・画像・壊れた PDF・控えは test/material-pdf.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPdfBlocks } = require('../material-pdf');
const { createMaterialReader } = require('../material-reader');
const { MaterialError } = require('../material-error');
const samples = require('./material-samples');
const { makeJapanesePdf } = require('./material-samples-pdf');

const dir = samples.makeSampleDir();
test.after(() => samples.removeSampleDir(dir));

test('日本語の PDF（字体を埋め込まない CID 字体・cMap を使う）から日本語の文字が取れる', async (t) => {
  const bytes = makeJapanesePdf('出張申請');

  await t.test('loadPdfBlocks: 既定の場所の cMap で「出張申請」が取れる（画像の塊にならない）', async () => {
    const { blocks, dispose } = await loadPdfBlocks(bytes, {});
    t.after(() => dispose());
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, '── 1 ページ ──\n出張申請');
  });

  await t.test('reader: text に日本語の文字が入り、画像は 0 枚', async () => {
    const file = samples.writeSample(dir, 'japanese.pdf', bytes);
    const result = await createMaterialReader().read({ path: file, kind: 'pdf', name: 'j.pdf', cursor: null });
    assert.ok(result.text.endsWith('── 1 ページ ──\n出張申請'), result.text);
    assert.deepEqual(result.images, []);
  });
});

// cmaps・standard_fonts のフォルダがあるかだけを見る確かめ用に、空のフォルダを作る（Windows の日本語の名前のファイルは作らない）
function makeAssetsDir(folderNames) {
  const root = samples.makeSampleDir();
  for (const name of folderNames) fs.mkdirSync(path.join(root, name));
  return {
    root,
    cleanup: () => {
      for (const name of folderNames) fs.rmdirSync(path.join(root, name));
      samples.removeSampleDir(root);
    },
  };
}

test('cmaps・standard_fonts のフォルダがない場所を渡すと unavailable（パスを出さない）', async (t) => {
  const file = samples.writeSample(dir, 'noassets.pdf', await samples.makePdf(['hello']));
  const readWith = (pdfAssetsDir) => createMaterialReader({ pdfAssetsDir }).read({ path: file, kind: 'pdf', name: 'n.pdf', cursor: null });
  const assertUnavailable = (promise, assetsRoot) => assert.rejects(promise, (err) => {
    assert.ok(err instanceof MaterialError);
    assert.equal(err.code, 'unavailable');
    assert.match(err.message, /PDF を読む部品の準備ができていません/);
    assert.equal(err.message.includes(assetsRoot), false, '文にパスが入っている');
    return true;
  });

  await t.test('場所そのものがない', async () => {
    const missing = path.join(dir, 'no-such-assets');
    await assertUnavailable(readWith(missing), missing);
    await assertUnavailable(readWith(missing), missing); // もう一度読んでも同じ（失敗は控えない）
  });

  for (const present of [['cmaps'], ['standard_fonts']]) {
    await t.test(`${present[0]} だけある（もう一方がない）`, async () => {
      const assets = makeAssetsDir(present);
      t.after(assets.cleanup);
      await assertUnavailable(readWith(assets.root), assets.root);
    });
  }

  await t.test('両方のフォルダがあれば読める（確かめるのはフォルダがあるかだけ）', async () => {
    const assets = makeAssetsDir(['cmaps', 'standard_fonts']);
    t.after(assets.cleanup);
    const result = await readWith(assets.root);
    assert.match(result.text, /hello/);
  });
});

// 康熙部首（U+2F00〜）の字。游ゴシック・メイリオで作った PDF は、「日」「目」を ToUnicode でこの字に読ませる
const KANGXI_SUN = String.fromCodePoint(0x2f47);
const KANGXI_EYE = String.fromCodePoint(0x2f6c);

test('游ゴシック・メイリオの PDF のように、ToUnicode が「日」「目」を康熙部首に読ませても、通常の漢字で取れる', async (t) => {
  const bytes = makeJapanesePdf('日本目的', { toUnicode: { 日: KANGXI_SUN, 目: KANGXI_EYE } });

  await t.test('loadPdfBlocks: 「日本目的」が取れる（部首の字が混ざらない）', async () => {
    const { blocks, dispose } = await loadPdfBlocks(bytes, {});
    t.after(() => dispose());
    assert.equal(blocks[0].text, '── 1 ページ ──\n日本目的');
    assert.equal(blocks[0].text.includes(KANGXI_SUN) || blocks[0].text.includes(KANGXI_EYE), false);
  });

  await t.test('reader の text も通常の漢字', async () => {
    const file = samples.writeSample(dir, 'kangxi.pdf', bytes);
    const result = await createMaterialReader().read({ path: file, kind: 'pdf', name: 'k.pdf', cursor: null });
    assert.ok(result.text.endsWith('日本目的'), result.text);
  });
});
