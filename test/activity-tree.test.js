'use strict';
// 活動履歴（第 14 段階。画像 q118 の案A）とツリー（画像 q119 の案A）のテスト。種類・見た目・右のパネル・設定一覧。
// 画面設計の名前は架空の業務（顧客管理・文書の保管など）だけを使う。

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
function setChecked(el, on) {
  el.checked = on;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

async function bootOne(t, type, name = '顧客管理') {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const did = api.actions.createDesign(name, 'other');
  api.openDesign(did);
  const sid = api.currentScreen().id;
  const id = api.actions.addPart(did, sid, type, { x: 64, y: 56 });
  const part = () => api.currentScreen().parts.find((p) => p.id === id);
  const update = (patch) => api.actions.updatePart(did, sid, id, patch);
  return { app, api, did, sid, id, part, update };
}

// ── 活動履歴 ──

test('活動履歴: 種類の名前・最初の大きさ・見出しの文字・最初のサンプル（1 行に「日付, 種類, 件名, 説明」）', async (t) => {
  const { api, part } = await bootOne(t, 'activity');
  const T = api.PART_TYPES.activity;
  assert.equal(T.name, '活動履歴');
  assert.deepEqual(plain([part().w, part().label, part().props.buttons, part().props.months]), [400, '活動', true, true]);
  assert.equal(part().props.samples.split('\n')[0], '2026-10-22, 予定, 訪問して点検する, 佐藤 花子 が訪問します');
  assert.equal(part().props.samples.split('\n').length, 5);
});

test('活動履歴の見た目: ボタンの行・月ごとの見出し・種類ごとの色の丸・件名と説明・日付。並びは書いた順のまま', async (t) => {
  const { app, id, update } = await bootOne(t, 'activity');
  const el = () => partEl(app, id);
  assert.equal(el().querySelector('.pfr-head b').textContent, '活動');
  assert.deepEqual([...el().querySelectorAll('.pac-btns span')].map((e) => e.textContent), ['電話を記録', 'メール', '作業', '予定']);
  assert.equal(el().querySelector('.pac-filter').textContent, '絞り込み: すべての期間・すべての活動');
  assert.deepEqual([...el().querySelectorAll('.pac-month')].map((e) => e.textContent), ['2026年10月', '2026年9月']);
  const rows = () => [...el().querySelectorAll('.pac-row')].map((r) => [r.className.replace('pac-row ', ''), r.querySelector('a').textContent, r.querySelector('small').textContent, r.querySelector('em').textContent]);
  assert.deepEqual(rows()[0], ['ac-event', '訪問して点検する', '佐藤 花子 が訪問します', '10月22日']);
  assert.deepEqual(rows().map((r) => r[0]), ['ac-event', 'ac-mail', 'ac-call', 'ac-task', 'ac-call']);
  assert.ok(el().querySelector('.pac-row .pac-dot svg'), '丸の中に種類の絵');
  update({ props: { samples: '2026-08-01, メモ, 打ち合わせの記録, 説明に、読点と，カンマ\n2026年8月3日, 来店, 店に来た\n日付なし, 電話, 折り返しの電話' } });
  assert.deepEqual(rows(), [
    ['ac-note', '打ち合わせの記録', '説明に、読点と，カンマ', '8月1日'],
    ['ac-other', '店に来た', '', '8月3日'],
    ['ac-call', '折り返しの電話', '', '日付なし'],
  ], '説明は 3 つ目の区切りより後ろを全部。知らない種類は灰色の丸。読めない日付はそのまま');
  assert.deepEqual([...el().querySelectorAll('.pac-month')].map((e) => e.textContent), ['2026年8月'], '読めない日付の行は、前の月の見出しの下');
  update({ props: { buttons: false, months: false } });
  assert.equal(el().querySelector('.pac-btns'), null);
  assert.equal(el().querySelector('.pac-filter'), null);
  assert.equal(el().querySelector('.pac-month'), null);
  assert.equal(el().querySelectorAll('.pac-row').length, 3);
});

test('活動履歴の右のパネル: 見出しの文字・活動の欄・ボタンの行と月の見出しのチェック。設定一覧に出る文', async (t) => {
  const { app, api, id, part } = await bootOne(t, 'activity');
  api.selectPart(id);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  assert.match(side('.panel-title').textContent, /番号 1・活動履歴/);
  assert.equal(side('#pf-out').textContent, '活動＝予定・メール・電話・作業・電話（5 件）');
  setValue(side('[data-pf="label"]'), '活動の記録');
  assert.equal(part().label, '活動の記録');
  setValue(side('[data-pf="props.samples"]'), '2026-10-01, 電話, 問い合わせ\n2026-10-02, メール, 返事');
  assert.equal(part().props.samples, '2026-10-01, 電話, 問い合わせ\n2026-10-02, メール, 返事');
  assert.equal(side('#pf-out').textContent, '活動＝電話・メール（2 件）');
  setChecked(side('[data-pf="props.buttons"]'), false);
  setChecked(side('[data-pf="props.months"]'), false);
  assert.deepEqual(plain([part().props.buttons, part().props.months]), [false, false]);
});

// ── ツリー ──

test('ツリー: 種類の名前・最初の大きさ・最初の行（頭の空白 2 つで 1 段下げ、頭に「+」の行は閉じた形）・選んでいる行', async (t) => {
  const { api, part } = await bootOne(t, 'tree', '文書の保管');
  const T = api.PART_TYPES.tree;
  assert.equal(T.name, 'ツリー');
  assert.deepEqual(plain([part().w, part().h, part().props.current, part().props.folder]), [240, 320, '契約書 > 2026年度（5）', true]);
  assert.equal(part().props.lines, '契約書\n  2026年度（5）\n  2025年度（12）\n  2024年度（9）\n+規程\n議事録\n  2026年度（14）\n  2025年度（31）\n+申請書の控え');
});

test('ツリーの見た目: 段の下げ・開いた印（▾）と閉じた印（▸）・件数・選んでいる行・フォルダのアイコン。閉じた行の下の段は描かない', async (t) => {
  const { app, id, update } = await bootOne(t, 'tree', '文書の保管');
  const el = () => partEl(app, id);
  const rows = () => [...el().querySelectorAll('.ptr-row')].map((r) => [r.querySelector('.ptr-tw').textContent, r.querySelector('.ptr-name').textContent,
    r.querySelector('small') ? r.querySelector('small').textContent : '', r.style.paddingLeft, r.classList.contains('on')]);
  assert.deepEqual(rows(), [
    ['▾', '契約書', '', '8px', false],
    ['', '2026年度', '（5）', '24px', true],
    ['', '2025年度', '（12）', '24px', false],
    ['', '2024年度', '（9）', '24px', false],
    ['▸', '規程', '', '8px', false],
    ['▾', '議事録', '', '8px', false],
    ['', '2026年度', '（14）', '24px', false],
    ['', '2025年度', '（31）', '24px', false],
    ['▸', '申請書の控え', '', '8px', false],
  ]);
  assert.equal(el().querySelectorAll('.ptr-row .ptr-fd').length, 9, 'どの行にもフォルダのアイコン');
  assert.ok(el().querySelector('.pno'), '赤い番号はアイテムに 1 つ');
  update({ props: { lines: '+規程\n  社内規程\n総務\n　全角の空白で下げた行\n\t\tタブで下げた行', current: '', folder: false } });
  assert.deepEqual(rows().map((r) => [r[0], r[1], r[3], r[4]]), [['▸', '規程', '8px', false], ['▾', '総務', '8px', false], ['▾', '全角の空白で下げた行', '24px', false], ['', 'タブで下げた行', '40px', false]],
    '閉じた行の下は描かない。全角の空白とタブは 1 つで半角の空白 2 つ分');
  assert.equal(el().querySelector('.ptr-fd'), null);
});

test('ツリーの右のパネル: ツリーの行（頭の空白を残す）・選んでいる行（描いている行の道筋）・フォルダのアイコン。設定一覧に出る文', async (t) => {
  const { app, api, id, part } = await bootOne(t, 'tree', '文書の保管');
  api.selectPart(id);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  assert.match(side('.panel-title').textContent, /番号 1・ツリー/);
  assert.equal(side('#pf-out').textContent, 'ツリー＝契約書／規程／議事録／申請書の控え（9 行）');
  assert.deepEqual([...side('[data-pf="props.current"]').options].map((o) => o.value), ['', '契約書', '契約書 > 2026年度（5）', '契約書 > 2025年度（12）', '契約書 > 2024年度（9）',
    '規程', '議事録', '議事録 > 2026年度（14）', '議事録 > 2025年度（31）', '申請書の控え']);
  assert.equal(side('[data-pf="props.current"]').value, '契約書 > 2026年度（5）');
  setValue(side('[data-pf="props.lines"]'), '総務\n  備品\n  鍵の貸し出し');
  assert.equal(part().props.lines, '総務\n  備品\n  鍵の貸し出し', '頭の空白は消さない');
  assert.deepEqual([...side('[data-pf="props.current"]').options].map((o) => o.value), ['', '総務', '総務 > 備品', '総務 > 鍵の貸し出し'], '行を変えると、選べる行も変わる');
  setValue(side('[data-pf="props.current"]'), '総務 > 備品');
  assert.equal(part().props.current, '総務 > 備品');
  assert.ok(partEl(app, id).querySelectorAll('.ptr-row')[1].classList.contains('on'));
  setChecked(side('[data-pf="props.folder"]'), false);
  assert.equal(part().props.folder, false);
  assert.equal(side('#pf-out').textContent, 'ツリー＝総務（3 行）');
});

test('改訂履歴の変更点: グループ枠のグループ名・活動履歴の見出しの文字を変えたときの言葉と、活動とツリーの行の変更', async (t) => {
  const { api, did, sid, id, update } = await bootOne(t, 'activity');
  const fr = api.actions.addPart(did, sid, 'frame', { x: 560, y: 56 });
  const tr = api.actions.addPart(did, sid, 'tree', { x: 560, y: 360 });
  const d = () => api.store.state.designs.find((x) => x.id === did);
  const base = api.designFromSnapshot(d(), { snapshot: plain(d()) });
  update({ label: '活動の記録', props: { samples: '2026-10-01, 電話, 問い合わせ' } });
  api.actions.updatePart(did, sid, fr, { label: '顧客の情報' });
  api.actions.updatePart(did, sid, tr, { props: { lines: '総務' } });
  const rows = plain(api.designDiff(base, d(), api.store.state).rows).filter((x) => x.change === '設定変更');
  const text = (title) => rows.find((x) => x.name === title).text;
  assert.match(text('活動の記録'), /^見出しの文字：活動 → 活動の記録$/m);
  assert.match(text('活動の記録'), /^活動：予定・メール・電話・作業・電話（5 件） → 電話（1 件）$/m);
  assert.match(text('顧客の情報'), /^グループ名：グループ名 → 顧客の情報$/m);
  assert.match(text('ツリー'), /^ツリー：契約書／規程／議事録／申請書の控え（9 行） → 総務（1 行）$/m);
  assert.ok(id);
});

test('活動履歴とツリーの見た目: Salesforce と kintone の形', async (t) => {
  const { api } = await bootOne(t, 'tree');
  const css = api.appStyle();
  assert.match(css, /\.look-sf \.ac-call \.pac-dot\{/);
  assert.match(css, /\.look-kt \.ac-event \.pac-dot\{/);
  assert.match(css, /\.look-sf \.ptr-row\.on\{/);
  assert.match(css, /\.look-kt \.ptr-fd\{/);
});
