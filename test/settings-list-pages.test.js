'use strict';
// 設定一覧の載せ方（q138。仕様_細かい決めごと.md の「設定一覧の載せ方の細かい決めごと」）のテスト。
// 設定一覧の文から、項目一覧とステータスの流れにも載る文（項目のメモ・全部のステータスと操作）を外して、載っているページを書くこと。
// PDF で、設定一覧の高さのせいで画面が縮む画面だけ、設定一覧を次のページへ分けること（jsdom では大きさを測れないので、測る関数を差し替える）。
// 画面設計の名前は架空の業務（備品購入申請）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const STORAGE_KEY = 'mockimagemaker.v1';
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── 見本（架空の業務）──
const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, y, no, itemId) => ({ id, type: 'text1', x: 32, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const STATES = [{ id: 'sa', name: '申請' }, { id: 'sb', name: '承認待ち' }, { id: 'sc', name: '完了' }];
const ACTIONS = [
  { id: 'a1', name: '申請する', from: 'sa', to: 'sb', role: '申請者', cond: '' },
  { id: 'a2', name: '承認する', from: 'sb', to: 'sc', role: '上長', cond: '金額が 10 万円未満' },
];
function sampleState({ extraItems = 0 } = {}) {
  const many = Array.from({ length: extraItems }, (_, i) => item(`x${i}`, `追加の項目 ${i + 1}`, 'text1'));
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [{
      id: 'd1', name: '備品購入申請', target: 'kintone', description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      trashedAt: null, revisions: [], mapPos: {},
      items: [
        item('st', 'ステータス', 'status', { props: { states: STATES, actions: ACTIONS } }),
        ...many,
        item('i1', '品名', 'text1', { required: true, memo: '型番まで書いてもらう。' }),
        item('i2', '数量', 'text1', { props: { maxLen: '10' } }),
      ],
      screens: [
        screen('s1', '購入申請の入力', [
          { id: 'p0', type: 'steps', x: 32, y: 56, w: 560, h: 40, no: 1, labelPos: 'top', sample: '', placeholder: '', itemId: 'st', view: { current: 'sb', showWord: true } },
          ipart('p1', 112, 2, 'i1'),
          ipart('p2', 200, 3, 'i2'),
          { id: 'b1', type: 'button', x: 32, y: 300, w: 96, h: 40, no: 4, labelPos: 'top', sample: '', placeholder: '', label: '申請する', required: false, memo: '差し戻しのときだけ出す。', props: {} },
        ]),
        screen('s2', '申請の詳細', [ipart('p3', 112, 1, 'i2')]),
      ],
    }],
  };
}

async function boot(t, state = sampleState()) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const api = await app.api();
  t.after(() => app.close());
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  const parse = (h) => new app.window.DOMParser().parseFromString(h, 'text/html');
  return { app, api, d, parse };
}
const OPTS = { paper: 'A4', orient: 'landscape', cover: false, map: false, items: true, process: true, flow: false };
// 画面のページの設定一覧の「設定」の列の文（番号 → 文）
const settingsOf = (page) => Object.fromEntries([...page.querySelectorAll('.ptable tbody tr')].map((tr) => [tr.children[0].textContent.trim(), tr.children[3].textContent]));

// 大きさを測る関数の身代わり（test/export.test.js と同じ形）。本文は 1000×600。設定一覧の表の高さは「40 ＋ 行の数 × 280000 ÷ 幅」。ほかの要素は 100×20
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

test('PDF の設定一覧: 項目のメモと全部のステータス・操作は、載っているページを書く。ボタンのメモと、ほかの設定は残す', async (t) => {
  const { api, d, parse } = await boot(t);
  const doc = api.exportDocument(d, api.store.state, OPTS);
  // 1 項目一覧・2 ステータスの流れ・3 購入申請の入力・4 申請の詳細
  assert.equal(doc.total, 4);
  const set = settingsOf(parse(doc.pages[2]));
  assert.equal(set['1'], 'ステータス＝承認待ち（この画面で見せるステータス）\n全部のステータス 3 個と操作 2 個は「ステータスの流れ」（2 ページ）');
  assert.equal(set['2'], '必須\nメモは項目一覧（1 ページ）');
  assert.equal(set['3'], '最大 10 文字', 'メモのない項目は、そのまま');
  assert.match(set['4'], /差し戻しのときだけ出す。$/, '項目のないアイテム（ボタン）のメモは残す');
  // 項目一覧とステータスの流れのページは、今までどおり全文
  const items = parse(doc.pages[0]).body.textContent;
  assert.match(items, /型番まで書いてもらう。/);
  assert.match(items, /操作「承認する」＝承認待ちから完了へ（上長）・金額が 10 万円未満/);
});

