'use strict';
// AI の窓口の画面の画像（get_screen_image）と出力（export_design）のテスト（第 7 段階の T6）。
// ページはファイルに書かず、印刷用の HTML（render）を返す（PNG・PDF にして決めたフォルダへ書くのは main。tools/check-mcp.js で確かめる）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  return { app, T, call };
}

test('get_screen_image: 既定は画面だけ（一覧表と吹き出しを入れない）。withTable で、出力の PNG と同じく一覧表と吹き出しも入れる', async () => {
  const { app, call } = await boot();
  const r = await call('get_screen_image', { design: '顧客管理', screen: '新規登録' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, {
    design: { id: 'd1', name: '顧客管理', updatedAt: '2026-10-01T00:00:00.000Z' },
    screen: { id: 's1', name: '新規登録', device: 'pc', width: 1280, height: 800 },
    withTable: false,
  });
  assert.equal(r.render.kind, 'image');
  assert.match(r.render.html, /^<!DOCTYPE html>/);
  assert.match(r.render.html, /顧客コード/);
  assert.doesNotMatch(r.render.html, /class="ptable/);
  assert.doesNotMatch(r.render.html, /顧客コードは自動で振る。/);
  assert.ok(r.render.width >= 1280 && r.render.width < 1280 + 240, `幅 ${r.render.width}`);
  const full = await call('get_screen_image', { design: 'd1', screen: 's1', withTable: true });
  assert.equal(full.result.withTable, true);
  assert.match(full.render.html, /class="ptable/);
  assert.match(full.render.html, /顧客コードは自動で振る。/);
  assert.ok(full.render.width > r.render.width);
  const bad = await call('get_screen_image', { design: 'd1', screen: '詳細' });
  assert.equal(bad.error.code, 'not_found');
  app.close();
});

test('export_design: PDF は用紙・向き・入れるページ・画面を選べ、ファイルの名前と用紙の大きさ（インチ）を返す', async () => {
  const { app, call } = await boot();
  const r = await call('export_design', { design: '顧客管理', format: 'pdf' });
  assert.equal(r.ok, true);
  assert.equal(r.render.kind, 'pdf');
  assert.equal(r.render.files.length, 1);
  const f = r.render.files[0];
  assert.equal(f.name, '顧客管理.pdf');
  assert.ok(f.pageSize.width > f.pageSize.height, 'A4 横');
  assert.ok(Math.abs(f.pageSize.width - 11.69) < 0.05, `幅 ${f.pageSize.width}`);
  assert.match(f.html, /画面設計書/);
  assert.equal(r.result.paper, 'A4');
  assert.equal(r.result.orient, 'landscape');
  assert.deepEqual([r.result.cover, r.result.map, r.result.items], [true, true, true]);
  assert.equal(r.result.pages, 5, '表紙・つながりの図・項目の一覧表・画面 2 つ');
  const a3 = await call('export_design', { design: 'd1', format: 'pdf', paper: 'A3', orient: 'portrait', cover: false, map: false, items: false, screens: ['一覧'] });
  assert.equal(a3.result.pages, 1);
  assert.ok(a3.render.files[0].pageSize.height > a3.render.files[0].pageSize.width, 'A3 縦');
  const slide = await call('export_design', { design: 'd1', format: 'pdf', paper: 'slide', orient: 'portrait' });
  assert.equal(slide.result.orient, 'landscape', 'スライドは横だけ');
  const none = await call('export_design', { design: 'd1', format: 'pdf', cover: false, map: false, items: false, screens: [] });
  assert.equal(none.error.code, 'bad_request');
  app.close();
});

test('export_design: PNG は画面ごとに 1 つ、HTML は単体で開いて編集できる HTML を返す。違いの印は写しのある版とだけ比べる', async () => {
  const { app, call } = await boot();
  const png = await call('export_design', { design: 'd1', format: 'png' });
  assert.equal(png.render.kind, 'png');
  assert.deepEqual(png.render.files.map((f) => f.name), ['顧客管理_01_新規登録.png', '顧客管理_02_一覧.png']);
  assert.ok(png.render.files.every((f) => f.width > 0 && f.height > 0 && /^<!DOCTYPE html>/.test(f.html)));
  assert.equal(png.result.screens, 2);
  const one = await call('export_design', { design: 'd1', format: 'png', screens: ['s2'] });
  assert.deepEqual(one.render.files.map((f) => f.name), ['顧客管理_02_一覧.png']);
  const html = await call('export_design', { design: 'd1', format: 'html' });
  assert.equal(html.render.kind, 'files');
  assert.equal(html.render.files[0].name, '顧客管理.html');
  assert.match(html.render.files[0].text, /<script type="application\/json" id="mim-embedded">/);
  assert.equal((await call('export_design', { design: 'd1', format: 'docx' })).error.code, 'bad_request');
  // 改訂して第 1 版を作ると、第 1 版と比べて出力できる。ない版は断る
  await call('add_revision', { design: 'd1', note: '最初の版' });
  const diff = await call('export_design', { design: 'd1', format: 'pdf', diffWith: '第 1 版' });
  assert.equal(diff.ok, true);
  assert.equal(diff.result.diffWith, '第 1 版');
  assert.equal(diff.result.pages, 6, '変更内容のページで 1 ページ増える');
  assert.equal((await call('export_design', { design: 'd1', format: 'pdf', diffWith: '第 9 版' })).error.code, 'not_found');
  app.close();
});
