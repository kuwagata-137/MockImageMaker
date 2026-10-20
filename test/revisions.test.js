'use strict';
// 改訂履歴（第 6 段階）のテスト。改訂する（版の番号・写し・変更内容の一覧）、改訂履歴の窓（書き直す・消す）、前の版を見る（見るだけ）、
// 前の版に戻す（戻す前の状態・元に戻す・取り込んだ項目のつなぎ直し）、違いの判定（designDiff）、出力の違いの印（PDF・PNG・HTML）。
// jsdom では要素の大きさを測れないので、札の位置とページの縮め方は tools/shoot-app.js（--only=revisions）と tools/check-export.js で確かめる。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const STORAGE_KEY = 'mockimagemaker.v1';

// ── 見本（架空の業務）──
const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId, type = 'text1') => ({ id, type, x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const design = (id, name, target, extra = {}) => ({
  id, name, target, description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: null, revisions: [], items: [], screens: [screen('s-' + id, '一覧')], mapPos: {}, ...extra,
});
function sampleState() {
  return {
    schemaVersion: 2,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d1', '顧客管理', 'kintone', {
        description: '取引先と顧客の連絡先を管理する。',
        items: [
          item('i1', '顧客コード', 'text1', { required: true, props: { maxLen: '10', initial: '' } }),
          item('i2', '顧客名', 'text1', { props: { maxLen: '50', initial: '' } }),
          item('i3', '区分', 'dropdown', { props: { options: ['法人', '個人'], initial: '' } }),
          item('i4', '郵便番号', 'text1', { props: { maxLen: '8', initial: '' }, link: { designId: 'd2', itemId: 'a1', designName: '住所の共通項目', lost: false } }),
          item('i5', '備考', 'text2', { props: { maxLen: '', initial: '' } }),
        ],
        screens: [
          screen('s1', '新規登録', [ipart('p1', 32, 64, 1, 'i1'), ipart('p2', 32, 152, 2, 'i2'), ipart('p3', 400, 64, 3, 'i3', 'dropdown'), ipart('p4', 400, 152, 4, 'i4')], {
            callouts: [{ id: 'k1', x: 1300, y: 100, w: 200, h: 80, text: '顧客コードは自動で振る。', color: 'yellow', tip: 'arrow', target: 'p1' }],
          }),
        ],
      }),
      design('d2', '住所の共通項目', 'kintone', { items: [item('a1', '郵便番号', 'text1', { props: { maxLen: '8', initial: '' } })] }),
    ],
  };
}

function fakeExportAPI() {
  const calls = [];
  return {
    calls,
    saveHtml: async (p) => { calls.push(['saveHtml', p]); return { ok: true, path: '/tmp/' + p.name }; },
    savePdf: async (p) => { calls.push(['savePdf', p]); return { ok: true, path: '/tmp/' + p.name }; },
    savePng: async (p) => { calls.push(['savePng', p]); return { ok: true, count: p.files.length, path: '/tmp/' + p.files[0].name, dir: '/tmp' }; },
    openHtml: async () => ({ ok: false, canceled: true }),
  };
}

async function bootSample(t, { exportAPI = null, state = sampleState() } = {}) {
  const app = bootApp({ exportAPI, localStorage: { [STORAGE_KEY]: JSON.stringify(state) } });
  const api = await app.api();
  t.after(() => app.close());
  return { app, api };
}
const d1 = (api) => api.store.state.designs.find((d) => d.id === 'd1');
const real = (api) => (api.store.realState || api.store.state).designs.find((d) => d.id === 'd1');

// 第 1 版を作り、中身を変えてから第 2 版を作る
function makeTwoVersions(api) {
  const r1 = api.actions.addRevision('d1', { note: '最初の版。' });
  api.actions.updateItem('d1', 'i1', { required: false }); // 設定変更
  api.actions.movePart('d1', 's1', 'p2', { x: 32, y: 240, w: 320, h: 64 }); // 位置変更
  api.actions.movePart('d1', 's1', 'p3', { x: 400, y: 64, w: 480, h: 64 }); // 大きさ変更
  api.actions.deletePart('d1', 's1', 'p4'); // 削除
  const added = api.actions.addPart('d1', 's1', 'date', { x: 32, y: 400 }); // 追加
  const r2 = api.actions.addRevision('d1', { note: '日付を足した。' });
  return { r1, r2, added };
}

// ── 改訂する ──
test('改訂する: 版の番号・日付・変えた内容と、revisions を除いた写しを残す。カードの「最新の版」は第 1 版', async (t) => {
  const { api } = await bootSample(t);
  const id = api.actions.addRevision('d1', { note: '  最初の版。  ' });
  const d = d1(api);
  assert.equal(d.revisions.length, 1);
  const r = plain(d.revisions[0]);
  assert.equal(r.id, id);
  assert.equal(r.kind, 'revision');
  assert.equal(r.no, 1);
  assert.equal(r.note, '最初の版。', '前後の空白を取る');
  assert.equal(r.changes, null, '第 1 版には変更内容の一覧がない');
  assert.equal(r.baseNo, null);
  assert.equal(r.snapshot.revisions, undefined, '写しに改訂履歴は入れない');
  assert.deepEqual(r.snapshot.screens, plain(d.screens));
  assert.deepEqual(r.snapshot.items, plain(d.items));
  assert.equal(api.revisionLabel(d), '第 1 版');
  // 日付の欄に今日でない日を書くと、その日の昼の日時にする
  api.actions.addRevision('d1', { note: '', day: '2026-09-30' });
  const r2 = d1(api).revisions[1];
  assert.equal(r2.no, 2);
  const t2 = new Date(r2.date);
  assert.equal(`${t2.getFullYear()}-${String(t2.getMonth() + 1).padStart(2, '0')}-${String(t2.getDate()).padStart(2, '0')}`, '2026-09-30');
  assert.equal(api.revisionLabel(d1(api)), '第 2 版');
});

