'use strict';
// お客さまポータルのヘッダー（第 16 段階。画像 q129 の案A）のテスト。画面の設定「ヘッダーの形」（アプリ・お客さまポータル）と、
// 画面設計に 1 か所だけ書くサイトの名前・メニュー・右上のボタン、画面ごとの下線を付けるメニュー。描き方・ずらし方・右のパネル・読み込み・違いの文。
// 画面設計の名前は架空の業務（サポートサイトなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
function setValue(app, el, value) {
  el.value = value;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}
function check(app, el) {
  el.checked = true;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

// 「サポートサイト」の画面設計に、「ホーム」（テキスト（1行）が 1 つ）と「よくある質問」の 2 つの画面を作って開く
async function bootPortal(t, look = 'standard') {
  const app = bootApp();
  const T = await app.api();
  t.after(() => app.close());
  const did = T.actions.createDesign('サポートサイト', 'claude', { look });
  T.openDesign(did);
  const home = T.currentScreen().id;
  T.actions.updateScreen(did, home, { name: 'ホーム' });
  const field = T.actions.addPart(did, home, 'text1', { x: 32, y: 96 });
  const faq = T.actions.addScreen(did, 'blank', home);
  T.actions.updateScreen(did, faq, { name: 'よくある質問' });
  const design = () => T.store.state.designs.find((d) => d.id === did);
  const screen = (id) => design().screens.find((s) => s.id === id);
  const kind = (sid, k) => T.actions.updateScreen(did, sid, { headerKind: k });
  return { app, T, did, home, faq, field, design, screen, kind };
}

test('ヘッダーの形をお客さまポータルにすると、高さ 72 のヘッダー（ロゴの箱・サイトの名前・メニュー・検索・ログイン）を描き、ヘッダーの下のアイテムを高さの差だけずらす', async (t) => {
  const { app, T, did, home, faq, field, design, screen, kind } = await bootPortal(t);
  const y0 = screen(home).parts.find((p) => p.id === field).y;
  kind(home, 'portal');
  assert.equal(screen(home).headerKind, 'portal');
  assert.equal(T.bandHeight(design(), screen(home)), 72);
  assert.equal(screen(home).parts.find((p) => p.id === field).y, y0 + 32, '標準のヘッダー 40 → 72 の差 32 だけ下へ');
  const band = $(app, '.screen-frame .screen > .screen-band');
  assert.ok(band.classList.contains('ptb'));
  assert.equal(band.querySelector('.ptb-logo').textContent, 'ロゴ');
  assert.equal(band.querySelector('.ptb-site').textContent, 'サポートサイト', 'サイトの名前は、書いていなければ画面設計の名前');
  assert.deepEqual([...band.querySelectorAll('.ptb-menu i')].map((i) => [i.textContent, i.className]), [['ホーム', 'on']], 'メニューは、ヘッダーがお客さまポータルの画面の名前');
  assert.ok(band.querySelector('.ptb-search svg'));
  assert.equal(band.querySelector('.ptb-btn').textContent, 'ログイン');
  assert.equal(band.querySelector('.pno'), null, 'ヘッダーに番号は付けない');
  kind(faq, 'portal');
  T.openScreen(faq);
  assert.deepEqual($$(app, '.screen-frame .ptb-menu i').map((i) => [i.textContent, i.className]), [['ホーム', ''], ['よくある質問', 'on']], 'ポータルの画面を増やすとメニューも増え、この画面の名前に下線');
  kind(home, 'app');
  assert.equal(screen(home).headerKind, undefined, 'アプリに戻すと欄を外す');
  assert.equal(screen(home).parts.find((p) => p.id === field).y, y0, '戻すと、差だけ上へ戻る');
  T.actions.updateDesignInfo(did, { look: 'salesforce' });
  const y1 = screen(home).parts.find((p) => p.id === field).y;
  kind(home, 'portal');
  assert.equal(screen(home).parts.find((p) => p.id === field).y, y1 - 16, 'Salesforce のヘッダー 88 → 72 の差だけ上へ');
});

test('見た目を変えても、お客さまポータルのヘッダーの画面はずらさない（ヘッダーの高さは 3 つの見た目で同じ 72）', async (t) => {
  const { T, did, home, faq, field, design, screen, kind } = await bootPortal(t);
  kind(home, 'portal');
  T.actions.addPart(did, faq, 'text1', { x: 32, y: 96 });
  const [yp, yf] = [screen(home).parts[0].y, screen(faq).parts[0].y];
  for (const look of ['salesforce', 'kintone']) {
    T.actions.updateDesignInfo(did, { look });
    assert.equal(T.bandHeight(design(), screen(home)), 72);
  }
  assert.equal(screen(home).parts.find((p) => p.id === field).y, yp);
  assert.equal(screen(faq).parts[0].y, yf + 48, 'アプリのヘッダーの画面は、今までどおりずらす');
});

test('サイトの名前・メニュー・右上のボタンは画面設計に 1 か所だけ書き、下線を付けるメニューは画面ごとに選ぶ（ないメニューを選んでいれば、画面の名前・最初のメニュー）', async (t) => {
  const { app, T, did, home, faq, design, kind } = await bootPortal(t);
  kind(home, 'portal');
  kind(faq, 'portal');
  T.actions.updateDesignInfo(did, { portal: { site: ' 家電の サポート ', menu: ['ホーム', 'よくある質問', '', '修理の申し込み'], button: 'マイページ' } });
  assert.deepEqual(plain(design().portal), { site: '家電の サポート', menu: ['ホーム', 'よくある質問', '修理の申し込み'], button: 'マイページ' });
  T.openScreen(faq);
  const band = () => $(app, '.screen-frame .ptb');
  assert.equal(band().querySelector('.ptb-site').textContent, '家電の サポート');
  assert.equal(band().querySelector('.ptb-btn').textContent, 'マイページ');
  const on = () => band().querySelector('.ptb-menu i.on').textContent;
  assert.equal(on(), 'よくある質問', '画面の名前と同じメニュー');
  T.actions.updateScreen(did, faq, { portalMenu: '修理の申し込み' });
  assert.equal(on(), '修理の申し込み');
  T.actions.updateDesignInfo(did, { portal: { menu: ['ホーム', 'お問い合わせ'] } });
  T.openScreen(faq);
  assert.equal(on(), 'ホーム', '選んだメニューも画面の名前もメニューにないときは、最初のメニュー');
  T.actions.updateDesignInfo(did, { portal: { site: '', menu: [], button: '' } });
  assert.equal(design().portal, undefined, '何も書いていなければ欄を外す');
  assert.deepEqual(plain(T.portalOf(design())), { site: 'サポートサイト', menu: ['ホーム', 'よくある質問'], button: 'ログイン' });
});

test('右のパネル: ヘッダーの形を選ぶ欄。お客さまポータルのときだけ、サイトの名前・メニュー・下線を付けるメニュー・右上のボタンの欄（書いていない欄は最初の値を薄い字で）', async (t) => {
  const { app, T, home, design, screen } = await bootPortal(t);
  const f = (name) => $(app, `#side-settings [data-field="${name}"]`);
  assert.deepEqual($$(app, '#side-settings [data-field="header-kind"]').map((e) => [e.value, e.checked]), [['app', true], ['portal', false]]);
  assert.equal(f('portal-site'), null);
  check(app, $$(app, '#side-settings [data-field="header-kind"]')[1]);
  assert.equal(screen(home).headerKind, 'portal');
  assert.equal(f('portal-site').placeholder, 'サポートサイト');
  assert.equal(f('portal-menu').placeholder, 'ホーム');
  assert.equal(f('portal-button').placeholder, 'ログイン');
  assert.match(f('screen-header').closest('label').textContent, /ロゴ・サイトの名前・メニュー・ボタン/);
  setValue(app, f('portal-site'), '家電のサポート');
  setValue(app, f('portal-button'), 'マイページ');
  setValue(app, f('portal-menu'), 'ホーム\nよくある質問\nお問い合わせ');
  assert.deepEqual(plain(design().portal), { site: '家電のサポート', menu: ['ホーム', 'よくある質問', 'お問い合わせ'], button: 'マイページ' });
  assert.deepEqual([...f('portal-on').options].map((o) => o.value), ['ホーム', 'よくある質問', 'お問い合わせ']);
  setValue(app, f('portal-on'), 'お問い合わせ');
  assert.equal(screen(home).portalMenu, 'お問い合わせ');
  assert.equal($(app, '.screen-frame .ptb-menu i.on').textContent, 'お問い合わせ');
  assert.equal($(app, '.screen-frame .ptb-site').textContent, '家電のサポート');
});

test('読み込み: 知らないヘッダーの形は外し、ポータルの欄の形を直す（何も書いていないポータルの欄は持たない）。今までの画面設計の中身の印は変わらない', async (t) => {
  const { T, did, design } = await bootPortal(t);
  const before = T.comparableContent(design(), T.store.state);
  assert.doesNotMatch(before, /portal|headerKind/, 'ポータルを使っていない画面設計の中身に、新しい欄は入らない');
  const st = plain(T.store.state);
  const d = st.designs[0];
  d.screens[0].headerKind = 'portal';
  d.screens[0].portalMenu = '  ホーム ';
  d.screens[1].headerKind = 'shop';
  d.portal = { site: 3, menu: 'ホーム', button: ' 会員ページ ' };
  const n = T.normalizeState(st).designs[0];
  assert.deepEqual([n.screens[0].headerKind, n.screens[0].portalMenu, n.screens[1].headerKind], ['portal', 'ホーム', undefined]);
  assert.deepEqual(plain(n.portal), { site: '', menu: [], button: '会員ページ' });
  d.portal = { site: '', menu: [] };
  assert.equal(T.normalizeState(st).designs[0].portal, undefined);
  assert.equal(design().id, did);
});

test('違いの文: ヘッダーの形・下線を付けるメニュー（画面）、ポータルのサイトの名前・メニュー・右上のボタン（画面設計）', async (t) => {
  const { T, did, home, design, kind } = await bootPortal(t);
  const before = plain(design());
  kind(home, 'portal');
  let rows = plain(T.designDiff(before, design(), T.store.state).rows);
  assert.match(rows.find((r) => r.screen === 'ホーム' && r.change === '画面の設定変更').text, /ヘッダーの形：アプリ → お客さまポータル/);
  const mid = plain(design());
  T.actions.updateDesignInfo(did, { portal: { site: '家電のサポート', menu: ['ホーム', 'お問い合わせ'], button: 'マイページ' } });
  T.actions.updateScreen(did, home, { portalMenu: 'お問い合わせ' });
  rows = plain(T.designDiff(mid, design(), T.store.state).rows);
  const text = rows.find((r) => r.screen === '画面設計').text;
  assert.match(text, /ポータルのサイトの名前：サポートサイト → 家電のサポート/);
  assert.match(text, /ポータルのメニュー：ホーム → ホーム・お問い合わせ/);
  assert.match(text, /ポータルの右上のボタン：ログイン → マイページ/);
  assert.match(rows.find((r) => r.screen === 'ホーム' && r.change === '画面の設定変更').text, /下線を付けるメニュー：ホーム → お問い合わせ/);
});

test('お客さまポータルのヘッダーの CSS: 3 つの見た目で高さ 72。Salesforce と kintone は、メニューの下線の色を見た目の色にする', async (t) => {
  const { T } = await bootPortal(t);
  const css = T.appStyle();
  assert.match(css, /\.screen-band\.ptb\{height:72px/);
  assert.match(css, /\.look-sf \.ptb-menu i\.on\{color:#0176d3;border-bottom-color:#0176d3/);
  assert.match(css, /\.look-kt \.ptb-menu i\.on\{color:#3498db;border-bottom-color:#3498db/);
  assert.equal(T.PORTAL_BAND, 72);
});
