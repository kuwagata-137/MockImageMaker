'use strict';
// 第 8 段階: データの形の版 3（ステータスに id・操作・移る先の欄・図の位置の入れ物・systems）と、ステータスと操作の操作のテスト。
// 版 2 の見本（test/fixtures/v2-state.json・v2-export-payload.json）は、版 2 のアプリ（コミット ca73fed）で作った
// （版 2 の出力の印は、版 2 のアプリでしか作れないため）。画面設計の名前は架空の業務だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const V2 = require('./fixtures/v2-state.json').state;
const V2_PAYLOAD = require('./fixtures/v2-export-payload.json').payload;
const KEY = 'mockimagemaker.v1';
const plain = (v) => JSON.parse(JSON.stringify(v));
const names = (states) => plain(states.map((s) => s.name));
const idOf = (states, name) => states.find((s) => s.name === name).id;
const statusOf = (d) => d.items.find((it) => it.type === 'status');
// 操作を [名前, 前のステータスの名前, 次のステータスの名前, 操作する人, 条件] にする
const actionRows = (item) => plain(item.props.actions.map((a) => [a.name, (item.props.states.find((x) => x.id === a.from) || {}).name || '', (item.props.states.find((x) => x.id === a.to) || {}).name || '', a.role, a.cond]));
const SAMPLE_ROWS = [['申請する', '申請', '承認待ち', '', ''], ['承認する', '承認待ち', '承認済み', '', ''], ['差し戻す', '承認待ち', '申請', '', ''], ['完了にする', '承認済み', '完了', '', '']];
const partsOf = (d) => Object.fromEntries(d.screens.flatMap((s) => s.parts).map((p) => [p.id, p]));

async function boot(t, state = V2) {
  const app = bootApp(state ? { localStorage: { [KEY]: JSON.stringify(state) } } : {});
  t.after(() => app.close());
  const api = await app.api();
  return { app, api, d: (id) => api.store.state.designs.find((x) => x.id === id) };
}
// 版 2 の見本に、操作（版 3 の形。前と次は名前でも書ける）を足したもの
function withActions(actions) {
  const raw = plain(V2);
  raw.designs[0].items.find((it) => it.type === 'status').props.actions = actions;
  return raw;
}

test('版 2 のデータを版 3 に直す: ステータスは id と名前、表示するステータス（サンプル）は id、操作・図の位置・移動先の入れ物と systems を足す', async (t) => {
  const { api } = await boot(t, null);
  const { state, blockReason } = api.migrate(plain(V2));
  assert.equal(blockReason, null);
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(plain(state.systems), []);
  const d = state.designs.find((x) => x.id === 'd-order');
  const st = statusOf(d);
  assert.deepEqual(names(st.props.states), ['受付', '確認待ち', '確認済み', '完了']);
  st.props.states.forEach((s) => assert.match(s.id, /^t-[0-9a-f]{16}$/));
  assert.equal(new Set(st.props.states.map((s) => s.id)).size, 4);
  assert.deepEqual(plain(st.props.actions), []);
  const parts = partsOf(d);
  assert.equal(parts['p-st1'].view.current, idOf(st.props.states, '確認待ち'));
  assert.equal(parts['p-sp1'].view.current, idOf(st.props.states, '確認済み'));
  assert.equal(parts['p-st2'].view.current, '古い名前', '並びにない名前は、消さずにそのまま残す');
  const gone = parts['p-sp2']; // 項目を一覧表から消した後に残った部品は、部品が持っている並びの id を指す
  assert.deepEqual(names(gone.props.states), ['下書き', '提出']);
  assert.equal(gone.view.current, idOf(gone.props.states, '提出'));
  assert.deepEqual(plain([d.processPos, d.flowPos]), [{}, {}]);
  assert.deepEqual(plain(parts['p-b1'].props), { style: 'primary', action: '新規登録の画面を開く', to: '', designId: '', screenId: '', url: '' });
  assert.deepEqual(plain(parts['p-l1'].props), { to: 'screen', designId: '', screenId: 's-detail', url: '' });
});