test('改訂する: ひとつ前の版と比べて、変更内容の一覧（設定変更・位置変更・大きさ変更・削除・追加・吹き出し）を残す', async (t) => {
  const { api } = await bootSample(t);
  api.actions.updateCallout('d1', 's1', 'k1', { text: '顧客コードは 10 桁。' });
  const { r2, added } = makeTwoVersions(api);
  const d = d1(api);
  const r = plain(d.revisions.find((x) => x.id === r2));
  assert.equal(r.no, 2);
  assert.equal(r.baseNo, 1);
  const by = (name, change) => r.changes.find((x) => x.name === name && x.change === change);
  assert.match(by('顧客コード', '設定変更').text, /条件：必須・最大 10 文字 → 最大 10 文字/);
  assert.equal(by('顧客名', '位置変更').text, '左 32・上 152 → 左 32・上 240');
  assert.equal(by('区分', '大きさ変更').text, '幅 320・高さ 64 → 幅 480・高さ 64');
  const del = by('郵便番号', '削除');
  assert.ok(del, '消した部品は「削除」の行');
  assert.equal(del.no, '（4）', '消した部品の番号は前の版のもの');
  assert.equal(del.k, 'del');
  const add = r.changes.find((x) => x.change === '追加' && x.k === 'add' && x.screen === '新規登録');
  assert.ok(add, '足した部品は「追加」の行');
  assert.equal(add.text, '日付を足した');
  assert.equal(add.no, String(d.screens[0].parts.find((p) => p.id === added).no));
  // 第 1 版の後に吹き出しの文字を変えたので、第 1 版の写しには前の文字がない（改訂する前に変えた）。ここでは第 2 版で変わっていない
  assert.ok(!r.changes.some((x) => /吹き出し/.test(x.name)), '吹き出しは第 1 版から変えていない');
});

test('改訂する: 版の番号は付け直さない。いちばん新しい版を消したときは、その番号をもう一度使う', async (t) => {
  const { api } = await bootSample(t);
  const a = api.actions.addRevision('d1', { note: '1' });
  const b = api.actions.addRevision('d1', { note: '2' });
  const c = api.actions.addRevision('d1', { note: '3' });
  api.actions.deleteRevision('d1', b);
  assert.deepEqual(plain(d1(api).revisions.map((r) => r.no)), [1, 3], '第 2 版を消しても第 3 版は第 3 版のまま');
  assert.equal(api.nextVersionNo(d1(api)), 4);
  api.actions.deleteRevision('d1', c);
  assert.equal(api.nextVersionNo(d1(api)), 2);
  assert.ok(a);
  // 元に戻すで、消した行が戻る
  api.store.undo();
  assert.deepEqual(plain(d1(api).revisions.map((r) => r.no)), [1, 3]);
});

test('改訂する: 書き直す（✎）は版の行の変えた内容と日付だけ。自動の行は書き直さない', async (t) => {
  const { api } = await bootSample(t);
  const id = api.actions.addRevision('d1', { note: '最初' });
  api.actions.updateRevision('d1', id, { note: '最初の版。見積もりを頼んだ。', day: '2026-09-28' });
  const r = d1(api).revisions[0];
  assert.equal(r.note, '最初の版。見積もりを頼んだ。');
  assert.equal(new Date(r.date).getDate(), 28);
  // 戻す前の状態（自動の行）は書き直さない
  api.actions.restoreRevision('d1', id);
  const auto = d1(api).revisions.find((x) => x.kind === 'restore');
  api.actions.updateRevision('d1', auto.id, { note: '書き換え' });
  assert.notEqual(d1(api).revisions.find((x) => x.kind === 'restore').note, '書き換え');
});

// ── 取り込んだ項目の固定（ロードマップの申し送り）──
test('写し: ほかのモックから取り込んだ項目は、改訂したときの中身で固定する（元が後で変わっても、写しは変わらない）', async (t) => {
  const { api } = await bootSample(t);
  const id = api.actions.addRevision('d1');
  api.actions.updateItem('d2', 'a1', { props: { maxLen: '10' } });
  const d = d1(api);
  assert.equal(d.items.find((x) => x.id === 'i4').props.maxLen, '10', '今の中身は元にそろう');
  assert.equal(d.revisions.find((x) => x.id === id).snapshot.items.find((x) => x.id === 'i4').props.maxLen, '8', '写しは改訂したときの中身のまま');
});