test('PDF の設定一覧: 出力のウィンドウで項目一覧・ステータスの流れのページを外すと、その分は全文のまま。PNG はいつも全文', async (t) => {
  const { api, d, parse } = await boot(t);
  const noItems = settingsOf(parse(api.exportDocument(d, api.store.state, { ...OPTS, items: false }).pages[1]));
  assert.equal(noItems['2'], '必須\n型番まで書いてもらう。');
  assert.match(noItems['1'], /全部のステータス 3 個と操作 2 個は「ステータスの流れ」（1 ページ）$/);
  const noProc = settingsOf(parse(api.exportDocument(d, api.store.state, { ...OPTS, process: false }).pages[1]));
  assert.match(noProc['1'], /^ステータス＝申請 → 承認待ち → 完了\n操作「申請する」＝申請から承認待ちへ（申請者）/);
  assert.equal(noProc['2'], '必須\nメモは項目一覧（1 ページ）');
  const png = parse(api.exportPngDocs(d, api.store.state)[0].html);
  const full = settingsOf(png);
  assert.equal(full['2'], '必須\n型番まで書いてもらう。');
  assert.match(full['1'], /操作「承認する」/);
});

test('PDF の設定一覧: メモの行は、その項目の行がある項目一覧のページを書く（項目一覧が 2 ページになるとき）', async (t) => {
  const { app, api, parse } = await boot(t, sampleState({ extraItems: 40 }));
  fakeMeasure(app);
  const d = api.store.state.designs.find((x) => x.id === 'd1');
  const doc = api.exportDocument(d, api.store.state, { ...OPTS, process: false });
  const heads = doc.pages.map((h) => parse(h).querySelector('.pg-head h2').textContent);
  assert.deepEqual(plain(heads.slice(0, 2)), ['項目一覧', '項目一覧（続き）']);
  const page = doc.pages.map(parse).find((p) => p.querySelector('.pg-head h2').textContent === '2　申請の詳細');
  assert.equal(settingsOf(page)['1'], '最大 10 文字');
  const first = doc.pages.map(parse).find((p) => /^1　購入申請の入力/.test(p.querySelector('.pg-head h2').textContent));
  assert.ok(first);
  // 品名はステータスと追加の項目 40 個の後ろなので、項目一覧の 2 ページ目にある
  const all = doc.pages.join('\n');
  assert.match(all, /メモは項目一覧（2 ページ）/);
});

test('PDF の画面のページ: 設定一覧の高さで画面が縮む画面だけ分ける。表紙の画面の一覧は範囲、下の端は通し番号。countOnly と pageStart でも同じ数', async (t) => {
  const { app, api, d, parse } = await boot(t);
  fakeMeasure(app);
  const opts = { ...OPTS, cover: true };
  const doc = api.exportDocument(d, api.store.state, opts);
  const pages = doc.pages.map(parse);
  const heads = pages.map((p) => p.querySelector('.pg-head h2') && p.querySelector('.pg-head h2').textContent);
  // 表紙・項目一覧・ステータスの流れ・購入申請の入力（行 4 つで縮むので分ける）・その設定一覧・申請の詳細（行 1 つ）
  assert.deepEqual(plain(heads.slice(1)), ['項目一覧', 'ステータスの流れ', '1　購入申請の入力', '1　購入申請の入力　設定一覧', '2　申請の詳細']);
  assert.equal(doc.total, 6);
  assert.equal(pages[3].querySelector('.ptable'), null);
  assert.equal(pages[4].querySelectorAll('table.xp-itable tbody tr').length, 4);
  assert.match(pages[4].querySelector('.pg-head span').textContent, /^番号 1〜4$/);
  // 分けたページの文も、置き換えた文（本当の番号）
  assert.match(pages[4].body.textContent, /全部のステータス 3 個と操作 2 個は「ステータスの流れ」（3 ページ）/);
  assert.match(pages[4].body.textContent, /メモは項目一覧（2 ページ）/);
  assert.ok(pages[5].querySelector('.ptable'), '行の少ない画面は同じページのまま');
  assert.deepEqual(plain(pages.slice(1).map((p) => p.querySelector('.pg-foot span:last-child').textContent)), ['2 / 6', '3 / 6', '4 / 6', '5 / 6', '6 / 6']);
  const cover = [...pages[0].querySelectorAll('.cv-list tbody tr')].map((tr) => tr.querySelector('.no').textContent);
  assert.deepEqual(plain(cover), ['2', '3', '4〜5', '6']);
  assert.equal(api.exportDocument(d, api.store.state, { ...opts, countOnly: true }).total, 6);
  const later = api.exportDocument(d, api.store.state, { ...opts, pageStart: 500, grandTotal: 999 });
  assert.equal(later.total, 6);
  assert.match(later.pages.join('\n'), /メモは項目一覧（501 ページ）/);
});
