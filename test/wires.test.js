'use strict';
// v1.05 の関連図と画面遷移図の直角の線のテスト（画像 q167 の案A 往復統合・q168 の案A 両端配置）。
// 見本は架空の業務（顧客管理。画面「顧客詳細」から 12 画面へ行き来する）で、AI のツール（aiDispatch）で組み立てる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const STORAGE_KEY = 'mockimagemaker.v1';
const EMPTY = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] };
const SUBS = ['見積作成', '契約登録', '訪問記録', '問い合わせ登録', '請求書発行', '入金確認', '担当者変更', '住所変更', '解約受付', '資料送付', '点検予約', 'メモ登録'];
const plain = (v) => JSON.parse(JSON.stringify(v));

async function bootHub(t) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(EMPTY) } });
  t.after(() => app.close());
  const api = await app.api();
  const call = async (tool, args) => {
    const r = await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' });
    assert.equal(r.ok, true, `${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const btn = (label, to) => ({ type: 'button', label, to });
  await call('create_design', { name: '顧客管理', target: 'kintone' });
  await call('edit_screen', { design: '顧客管理', ops: [{ op: 'update', screen: '画面 1', name: '顧客詳細' }] });
  for (const name of SUBS) await call('add_screen', { design: '顧客管理', name });
  await call('layout_screen', { design: '顧客管理', screen: '顧客詳細', layout: { columns: 4, rows: [0, 4, 8].map((i) => SUBS.slice(i, i + 4).map((s) => btn(`${s}へ進む`, s))) } });
  for (const name of SUBS) await call('layout_screen', { design: '顧客管理', screen: name, layout: { columns: 2, rows: [[btn('登録する', '顧客詳細'), btn('キャンセル', '顧客詳細')]] } });
  const d = api.store.state.designs[0];
  return { app, api, d, hub: 's:' + d.screens[0].id };
}
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('swimRoutes は、レーンのない図（関連図・画面遷移図）でも線を引ける。曲がる位置 mid を渡すと、その位置で曲がる', async (t) => {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(EMPTY) } });
  t.after(() => app.close());
  const api = await app.api();
  const input = (mid) => ({ vertical: false, w: 900, h: 500, lanes: [],
    nodes: [{ id: 'a', type: 'rect', x: 40, y: 40, w: 200, h: 64 }, { id: 'b', type: 'rect', x: 440, y: 240, w: 200, h: 64 }],
    edges: [{ id: 'e', from: 'a', to: 'b', fromPin: { side: 'right', frac: 0.5 }, toPin: { side: 'left', frac: 0.5 }, ...(mid ? { mid } : {}) }] });
  const r = plain(api.swimRoutes(input(300)).e);
  assert.deepEqual(r.wps, [[240, 72], [300, 72], [300, 272], [440, 272]], 'ボックスの右の辺の真ん中から出て、x = 300 で曲がり、相手の左の辺の真ん中へ入る');
  assert.equal(plain(api.swimRoutes(input(null)).e).wps.length, 4, 'mid を渡さなくても引ける（今までのスイムレーン図と同じ）');
});

test('mapWires: 画面遷移図は、同じ 2 つの画面の間の行きと帰りを 1 本にまとめる（q167 案A）。関連図はまとめない', async (t) => {
  const { api, d, hub } = await bootHub(t);
  const model = api.flowModel(api.store.state, d);
  assert.equal(model.edges.length, 24, '行き 12 本・帰り 12 本（モデルは今までと同じ）');
  const merged = api.mapWires(model, { merge: true, label: (e) => e.labels.slice(0, 3) });
  assert.equal(merged.length, 12);
  assert.ok(merged.every((w) => w.both && w.from === hub), 'どれも両矢印。画面の並びで先の「顧客詳細」が出る側');
  assert.deepEqual(plain([merged[0].fwd, merged[0].back]), [['見積作成へ進む'], ['登録する', 'キャンセル']], '出る側の端に行きの文字、入る側の端に帰りの文字');
  assert.equal(api.mapWires(model, { label: (e) => e.labels.slice(0, 3) }).length, 24, 'merge を付けなければ、まとめない');
  // 長い文字は「…」で切る
  const long = api.mapWires({ nodes: [], edges: [{ from: 'a', to: 'b', kind: 'button', labels: ['あ'.repeat(40)] }] }, { label: (e) => e.labels });
  assert.match(long[0].fwd[0], /^あ{13}…$/);
});

test('画面遷移図: 1 つのボックスに 12 本付いても、線の端は辺の上で 18 以上ずつ離れ、ボックスは線の数に合わせて縦に伸びる（q168 案A）', async (t) => {
  const { api, d, hub } = await bootHub(t);
  const model = api.flowModel(api.store.state, d);
  const wires = api.mapWires(model, { merge: true, label: (e) => e.labels.slice(0, 3) });
  const pos = api.mapWireLayout(model, {}, wires, () => 64);
  assert.equal(pos[hub].h, 12 * 22, '線 12 本 × 間隔 22（1 行の文字 14 ＋ 8）');
  const sub = model.nodes.find((n) => n.key !== hub).key;
  assert.equal(pos[sub].h, 64, '線が 1 本だけのボックスは伸ばさない');
  const { ends } = api.mapWireEnds(wires, pos);
  const ys = ends.filter((p) => p.node === hub).map((p) => p.pt[1]).sort((a, b) => a - b);
  assert.equal(ys.length, 12);
  assert.ok(ys.slice(1).every((y, i) => y - ys[i] >= api.WIRE_PITCH), `辺の上の間隔: ${ys.slice(1).map((y, i) => y - ys[i])}`);
  assert.ok(ends.filter((p) => p.node === hub).every((p) => p.side === 'right' && p.pt[0] === pos[hub].x + 200));
  // 列の間は、端の文字と線の通り道の分だけ広がる
  assert.ok(pos[sub].x - (pos[hub].x + 200) > 200, `列の間: ${pos[sub].x - (pos[hub].x + 200)}`);
  // 線の道: 12 本とも引け、どの区間も横か縦。縦の通り道は 1 本ずつ別の位置
  const wire = api.mapWireRoute(model, wires, pos);
  const routes = plain(wire.routes);
  assert.equal(Object.keys(routes).length, 12);
  Object.values(routes).forEach((r) => assert.ok(r.wps.slice(1).every((q, i) => q[0] === r.wps[i][0] || q[1] === r.wps[i][1])));
  const tracks = Object.values(routes).filter((r) => r.wps.length === 4).map((r) => r.wps[1][0]);
  assert.equal(new Set(tracks).size, tracks.length, '縦の通り道が重ならない');
  // 端の文字: 行き 12 個・帰り 12 個。ボックスにも、ほかの文字にも重ならない
  const labels = plain(wire.labels);
  assert.equal(labels.length, 24);
  const boxes = model.nodes.map((n) => ({ x: pos[n.key].x, y: pos[n.key].y, w: 200, h: pos[n.key].h }));
  labels.forEach((l, i) => {
    assert.ok(!boxes.some((b) => hit(l, b)), `文字「${l.lines[0]}」がボックスに重ならない`);
    assert.ok(!labels.slice(i + 1).some((m) => hit(l, m)), `文字「${l.lines[0]}」がほかの文字に重ならない`);
  });
  assert.ok(wire.right >= Math.max(...labels.map((l) => l.x + l.w)) && wire.bottom >= Math.max(...boxes.map((b) => b.y + b.h)) - 64);
});

test('画面遷移図の HTML: 線は 12 本で、両端に矢印の印。図の枠は線と文字が入る大きさ。PDF の切り出しも線と文字まで入る', async (t) => {
  const { app, api, d, hub } = await bootHub(t);
  const doc = new app.window.DOMParser().parseFromString(api.viewHtml('flow', api.store.state, d), 'text/html');
  const paths = [...doc.querySelectorAll('svg > path')];
  assert.equal(paths.length, 12);
  paths.forEach((p) => {
    assert.equal(p.getAttribute('marker-end'), 'url(#flow-arrow-n)');
    assert.equal(p.getAttribute('marker-start'), 'url(#flow-arrow-n)', 'まとめた線は両矢印');
    assert.ok(p.getAttribute('data-wps'));
  });
  const inner = doc.querySelector('.map-inner');
  const hubEl = [...doc.querySelectorAll('.mnode')].find((n) => n.dataset.node === hub);
  assert.equal(hubEl.style.height, '264px');
  const rects = [...doc.querySelectorAll('svg > rect')].map((r) => ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k))));
  assert.equal(rects.length, 24, '文字の下地');
  assert.ok(rects.every(([x, y, w, h]) => x + w <= parseFloat(inner.style.width) && y + h <= parseFloat(inner.style.height)), '文字が図の枠からはみ出さない');
  const c = api.diagramCrop(api.viewHtml('flow', api.store.state, d, {}, { bare: true }));
  assert.ok(rects.every(([x, y, w, h]) => x >= c.x0 && y >= c.y0 && x + w <= c.x0 + c.cw && y + h <= c.y0 + c.ch), 'PDF の切り出しに文字が入る');
});

test('mapLayout: 列の間を渡さなければ、今までどおり 400 おき。渡すと、その分だけ右の列がずれる', async (t) => {
  const { api, d } = await bootHub(t);
  const model = api.flowModel(api.store.state, d);
  const xs = (pos) => [...new Set(Object.values(pos).map((p) => p.x))].sort((a, b) => a - b);
  assert.deepEqual(xs(api.mapLayout(model)), [40, 440]);
  assert.deepEqual(xs(api.mapLayout(model, () => 64, [350])), [40, 590]);
});