// ── 前の版を見る ──
test('前の版を見る: 編集の画面を写しで描き、上に黄色い帯。直す・元に戻す・保存はできない。見るのをやめると今の中身に戻る', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  const { r1 } = makeTwoVersions(api);
  const savedBefore = app.window.localStorage.getItem(STORAGE_KEY);
  click($(app, '#toolbar .fold-btn[data-fold="align"]')); // メニューバーのたたんだ組を出したまま見始めても、閉じる
  assert.equal(api.ui.foldMenu, 'align');
  assert.ok(api.startViewRevision(r1));
  assert.ok(api.store.isViewing);
  const band = $(app, '#rv-band');
  assert.equal(band.hidden, false);
  assert.match(band.textContent, /第 1 版（.+）を見ています/);
  // 第 1 版の中身（郵便番号の部品がある・日付の部品がない）で描く
  assert.ok($(app, '#stage .part[data-part-id="p4"]'), '第 1 版にあった部品を描く');
  assert.equal($$(app, '#stage .part').length, 4);
  assert.equal(api.currentDesign().items.find((x) => x.id === 'i1').required, true, '第 1 版では必須');
  // 直せない（mutateDesign が止まる）。メニューバーは拡大縮小などのほかは押せない
  assert.equal(api.actions.updateDesignInfo('d1', { description: '書き換え' }), false);
  assert.equal(api.currentDesign().description, '取引先と顧客の連絡先を管理する。');
  assert.equal($(app, '#toolbar [data-action="export"]').disabled, true);
  assert.equal($(app, '#toolbar [data-action="zoom-in"]').disabled, false);
  assert.equal(api.ui.foldMenu, null);
  assert.ok(!$(app, '#toolbar .rgroup[data-fold="align"]').classList.contains('open'));
  assert.ok(['align', 'items'].every((k) => $(app, `#toolbar .fold-btn[data-fold="${k}"]`).disabled), 'たたんだ組のボタンも押せない');
  assert.equal($(app, '#side-box').hidden, true, '部品の箱は出さない');
  assert.equal(api.store.canUndo(), false);
  assert.equal(api.runCommand('deletePart'), true);
  assert.match($(app, '#toast').textContent, /前の版を見ている間は、直せません/);
  // 部品を押すと選べて、右の欄で設定を見られる（欄は押せない）
  api.selectPart('p1');
  assert.ok($$(app, '#side-settings input').length > 0);
  assert.ok($$(app, '#side-settings input').every((x) => x.disabled), '右の欄の欄は押せない');
  assert.equal(app.window.localStorage.getItem(STORAGE_KEY), savedBefore, '見ている間は保存しない');
  // 見るのをやめる
  click($(app, '#rv-band [data-action="rev-stop-view"]'));
  assert.equal(api.store.isViewing, false);
  assert.equal($(app, '#rv-band').hidden, true);
  assert.equal(api.currentDesign().items.find((x) => x.id === 'i1').required, false, '今の中身に戻る');
  assert.ok(!$(app, '#stage .part[data-part-id="p4"]'));
  assert.equal($(app, '#toolbar [data-action="export"]').disabled, false, '見ている間に押せなくしたボタンが、また押せる');
  assert.equal($(app, '#toolbar [data-action="add-screen"]').disabled, false);
  assert.equal($(app, '#toolbar .fold-btn[data-fold="align"]').disabled, false);
  assert.equal($(app, '#side-box').hidden, false);
  assert.ok(api.actions.updateDesignInfo('d1', { description: '直せる' }));
});

test('前の版を見る: 見ている間に一覧へ戻ると、見るのをやめる（一覧は今の中身）', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  const { r1 } = makeTwoVersions(api);
  api.startViewRevision(r1);
  click($(app, '#toolbar [data-action="home"]'));
  assert.equal(api.store.isViewing, false);
  assert.equal(api.ui.view, 'home');
  assert.equal(api.store.state.designs.find((d) => d.id === 'd1').screens[0].parts.length, 4);
});

// ── 前の版に戻す ──
test('前の版に戻す: 今の中身を「戻す前の状態」として残してから置き換える。元に戻すでも戻り、その行からもう一度戻せる', async (t) => {
  const { api } = await bootSample(t);
  const { r1 } = makeTwoVersions(api);
  const before = plain(d1(api).screens);
  assert.ok(api.actions.restoreRevision('d1', r1));
  const d = d1(api);
  assert.equal(d.screens[0].parts.length, 4);
  assert.ok(d.screens[0].parts.some((p) => p.id === 'p4'), '第 1 版の部品が戻る');
  const auto = d.revisions[d.revisions.length - 1];
  assert.equal(auto.kind, 'restore');
  assert.equal(auto.no, null);
  assert.match(auto.note, /「第 1 版（.+）」に戻す前の状態/);
  assert.deepEqual(plain(auto.snapshot.screens), before, '戻す前の中身を写しに残す');
  assert.equal(api.revisionLabel(d), '第 2 版', '自動の行は「最新の版」に数えない');
  // 自動の行から、もう一度戻せる
  assert.ok(api.actions.restoreRevision('d1', auto.id));
  assert.deepEqual(plain(d1(api).screens), before);
  // 元に戻す（2 回）で、第 2 版の中身・行の数に戻る
  api.store.undo();
  api.store.undo();
  assert.deepEqual(plain(d1(api).screens), before);
  assert.equal(d1(api).revisions.length, 2);
});

test('前の版に戻す: 取り込んだ項目は、元のモックとつなぎ直して今の中身に合わせる（q43）。元がもうなければ写しの中身で固定する', async (t) => {
  const { api } = await bootSample(t);
  const id = api.actions.addRevision('d1');
  api.actions.unlinkItem('d1', 'i4'); // つながりを切った（この画面設計だけの項目になった）
  api.actions.updateItem('d2', 'a1', { props: { maxLen: '12' } });
  assert.equal(d1(api).items.find((x) => x.id === 'i4').link, null);
  api.actions.restoreRevision('d1', id);
  const it = d1(api).items.find((x) => x.id === 'i4');
  assert.equal(it.link.designId, 'd2', 'つながりが戻る');
  assert.equal(it.props.maxLen, '12', '元の今の中身に合わせる');
  // 元のモックを完全に削除してから戻すと、写しの中身で固定して「元なし」
  api.actions.restoreRevision('d1', id);
  api.actions.deleteDesignForever('d2');
  api.actions.restoreRevision('d1', id);
  const it2 = d1(api).items.find((x) => x.id === 'i4');
  assert.equal(it2.link.lost, true);
  assert.equal(it2.props.maxLen, '8', '写しの中身で固定');
});

test('前の版に戻す: 取り込む前の状態（自動の行）からも戻せる。写しがない行（HTML から足した画面設計）は戻せない', async (t) => {
  const state = sampleState();
  const snap = JSON.parse(JSON.stringify(state.designs[0]));
  delete snap.revisions;
  snap.description = '取り込む前の説明。';
  state.designs[0].revisions = [
    { id: 'r-old', kind: 'revision', no: 1, date: '2026-10-02T03:00:00.000Z', note: 'HTML から来た版', changes: null, baseNo: null },
    { id: 'r-imp', kind: 'import', no: null, date: '2026-10-05T03:00:00.000Z', note: '取り込む前の状態', snapshot: snap },
  ];
  const { api } = await bootSample(t, { state });
  assert.equal(api.actions.restoreRevision('d1', 'r-old'), false, '写しがない行は戻せない');
  assert.ok(api.actions.restoreRevision('d1', 'r-imp'));
  assert.equal(d1(api).description, '取り込む前の説明。');
});

