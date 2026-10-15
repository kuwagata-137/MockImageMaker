'use strict';
// 第 8 段階: データの形の版 3（ステータスに id・操作・移る先の欄・図の位置の入れ物・systems）と、ステータスと操作の操作のテスト。
// 版 2 の見本（test/fixtures/v2-state.json・v2-export-payload.json）は、版 2 のアプリ（コミット ca73fed）で作った
// （版 2 の書き出しの印は、版 2 のアプリでしか作れないため）。画面設計の名前は架空の業務だけを使う。

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

test('版 2 のデータを版 3 に直す: ステータスは id と名前、見本で出すステータスは id、操作・図の位置・移る先の入れ物と systems を足す', async (t) => {
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

test('版 2 で書き出した HTML: こちらで変えていないと分かり、取り込むと「中身が同じ」で取り込まない', async (t) => {
  const { api, d } = await boot(t);
  assert.equal(api.changedSinceExport(d('d-order'), V2_PAYLOAD), false, '版 2 の書き出しの印と比べても、変えていない');
  const html = '<!DOCTYPE html><html><body><script type="application/json" id="mim-embedded">'
    + JSON.stringify(V2_PAYLOAD).replace(/</g, '\\u003c') + '</' + 'script></body></html>';
  assert.equal((await api.importHtmlText(html)).status, 'same');
  api.actions.updateDesignInfo('d-order', { description: 'こちらで直した説明' });
  assert.equal(api.changedSinceExport(d('d-order'), V2_PAYLOAD), true, '変えたら、変えたと分かる');
});

test('新しく作る画面設計・部品: 図の位置の入れ物とボタンの移る先の欄を持ち、ステータスの項目は id 付きで、見本は 2 つ目', async (t) => {
  const { api, d } = await boot(t, null);
  const id = api.actions.createDesign('出張申請', 'kintone');
  assert.deepEqual(plain([d(id).processPos, d(id).flowPos]), [{}, {}]);
  const sid = d(id).screens[0].id;
  const pst = api.actions.addPart(id, sid, 'status', { x: 40, y: 80 });
  const pbt = api.actions.addPart(id, sid, 'button', { x: 40, y: 200 });
  const st = statusOf(d(id));
  assert.deepEqual(names(st.props.states), ['申請', '承認待ち', '承認済み', '完了']);
  st.props.states.forEach((s) => assert.match(s.id, /^t-/));
  assert.deepEqual(plain(st.props.actions), []);
  const parts = partsOf(d(id));
  assert.equal(parts[pst].view.current, st.props.states[1].id);
  assert.deepEqual(plain(parts[pbt].props), { style: 'primary', action: '', to: '', designId: '', screenId: '', url: '' });
});

test('ステータスの並びを名前で書き直す: 同じ名前は id を残し、なくなったステータスを使う操作は消え、見本で出していた部品は「なし」になる（取り込んだ側も）', async (t) => {
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
  assert.equal(parts['p-st1'].view.current, '', '消したステータスを見本で出していた部品は「なし」');
  assert.equal(parts['p-sp1'].view.current, keep[1]);
  assert.deepEqual(plain(statusOf(d('d-exp')).props), plain(st.props), '取り込んだ側にもそろう');
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, keep[2]);
  api.actions.updateItem('d-order', 'i-st', { props: { states: ['受付', '完了'] } });
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, keep[2]);
  api.actions.updateItem('d-order', 'i-st', { props: { states: ['受付'] } });
  assert.equal(partsOf(d('d-exp'))['p-bst'].view.current, '', '取り込んだ側の部品も「なし」になる');
});