test('ステータスの id は名前から決まる: 何度直しても同じ・同じ名前の 2 つ目は「-2」・取り込んだ項目（取り込みの取り込みも）は元と同じ id', async (t) => {
  const { api } = await boot(t, null);
  const a = api.migrate(plain(V2)).state;
  assert.deepEqual(plain(api.migrate(plain(V2)).state), plain(a), '別々に直しても同じ');
  assert.deepEqual(plain(api.migrate(plain(a)).state), plain(a), '版 3 をもう一度通しても同じ');
  const ids = (id) => statusOf(a.designs.find((x) => x.id === id)).props.states.map((s) => s.id);
  assert.deepEqual(plain(ids('d-exp')), plain(ids('d-order')));
  assert.deepEqual(plain(ids('d-trip')), plain(ids('d-order')));
  const dup = api.migrate({ schemaVersion: 2, designs: [{ id: 'd1', name: '顧客管理', items: [{ id: 'i1', name: 'ステータス', type: 'status', props: { states: ['受付', '受付', '完了'] } }] }] }).state;
  const ds = dup.designs[0].items[0].props.states;
  assert.equal(ds[1].id, ds[0].id + '-2');
  assert.equal(new Set(ds.map((s) => s.id)).size, 3);
});

test('操作は前と次のステータスを id で持つ（名前で書いた操作も id に直す。並びにないものは空にする）', async (t) => {
  const { api } = await boot(t, null);
  const raw = withActions([{ name: '確かめる', from: '確認待ち', to: '確認済み', role: '上長' }, { id: 'a-x', name: '差し戻す', from: '確認済み', to: 'ない名前', cond: '不備があるとき' }, 'こわれた操作']);
  const d = api.migrate(raw).state.designs[0];
  const st = statusOf(d);
  const id = (n) => idOf(st.props.states, n);
  assert.deepEqual(plain(st.props.actions.map((a) => [a.name, a.from, a.to, a.role, a.cond])), [
    ['確かめる', id('確認待ち'), id('確認済み'), '上長', ''],
    ['差し戻す', id('確認済み'), '', '', '不備があるとき'],
  ]);
  assert.match(st.props.actions[0].id, /^a-[0-9a-f]{16}$/);
  assert.equal(st.props.actions[1].id, 'a-x');
  const again = statusOf(api.migrate(plain(api.migrate(raw).state)).state.designs[0]);
  assert.deepEqual(plain(again.props.actions), plain(st.props.actions), '2 回通しても同じ');
  // 取り込んだ項目にも操作が写る（ユーザーが決めた）
  const exp = statusOf(api.migrate(raw).state.designs.find((x) => x.id === 'd-exp'));
  assert.deepEqual(plain(exp.props.actions), plain(st.props.actions));
});

test('版 2 の改訂履歴の写しと今を比べても、違いは 0 件', async (t) => {
  const { api, d } = await boot(t);
  const cur = d('d-order');
  const r = cur.revisions[0];
  assert.equal(r.schemaVersion, 2);
  const diff = api.designDiff(api.designFromSnapshot(cur, r), cur, api.store.state);
  assert.deepEqual(plain(diff.rows), []);
});

test('版 2 で出力した HTML: こちらで変えていないと分かり、取り込むと「中身が同じ」で取り込まない', async (t) => {
  const { api, d } = await boot(t);
  assert.equal(api.changedSinceExport(d('d-order'), V2_PAYLOAD), false, '版 2 の出力の印と比べても、変えていない');
  const html = '<!DOCTYPE html><html><body><script type="application/json" id="mim-embedded">'
    + JSON.stringify(V2_PAYLOAD).replace(/</g, '\\u003c') + '</' + 'script></body></html>';
  assert.equal((await api.importHtmlText(html)).status, 'same');
  api.actions.updateDesignInfo('d-order', { description: 'こちらで直した説明' });
  assert.equal(api.changedSinceExport(d('d-order'), V2_PAYLOAD), true, '変えたら、変えたと分かる');
});

