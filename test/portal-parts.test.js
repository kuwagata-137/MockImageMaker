'use strict';
// お客さまポータルとチャットのアイテム（第 16 段階。画像 q129 の 2 枚目・q130 の案A）のテスト。
// 大きな画像と検索欄・タイル・記事の一覧・チャットと、アイテム一覧の組「ポータル画面用」。描き方・置き方・右のパネル・設定一覧に出る文・項目一覧に入れないこと。
// 画面設計の名前は架空の業務（サポートサイトなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
function setValue(app, el, value) {
  el.value = value;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

// 「サポートサイト」の画面設計を開いた状態で起動する
async function bootSite(t, look = 'standard') {
  const app = bootApp();
  const T = await app.api();
  t.after(() => app.close());
  const did = T.actions.createDesign('サポートサイト', 'claude', { look });
  T.openDesign(did);
  const sid = T.currentScreen().id;
  const design = () => T.store.state.designs.find((d) => d.id === did);
  const part = (id) => T.currentScreen().parts.find((p) => p.id === id);
  const add = (type, at = { x: 32, y: 120 }) => T.actions.addPart(did, sid, type, at);
  const el = (id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);
  const describe = (id) => T.describePart(T.resolvePart(design(), part(id)), { design: design(), state: T.store.state });
  return { app, T, did, sid, design, part, add, el, describe };
}

test('アイテム一覧: 組「ポータル画面用」（詳細画面用の後ろ）に、大きな画像と検索欄・タイル・記事の一覧・チャット。押すと置け、項目一覧には入らない', async (t) => {
  const { app, T, design } = await bootSite(t);
  const g = T.PALETTE_GROUPS.find((x) => x.id === 'portal');
  assert.deepEqual(plain([g.name, g.types]), ['ポータル画面用', ['hero', 'tileMenu', 'articles', 'chat']]);
  assert.deepEqual(plain(T.PALETTE_GROUPS.map((x) => x.id)).slice(3, 6), ['detail', 'portal', 'progress']);
  assert.deepEqual(['hero', 'tileMenu', 'articles', 'chat'].map((k) => T.PART_TYPES[k].name), ['大きな画像と検索欄', 'タイル', '記事の一覧', 'チャット']);
  assert.match($(app, '.pal-btn[data-type="hero"]').textContent, /大きな画像と\s*検索欄/);
  for (const type of ['hero', 'tileMenu', 'articles', 'chat']) {
    click($(app, `.pal-btn[data-type="${type}"]`));
    assert.equal(T.currentScreen().parts.at(-1).type, type);
  }
  assert.equal(design().items.length, 0, 'どれも項目一覧には入らない');
  assert.deepEqual(plain(T.currentScreen().parts.map((p) => [p.type, p.w, p.h])), [['hero', 1280, 320], ['tileMenu', 1216, 160], ['articles', 784, 408], ['chat', 400, 560]]);
});

test('大きな画像と検索欄: 置くと画面の幅いっぱい（左の端から）。色の付いた面に「画像」の印・見出し・説明・検索欄。番号は中の左上。検索欄は消せる', async (t) => {
  const { T, did, sid, part, add, el, describe } = await bootSite(t);
  const id = add('hero', { x: 200, y: 40 });
  assert.deepEqual([part(id).x, part(id).w], [0, 1280], '左の端から、画面の幅いっぱい');
  const e = el(id);
  assert.ok(e.querySelector('.phero-bg .phero-tag svg'));
  assert.match(e.querySelector('.phero-tag').textContent, /画像/);
  assert.equal(e.querySelector('.phero-c b').textContent, 'お困りごとは、ここで調べられます');
  assert.equal(e.querySelector('.phero-c small').textContent, 'よくある質問・取扱説明書・修理の申し込み');
  assert.match(e.querySelector('.phero-s span').textContent, /キーワードを入力/);
  assert.equal(e.querySelector('.phero-s .pbtn').textContent, '検索');
  assert.ok(e.querySelector('.pno.phero-no'), '番号は中の左上');
  assert.equal(describe(id), '見出し＝お困りごとは、ここで調べられます\n検索欄＝あり');
  T.actions.updatePart(did, sid, id, { props: { search: false } });
  assert.equal(el(id).querySelector('.phero-s'), null);
  assert.match(describe(id), /検索欄＝なし/);
});

test('タイル: 1 行に「題名, 説明」。アイコンの色は左から 青・橙・緑・紫 の順で、5 つ目からはまた青', async (t) => {
  const { T, did, sid, add, el, describe } = await bootSite(t);
  const id = add('tileMenu');
  const tiles = () => [...el(id).querySelectorAll('.ptm')];
  assert.deepEqual(tiles().map((x) => [x.querySelector('b').textContent, x.querySelector('small').textContent]),
    [['よくある質問', '困ったときの直し方'], ['修理を申し込む', '訪問の日を選んで申し込む'], ['問い合わせの状況', '申し込んだ修理の進み具合'], ['取扱説明書', '機種ごとの説明書を見る']]);
  assert.deepEqual(tiles().map((x) => x.querySelector('.ptm-ic').className.match(/fc-(\w+)/)[1]), ['blue', 'orange', 'green', 'purple']);
  assert.equal(describe(id), 'タイル＝よくある質問・修理を申し込む・問い合わせの状況・取扱説明書');
  T.actions.updatePart(did, sid, id, { props: { tiles: 'ホーム\nよくある質問, 困ったとき\n修理, 申し込む\n状況\n説明書, 機種ごと' } });
  assert.deepEqual(tiles().map((x) => x.querySelector('.ptm-ic').className.match(/fc-(\w+)/)[1]), ['blue', 'orange', 'green', 'purple', 'blue']);
  assert.equal(tiles()[0].querySelector('small'), null, '説明のないタイルは題名だけ');
});

test('記事の一覧: 1 行に「題名, 説明, 分類, 日付」。説明を出さない形は 日付・題名 の 1 行。下の「すべて表示」は消せる', async (t) => {
  const { T, did, sid, add, el, describe } = await bootSite(t);
  const id = add('articles');
  const e = () => el(id);
  assert.equal(e().querySelector('.pfr-head b').textContent, 'よくある質問');
  const items = () => [...e().querySelectorAll('.pat-i')];
  assert.equal(items().length, 4);
  assert.deepEqual([items()[0].querySelector('a').textContent, items()[0].querySelector('em').textContent, items()[0].querySelector('small').textContent],
    ['エラー E-11 が出たとき', '故障の直し方', '故障の直し方2026-10-20']);
  assert.match(items()[0].querySelector('p').textContent, /電源を入れ直す手順/);
  assert.equal(e().querySelector('.pat-more').textContent, 'すべて表示');
  assert.equal(describe(id), '記事＝4 件\n説明＝出す');
  T.actions.updatePart(did, sid, id, { label: 'お知らせ', props: { desc: false, more: false, rows: '年末年始の受付の時間のお知らせ, , , 2026-10-22\nサポートサイトを新しくしました, , , 2026-10-01' } });
  assert.deepEqual(items().map((x) => [x.className, x.querySelector('small').textContent, x.querySelector('a').textContent]),
    [['pat-i short', '2026-10-22', '年末年始の受付の時間のお知らせ'], ['pat-i short', '2026-10-01', 'サポートサイトを新しくしました']]);
  assert.equal(e().querySelector('.pat-more'), null);
  assert.equal(describe(id), '記事＝2 件\n説明＝出さない');
});

test('チャット: 1 行に「話す人: 文」。右の吹き出しにする人の文は右、ほかの人の文は名前と丸い印の付いた左の吹き出し。見出しの行は消せる', async (t) => {
  const { T, did, sid, add, el, describe } = await bootSite(t);
  const id = add('chat');
  const rows = () => [...el(id).querySelectorAll('.pch-row')];
  assert.equal(el(id).querySelector('.pfr-head b').textContent, 'AI のアシスタント');
  assert.deepEqual(rows().map((r) => r.classList.contains('r')), [false, true, false, true, false]);
  assert.equal(rows()[0].querySelector('.pch-av').textContent, 'AI');
  assert.equal(rows()[0].querySelector('small').textContent, 'AI');
  assert.equal(rows()[1].querySelector('.pch-b.me').textContent, 'エアコンから、エラー E-11 が出ています。');
  assert.equal(el(id).querySelector('.pch-in span').textContent, 'メッセージを入力');
  assert.equal(el(id).querySelector('.pch-in .pbtn').textContent, '送信');
  assert.equal(describe(id), '会話＝5 行\n右の吹き出し＝お客さま');
  T.actions.updatePart(did, sid, id, { props: { me: 'AI', head: false, lines: '担当者：お待たせしました。\n続けて書いた文\nお客さま: ありがとうございます。' } });
  assert.deepEqual(rows().map((r) => [r.classList.contains('r'), r.querySelector('.pch-b').textContent]),
    [[false, 'お待たせしました。'], [false, '続けて書いた文'], [false, 'ありがとうございます。']], '話す人を書いていない行は前の行と同じ人。「：」でもよい');
  assert.equal(rows()[0].querySelector('small').textContent, '担当者');
  assert.equal(el(id).querySelector('.pfr-head'), null, '見出しの行を出さない');
  assert.ok(el(id).querySelector('.pchat.bare .pno.pch-no'), '番号は左上に重ねる');
});

// 第 17 段階（画像 q137 の①）
test('記事の一覧の高さ: 記事の数・「説明を出す」・「すべて表示」から決める（見出しの行 44・1 件 80〔説明を出さないときは 40〕・「すべて表示」40）。変えると合わせ直し、見出しの文字だけでは戻さない', async (t) => {
  const { app, T, did, sid, add, part, el } = await bootSite(t);
  const rows = (n) => Array.from({ length: n }, (_, i) => `記事 ${i + 1}, 説明, よくある質問, 2026-10-0${i + 1}`).join('\n');
  assert.deepEqual([T.articlesHeight(T.PART_TYPES.articles.props), T.PART_TYPES.articles.h], [408, 408], '最初の中身（4 件）と最初の高さが同じ');
  assert.deepEqual([T.articlesHeight({ rows: rows(5) }), T.articlesHeight({ rows: rows(5), desc: false }), T.articlesHeight({ rows: rows(5), more: false }), T.articlesHeight({ rows: '' })],
    [488, 288, 448, 168], '記事がなければ 1 件分');
  const id = add('articles');
  assert.equal(part(id).h, 408);
  T.actions.updatePart(did, sid, id, { props: { rows: rows(5) } });
  assert.equal(part(id).h, 488);
  assert.equal(el(id).querySelectorAll('.pat-i').length, 5);
  T.actions.updatePart(did, sid, id, { props: { desc: false } });
  assert.equal(part(id).h, 288);
  // 人が伸ばした高さは、見出しの文字を変えても戻さない
  T.actions.movePart(did, sid, id, { x: part(id).x, y: part(id).y, w: part(id).w, h: 400 });
  T.actions.updatePart(did, sid, id, { label: 'お知らせ' });
  assert.equal(part(id).h, 400);
  // 右のパネルで記事を書き換えても合わせる。下の端が画面の外に出るときは、画面を伸ばす（アイテムを上へずらさない）
  T.actions.movePart(did, sid, id, { x: 32, y: 640, w: part(id).w, h: 160 });
  assert.deepEqual([part(id).y, T.currentScreen().height], [640, 800]);
  T.selectPart(id);
  setValue(app, $(app, '#side-settings [data-pf="props.rows"]'), rows(8));
  assert.deepEqual([part(id).y, part(id).h], [640, T.articlesHeight({ rows: rows(8), desc: false })]);
  assert.ok(T.currentScreen().height >= 640 + part(id).h);
});

test('右のパネル: 4 つのアイテムの欄（q129 の 2 枚目・q130）。欄を直すと描き直す', async (t) => {
  const { app, T, add, part } = await bootSite(t);
  const f = (k) => $(app, `#side-settings [data-pf="${k}"]`);
  const hero = add('hero');
  T.selectPart(hero);
  assert.ok(f('props.title') && f('props.sub') && f('props.search') && f('props.ph'));
  setValue(app, f('props.title'), '家電のサポート');
  assert.equal(part(hero).props.title, '家電のサポート');
  const tiles = add('tileMenu');
  T.selectPart(tiles);
  assert.ok(f('props.tiles'));
  assert.match(f('props.tiles').closest('.field').textContent, /題名, 説明/);
  const arts = add('articles');
  T.selectPart(arts);
  assert.ok(f('label') && f('props.rows') && f('props.desc') && f('props.more'));
  assert.match(f('label').closest('.field').textContent, /見出しの文字/);
  const chat = add('chat');
  T.selectPart(chat);
  assert.ok(f('props.lines') && f('props.me') && f('props.head') && f('props.ph'));
  setValue(app, f('props.me'), 'AI');
  assert.equal(part(chat).props.me, 'AI');
  assert.match($(app, '#pf-out').textContent, /右の吹き出し＝AI/);
});

test('小さなウィンドウの中: 大きな画像と検索欄はウィンドウの幅いっぱい、チャットはウィンドウの中に収める', async (t) => {
  const { T, did, sid, part } = await bootSite(t);
  const win = T.actions.addScreen(did, 'blank', sid);
  T.actions.updateScreen(did, win, { overlay: { under: sid, pos: 'bottomRight', w: 400, h: 560 } });
  const sc = () => T.store.state.designs.find((d) => d.id === did).screens.find((s) => s.id === win);
  const chat = T.actions.addPart(did, win, 'chat', { x: 0, y: 0 });
  const c = sc().parts.find((p) => p.id === chat);
  const b = T.partBounds(sc());
  assert.deepEqual([c.x, c.y, c.w, c.h], [b.x0, b.y0, 400, b.y1 - b.y0], 'チャットはウィンドウの中に収める（高さはウィンドウの中まで）');
  const hero = T.actions.addPart(did, win, 'hero', { x: 0, y: 0 });
  const h = sc().parts.find((p) => p.id === hero);
  assert.deepEqual([h.x, h.w], [b.x0, 400]);
  assert.equal(part(hero), undefined, '開いている画面とは別の画面');
});

test('4 つのアイテムの CSS: Salesforce と kintone の色と形（kintone でもタイルのアイコンは出す）', async (t) => {
  const { T } = await bootSite(t);
  const css = T.appStyle();
  assert.match(css, /\.look-kt \.ptm \.ptm-ic\{border-radius:0;display:inline-flex\}/);
  assert.match(css, /\.look-sf \.pch-b\.me\{background:#0176d3/);
  assert.match(css, /\.look-kt \.pat-i a\{color:#3498db/);
  assert.match(css, /\.look-sf \.phero-bg\{background:linear-gradient/);
});
