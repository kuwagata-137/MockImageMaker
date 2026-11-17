'use strict';
// v1.05 段階 C（q172 案A・q190 案A）: PDF で、読めない大きさ（倍率 60% より小さい）まで縮む図を何ページかに分けるテスト。
// 分ける位置（tileSpans・diagramTiles）・分けたページの見出しと番号・ページ端の印の対応・表紙の範囲・同じ id がないこと・
// AI の get_view_image の area（大きい図の範囲を縮めずに返す）。画面設計とシステムの名前は架空の業務（購買申請・購買業務）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const STATES = ['下書き', '申請中', '課長承認待ち', '部長承認待ち', '社長決裁待ち', '決裁済み', '見積依頼中', '見積受領', '発注準備', '発注済み',
  '納期回答待ち', '納品待ち', '検収待ち', '検収済み', '請求書待ち', '請求書受領', '支払承認待ち', '支払済み', '完了', '見送り'];

async function boot(t) {
  const app = bootApp();
  const T = await app.api();
  t.after(() => app.close());
  const call = async (tool, args) => {
    const r = plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
    assert.equal(r.ok, true, `${tool}: ${JSON.stringify(r.error)}`);
    return r;
  };
  return { app, T, call };
}
// ステータス n 個の画面設計（隣へ進む操作と、いくつかの差し戻し・取り下げ）
async function processDesign(call, name, n) {
  await call('create_design', { name, target: 'kintone' });
  const states = STATES.slice(0, n);
  const ops = [{ op: 'set_states', states }];
  states.slice(1).forEach((to, i) => ops.push({ op: 'add_action', name: `進める ${i + 1}`, from: states[i], to, role: '担当者' }));
  if (n > 5) ops.push({ op: 'add_action', name: '差し戻す', from: states[4], to: states[0], role: '社長', cond: '書き直してほしいとき' });
  for (let i = 1; i < Math.min(n - 1, 13); i++) ops.push({ op: 'add_action', name: '取り下げる', from: states[i], to: states[n - 1], role: '申請者' });
  await call('edit_process', { design: name, ops });
  await call('layout_screen', { design: name, screen: '画面 1', layout: { columns: 2, rows: [[{ type: 'status' }]] } });
}
const design = (T, name) => T.store.state.designs.find((d) => d.name === name);
// 印刷用文書のページ（題・右下の番号・ページ端の印・id）
function pagesOf(app, html) {
  const doc = new app.window.DOMParser().parseFromString(html, 'text/html');
  // 表紙には右下の番号がないので、並びの番号（1 から）にする
  return [...doc.querySelectorAll('body > .pg')].map((pg, i) => ({
    title: (pg.querySelector('.pg-head h2') || pg.querySelector('.cv-title') || {}).textContent || '',
    sub: (pg.querySelector('.pg-head span') || {}).textContent || '',
    no: Number(((pg.querySelector('.pg-foot span:last-child') || {}).textContent || '0').split(' / ')[0]) || i + 1,
    marks: [...pg.querySelectorAll('.xp-tmark')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
    ids: [...pg.querySelectorAll('[id]')].map((e) => e.id),
    cover: [...pg.querySelectorAll('.cv-list tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()),
  }));
}
// ページ端の印が、相手のページの印と対応しているか（「▼ 4 ページへ」のページ p には、4 ページに「▼ p ページから」がある）
function assertMarksPaired(pages) {
  const byNo = new Map(pages.map((p) => [p.no, p]));
  let n = 0;
  pages.forEach((p) => p.marks.forEach((m) => {
    const x = m.match(/^([▼▲▶◀]) (\d+) ?ページ(へ|から)$/);
    assert.ok(x, `印の形: ${m}`);
    const want = `${x[1]} ${p.no} ページ${x[3] === 'へ' ? 'から' : 'へ'}`;
    const other = byNo.get(Number(x[2]));
    assert.ok(other && other.marks.some((o) => o.replace(/(\d)ページ/, '$1 ページ') === want), `${p.no} ページの「${m}」に対応する「${want}」が ${x[2]} ページにない`);
    n += 1;
  }));
  return n;
}

test('tileSpans: ボックスの間に切れ目を置き、次のページは切れ目の手前の線だけが通る所から描く。入る切れ目がなければボックスの途中で切る', async (t) => {
  const { T } = await boot(t);
  const occ = [[0, 100], [150, 250], [300, 400], [450, 550]];
  assert.deepEqual(plain(T.tileSpans(occ, 0, 550, 320)), [{ t0: 0, t1: 275, d0: 0, d1: 275 }, { t0: 275, t1: 550, d0: 252, d1: 550 }]);
  // 1 ページに入る長さより大きい物は数えない（切れ目の候補がない）ので、入るところで切る
  assert.deepEqual(plain(T.tileSpans([[0, 1000]], 0, 1000, 400)).map((s) => [s.t0, s.t1]), [[0, 400], [400, 800], [800, 1000]]);
  // 2 ページ目から見出しを繰り返すときは、その長さの分だけ短く切る
  const withHead = plain(T.tileSpans(occ, 0, 550, 320, 40));
  withHead.forEach((s, i) => assert.ok(s.d1 - s.d0 + (i ? 40 : 0) <= 320, JSON.stringify(withHead)));
  // レーンの境目（fixed）があるときは、そこでだけ切る
  assert.deepEqual(plain(T.tileSpans(occ, 0, 550, 320, 0, [200, 380])).map((s) => [s.t0, s.t1, s.d0]), [[0, 200, 0], [200, 380, 200], [380, 550, 380]]);
  // 線の折れ点と同じ位置には切れ目を置かない（4 ずらす）
  assert.equal(plain(T.tileSpans(occ, 0, 550, 320, 0, null, [275]))[0].t1, 279);
});

test('diagramTiles: 倍率 60% 以上で 1 ページに入る図は分けない。入らない図は、どのページも同じ倍率（60% 以上）で、高さが入るように分ける', async (t) => {
  const { T, call } = await boot(t);
  await processDesign(call, '購買申請', 20);
  await processDesign(call, '小さい申請', 3);
  const html = (name) => T.viewHtml('process', T.store.state, design(T, name), {}, { idPrefix: 'x', bare: true });
  const small = html('小さい申請');
  assert.equal(T.diagramTiles(small, T.diagramCrop(small), 1042, 650), null);
  const big = html('購買申請');
  const c = T.diagramCrop(big);
  assert.ok(Math.min(1, 1042 / c.cw, 650 / c.ch) < T.DIAGRAM_MIN_ZOOM, '見本の図は、1 ページでは 60% より小さく縮む');
  const tiles = plain(T.diagramTiles(big, c, 1042, 650));
  assert.ok(tiles.n >= 3 && tiles.cols.length === 1, JSON.stringify({ n: tiles.n, cols: tiles.cols.length }));
  assert.ok(tiles.k >= T.DIAGRAM_MIN_ZOOM && tiles.k <= 1, String(tiles.k));
  // 上下の印の帯（20 ずつ）を引いた高さに入る。ページの範囲はすき間なく続く
  tiles.rows.forEach((r) => assert.ok((r.d1 - r.d0) * tiles.k <= 650 - 40 + 1, JSON.stringify(r)));
  tiles.rows.slice(1).forEach((r, i) => assert.equal(r.t0, tiles.rows[i].t1));
  assert.equal(tiles.rows[0].t0, c.y0);
  assert.equal(tiles.rows[tiles.rows.length - 1].t1, c.y0 + c.ch);
});

test('PDF: ステータスの流れを分けたページは「（1/n）」と縮小の倍率を書き、ページ端の印は相手のページの印と対応する。表紙は範囲で書き、数だけ数えた結果と同じ', async (t) => {
  const { app, T, call } = await boot(t);
  await processDesign(call, '購買申請', 20);
  const d = design(T, '購買申請');
  for (const [paper, orient] of [['A4', 'landscape'], ['A4', 'portrait'], ['A3', 'landscape']]) {
    const opts = { paper, orient, cover: true, map: true, items: true, process: true, flow: true };
    const doc = T.exportDocument(d, T.store.state, opts);
    const pages = pagesOf(app, doc.html);
    const proc = pages.filter((p) => p.title.startsWith('ステータスの流れ（') && !p.title.endsWith('（続き）'));
    assert.ok(proc.length >= 2, `${paper} ${orient}: ${pages.map((p) => p.title).join(' / ')}`);
    proc.forEach((p, i) => {
      assert.equal(p.title, `ステータスの流れ（${i + 1}/${proc.length}）`);
      assert.match(p.sub, /・\d+% に縮小/);
      assert.ok(Number(p.sub.match(/(\d+)% に縮小/)[1]) >= 60, p.sub);
    });
    assert.ok(assertMarksPaired(pages) >= 2, '印が 2 つ以上ある');
    // 番号は 1 から順に、数だけ数えた結果と同じ
    assert.deepEqual(pages.map((p) => p.no), pages.map((_, i) => i + 1));
    assert.equal(T.exportDocument(d, T.store.state, { ...opts, countOnly: true }).total, pages.length);
    // 表紙の一覧は、ステータスの流れのページを範囲で書く（続きの操作一覧のページまで）
    const first = pages.findIndex((p) => p.title.startsWith('ステータスの流れ')) + 1;
    const last = pages.length - pages.slice().reverse().findIndex((p) => p.title.startsWith('ステータスの流れ'));
    assert.ok(pages[0].cover.includes(`ステータスの流れ${first}〜${last}`), pages[0].cover.join(' / '));
    // 同じ文書に同じ id はない（分けたページごとに矢印の印の id を変える）
    const ids = pages.flatMap((p) => p.ids);
    assert.deepEqual(ids.filter((v, i) => ids.indexOf(v) !== i), []);
  }
});

test('システム設計書: 工程 56 個のスイムレーン図は何ページかに分け、表紙の一覧は範囲で書く。2 ページ目からレーンの見出しを繰り返す', async (t) => {
  const { app, T, call } = await boot(t);
  for (const orientation of ['horizontal', 'vertical']) {
    const name = `購買業務（${orientation}）`;
    await call('create_system', { name });
    const ROLES = ['申請者', '課長', '部長', '購買担当', '経理担当'];
    await call('update_system', { system: name, ops: ROLES.map((n) => ({ op: 'add', name: n })) });
    const steps = Array.from({ length: 56 }, (_, i) => ({ key: 's' + i, role: ROLES[[0, 1, 2, 3, 3, 3, 0, 4, 4, 4][i % 10]], text: `${i + 1}. 工程`, col: i }));
    const edges = steps.slice(1).map((s, i) => ({ from: 's' + i, to: s.key }));
    edges.push({ from: 's12', to: 's10', label: '差し戻し' });
    const y0 = (await call('get_system', { system: name })).result;
    await call('set_swimlane', { system: name, expect: y0.updatedAt, steps, edges, orientation });
    const y = T.store.state.systems.find((s) => s.name === name);
    const doc = T.exportSystemDocument(y, T.store.state, { paper: 'A4', orient: 'landscape', systemCover: true, swimlane: true, notes: false });
    const pages = pagesOf(app, doc.html);
    const swim = pages.filter((p) => p.title.startsWith('スイムレーン図'));
    assert.ok(swim.length >= 2, `${orientation}: ${swim.length}`);
    swim.forEach((p, i) => assert.equal(p.title, `スイムレーン図（${i + 1}/${swim.length}）`));
    assert.ok(pages[0].cover.includes(`スイムレーン図2〜${swim.length + 1}`), pages[0].cover.join(' / '));
    assert.ok(assertMarksPaired(pages) >= 1);
    // 2 ページ目にもレーンの見出し（役割の名前）がある
    const second = new app.window.DOMParser().parseFromString(doc.pages[2], 'text/html');
    assert.deepEqual([...second.querySelectorAll('.swim-lab')].map((e) => e.textContent).filter((v, i, a) => a.indexOf(v) === i).sort(), [...ROLES].sort());
    assert.equal(doc.total, pages.length);
  }
});

test('get_view_image の area: 縮めると読めない大きい図は areas（範囲の数）を返し、area で範囲を縮めずに返す。範囲の外と、分けない図の 2 以上は断る', async (t) => {
  const { T, call } = await boot(t);
  await processDesign(call, '購買申請', 20);
  await processDesign(call, '小さい申請', 3);
  const whole = await call('get_view_image', { design: '購買申請', view: 'process' });
  const n = whole.result.areas;
  assert.ok(n >= 2, JSON.stringify(whole.result));
  const a1 = await call('get_view_image', { design: '購買申請', view: 'process', area: 1 });
  assert.deepEqual([a1.result.areas, a1.result.area], [n, 1]);
  assert.ok(a1.render.width <= 1566 && a1.render.height <= 1566, `${a1.render.width} × ${a1.render.height}`);
  assert.match(a1.render.html, /（範囲 1\/\d+）/);
  const last = await call('get_view_image', { design: '購買申請', view: 'process', area: n });
  assert.equal(last.result.area, n);
  const bad = plain(await T.aiDispatch('get_view_image', { design: '購買申請', view: 'process', area: n + 1 }, { session: 's-1', client: 'claude-code' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, new RegExp(`1〜${n}`));
  // 分けない図: area を省くと areas を付けない。area 1 は全体と同じ画像、2 以上は断る
  const small = await call('get_view_image', { design: '小さい申請', view: 'process' });
  assert.equal(small.result.areas, undefined);
  const s1 = await call('get_view_image', { design: '小さい申請', view: 'process', area: 1 });
  assert.deepEqual([s1.result.areas, s1.result.area, s1.render.html], [1, 1, small.render.html]);
  const s2 = plain(await T.aiDispatch('get_view_image', { design: '小さい申請', view: 'process', area: 2 }, { session: 's-1', client: 'claude-code' }));
  assert.equal(s2.ok, false);
  assert.match(s2.error.message, /area は 1 だけ/);
});