test('新しく作る画面設計・アイテム: 図の位置の入れ物とボタンの移動先の欄を持ち、ステータスの項目は id 付きで、見本は 2 つ目・見本の操作が 4 つ', async (t) => {
  const { api, d } = await boot(t, null);
  const id = api.actions.createDesign('出張申請', 'kintone');
  assert.deepEqual(plain([d(id).processPos, d(id).flowPos]), [{}, {}]);
  const sid = d(id).screens[0].id;
  const pst = api.actions.addPart(id, sid, 'status', { x: 40, y: 80 });
  const pbt = api.actions.addPart(id, sid, 'button', { x: 40, y: 200 });
  const st = statusOf(d(id));
  assert.deepEqual(names(st.props.states), ['申請', '承認待ち', '承認済み', '完了']);
  st.props.states.forEach((s) => assert.match(s.id, /^t-/));
  assert.deepEqual(actionRows(st), SAMPLE_ROWS, '見本の操作 4 つ（操作できる人と条件は空。ユーザーが決めた q57）');
  const parts = partsOf(d(id));
  assert.equal(parts[pst].view.current, st.props.states[1].id);
  assert.deepEqual(plain(parts[pbt].props), { style: 'primary', action: '', to: '', designId: '', screenId: '', url: '' });
});

test('ステータスの並びを名前で書き直す: 同じ名前は id を残し、なくなったステータスを使う操作は消え、見本で出していたアイテムは「なし」になる（取り込んだ側も）', async (t) => {
  const { api, d } = await boot(t, withActions([{ name: '確かめる', from: '確認待ち', to: '確認済み' }, { name: '終える', from: '確認済み', to: '完了' }]));
  const before = statusOf(d('d-order')).props.states;
  const keep = ['受付', '確認済み', '完了'].map((n) => idOf(before, n));
  api.actions.updateItem('d-order', 'i-st', { props: { states: ['受付', '確認済み', '完了', '差し戻し'] } });
  const st = statusOf(d('d-order'));
  assert.deepEqual(names(st.props.states), ['受付', '確認済み', '完了', '差し戻し']);
  assert.deepEqual(plain(st.props.states.slice(0, 3).map((s) => s.id)), keep);
  assert.ok(!keep.includes(st.props.states[3].id) && st.props.states[3].id.startsWith('t-'));
  assert.deepEqual(plain(st.props.actions.map((a) => a.name)), ['終える'], '消したステータスを使う操作は消える');
  const parts = partsOf(d('d-order'));
  assert.equal(parts['p-st1'].view.current, '', '消したステータスを見本で出していたアイテムは「なし」');
  assert.equal(parts['p-sp1'].view.current, keep[1]);
  assert.deepEqual(plain(statusOf(d('d-exp')).props), plain(st.props), '取り込んだ側にもそろう');
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, keep[2]);
  api.actions.updateItem('d-order', 'i-st', { props: { states: ['受付', '完了'] } });
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, keep[2]);
  api.actions.updateItem('d-order', 'i-st', { props: { states: ['受付'] } });
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, '', '取り込んだ側のアイテムも「なし」になる');
});