// ── 違いの判定 ──
test('違い: 画面の追加・削除と画面の設定、画面に置いていない項目、吹き出しの追加・削除・変更を、変更内容の一覧に出す', async (t) => {
  const { api } = await bootSample(t);
  const base = api.designFromSnapshot(d1(api), { snapshot: plain(d1(api)) });
  api.actions.updateScreen('d1', 's1', { name: '登録', showHeader: false });
  const newScreen = api.actions.addScreen('d1', 'blank', 's1');
  api.actions.addItem('d1', 'number'); // どの画面にも置いていない項目
  api.actions.updateItem('d1', 'i5', { label: '備考欄' }); // 置いていない項目の名前
  api.actions.deleteCallout('d1', 's1', 'k1');
  api.actions.addCallout('d1', 's1', { x: 1300, y: 300 }, null);
  api.actions.updateDesignInfo('d1', { description: '説明を直した。' });
  const res = api.designDiff(base, d1(api), api.store.state);
  const rows = plain(res.rows);
  assert.ok(rows.some((x) => x.screen === '画面設計' && /説明：/.test(x.text)));
  const sc = rows.find((x) => x.change === '画面の設定変更');
  assert.match(sc.text, /画面の名前：新規登録 → 登録/);
  assert.match(sc.text, /帯：あり → なし/);
  assert.ok(rows.some((x) => x.change === '画面の追加' && x.k === 'add'));
  assert.equal(res.screens[newScreen].isNew, true);
  assert.ok(rows.some((x) => x.screen === 'データベースの項目' && x.change === '追加' && /数値/.test(x.text)));
  assert.ok(rows.some((x) => x.screen === 'データベースの項目' && x.change === '設定変更' && /項目名：備考 → 備考欄/.test(x.text)));
  assert.ok(rows.some((x) => /^吹き出し/.test(x.name) && x.change === '削除'));
  assert.ok(rows.some((x) => /^吹き出し/.test(x.name) && x.change === '追加'));
  assert.deepEqual(plain(res.counts), { new: 1, chg: 0, del: 1 }, '部品と吹き出しの数（吹き出し 1 つ足して 1 つ消した）');
  // 画面を消すと「画面の削除」
  api.actions.deleteScreen('d1', newScreen);
  api.actions.addScreen('d1', 'blank', 's1');
  const base2 = api.designFromSnapshot(d1(api), { snapshot: plain(d1(api)) });
  const sid = d1(api).screens[1].id;
  api.actions.deleteScreen('d1', sid);
  assert.ok(api.designDiff(base2, d1(api), api.store.state).rows.some((x) => x.change === '画面の削除'));
});

test('違い: 何も変えていなければ、変更内容の一覧は空。並べ替え（項目の順）だけでは違いにしない', async (t) => {
  const { api } = await bootSample(t);
  const base = api.designFromSnapshot(d1(api), { snapshot: plain(d1(api)) });
  api.actions.moveItem('d1', 'i5', 0);
  const res = api.designDiff(base, d1(api), api.store.state);
  assert.deepEqual(plain(res.rows), []);
  assert.deepEqual(plain(res.counts), { new: 0, chg: 0, del: 0 });
});

// ── メニューバーと窓 ──
test('メニューバー: 「改訂履歴」ボタンで改訂履歴の窓、▼ で「改訂する」「改訂履歴」のメニュー。アプリのメニューからも開く', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  assert.ok($(app, '#toolbar [data-action="open-revisions"]'));
  click($(app, '#toolbar [data-action="rev-menu"]'));
  const menu = $(app, '#rev-menu-root .rv-menu');
  assert.ok(menu, '▼ でメニューが開く');
  assert.deepEqual($$(app, '#rev-menu-root .rv-menu b').map((b) => b.textContent.replace(/^\S/, '').trim()), ['改訂する', '改訂履歴']);
  assert.match(menu.textContent, /第 1 版/);
  // 「改訂する」で窓が開く。第 1 版なので変更内容の一覧はない
  click($(app, '#rev-menu-root [data-action="add-revision"]'));
  await tick();
  assert.ok(!$(app, '#rev-menu-root .rv-menu'), 'メニューは閉じる');
  const m = $(app, '.modal');
  assert.match(m.querySelector('h2').textContent, /改訂する/);
  assert.match(m.textContent, /第 1 版/);
  assert.match(m.textContent, /第 1 版なので、変更内容の一覧はありません/);
  m.querySelector('[name="rv-note"]').value = '最初の版。';
  click(m.querySelector('[data-dlg="ok"]'));
  await waitFor(() => d1(api).revisions.length === 1);
  assert.equal(d1(api).revisions[0].note, '最初の版。');
  // 2 回目は、変更内容の一覧が出る
  api.actions.updateItem('d1', 'i2', { required: true });
  api.runCommand('addRevision');
  await tick();
  assert.match($(app, '.modal').textContent, /第 1 版と今の中身を比べて、自動で作りました・1 件/);
  assert.ok($(app, '.modal .cg-table'));
  click($(app, '.modal [data-dlg="cancel"]'));
  // 改訂履歴の窓（アプリのメニューの命令）
  api.runCommand('openRevisions');
  await tick();
  const h = $(app, '.modal');
  assert.match(h.querySelector('h2').textContent, /「顧客管理」の改訂履歴/);
  assert.equal(h.querySelector('[data-dlg="ok"]').hidden, true, '「閉じる」だけの窓');
  assert.equal(h.querySelector('[data-dlg="cancel"]').textContent, '閉じる');
  assert.equal($$(app, '.modal .rv-list tbody tr').length, 1);
  click($(app, '.modal [data-dlg="cancel"]'));
});

