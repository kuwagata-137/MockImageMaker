'use strict';
// AI の窓口の第 8 段階の道具のテスト: edit_process（ステータスと操作）・get_flow（ステータスの移り方と画面の移り方を表で読む）・
// get_view_image（図の画像）と、ボタン・リンクの文字の移る先（to）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { sampleState, item, screen, STORAGE_KEY, plain } = require('./ai-fixtures');

const STATES = [{ id: 't1', name: '申請' }, { id: 't2', name: '承認待ち' }, { id: 't3', name: '承認済み' }];
const ACTIONS = [
  { id: 'a1', name: '申請する', from: 't1', to: 't2', role: '申請者', cond: '' },
  { id: 'a2', name: '承認する', from: 't2', to: 't3', role: '上長', cond: '' },
];
const movePart = (id, type, x, y, no, label, props) => ({
  id, type, x, y, w: type === 'button' ? 96 : 200, h: type === 'button' ? 40 : 24, no, label,
  props: { ...(type === 'button' ? { style: 'primary', action: '' } : {}), to: '', designId: '', screenId: '', url: '', ...props },
});

// 顧客管理（d1）: ステータスの項目（申請 → 承認待ち → 承認済み・操作 2 つ）・新規登録（s1）のボタン → 一覧（s2）・
// 一覧のリンクの文字 → 受注管理の受注の一覧・URL のリンクの文字・移る先のないボタン。受注管理（d2）の受注の一覧のリンクの文字 → 顧客管理の新規登録
function flowState() {
  const st = sampleState();
  st.schemaVersion = 3;
  const [d1, d2] = st.designs;
  d1.items.push(item('st', 'ステータス', 'status', { props: { states: plain(STATES), actions: plain(ACTIONS) } }));
  d1.screens[0].parts.push(
    { id: 'p9', type: 'status', x: 800, y: 64, w: 160, h: 32, no: null, itemId: 'st', view: { current: 't2' } },
    movePart('b1', 'button', 32, 300, 4, '一覧へ', { to: 'screen', screenId: 's2' }),
  );
  d1.screens[1].parts.push(
    movePart('l1', 'link', 32, 64, 1, '受注を見る', { to: 'screen', designId: 'd2', screenId: 's-d2' }),
    movePart('l2', 'link', 32, 104, 2, 'ヘルプ', { to: 'url', url: 'https://example.com/help' }),
    movePart('b2', 'button', 32, 144, 3, '戻る', {}),
  );
  d2.screens = [screen('s-d2', '受注の一覧', [movePart('l9', 'link', 32, 64, 1, '顧客を見る', { to: 'screen', designId: 'd1', screenId: 's1' })])];
  return st;
}

async function boot(state = flowState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  return { app, T, call, d };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };
const statusOf = (design) => design.items.find((x) => x.type === 'status');

// ── edit_process ──
test('edit_process: ステータスの項目がなければ set_states で作る（見本の操作は入れない）。同じ名前は今の id を残し、なくなったステータスを使う操作は消して知らせる', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('edit_process', { design: '受注管理', ops: [{ op: 'set_states', states: ['受付', '出荷待ち', '出荷済み'] }] }));
  const it = statusOf(d('d2'));
  assert.equal(it.name, 'ステータス');
  assert.deepEqual(it.props.states.map((s) => s.name), ['受付', '出荷待ち', '出荷済み']);
  assert.deepEqual(it.props.actions, []);
  assert.deepEqual(r.item, { id: it.id, name: 'ステータス' });
  assert.deepEqual(r.states.map((s) => s.name), ['受付', '出荷待ち', '出荷済み']);
  assert.equal(r.changed, true);
  // 顧客管理: 承認待ちを外すと、承認待ちを使う 2 つの操作が消え、承認待ちを見本で出していた部品は「なし」になる
  const r2 = ok(await call('edit_process', { design: 'd1', ops: [{ op: 'set_states', states: ['申請', '承認済み', '完了'] }] }));
  const st = statusOf(d('d1'));
  assert.deepEqual(st.props.states.slice(0, 2).map((s) => s.id), ['t1', 't3']);
  assert.deepEqual(st.props.actions, []);
  assert.deepEqual(r2.ops[0].removedActions, ['申請する', '承認する']);
  assert.match(r2.warnings[0], /「申請する」・「承認する」/);
  assert.equal(d('d1').screens[0].parts.find((p) => p.id === 'p9').view.current, '');
  app.close();
});

