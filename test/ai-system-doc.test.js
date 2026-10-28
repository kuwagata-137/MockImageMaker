'use strict';
// AI の道具 export_system_doc（システムの説明書〔PDF〕を出力する。第 10 段階の後半。設計書の 9-2）のテスト。
// ページはファイルに書かず、印刷用の HTML（render）を返す（PDF にして決めたフォルダへ書くのは main。tools/check-mcp-notes.js で確かめる）。
// 見本は架空の業務（出張申請システム・経費精算システム）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootSystemDoc, DOCS_PATH } = require('./system-doc-fixtures');

const plain = (v) => JSON.parse(JSON.stringify(v));
async function boot(t, opts) {
  const b = await bootSystemDoc(t, opts);
  const call = async (tool, args = {}) => plain(await b.api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  return { ...b, call };
}

test('export_system_doc: 既定は全部のページを入れ、返事にページ数・入れたページ・画面設計ごとの始まりのページを書く。ファイルは <名前>_システム設計書.pdf', async (t) => {
  const { call, api, d, sysId } = await boot(t);
  const r = await call('export_system_doc', { system: '出張申請システム' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const one = (n) => api.exportDocument(d(n), api.store.state, { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true }).pages.length;
  const [a, b] = [one('出張申請'), one('経費精算')];
  assert.equal(r.result.system.id, sysId);
  assert.equal(r.result.system.name, '出張申請システム');
  assert.deepEqual({ ...r.result, system: undefined }, {
    system: undefined, format: 'pdf', paper: 'A4', orient: 'landscape', pages: 2 + a + b + 1,
    included: { systemCover: true, swimlane: true, notes: true },
    designs: [
      { id: d('出張申請').id, name: '出張申請', firstPage: 3, pages: a, included: { cover: true, map: true, items: true, process: true, flow: true } },
      { id: d('経費精算').id, name: '経費精算', firstPage: 3 + a, pages: b, included: { cover: true, map: true, items: true, process: false, flow: true } },
    ],
  });
  assert.equal(r.render.kind, 'pdf');
  assert.equal(r.render.files.length, 1);
  const f = r.render.files[0];
  assert.equal(f.name, '出張申請システム_システム設計書.pdf');
  assert.ok(Math.abs(f.pageSize.width - 11.69) < 0.05 && f.pageSize.width > f.pageSize.height, 'A4 横');
  assert.match(f.html, /<title>出張申請システム_システム設計書<\/title>/);
  assert.match(f.html, /システム設計書/);
  assert.ok(!f.html.includes(DOCS_PATH.slice(0, 6)), '⑤ の行（出力したファイルの場所）は入れない');
});

test('export_system_doc: ページの名前は窓と同じ（systemCover・swimlane・notes・cover・map・items・process・flow）。false で外す。用紙・向きを選べる（スライドは横だけ）', async (t) => {
  const { call } = await boot(t);
  const full = (await call('export_system_doc', { system: '出張申請システム' })).result;
  const r = await call('export_system_doc', { system: '出張申請システム', systemCover: false, notes: false, cover: false, map: false, paper: 'A3', orient: 'portrait' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.included, { systemCover: false, swimlane: true, notes: false });
  assert.equal(r.result.designs[0].firstPage, 2, 'スイムレーン図の次');
  assert.deepEqual(r.result.designs[0].included, { cover: false, map: false, items: true, process: true, flow: true });
  assert.equal(r.result.pages, full.pages - 1 - 1 - 2 - 2);
  assert.deepEqual([r.result.paper, r.result.orient], ['A3', 'portrait']);
  assert.ok(r.render.files[0].pageSize.height > r.render.files[0].pageSize.width, 'A3 縦');
  const slide = await call('export_system_doc', { system: '出張申請システム', paper: 'slide', orient: 'portrait' });
  assert.equal(slide.result.orient, 'landscape', 'スライドは横だけ');
  assert.equal((await call('export_system_doc', { system: '出張申請システム', paper: 'B5' })).error.code, 'bad_request');
  assert.equal((await call('export_system_doc', { system: '出張申請システム', orient: 'diagonal' })).error.code, 'bad_request');
});

test('export_system_doc: 出せないページ（作業の箱がない・設計ノートに行がない）は黙って外し、included を false にする', async (t) => {
  const { call } = await boot(t, { steps: false, notes: false });
  const r = await call('export_system_doc', { system: '出張申請システム' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.included, { systemCover: true, swimlane: false, notes: false });
  assert.equal(r.result.designs[0].firstPage, 2);
});

test('export_system_doc: 知らないシステムは断る。ページが 1 つもないときは断る。ごみ箱のシステムも出せる', async (t) => {
  const { call, api } = await boot(t);
  assert.equal((await call('export_system_doc', { system: 'ないシステム' })).error.code, 'not_found');
  api.actions.createSystem({ name: '空のシステム', description: '' });
  const none = await call('export_system_doc', { system: '空のシステム', systemCover: false });
  assert.equal(none.error.code, 'bad_request');
  assert.match(none.error.message, /出力するページが 1 つもありません。/);
  const cover = await call('export_system_doc', { system: '空のシステム' });
  assert.equal(cover.result.pages, 1, '表紙だけ');
  assert.deepEqual(cover.result.designs, []);
  const old = await call('export_system_doc', { system: '古い申請システム' });
  assert.equal(old.ok, true, 'ごみ箱のシステムも出せる');
  assert.equal(old.render.files[0].name, '古い申請システム_システム設計書.pdf');
});

test('export_system_doc: 書く頼みではない（元に戻すの履歴・システムの履歴の行・更新日時が変わらない）', async (t) => {
  const { call, api, y } = await boot(t);
  const undo0 = api.store.undoStack.length;
  const before = plain({ revisions: y().revisions, updatedAt: y().updatedAt });
  assert.equal((await call('export_system_doc', { system: '出張申請システム' })).ok, true);
  assert.equal(api.store.undoStack.length, undo0);
  assert.deepEqual(plain({ revisions: y().revisions, updatedAt: y().updatedAt }), before);
});

test('手引き: ⑤ の段階で export_system_doc を使うと書き、「守ること」に出力のフォルダに書くと書く。道具の説明にフォルダの名前', () => {
  const { GUIDES, INSTRUCTIONS } = require('../mcp-guide');
  const { TOOLS } = require('../mcp-tools');
  const stages = GUIDES.stages.text;
  const row5 = stages.split('\n').find((l) => l.startsWith('| ⑤'));
  assert.match(row5, /export_system_doc でシステム設計書（PDF）を出力する/);
  assert.match(GUIDES.rules.text, /export_system_doc/);
  assert.match(INSTRUCTIONS + stages, /export_system_doc/);
  const tool = TOOLS.find((x) => x.name === 'export_system_doc');
  assert.ok(tool, 'export_system_doc がある');
  assert.ok(tool.description.includes('ドキュメント\\モックイメージメーカー\\AI の出力'));
  assert.equal(tool.readOnly, false, 'ファイルを書くので、読むだけの道具にしない');
  assert.equal(tool.slow, true);
  assert.deepEqual(Object.keys(tool.input.shape).sort(), ['cover', 'flow', 'items', 'map', 'notes', 'orient', 'paper', 'process', 'swimlane', 'system', 'systemCover'].sort());
});