test('改訂履歴の窓: 新しい行が上。件数を押すと変更内容の一覧が開く。見る・戻す・書き直す・消すのボタン', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  const { r1, r2 } = makeTwoVersions(api);
  api.runCommand('openRevisions');
  await tick();
  const trs = $$(app, '.modal .rv-list tbody tr');
  assert.equal(trs[0].dataset.rev, r2, '新しい版が上');
  assert.equal(trs[1].dataset.rev, r1);
  assert.match(trs[1].textContent, /最初の版/);
  const cnt = trs[0].querySelector('[data-rv="toggle"]');
  assert.match(cnt.textContent, /5 件/);
  click(cnt);
  assert.ok($(app, '.modal tr.exp .cg-table'), '一覧が行の下に開く');
  assert.match($(app, '.modal tr.exp').textContent, /第 1 版からの変更内容/);
  click(cnt);
  assert.ok(!$(app, '.modal tr.exp'), 'もう一度押すと閉じる');
  // 書き直す
  click(trs[1].querySelector('[data-rv="edit"]'));
  await tick();
  const e = $(app, '.modal');
  assert.match(e.querySelector('h2').textContent, /「第 1 版」を書き直す/);
  e.querySelector('[name="rv-note"]').value = '書き直した。';
  click(e.querySelector('[data-dlg="ok"]'));
  await waitFor(() => d1(api).revisions[0].note === '書き直した。');
  // 書き直した後は、改訂履歴の窓がもう一度開く
  await waitFor(() => $(app, '.modal .rv-list'));
  // 見る
  click($(app, `.modal tr[data-rev="${r1}"] [data-rv="view"]`));
  await waitFor(() => api.store.isViewing);
  assert.equal(api.ui.viewRev, r1);
  assert.ok(!$(app, '.modal'));
  // 帯の「この版に戻す…」で確かめの窓（画面・項目の数）
  click($(app, '#rv-band [data-action="rev-restore-viewing"]'));
  await tick();
  const c = $(app, '.modal');
  assert.match(c.querySelector('h2').textContent, /第 1 版に戻す/);
  assert.match(c.textContent, /戻す前の状態/);
  click(c.querySelector('[data-dlg="ok"]'));
  await waitFor(() => !api.store.isViewing && d1(api).revisions.some((x) => x.kind === 'restore'));
  assert.ok(d1(api).screens[0].parts.some((p) => p.id === 'p4'));
});

test('改訂履歴の窓: 行を消す確かめの窓。写しのない行の「見る」「戻す」は押せない', async (t) => {
  const state = sampleState();
  state.designs[0].revisions = [{ id: 'r-old', kind: 'revision', no: 1, date: '2026-10-02T03:00:00.000Z', note: 'HTML から来た版', changes: null, baseNo: null }];
  const { app, api } = await bootSample(t, { state });
  api.openDesign('d1');
  api.runCommand('openRevisions');
  await tick();
  const tr = $(app, '.modal tr[data-rev="r-old"]');
  assert.equal(tr.querySelector('[data-rv="view"]').disabled, true);
  assert.equal(tr.querySelector('[data-rv="restore"]').disabled, true);
  click(tr.querySelector('[data-rv="delete"]'));
  await tick();
  assert.match($(app, '.modal h2').textContent, /「第 1 版（2026-10-02）」の行を消しますか/);
  click($(app, '.modal [data-dlg="ok"]'));
  await waitFor(() => real(api).revisions.length === 0);
  await waitFor(() => $(app, '.modal .rv-empty'));
  click($(app, '.modal [data-dlg="cancel"]'));
});

test('複製: 画面設計を複製しても、改訂履歴は写さない（部品の id を付け直すため）', async (t) => {
  const { api } = await bootSample(t);
  api.actions.addRevision('d1');
  const id = api.actions.duplicateDesign('d1');
  assert.deepEqual(plain(api.store.state.designs.find((d) => d.id === id).revisions), []);
});

// ── 出力の違いの印 ──
// 出力の窓で kind を選び、revId（比べる版）を渡したときは「違いの印」に印を付けて、その版を選ぶ
async function exportWith(app, api, kind, revId = null) {
  const done = api.openExportDialog('d1');
  await tick();
  const m = $(app, '.modal');
  click(m.querySelector(`[data-xkind="${kind}"]`));
  const box = m.querySelector(`[data-xbox="${kind}"]`);
  if (revId) {
    box.querySelector('[data-xdiff]').checked = true;
    box.querySelector('[data-xdiffrev]').value = revId;
  }
  click(m.querySelector('[data-dlg="ok"]'));
  return { res: await done, box };
}

test('出力: 版がないときは「違いの印」を押せない。版があれば、比べる版を選べる（新しい版が上）', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  api.openExportDialog('d1');
  await tick();
  ['pdf', 'html', 'png'].forEach((k) => {
    const xd = $(app, `.modal [data-xbox="${k}"] [data-xdiff]`);
    assert.ok(xd, `${k} に違いの印の欄`);
    assert.equal(xd.disabled, true);
  });
  assert.match($(app, '.modal [data-xbox="pdf"]').textContent, /まだ版がありません/);
  click($(app, '.modal [data-dlg="cancel"]'));
  makeTwoVersions(api);
  api.openExportDialog('d1');
  await tick();
  const opts = $$(app, '.modal [data-xbox="pdf"] [data-xdiffrev] option').map((o) => o.textContent);
  assert.equal(opts.length, 2);
  assert.match(opts[0], /^第 2 版/);
  click($(app, '.modal [data-dlg="cancel"]'));
});