test('edit_process: ステータスを足す・名前を変える・並べ替える・消す（使う操作も消える）。ステータスは名前でも id でも指せる', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('edit_process', { design: 'd1', ops: [
    { op: 'add_state', name: '完了' },
    { op: 'add_state', name: '下書き', before: '申請' },
    { op: 'rename_state', state: 't3', name: '承認済み（課長）' },
    { op: 'move_state', state: '完了', index: 1 },
  ] }));
  const props = () => statusOf(d('d1')).props;
  assert.deepEqual(props().states.map((s) => s.name), ['下書き', '完了', '申請', '承認待ち', '承認済み（課長）']);
  assert.equal(r.ops[0].name, '完了');
  assert.ok(r.ops[0].id && !['t1', 't2', 't3'].includes(r.ops[0].id));
  assert.deepEqual(r.ops[3], { op: 'move_state', id: r.ops[0].id, name: '完了', index: 1 });
  const del = ok(await call('edit_process', { design: 'd1', ops: [{ op: 'delete_state', state: '承認待ち' }] }));
  assert.deepEqual(del.ops[0].removedActions, ['申請する', '承認する']);
  assert.deepEqual(props().actions, []);
  app.close();
});

test('edit_process: 操作を足す・直す・並べ替える・消す。前と次はステータスの名前か id で書き、返事は名前で返す', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('edit_process', { design: 'd1', ops: [
    { op: 'add_action', name: '差し戻す', from: '承認待ち', to: 't1', role: '上長', cond: '書き直してほしいとき' },
    { op: 'update_action', action: '承認する', role: '課長', cond: '金額が 10 万円まで' },
    { op: 'move_action', action: '差し戻す', before: '承認する' },
  ] }));
  const acts = statusOf(d('d1')).props.actions;
  assert.deepEqual(acts.map((a) => [a.name, a.from, a.to, a.role, a.cond]), [
    ['申請する', 't1', 't2', '申請者', ''],
    ['差し戻す', 't2', 't1', '上長', '書き直してほしいとき'],
    ['承認する', 't2', 't3', '課長', '金額が 10 万円まで'],
  ]);
  assert.deepEqual(r.actions[1], { id: acts[1].id, name: '差し戻す', from: '承認待ち', to: '申請', role: '上長', cond: '書き直してほしいとき' });
  assert.deepEqual(r.ops[0], { op: 'add_action', id: acts[1].id, name: '差し戻す' });
  ok(await call('edit_process', { design: 'd1', ops: [{ op: 'update_action', action: 'a1', name: '申請を出す', to: '承認済み' }, { op: 'delete_action', action: '差し戻す' }] }));
  assert.deepEqual(statusOf(d('d1')).props.actions.map((a) => [a.name, a.to]), [['申請を出す', 't3'], ['承認する', 't3']]);
  app.close();
});

test('edit_process: 断る（前と次が同じ・ないステータス・同じ名前・最後の 1 つ・項目がない・取り込んだ項目・2 つに当たる操作）。途中で断ると何も変わらない', async () => {
  const st = flowState();
  st.designs[1].items.push(item('o2', 'ステータス', 'status', { props: { states: plain(STATES), actions: plain(ACTIONS) }, link: { designId: 'd1', itemId: 'st', designName: '顧客管理', lost: false } }));
  const { app, call, d } = await boot(st);
  const before = d('d1');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'add_action', name: '自分へ', from: '申請', to: '申請' }] }), 'bad_request');
  const e = ng(await call('edit_process', { design: 'd1', ops: [{ op: 'add_state', name: '完了' }, { op: 'add_action', name: '却下する', from: '申請', to: '却下' }] }), 'not_found');
  assert.match(e.message, /^ops\[1\]（add_action）: 「却下」というステータスは見つかりません（ステータス: 申請・承認待ち・承認済み・完了）/);
  assert.deepEqual(d('d1'), before, '途中で断ると、前の操作も入らない');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'add_state', name: '申請' }] }), 'same_name');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'rename_state', state: '申請', name: '承認待ち' }] }), 'same_name');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'set_states', states: ['完了', '完了'] }] }), 'bad_request');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'set_states', states: ['完了'] }, { op: 'delete_state', state: '完了' }] }), 'bad_request');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'update_action', action: 'a1', to: '申請' }] }), 'bad_request');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'update_action', action: 'a1' }] }), 'bad_request');
  ng(await call('edit_process', { design: 'd1', ops: [{ op: 'swap' }] }), 'bad_request');
  assert.match(ng(await call('edit_process', { design: 'd2', ops: [{ op: 'add_state', name: '完了' }] }), 'linked').message, /顧客管理/);
  const c = ok(await call('create_design', { name: '備品管理' }));
  assert.match(ng(await call('edit_process', { design: c.id, ops: [{ op: 'add_action', name: '貸す', from: 'a', to: 'b' }] }), 'not_found').message, /set_states/);
  ok(await call('edit_process', { design: 'd1', ops: [{ op: 'add_action', name: '承認する', from: '申請', to: '承認済み' }] }));
  assert.equal(ng(await call('edit_process', { design: 'd1', ops: [{ op: 'delete_action', action: '承認する' }] }), 'ambiguous').candidates.length, 2);
  assert.deepEqual(d('d1').screens, before.screens);
  app.close();
});

