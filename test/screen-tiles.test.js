'use strict';
// v1.05 段階 D（q174 案A）: PDF で、縦に長い画面（倍率 60% より小さく縮む画面）を、アイテムのない高さで上から何ページかに分割するテスト。
// 分割する位置と倍率（screenTiles）・吹き出しを指しているアイテムと同じページに描くこと・分割したページの見出しと番号・設定一覧のページ・
// 表紙の範囲・countOnly・同じ id がないこと・AI の get_screen_image の area（縦に長い画面の範囲を読める大きさで返す）。
// 画面設計の名前は架空の業務（設備点検記録）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const STORAGE_KEY = 'mockimagemaker.v1';
const plain = (v) => JSON.parse(JSON.stringify(v));
const Z = 240; // CALLOUT_ZONE（画面のまわりの、吹き出しを置ける範囲の幅）

// ── 見本（架空の業務）──
const item = (id, name) => ({ id, name, type: 'text1', required: false, memo: '', props: {}, lookup: null, link: null });
const ipart = (id, x, y, no, itemId) => ({ id, type: 'text1', x, y, w: 480, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const screen = (id, name, height, parts, callouts = []) => ({ id, name, device: 'pc', width: 1280, height, showHeader: true, tablePos: 'right', parts, callouts });
// 点検記録の入力（1280 × 3400）: 2 列のアイテムを 160 ごとに 20 段。段と段の間は 96 空く
const ROWS = 20;
const rowY = (r) => 80 + r * 160;
function sampleState() {
  const items = [];
  const parts = [];
  for (let r = 0; r < ROWS; r++) {
    for (const col of [0, 1]) {
      const n = r * 2 + col + 1;
      items.push(item(`i${n}`, `点検項目 ${n}`));
      parts.push(ipart(`p${n}`, 32 + col * 560, rowY(r), n, `i${n}`));
    }
  }
  const callouts = [
    // 下の端のアイテムを指すが、上の端に置いた吹き出し（指しているアイテムのページへ動かす）
    { id: 'k1', x: 1300, y: 100, w: 200, h: 60, text: '最後の点検項目の書き方。', color: 'yellow', tip: 'arrow', target: `p${ROWS * 2}` },
    // 指しているアイテムの横に置いた吹き出し
    { id: 'k2', x: 1300, y: rowY(5), w: 200, h: 60, text: '測定値は数字だけを入れる。', color: 'blue', tip: 'dot', target: 'p11' },
    // 何も指していない吹き出し（吹き出しの真ん中の高さのページに描く）
    { id: 'k3', x: 1300, y: 2000, w: 200, h: 60, text: '点検の手順は別紙。', color: 'gray', tip: 'none', target: null },
  ];
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [{
      id: 'd1', name: '設備点検記録', target: 'kintone', description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      trashedAt: null, revisions: [], mapPos: {},
      items,
      screens: [
        screen('s1', '点検記録の入力', 3400, parts, callouts),
        screen('s2', '点検記録の確認', 800, [ipart('q1', 32, 80, 1, 'i1')]),
      ],
    }],
  };
}

async function boot(t) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  const api = await app.api();
  t.after(() => app.close());
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  const parse = (h) => new app.window.DOMParser().parseFromString(h, 'text/html');
  const call = async (tool, args) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  return { app, api, d, parse, call };
}

// 大きさを測る関数の身代わり（test/settings-list-pages.test.js と同じ形）。本文は 1000×600。設定一覧の表の高さは「40 ＋ 行の数 × 280000 ÷ 幅」。ほかの要素は 100×20
function fakeMeasure(app) {
  app.window.Element.prototype.getBoundingClientRect = function () {
    const st = (el, k) => parseFloat(el && el.style && el.style[k]) || 0;
    let z = 1;
    for (let e = this.parentElement; e; e = e.parentElement) z *= st(e, 'zoom') || 1;
    let [x, y, width, height] = [0, 0, 100, 20];
    if (this.classList.contains('pg-body')) [width, height] = [1000, 600];
    else if (this.classList.contains('ptable')) {
      width = st(this, 'width');
      height = 40 + this.querySelectorAll('tbody tr').length * 280000 / width;
      [x, y] = [st(this.parentElement, 'left'), st(this.parentElement, 'top')];
    } else if (this.style.width) [width, height] = [st(this, 'width'), st(this, 'height')];
    [x, y, width, height] = [x * z, y * z, width * z, height * z];
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
  };
}
const OPTS = { paper: 'A4', orient: 'landscape', cover: true, map: false, items: false, process: false, flow: false };
const headOf = (p) => { const h = p.querySelector('.pg-head h2'); return h ? h.textContent : ''; };
const subOf = (p) => { const s = p.querySelector('.pg-head span'); return s ? s.textContent : ''; };

