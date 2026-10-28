'use strict';
// AI の道具の第 14 段階の分（グループ枠・レコードの見出し・活動履歴・ツリー・関連レコード一覧の並べて表示・ひな形 2 つ）のテスト。
// get_catalog・layout_screen のグループ枠の形（frame）と縦に重ねる形（stack）と見出しのボタン（buttons）・get_screen の inFrame・edit_parts・
// get_kintone_app のグループ（GROUP）・入口の形（mcp-schemas.js の layout）。画面設計の名前は架空の業務（顧客管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, screen, item, design, STORAGE_KEY, plain } = require('./ai-fixtures');
const { layout: layoutSchema } = require('../mcp-schemas');
const KT = require('./kintone-mcp-shapes');

async function boot(state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const send = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const call = async (tool, args = {}) => {
    const r = await send(tool, args);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const parts = (sid) => plain(T.store.state.designs[0].screens.find((s) => s.id === sid).parts);
  return { app, T, send, call, parts };
}
const rect = (p) => [p.x, p.y, p.w, p.h];
const valid = (schema, v, what) => {
  const r = schema.safeParse(v);
  assert.ok(r.success, `${what}: ${JSON.stringify(r.error && r.error.issues.slice(0, 3))}`);
};

test('get_catalog: 追加した 4 つのアイテム（組・中に入れる印・props の説明）と、関連レコード一覧の表示のしかた・ひな形 2 つ・グループ枠の並べ方の数', async () => {
  const { app, call } = await boot();
  const c = await call('get_catalog');
  const by = Object.fromEntries(c.parts.map((p) => [p.type, p]));
  assert.deepEqual(['frame', 'recordHead', 'activity', 'tree'].map((t) => [by[t].name, by[t].group, !!by[t].container]),
    [['グループ枠', '詳細画面用', true], ['レコードの見出し', '詳細画面用', true], ['活動履歴', '詳細画面用', false], ['ツリー', '一覧画面用', false]]);
  assert.deepEqual(Object.keys(by.frame.props), ['color']);
  assert.deepEqual(Object.keys(by.recordHead.props), ['kind', 'name', 'color', 'items', 'values']);
  assert.deepEqual(Object.keys(by.activity.props), ['samples', 'buttons', 'months']);
  assert.deepEqual(Object.keys(by.tree.props), ['lines', 'current', 'folder']);
  assert.match(by.table.props.display, /"tiles"（並べて表示）/);
  assert.match(by.frame.props.color, /"none"（なし）/);
  assert.deepEqual(c.templates.slice(-2).map((t) => t.id), ['crmDetail', 'crmCase']);
  assert.deepEqual(c.layout.frame, { padding: 24, top: 64, emptyHeight: 160 });
  app.close();
});

test('layout_screen: グループ枠の形 { frame, columns, rows } は、グループ枠を 1 つ置いて中に rows を並べて入れる。高さは中身に合わせ、中の入力の項目は列の幅いっぱい', async () => {
  const { app, call, parts } = await boot();
  const r = await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [
    [{ frame: '顧客の情報', color: 'green', columns: 2, rows: [[{ item: '顧客コード' }, { item: '顧客名' }], [{ item: '区分' }], { align: 'right', parts: [{ type: 'button', label: '編集' }] }] }],
    [{ type: 'button', label: '戻る' }],
  ] } });
  const ps = parts('s2');
  assert.deepEqual(ps.map((p) => [p.no, p.type]), [[1, 'frame'], [2, 'text1'], [3, 'text1'], [4, 'dropdown'], [5, 'button'], [6, 'button']]);
  const [f, a, b, c, edit, back] = ps;
  assert.deepEqual([...rect(f), f.label, f.props.color], [32, 64, 848, 304, '顧客の情報', 'green'], '1 列の並べ方では、2 列の幅いっぱい（848）');
  assert.deepEqual([rect(a), rect(b), rect(c)], [[56, 128, 384, 64], [472, 128, 384, 64], [56, 216, 384, 64]]);
  assert.deepEqual([edit.x, edit.y, edit.props.style], [760, 304, 'primary'], 'ボタンの行はグループ枠の中で右に寄せる');
  assert.ok([a, b, c, edit].every((p) => p.inFrame === f.id), '中に並べたアイテムはグループ枠に入る');
  assert.equal(back.inFrame, undefined);
  assert.equal(back.y, 64 + 304 + 24, 'グループ枠の行の高さは、グループ枠の高さ');
  assert.deepEqual(r.parts.map((p) => p.type), ['frame', 'text1', 'text1', 'dropdown', 'button', 'button']);
  app.close();
});