test('edit_items: ステータスの項目の操作（actions）は edit_process で直すと断る。get_design のステータスの項目は、操作の数も返す', async () => {
  const { app, call } = await boot();
  assert.match(ng(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: 'ステータス', props: { actions: [] } }] }), 'bad_request').message, /edit_process/);
  const s = ok(await call('get_design', { design: 'd1' })).items.find((x) => x.type === 'status');
  assert.deepEqual([s.states, s.actions], [['申請', '承認待ち', '承認済み'], 2]);
  const cat = ok(await call('get_catalog'));
  assert.match(cat.parts.find((p) => p.type === 'status').itemProps.states, /edit_process/);
  assert.match(cat.parts.find((p) => p.type === 'button').props.to, /移る先/);
  assert.match(cat.parts.find((p) => p.type === 'link').props.designId, /画面設計/);
  app.close();
});

// ── get_flow ──
test('get_flow: ステータスと操作（名前で）・画面・ボタンとリンクの文字の移る先・ほかの画面設計から移ってくるもの', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('get_flow', { design: '顧客管理' }));
  assert.deepEqual(r.design, { id: 'd1', name: '顧客管理', updatedAt: d('d1').updatedAt });
  assert.deepEqual(r.status, { item: { id: 'st', name: 'ステータス' }, states: plain(STATES) });
  assert.deepEqual(r.actions, [
    { id: 'a1', name: '申請する', from: '申請', to: '承認待ち', role: '申請者', cond: '' },
    { id: 'a2', name: '承認する', from: '承認待ち', to: '承認済み', role: '上長', cond: '' },
  ]);
  assert.deepEqual(r.screens, [{ id: 's1', name: '新規登録', device: 'pc' }, { id: 's2', name: '一覧', device: 'pc' }]);
  assert.deepEqual(r.moves, [
    { screen: '新規登録', screenId: 's1', part: { id: 'b1', no: 4, type: 'button', label: '一覧へ' }, to: { screen: '一覧', screenId: 's2' } },
    { screen: '一覧', screenId: 's2', part: { id: 'l1', no: 1, type: 'link', label: '受注を見る' }, to: { design: '受注管理', designId: 'd2', screen: '受注の一覧', screenId: 's-d2' } },
    { screen: '一覧', screenId: 's2', part: { id: 'l2', no: 2, type: 'link', label: 'ヘルプ' }, to: { url: 'https://example.com/help' } },
    { screen: '一覧', screenId: 's2', part: { id: 'b2', no: 3, type: 'button', label: '戻る' }, to: null },
  ]);
  assert.deepEqual(r.incoming, [{ design: '受注管理', designId: 'd2', screen: '受注の一覧', screenId: 's-d2', part: { type: 'link', label: '顧客を見る' }, to: '新規登録', toScreenId: 's1' }]);
  assert.deepEqual([r.actionsTotal, r.movesTotal, r.incomingTotal, r.nextCursor], [2, 4, 1, null]);
  const r2 = ok(await call('get_flow', { design: 'd2' }));
  assert.deepEqual([r2.status, r2.actions], [null, []]);
  app.close();
});

test('get_flow: 大きいときは 操作・移る先・移ってくるもの の順に分けて nextCursor を付ける（どのページも目安の 24,000 字に収まる）', async () => {
  const st = flowState();
  st.designs[0].screens[1].parts = Array.from({ length: 300 }, (_, i) => movePart(`lx${i}`, 'link', 32, 64 + i * 32, null, `新規登録の画面へ移るリンクの文字の見本 ${i}`, { to: 'screen', screenId: 's1' }));
  const { app, call } = await boot(st);
  const pages = [];
  let cursor = null;
  do {
    const r = ok(await call('get_flow', { design: 'd1', ...(cursor ? { cursor } : {}) }));
    assert.ok(JSON.stringify(r).length <= 24000, `${JSON.stringify(r).length} 字`);
    pages.push(r);
    cursor = r.nextCursor;
  } while (cursor);
  assert.ok(pages.length >= 2);
  assert.equal(pages.flatMap((p) => p.actions).length, 2);
  assert.equal(pages.flatMap((p) => p.moves).length, 301);
  assert.equal(pages.flatMap((p) => p.incoming).length, 1);
  assert.equal(pages[0].movesTotal, 301);
  app.close();
});

