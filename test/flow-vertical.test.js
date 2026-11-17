'use strict';
// v1.05 段階 B: 画面遷移図の向き（画像 q185 の案C 向き選択）。画面設計ごとに［↔ 横向き］［↕ 縦向き］で選び、縦向きのときだけ flowVertical: true を持つ。
// 画面設計の名前は架空の業務（申込受付）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
function mouseAt(app, target, type, x, y) {
  target.dispatchEvent(new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}
const wpsOf = (p) => p.dataset.wps.split(' ').map((s) => s.split(',').map(Number));

// 申込受付: 申込一覧 → 申込登録 → 内容確認 → 完了（一本道）と、内容確認 → 申込登録（修正する）。開いた状態で起動する
async function boot(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const A = api.actions.createDesign('申込受付', 'kintone');
  const d = () => api.store.state.designs.find((x) => x.id === A);
  const names = ['申込一覧', '申込登録', '内容確認', '完了'];
  const ids = [d().screens[0].id];
  api.actions.updateScreen(A, ids[0], { name: names[0] });
  names.slice(1).forEach((name) => {
    const id = api.actions.addScreen(A, 'blank', ids[ids.length - 1]);
    api.actions.updateScreen(A, id, { name });
    ids.push(id);
  });
  const btn = (from, to, label) => {
    const p = api.actions.addPart(A, ids[from], 'button', { x: 40, y: 120 + from * 10 });
    api.actions.updatePart(A, ids[from], p, { label, props: { to: 'screen', screenId: ids[to] } });
  };
  btn(0, 1, '申込を登録する');
  btn(1, 2, '確認へ進む');
  btn(2, 3, '申し込む');
  btn(2, 1, '修正する');
  api.openDesign(A);
  api.runCommand('openFlow');
  const node = (i) => $(app, `#design-map .mnode[data-node="s:${ids[i]}"]`);
  const box = (i) => ({ x: parseFloat(node(i).style.left), y: parseFloat(node(i).style.top), w: parseFloat(node(i).style.width), h: parseFloat(node(i).style.height) });
  return { app, api, A, d, ids, node, box };
}

test('画面遷移図の上の行に［↔ 横向き］［↕ 縦向き］を置き、今ある画面設計と新しい画面設計は横向きで始まる', async (t) => {
  const { app, d, box } = await boot(t);
  assert.deepEqual($$(app, '.map-head .mz-group button').map((b) => b.textContent), ['↔ 横向き', '↕ 縦向き']);
  assert.ok($(app, '[data-action="flow-horizontal"]').classList.contains('on'));
  assert.equal('flowVertical' in d(), false, '横向きのときは項目を置かない');
  assert.ok(box(1).x > box(0).x, '横向きは、つながりの順に左から右へ');
});

test('［↕ 縦向き］を押すと、段を上から下へ並べ、下の段へは下の辺から上の辺へ線を引く。動かした位置は使わず、元に戻すで戻せる', async (t) => {
  const { app, api, A, d, ids, node, box } = await boot(t);
  api.actions.setViewPos(A, 'flow', 's:' + ids[3], { x: 800, y: 40 });
  const before = d().updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  click($(app, '[data-action="flow-vertical"]'));
  assert.equal(d().flowVertical, true);
  assert.deepEqual(plain(d().flowPos), {}, '動かした位置は使わない');
  assert.notEqual(d().updatedAt, before, 'PDF の図が変わるので、更新日時を変える');
  assert.ok($(app, '[data-action="flow-vertical"]').classList.contains('on'));
  // 段: 申込一覧・申込登録・内容確認・完了の順に上から下へ。どれも左に寄せる
  const b = [0, 1, 2, 3].map(box);
  b.slice(1).forEach((q, i) => assert.ok(q.y >= b[i].y + b[i].h + 100, `段 ${i + 2} は上の段の下（段の間は 100 以上）`));
  b.forEach((q) => assert.equal(q.x, 40));
  // 申込一覧 → 申込登録 の線は、申込一覧の下の辺から出て、申込登録の上の辺に入る
  const line = $(app, `path.mw-line[data-wire="s:${ids[0]}|s:${ids[1]}|button"]`);
  const w = wpsOf(line);
  assert.equal(w[0][1], b[0].y + b[0].h);
  assert.equal(w[w.length - 1][1], b[1].y);
  // 行きと帰りは 1 本の両矢印（申込登録 ⇔ 内容確認）
  assert.equal($$(app, 'path.mw-line').length, 3);
  // 元に戻す
  api.store.undo();
  assert.equal('flowVertical' in d(), false);
  assert.deepEqual(plain(d().flowPos), { ['s:' + ids[3]]: { x: 800, y: 40 } });
  assert.equal(box(3).x, 800);
  api.store.redo();
  click($(app, '[data-action="flow-vertical"]'));
  assert.equal(api.store.canRedo(), false, '同じ向きを押しても変更しない');
  click($(app, '[data-action="flow-horizontal"]'));
  assert.equal('flowVertical' in d(), false);
  assert.ok(node(1));
});

test('縦向き: 上下の辺に付く線の文字を横に並べられる幅まで、ボックスを横に伸ばす。ドラッグの間も、伸ばした幅のまま線を引き直す', async (t) => {
  const { app, api, A, ids, box, node } = await boot(t);
  // 申込一覧から、ほかの 3 つの画面へのボタンを追加する（申込一覧の下の辺に 3 本並ぶ）
  ['とても長いボタンの名前その一', 'とても長いボタンの名前その二', 'とても長いボタンの名前その三'].forEach((label, k) => {
    const p = api.actions.addPart(A, ids[0], 'button', { x: 40, y: 200 + k * 48 });
    api.actions.updatePart(A, ids[0], p, { label, props: { to: 'screen', screenId: ids[k + 1] } });
  });
  api.actions.setFlowVertical(A, true);
  assert.ok(box(0).w > 400, '申込一覧のボックスを横に伸ばす');
  assert.equal(box(3).w, 200, '線の少ないボックスは幅 200 のまま');
  const w0 = box(0).w;
  mouseAt(app, node(3), 'mousedown', 100, 100);
  mouseAt(app, app.document, 'mousemove', 160, 140);
  assert.equal(parseFloat(node(0).style.width), w0);
  assert.ok($$(app, 'path.mw-line').length >= 4, 'ドラッグの間も線を引く');
  mouseAt(app, app.document, 'mouseup', 160, 140);
  assert.equal(box(0).w, w0, '動かした後も、同じ幅');
});

test('縦向きの記録: flowVertical は true のときだけ残す。改訂の中身・出力（PDF の画面遷移図）も縦向き', async (t) => {
  const { api, A, d } = await boot(t);
  const norm = (v) => api.normalizeState({ schemaVersion: 3, settings: {}, systems: [], designs: [{ ...plain(d()), flowVertical: v }] }).designs[0];
  assert.equal(norm(true).flowVertical, true);
  assert.equal('flowVertical' in norm('yes'), false);
  assert.equal('flowVertical' in norm(false), false);
  assert.ok(api.DESIGN_CONTENT_KEYS.includes('flowVertical'), '改訂履歴の版の中身に入れる');
  const size = () => api.viewHtml('flow', api.store.state, d(), d().flowPos, { bare: true }).match(/width:(\d+)px;height:(\d+)px/).slice(1).map(Number);
  const [w0, h0] = size();
  const before = plain(d());
  api.actions.setFlowVertical(A, true);
  const rows = plain(api.designDiff(before, d(), api.store.state).rows);
  assert.match(rows.find((r) => r.screen === '画面設計').text, /画面遷移図の向き：横向き → 縦向き/, '改訂の違いの一覧に書く');
  const [w1, h1] = size();
  assert.ok(h1 > h0 && w1 < w0, `一本道の縦向きは、横向きより縦に長く、幅が狭い（横向き ${w0}×${h0}・縦向き ${w1}×${h1}）`);
});

test('つながっていない画面（q189 案A）: 横向きは、いちばん右の列のさらに右に、縦向きは段の右に、上から 1 列で並べる', async (t) => {
  const { app, api, A, ids, box } = await boot(t);
  // 線のない画面を 2 つ追加する（お知らせ・よくある質問）
  const lone = ['お知らせ', 'よくある質問'].map((name) => {
    const id = api.actions.addScreen(A, 'blank', ids[ids.length - 1]);
    api.actions.updateScreen(A, id, { name });
    ids.push(id);
    return ids.length - 1;
  });
  const check = (tag) => {
    const linked = [0, 1, 2, 3].map(box);
    const [a, b] = lone.map(box);
    const right = Math.max(...linked.map((r) => r.x + r.w));
    assert.equal(a.x, b.x, `${tag}: 同じ列`);
    assert.ok(a.x > right, `${tag}: 線のある画面の右（${a.x} > ${right}）`);
    assert.equal(a.y, 40, `${tag}: 上の端から`);
    assert.ok(b.y > a.y + a.h, `${tag}: 上から順に縦に並べる`);
  };
  check('横向き');
  click($(app, '[data-action="flow-vertical"]'));
  check('縦向き');
});

test('PDF の画面遷移図: つながっていない画面を右に並べると分割が必要になり、下に並べれば 1 ページに収まる時（A4 縦）は、下に並べる。A4 横は右に 1 列のまま', async (t) => {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  // 申込受付: 申込一覧 → 申込登録 → 完了（一本道）と、線のない画面「お知らせ」
  const A = api.actions.createDesign('申込受付', 'kintone');
  const d = () => api.store.state.designs.find((x) => x.id === A);
  const ids = [d().screens[0].id];
  api.actions.updateScreen(A, ids[0], { name: '申込一覧' });
  ['申込登録', '完了', 'お知らせ'].forEach((name) => {
    const id = api.actions.addScreen(A, 'blank', ids[ids.length - 1]);
    api.actions.updateScreen(A, id, { name });
    ids.push(id);
  });
  const btn = (from, to, label) => {
    const p = api.actions.addPart(A, ids[from], 'button', { x: 40, y: 120 });
    api.actions.updatePart(A, ids[from], p, { label, props: { to: 'screen', screenId: ids[to] } });
  };
  btn(0, 1, '申込を登録する');
  btn(1, 2, '申し込む');
  // 前提: 右に 1 列で並べた図は、A4 縦（測れない時の本文の幅 713）では倍率 60% より小さく縮む
  const right = api.viewHtml('flow', api.store.state, d(), d().flowPos, { bare: true });
  assert.ok(api.diagramCrop(right).cw * api.DIAGRAM_MIN_ZOOM > 713, `右に 1 列の図の幅 ${api.diagramCrop(right).cw}`);
  const flow = (orient) => {
    const doc = api.exportDocument(d(), api.store.state, { paper: 'A4', orient, cover: false, map: false, items: false, process: false, flow: true, settings: false });
    const pages = doc.pages.map((h) => new app.window.DOMParser().parseFromString(h, 'text/html')).filter((p) => p.querySelector('.pg-head h2').textContent.startsWith('画面遷移図'));
    const box = (i) => {
      const n = pages[0].querySelector(`.mnode[data-node="s:${ids[i]}"]`);
      return { x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width), h: parseFloat(n.style.height) };
    };
    return { n: pages.length, linked: [0, 1, 2].map(box), lone: box(3) };
  };
  const p = flow('portrait');
  assert.equal(p.n, 1, 'A4 縦: 画面遷移図は 1 ページ');
  assert.ok(p.lone.y > Math.max(...p.linked.map((r) => r.y + r.h)), 'A4 縦: つながっていない画面は、線のある画面の下');
  const l = flow('landscape');
  assert.equal(l.n, 1, 'A4 横: 画面遷移図は 1 ページ');
  assert.ok(l.lone.x > Math.max(...l.linked.map((r) => r.x + r.w)), 'A4 横: つながっていない画面は、右に 1 列（q189 案A）');
});

test('AI: update_design の flowOrientation で向きを変え、get_design の flowOrientation で読む。知らない値は断る', async (t) => {
  const { sampleState, STORAGE_KEY } = require('./ai-fixtures');
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  t.after(() => app.close());
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  let r = await call('get_design', { design: 'd1' });
  assert.equal(r.result.flowOrientation, 'horizontal');
  r = await call('update_design', { design: 'd1', expect: r.result.updatedAt, flowOrientation: 'vertical' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.flowOrientation, 'vertical');
  assert.equal(T.store.state.designs.find((x) => x.id === 'd1').flowVertical, true);
  assert.equal((await call('get_design', { design: 'd1' })).result.flowOrientation, 'vertical');
  r = await call('update_design', { design: 'd1', flowOrientation: 'diagonal' });
  assert.equal(r.ok, false);
});