test('出力（PDF）: 表紙の次に変更内容のページ。画面のページに札・違いの数・削除した部品。表紙の見出しは「改訂履歴」', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const { r1 } = makeTwoVersions(api);
  api.actions.addRevision('d1'); // 第 3 版（第 2 版と同じ中身）。比べる版は第 1 版を選ぶ
  const done = api.openExportDialog('d1');
  await tick();
  const box = $(app, '.modal [data-xbox="pdf"]');
  box.querySelector('[data-xdiff]').checked = true;
  box.querySelector('[data-xdiffrev]').value = r1;
  click($(app, '.modal [data-dlg="ok"]'));
  await done;
  const call = xapi.calls.find((c) => c[0] === 'savePdf');
  const doc = new app.window.DOMParser().parseFromString(call[1].html, 'text/html');
  const pages = [...doc.querySelectorAll('body > .pg')];
  assert.match(pages[0].textContent, /改訂履歴/);
  assert.match(pages[0].textContent, /第 1 版（.+）からの変更内容/, '表紙の画面の一覧に変更内容のページ');
  assert.match(pages[1].querySelector('.pg-head h2').textContent, /第 1 版（.+）からの変更内容/);
  assert.ok(pages[1].querySelector('.cg-k.del'), '変更内容の表に「削除」');
  const screenPage = pages.find((p) => p.querySelector('.xp-zone'));
  assert.ok(screenPage.querySelector('.part[data-part-id="p1"] .df-chg'), '設定を変えた部品に「変」');
  assert.ok(screenPage.querySelector('.part .df-new'), '足した部品に「新」');
  assert.match(screenPage.querySelector('.df-sum').textContent, /第 1 版（.+）との違い：新 1・変 3・削除 1/);
  assert.match(screenPage.querySelector('.df-del').textContent, /削除した部品（第 1 版にあって、今はない部品。番号は第 1 版のもの）/);
  assert.match(screenPage.querySelector('.df-del').textContent, /郵便番号/);
  assert.ok(screenPage.querySelector('.ptable .df-in.df-chg'), '一覧表の番号の前にも札');
});

test('出力（PNG）: 違いの印を選ぶと、画面ごとの画像に札と削除した部品が入る', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const { r1 } = makeTwoVersions(api);
  await exportWith(app, api, 'png', r1);
  const files = xapi.calls.find((c) => c[0] === 'savePng')[1].files;
  assert.match(files[0].html, /class="df df-new"/);
  assert.match(files[0].html, /削除した部品/);
});

test('出力（HTML）: 比べる版の写しだけを入れ、開いたときから札と帯（違いの数・変更内容の一覧・印を隠す）。直すと比べ直す', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const { r2 } = makeTwoVersions(api);
  await exportWith(app, api, 'html', r2);
  const html = xapi.calls.find((c) => c[0] === 'saveHtml')[1].html;
  const m = html.match(/<script type="application\/json" id="mim-embedded">([\s\S]*?)<\/script>/);
  const payload = JSON.parse(m[1]);
  assert.equal(payload.diffBase.title, '第 2 版');
  assert.ok(payload.diffBase.snapshot.screens);
  assert.ok(payload.data.designs[0].revisions.every((r) => !('snapshot' in r)), 'ほかの行の写しは入れない');
  assert.ok(Array.isArray(payload.data.designs[0].revisions[1].changes), '変更内容の一覧は入れる');
  // 単体で開く
  const sa = bootApp({ html, url: 'https://localhost/vendor/customer.html' });
  const sapi = await sa.api();
  t.after(() => sa.close());
  assert.match($(sa, '#sa-diff').textContent, /第 2 版（.+）との違い：新 0・変 0・削除 0/);
  sapi.actions.updateItem('d1', 'i2', { required: true });
  await waitFor(() => /変 1/.test($(sa, '#sa-diff').textContent));
  assert.ok($(sa, '#stage .part[data-part-id="p2"] .df-chg'), '直した部品に札');
  // 変更内容の一覧
  click($(sa, '[data-action="diff-list"]'));
  await tick();
  assert.match($(sa, '.modal h2').textContent, /第 2 版（.+）からの変更内容/);
  assert.match($(sa, '.modal').textContent, /条件：最大 50 文字 → 必須・最大 50 文字/);
  click($(sa, '.modal [data-dlg="cancel"]'));
  // 印を隠す・出す
  click($(sa, '[data-action="diff-toggle"]'));
  assert.ok(!$(sa, '#stage .df'), '札が消える');
  assert.equal($(sa, '#sa-diff-toggle').textContent, '印を出す');
  click($(sa, '[data-action="diff-toggle"]'));
  assert.ok($(sa, '#stage .df'));
  // 保存し直した HTML にも、比べる版を持ち回る
  const again = sapi.buildStandaloneHtml(sapi.currentDesign(), sapi.store.state);
  assert.match(again, /"diffBase":/);
  // 改訂履歴の窓は見るだけ（改訂する・見る・戻すはない）
  sapi.runCommand('openRevisions');
  await tick();
  assert.ok(!$(sa, '.modal [data-rv="add"]'));
  assert.ok(!$(sa, '.modal [data-rv="view"]'));
  click($(sa, '.modal [data-dlg="cancel"]'));
});

test('出力（HTML）: 違いの印を選ばなければ、写しも帯も入らない', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  makeTwoVersions(api);
  await exportWith(app, api, 'html');
  const html = xapi.calls.find((c) => c[0] === 'saveHtml')[1].html;
  assert.ok(!html.includes('"diffBase"'));
  assert.ok(!html.includes('"snapshot"'));
});

test('出力（HTML）: 版の後にルックアップ元の名前を変えても、開いた HTML で「変」にしない（比べる版の写しの名前の控えも今の名前に直す）', async (t) => {
  const xapi = fakeExportAPI();
  const state = sampleState();
  state.designs[0].items[0].lookup = { db: { designId: 'd2', name: '住所の共通項目' }, key: { itemId: 'a1', name: '郵便番号' }, copies: [] };
  const { app, api } = await bootSample(t, { exportAPI: xapi, state });
  const r1 = api.actions.addRevision('d1');
  api.actions.renameDesign('d2', '住所マスタ');
  await exportWith(app, api, 'html', r1);
  const html = xapi.calls.find((c) => c[0] === 'saveHtml')[1].html;
  const sa = bootApp({ html, url: 'https://localhost/vendor/customer.html' });
  await sa.api();
  t.after(() => sa.close());
  assert.match($(sa, '#sa-diff').textContent, /新 0・変 0・削除 0/);
  assert.ok(!$(sa, '#stage .df'), '札は出ない');
});