test('screenTiles: 縦に長い画面だけを、アイテムのない高さで切る。どのページも同じ倍率（60% 以上）。吹き出しは指しているアイテムのページに描く', async (t) => {
  const { api, d } = await boot(t);
  const s = d.screens[0];
  const comp = api.screenComposite(d, s, 'probe', false, null, { table: false });
  const T = plain(api.screenTiles(s, comp, 1000, 600, true));
  assert.ok(T && T.tiles.length >= 3, JSON.stringify(T && T.tiles.length));
  const [, y0, , y1] = comp.crop;
  // 上の端から下の端まで、すき間なく続く。どのページも、倍率 0.6 で本文の高さ（600）に入る
  assert.equal(T.tiles[0].t0, y0);
  assert.equal(T.tiles[T.tiles.length - 1].t1, y1);
  T.tiles.slice(1).forEach((t2, i) => assert.equal(t2.t0, T.tiles[i].t1));
  T.tiles.forEach((t2) => assert.ok((t2.t1 - t2.t0) * 0.6 <= 600 + 0.01, `${t2.t1 - t2.t0}`));
  assert.ok(T.k >= 0.6 && T.k <= Math.min(1, 1000 / (comp.crop[2] - comp.crop[0])) + 1e-9, String(T.k));
  // 切れ目はアイテムの途中にない
  for (const { t1: cut } of T.tiles.slice(0, -1)) {
    for (const p of s.parts) assert.ok(!(Z + p.y < cut && Z + p.y + p.h > cut), `${p.id} が ${cut} で切れる`);
  }
  // 吹き出しは、どれか 1 つのページにだけ描く
  const where = (id) => T.tiles.findIndex((t2) => t2.callouts.includes(id));
  assert.deepEqual(T.tiles.flatMap((t2) => t2.callouts).sort(), ['k1', 'k2', 'k3']);
  // k1 は下の端のアイテムを指すので、最後のページへ動かす（ページの中に入る位置）
  const last = T.tiles[T.tiles.length - 1];
  assert.equal(where('k1'), T.tiles.length - 1);
  assert.ok(last.moved.k1 != null);
  assert.ok(Z + last.moved.k1 >= last.t0 + 4 && Z + last.moved.k1 + 60 <= last.t1 - 4, String(last.moved.k1));
  // k2 は指しているアイテム（p11。5 段目）の真ん中の高さのページ。k3（何も指していない）は吹き出しの真ん中の高さのページ
  const pageOf = (y) => T.tiles.findIndex((t2) => Z + y < t2.t1);
  assert.equal(where('k2'), pageOf(rowY(5) + 32));
  assert.equal(where('k3'), pageOf(2000 + 30));
  // 1 ページに入る画面（点検記録の確認。1280 × 800）は分割しない
  const s2 = d.screens[1];
  assert.equal(api.screenTiles(s2, api.screenComposite(d, s2, 'probe', false, null, { table: false }), 1000, 600, true), null);
  // 幅で縮む画面（本文が 500 × 600 なら、幅で決まる倍率 0.39 のほうが、高さで決まる倍率より小さくなる画面）は分割しない
  const wide = { ...s2, height: 900 };
  assert.equal(api.screenTiles(wide, api.screenComposite(d, wide, 'probe', false, null, { table: false }), 500, 600, true), null);
  // 幅で決まる倍率が 0.6 より小さい縦に長い画面（本文が 900 × 600）は、幅で決まる倍率で分割する
  const kW = 900 / (comp.crop[2] - comp.crop[0]);
  assert.ok(kW < 0.6);
  const narrow = plain(api.screenTiles(s, comp, 900, 600, true));
  assert.ok(narrow.tiles.length >= 3);
  assert.ok(Math.abs(narrow.k - kW) < 1e-9, `${narrow.k} ${kW}`);
});