// ── get_view_image ──
test('get_view_image: つながりの図・ステータスの移り方の図・画面の移り方の図を、PNG にする文書で返す。ステータスの項目がなければ断る', async () => {
  const { app, call } = await boot();
  const p = await call('get_view_image', { design: '顧客管理', view: 'process' });
  assert.equal(p.ok, true);
  assert.deepEqual(p.result, { design: { id: 'd1', name: '顧客管理', updatedAt: p.result.design.updatedAt }, view: 'process', boxes: 3, arrows: 2 });
  assert.equal(p.render.kind, 'image');
  assert.match(p.render.html, /^<!DOCTYPE html>/);
  assert.match(p.render.html, /data-view="process"/);
  assert.match(p.render.html, /承認する（上長）/);
  assert.match(p.render.html, /class="xp-legend"/);
  const mark = p.render.html.match(/marker-end="url\(#([^)]+)\)"/)[1];
  assert.ok(p.render.html.includes(`<marker id="${mark}"`), '矢印の印がある');
  assert.ok(p.render.width >= 300 && p.render.height >= 400, `${p.render.width} × ${p.render.height}`);
  const f = await call('get_view_image', { design: 'd1', view: 'screenflow' });
  assert.deepEqual([f.result.view, f.result.boxes, f.result.arrows], ['screenflow', 3, 3]);
  assert.match(f.render.html, /class="mnode ext"/);
  assert.match(f.render.html, /「受注管理」の画面/);
  const m = await call('get_view_image', { design: 'd1', view: 'map' });
  assert.deepEqual([m.result.view, m.result.boxes, m.result.arrows], ['map', 2, 1]);
  assert.match(m.render.html, /受注管理/);
  assert.match(ng(await call('get_view_image', { design: 'd2', view: 'process' }), 'bad_request').message, /ステータスの項目/);
  ng(await call('get_view_image', { design: 'd1', view: 'swimlane' }), 'bad_request');
  app.close();
});

// ── to（移る先）──
test('to: ボタンとリンクの文字の移る先を、この画面設計の画面・ほかの画面設計の画面・URL・null（なし）で書く。「押したとき」の文は書き換えない', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [
    { align: 'right', parts: [
      { type: 'button', label: '登録へ', to: '新規登録' },
      { type: 'button', label: '受注へ', to: { design: '受注管理', screen: '受注の一覧' } },
      { type: 'link', label: '手引き', to: { url: 'https://example.com/guide' } },
    ] },
    [{ type: 'link', label: '受注の一覧へ', props: { to: 'screen', designId: '受注管理', screenId: '受注の一覧' } }],
  ] } }));
  assert.equal(r.warnings, undefined);
  const by = (label) => d('d1').screens[1].parts.find((p) => p.label === label);
  assert.deepEqual(by('登録へ').props, { style: 'primary', action: '', to: 'screen', designId: '', screenId: 's1', url: '' });
  assert.deepEqual(by('受注へ').props, { style: 'primary', action: '', to: 'screen', designId: 'd2', screenId: 's-d2', url: '' });
  assert.deepEqual(by('手引き').props, { to: 'url', designId: '', screenId: '', url: 'https://example.com/guide' });
  assert.deepEqual(by('受注の一覧へ').props, { to: 'screen', designId: 'd2', screenId: 's-d2', url: '' });
  ok(await call('edit_parts', { design: 'd1', screen: '一覧', ops: [
    { op: 'update', part: by('登録へ').id, to: null },
    { op: 'update', part: by('手引き').id, to: { screen: 's1' } },
  ] }));
  assert.equal(by('登録へ').props.to, '');
  assert.deepEqual(by('手引き').props, { to: 'screen', designId: '', screenId: 's1', url: 'https://example.com/guide' });
  const sc = ok(await call('get_screen', { design: 'd1', screen: '一覧' }));
  const toOf = (label) => sc.parts.find((p) => p.label === label).to;
  assert.deepEqual(toOf('受注へ'), { design: '受注管理', designId: 'd2', screen: '受注の一覧', screenId: 's-d2' });
  assert.deepEqual(toOf('手引き'), { screen: '新規登録', screenId: 's1' });
  assert.equal(toOf('登録へ'), null);
  const upd = (part, to) => call('edit_parts', { design: 'd1', screen: '一覧', ops: [{ op: 'update', part, to }] });
  ng(await upd(by('受注へ').id, { screen: '詳細' }), 'not_found');
  ng(await upd(by('受注へ').id, { design: '出張申請', screen: '一覧' }), 'trashed');
  ng(await upd(by('受注へ').id, { screen: '一覧', url: 'https://example.com' }), 'bad_request');
  ng(await call('edit_parts', { design: 'd1', screen: '新規登録', ops: [{ op: 'update', part: 1, to: '一覧' }] }), 'bad_request');
  ng(await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'heading', label: '見出し', to: '新規登録' }]] } }), 'bad_request');
  app.close();
});