test('layout_screen: 縦に重ねる形 { stack, span } とレコードの見出しの buttons で、Salesforce のレコードの画面を並べる（3 列の並べ方）', async () => {
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { columns: 3, rows: [
    [{ type: 'recordHead', span: 3, props: { kind: '顧客', name: '株式会社サンプル商事', items: ['顧客コード', '区分'], values: ['C-001', '法人'] },
      buttons: [{ type: 'button', label: '編集' }, { type: 'button', label: '削除' }] }],
    [{ stack: [{ frame: '顧客の情報', columns: 2, rows: [[{ item: '顧客コード' }, { item: '顧客名' }]] }, { type: 'activity' }], span: 2 },
      { stack: [{ type: 'table', tableKind: 'related', label: '商談', props: { display: 'tiles', db: '商談', columns: ['商談名', '金額'] } }, { type: 'tree' }] }],
  ] } });
  const ps = parts('s2');
  assert.deepEqual(ps.map((p) => [p.no, p.type]), [[1, 'recordHead'], [2, 'button'], [3, 'button'], [4, 'frame'], [5, 'text1'], [6, 'text1'], [7, 'activity'], [8, 'table'], [9, 'tree']]);
  const [head, edit, del, f, , , act, tiles, tree] = ps;
  assert.deepEqual(rect(head), [32, 64, 1200, 96], '3 列の幅いっぱい');
  assert.deepEqual(plain([head.props.items.length, head.props.values]), [2, ['C-001', '法人']]);
  assert.deepEqual([rect(edit), rect(del)], [[992, 88, 96, 40], [1120, 88, 96, 40]], 'ボタンは見出しの右に重ね、見出しに入れる');
  assert.deepEqual([edit.inFrame, del.inFrame, edit.props.style, del.props.style], [head.id, head.id, 'primary', 'normal']);
  assert.deepEqual(rect(f), [32, 184, 784, 152], '左の列（2 列の幅）に上から重ねる');
  assert.deepEqual(rect(act), [32, 360, 784, 400]);
  assert.deepEqual([...rect(tiles), tiles.props.display, tiles.props.db.name], [864, 184, 368, 256, 'tiles', '商談'], '並べて表示の高さは件数と列の数から');
  assert.deepEqual(rect(tree), [864, 464, 368, 320]);
  assert.ok(ps.filter((p) => p.type === 'text1').every((p) => p.inFrame === f.id));
  app.close();
});

test('layout_screen: レコードの見出しの主な項目（props.items）は、同じ並べ方の後ろの行で作る項目も名前で指せる。ない項目は、どこが違うかを添えて断る', async () => {
  const { app, call, send, parts, T } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { columns: 2, rows: [
    [{ type: 'recordHead', props: { kind: '顧客', items: ['電話', '担当者', '顧客コード'], values: ['03-1234-5678', '佐藤 花子', 'C-001'] } }],
    [{ frame: '顧客の情報', columns: 2, rows: [[{ item: '電話', type: 'text1' }, { item: '担当者', type: 'user' }]] }],
  ] } });
  const d1 = T.store.state.designs[0];
  const head = parts('s2')[0];
  assert.deepEqual(plain(head.props.items.map((id) => d1.items.find((it) => it.id === id).name)), ['電話', '担当者', '顧客コード']);
  const r = await send('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ type: 'recordHead', props: { items: ['ない項目'] } }]] } });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /rows\[0\]\[0\].*ない項目/);
  app.close();
});

test('layout_screen: 書き方の誤りは、どこが違うかを添えて断る（グループ枠の中のグループ枠・重ねた stack・見出しでないアイテムの buttons・列の数・色）', async () => {
  const { app, send } = await boot();
  const bad = async (rows, re, columns) => {
    const r = await send('layout_screen', { design: 'd1', screen: 's2', layout: { rows, ...(columns ? { columns } : {}) } });
    assert.equal(r.ok, false);
    assert.match(r.error.message, re);
  };
  await bad([[{ frame: '外', rows: [[{ frame: '中', rows: [] }]] }]], /rows\[0\]\[0\]\.rows\[0\]\[0\].*グループ枠の中に、グループ枠と stack は置けません/);
  await bad([[{ stack: [{ stack: [{ type: 'tree' }] }] }]], /rows\[0\]\[0\]\.stack\[0\].*stack の中に stack は置けません/);
  await bad([[{ type: 'tree', buttons: [{ type: 'button', label: '編集' }] }]], /buttons を書けるのは、レコードの見出し（recordHead）だけです/);
  await bad([[{ frame: '顧客の情報', columns: 3, rows: [] }]], /グループ枠の columns は 1 か 2 です/);
  await bad([[{ frame: '顧客の情報', color: 'pink', rows: [] }]], /"blue"・"green"/);
  await bad([{ align: 'left', parts: [{ frame: '顧客の情報', rows: [] }] }], /rows\[0\]\.parts\[0\].*ボタンの行（align）には、グループ枠と stack は置けません/);
  app.close();
});