test('PDF の画面のページ: 縦に長い画面は（1/n）のページに分割し、設定一覧は画面の後のページ。表紙は範囲、countOnly と同じ数、同じ id はない', async (t) => {
  const { app, api, d, parse } = await boot(t);
  fakeMeasure(app);
  const doc = api.exportDocument(d, api.store.state, OPTS);
  const pages = doc.pages.map(parse);
  const heads = pages.map(headOf);
  const tiles = heads.filter((h) => /^1　点検記録の入力（\d+\/\d+）$/.test(h));
  const n = tiles.length;
  assert.ok(n >= 3, heads.join(' / '));
  tiles.forEach((h, i) => assert.equal(h, `1　点検記録の入力（${i + 1}/${n}）`));
  // 表紙・画面のページ n 枚・設定一覧（1 ページ以上）・点検記録の確認
  assert.equal(heads[n + 1], '1　点検記録の入力　設定一覧');
  assert.equal(heads[heads.length - 1], '2　点検記録の確認');
  const tableStart = n + 2; // 設定一覧の最初のページの番号（表紙が 1 ページ目）
  pages.slice(1, n + 1).forEach((p) => {
    const sub = subOf(p);
    const pct = Number((sub.match(/・(\d+)% に縮小/) || [])[1]);
    assert.ok(pct >= 60, sub);
    assert.match(sub, new RegExp(`・設定一覧（${tableStart} ページ）$`));
    assert.equal(p.querySelector('.ptable'), null, '画面のページに設定一覧を置かない');
  });
  // どの画面のページも同じ倍率
  const zooms = pages.slice(1, n + 1).map((p) => p.querySelector('.xp-stage > div').style.zoom);
  assert.equal(new Set(zooms).size, 1, zooms.join(','));
  // 吹き出しは 1 回ずつ描き、k1 は最後の画面のページに描く
  const texts = pages.slice(1, n + 1).map((p) => [...p.querySelectorAll('.callout')].map((c) => c.textContent));
  assert.deepEqual(plain(texts.flat()).sort(), ['最後の点検項目の書き方。', '測定値は数字だけを入れる。', '点検の手順は別紙。'].sort());
  assert.ok(texts[n - 1].includes('最後の点検項目の書き方。'), JSON.stringify(texts));
  // 下の端の番号は通し番号。表紙の画面の一覧は範囲
  const foot = pages.slice(1).map((p) => p.querySelector('.pg-foot span:last-child').textContent);
  foot.forEach((f, i) => assert.equal(f, `${i + 2} / ${doc.total}`));
  const cover = [...pages[0].querySelectorAll('.cv-list tbody tr')].map((tr) => tr.querySelector('.no').textContent);
  assert.deepEqual(plain(cover), [`2〜${doc.total - 1}`, String(doc.total)]);
  assert.equal(api.exportDocument(d, api.store.state, { ...OPTS, countOnly: true }).total, doc.total);
  // 矢印の印の id は、ページごとに違う
  const ids = [...doc.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((v, i) => ids.indexOf(v) !== i), []);
});

test('PDF の画面のページ: 設定一覧を付けないときも、縦に長い画面は分割する。測れないとき（jsdom）は分割しない', async (t) => {
  const { app, api, d, parse } = await boot(t);
  const before = api.exportDocument(d, api.store.state, { ...OPTS, cover: false });
  assert.deepEqual(plain(before.pages.map((h) => headOf(parse(h)))), ['1　点検記録の入力', '2　点検記録の確認']);
  fakeMeasure(app);
  const doc = api.exportDocument(d, api.store.state, { ...OPTS, cover: false, settings: false });
  const heads = doc.pages.map((h) => headOf(parse(h)));
  assert.ok(heads.length >= 4, heads.join(' / '));
  assert.ok(heads.slice(0, -1).every((h) => /^1　点検記録の入力（\d+\/\d+）$/.test(h)), heads.join(' / '));
  assert.ok(!heads.some((h) => h.includes('設定一覧')));
  assert.ok(!doc.pages.slice(0, -1).some((h) => subOf(parse(h)).includes('設定一覧')));
});

test('get_screen_image: 縦に長い画面は返事に areas が付き、area を書くと、その範囲（設定一覧なし）を返す。範囲の外の番号は断る', async (t) => {
  const { call } = await boot(t);
  const whole = await call('get_screen_image', { design: '設備点検記録', screen: '点検記録の入力' });
  assert.equal(whole.ok, true);
  const n = whole.result.areas;
  assert.ok(n >= 2, JSON.stringify(whole.result));
  assert.equal(whole.result.area, undefined);
  const two = await call('get_screen_image', { design: '設備点検記録', screen: '点検記録の入力', area: 2, withTable: true });
  assert.equal(two.ok, true);
  assert.deepEqual([two.result.areas, two.result.area, two.result.withTable], [n, 2, true]);
  assert.match(two.render.html, new RegExp(`<title>設備点検記録 ／ 点検記録の入力（範囲 2/${n}）</title>`));
  assert.doesNotMatch(two.render.html, /class="ptable/);
  assert.ok(two.render.height <= 1566 && two.render.width <= 1566, `${two.render.width} × ${two.render.height}`);
  const over = await call('get_screen_image', { design: '設備点検記録', screen: '点検記録の入力', area: n + 1 });
  assert.match(over.error.message, new RegExp(`この画面の範囲は ${n} 個です`));
  // 範囲に分割しない画面は、area は 1 だけ
  const small = await call('get_screen_image', { design: '設備点検記録', screen: '点検記録の確認' });
  assert.equal(small.result.areas, undefined);
  const bad = await call('get_screen_image', { design: '設備点検記録', screen: '点検記録の確認', area: 2 });
  assert.match(bad.error.message, /この画面は範囲に分割しないので、area は 1 だけです/);
});