test('出力: 画面の上・右の端にある部品の札は、画面の外で切れないように内側に寄せる', async (t) => {
  const xapi = fakeExportAPI();
  const { app, api } = await bootSample(t, { exportAPI: xapi });
  const r1 = api.actions.addRevision('d1');
  api.actions.movePart('d1', 's1', 'p3', { x: 960, y: 64, w: 320, h: 64 }); // 右の端
  api.actions.movePart('d1', 's1', 'p1', { x: 32, y: 0, w: 320, h: 64 }); // 上の端
  api.actions.movePart('d1', 's1', 'p2', { x: 32, y: 240, w: 320, h: 64 }); // 端でない
  await exportWith(app, api, 'pdf', r1);
  const doc = new app.window.DOMParser().parseFromString(xapi.calls.find((c) => c[0] === 'savePdf')[1].html, 'text/html');
  const badge = (id) => doc.querySelector(`.xp-zone .part[data-part-id="${id}"] .df`);
  assert.ok(badge('p3').classList.contains('df-r'), '右の端の部品の札は内側へ');
  assert.ok(badge('p1').classList.contains('df-t'), '上の端の部品の札は内側へ');
  assert.ok(!badge('p2').classList.contains('df-r') && !badge('p2').classList.contains('df-t'), '端でない部品の札はそのまま');
});

// ── ブラウザで保存しきれないとき ──
test('保存: ブラウザで保存できなかったときの赤い帯に、改訂履歴の古い版を消すと空きが増えることを書く', async (t) => {
  const { app, api } = await bootSample(t);
  const proto = app.window.Storage.prototype;
  const orig = proto.setItem;
  proto.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    api.actions.addRevision('d1');
  } finally {
    proto.setItem = orig;
  }
  assert.match($(app, '#banner').textContent, /改訂履歴の古い版を消すと、空きが増えます/);
});

// ── 見直しで見つかった不具合（2026-10-14）──
test('元に戻すの履歴: 版の写しは写さずに同じものを指す（版が増えても、1 回の操作と履歴が重くならない）。写しは凍らせ、保存データには入る', async (t) => {
  const { app, api } = await bootSample(t);
  api.actions.addRevision('d1');
  api.actions.addRevision('d1');
  [40, 48, 56].forEach((x) => api.actions.movePart('d1', 's1', 'p1', { x, y: 64, w: 320, h: 64 }));
  const snaps = d1(api).revisions.map((r) => r.snapshot);
  assert.ok(snaps.every((s) => Object.isFrozen(s) && Object.isFrozen(s.screens[0].parts[0])), '写しは凍らせる');
  const stack = api.store.undoStack;
  assert.ok(stack.length >= 3);
  stack.forEach((s) => s.designs.find((x) => x.id === 'd1').revisions.forEach((r, i) => assert.equal(r.snapshot, snaps[i], '履歴の写しは同じものを指す')));
  api.store.undo();
  assert.equal(d1(api).screens[0].parts.find((p) => p.id === 'p1').x, 48);
  assert.equal(d1(api).revisions[1].snapshot, snaps[1]);
  api.store.redo();
  assert.equal(d1(api).screens[0].parts.find((p) => p.id === 'p1').x, 56);
  const saved = JSON.parse(app.window.localStorage.getItem(STORAGE_KEY)).designs.find((d) => d.id === 'd1');
  assert.equal(saved.revisions.length, 2);
  assert.equal(saved.revisions[0].snapshot.screens[0].parts.length, 4, '保存データには写しが入る');
  assert.equal(saved.revisions[0].snapshot.screens[0].parts[0].x, 32);
});

test('違い: 項目を一覧表から消した後に残った部品と、スマホの画面の高さで、変えていないのに「変」にしない', async (t) => {
  const { api } = await bootSample(t);
  api.actions.deleteItem('d1', 'i2'); // 顧客名の部品は、消したときの中身で残る
  api.actions.updateScreen('d1', 's1', { device: 'phone' });
  const tp = api.actions.addPart('d1', 's1', 'table', { x: 0, y: 560 });
  api.actions.updatePart('d1', 's1', tp, { view: { rows: 8 } });
  const id = api.actions.addRevision('d1');
  const res = api.designDiff(api.designFromSnapshot(d1(api), findRev(api, id)), d1(api), api.store.state);
  assert.deepEqual(plain(res.rows), []);
});
const findRev = (api, id) => d1(api).revisions.find((r) => r.id === id);

test('違い: 画面に置いた項目を一覧表から消すと「データベースの項目」に削除の行。置き方が変わった項目の名前の変更も出る', async (t) => {
  const { api } = await bootSample(t);
  const id = api.actions.addRevision('d1');
  api.actions.deleteItem('d1', 'i2'); // 置いていた項目を消す
  api.actions.updateItem('d1', 'i5', { label: '備考欄' }); // 置いていなかった項目の名前を変えて、画面に置く
  api.actions.addItemPart('d1', 's1', 'i5', { x: 32, y: 400 });
  const rows = plain(api.designDiff(api.designFromSnapshot(d1(api), findRev(api, id)), d1(api), api.store.state).rows);
  const del = rows.find((x) => x.screen === 'データベースの項目' && x.name === '顧客名');
  assert.ok(del, '消した項目の行');
  assert.equal(del.change, '削除');
  assert.match(del.text, /画面に置いた部品は、消したときの中身で残っている/);
  const part = rows.find((x) => x.screen === '新規登録' && x.name === '顧客名');
  assert.match(part.text, /データベースの項目の一覧表から消した/, '残った部品の行に、項目を消したことを書く');
  assert.ok(!/そのほかの設定/.test(part.text));
  const ren = rows.find((x) => x.screen === 'データベースの項目' && x.name === '備考欄');
  assert.ok(ren, '置き方が変わった項目も、項目どうしで比べる');
  assert.match(ren.text, /項目名：備考 → 備考欄/);
  assert.ok(rows.some((x) => x.screen === '新規登録' && x.change === '追加' && x.name === '備考欄'));
});

