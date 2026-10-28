'use strict';
// AI の窓口の読む道具（第 7 段階の T4）のテスト。頼みの受け口（aiAPI）・指し方（id・名前・候補。設計書の 8-6）・
// 前の版を見ている間は本当の中身を返す（8-4）・返事を分ける（cursor。9-1）・list_designs・get_design・get_screen・get_catalog。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');
const { sampleState, design, item, ipart, STORAGE_KEY, plain } = require('./ai-fixtures');

async function boot(state = sampleState(), extra = {}) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) }, ...extra });
  const T = await app.api();
  const call = async (tool, args = {}, ctx = { session: 's-1', client: 'claude-code' }) => plain(await T.aiDispatch(tool, args, ctx));
  return { app, T, call };
}

test('aiAPI があれば、起動の終わりに頼みの受け口を付けて ready を送り、頼みに返事を返す', async () => {
  const fake = { handler: null, readyCount: 0, onRequest(cb) { this.handler = cb; }, ready() { this.readyCount++; } };
  const { app } = await boot(sampleState(), { aiAPI: fake });
  await waitFor(() => fake.readyCount === 1, { label: 'ready' });
  const res = plain(await fake.handler({ tool: 'list_designs', args: {}, session: 's-1', client: 'claude-code' }));
  assert.equal(res.ok, true);
  assert.deepEqual(res.result.designs.map((d) => d.name).sort(), ['受注管理', '顧客管理']);
  const bad = plain(await fake.handler({ tool: 'delete_design', args: {} }));
  assert.deepEqual(bad, { ok: false, error: { code: 'unknown_tool', message: '「delete_design」というツールはありません。' } });
  app.close();
});

test('list_designs: 既定はごみ箱を除く。trashed で、ごみ箱の画面設計も印を付けて出す。query で名前を探す', async () => {
  const { app, call } = await boot();
  const r = await call('list_designs');
  assert.equal(r.ok, true);
  assert.equal(r.result.total, 2);
  const d1 = r.result.designs.find((d) => d.id === 'd1');
  assert.deepEqual(d1, { id: 'd1', name: '顧客管理', target: 'kintone', look: 'standard', screens: 2, items: 3, latestVersion: null, updatedAt: '2026-10-01T00:00:00.000Z' });
  const all = await call('list_designs', { trashed: true });
  assert.equal(all.result.total, 3);
  assert.equal(all.result.designs.find((d) => d.id === 'd3').trashed, true);
  const q = await call('list_designs', { query: '受注' });
  assert.deepEqual(q.result.designs.map((d) => d.name), ['受注管理']);
  app.close();
});

test('get_design: 名前でも id でも指せる。項目の設定の文・置いている画面・取り込んでいる画面設計・改訂履歴を返す', async () => {
  const { app, T, call } = await boot();
  T.actions.addRevision('d1', { note: '最初の版' });
  const byName = await call('get_design', { design: '顧客管理' });
  const byId = await call('get_design', { design: 'd1' });
  assert.equal(byName.ok, true);
  assert.deepEqual(byName.result.items, byId.result.items);
  const r = byName.result;
  assert.equal(r.description, '取引先と顧客の連絡先を管理する。');
  const code = r.items.find((it) => it.name === '顧客コード');
  assert.equal(code.required, true);
  assert.match(code.setting, /必須/);
  assert.match(code.setting, /最大 10 文字/);
  assert.deepEqual(code.screens, ['新規登録']);
  assert.deepEqual(r.screens.map((s) => [s.name, s.parts, s.callouts]), [['新規登録', 3, 1], ['一覧', 0, 0]]);
  assert.deepEqual(r.importedBy, [{ design: '受注管理', item: '顧客名', from: '顧客名' }]);
  assert.equal(r.revisions.length, 1);
  assert.equal(r.revisions[0].title, '第 1 版');
  assert.equal(r.revisions[0].canRestore, true);
  assert.equal(r.revisions[0].snapshot, undefined);
  const order = await call('get_design', { design: '受注管理' });
  assert.deepEqual(order.result.items[0].importedFrom, { design: '顧客管理', lost: false });
  app.close();
});

