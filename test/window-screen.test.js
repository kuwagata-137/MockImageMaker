'use strict';
// 小さなウィンドウ（第 16 段階。画像 q128 の案A）のテスト。画面の設定「下に重ねる画面」で、画面を、ほかの画面の上に開く小さなウィンドウにする。
// データの形・描き方（下の画面・枠・灰色）・アイテムを置ける範囲・ウィンドウを動かしたとき・選べない画面・消す／写す・読み込み・違いの文・PDF・右のパネル。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
function setValue(app, el, value) {
  el.value = value;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}
function check(app, el, on = true) {
  el.checked = on;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

// 顧客管理の画面設計に、「顧客の詳細」（テキスト（1行）が 1 つ）と「承認申請」（ボタンが 1 つ）の 2 つの画面を作って開く
async function bootWindow(t) {
  const app = bootApp();
  const T = await app.api();
  t.after(() => app.close());
  const did = T.actions.createDesign('顧客管理', 'kintone');
  T.openDesign(did);
  const base = T.currentScreen().id;
  T.actions.updateScreen(did, base, { name: '顧客の詳細' });
  const field = T.actions.addPart(did, base, 'text1', { x: 32, y: 80 });
  const win = T.actions.addScreen(did, 'blank', base);
  T.actions.updateScreen(did, win, { name: '承認申請' });
  const btn = T.actions.addPart(did, win, 'button', { x: 40, y: 96 });
  const design = () => T.store.state.designs.find((d) => d.id === did);
  const screen = (id) => design().screens.find((s) => s.id === id);
  const part = (sid, pid) => screen(sid).parts.find((p) => p.id === pid);
  const overlay = (patch, sid = win) => T.actions.updateScreen(did, sid, { overlay: patch });
  return { app, T, did, base, win, field, btn, design, screen, part, overlay };
}

test('小さなウィンドウ: 下に重ねる画面を選ぶと、真ん中・640×432・下のボタンの行ありのウィンドウになり、今あるアイテムをウィンドウの中の左上へ移す', async (t) => {
  const { T, base, win, btn, screen, part, overlay } = await bootWindow(t);
  assert.equal(screen(win).overlay, undefined, '最初はふつうの画面（overlay の欄はない）');
  overlay({ under: base });
  assert.deepEqual(plain(screen(win).overlay), { under: base, pos: 'center', w: 640, h: 432, foot: true });
  assert.deepEqual(plain(T.windowRect(screen(win))), { x: 320, y: 184, w: 640, h: 432 }, '左右と上下の真ん中（8 ドットに合わせる）');
  assert.deepEqual(plain(T.partBounds(screen(win))), { x0: 320, y0: 240, x1: 960, y1: 616 }, '置ける範囲は、見出しの行（56）の下から下の端まで');
  const p = part(win, btn);
  assert.deepEqual([p.x, p.y], [344, 264], 'アイテムの並びの左上を、ウィンドウの中の左上から 24 の所へ移す');
  overlay({ under: '' });
  assert.equal(screen(win).overlay, undefined, '「なし」に戻すと、ふつうの画面');
  assert.deepEqual([part(win, btn).x, part(win, btn).y], [344, 264], '戻したときは、アイテムはそのまま');
});

test('小さなウィンドウの描き方: 下の画面（番号と data-part-id なし・押せない）・ウィンドウの枠（見出しは画面の名前・✕・下のボタンの行）・真ん中だけ灰色', async (t) => {
  const { app, T, did, base, win, field, btn, design, screen, overlay } = await bootWindow(t);
  overlay({ under: base });
  T.openScreen(win);
  const scr = $(app, '.screen-frame .screen');
  const kids = [...scr.children].map((e) => e.className.split(' ')[0]);
  assert.deepEqual(kids.slice(0, 2), ['sc-under', 'sc-win'], '下の画面・ウィンドウの枠を先に描き、この画面のアイテムをその上に重ねる');
  assert.equal(scr.querySelector(':scope > .screen-band'), null, 'この画面の帯は描かない');
  const under = scr.querySelector('.sc-under');
  assert.equal(under.getAttribute('aria-hidden'), 'true');
  assert.ok(under.querySelector('.screen-band'), '下の画面の帯は描く');
  assert.equal(under.querySelectorAll('.part').length, 1);
  assert.equal(under.querySelector('[data-part-id]'), null, '下の画面のアイテムは選べない');
  assert.equal(under.querySelector('.pno'), null, '下の画面のアイテムに番号を出さない');
  assert.ok(T.appStyle().match(/\.sc-under\{[^}]*pointer-events:none/));
  const frame = scr.querySelector('.sc-win');
  assert.ok(frame.classList.contains('dim') && frame.classList.contains('sc-win-center'));
  assert.equal(frame.querySelector('.sc-win-h b').textContent, '承認申請');
  assert.equal(frame.querySelector('.sc-win-x').textContent, '✕');
  assert.ok(frame.querySelector('.sc-win-f'));
  assert.equal(frame.style.left, '320px');
  assert.deepEqual($$(app, '#stage .screen .part[data-part-id]').map((e) => e.dataset.partId), [btn], '選べるのは、この画面のアイテムだけ');
  overlay({ pos: 'bottomRight', foot: false });
  const f2 = $(app, '.screen-frame .sc-win');
  assert.ok(!f2.classList.contains('dim'), '右下のときは灰色をかけない');
  assert.equal(f2.querySelector('.sc-win-f'), null, '下のボタンの行を消せる');
  // 下の画面を直すと、重ねた画面の下も同じに変わる
  T.actions.updatePart(did, base, field, { label: '会社名' });
  assert.match($(app, '.screen-frame .sc-under').textContent, /会社名/);
  // 縮小画像・前の版・PDF も同じ screenHtml で描く
  assert.match(T.screenHtml(design(), screen(win)), /class="sc-under"/);
});

test('小さなウィンドウの画面では、アイテムを置く・動かす・大きさを変える範囲がウィンドウの中になる', async (t) => {
  const { T, did, base, win, screen, part, overlay } = await bootWindow(t);
  overlay({ under: base });
  const sc = () => screen(win);
  const id = T.actions.addPart(did, win, 'text1', { x: 0, y: 0 });
  assert.deepEqual([part(win, id).x, part(win, id).y], [320, 240], '置くと、ウィンドウの中の左上に寄せる');
  assert.deepEqual(plain(T.fitRect({ x: 2000, y: 2000, w: 2000, h: 64 }, sc())), { x: 320, y: 552, w: 640, h: 64 }, 'はみ出す幅はウィンドウの幅まで');
  assert.deepEqual(plain(T.resizedRect({ x: 344, y: 264, w: 200, h: 64 }, 'nw', -400, -400, sc())), { x: 320, y: 240, w: 224, h: 88 });
  assert.deepEqual(plain(T.clampGroupMove(sc(), [{ k: 'p', x: 344, y: 264, w: 200, h: 64 }], 1000, -1000)), [416, -24]);
  // ふつうの画面では、今までどおり画面の中
  assert.deepEqual(plain(T.partBounds(screen(base))), { x0: 0, y0: 0, x1: 1280, y1: 800 });
  assert.deepEqual(plain(T.fitRect({ x: -40, y: -40, w: 200, h: 64 }, screen(base))), { x: 0, y: 0, w: 200, h: 64 });
});

test('ウィンドウの位置と大きさ: 右下・右の端・大きさの上限と下限。動かすと中のアイテムも一緒に動く', async (t) => {
  const { T, base, win, btn, screen, part, overlay } = await bootWindow(t);
  overlay({ under: base });
  overlay({ pos: 'bottomRight' });
  assert.deepEqual(plain(T.windowRect(screen(win))), { x: 616, y: 344, w: 640, h: 432 }, '右と下から 24');
  assert.deepEqual([part(win, btn).x, part(win, btn).y], [344 + 296, 264 + 160], 'ウィンドウの左上が動いた分だけ動く');
  overlay({ pos: 'right', w: 400 });
  assert.deepEqual(plain(T.windowRect(screen(win))), { x: 880, y: 0, w: 400, h: 800 }, '右の端は、右に付けて上から下まで');
  overlay({ pos: 'center', w: 5000, h: 10 });
  assert.deepEqual(plain(T.windowRect(screen(win))), { x: 16, y: 320, w: 1248, h: 160 }, '幅は画面の幅−32 まで、高さは 160 から');
  assert.deepEqual([screen(win).overlay.w, screen(win).overlay.h], [1248, 160], '収めた大きさを覚える');
  const p = part(win, btn);
  const b = T.partBounds(screen(win));
  assert.ok(p.x >= b.x0 && p.x + p.w <= b.x1 && p.y >= b.y0 && p.y + p.h <= b.y1, 'はみ出すアイテムは中へ寄せる');
});

test('選べない画面: 自分・小さなウィンドウの画面は下に重ねられない。下に重ねられている画面は小さなウィンドウにできない（右のパネルは灰色と理由）', async (t) => {
  const { app, T, did, base, win, screen, overlay } = await bootWindow(t);
  overlay({ under: win });
  assert.equal(screen(win).overlay, undefined, '自分は選べない');
  overlay({ under: 'no-such-screen' });
  assert.equal(screen(win).overlay, undefined, 'ない画面は選べない');
  overlay({ under: base });
  const third = T.actions.addScreen(did, 'blank', win);
  overlay({ under: win }, third);
  assert.equal(screen(third).overlay, undefined, '小さなウィンドウの画面は、下に重ねる画面にできない');
  overlay({ under: third }, base);
  assert.equal(screen(base).overlay, undefined, '下に重ねられている画面は、小さなウィンドウにできない');
  T.openScreen(third);
  const opt = (v) => [...$(app, '#side-settings [data-field="screen-under"]').options].find((o) => o.value === v);
  assert.equal(opt(win).disabled, true);
  assert.match(opt(win).textContent, /承認申請（小さなウィンドウ）/);
  assert.equal(opt(base).disabled, false);
  T.openScreen(base);
  assert.equal($(app, '#side-settings [data-field="screen-under"]').disabled, true);
  assert.match($(app, '#side-settings [data-field="screen-under"]').closest('.field').textContent, /「承認申請」の下に重ねられているので、小さなウィンドウにできません/);
});

test('右のパネル: 下に重ねる画面を選ぶと、ウィンドウの位置・幅・高さ・下のボタンの行の欄が出る。機器の種類は選べず、ヘッダーの欄は出さない', async (t) => {
  const { app, T, base, win, screen } = await bootWindow(t);
  T.openScreen(win);
  assert.equal($(app, '#side-settings [data-field="win-pos"]'), null, 'ふつうの画面には、ウィンドウの欄を出さない');
  assert.ok($(app, '#side-settings [data-field="screen-header"]'));
  setValue(app, $(app, '#side-settings [data-field="screen-under"]'), base);
  assert.equal(screen(win).overlay.under, base);
  assert.deepEqual($$(app, '#side-settings [data-field="win-pos"]').map((e) => [e.value, e.checked]), [['center', true], ['bottomRight', false], ['right', false]]);
  assert.equal($(app, '#side-settings [data-field="win-w"]').value, '640');
  assert.equal($(app, '#side-settings [data-field="screen-header"]'), null, 'ヘッダーの欄は出さない（下の画面のヘッダーを描く）');
  assert.ok($$(app, '#side-settings [data-field="device"]').every((e) => e.disabled), '機器の種類は下の画面に合わせる');
  check(app, $$(app, '#side-settings [data-field="win-pos"]')[2]);
  assert.equal(screen(win).overlay.pos, 'right');
  assert.equal($(app, '#side-settings [data-field="win-h"]'), null, '右の端のときは高さの欄を出さない');
  setValue(app, $(app, '#side-settings [data-field="win-w"]'), '9999');
  assert.equal($(app, '#side-settings [data-field="win-w"]').value, '1248', '収まらない幅は、収まる幅に直して出す');
  check(app, $(app, '#side-settings [data-field="win-foot"]'), false);
  assert.equal(screen(win).overlay.foot, false);
  setValue(app, $(app, '#side-settings [data-field="screen-under"]'), '');
  assert.equal(screen(win).overlay, undefined);
});

test('機器の種類: 下に重ねる画面を選ぶと下の画面の機器にする。下の画面の機器を変えると、重ねている画面も同じ機器にする', async (t) => {
  const { T, did, base, win, screen, overlay } = await bootWindow(t);
  T.actions.updateScreen(did, base, { device: 'tablet' });
  overlay({ under: base });
  assert.equal(screen(win).device, 'tablet');
  T.actions.updateScreen(did, win, { device: 'phone' });
  assert.equal(screen(win).device, 'tablet', '小さなウィンドウの画面の機器は、ひとりでは変えない');
  T.actions.updateScreen(did, base, { device: 'pc' });
  assert.equal(screen(win).device, 'pc');
  assert.deepEqual(plain(T.windowRect(screen(win))), { x: 320, y: 184, w: 640, h: 432 });
});

test('見た目を変えても、小さなウィンドウの画面のアイテムはずらさない（ふつうの画面は帯の高さの差だけずらす）', async (t) => {
  const { T, did, base, win, field, btn, part, overlay } = await bootWindow(t);
  overlay({ under: base });
  const [y0, f0] = [part(win, btn).y, part(base, field).y];
  T.actions.updateDesignInfo(did, { look: 'salesforce' });
  assert.equal(part(win, btn).y, y0);
  assert.equal(part(base, field).y, f0 + 48);
});

test('消す・写す: 下の画面を消すとふつうの画面に戻る（確かめのウィンドウにも書く）。画面の複製は同じ画面に重ね、画面設計の複製は新しい画面に付け直す', async (t) => {
  const { app, T, did, base, win, btn, design, screen, part, overlay } = await bootWindow(t);
  overlay({ under: base });
  const dup = T.actions.duplicateScreen(did, win);
  assert.equal(screen(dup).overlay.under, base, '画面の複製は、同じ画面に重ねたまま');
  const copyId = T.actions.duplicateDesign(did);
  const copy = T.store.state.designs.find((d) => d.id === copyId);
  const cw = copy.screens.find((s) => s.name === '承認申請');
  const cb = copy.screens.find((s) => s.name === '顧客の詳細');
  assert.equal(cw.overlay.under, cb.id, '画面設計の複製は、写した画面に付け直す');
  T.openScreen(base);
  T.runCommand('deleteScreen');
  await waitFor(() => $(app, '.modal'));
  assert.match($(app, '.modal').textContent, /小さなウィンドウの画面 「承認申請」・「承認申請 のコピー」 が、この画面を下に重ねています/);
  $(app, '.modal [data-dlg="ok"]').click();
  await waitFor(() => !screen(base));
  assert.equal(screen(win).overlay, undefined, 'ふつうの画面に戻る');
  assert.ok(part(win, btn), 'アイテムは残る');
  assert.equal(design().screens.filter((s) => s.overlay).length, 0);
});

test('読み込み: ない画面・自分・小さなウィンドウの画面を指す下に重ねる画面は外す。形の違う欄は直す', async (t) => {
  const { T } = await bootWindow(t);
  const st = plain(T.store.state);
  const d = st.designs[0];
  const sc = (id, overlay) => ({ id, name: id, device: 'pc', parts: [], callouts: [], ...(overlay ? { overlay } : {}) });
  d.screens = [
    sc('a'), sc('b', { under: 'a', pos: 'top', w: 'x' }), sc('c', { under: 'b' }), sc('d', { under: 'd' }), sc('e', { under: 'zz' }),
    sc('f', { under: 'g' }), sc('g', { under: 'f' }), sc('h', 'a'),
  ];
  const n = T.normalizeState(st).designs[0];
  const ov = Object.fromEntries(n.screens.map((s) => [s.id, s.overlay || null]));
  assert.deepEqual(plain(ov.b), { under: 'a', pos: 'center', w: 640, h: 432, foot: true }, '知らない位置は真ん中・数でない大きさは最初の大きさ');
  assert.deepEqual([ov.c, ov.d, ov.e, ov.f, ov.g, ov.h], [null, null, null, null, null, null], '小さなウィンドウの上・自分・ない画面・循環・形の違うもの');
});

test('違いの文と PDF: 下に重ねる画面・ウィンドウの位置・大きさを変えると改訂履歴の違いに出る。PDF の見出しの下に「〇〇」の上に開く小さなウィンドウ', async (t) => {
  const { T, base, win, design, overlay } = await bootWindow(t);
  const before = plain(design());
  overlay({ under: base });
  let rows = plain(T.designDiff(before, design(), T.store.state).rows);
  assert.match(rows.find((r) => r.screen === '承認申請' && r.change === '画面の設定変更').text, /下に重ねる画面：なし → 顧客の詳細/);
  const mid = plain(design());
  overlay({ pos: 'bottomRight', w: 400, h: 560, foot: false });
  rows = plain(T.designDiff(mid, design(), T.store.state).rows);
  const text = rows.find((r) => r.screen === '承認申請' && r.change === '画面の設定変更').text;
  assert.match(text, /ウィンドウの位置：真ん中 → 右下/);
  assert.match(text, /ウィンドウの大きさ：640 × 432 → 400 × 560/);
  assert.match(text, /下のボタンの行：あり → なし/);
  const pages = T.exportDocument(design(), T.store.state, { paper: 'A4', orient: 'landscape', cover: false, map: false, items: false, process: false, flow: false }).pages;
  assert.match(pages.join('\n'), /「顧客の詳細」の上に開く小さなウィンドウ/);
  assert.equal(pages.filter((p) => /上に開く小さなウィンドウ/.test(p)).length, 1, 'ふつうの画面のページには書かない');
});

test('項目の表示の CSS は、その画面の直の子のアイテムにだけ効く（下の画面とウィンドウの画面の表示が、互いに効かない）', async (t) => {
  const { app, T, did, base, win, overlay } = await bootWindow(t);
  overlay({ under: base });
  T.actions.updateScreen(did, base, { itemView: 'show' });
  T.openScreen(win);
  assert.ok($(app, '.screen-frame .sc-under').classList.contains('view-show'), '下の画面の項目の表示は、下の画面の要素に付ける');
  assert.ok(!$(app, '.screen-frame .screen').classList.contains('view-show'));
  const css = T.appStyle();
  assert.match(css, /\n\.view-show > :where\(\.part\) \.pbox\{border:none/);
  assert.doesNotMatch(css, /\n\.view-show \.pbox/, '先祖のどこかにあれば効く形は残さない');
});