test('違い: 画面の順番を変えると「画面の順番」の行', async (t) => {
  const { api } = await bootSample(t);
  const s2 = api.actions.addScreen('d1', 'blank', 's1');
  const id = api.actions.addRevision('d1');
  api.actions.moveScreen('d1', s2, 0);
  const rows = plain(api.designDiff(api.designFromSnapshot(d1(api), findRev(api, id)), d1(api), api.store.state).rows);
  const row = rows.find((x) => x.change === '画面の順番');
  assert.ok(row);
  assert.equal(row.screen, '画面設計');
  assert.match(row.text, /新規登録・.+ → .+・新規登録/);
});

test('前の版に戻す: ほかの画面設計が取り込んでいる項目がその版にないときは、確かめの窓で知らせる', async (t) => {
  const state = sampleState();
  state.designs.push(design('d3', '受注管理', 'kintone', { items: [item('e1', '備考', 'text2', { link: { designId: 'd1', itemId: 'i5', designName: '顧客管理', lost: false } })] }));
  state.designs[0].items = state.designs[0].items.filter((x) => x.id !== 'i5');
  const snap = JSON.parse(JSON.stringify(state.designs[0]));
  delete snap.revisions;
  state.designs[0].items.push(item('i5', '備考', 'text2'));
  state.designs[0].revisions = [{ id: 'r1', kind: 'revision', no: 1, date: '2026-10-02T03:00:00.000Z', note: '', snapshot: snap, changes: null, baseNo: null }];
  const { app, api } = await bootSample(t, { state });
  api.openDesign('d1');
  const done = api.restoreRevisionWithConfirm('r1');
  await tick();
  assert.match($(app, '.modal').textContent, /「受注管理」が取り込んでいる項目「備考」は、この版にない/);
  click($(app, '.modal [data-dlg="cancel"]'));
  await done;
});

// ── 見直しで見つかった不具合（画面。2026-10-14）──
const pickScreen = (app, id) => click($(app, `#screen-list [data-action="select-screen"][data-id="${id}"]`));

test('前の版を見る: 見るのをやめると、見る前に開いていた画面に戻る。帯から戻したときは、見ていた画面のまま', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  const s2 = api.actions.addScreen('d1', 'blank', 's1');
  const r1 = api.actions.addRevision('d1');
  pickScreen(app, 's1');
  assert.equal(api.ui.screenId, 's1');
  api.startViewRevision(r1);
  pickScreen(app, s2);
  assert.equal(api.ui.screenId, s2, '見ている間は、前の版の画面を切り替えて見られる');
  click($(app, '#rv-band [data-action="rev-stop-view"]'));
  assert.equal(api.ui.screenId, 's1', '見る前の画面に戻る');
  // 帯の「この版に戻す…」
  api.startViewRevision(r1);
  pickScreen(app, s2);
  click($(app, '#rv-band [data-action="rev-restore-viewing"]'));
  await tick();
  click($(app, '.modal [data-dlg="ok"]'));
  await waitFor(() => !api.store.isViewing);
  assert.equal(api.ui.screenId, s2, '戻した後は、見ていた画面のまま');
});

test('前の版を見る: 見ている間も、表の列を選ぶボタンと「〇〇の設定を開く」は押せる（見るだけの操作）', async (t) => {
  const state = sampleState();
  state.designs[0].items[0].lookup = { db: { designId: 'd2', name: '住所の共通項目' }, key: { itemId: 'a1', name: '郵便番号' }, copies: [{ from: { itemId: 'a1', name: '郵便番号' }, to: { itemId: 'i2', name: '顧客名' } }] };
  const { app, api } = await bootSample(t, { state });
  api.openDesign('d1');
  const tb = api.actions.addPart('d1', 's1', 'table', { x: 0, y: 400 });
  const r1 = api.actions.addRevision('d1');
  api.startViewRevision(r1);
  api.selectPart(tb);
  const col = $(app, '#side-settings [data-action="tb-col"]');
  assert.ok(col && !col.disabled, '列を選ぶボタンは押せる');
  click(col);
  assert.equal(api.ui.colId, col.dataset.id);
  assert.ok($$(app, '#side-settings [data-action="tb-col-add"], #side-settings [data-action="tb-col-del"]').every((x) => x.disabled), '列を足す・消すボタンは押せない');
  api.selectPart('p2');
  const open = $(app, '#side-settings [data-action="open-lookup-key"]');
  assert.ok(open && !open.disabled, '「顧客コードの設定を開く」は押せる');
  click(open);
  assert.equal(api.ui.partId, 'p1');
});

test('改訂履歴の窓: 「この版に戻す…」の確かめの窓でキャンセルすると、改訂履歴の窓に戻る', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  const { r1 } = makeTwoVersions(api);
  const done = api.openRevisionsDialog();
  await tick();
  const title = () => ($(app, '.modal h2') || {}).textContent || '';
  click($(app, `.modal [data-rv="restore"][data-id="${r1}"]`));
  await waitFor(() => /第 1 版に戻す/.test(title()));
  click($(app, '.modal [data-dlg="cancel"]'));
  await waitFor(() => /改訂履歴/.test(title()));
  click($(app, '.modal [data-dlg="cancel"]'));
  await done;
  assert.equal(api.store.isViewing, false);
  assert.equal(d1(api).revisions.length, 2, '戻していない');
});

test('▼ のメニュー: 開くと最初の項目にフォーカスが移り、窓の大きさを変えると閉じる', async (t) => {
  const { app, api } = await bootSample(t);
  api.openDesign('d1');
  click($(app, '#toolbar [data-action="rev-menu"]'));
  assert.equal(app.document.activeElement, $(app, '#rev-menu-root [data-action="add-revision"]'));
  app.window.dispatchEvent(new app.window.Event('resize'));
  assert.ok(!$(app, '#rev-menu-root .rv-menu'), '窓の大きさを変えると閉じる');
  assert.equal(api.ui.revMenu, false);
});
