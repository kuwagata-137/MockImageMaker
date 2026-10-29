'use strict';
// ひな形 3 つ（第 16 段階。画像 q131）のテスト。承認申請のウィンドウ・お客さまポータルのトップ・AI のチャットのウィンドウと、
// 「画面を追加する」のウィンドウ（札を 5 つずつ並べる）。小さなウィンドウのひな形は、今開いている画面を下に重ねる画面にする。
// 画面設計の名前は架空の業務（問い合わせ管理・サポートサイトなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const rect = (p) => [p.x, p.y, p.w, p.h];

// 「問い合わせ管理」の画面設計を開いた状態で起動する（最初の画面は「問い合わせの詳細」）
async function boot(t, look = 'standard') {
  const app = bootApp();
  const T = await app.api();
  t.after(() => app.close());
  const did = T.actions.createDesign('問い合わせ管理', 'claude', { look });
  T.openDesign(did);
  const base = T.currentScreen().id;
  T.actions.updateScreen(did, base, { name: '問い合わせの詳細' });
  const design = () => T.store.state.designs.find((d) => d.id === did);
  const screen = (id) => design().screens.find((s) => s.id === id);
  const add = (tpl, after = base) => screen(T.actions.addScreen(did, tpl, after));
  return { app, T, did, base, design, screen, add };
}

test('ひな形: 承認申請のウィンドウ・お客さまポータルのトップ・AI のチャットのウィンドウを、ホームのダッシュボードの後ろに追加した（画面の名前はひな形の名前と別）', async (t) => {
  const { T } = await boot(t);
  assert.deepEqual(plain(T.SCREEN_TEMPLATES.slice(-3).map((x) => [x.id, x.name, x.note, x.screen])), [
    ['winApproval', '承認申請のウィンドウ', '今の画面に重ねる・申請のボタン', '承認申請'],
    ['portalTop', 'お客さまポータルのトップ', 'ヘッダー・大きな画像・タイル・記事', 'ホーム'],
    ['winChat', 'AI のチャットのウィンドウ', '今の画面の右下に重ねる・チャット', 'AI のアシスタント'],
  ]);
  assert.equal(T.SCREEN_TEMPLATES.findIndex((x) => x.id === 'winApproval'), T.SCREEN_TEMPLATES.findIndex((x) => x.id === 'crmHome') + 1);
});

test('承認申請のウィンドウ: 開いている画面を下に重ね、真ん中 640×432。説明文（番号なし）・承認者・コメント・申請・キャンセル（移動先は下の画面）を画像の位置に置く', async (t) => {
  const { T, base, design, add } = await boot(t);
  const w = add('winApproval');
  assert.equal(w.name, '承認申請');
  assert.deepEqual(plain(w.overlay), { under: base, pos: 'center', w: 640, h: 432, foot: true });
  assert.deepEqual(plain(T.windowRect(w)), { x: 320, y: 184, w: 640, h: 432 });
  assert.deepEqual(plain(w.parts.map((p) => [p.type, p.no, ...rect(p)])), [
    ['desc', null, 352, 264, 576, 48], ['user', 1, 352, 328, 320, 64], ['text2', 2, 352, 408, 576, 120],
    ['button', 3, 728, 568, 96, 40], ['button', 4, 840, 568, 96, 40],
  ]);
  const [desc, user, comment, apply, cancel] = w.parts;
  assert.equal(desc.label, 'このレコードの承認を申請します。');
  assert.deepEqual(plain([apply.label, apply.props.style, cancel.label, cancel.props.style]), ['申請', 'primary', 'キャンセル', 'normal']);
  assert.deepEqual(plain([cancel.props.to, cancel.props.designId, cancel.props.screenId]), ['screen', '', base], 'キャンセルの移動先は下の画面');
  assert.equal(apply.props.to, '');
  const items = design().items;
  assert.deepEqual(plain(items.map((it) => [it.type, it.name, it.required])), [['user', '承認者', true], ['text2', 'コメント', false]], '項目がなければ項目一覧に追加する');
  assert.deepEqual([user.itemId, comment.itemId], plain(items.map((it) => it.id)));
  assert.equal(user.sample, '鈴木 一郎（課長）');
  // 2 つ目は、同じ名前と種類の項目を使う（項目一覧に足さない）。名前は重ならないように番号を付ける
  const w2 = add('winApproval');
  assert.equal(design().items.length, 2);
  assert.equal(w2.parts[1].itemId, items[0].id);
  assert.equal(w2.name, '承認申請 2');
  // 下のボタンの行（ウィンドウの下の 64）の中に、ボタンが入る（上下の真ん中の 564 を、8 ドットのマス目に合わせて 568）
  const r = T.windowRect(w);
  assert.ok(apply.y >= r.y + r.h - 64 && apply.y + apply.h <= r.y + r.h);
  assert.equal(cancel.x + cancel.w, r.x + r.w - 24, 'ボタンはウィンドウの右から 24');
});

