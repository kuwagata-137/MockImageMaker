'use strict';
// ダッシュボードのグラフ（第 15 段階。画像 q124）のテスト。グラフの種類 4 つ（積み上げ棒・じょうご・メーター・大きな数字）の
// 描き方・右のパネル（種類ごとに出す欄）・設定一覧・今のグラフの種類を変えないこと。
// 画面設計の名前は架空の業務（営業管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const partEl = (app, id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function choose(app, key, value) {
  const el = $(app, `#side-settings [data-pf="${key}"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

async function bootGraph(t, props = {}) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const did = api.actions.createDesign('営業管理', 'other');
  api.openDesign(did);
  const sid = api.currentScreen().id;
  const id = api.actions.addPart(did, sid, 'graph', { x: 64, y: 56 });
  const update = (patch) => api.actions.updatePart(did, sid, id, patch);
  if (Object.keys(props).length) update({ props });
  const part = () => api.currentScreen().parts.find((p) => p.id === id);
  return { app, api, did, sid, id, part, update, el: () => partEl(app, id) };
}

test('グラフの種類: 今の 4 つの後ろに 積み上げ棒・じょうご・メーター・大きな数字。目標の値と凡例の名前の欄は空の文字', async (t) => {
  const { app, api, id, part } = await bootGraph(t);
  assert.deepEqual(plain([part().props.target, part().props.series]), ['', '']);
  api.selectPart(id);
  const values = $$(app, '#side-settings [data-pf="props.chart"]').map((r) => r.value);
  assert.deepEqual(values, ['bar', 'hbar', 'line', 'pie', 'stacked', 'funnel', 'gauge', 'metric']);
});

test('大きな数字: 1 行目の値を桁の区切りを付けて大きく出し、値の単位を小さく出す（分類の名前は出さない）', async (t) => {
  const { el, update } = await bootGraph(t, { chart: 'metric', samples: '今月の受注額, 1280\n先月, 900', unit: '万円' });
  assert.equal(el().querySelector('.pmetric b').textContent, '1,280');
  assert.equal(el().querySelector('.pmetric span').textContent, '万円');
  assert.ok(!el().textContent.includes('今月の受注額'));
  update({ props: { unit: '', samples: '受注率, 32.5%' } });
  assert.equal(el().querySelector('.pmetric b').textContent, '32.5');
  assert.equal(el().querySelector('.pmetric span'), null, '単位が空なら出さない');
  update({ props: { samples: '' } });
  assert.match(el().querySelector('.pgraph').textContent, /サンプル値を書くと、グラフが出ます/);
});

test('メーター: 3 つの色の帯・針・値と単位・目標の文。目標の値が数でないときは目標の文を出さない', async (t) => {
  const { el, update } = await bootGraph(t, { chart: 'gauge', samples: '今期の受注額, 3,840', target: '5,000', unit: '万円' });
  const svg = () => el().querySelector('.pgraph svg');
  assert.deepEqual([...svg().querySelectorAll('path')].map((p) => p.getAttribute('fill')), ['#ef4444', '#f59e0b', '#10b981']);
  assert.ok(svg().querySelector('line'), '針');
  assert.equal(svg().querySelector('.pg-value').textContent, '3,840 万円');
  assert.ok([...svg().querySelectorAll('text')].some((x) => x.textContent === '目標 5,000 万円 の 77%'));
  assert.ok([...svg().querySelectorAll('text')].some((x) => x.textContent === '5,000'), '右の端は目標の値');
  update({ props: { target: '' } });
  assert.ok(![...svg().querySelectorAll('text')].some((x) => /目標/.test(x.textContent)));
  assert.ok([...svg().querySelectorAll('text')].some((x) => x.textContent === '4,000'), '目標がないときは右の端をきりのよい数にする');
});

test('じょうご: 1 行ごとに 1 段の台形。左に分類、帯の中に値。幅は値に合わせて細くなる', async (t) => {
  const { el } = await bootGraph(t, { chart: 'funnel', samples: '見込み, 24\n提案, 16\n見積, 11\n交渉, 7\n受注, 4' });
  const svg = el().querySelector('.pgraph svg');
  const paths = [...svg.querySelectorAll('path')];
  assert.equal(paths.length, 5);
  const width = (p) => { const n = p.getAttribute('d').match(/[\d.]+/g).map(Number); return n[2] - n[0]; };
  assert.ok(paths.every((p, i) => !i || width(p) < width(paths[i - 1])), '上の段ほど広い');
  const texts = [...svg.querySelectorAll('text')].map((x) => x.textContent);
  assert.deepEqual(texts.filter((_, i) => i % 2 === 0), ['見込み', '提案', '見積', '交渉', '受注']);
  assert.deepEqual(texts.filter((_, i) => i % 2 === 1), ['24', '16', '11', '7', '4']);
});

test('積み上げ棒: 1 行に「分類, 値1, 値2…」で、1 本の棒を色で分けて積む。凡例の名前は 1 行に 1 つ（足りない値は「値 N」）', async (t) => {
  const { el, update } = await bootGraph(t, { chart: 'stacked', samples: '5月, 120, 80\n6月、180、60\n7月\t150\t110万円\nメモの行', series: '新規\n既存', unit: '万円' });
  const svg = () => el().querySelector('.pgraph svg');
  const rects = () => [...svg().querySelectorAll('rect')];
  // 棒 3 本 × 2 色と、凡例の四角 2 つ
  assert.equal(rects().length, 8);
  const texts = () => [...svg().querySelectorAll('text')].map((x) => x.textContent);
  assert.ok(['5月', '6月', '7月', '新規', '既存', '（万円）'].every((s) => texts().includes(s)), texts().join('|'));
  assert.ok(!texts().includes('メモの行'), '値のない行は描かない');
  update({ props: { series: '新規', samples: '5月, 1, 2, 3' } });
  assert.ok(['新規', '値 2', '値 3'].every((s) => texts().includes(s)));
});

test('今のグラフの種類（棒・横棒・折れ線・円）の描き方は変わらない（今の読み方で「1,200」は 1 つの値）', async (t) => {
  const { el, update } = await bootGraph(t, { chart: 'bar', samples: '4月, 1,200\n5月, 800' });
  const bars = [...el().querySelectorAll('.pgraph svg rect')];
  assert.equal(bars.length, 2);
  update({ props: { chart: 'pie' } });
  assert.equal(el().querySelectorAll('.pgraph svg path').length, 2);
});

test('右のパネル: 種類のボタンは 8 つ（3 つずつの段）。大きな数字とメーターは「分類する項目」を出さず、メーターだけ目標の値、積み上げ棒だけ凡例の名前', async (t) => {
  const { app, api, id, part } = await bootGraph(t);
  api.selectPart(id);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  const labels = $$(app, '#side-settings .seg.grid3 [data-pf="props.chart"]').map((r) => r.nextElementSibling.textContent);
  assert.deepEqual(labels, ['棒', '横棒', '折れ線', '円', '積み上げ棒', 'じょうご', 'メーター', '大きな数字']);
  assert.ok(side('[data-pf="props.byItem"]'));
  assert.equal(side('[data-pf="props.target"]'), null);
  assert.equal(side('[data-pf="props.series"]'), null);
  choose(app, 'props.chart', 'gauge');
  assert.equal(part().props.chart, 'gauge');
  assert.equal(side('[data-pf="props.byItem"]'), null);
  assert.ok(side('[data-pf="props.target"]'));
  assert.match(side('[data-pf="props.samples"]').closest('.field').textContent, /1 行目の「名前, 値」が今の値/);
  setValue(side('[data-pf="props.target"]'), '5,000');
  assert.equal(part().props.target, '5,000');
  assert.match(side('#pf-out').textContent, /グラフ＝メーター/);
  assert.match(side('#pf-out').textContent, /目標の値＝5,000/);
  choose(app, 'props.chart', 'stacked');
  assert.ok(side('[data-pf="props.series"]'));
  assert.ok(side('[data-pf="props.byItem"]'));
  setValue(side('[data-pf="props.series"]'), '新規\n既存');
  assert.equal(part().props.series, '新規\n既存', '凡例の名前は 1 行に 1 つの文字のまま持つ');
  assert.match(side('#pf-out').textContent, /凡例＝新規・既存/);
  choose(app, 'props.chart', 'metric');
  assert.equal(side('[data-pf="props.byItem"]'), null);
  assert.equal(side('[data-pf="props.series"]'), null);
});

test('目標の値と凡例の名前は、保存して読み直しても残る（文字のまま）', async (t) => {
  const { app, api, did, part } = await bootGraph(t, { chart: 'stacked', series: '新規\n既存', target: '5000' });
  const st = plain(api.store.state);
  const again = bootApp({ localStorage: { [api.STORAGE_KEY]: JSON.stringify(st) } });
  const T = await again.api();
  t.after(() => again.close());
  const p = T.store.state.designs.find((d) => d.id === did).screens[0].parts.find((x) => x.id === part().id);
  assert.deepEqual(plain([p.props.chart, p.props.series, p.props.target]), ['stacked', '新規\n既存', '5000']);
  assert.ok(app);
});