test('get_design: ごみ箱の画面設計も読める。見つからない・同じ名前が 2 つのときは、理由と候補を返す', async () => {
  const st = sampleState();
  st.designs.push(design('d4', '受注管理', 'Salesforce'));
  const { app, call } = await boot(st);
  const trashed = await call('get_design', { design: '出張申請' });
  assert.equal(trashed.ok, true);
  assert.equal(trashed.result.trashed, true);
  const none = await call('get_design', { design: '経費精算' });
  assert.deepEqual(none, { ok: false, error: { code: 'not_found', message: '「経費精算」という画面設計は見つかりません。' } });
  const two = await call('get_design', { design: '受注管理' });
  assert.equal(two.ok, false);
  assert.equal(two.error.code, 'ambiguous');
  assert.match(two.error.message, /2 つあります/);
  assert.deepEqual(two.error.candidates.map((c) => c.id).sort(), ['d2', 'd4']);
  const empty = await call('get_design', {});
  assert.equal(empty.error.code, 'bad_request');
  app.close();
});

test('get_screen: アイテム（id・赤い番号・項目・位置・設定の文）・吹き出しのつなぐアイテム・設定一覧を返す', async () => {
  const { app, call } = await boot();
  const r = await call('get_screen', { design: '顧客管理', screen: '新規登録' });
  assert.equal(r.ok, true);
  const s = r.result;
  assert.deepEqual(s.design, { id: 'd1', name: '顧客管理', updatedAt: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual([s.id, s.device, s.width, s.height], ['s1', 'pc', 1280, 800]);
  const p1 = s.parts.find((p) => p.no === 1);
  assert.deepEqual({ ...p1, setting: undefined }, {
    id: 'p1', no: 1, type: 'text1', typeName: 'テキスト（1行）', label: '顧客コード', x: 32, y: 64, w: 320, h: 64, setting: undefined,
    item: { id: 'i1', name: '顧客コード' }, labelPos: 'top', sample: '', placeholder: '',
  });
  assert.deepEqual(s.callouts.map((c) => [c.id, c.text, c.color, c.tip, c.w, c.h, c.target]), [['k1', '顧客コードは自動で振る。', 'yellow', 'arrow', 200, 80, { id: 'p1', no: 1 }]]);
  assert.deepEqual(s.table.map((t) => [t.no, t.label]), [[1, '顧客コード'], [2, '顧客名'], [3, '区分']]);
  assert.match(s.table[2].setting, /選択肢＝法人／個人/);
  const byId = await call('get_screen', { design: 'd1', screen: 's2' });
  assert.equal(byId.result.name, '一覧');
  const none = await call('get_screen', { design: 'd1', screen: '詳細' });
  assert.equal(none.error.code, 'not_found');
  assert.match(none.error.message, /「顧客管理」の画面/);
  app.close();
});

test('前の版を見ている間も、読む道具は本当の中身を返す', async () => {
  const { app, T, call } = await boot();
  T.actions.addRevision('d1', { note: '第 1 版' });
  T.actions.updateDesignInfo('d1', { description: '今の説明' });
  const view = T.store.state.designs.map((d) => (d.id === 'd1' ? { ...d, description: '前の版の説明' } : d));
  T.store.startViewing({ ...T.store.state, designs: view });
  assert.equal(T.store.isViewing, true);
  const r = await call('get_design', { design: 'd1' });
  assert.equal(r.result.description, '今の説明');
  T.store.stopViewing();
  app.close();
});

test('大きい返事は分ける。項目が 300 個あると nextCursor を返し、続きを読むと重ならずに全部そろう', async () => {
  const st = sampleState();
  st.designs[0].items = Array.from({ length: 300 }, (_, i) => item(`x${i}`, `項目 ${i + 1}`, 'dropdown', { memo: '説明の文。'.repeat(8), props: { options: ['あ', 'い', 'う'], initial: '' } }));
  const { app, call } = await boot(st);
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const r = await call('get_design', { design: 'd1', cursor });
    assert.ok(JSON.stringify(r.result.items).length <= 24000 + 2000);
    seen.push(...r.result.items.map((it) => it.id));
    assert.equal(r.result.itemsTotal, 300);
    cursor = r.result.nextCursor;
    pages++;
  } while (cursor && pages < 50);
  assert.ok(pages >= 2);
  assert.equal(seen.length, 300);
  assert.equal(new Set(seen).size, 300);
  app.close();
});

test('get_screen: アイテムが 150 個あっても、どのページも目安（24,000 字）以下。続きを読むと、アイテム・吹き出し・一覧表の行が重ならずに全部そろう', async () => {
  const st = sampleState();
  const d1 = st.designs[0];
  d1.items = Array.from({ length: 150 }, (_, i) => item(`x${i}`, `項目 ${i + 1}`, 'dropdown', { memo: '説明の文。'.repeat(4), props: { options: ['あ', 'い', 'う'], initial: '' } }));
  const sc = d1.screens[0];
  sc.parts = Array.from({ length: 150 }, (_, i) => ipart(`q${i}`, 32 + (i % 2) * 448, 64 + Math.floor(i / 2) * 72, i + 1, `x${i}`, 'dropdown'));
  sc.height = 5600;
  sc.callouts = Array.from({ length: 30 }, (_, i) => ({ id: `k${i}`, x: 1300, y: 64 + i * 96, w: 200, h: 80, text: `吹き出しの文 ${i + 1}。`.repeat(3), color: 'yellow', tip: 'arrow', target: `q${i}` }));
  const { app, call } = await boot(st);
  const got = { parts: [], callouts: [], table: [] };
  let cursor;
  let pages = 0;
  do {
    const r = await call('get_screen', { design: 'd1', screen: 's1', cursor });
    assert.equal(r.ok, true);
    const size = JSON.stringify(r.result).length;
    assert.ok(size <= 24000, `${pages + 1} ページ目の返事が ${size} 字`);
    assert.deepEqual([r.result.partsTotal, r.result.calloutsTotal, r.result.tableTotal], [150, 30, 150]);
    Object.keys(got).forEach((k) => got[k].push(...r.result[k]));
    cursor = r.result.nextCursor;
    pages++;
  } while (cursor && pages < 50);
  assert.ok(pages >= 2);
  assert.ok(JSON.stringify(got).length > 36000, '全部を 1 回で返すと目安を超える大きさ');
  assert.deepEqual(got.parts.map((p) => p.id), sc.parts.map((p) => p.id));
  assert.deepEqual(got.callouts.map((c) => c.id), sc.callouts.map((c) => c.id));
  assert.deepEqual(got.table.map((t) => t.no), Array.from({ length: 150 }, (_, i) => i + 1));
  assert.equal(got.table[149].label, '項目 150');
  app.close();
});

test('get_catalog: アイテムの種類・設定の欄の説明・ひな形・機器・並べ方の数を返す', async () => {
  const { app, T, call } = await boot();
  const r = await call('get_catalog');
  assert.equal(r.ok, true);
  const c = r.result;
  assert.deepEqual(c.parts.map((p) => p.type), Object.keys(T.PART_TYPES));
  const text1 = c.parts.find((p) => p.type === 'text1');
  assert.deepEqual([text1.w, text1.h, text1.numbered, text1.item], [320, 64, true, 'データベースの項目になる']);
  assert.match(text1.props.maxLen, /最大文字数/);
  assert.match(c.parts.find((p) => p.type === 'button').props.style, /primary/);
  assert.match(c.parts.find((p) => p.type === 'status').itemProps.states, /ステータスの並び/);
  assert.equal(c.parts.find((p) => p.type === 'heading').numbered, false);
  assert.deepEqual(c.templates.map((t) => t.id), ['blank', 'input', 'detail', 'list', 'graph', 'agg', 'steps', 'crmDetail', 'crmCase']);
  assert.deepEqual(c.devices.phone, { label: 'スマホ', width: 375, height: 667 });
  assert.deepEqual(c.layout.columnsLeft, [32, 480]);
  assert.equal(c.layout.spanWidth, 848);
  assert.deepEqual(c.layout.firstRowY, { withHeader: 64, withoutHeader: 24 });
  assert.ok(c.itemTypes.includes('table') && c.itemTypes.includes('status'));
  app.close();
});

test('頼みは 1 つずつ実行する（同時に頼んでも、頼んだ順に返す）', async () => {
  const { app, T } = await boot();
  const order = [];
  const ps = ['list_designs', 'get_catalog', 'get_design'].map((tool) => T.aiDispatch(tool, tool === 'get_design' ? { design: 'd1' } : {}, {}).then(() => order.push(tool)));
  await Promise.all(ps);
  assert.deepEqual(order, ['list_designs', 'get_catalog', 'get_design']);
  app.close();
});
