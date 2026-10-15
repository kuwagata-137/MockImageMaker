'use strict';
// 第 8 段階: ボタンとリンクの文字の移る先（ほかの画面設計の画面も指せる）と、画面の移り方のテスト。
// 画面設計の名前は架空の業務（出張申請・経費精算）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

// 出張申請（一覧・詳細）と経費精算（精算の入力・一覧）の 2 つの画面設計を作って起動する
async function bootTwo(t, opts = {}) {
  const app = bootApp(opts);
  const api = await app.api();
  t.after(() => app.close());
  const A = api.actions.createDesign('出張申請', 'kintone');
  const B = api.actions.createDesign('経費精算', 'kintone');
  const d = (id) => api.store.state.designs.find((x) => x.id === id);
  const rename = (id, name) => api.actions.updateScreen(id, d(id).screens[0].id, { name });
  rename(A, '一覧');
  rename(B, '精算の入力');
  const a1 = d(A).screens[0].id;
  const a2 = api.actions.addScreen(A, 'blank', a1);
  api.actions.updateScreen(A, a2, { name: '詳細' });
  const b1 = d(B).screens[0].id;
  const b2 = api.actions.addScreen(B, 'blank', b1);
  api.actions.updateScreen(B, b2, { name: '一覧' });
  let y = 80;
  // 移る先を持つ部品（ボタンかリンクの文字）を置く
  const put = (did, sid, type, props, label) => {
    const id = api.actions.addPart(did, sid, type, { x: 40, y: (y += 48) });
    api.actions.updatePart(did, sid, id, { ...(label ? { label } : {}), props });
    return id;
  };
  const part = (did, pid) => d(did).screens.flatMap((s) => s.parts).find((p) => p.id === pid);
  const setting = (did, pid) => {
    const sc = d(did).screens.find((s) => s.parts.some((p) => p.id === pid));
    return api.tableRows(sc, d(did), api.store.state).find((r) => r.id === pid).setting;
  };
  return { app, api, A, B, a1, a2, b1, b2, d, put, part, setting };
}

test('ボタンもリンクの文字も移る先を持ち、ほかの画面設計の画面も指せる。設定の文は「移る先＝経費精算 ／ 精算の入力の画面」', async (t) => {
  const { api, A, B, a1, a2, b1, put, setting } = await bootTwo(t);
  const own = put(A, a2, 'button', { to: 'screen', screenId: a1 }, '一覧へ');
  const other = put(A, a2, 'button', { to: 'screen', designId: B, screenId: b1, action: '精算を始める' }, '精算する');
  const self = put(A, a2, 'link', { to: 'screen', designId: A, screenId: a1 });
  const url = put(A, a2, 'link', { to: 'url', url: 'https://example.com/' });
  const gone = put(A, a2, 'button', { to: 'screen', designId: B, screenId: 's-nai' });
  const none = put(A, a2, 'button', { to: 'screen' });
  assert.equal(setting(A, own), '移る先＝一覧の画面');
  assert.equal(setting(A, other), '移る先＝経費精算 ／ 精算の入力の画面\n押したとき＝精算を始める');
  assert.equal(setting(A, self), '移る先＝一覧の画面', '自分の画面設計を名指ししても、この画面設計の画面');
  assert.equal(setting(A, url), '移る先＝https://example.com/');
  assert.equal(setting(A, gone), '移る先＝（ない画面）');
  assert.equal(setting(A, none), '', '画面を選んでいないときは書かない');
  // 移る先の画面設計の名前・画面の名前を変えると、文も変わる
  api.actions.updateDesignInfo(B, { name: '経費の精算' });
  assert.equal(setting(A, other), '移る先＝経費の精算 ／ 精算の入力の画面\n押したとき＝精算を始める');
});