test('小さなウィンドウのひな形: 開いている画面が小さなウィンドウなら、その下の画面を下に重ねる。画面を書かないときは最後の画面', async (t) => {
  const { T, did, base, add, screen } = await boot(t);
  const w = add('winApproval');
  const chat = add('winChat', w.id);
  assert.equal(chat.overlay.under, base, '小さなウィンドウの画面の後ろに追加しても、下に重ねるのは、その下の画面');
  const other = T.actions.addScreen(did, 'blank', chat.id);
  const last = screen(T.actions.addScreen(did, 'winChat', null));
  assert.equal(last.overlay.under, other, '後ろに入れる画面を書かないときは、最後の画面を下に重ねる');
  assert.equal(T.templateUnderId(T.currentDesign(), 'ない画面'), other);
});

test('AI のチャットのウィンドウ: 右下 400×560（下のボタンの行なし）。見出しの行を出さないチャットを、ウィンドウの中いっぱいに置く', async (t) => {
  const { T, base, add } = await boot(t);
  const w = add('winChat');
  assert.equal(w.name, 'AI のアシスタント');
  assert.deepEqual(plain(w.overlay), { under: base, pos: 'bottomRight', w: 400, h: 560, foot: false });
  assert.deepEqual(plain(T.windowRect(w)), { x: 856, y: 216, w: 400, h: 560 });
  assert.deepEqual(plain(w.parts.map((p) => [p.type, p.no, ...rect(p)])), [['chat', 1, 856, 272, 400, 504]]);
  assert.equal(w.parts[0].props.head, false);
  assert.equal(w.parts[0].props.me, 'お客さま', 'ほかの設定は最初の値');
});

test('お客さまポータルのトップ: ヘッダーをお客さまポータルにし、大きな画像と検索欄（幅いっぱい）・タイル・記事の一覧 2 つ（よくある質問・お知らせ）を置く。高さ 1080', async (t) => {
  for (const look of ['standard', 'salesforce', 'kintone']) {
    await t.test(look, async (tt) => {
      const { T, design, add } = await boot(tt, look);
      const p = add('portalTop');
      assert.equal(p.name, 'ホーム');
      assert.equal(p.headerKind, 'portal');
      assert.equal(T.bandHeight(design(), p), 72);
      assert.equal(p.height, 1080);
      assert.deepEqual(plain(p.parts.map((x) => [x.type, x.no, ...rect(x)])), [
        ['hero', 1, 0, 72, 1280, 320], ['tileMenu', 2, 32, 424, 1216, 160], ['articles', 3, 32, 616, 784, 416], ['articles', 4, 848, 616, 400, 416],
      ], '見た目によらず同じ位置（ポータルのヘッダーの高さは同じ）');
      const news = p.parts[3];
      assert.deepEqual(plain([news.label, news.props.desc, news.props.more]), ['お知らせ', false, true]);
      assert.equal(news.props.rows.split('\n').length, 4);
      assert.equal(p.parts[2].label, 'よくある質問');
      assert.deepEqual(plain(T.portalOf(design()).menu), ['ホーム'], 'メニューを書いていなければ、ポータルの画面の名前');
      assert.equal(design().items.length, 0, '項目一覧には何も追加しない');
    });
  }
});

test('「画面を追加する」のウィンドウ: 幅 1100 に札を 5 つずつ並べる（14 個で 3 段）。小さなウィンドウのひな形の小さな絵には、今開いている画面を下に描く', async (t) => {
  const { app, T, add } = await boot(t);
  const w = add('winApproval');
  T.openScreen(w.id);
  T.runCommand('addScreen');
  await waitFor(() => $(app, '.modal'));
  assert.match($(app, '.modal').getAttribute('style'), /width:min\(1100px,/);
  assert.ok($(app, '.modal .tpl-grid.five'));
  assert.match(T.appStyle(), /\.tpl-grid\.five\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  const cards = $$(app, '.modal .tpl');
  assert.equal(cards.length, 14);
  const card = (id) => cards.find((c) => c.dataset.tpl === id);
  assert.ok(card('winApproval').querySelector('.sc-under .screen-band'), '下の画面（ヘッダーのある「問い合わせの詳細」）を描く');
  assert.ok(card('winChat').querySelector('.sc-win.sc-win-bottomRight'));
  assert.ok(card('portalTop').querySelector('.screen-band.ptb'));
  assert.equal(card('winChat').querySelector(':scope > b').textContent, 'AI のチャットのウィンドウ');
  click(card('winChat'));
  click($(app, '.modal [data-dlg="ok"]'));
  await tick();
  assert.equal(T.currentScreen().name, 'AI のアシスタント');
  assert.equal(T.currentScreen().overlay.under, w.overlay.under, '開いていた小さなウィンドウの下の画面を、下に重ねる');
});

test('ひな形の小さなウィンドウ: スマホの画面を下に重ねると、ウィンドウの画面もスマホになり、ウィンドウの幅は画面の幅−32 まで', async (t) => {
  const { T, did, base, add } = await boot(t);
  T.actions.updateScreen(did, base, { device: 'phone' });
  const w = add('winChat');
  assert.equal(w.device, 'phone');
  const r = T.windowRect(w);
  assert.deepEqual([r.w, r.x + r.w], [336, 375 - 24 - 7], '幅は 375−32 を 8 に切り下げた 336。右から 24（画面の幅を 8 に切り下げた 368 から）');
  assert.deepEqual(plain(rect(w.parts[0])), [r.x, r.y + 56, r.w, r.h - 56]);
});