test('見本の操作: ひな形「進捗」で作ったステータスの項目にも入る。版 2 から直した項目と、AI が作った項目には入れない', async (t) => {
  const { api, d } = await boot(t, null);
  const id = api.actions.createDesign('出張申請', 'kintone');
  api.actions.addScreen(id, 'steps', d(id).screens[0].id);
  assert.deepEqual(actionRows(statusOf(d(id))), SAMPLE_ROWS);
  const v2 = api.migrate(plain(V2)).state.designs.find((x) => x.id === 'd-order');
  assert.deepEqual(plain(statusOf(v2).props.actions), []);
  const id2 = api.actions.createDesign('経費精算', 'kintone');
  const r = plain(await api.aiDispatch('edit_items', { design: '経費精算', ops: [{ op: 'add', type: 'status', name: 'ステータス' }] }, { session: 's-1', client: 'claude-code' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(plain(statusOf(d(id2)).props.actions), [], 'AI が作った項目は、渡した操作だけ（Claude の案）');
});

test('ステータスを足す・名前を変える・並べ替える・消す（消すと、そのステータスを使う操作と、見本で出していたアイテムの「なし」も、取り込んだ側までそろう）', async (t) => {
  const { api, d } = await boot(t, withActions([{ id: 'a-1', name: '確かめる', from: '確認待ち', to: '確認済み' }, { id: 'a-2', name: '終える', from: '確認済み', to: '完了' }]));
  const st = () => statusOf(d('d-order'));
  const id = (n) => idOf(st().props.states, n);
  const nid = api.actions.addState('d-order', 'i-st', '差し戻し');
  assert.match(nid, /^t-/);
  assert.deepEqual(names(st().props.states), ['受付', '確認待ち', '確認済み', '完了', '差し戻し']);
  assert.equal(api.actions.addState('d-order', 'i-st', '受付'), null, '同じ名前は足さない');
  assert.equal(api.actions.addState('d-order', 'i-st', '  '), null);
  const keep = id('確認済み');
  assert.equal(api.actions.renameState('d-order', 'i-st', keep, '確認した'), true);
  assert.equal(id('確認した'), keep, '名前を変えても id は同じ');
  assert.equal(partsOf(d('d-order'))['p-sp1'].view.current, keep, '見本で出していたアイテムはそのまま');
  assert.equal(api.actions.renameState('d-order', 'i-st', keep, '受付'), false, 'ほかのステータスと同じ名前にはしない');
  assert.equal(api.actions.moveState('d-order', 'i-st', nid, 1), true);
  assert.deepEqual(names(st().props.states), ['受付', '差し戻し', '確認待ち', '確認した', '完了']);
  assert.equal(api.actions.moveState('d-order', 'i-st', nid, 1), false, '動かないときは false');
  assert.deepEqual(names(statusOf(d('d-exp')).props.states), names(st().props.states), '取り込んだ側にもそろう');
  // 消す
  assert.equal(api.actions.deleteState('d-order', 'i-st', keep), true);
  assert.deepEqual(names(st().props.states), ['受付', '差し戻し', '確認待ち', '完了']);
  assert.deepEqual(plain(st().props.actions.map((a) => a.name)), [], 'そのステータスを使う操作は消える');
  assert.equal(partsOf(d('d-order'))['p-sp1'].view.current, '');
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, idOf(st().props.states, '完了'));
  api.store.undo();
  assert.equal(partsOf(d('d-order'))['p-sp1'].view.current, keep, '元に戻すで戻る');
  assert.equal(st().props.actions.length, 2);
  // 最後の 1 つは消せない
  ['受付', '差し戻し', '確認待ち', '確認した'].forEach((n) => api.actions.deleteState('d-order', 'i-st', id(n)));
  assert.deepEqual(names(st().props.states), ['完了']);
  assert.equal(api.actions.deleteState('d-order', 'i-st', id('完了')), false);
});

test('操作を足す・直す・並べ替える・消す。前と次が同じ操作と、並びにないステータスは断る', async (t) => {
  const { api, d } = await boot(t);
  const st = () => statusOf(d('d-order'));
  const id = (n) => idOf(st().props.states, n);
  const a1 = api.actions.addProcessAction('d-order', 'i-st', {});
  assert.deepEqual(actionRows(st()), [['新しい操作', '受付', '確認待ち', '', '']], '何も書かなければ、1 つ目 → 2 つ目');
  const a2 = api.actions.addProcessAction('d-order', 'i-st', { name: '差し戻す', from: id('確認待ち'), to: id('受付'), role: ' 上長 ', cond: '書き直してほしいとき' });
  assert.match(a2, /^a-/);
  assert.equal(api.actions.addProcessAction('d-order', 'i-st', { from: id('受付'), to: id('受付') }), null, '前と次が同じ操作は作らない');
  assert.equal(api.actions.addProcessAction('d-order', 'i-st', { from: 't-nai' }), null);
  assert.equal(api.actions.updateProcessAction('d-order', 'i-st', a1, { name: '受け付ける', to: id('確認済み'), role: '担当者' }), true);
  assert.equal(api.actions.updateProcessAction('d-order', 'i-st', a1, { to: id('受付') }), false, '前と次を同じにはしない');
  assert.equal(api.actions.updateProcessAction('d-order', 'i-st', a1, { name: '' }), true);
  assert.deepEqual(actionRows(st()), [['受け付ける', '受付', '確認済み', '担当者', ''], ['差し戻す', '確認待ち', '受付', '上長', '書き直してほしいとき']], '名前を空にしたときは、今の名前のまま');
  assert.equal(api.actions.moveProcessAction('d-order', 'i-st', a2, 0), true);
  assert.deepEqual(plain(st().props.actions.map((a) => a.id)), [a2, a1]);
  assert.equal(api.actions.deleteProcessAction('d-order', 'i-st', a2), true);
  assert.deepEqual(plain(st().props.actions.map((a) => a.id)), [a1]);
  assert.deepEqual(plain(statusOf(d('d-exp')).props.actions), plain(st().props.actions), '取り込んだ側にも操作が写る');
});

test('取り込んだステータスの項目は、ステータスも操作も直せない', async (t) => {
  const { api, d } = await boot(t, withActions([{ id: 'a-1', name: '確かめる', from: '確認待ち', to: '確認済み' }]));
  const st = statusOf(d('d-exp'));
  const sid = st.props.states[0].id;
  const iid = st.id;
  assert.equal(api.actions.addState('d-exp', iid, '差し戻し'), null);
  assert.equal(api.actions.renameState('d-exp', iid, sid, 'x'), false);
  assert.equal(api.actions.moveState('d-exp', iid, sid, 2), false);
  assert.equal(api.actions.deleteState('d-exp', iid, sid), false);
  assert.equal(api.actions.addProcessAction('d-exp', iid, {}), null);
  assert.equal(api.actions.updateProcessAction('d-exp', iid, 'a-1', { name: 'x' }), false);
  assert.equal(api.actions.moveProcessAction('d-exp', iid, 'a-1', 0), false);
  assert.equal(api.actions.deleteProcessAction('d-exp', iid, 'a-1'), false);
});

test('設定の文と違いの文: 操作は「操作「確かめる」＝確認待ちから確認済みへ（上長）」。変えると改訂履歴の違いに前と後が出る', async (t) => {
  const { api, d } = await boot(t, withActions([{ id: 'a-1', name: '確かめる', from: '確認待ち', to: '確認済み', role: '上長' }, { id: 'a-2', name: '戻す', from: '確認済み', to: '確認待ち', cond: '不備があるとき' }]));
  const text = api.describeItem(statusOf(d('d-order')), { design: d('d-order'), state: api.store.state });
  assert.equal(text, 'ステータス＝受付／確認待ち／確認済み／完了\n操作「確かめる」＝確認待ちから確認済みへ（上長）\n操作「戻す」＝確認済みから確認待ちへ・不備があるとき');
  const rev = api.actions.addRevision('d-order', { note: '第 1 版' });
  assert.ok(rev);
  api.actions.updateProcessAction('d-order', 'i-st', 'a-1', { to: idOf(statusOf(d('d-order')).props.states, '完了') });
  const cur = d('d-order');
  const r = cur.revisions.find((x) => x.id === rev);
  const diff = api.designDiff(api.designFromSnapshot(cur, r), cur, api.store.state);
  const texts = diff.rows.map((x) => x.text).join('\n');
  assert.match(texts, /操作「確かめる」：確認待ちから確認済みへ（上長） → 確認待ちから完了へ（上長）/);
});

// ── ステータスの移り方の図（T5。画像 q54 の案B: 上から下へ）──
test('ステータスの流れの図: 箱はステータスの並びの順に上から下へ、矢印は操作（戻る操作は back）。前か次のない操作は描かない', async (t) => {
  const { api, d } = await boot(t, withActions([
    { id: 'a-1', name: '確かめる', from: '確認待ち', to: '確認済み', role: '上長' },
    { id: 'a-2', name: '戻す', from: '確認済み', to: '受付', cond: '不備があるとき' },
    { id: 'a-3', name: '途中', from: '受付', to: '' },
    { id: 'a-4', name: '一気に終える', from: '受付', to: '完了' },
  ]));
  const m = api.processModel(d('d-order'));
  const st = statusOf(d('d-order')).props.states;
  assert.deepEqual(plain(m.nodes.map((n) => [n.name, n.outs])), [['受付', 1], ['確認待ち', 1], ['確認済み', 1], ['完了', 0]]);
  assert.deepEqual(plain(m.edges.map((e) => [e.from, e.to, e.kind, e.labels])), [
    ['t:' + st[1].id, 't:' + st[2].id, 'next', ['確かめる（上長）']],
    ['t:' + st[2].id, 't:' + st[0].id, 'back', ['戻す', '不備があるとき']],
    ['t:' + st[0].id, 't:' + st[3].id, 'next', ['一気に終える']],
  ]);
  const pos = api.processLayout(m);
  assert.deepEqual(plain(st.map((s) => pos['t:' + s.id])), [{ x: 240, y: 40 }, { x: 240, y: 190 }, { x: 240, y: 340 }, { x: 240, y: 490 }]);
  assert.deepEqual(plain(api.processModel({ items: [] })), { nodes: [], edges: [], item: null }, 'ステータスの項目がなければ空');
});

test('ステータスの流れの図の HTML: 箱と矢印。間の箱をまたぐ矢印は、箱の右を回る。矢印の印の id は proc（出力では頭を変えられる）', async (t) => {
  const { api, d, app } = await boot(t, withActions([
    { id: 'a-1', name: '確かめる', from: '確認待ち', to: '確認済み' },
    { id: 'a-4', name: '一気に終える', from: '受付', to: '完了' },
  ]));
  const html = api.viewHtml('process', api.store.state, d('d-order'));
  const box = app.document.createElement('div');
  box.innerHTML = html;
  assert.deepEqual(plain([...box.querySelectorAll('.mnode')].map((n) => n.querySelector('b').textContent)), ['1　受付', '2　確認待ち', '3　確認済み', '4　完了']);
  assert.equal(box.querySelector('.map-inner').dataset.view, 'process');
  const paths = [...box.querySelectorAll('svg path[marker-end]')];
  assert.equal(paths.length, 2);
  assert.match(paths[0].getAttribute('marker-end'), /^url\(#proc-arrow-/);
  const xs = (p) => (p.getAttribute('d').match(/-?[\d.]+/g) || []).map(Number).filter((_, i) => i % 2 === 0);
  assert.ok(Math.max(...xs(paths[1])) >= 240 + 200 + 28, '受付 → 完了 は、間の箱の右を回る');
  assert.ok(Math.max(...xs(paths[0])) < 240 + 200, '隣のステータスへの矢印は、まっすぐ下へ');
  const xp = api.viewHtml('process', api.store.state, d('d-order'), {}, { idPrefix: 'xp-proc', bare: true });
  assert.ok(!/id="map-inner"|[#"]proc-arrow-/.test(xp) && /url\(#xp-proc-arrow-/.test(xp), '出力では id="map-inner" を付けず、印の id の頭を変える');
  assert.match(api.viewHtml('process', api.store.state, { items: [] }), /ステータスの項目がまだありません/);
});

test('図の箱の位置を覚える: processPos・flowPos に覚え、更新日時は変えない。自動で並べ直すで消す', async (t) => {
  const { api, d } = await boot(t);
  const before = d('d-order').updatedAt;
  assert.equal(api.actions.setViewPos('d-order', 'process', 't:x', { x: 43, y: 81 }), true);
  assert.equal(api.actions.setViewPos('d-order', 'flow', 's:y', { x: -5, y: 10 }), true);
  assert.deepEqual(plain([d('d-order').processPos, d('d-order').flowPos]), [{ 't:x': { x: 40, y: 80 } }, { 's:y': { x: 0, y: 8 } }]);
  assert.equal(d('d-order').updatedAt, before);
  assert.equal(api.actions.setViewPos('d-order', 'nai', 'k', { x: 0, y: 0 }), false);
  assert.equal(api.actions.resetViewPos('d-order', 'process'), true);
  assert.deepEqual(plain(d('d-order').processPos), {});
  assert.equal(api.actions.resetViewPos('d-order', 'process'), false, '覚えた位置がなければ false');
  assert.deepEqual(plain(d('d-order').flowPos), { 's:y': { x: 0, y: 8 } });
});

// ── 見直し（第 8 段階）で見つけた不具合 ──
test('違いの文: 同じ名前の操作が 2 つあっても、どちらの変更も改訂履歴の違いに出る', async (t) => {
  const { api, d } = await boot(t, withActions([{ id: 'a-1', name: '新しい操作', from: '受付', to: '確認待ち' }, { id: 'a-2', name: '新しい操作', from: '確認待ち', to: '確認済み' }]));
  const rev = api.actions.addRevision('d-order', { note: '第 1 版' });
  api.actions.updateProcessAction('d-order', 'i-st', 'a-1', { role: '課長' });
  api.actions.addProcessAction('d-order', 'i-st', { name: '新しい操作', from: idOf(statusOf(d('d-order')).props.states, '確認済み'), to: idOf(statusOf(d('d-order')).props.states, '完了') });
  const cur = d('d-order');
  const diff = api.designDiff(api.designFromSnapshot(cur, cur.revisions.find((x) => x.id === rev)), cur, api.store.state);
  const texts = diff.rows.map((x) => x.text).join('\n');
  assert.match(texts, /操作「新しい操作」：受付から確認待ちへ → 受付から確認待ちへ（課長）/);
  assert.match(texts, /操作「新しい操作」：なし → 確認済みから完了へ/);
});

test('貼り付け: ほかの画面設計へ貼ったステータス表示の見本は、コピーした元のステータスの名前で当て直す（同じ id でも、名前が変わっていれば名前の方）', async (t) => {
  const { api, d } = await boot(t);
  const exp = () => statusOf(d('d-exp'));
  api.actions.unlinkItem('d-exp', exp().id); // 受注管理から取り込んだ項目なので、つながりを切って直せるようにする
  const waiting = idOf(exp().props.states, '確認待ち');
  assert.equal(waiting, idOf(statusOf(d('d-order')).props.states, '確認待ち'), '版 2 から直した同じ名前のステータスは、画面設計をまたいで同じ id');
  assert.ok(api.actions.renameState('d-exp', exp().id, waiting, '審査中'));
  const fresh = api.actions.addState('d-exp', exp().id, '確認待ち');
  api.openDesign('d-order');
  api.openScreen('s-list');
  api.selectPart('p-st1');
  api.runCommand('copyPart');
  api.openDesign('d-exp');
  api.openScreen('s-b1');
  api.runCommand('pastePart');
  const pasted = d('d-exp').screens[0].parts.at(-1);
  assert.equal(pasted.type, 'status');
  assert.equal(pasted.view.current, fresh);
});