test('get_screen: グループ枠・レコードの見出しに入っているアイテムは inFrame（id と名前）。edit_parts の move・move_by は、人がドラッグしたときと同じ決まりで入る・出る', async () => {
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [
    [{ type: 'recordHead', buttons: [{ type: 'button', label: '編集' }] }],
    [{ frame: '顧客の情報', columns: 2, rows: [[{ item: '顧客コード' }, { item: '顧客名' }]] }],
  ] } });
  const [head, , f, a, b] = parts('s2');
  const s = await call('get_screen', { design: 'd1', screen: 's2' });
  const of = (id) => s.parts.find((p) => p.id === id);
  assert.deepEqual(of(a.id).inFrame, { id: f.id, name: '顧客の情報' });
  assert.deepEqual(s.parts[1].inFrame, { id: head.id, name: 'レコードの見出し' });
  assert.equal(of(f.id).inFrame, undefined);
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'move_by', parts: [f.id], dy: 40 }] });
  assert.deepEqual(parts('s2').slice(2, 5).map((p) => p.y), [f.y + 40, a.y + 40, b.y + 40], 'グループ枠を動かすと、中のアイテムも動く');
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'move', part: a.id, x: 32, y: 600 }] });
  assert.equal(parts('s2')[3].inFrame, undefined, '真ん中がグループ枠の外へ出たアイテムは、グループ枠から出る');
  app.close();
});

test('edit_parts: 追加したアイテムの設定（グループ枠の色・見出しの主な項目は項目名で書ける・活動・ツリー・関連レコード一覧の表示のしかた）', async () => {
  const { app, call, send, parts, T } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [
    [{ type: 'frame' }], [{ type: 'recordHead' }], [{ type: 'activity' }], [{ type: 'tree' }],
    [{ type: 'table', tableKind: 'related', label: '商談', props: { db: '商談', columns: ['商談名', '金額', '段階'] } }],
  ] } });
  const [f, h, a, t, rel] = parts('s2');
  await call('edit_parts', { design: 'd1', screen: 's2', ops: [
    { op: 'update', part: f.id, label: 'メモ', props: { color: 'purple' } },
    { op: 'update', part: h.id, props: { kind: '顧客', items: ['顧客名', '区分'], values: ['株式会社サンプル商事', '法人'] } },
    { op: 'update', part: a.id, props: { samples: '2026-10-01, 電話, 問い合わせ', buttons: false } },
    { op: 'update', part: t.id, props: { lines: '総務\n  備品', current: '総務 > 備品' } },
    { op: 'update', part: rel.id, props: { display: 'tiles', color: 'green' }, rows: 2 },
  ] });
  const [f2, h2, a2, t2, rel2] = parts('s2');
  const d1 = T.store.state.designs[0];
  assert.deepEqual([f2.label, f2.props.color], ['メモ', 'purple']);
  assert.deepEqual(plain(h2.props.items.map((id) => d1.items.find((it) => it.id === id).name)), ['顧客名', '区分']);
  assert.deepEqual([a2.props.samples, a2.props.buttons], ['2026-10-01, 電話, 問い合わせ', false]);
  assert.deepEqual([t2.props.lines, t2.props.current], ['総務\n  備品', '総務 > 備品']);
  assert.deepEqual([rel2.props.display, rel2.props.color, rel2.h], ['tiles', 'green', 240], '並べて表示にすると、高さも合わせる（2 件・列 3 つ）');
  const r = await send('edit_parts', { design: 'd1', screen: 's2', ops: [{ op: 'update', part: rel.id, props: { display: 'cards' } }] });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /"table"（表）・"tiles"（並べて表示）/);
  app.close();
});

// グループ枠を置いた kintone の画面設計（顧客管理）
function groupState() {
  const p = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, w, h, no: null, labelPos: 'top', sample: '', placeholder: '', ...extra });
  const items = [
    item('i1', '顧客コード', 'text1'), item('i2', '顧客名', 'text1'), item('i3', '区分', 'dropdown', { props: { options: ['法人', '個人'], initial: '' } }),
    item('i4', '明細', 'table', { props: { columns: [{ id: 'c1', name: '品名', type: 'text1', required: false, memo: '', props: {} }] } }),
  ];
  const s1 = screen('s1', '顧客の詳細', [
    p('h0', 'recordHead', 32, 56, 1216, 96, { label: '', props: { kind: '顧客', name: '株式会社サンプル商事', color: 'blue', items: [], values: [] } }),
    p('f1', 'frame', 32, 176, 848, 400, { label: '顧客の情報', props: { color: 'blue' } }),
    p('p1', 'text1', 56, 240, 384, 64, { itemId: 'i1', inFrame: 'f1' }), p('p2', 'text1', 472, 240, 384, 64, { itemId: 'i2', inFrame: 'f1' }),
    p('p4', 'table', 56, 328, 640, 168, { itemId: 'i4', tableKind: 'subtable', label: '明細', view: { rows: 3 }, inFrame: 'f1' }),
    p('p3', 'dropdown', 32, 600, 320, 64, { itemId: 'i3' }),
    p('a1', 'activity', 900, 176, 348, 400, { label: '活動', props: { samples: '', buttons: true, months: true } }),
    p('t1', 'tree', 900, 600, 240, 320, { label: '', props: { lines: '', current: '', folder: true } }),
  ]);
  return { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [],
    designs: [design('d1', '顧客管理', 'kintone', { look: 'kintone', items, screens: [s1] })] };
}