// ── 見直し（第 8 段階）で見つけた不具合 ──
test('props の designId・screenId: 片方だけ書いても、もう片方は部品の今の移る先に合わせる（画面は今の画面設計の中で探す・画面設計を変えたら画面は外す）', async () => {
  const st = flowState();
  st.designs[1].screens.push(screen('s-d2b', '受注の入力'));
  const { app, call, d } = await boot(st);
  const l1 = () => d('d1').screens[1].parts.find((p) => p.id === 'l1').props;
  const upd = (props) => call('edit_parts', { design: 'd1', screen: '一覧', ops: [{ op: 'update', part: 'l1', props }] });
  ok(await upd({ screenId: '受注の入力' }));
  assert.deepEqual([l1().designId, l1().screenId], ['d2', 's-d2b']);
  ok(await upd({ designId: '受注管理' })); // 同じ画面設計なら画面はそのまま
  assert.deepEqual([l1().designId, l1().screenId], ['d2', 's-d2b']);
  ok(await upd({ designId: '顧客管理' })); // 画面設計を変えたら、画面は（選んでください）に戻る
  assert.deepEqual([l1().designId, l1().screenId], ['', '']);
  ok(await upd({ screenId: '新規登録' }));
  assert.deepEqual([l1().designId, l1().screenId], ['', 's1']);
  ng(await upd({ screenId: '受注の入力' }), 'not_found');
  app.close();
});

test('edit_items・layout_screen: ステータスの並び（states）の同じ名前・空の名前を断り、なくなったステータスを使う操作を消したら知らせる', async () => {
  const { app, call, d } = await boot();
  ng(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: 'ステータス', props: { states: ['申請', '申請', '承認待ち'] } }] }), 'bad_request');
  ng(await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ item: 'ステータス', props: { states: ['申請', '申請'] } }]] } }), 'bad_request');
  assert.equal(statusOf(d('d1')).props.states.length, 3);
  const r = ok(await call('edit_items', { design: 'd1', ops: [{ op: 'update', item: 'ステータス', props: { states: ['申請', '承認済み'] } }] }));
  assert.deepEqual(statusOf(d('d1')).props.actions, []);
  assert.match(r.warnings[0], /「申請する」・「承認する」/);
  app.close();
});

test('edit_screen の delete: ほかの画面設計の移る先も外れるときは、その画面設計にも「AI が直す前の状態」の行を残し、返事で知らせる', async () => {
  const st = flowState();
  st.designs[2].screens[0].parts.push(movePart('l8', 'link', 32, 64, 1, '申請へ', { to: 'screen', designId: 'd1', screenId: 's1' }));
  const { app, call, d } = await boot(st);
  const r = ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'delete', screen: '新規登録' }] }));
  const linkIn = (design, id) => design.screens.flatMap((s) => s.parts).find((p) => p.id === id);
  ['d2', 'd3'].forEach((id) => {
    const x = d(id);
    assert.equal(linkIn(x, id === 'd2' ? 'l9' : 'l8').props.screenId, '');
    const row = x.revisions.find((rv) => rv.kind === 'ai');
    assert.ok(row, `${x.name} に直す前の行がない`);
    assert.equal(row.note, 'Claude Code が直す前の状態');
    assert.equal(linkIn(row.snapshot, id === 'd2' ? 'l9' : 'l8').props.screenId, 's1');
  });
  assert.ok(r.warnings.some((w) => /「受注管理」1 個・「出張申請」1 個/.test(w)), JSON.stringify(r.warnings));
  app.close();
});