test('画面の複製: 自分を指す移る先は新しい画面へ、ほかの画面とほかの画面設計の画面を指す移る先はそのまま（ボタンも）', async (t) => {
  const { api, A, B, a1, a2, b1, d, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', screenId: a2 });
  put(A, a2, 'button', { to: 'screen', screenId: a1 });
  put(A, a2, 'link', { to: 'screen', designId: B, screenId: b1 });
  const cid = api.actions.duplicateScreen(A, a2);
  const c = d(A).screens.find((s) => s.id === cid);
  assert.deepEqual(plain(c.parts.map((p) => [p.type, p.props.designId, p.props.screenId])), [
    ['button', '', c.id], ['button', '', a1], ['link', B, b1],
  ]);
});

test('画面設計の複製: この画面設計の画面を指す移る先は複製の画面へ付け直し、ほかの画面設計の画面はそのまま。画面の移り方の図の位置の鍵も付け直す', async (t) => {
  const { api, A, B, a1, a2, b1, d, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', screenId: a1 });
  put(A, a2, 'button', { to: 'screen', designId: B, screenId: b1 });
  api.store.commit((s) => { s.designs.find((x) => x.id === A).flowPos = { ['s:' + a1]: { x: 40, y: 40 }, ['x:' + B + '/' + b1]: { x: 440, y: 40 } }; });
  const copy = d(api.actions.duplicateDesign(A));
  const [c1, c2] = copy.screens;
  assert.deepEqual(plain(c2.parts.map((p) => [p.props.designId, p.props.screenId])), [['', c1.id], [B, b1]]);
  assert.deepEqual(plain(copy.flowPos), { ['s:' + c1.id]: { x: 40, y: 40 }, ['x:' + B + '/' + b1]: { x: 440, y: 40 } });
});

test('画面を消す: ほかの画面設計のボタンとリンクの文字の移る先も外れ、確かめの窓に画面設計ごとの数を書く。元に戻す 1 回で全部戻る', async (t) => {
  const { app, api, A, B, a1, a2, b1, b2, d, put, part } = await bootTwo(t);
  const p1 = put(A, a2, 'button', { to: 'screen', screenId: a1 });
  const p2 = put(A, a2, 'link', { to: 'screen', designId: A, screenId: a1 });
  const p3 = put(B, b1, 'link', { to: 'screen', designId: B, screenId: b2 }); // 経費精算の中の移る先（外れない）
  const p4 = put(B, b2, 'button', { to: 'screen', designId: A, screenId: a1 });
  const p5 = put(B, b2, 'button', { to: 'url', designId: A, screenId: a1, url: 'https://example.com/' }); // URL の移る先は数えない
  api.actions.trashDesign(B); // ごみ箱の画面設計の移る先も外す
  const bUpdated = d(B).updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  api.openDesign(A);
  click($(app, `.sl-item[data-id="${a1}"]`));
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  assert.match($(app, '.modal').textContent, /ボタンとリンクの文字 3 個が、この画面を移る先にしています（この画面設計から 2 個・「経費精算」から 1 個）。移る先は外れます。/);
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.deepEqual(plain([p1, p2, p4].map((id) => part(id === p4 ? B : A, id).props.screenId)), ['', '', '']);
  assert.equal(part(B, p3).props.screenId, b2);
  assert.equal(part(B, p5).props.screenId, a1);
  assert.notEqual(d(B).updatedAt, bUpdated, '移る先が外れた画面設計は、更新日時も変わる');
  api.store.undo();
  assert.deepEqual(plain([p1, p2, p4].map((id) => part(id === p4 ? B : A, id).props.screenId)), [a1, a1, a1]);
  assert.equal(d(B).updatedAt, bUpdated);
});

test('画面を消す確かめの窓: この画面設計からだけなら、画面設計ごとの数は書かない', async (t) => {
  const { app, api, A, a1, a2, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', screenId: a1 });
  api.openDesign(A);
  click($(app, `.sl-item[data-id="${a1}"]`));
  api.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  const text = $(app, '.modal').textContent;
  assert.match(text, /ボタンとリンクの文字 1 個が、この画面を移る先にしています。移る先は外れます。/);
});

test('完全に削除: その画面設計の画面を指していた移る先は、画面設計も画面も外れる（更新日時は変えない）。ごみ箱にある間は外さない', async (t) => {
  const { api, A, B, b1, d, put, part } = await bootTwo(t);
  const p = put(A, d(A).screens[0].id, 'button', { to: 'screen', designId: B, screenId: b1 });
  api.actions.trashDesign(B);
  assert.deepEqual(plain([part(A, p).props.designId, part(A, p).props.screenId]), [B, b1], 'ごみ箱にある間は外さない');
  const updated = d(A).updatedAt;
  api.actions.deleteDesignForever(B);
  assert.deepEqual(plain([part(A, p).props.to, part(A, p).props.designId, part(A, p).props.screenId]), ['screen', '', '']);
  assert.equal(d(A).updatedAt, updated);
});

test('貼り付け: ほかの画面設計へ貼ると、元の画面設計の画面を指す移る先は元の画面設計を名指しし、貼る先の画面設計を名指ししていたものは「この画面設計」になる', async (t) => {
  const { app, api, A, B, a1, a2, b1, b2, d, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', screenId: a1 });
  put(A, a2, 'link', { to: 'screen', designId: B, screenId: b2 });
  api.openDesign(A);
  click($(app, `.sl-item[data-id="${a2}"]`));
  api.runCommand('selectAll');
  api.runCommand('copyPart');
  api.openDesign(B);
  click($(app, `.sl-item[data-id="${b1}"]`));
  api.runCommand('pastePart');
  assert.deepEqual(plain(d(B).screens[0].parts.map((p) => [p.type, p.props.designId, p.props.screenId])), [['button', A, a1], ['link', '', b2]]);
  // 同じ画面設計の中で貼るときは、そのまま
  api.openDesign(A);
  click($(app, `.sl-item[data-id="${a1}"]`));
  api.runCommand('pastePart');
  assert.deepEqual(plain(d(A).screens[0].parts.map((p) => [p.type, p.props.designId, p.props.screenId])), [['button', '', a1], ['link', B, b2]]);
});

test('書き出す HTML: 移る先のほかの画面設計と、入ってくる移る先の名前を screenPeers に入れ、単体で開いても設定の文に名前が出る', async (t) => {
  const { api, A, B, a1, a2, b1, b2, put } = await bootTwo(t);
  const out = put(A, a2, 'button', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  put(B, b2, 'link', { to: 'screen', designId: A, screenId: a1 }, '出張申請の一覧へ戻る');
  const payload = api.embedPayload(api.store.state.designs.find((x) => x.id === A), api.store.state);
  assert.deepEqual(plain(payload.screenPeers), [{
    id: B, name: '経費精算',
    screens: [{ id: b1, name: '精算の入力' }, { id: b2, name: '一覧' }],
    refs: [{ from: b2, to: a1, type: 'link', label: '出張申請の一覧へ戻る' }],
  }]);
  assert.deepEqual(plain(payload.peers), [], 'つながりの図の箱は増やさない');
  const html = api.buildStandaloneHtml(api.store.state.designs.find((x) => x.id === A), api.store.state);
  const app2 = bootApp({ html, url: 'https://localhost/vendor/a.html' });
  t.after(() => app2.close());
  const api2 = await app2.api();
  const d2 = api2.currentDesign();
  const sc = d2.screens.find((s) => s.id === a2);
  assert.equal(api2.tableRows(sc, d2, api2.store.state).find((r) => r.id === out).setting, '移る先＝経費精算 ／ 精算の入力の画面');
  assert.deepEqual(plain(api2.standaloneInfo().screenPeers), plain(payload.screenPeers));
});

// ── 画面の移り方の図（T5。画像 q55 の案A・q58）──
test('画面の移り方の図: 箱はこの画面設計の画面と、行き先・来る元のほかの画面設計の画面。同じ 2 つの画面の間の同じ種類の矢印は 1 本にまとめる', async (t) => {
  const { api, A, B, a1, a2, b1, b2, d, put } = await bootTwo(t);
  const C = api.actions.createDesign('顧客管理', 'kintone');
  const c1 = d(C).screens[0].id;
  put(A, a1, 'button', { to: 'screen', screenId: a2 }, '詳細を見る');
  put(A, a2, 'button', { to: 'screen', screenId: a1 }, '承認する');
  put(A, a2, 'button', { to: 'screen', screenId: a1 }, '差し戻す');
  put(A, a2, 'button', { to: 'screen', screenId: a2 }, '自分へ'); // 自分の画面への矢印は描かない
  put(A, a2, 'link', { to: 'screen', designId: B, screenId: b1 }, '経費精算を入力する');
  put(B, b2, 'link', { to: 'screen', designId: A, screenId: a1 }, '出張申請の一覧へ戻る');
  put(C, c1, 'button', { to: 'screen', designId: A, screenId: a2 }, '出張を見る');
  put(A, a1, 'button', { to: 'screen', screenId: 's-nai' }, 'ない画面へ');
  api.actions.trashDesign(C); // ごみ箱の画面設計からの矢印は描かない
  const m = api.flowModel(api.store.state, d(A));
  assert.deepEqual(plain(m.nodes.map((n) => [n.key, n.name, n.ext || ''])), [
    ['s:' + a1, '一覧', ''], ['s:' + a2, '詳細', ''],
    ['x:' + B + '/' + b1, '精算の入力', '経費精算'], ['x:' + B + '/' + b2, '一覧', '経費精算'],
  ]);
  assert.deepEqual(plain(m.edges.map((e) => [e.from, e.to, e.kind, e.labels])), [
    ['s:' + a1, 's:' + a2, 'button', ['詳細を見る']],
    ['s:' + a2, 's:' + a1, 'button', ['承認する', '差し戻す']],
    ['s:' + a2, 'x:' + B + '/' + b1, 'link', ['経費精算を入力する']],
    ['x:' + B + '/' + b2, 's:' + a1, 'link', ['出張申請の一覧へ戻る']],
  ]);
  // 並べ方: 移る先の順に左から右（行きと帰りの輪は、画面の並びで前へ進む矢印で列を決める）
  const pos = api.mapLayout(m);
  assert.ok(pos['s:' + a1].x < pos['s:' + a2].x && pos['s:' + a2].x < pos['x:' + B + '/' + b1].x);
});

test('画面の移り方の図: つながりのない画面は、画面の並びの順に並べる', async (t) => {
  const { api, A, a2, d } = await bootTwo(t);
  const a3 = api.actions.addScreen(A, 'blank', a2);
  api.actions.updateScreen(A, a3, { name: 'あ' });
  const m = api.flowModel(api.store.state, d(A));
  const pos = api.mapLayout(m);
  const keys = Object.keys(pos).sort((p, q) => pos[p].x - pos[q].x);
  assert.deepEqual(plain(keys), plain(d(A).screens.map((s) => 's:' + s.id)), '名前の順ではなく、画面の並びの順');
});

test('画面の移り方の図の HTML: ほかの画面設計の画面は灰色の点線の箱（ext）で「「経費精算」の画面」。矢印の印の id は flow', async (t) => {
  const { app, api, A, B, a2, b1, d, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  const box = app.document.createElement('div');
  box.innerHTML = api.viewHtml('flow', api.store.state, d(A));
  const ext = box.querySelector('.mnode.ext');
  assert.equal(ext.dataset.node, 'x:' + B + '/' + b1);
  assert.match(ext.textContent, /精算の入力「経費精算」の画面/);
  assert.match(box.querySelector('.mnode:not(.ext)').textContent, /一覧パソコン部品 0 個/);
  assert.match(box.querySelector('svg path[marker-end]').getAttribute('marker-end'), /^url\(#flow-arrow-/);
  assert.equal(box.querySelector('.map-inner').dataset.view, 'flow');
});

test('画面の移り方の図: 単体で開いた HTML では、ほかの画面設計の画面を screenPeers から描く（行き先も来る元も）', async (t) => {
  const { api, A, B, a1, a2, b1, b2, put } = await bootTwo(t);
  put(A, a2, 'button', { to: 'screen', designId: B, screenId: b1 }, '精算する');
  put(B, b2, 'link', { to: 'screen', designId: A, screenId: a1 }, '戻る');
  const html = api.buildStandaloneHtml(api.store.state.designs.find((x) => x.id === A), api.store.state);
  const app2 = bootApp({ html, url: 'https://localhost/vendor/a.html' });
  t.after(() => app2.close());
  const api2 = await app2.api();
  const m = api2.flowModel(api2.store.state, api2.currentDesign());
  assert.deepEqual(plain(m.edges.map((e) => [e.from, e.to, e.labels])), [
    ['s:' + a2, 'x:' + B + '/' + b1, ['精算する']],
    ['x:' + B + '/' + b2, 's:' + a1, ['戻る']],
  ]);
});
