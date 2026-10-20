'use strict';
// 今の画面設計の PDF のページが、第 10 段階の後半の直し（exportDocument に通し番号・矢印の印の id の頭・枚数だけを数える形を足した）の前と
// 1 字も変わらないことを確かめる。見本は、直す前のコードで exportDocument のページ（pages。APP_STYLE が入る html は比べない）の sha256 を取った値。
// 見本の画面設計は架空の業務（顧客管理・住所の共通項目・取引先マスタ・受注管理）で、つながり・ステータスの操作・移る先・違いの印の版を持つ。
// 日時の表示（最終更新・版の日付）は時差で変わるので、時差を日本に決めてから起動する。
// 出力のページの見た目をわざと変えたときは、この値を書き直す（変えた理由を開発記録に書く）。
process.env.TZ = 'Asia/Tokyo';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { bootApp } = require('./harness');

const STORAGE_KEY = 'mockimagemaker.v1';
const EXPORTED_AT = '2026-10-20T00:00:00.000Z';
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId) => ({ id, type: 'text1', x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const design = (id, name, target, extra = {}) => ({
  id, name, target, description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: null, revisions: [], items: [], screens: [screen('s-' + id, '一覧')], mapPos: {}, ...extra,
});
function sampleState() {
  const d1 = design('d1', '顧客管理', 'kintone', {
    description: '取引先と顧客の連絡先を管理する。',
    updatedAt: '2026-10-05T02:30:00.000Z',
    items: [
      item('i1', '顧客コード', 'text1', { required: true }),
      item('i2', '取引先コード', 'text1', { lookup: { db: { designId: 'd3', name: '取引先マスタ', free: false }, key: { itemId: 'b1', name: '取引先コード' }, copies: [{ from: { itemId: 'b2', name: '取引先名' }, to: { itemId: 'i3', name: '取引先名' } }] } }),
      item('i3', '取引先名', 'text1'),
      item('i4', '郵便番号', 'text1', { link: { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false } }),
      item('i5', 'ステータス', 'status', { props: {
        states: [{ id: 't1', name: '申請' }, { id: 't2', name: '承認待ち' }, { id: 't3', name: '完了' }],
        actions: [
          { id: 'x1', name: '申請する', from: 't1', to: 't2', role: '担当者', cond: '' },
          { id: 'x2', name: '承認する', from: 't2', to: 't3', role: '上長', cond: '' },
          { id: 'x3', name: '差し戻す', from: 't2', to: 't1', role: '上長', cond: '書き直してほしいとき' },
        ],
      } }),
    ],
    screens: [
      screen('s1', '詳細', [ipart('p1', 32, 112, 1, 'i1'), ipart('p2', 32, 200, 2, 'i2'), ipart('p3', 32, 288, 3, 'i3'), ipart('p4', 400, 112, 4, 'i4')], {
        callouts: [{ id: 'k1', x: 1300, y: 100, w: 200, h: 80, text: '取引先コードで取引先名を引く。', color: 'yellow', tip: 'arrow', target: 'p2' }],
      }),
      screen('s2', '新規登録', [ipart('p5', 32, 112, 1, 'i1'),
        { id: 'p6', type: 'button', x: 32, y: 200, w: 96, h: 40, no: 2, label: '保存', props: { style: 'primary', action: '', to: 'screen', designId: '', screenId: 's1', url: '' } }]),
    ],
  });
  // 違いの印で比べる第 1 版（p4 の郵便番号がなく、説明が違う）
  const snap = JSON.parse(JSON.stringify({ ...d1, revisions: undefined }));
  delete snap.revisions;
  snap.description = '顧客の連絡先を管理する。';
  snap.screens[0].parts = snap.screens[0].parts.filter((p) => p.id !== 'p4');
  d1.revisions = [{ id: 'r1', kind: 'revision', no: 1, date: '2026-10-02T03:00:00.000Z', note: '最初の版', snapshot: snap, changes: null, baseNo: null }];
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    systems: [],
    designs: [
      d1,
      design('d2', '住所の共通項目', 'その他の作る先', { items: [item('a1', '郵便番号', 'text1', { props: { maxLen: '8' } })] }),
      design('d3', '取引先マスタ', 'kintone', { items: [item('b1', '取引先コード', 'text1'), item('b2', '取引先名', 'text1')] }),
      design('d4', '受注管理', 'kintone', {
        items: [item('e1', '顧客コード', 'text1', { lookup: { db: { designId: 'd1', name: '顧客管理', free: false }, key: { itemId: 'i1', name: '顧客コード' }, copies: [] } })],
      }),
    ],
  };
}

const ALL = { cover: true, map: true, items: true, process: true, flow: true };
const CASES = [
  ['顧客管理・A4 横・全部', 'd1', { paper: 'A4', orient: 'landscape', ...ALL }],
  ['顧客管理・A3 縦・全部', 'd1', { paper: 'A3', orient: 'portrait', ...ALL }],
  ['顧客管理・スライド・表紙なし', 'd1', { paper: 'slide', orient: 'landscape', ...ALL, cover: false }],
  ['顧客管理・A4 横・第 1 版との違いの印', 'd1', { paper: 'A4', orient: 'landscape', ...ALL, diffRevId: 'r1' }],
  ['顧客管理・A4 横・画面 1 つだけ', 'd1', { paper: 'A4', orient: 'landscape', ...ALL, screenIds: ['s2'] }],
  ['受注管理・A4 横・全部', 'd4', { paper: 'A4', orient: 'landscape', ...ALL }],
];
// 直す前のコード（0fd1bde）で取った値。{ total, sha }
const GOLDEN = {
  '顧客管理・A4 横・全部': { total: 7, sha: '470345ee0568e28616847484f389b4d0952b0957bb39b04e5bf9ff6132080ce7' },
  '顧客管理・A3 縦・全部': { total: 7, sha: '367ca9e6d530f60b5fcbf0f5188794499f4898149b8b823d91db7984a3da8fb4' },
  '顧客管理・スライド・表紙なし': { total: 6, sha: '9d51de731edbd75fee34d6e0cedc1563564f0f82c4ce169bc1c221deab26425d' },
  '顧客管理・A4 横・第 1 版との違いの印': { total: 8, sha: '5666a4b356406e389456fe7e35ed6ab2e4fa307520312447b8e3f91992321bc7' },
  '顧客管理・A4 横・画面 1 つだけ': { total: 6, sha: '928f8b79108af7e91dc00bacb795ba9ebaceafecbaad3f0c40c1bf58d8437710' },
  '受注管理・A4 横・全部': { total: 4, sha: '030309505da3eba6f7ab26102bc54b94ab4e9d6ef2f32f69eca1cbe8e9361241' },
};

async function boot(t) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  t.after(() => app.close());
  const api = await app.api();
  const d = (id) => api.store.state.designs.find((x) => x.id === id);
  const parse = (html) => new app.window.DOMParser().parseFromString(html, 'text/html');
  return { app, api, d, parse };
}