test('get_kintone_app: グループ枠は kintone のグループ（GROUP）。properties に GROUP を追加し、layout ではグループ枠の中の項目を GROUP の行に入れる', async () => {
  const { app, call } = await boot(groupState());
  const r = await call('get_kintone_app', { design: 'd1' });
  valid(KT.properties, r.properties, 'properties');
  valid(KT.layout, r.layout, 'layout');
  assert.deepEqual(r.properties['顧客の情報'], { type: 'GROUP', code: '顧客の情報', label: '顧客の情報', openGroup: true });
  const w = (n) => ({ width: String(n) });
  assert.deepEqual(r.layout, [
    { type: 'GROUP', code: '顧客の情報', layout: [{ type: 'ROW', fields: [{ type: 'SINGLE_LINE_TEXT', code: '顧客コード', size: w(384) }, { type: 'SINGLE_LINE_TEXT', code: '顧客名', size: w(384) }] }] },
    { type: 'SUBTABLE', code: '明細', fields: [{ type: 'SINGLE_LINE_TEXT', code: '品名' }] },
    { type: 'ROW', fields: [{ type: 'DROP_DOWN', code: '区分', size: w(320) }] },
  ]);
  const warn = r.warnings.join('\n');
  assert.match(warn, /「明細」（テーブル）は kintone のグループに入れられないので、グループ「顧客の情報」の後ろに置きました/);
  assert.match(warn, /「レコードの見出し」（レコードの見出し）は kintone のフィールドにないので、フォームに入れていません/);
  assert.match(warn, /「活動」（活動履歴）は kintone のフィールドにない/);
  assert.match(warn, /「ツリー」（ツリー）は kintone のフィールドにない/);
  app.close();
});

test('手引き: layout にレコードの画面の書き方の例（入口とアプリでそのまま通る）、catalog に追加した 4 つのアイテム、kintone にグループ（GROUP）', async () => {
  const { GUIDES } = require('../mcp-guide');
  const text = GUIDES.layout.text;
  const block = text.split('## レコードの画面の書き方の例')[1];
  assert.ok(block, 'レコードの画面の書き方の例の節がある');
  const example = JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}\n') + 2));
  valid(layoutSchema, example, '手引きの例');
  const { app, call, parts } = await boot();
  await call('layout_screen', { design: 'd1', screen: 's2', layout: example });
  const types = parts('s2').map((p) => p.type);
  assert.ok(['recordHead', 'frame', 'activity', 'table', 'button'].every((t) => types.includes(t)), types.join(','));
  app.close();
  for (const w of ['frame', 'stack', 'buttons', 'inFrame']) assert.ok(text.includes(w), `layout の手引きに ${w}`);
  for (const w of ['グループ枠', 'レコードの見出し', '活動履歴', 'ツリー', 'container', '"tiles"']) assert.ok(GUIDES.catalog.text.includes(w), `catalog の手引きに ${w}`);
  assert.match(GUIDES.kintone.text, /グループ枠は kintone のグループ（GROUP）/);
});

test('入口の形（mcp-schemas.js の layout）: グループ枠の形・縦に重ねる形・見出しの buttons を受け、グループ枠の中のグループ枠と重ねた stack は断る', () => {
  valid(layoutSchema, { columns: 3, rows: [
    [{ type: 'recordHead', span: 3, buttons: [{ type: 'button', label: '編集' }] }],
    [{ stack: [{ frame: '顧客の情報', color: 'blue', columns: 2, rows: [[{ item: '顧客名' }], { align: 'right', parts: [{ type: 'button', label: '保存' }] }] }, { type: 'activity' }], span: 2 },
      { frame: 'メモ', rows: [[{ item: '備考' }]] }],
  ] }, 'layout');
  assert.equal(layoutSchema.safeParse({ rows: [[{ frame: '外', rows: [[{ frame: '中', rows: [] }]] }]] }).success, false);
  assert.equal(layoutSchema.safeParse({ rows: [[{ stack: [{ stack: [] }] }]] }).success, false);
  assert.equal(layoutSchema.safeParse({ rows: [[{ frame: 'a', columns: 3, rows: [] }]] }).success, false);
});