// システムの説明書（第 10 段階の後半）で、画面設計のページを説明書の途中に並べるための形: pageStart（最初のページの番号）・grandTotal（全体のページ数）・
// idTag（矢印の印の id の頭に足す字）・countOnly（ページを組まずに数だけ）
test('exportDocument の pageStart・grandTotal: 下の端の「n / N」・表紙の「全 N ページ」・表紙の一覧のページの番号が通し番号になる。戻り値の total はこの画面設計のページ数のまま', async (t) => {
  const { api, d, parse } = await boot(t);
  const doc = api.exportDocument(d('d1'), api.store.state, { paper: 'A4', orient: 'landscape', ...ALL, pageStart: 5, grandTotal: 20 }, EXPORTED_AT);
  assert.equal(doc.total, 7);
  assert.equal(doc.pages.length, 7);
  const cover = parse(doc.pages[0]);
  assert.match(cover.querySelector('.cv-foot').textContent, /全 20 ページ/);
  const listNos = [...cover.querySelectorAll('.cv-list tbody td.no')].map((x) => Number(x.textContent));
  assert.deepEqual(listNos, [6, 7, 8, 9, 10, 11], '表紙の一覧: つながりの図・項目の一覧表・ステータスの移り方・画面の移り方・画面 2 つ');
  const foots = [...doc.pages].slice(1).map((h) => parse(h).querySelector('.pg-foot span:last-child').textContent);
  assert.deepEqual(foots, ['6 / 20', '7 / 20', '8 / 20', '9 / 20', '10 / 20', '11 / 20']);
  // 表紙なし・違いの印つきでも、最初のページが pageStart
  const nc = api.exportDocument(d('d1'), api.store.state, { paper: 'A4', orient: 'landscape', ...ALL, cover: false, diffRevId: 'r1', pageStart: 3, grandTotal: 9 }, EXPORTED_AT);
  assert.equal(parse(nc.pages[0]).querySelector('.pg-foot span:last-child').textContent, '3 / 9');
  assert.equal(parse(nc.pages[nc.pages.length - 1]).querySelector('.pg-foot span:last-child').textContent, `${3 + nc.total - 1} / 9`);
});

test('exportDocument の idTag: つながりの図・ステータスの移り方・画面の移り方の矢印の印の id の頭に足す（既定は今のまま）', async (t) => {
  const { api, d } = await boot(t);
  const opts = { paper: 'A4', orient: 'landscape', ...ALL };
  const tagged = api.exportDocument(d('d1'), api.store.state, { ...opts, idTag: '-d2' }, EXPORTED_AT).pages.join('\n');
  for (const head of ['xp-map-d2-arrow', 'xp-proc-d2-arrow', 'xp-flow-d2-arrow']) assert.ok(tagged.includes(head), head);
  assert.doesNotMatch(tagged, /xp-(map|proc|flow)-arrow/);
  const plainDoc = api.exportDocument(d('d1'), api.store.state, opts, EXPORTED_AT).pages.join('\n');
  for (const head of ['xp-map-arrow', 'xp-proc-arrow', 'xp-flow-arrow']) assert.ok(plainDoc.includes(head), head);
});

test('exportDocument の countOnly: ページを組まずに、全部組んだときと同じ total を返す', async (t) => {
  const { api, d } = await boot(t);
  for (const [label, id, opts] of CASES) {
    const full = api.exportDocument(d(id), api.store.state, opts, EXPORTED_AT);
    const cnt = api.exportDocument(d(id), api.store.state, { ...opts, countOnly: true }, EXPORTED_AT);
    assert.equal(cnt.pages, undefined, label);
    assert.equal(cnt.html, undefined, label);
    assert.equal(cnt.total, full.total, label);
    assert.equal(cnt.P.paper, full.P.paper, label);
  }
});

test('今の画面設計の PDF のページは、第 10 段階の後半の直しの前と 1 字も変わらない（ページの数と、ページの HTML の sha256）', async (t) => {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(sampleState()) } });
  t.after(() => app.close());
  const api = await app.api();
  const got = {};
  for (const [label, id, opts] of CASES) {
    const d = api.store.state.designs.find((x) => x.id === id);
    const doc = api.exportDocument(d, api.store.state, opts, EXPORTED_AT);
    got[label] = { total: doc.total, sha: sha(doc.pages.join('\n')) };
  }
  assert.deepEqual(got, GOLDEN, '見本の値: ' + JSON.stringify(got, null, 2));
});
