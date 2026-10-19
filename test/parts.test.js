'use strict';
// 部品（第 3 段階の前半）のテスト。部品の箱・置く・選ぶ・動かす・大きさ・設定の欄・番号・一覧表・キー。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const plain = (v) => JSON.parse(JSON.stringify(v));
function key(app, target, init) {
  target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
function mouse(app, target, type, init) {
  target.dispatchEvent(new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function check(el, on) {
  el.checked = on;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

// 白紙の画面 1 つの画面設計を開いた状態で起動する
async function bootEditor(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign('顧客管理アプリ', 'kintone');
  api.openDesign(id);
  const screen = () => api.currentScreen();
  // 部品は、指している項目と合わせた形で返す（項目名と設定は項目が持つため）
  const parts = () => screen().parts.map((p) => api.resolvePart(api.currentDesign(), p));
  const add = (type) => { click($(app, `.pal-btn[data-type="${type}"]`)); return parts()[parts().length - 1]; };
  const partEl = (id) => $(app, `#stage .part[data-part-id="${id}"]`);
  return { app, api, id, screen, parts, add, partEl };
}

test('部品の箱: 5 つの組に 26 種類の部品と吹き出し。組の見出しで閉じたり開いたりできる', async (t) => {
  const { app, api } = await bootEditor(t);
  assert.deepEqual($$(app, '.pal-head').map((e) => e.textContent.replace(/\s+/g, ' ').trim()), ['▼ データベースの項目0', '▼ 基本14', '▼ 入力の画面用4', '▼ 一覧の画面用3', '▼ 進み具合の画面用3', '▼ 見た目用3']);
  assert.equal($$(app, '.pal-btn').length, 27);
  click($(app, '.pal-head[data-id="basic"]'));
  assert.equal($$(app, '.pal-btn').length, 13, '基本を閉じた');
  assert.equal(api.ui.paletteClosed.basic, true);
  api.goHome();
  api.openDesign(api.store.state.designs[0].id);
  assert.equal($$(app, '.pal-btn').length, 13, '画面設計を開き直しても閉じたまま');
  click($(app, '.pal-head[data-id="basic"]'));
  assert.equal($$(app, '.pal-btn').length, 27);
});

test('部品を置く: 押すと帯の下に置き、番号が付き、選んだ状態になる。続けて押すとずらして置く', async (t) => {
  const { app, api, parts, add, partEl } = await bootEditor(t);
  const a = add('text1');
  assert.deepEqual(plain([a.x, a.y, a.w, a.h, a.no, a.label]), [0, 40, 320, 64, 1, '項目名']);
  assert.equal(api.ui.partId, a.id);
  assert.ok(partEl(a.id).classList.contains('sel'));
  assert.equal($$(app, `#stage .part.sel .grip`).length, 8, '縁のつまみが 8 つ');
  assert.match($(app, '#side-settings .panel-title').textContent, /番号 1・テキスト（1行）/);
  const b = add('text1');
  assert.deepEqual([b.x, b.y, b.no], [16, 56, 2], '同じ位置には重ねない');
  const h = add('heading');
  assert.equal(h.no, null, '見出しには番号を付けない');
  assert.equal(add('divider').no, null, '区切り線にも付けない');
  assert.equal(add('button').no, 3);
  assert.equal(parts().length, 5);
  assert.equal(partEl(h.id).querySelector('.pno'), null);
  api.store.undo();
  assert.equal(parts().length, 4, '元に戻すで消える');
});

test('置いた部品の見た目: 薄い字・見本の値・必須の印・単位・選択肢・ボタンの番号は左の外', async (t) => {
  const { api, add, partEl, screen } = await bootEditor(t);
  const ids = ['text1', 'number', 'dropdown', 'radio', 'checkbox', 'button', 'file', 'calc'].map((type) => add(type).id);
  const el = (i) => partEl(ids[i]);
  assert.equal(el(0).querySelector('.pph').textContent, '文字列');
  assert.equal(el(2).querySelector('.pph').textContent, '選択してください');
  assert.equal(el(3).querySelectorAll('.pmark.rd').length, 2);
  assert.equal(el(4).querySelectorAll('.pmark.ck').length, 3);
  assert.ok(el(5).querySelector('.pno.pno-out'), 'ボタンの番号は左の外');
  assert.match(el(6).textContent, /ファイルをここにドラッグ/);
  const sc = screen();
  api.actions.updatePart(api.ui.designId, sc.id, ids[0], { sample: '山田商事', required: true });
  api.actions.updatePart(api.ui.designId, sc.id, ids[1], { props: { unit: '人' } });
  api.actions.updatePart(api.ui.designId, sc.id, ids[0], { labelPos: 'left' });
  assert.equal(el(0).querySelector('.pval').textContent, '山田商事');
  assert.equal(el(0).querySelector('.pph'), null, '見本の値を書くと薄い字は出さない');
  assert.ok(el(0).querySelector('.preq'), '必須の印');
  assert.ok(el(0).classList.contains('lab-left'), '項目名を左に置ける');
  assert.equal(el(1).querySelector('.pr').textContent, '人');
});

test('部品を動かす・大きさを変える: マス目に吸い付き、画面からはみ出さない。放したときに 1 回だけ保存する', async (t) => {
  const { app, api, add, partEl, parts } = await bootEditor(t);
  const p = add('text1');
  const doc = app.document;
  const undoBefore = api.store.undoStack.length;
  mouse(app, partEl(p.id).querySelector('.plabel'), 'mousedown', { clientX: 100, clientY: 100 });
  mouse(app, doc, 'mousemove', { clientX: 125, clientY: 141 });
  assert.equal(partEl(p.id).style.left, '24px', 'ドラッグ中は要素だけ動く');
  assert.equal(parts()[0].x, 0, 'ドラッグ中はまだ保存しない');
  mouse(app, doc, 'mouseup', { clientX: 125, clientY: 141 });
  assert.deepEqual([parts()[0].x, parts()[0].y], [24, 80]);
  assert.equal(api.store.undoStack.length, undoBefore + 1);

  mouse(app, partEl(p.id).querySelector('.g-se'), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, doc, 'mousemove', { clientX: 43, clientY: 17 });
  mouse(app, doc, 'mouseup', {});
  assert.deepEqual([parts()[0].w, parts()[0].h], [360, 80], '右下のつまみで大きくする（8 ドットずつ）');
  mouse(app, partEl(p.id).querySelector('.g-w'), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, doc, 'mousemove', { clientX: 400, clientY: 0 });
  mouse(app, doc, 'mouseup', {});
  assert.deepEqual([parts()[0].x, parts()[0].w], [368, 16], '左の辺を右へ動かしても、16 ドットより狭くならない');

  mouse(app, partEl(p.id), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, doc, 'mousemove', { clientX: 5000, clientY: 5000 });
  mouse(app, doc, 'mouseup', {});
  assert.deepEqual([parts()[0].x + parts()[0].w, parts()[0].y + parts()[0].h], [1280, 800], '画面の右下の角で止まる');

  mouse(app, $(app, '#canvas-wrap'), 'mousedown', {});
  assert.equal(api.ui.partId, null, '何もない所を押すと選ぶのをやめる');
  api.store.undo();
  assert.deepEqual([parts()[0].x, parts()[0].y], [368, 80]);
});

test('ハンドのときは、部品を押しても選ばない・動かさない', async (t) => {
  const { app, api, add, partEl, parts } = await bootEditor(t);
  const p = add('number');
  api.selectPart(null);
  click($(app, '[data-action="mode-hand"]'));
  mouse(app, partEl(p.id), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, app.document, 'mousemove', { clientX: 80, clientY: 80 });
  mouse(app, app.document, 'mouseup', {});
  assert.equal(api.ui.partId, null);
  assert.deepEqual([parts()[0].x, parts()[0].y], [p.x, p.y]);
});

test('設定の欄: 書いた設定が画面と一覧表の「設定」の文に出る', async (t) => {
  const { app, api, add, partEl, parts } = await bootEditor(t);
  const p = add('text1');
  const field = (key) => $(app, `#side-settings [data-pf="${key}"]`);
  setValue(field('label'), ' 顧客名 ');
  check(field('required'), true);
  setValue(field('props.maxLen'), '50');
  setValue(field('memo'), '同じ名前があるときは警告を出す');
  assert.equal(parts()[0].label, '顧客名', '1 行の欄は前後の空白を取る');
  assert.equal(partEl(p.id).querySelector('.plabel-text').textContent, '顧客名');
  const row = $(app, '.ptable tbody tr');
  assert.deepEqual([...row.cells].map((c) => c.textContent), ['1', '顧客名', 'テキスト（1行）', '必須・最大 50 文字\n同じ名前があるときは警告を出す']);
  assert.equal($(app, '#pf-out').textContent, '必須・最大 50 文字\n同じ名前があるときは警告を出す', '設定の欄の中にも同じ文');

  check(field('numbered'), false);
  assert.equal(parts()[0].no, null);
  assert.match($(app, '.ptable').textContent, /番号の付いた部品はまだありません/);
  check(field('numbered'), true);
  assert.equal(parts()[0].no, 1);
});

test('設定の欄: 選択肢を書き換えると初期値の選び方も変わる（ドロップダウン・チェックボックス）', async (t) => {
  const { app, add, parts } = await bootEditor(t);
  add('dropdown');
  const field = (key) => $(app, `#side-settings [data-pf="${key}"]`);
  const options = field('props.options');
  options.focus();
  setValue(options, '法人\n\n 個人 ');
  assert.deepEqual(plain(parts()[0].props.options), ['法人', '個人'], '空の行を除き、前後の空白を取る');
  assert.deepEqual([...field('props.initial').options].map((o) => o.value), ['', '法人', '個人']);
  setValue(field('props.initial'), '法人');
  assert.equal($(app, '#stage .part.sel .pph').textContent, '選択してください');
  assert.equal($(app, '.ptable .c-set').textContent, '選択肢＝法人／個人\n初期値＝法人');

  add('checkbox');
  check($$(app, '#side-settings [data-pf="props.initial"]')[1], true);
  check($$(app, '#side-settings [data-pf="props.initial"]')[2], true);
  assert.deepEqual(plain(parts()[1].props.initial), ['選択肢 2', '選択肢 3']);
  assert.equal($$(app, '#stage .part.sel .pmark.ck.on').length, 2);
});

test('設定の欄: 打ちかけの文字は、ほかの部品を選ぶ前に保存される', async (t) => {
  const { app, api, add, partEl, parts } = await bootEditor(t);
  const a = add('text1');
  const b = add('number');
  api.selectPart(a.id);
  const label = $(app, '#side-settings [data-pf="label"]');
  label.focus();
  label.value = '顧客名';
  mouse(app, partEl(b.id), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, app.document, 'mouseup', {});
  assert.equal(parts()[0].label, '顧客名');
  assert.equal(api.ui.partId, b.id);
});

test('キー: Delete・矢印・Esc・Ctrl+C・Ctrl+V・Ctrl+D。入力欄の中では部品を動かさない', async (t) => {
  const { app, api, add, parts } = await bootEditor(t);
  const body = app.document.body;
  const p = add('text1');
  key(app, body, { key: 'ArrowRight' });
  key(app, body, { key: 'ArrowDown' });
  assert.deepEqual([parts()[0].x, parts()[0].y], [8, 48], '8 ドットずつ動く');
  key(app, body, { key: 'c', ctrlKey: true });
  key(app, body, { key: 'v', ctrlKey: true });
  key(app, body, { key: 'v', ctrlKey: true });
  assert.deepEqual(plain(parts().map((x) => [x.x, x.y, x.no])), [[8, 48, 1], [24, 64, 2], [40, 80, 3]], '貼り付けるたびにずらし、次の番号を付ける');
  key(app, body, { key: 'd', ctrlKey: true });
  assert.deepEqual(plain(parts()[3]).no, 4);
  assert.notEqual(parts()[3].id, parts()[2].id);

  const label = $(app, '#side-settings [data-pf="label"]');
  key(app, label, { key: 'Delete' });
  key(app, label, { key: 'ArrowLeft' });
  assert.equal(parts().length, 4, '入力欄の中の Delete では消さない');
  key(app, body, { key: 'Delete' });
  assert.equal(parts().length, 3);
  assert.equal(api.ui.partId, null);
  api.selectPart(p.id);
  key(app, body, { key: 'Escape' });
  assert.equal(api.ui.partId, null);
  assert.match($(app, '#side-settings').textContent, /画面設計の情報/, '選んでいないときは画面設計の情報');
});

test('メニューバーの編集: 選んでいないときは押せない。番号を振り直すは上から下・左から右の順', async (t) => {
  const { app, api, parts, screen } = await bootEditor(t);
  assert.ok($(app, '#tb-copy').disabled && $(app, '#tb-del').disabled && $(app, '#tb-paste').disabled && $(app, '#tb-renumber').disabled);
  const sid = screen().id;
  const did = api.ui.designId;
  const ids = [[400, 200], [24, 200], [24, 80]].map(([x, y]) => api.actions.addPart(did, sid, 'text1', { x, y }));
  assert.deepEqual(plain(parts().map((p) => p.no)), [1, 2, 3]);
  click($(app, '#tb-renumber'));
  assert.deepEqual(ids.map((id) => parts().find((p) => p.id === id).no), [3, 2, 1]);
  api.selectPart(ids[0]);
  assert.equal($(app, '#tb-copy').disabled, false);
  click($(app, '#tb-copy'));
  assert.equal($(app, '#tb-paste').disabled, false);
  click($(app, '#tb-del'));
  assert.equal(parts().length, 2);
});

// 窓の幅が狭いと、メニューバーの右が切れたため（q73・q74）。jsdom では位置を測れないので、出した組の位置は tools/shoot-app.js で確かめる
test('メニューバーのたたんだ組: 「揃える」「項目」はいつも 1 つのボタン。押すと組のボタンを下に出し、中のボタンを押したら閉じる', async (t) => {
  const { app, api, parts, screen } = await bootEditor(t);
  const fold = (k) => $(app, `#toolbar .fold-btn[data-fold="${k}"]`);
  const group = (k) => $(app, `#toolbar .rgroup[data-fold="${k}"]`);
  const isOpen = (k) => group(k).classList.contains('open') && fold(k).getAttribute('aria-expanded') === 'true';
  assert.deepEqual($$(app, '#toolbar .rgroup > .glabel').map((e) => e.textContent), ['ファイル', '画面', '履歴', '編集', '揃える', '項目', 'モード', '表示']);
  assert.match(fold('align').textContent, /揃える/);
  assert.match(fold('items').textContent, /項目/);
  // 中のボタンは #toolbar の中に残す（押せる・押せないを、ほかのボタンと同じく決めるため）
  assert.equal($$(app, '#toolbar .rgroup[data-fold="align"] .fold-pop [data-align-cmd]').length, 8);
  assert.ok($(app, '#toolbar .rgroup[data-fold="items"] .fold-pop [data-action="add-item-menu"]'));
  assert.ok($(app, '#toolbar .rgroup[data-fold="items"] .fold-pop [data-action="import-items"]'));
  assert.ok(!isOpen('align') && !isOpen('items'));
  assert.equal(fold('align').getAttribute('aria-expanded'), 'false');

  // 押すと開き、もう一度押すと閉じる。ほかの組を押すと入れ替わる。外を押すと閉じる
  click(fold('align'));
  assert.equal(api.ui.foldMenu, 'align');
  assert.ok(isOpen('align'));
  assert.ok($(app, '#toolbar').classList.contains('fold-open'), '出した組を真ん中の欄より前に出す');
  click(fold('align'));
  assert.equal(api.ui.foldMenu, null);
  assert.ok(!isOpen('align'));
  assert.ok(!$(app, '#toolbar').classList.contains('fold-open'));
  click(fold('align'));
  click(fold('items'));
  assert.ok(!isOpen('align') && isOpen('items'));
  click($(app, '#canvas-wrap'));
  assert.equal(api.ui.foldMenu, null);
  assert.ok(!isOpen('items'));

  // 2 つ選ぶと、出した「揃える」の「左」を押せる。押すと揃えて閉じる
  const did = api.ui.designId;
  const ids = [[24, 80], [200, 240]].map(([x, y]) => api.actions.addPart(did, screen().id, 'text1', { x, y }));
  api.runCommand('selectAll');
  click(fold('align'));
  const left = $(app, '#toolbar .fold-pop [data-action="align-left"]');
  assert.equal(left.disabled, false);
  click(left);
  assert.equal(api.ui.foldMenu, null, '押したら閉じる');
  const xs = ids.map((id) => parts().find((p) => p.id === id).x);
  assert.equal(xs[1], xs[0], '左に揃えた');
  // 押せないボタン（等間隔は 3 つから）を押しても閉じない
  click(fold('align'));
  const dist = $(app, '#toolbar .fold-pop [data-action="distribute-h"]');
  assert.equal(dist.disabled, true);
  click(dist);
  assert.equal(api.ui.foldMenu, 'align', '押せないボタンでは閉じない');
  // Esc で閉じ、組のボタンにフォーカスを戻す（選んだ部品はそのまま）
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.foldMenu, null);
  assert.equal(app.document.activeElement, fold('align'));
  assert.equal(api.ui.sel.length, 2, 'Esc は組を閉じるだけ');
  // 窓の大きさが変わると閉じる（出した組の位置がボタンからずれるため）。メニューバーを横に送っても閉じる
  click(fold('align'));
  app.window.dispatchEvent(new app.window.Event('resize'));
  assert.equal(api.ui.foldMenu, null);
  click(fold('align'));
  $(app, '#toolbar').dispatchEvent(new app.window.Event('scroll'));
  assert.equal(api.ui.foldMenu, null);
  // キーの命令（Ctrl+Z など）でも閉じる
  click(fold('align'));
  api.runCommand('undo');
  assert.equal(api.ui.foldMenu, null);

  // 「項目」の組の「項目を足す」は、データベースの項目の一覧表を開いて、種類のメニューを出す
  click(fold('items'));
  click($(app, '#toolbar .fold-pop [data-action="add-item-menu"]'));
  assert.equal(api.ui.foldMenu, null);
  assert.equal(api.ui.panel, 'items');
  assert.equal(api.ui.addItemMenu, true);
  // 画面設計を開き直すと閉じた状態から
  click(fold('items'));
  api.goHome();
  api.openDesign(did);
  assert.equal(api.ui.foldMenu, null);
  assert.ok(!isOpen('items'));
});

test('一覧表: 番号の順に並び、行を押すとその部品を選ぶ。画面の右か下かを選べる', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  assert.match($(app, '.ptable').textContent, /番号の付いた部品はまだありません/);
  const a = add('text1');
  add('heading');
  const c = add('button');
  api.actions.updatePart(api.ui.designId, screen().id, a.id, { numbered: false });
  api.actions.updatePart(api.ui.designId, screen().id, a.id, { numbered: true });
  assert.deepEqual($$(app, '.ptable tbody tr').map((r) => r.cells[0].textContent + r.cells[2].textContent), ['2ボタン', '3テキスト（1行）']);
  api.selectPart(null);
  click($(app, `.ptable tr[data-id="${a.id}"] td`));
  assert.equal(api.ui.partId, a.id);
  assert.ok($(app, `.ptable tr[data-id="${a.id}"]`).classList.contains('sel'));
  api.selectPart(null);
  const radio = $(app, '[data-field="table-pos"][value="bottom"]');
  check(radio, true);
  assert.equal(screen().tablePos, 'bottom');
  assert.ok($(app, '.stage-row').classList.contains('bottom'));
  assert.match($(app, '.ptable').getAttribute('style'), /width:1280px/);
  assert.equal(c.no, 2);
});

test('画面: 下の縁はいちばん下の部品より上げられない。機器を変えると、はみ出す部品を画面の中へ寄せる', async (t) => {
  const { app, api, screen, parts } = await bootEditor(t);
  const sid = screen().id;
  const did = api.ui.designId;
  api.actions.addPart(did, sid, 'text2', { x: 1000, y: 760 });
  api.actions.updateScreen(did, sid, { height: 1200 });
  api.actions.movePart(did, sid, parts()[0].id, { ...parts()[0], y: 1000 });
  api.actions.updateScreen(did, sid, { height: 800 });
  assert.equal(screen().height, 1120, '部品の下の端（1000＋120）まで');
  api.actions.updateScreen(did, sid, { device: 'phone' });
  const p = parts()[0];
  assert.deepEqual([p.x, p.w], [0, 368], '幅 375 の中に収める');
  assert.ok(p.x + p.w <= 375);
  assert.ok($(app, '#stage .part'));
});

test('データの形: 部品の足りない項目を補い、知らない種類・項目は残して描く', async (t) => {
  const { app, api } = await bootEditor(t);
  const { state } = api.migrate({
    designs: [{ id: 'd1', name: '顧客管理', screens: [{ id: 's1', parts: [
      { id: 'p1', type: 'text1', x: '24', no: 2, extra: 'x', props: { maxLen: '50', future: 1 } },
      { id: 'p2', type: 'chart', x: 8, y: 8, w: 200, h: 120, no: 3, data: [1, 2] },
      'bad',
    ] }] }],
  });
  const design = state.designs[0];
  const [p1, p2] = design.screens[0].parts;
  assert.equal(design.screens[0].parts.length, 2);
  assert.deepEqual(plain([p1.x, p1.y, p1.w, p1.h, p1.no, p1.labelPos, p1.extra]), [24, 0, 320, 64, 2, 'top', 'x']);
  assert.equal(design.items.length, 1, '入力欄の部品から項目を 1 つ作る');
  const item = design.items[0];
  assert.equal(p1.itemId, item.id);
  assert.equal(p1.label, undefined, '項目名と設定は項目に移す');
  assert.deepEqual(plain([item.name, item.type, item.required, item.memo]), ['項目名', 'text1', false, '']);
  assert.deepEqual(plain(item.props), { maxLen: '50', initial: '', future: 1 });
  assert.deepEqual(plain([p2.type, p2.no, p2.data]), ['chart', 3, [1, 2]], '知らない種類の部品は中身を残す');

  api.store.commit((s) => { s.designs = state.designs; });
  api.openDesign('d1');
  assert.match($(app, '#stage .pt-unknown').textContent, /この版では描けない部品（chart）/);
  assert.match($(app, '.ptable').textContent, /この版では描けない部品/);
  mouse(app, $(app, '#stage .pt-unknown'), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, app.document, 'mouseup', {});
  assert.match($(app, '#side-settings').textContent, /この版では設定を変えられません/);
});

test('純関数: 設定の文・マス目への吸い付き・番号の振り直し・画面の低さの下限', async (t) => {
  const { api } = await bootEditor(t);
  const part = (type, { props = {}, ...rest } = {}) => ({ type, required: false, memo: '', ...rest, props: { ...api.PART_TYPES[type].props, ...props } });
  const d = (type, extra) => api.describePart(part(type, extra));
  assert.equal(d('number', { required: true, props: { min: '0', max: '9999', decimals: '0', unit: '人' } }), '必須・0〜9999・小数なし\n単位＝人');
  assert.equal(d('number', { props: { max: '100', decimals: '2' } }), '100 以下・小数 2 桁');
  assert.equal(d('date', { required: true, props: { initial: 'today' } }), '必須\n初期値＝今日');
  assert.equal(d('date', { props: { initial: 'date', initialDate: '2026-10-08' } }), '初期値＝2026-10-08');
  assert.equal(d('datetime', { props: { initial: 'now' } }), '初期値＝今の日時');
  assert.equal(d('radio', { props: { options: ['法人', '個人'], initial: '法人' } }), '選択肢＝法人／個人\n初期値＝法人');
  assert.equal(d('checkbox', { props: { options: ['電話', 'メール'], initial: [] } }), '選択肢＝電話／メール');
  assert.equal(d('user', { required: true, props: { multiple: true, scope: '営業部の社員' } }), '必須・複数人を選べる\n選べる人＝営業部の社員');
  assert.equal(d('file', { required: true, props: { maxCount: '3', accept: 'PDF' } }), '必須・3 個まで\nファイル＝PDF');
  assert.equal(d('calc', { props: { formula: '数量×単価', unit: '円' } }), '計算式＝数量×単価\n単位＝円');
  assert.equal(d('button', { required: true, props: { action: '一覧の画面へ戻る' } }), '押したとき＝一覧の画面へ戻る', 'ボタンに必須は出さない');
  assert.equal(d('desc', { memo: '  注意書き ' }), '注意書き');
  assert.equal(d('text2', {}), '');

  const sc = { width: 375, height: 667 };
  assert.deepEqual(plain(api.fitRect({ x: 300, y: -20, w: 323, h: 61 }, sc)), { x: 48, y: 0, w: 320, h: 64 }, '幅 375 の画面では、右の端の 368 まで');
  assert.deepEqual(plain(api.fitRect({ x: 0, y: 0, w: 900, h: 4 }, sc)), { x: 0, y: 0, w: 368, h: 16 });
  assert.deepEqual(plain(api.resizedRect({ x: 40, y: 40, w: 80, h: 40 }, 'nw', -13, -100, sc)), { x: 24, y: 0, w: 96, h: 80 });

  const ps = [{ id: 'a', x: 400, y: 80, no: 1 }, { id: 'b', x: 24, y: 80, no: 5 }, { id: 'c', x: 0, y: 40, no: null }, { id: 'd', x: 0, y: 200, no: 2 }];
  assert.deepEqual(plain(api.renumberedParts(ps).map((p) => p.no)), [2, 1, null, 3]);
  assert.equal(api.minScreenHeight({ device: 'phone', parts: [{ y: 600, h: 80 }] }), 683);
  assert.equal(api.minScreenHeight({ device: 'pc', parts: [{ y: 0, h: 64 }] }), 800);
});

test('画面設計の複製: 部品も写し、部品の id は新しくする', async (t) => {
  const { api, add } = await bootEditor(t);
  const p = add('text1');
  const copyId = api.actions.duplicateDesign(api.ui.designId);
  const copy = api.store.state.designs.find((d) => d.id === copyId);
  assert.equal(copy.screens[0].parts.length, 1);
  assert.notEqual(copy.screens[0].parts[0].id, p.id);
  assert.equal(copy.items.length, 1, '項目も写す');
  assert.equal(copy.screens[0].parts[0].itemId, copy.items[0].id);
  assert.equal(api.resolvePart(copy, copy.screens[0].parts[0]).label, '項目名');
});

// ── 見直しで見つかった不具合のテスト ──

test('選択肢を書き換えると、なくなった選択肢は初期値から外す（ドロップダウン・チェックボックス）', async (t) => {
  const { app, api, add, parts, screen } = await bootEditor(t);
  const did = api.ui.designId;
  const d = add('dropdown');
  api.actions.updatePart(did, screen().id, d.id, { props: { initial: '選択肢 2' } });
  api.actions.updatePart(did, screen().id, d.id, { props: { options: ['法人', '個人'] } });
  assert.equal(parts()[0].props.initial, '');
  assert.equal($(app, `.ptable tr[data-id="${d.id}"] .c-set`).textContent, '選択肢＝法人／個人');
  const c = add('checkbox');
  api.actions.updatePart(did, screen().id, c.id, { props: { initial: ['選択肢 1', '選択肢 3'] } });
  api.actions.updatePart(did, screen().id, c.id, { props: { options: ['選択肢 1', '電話'] } });
  assert.deepEqual(plain(parts()[1].props.initial), ['選択肢 1']);
});

test('選択肢を打っている間も初期値の欄が追いつき、離れたときには作り直さない（押した四角が消えない）', async (t) => {
  const { app, add } = await bootEditor(t);
  add('checkbox');
  const options = $(app, '#side-settings [data-pf="props.options"]');
  options.focus();
  options.value = '電話\nメール\nFAX';
  options.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  const boxes = $$(app, '#pf-initial input');
  assert.deepEqual(boxes.map((b) => b.value), ['電話', 'メール', 'FAX']);
  options.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal($$(app, '#pf-initial input')[0], boxes[0], '同じ選択肢なら初期値の欄を作り直さない');
  check(boxes[0], true);
  assert.match($(app, '.ptable .c-set').textContent, /選択肢＝電話／メール／FAX\n初期値＝電話/);
});

test('一覧表の行は押した時点（mousedown）で選ぶ。打ちかけの文字は前の部品に保存する', async (t) => {
  const { app, api, add, parts } = await bootEditor(t);
  const a = add('text1');
  const b = add('number');
  api.selectPart(a.id);
  const label = $(app, '#side-settings [data-pf="label"]');
  label.focus();
  label.value = '顧客名';
  mouse(app, $(app, `.ptable tr[data-id="${b.id}"] td`), 'mousedown', {});
  assert.equal(api.ui.partId, b.id);
  assert.equal(parts()[0].label, '顧客名');
  assert.equal(parts()[1].label, '項目名', '後から選んだ部品には書かない');
});

test('機器の種類を変えても、部品を縦に寄せて重ねない（画面を下へ伸ばして収める）', async (t) => {
  const { api, screen, parts } = await bootEditor(t);
  const did = api.ui.designId;
  const sid = screen().id;
  api.actions.addPart(did, sid, 'button', { x: 400, y: 736 });
  api.actions.addPart(did, sid, 'button', { x: 400, y: 680 });
  api.actions.updateScreen(did, sid, { device: 'phone' });
  assert.deepEqual(plain(parts().map((p) => [p.x, p.y])), [[272, 736], [272, 680]], '縦は動かさず、横だけ画面の中へ寄せる');
  assert.equal(screen().height, 779, 'スマホの 1 画面分（667）から 8 ドットずつ、いちばん下の部品（776）まで伸ばす');
});

test('矢印のキーで動かせないとき（画面の端）は、履歴に積まない', async (t) => {
  const { app, api, add } = await bootEditor(t);
  add('text1');
  const n = api.store.undoStack.length;
  for (let i = 0; i < 3; i++) key(app, app.document.body, { key: 'ArrowLeft' });
  assert.equal(api.store.undoStack.length, n);
});

test('ボタンの番号は、左に入る幅がないときは左上の角に重ねる', async (t) => {
  const { app, api, screen } = await bootEditor(t);
  const did = api.ui.designId;
  const near = api.actions.addPart(did, screen().id, 'button', { x: 0, y: 200 });
  const far = api.actions.addPart(did, screen().id, 'button', { x: 200, y: 200 });
  const no = (id) => app.document.querySelector(`#stage .part[data-part-id="${id}"] .pno`).className;
  assert.match(no(near), /pno-corner/);
  assert.match(no(far), /pno-out/);
});

test('読み込んだデータが思わぬ形でも起動でき、部品の id の重なり・文字の番号・形の違う設定を直す', async (t) => {
  const raw = {
    schemaVersion: 1,
    designs: [{ id: 'd1', name: '顧客管理', screens: [
      { id: 's1', parts: [
        { id: 'p1', type: 'radio', x: 8, y: 48, no: '2', props: { options: '法人,個人', initial: 3, dir: 'v' } },
        { id: 'p1', type: 'constructor', x: 8, y: 160, w: 0, h: -5 },
        { id: 'p3', type: 'user', props: { multiple: 'yes', scope: 12 } },
      ] },
    ] }],
  };
  const app = bootApp({ localStorage: { 'mockimagemaker.v1': JSON.stringify(raw) } });
  const api = await app.api();
  t.after(() => app.close());
  assert.equal($(app, '#banner').hidden, true, '警告は出さない');
  assert.equal($$(app, '.card').length, 1, '一覧が出る');
  const design = api.store.state.designs[0];
  const [p1, p2, p3] = design.screens[0].parts.map((p) => api.resolvePart(design, p));
  assert.notEqual(p1.id, p2.id, '重なった id は付け直す');
  assert.deepEqual(plain([p1.no, p1.props.options, p1.props.initial, p1.props.dir]), [2, ['選択肢 1', '選択肢 2'], '', 'v']);
  assert.deepEqual(plain([p2.type, p2.w, p2.h]), ['constructor', 16, 16], '知らない種類は残し、見えない大きさは 16 にする');
  assert.deepEqual(plain([p3.props.multiple, p3.props.scope]), [true, '12']);
  api.openDesign('d1');
  assert.match($(app, `#stage .part[data-part-id="${p2.id}"]`).textContent, /この版では描けない部品（constructor）/);
  api.selectPart(p1.id);
  assert.match($(app, '#side-settings .panel-title').textContent, /番号 2・ラジオボタン/);
});

// ── 第 3 段階の後半の部品（表・グラフと、一覧の画面用・進み具合の画面用・見た目用。画像 q24〜q26）──

test('後半の部品: 最初の大きさ・赤い番号・見た目。表はテーブルの項目、ステータスの 2 つは 1 つのステータスの項目を指す', async (t) => {
  const { app, api, parts, add, partEl } = await bootEditor(t);
  const sizes = {
    table: [640, 168], graph: [480, 320], search: [320, 40], filter: [480, 40], pager: [360, 32],
    status: [160, 32], steps: [560, 40], tabs: [480, 40], image: [240, 160], link: [200, 24], icon: [32, 32],
  };
  const placed = Object.keys(sizes).map((type) => add(type));
  placed.forEach((p) => assert.deepEqual(plain([p.type, p.w, p.h]), plain([p.type, ...sizes[p.type]])));
  assert.deepEqual(plain(placed.filter((p) => p.no == null).map((p) => p.type)), ['image', 'icon'], '画像の置き場とアイコンには番号を付けない');
  const design = api.currentDesign();
  assert.deepEqual(plain(design.items.map((it) => [it.type, it.name])), [['table', '明細'], ['status', 'ステータス']]);
  const [table, , , , , status, steps] = parts();
  assert.equal(table.tableKind, 'subtable');
  assert.equal(status.itemId, steps.itemId, 'ステータスの印と進み具合の矢印は同じ項目');
  assert.deepEqual(plain(status.props.states.map((s) => s.name)), ['申請', '承認待ち', '承認済み', '完了']);
  const el = (p, sel) => partEl(p.id).querySelector(sel);
  assert.equal(el(placed[0], '.ptbl').querySelectorAll('th').length, 3, 'テーブルの最初の列は 3 つ');
  assert.equal(el(placed[0], '.ptbl-ops').children.length, 3, '行ごとに ＋ − を描く');
  assert.ok(el(placed[1], '.pgraph svg rect'), 'グラフは見本の値から描く');
  assert.match(el(placed[2], '.psearch').textContent, /キーワードで探す.*検索/);
  assert.match(el(placed[4], '.ppager').textContent, /200 件中 1〜20 件/);
  assert.equal(el(placed[5], '.pbadge').textContent, '承認待ち');
  assert.equal(el(placed[6], '.psteps .on').textContent, '承認待ち');
  assert.equal(el(placed[6], '.psteps .done').textContent, '申請');
  assert.equal(el(placed[7], '.ptabs .on').textContent, '基本情報');
  assert.match(el(placed[8], '.pimage').textContent, /画像/);
  assert.equal(el(placed[9], '.plink').textContent, 'リンクの文字');
  assert.ok(el(placed[10], '.picon-wrap svg'));
  assert.equal($$(app, '.pal-item').length, 2, '部品の箱の項目の組に、明細とステータスが並ぶ');
  assert.ok(api.actions.addItemPart(design.id, api.currentScreen().id, status.itemId, { x: 0, y: 600 }), 'ステータスは同じ画面に何度でも置ける');
});

test('表（テーブル）: 列の名前・種類・見本の値・幅を書き、見本の行の数で高さが変わる。一覧表は列ごとに枝番の行', async (t) => {
  const { app, api, parts, add } = await bootEditor(t);
  const p = add('table');
  api.selectPart(p.id);
  const cols = () => api.currentDesign().items[0].props.columns;
  click($(app, `#side-settings [data-action="tb-col"][data-id="${cols()[1].id}"]`));
  setValue($(app, '#side-settings [data-tb="col.name"]'), '数量');
  setValue($(app, '#side-settings [data-tb="col.type"]'), 'number');
  setValue($(app, '#side-settings [data-tb="col.props.min"]'), '1');
  check($(app, '#side-settings [data-tb="col.required"]'), true);
  assert.deepEqual(plain([cols()[1].name, cols()[1].type, cols()[1].props.min, cols()[1].required]), ['数量', 'number', '1', true]);
  setValue($(app, '#side-settings [data-tb="sample"]'), '10\n20');
  setValue($(app, '#side-settings [data-tb="width"]'), '90');
  setValue($(app, '#side-settings [data-tb="rows"]'), '5');
  const now = parts()[0];
  assert.deepEqual(plain([now.view.samples[cols()[1].id], now.view.widths[cols()[1].id], now.view.rows, now.h]), [['10', '20'], 90, 5, 240]);
  const cells = $$(app, '#stage .ptbl tr')[1].querySelectorAll('td');
  assert.equal(cells[1].textContent, '10');
  click($(app, '#side-settings [data-action="tb-col-add"]'));
  assert.equal(cols().length, 4);
  click($(app, `#side-settings [data-action="tb-col-up"][data-id="${cols()[3].id}"]`));
  assert.equal(cols()[2].name, '列 4', '並べ替え');
  const rows = $$(app, '.ptable tbody tr').map((r) => [r.children[0].textContent, r.children[1].textContent, r.children[2].textContent]);
  assert.deepEqual(plain(rows.slice(0, 3)), [['1', '明細', '表（テーブル）'], ['1-1', '列 1', 'テキスト（1行）'], ['1-2', '数量', '数値']]);
  assert.match($$(app, '.ptable tbody tr')[2].children[3].textContent, /必須・1 以上/);
  assert.ok($$(app, '.ptable tbody tr')[1].classList.contains('br'));
});

test('表の中身: レコード一覧にするとテーブルの項目を消し、列は項目から選ぶ。関連レコード一覧は元のデータベースと条件を書く', async (t) => {
  const { app, api, parts, add } = await bootEditor(t);
  const did = api.ui.designId;
  const code = api.actions.addItem(did, 'text1');
  api.actions.updateItem(did, code, { label: '顧客コード' });
  const p = add('table');
  api.selectPart(p.id);
  check($(app, '#side-settings [data-tb="kind"][value="records"]'), true);
  let now = parts()[0];
  assert.equal(now.tableKind, 'records');
  assert.equal(now.itemId, undefined);
  assert.deepEqual(plain(api.currentDesign().items.map((it) => it.name)), ['顧客コード'], 'ほかで使っていないテーブルの項目は消す');
  assert.deepEqual(plain(now.props.columns.map((c) => c.ref.name)), ['顧客コード'], '列はこの画面設計の項目から');
  setValue($(app, '#side-settings [data-pf="props.sort"]'), '顧客コードの小さい順');
  assert.match($$(app, '.ptable tbody tr')[0].children[3].textContent, /1 ページ 20 件.*並べ順＝顧客コードの小さい順/s);
  assert.equal($$(app, '.ptable tbody tr')[1].children[0].textContent, '1-1');
  assert.ok($(app, '#stage .ptbl td.ic'), 'レコード一覧は左に詳しく見る印の列');
  // 関連レコード一覧
  const orderId = api.actions.createDesign('受注管理', 'kintone');
  const ono = api.actions.addItem(orderId, 'text1');
  api.actions.updateItem(orderId, ono, { label: '受注番号' });
  const ocode = api.actions.addItem(orderId, 'text1');
  api.actions.updateItem(orderId, ocode, { label: '顧客コード' });
  api.selectPart(null);
  api.selectPart(p.id);
  check($(app, '#side-settings [data-tb="kind"][value="related"]'), true);
  setValue($(app, '#side-settings [data-tb="db"]'), 'd:' + orderId);
  setValue($(app, '#side-settings [data-tb="condFrom"]'), ocode);
  setValue($(app, '#side-settings [data-tb="condTo"]'), code);
  setValue($(app, '#side-settings [data-tb="addCol"]'), ono);
  setValue($(app, '#side-settings [data-pf="props.limit"]'), '5');
  now = parts()[0];
  assert.equal(now.label, '関連レコード一覧');
  assert.match($(app, '#stage .part .reftag').textContent, /受注管理/);
  const set = $$(app, '.ptable tbody tr')[0].children[3].textContent;
  assert.match(set, /関連レコード一覧＝受注管理/);
  assert.match(set, /条件＝受注管理の「顧客コード」がこのレコードの「顧客コード」と同じ/);
  assert.match(set, /最大 5 件/);
  assert.deepEqual(plain([...$$(app, '.ptable tbody tr')[1].children].map((c) => c.textContent)), ['1-1', '受注番号', 'テキスト（1行）', '受注管理の項目']);
  // テーブルに戻すと、新しいテーブルの項目を作る
  check($(app, '#side-settings [data-tb="kind"][value="subtable"]'), true);
  assert.equal(api.currentDesign().items.length, 2);
  assert.equal(parts()[0].itemId, api.currentDesign().items[1].id);
});

test('グラフ: 種類・分類・集計・見本の値。一覧表に「グラフ＝」「分類＝」「集計＝」を書く', async (t) => {
  const { app, api, add, partEl } = await bootEditor(t);
  const did = api.ui.designId;
  const date = api.actions.addItem(did, 'date');
  api.actions.updateItem(did, date, { label: '受注日' });
  const amount = api.actions.addItem(did, 'number');
  api.actions.updateItem(did, amount, { label: '合計金額' });
  const g = add('graph');
  assert.equal(partEl(g.id).querySelectorAll('.pgraph rect').length, 6, '最初の見本の値は 6 か月分');
  api.selectPart(g.id);
  setValue($(app, '#side-settings [data-pf="label"]'), '月ごとの受注金額');
  setValue($(app, '#side-settings [data-pf="props.byItem"]'), date);
  setValue($(app, '#side-settings [data-pf="props.byUnit"]'), '月ごと');
  setValue($(app, '#side-settings [data-pf="props.aggItem"]'), amount);
  setValue($(app, '#side-settings [data-pf="props.unit"]'), '万円');
  setValue($(app, '#side-settings [data-pf="props.samples"]'), '法人, 60\n個人, 30\n官公庁, 10');
  check($(app, '#side-settings [data-pf="props.chart"][value="pie"]'), true);
  assert.equal(partEl(g.id).querySelectorAll('.pgraph path').length, 3, '円グラフは 3 つに分ける');
  assert.match(partEl(g.id).querySelector('.pgraph').textContent, /法人　60（60%）/);
  assert.equal($(app, '.ptable tbody tr').children[3].textContent, 'グラフ＝円グラフ\n分類＝受注日（月ごと）\n集計＝合計金額の合計（万円）');
  setValue($(app, '#side-settings [data-pf="props.agg"]'), 'count');
  assert.match($(app, '.ptable').textContent, /集計＝レコードの件数（万円）/);
});

test('検索の欄・絞り込みの欄・ページ送り・タブ・リンク・アイコンの設定の欄と一覧表の文', async (t) => {
  const { app, api, parts, add, partEl } = await bootEditor(t);
  const did = api.ui.designId;
  const ids = ['区分', '担当者', '受注日'].map((label) => {
    const id = api.actions.addItem(did, 'text1');
    api.actions.updateItem(did, id, { label });
    return id;
  });
  const set = (sel, v) => setValue($(app, `#side-settings ${sel}`), v);
  const s = add('search');
  api.selectPart(s.id);
  check($(app, `#side-settings [data-pf="props.items"][value="${ids[0]}"]`), true);
  check($(app, `#side-settings [data-pf="props.items"][value="${ids[2]}"]`), true);
  check($(app, '#side-settings [data-pf="props.button"]'), false);
  assert.equal(partEl(s.id).querySelector('.psearch b'), null, '「検索」ボタンなし');
  const f = add('filter');
  api.selectPart(f.id);
  set('[data-fl="add"]', ids[1]);
  set('[data-fl="add"]', ids[0]);
  set('[data-fl="value"][data-i="1"]', '法人');
  click($(app, '#side-settings [data-action="fl-up"][data-i="1"]'));
  assert.deepEqual(plain([parts()[1].props.items, parts()[1].props.values]), plain([[ids[0], ids[1]], ['法人', '']]));
  assert.match(partEl(f.id).textContent, /絞り込み:区分法人▼担当者すべて▼/);
  const pg = add('pager');
  api.selectPart(pg.id);
  set('[data-pf="props.perPage"]', '50');
  const tb = add('tabs');
  api.selectPart(tb.id);
  set('[data-pf="props.tabs"]', '基本情報\n明細');
  set('[data-pf="props.current"]', '明細');
  assert.equal(partEl(tb.id).querySelector('.ptabs .on').textContent, '明細');
  const ln = add('link');
  // 移る画面には、開いている画面は出ない（「この画面設計のほかの画面」）ので、画面をもう 1 つ足して選ぶ
  const other = api.actions.addScreen(api.currentDesign().id, 'blank', api.currentScreen().id);
  api.selectPart(ln.id);
  set('[data-pf="props.to"]', 'screen');
  set('[data-pf="props.screenId"]', other);
  const ic = add('icon');
  api.selectPart(ic.id);
  set('[data-pf="props.icon"]', 'bell');
  check($(app, '#side-settings [data-pf="props.color"][value="red"]'), true);
  assert.equal(partEl(ic.id).querySelector('svg').getAttribute('stroke'), '#dc2626');
  const rows = $$(app, '.ptable tbody tr').map((r) => `${r.children[2].textContent}｜${r.children[3].textContent}`);
  assert.deepEqual(plain(rows), [
    '検索の欄｜「検索」ボタンなし\n探す項目＝区分・受注日',
    '絞り込みの欄｜絞り込む項目＝区分・担当者',
    'ページ送り｜1 ページ 50 件',
    'タブ｜タブ＝基本情報／明細',
    'リンクの文字｜移る先＝画面 2の画面',
  ]);
});

test('ステータス: 並びは項目に 1 つ。並びを直すと、ステータスの印と進み具合の矢印の両方が変わる', async (t) => {
  const { app, api, add, partEl } = await bootEditor(t);
  const st = add('status');
  const sp = add('steps');
  api.selectPart(sp.id);
  // ステータスの並びは、右の欄のステータスの行で直す（第 8 段階。画像 q52 の案A）。完了を消し、残りの 3 つの名前を変える
  const item = () => api.currentDesign().items.find((it) => it.type === 'status');
  const stateId = (n) => item().props.states.find((s) => s.name === n).id;
  api.actions.deleteState(api.currentDesign().id, item().id, stateId('完了'));
  [['申請', '受付'], ['承認待ち', '対応中'], ['承認済み', '完了']].forEach(([from, to]) => setValue($(app, `#side-settings [data-ps="${stateId(from)}"]`), to));
  assert.deepEqual(plain([...partEl(sp.id).querySelectorAll('.psteps span')].map((e) => e.textContent)), ['受付', '対応中', '完了']);
  // 見本で出すステータスの選ぶ欄の値は、ステータスの id（データの形の版 3）
  setValue($(app, '#side-settings [data-pf="view.current"]'), stateId('完了'));
  assert.equal(partEl(sp.id).querySelectorAll('.psteps .done').length, 2);
  api.selectPart(st.id);
  setValue($(app, '#side-settings [data-pf="view.current"]'), stateId('対応中'));
  check($(app, '#side-settings [data-pf="view.showWord"]'), false);
  assert.equal(partEl(st.id).querySelector('.pstatus').textContent.trim(), '対応中');
  const rows = $$(app, '.ptable tbody tr').map((r) => r.children[3].textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^ステータス＝受付／対応中／完了/);
  assert.match(rows[1], /^ステータス＝受付 → 対応中 → 完了/);
  assert.match(rows[0], /操作「承認する」＝対応中から完了へ/, '見本の操作も、名前を変えたステータスで書く');
  assert.equal(api.currentDesign().items.length, 1);
});

// ── 吹き出し（画像 q27）──

test('吹き出し: 部品を選んで部品の箱の「吹き出し」を押すと、その部品の右上につないで置く。線と点を描く', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  const p = add('text1');
  api.selectPart(p.id);
  click($(app, '.pal-btn[data-type="callout"]'));
  const c = screen().callouts[0];
  assert.deepEqual(plain([c.x, c.y, c.w, c.h, c.target, c.color, c.tip, c.text]), [344, -56, 200, 80, p.id, 'yellow', 'dot', '説明を書きます。']);
  assert.equal(api.ui.calloutId, c.id, '置いた吹き出しを選ぶ');
  assert.ok($(app, '#stage .callout.sel.cc-yellow'));
  assert.equal($$(app, '#co-lines line').length, 1);
  assert.equal($$(app, '#co-lines circle').length, 1, '線の先は点');
  assert.ok($(app, '#stage [data-co-handle]'), '線の先の ○');
  assert.match($(app, '#side-settings .panel-title').textContent, /選んだ吹き出しの設定/);
  assert.equal($(app, '.ptable').textContent.includes('説明を書きます'), false, '一覧表には入らない');
  assert.equal($(app, '.sl-thumb .callout'), null, '縮小画像には描かない');
});

test('吹き出しの設定の欄: 文字・つなぐ部品・線の先の形・色', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  const a = add('text1');
  const b = add('button');
  const id = api.actions.addCallout(api.ui.designId, screen().id, { x: -232, y: 100 }, null);
  api.selectPart(null);
  click($(app, `#stage .callout[data-callout-id="${id}"]`));
  mouse(app, $(app, `#stage .callout[data-callout-id="${id}"]`), 'mousedown', { clientX: 0, clientY: 0 });
  mouse(app, app.document, 'mouseup', {});
  assert.equal(api.ui.calloutId, id);
  setValue($(app, '#side-settings [data-co="text"]'), '50 文字を超えたら赤い字で知らせる');
  setValue($(app, '#side-settings [data-co="target"]'), a.id);
  check($(app, '#side-settings [data-co="tip"][value="arrow"]'), true);
  check($(app, '#side-settings [data-co="color"][value="red"]'), true);
  const c = screen().callouts[0];
  assert.deepEqual(plain([c.text, c.target, c.tip, c.color]), ['50 文字を超えたら赤い字で知らせる', a.id, 'arrow', 'red']);
  assert.ok($(app, '#stage .callout.cc-red'));
  assert.match($(app, '#co-lines line').getAttribute('marker-end'), /co-arrow-red/);
  assert.equal($(app, '#co-lines line').getAttribute('stroke'), '#dc2626', '線の色も枠に合わせる');
  assert.equal($$(app, '#side-settings [data-co="target"] option').length, 3, 'つながない・部品 2 つ');
  assert.ok(b);
});

test('吹き出し: 置ける範囲は画面のまわり 240 ドットまで。つないだ部品を消すと線だけ消え、元に戻すで戻る', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  const p = add('text1');
  const id = api.actions.addCallout(api.ui.designId, screen().id, { x: -1000, y: 5000 }, p.id);
  const c = () => screen().callouts[0];
  assert.deepEqual(plain([c().x, c().y]), [-240, 800 + 240 - 80], '範囲の中へ寄せる');
  api.actions.moveCallout(api.ui.designId, screen().id, id, { ...c(), x: 2000 });
  assert.equal(c().x, 1280 + 240 - 200);
  api.selectPart(p.id);
  api.runCommand('deletePart');
  assert.equal(c().target, null, '吹き出しは残り、線を外す');
  assert.equal($$(app, '#co-lines line').length, 0);
  api.store.undo();
  assert.equal(c().target, p.id);
  api.actions.updateScreen(api.ui.designId, screen().id, { device: 'phone' });
  assert.equal(c().x, 375 + 240 - 200, '画面が狭くなると、吹き出しも範囲の中へ寄せる');
});

test('吹き出し: Delete で消す・矢印のキーで 8 ドット動かす・Esc で選ぶのをやめる', async (t) => {
  const { app, api, screen } = await bootEditor(t);
  const id = api.actions.addCallout(api.ui.designId, screen().id, { x: 16, y: 64 }, null);
  api.ui.calloutId = id;
  api.runCommand('moveRight');
  assert.equal(screen().callouts[0].x, 24);
  key(app, app.document.body, { key: 'Escape' });
  assert.equal(api.ui.calloutId, null);
  api.ui.calloutId = id;
  key(app, app.document.body, { key: 'Delete' });
  assert.equal(screen().callouts.length, 0);
});

test('読み込み: 吹き出しの足りない値を補い、知らない色・形は最初の値にする', async (t) => {
  const { api } = await bootEditor(t);
  const { state } = api.migrate({ schemaVersion: 2, designs: [{ id: 'd1', name: '顧客管理', items: [], screens: [{ id: 's1', parts: [], callouts: [
    { id: 'k1', x: '-16', y: 8, text: 'メモ', color: 'pink', tip: 'zigzag', extra: 1 }, 'bad',
  ] }] }] });
  const c = state.designs[0].screens[0].callouts;
  assert.equal(c.length, 1);
  assert.deepEqual(plain([c[0].x, c[0].w, c[0].h, c[0].color, c[0].tip, c[0].target, c[0].extra]), [-16, 200, 80, 'yellow', 'dot', null, 1]);
});

// ── まとめて選ぶ・動かす・揃える（画像 q28）──

// 3 つの部品（x がばらばら）を置く
async function bootThree(t) {
  const ctx = await bootEditor(t);
  const { api, screen } = ctx;
  const did = api.ui.designId;
  const ids = [[160, 48, 320], [40, 160, 240], [96, 272, 400]].map(([x, y, w]) => {
    const id = api.actions.addPart(did, screen().id, 'text1', { x, y });
    const p = screen().parts.find((q) => q.id === id);
    api.actions.movePart(did, screen().id, id, { ...p, x, y, w });
    return id;
  });
  api.selectPart(null);
  return { ...ctx, did, ids, at: (id) => screen().parts.find((p) => p.id === id) };
}
const ctrlClick = (app, el) => {
  mouse(app, el, 'mousedown', { clientX: 10, clientY: 10, ctrlKey: true });
  mouse(app, app.document, 'mouseup', { clientX: 10, clientY: 10, ctrlKey: true });
};

test('まとめて選ぶ: Ctrl を押しながら押すと足す・もう一度押すと外す。右の欄に「揃える」を出し、最初に選んだものに「基準」の札', async (t) => {
  const { app, api, ids, partEl } = await bootThree(t);
  ctrlClick(app, partEl(ids[1]));
  ctrlClick(app, partEl(ids[0]));
  assert.deepEqual(plain(api.ui.sel.map((x) => x.id)), plain([ids[1], ids[0]]));
  assert.equal(api.ui.partId, null, '2 つ選んでいるときは partId は空');
  assert.match($(app, '#side-settings .panel-title').textContent, /2 個を選んでいます ?（部品 2・吹き出し 0）/);
  assert.ok(partEl(ids[1]).classList.contains('sel-ref'), '最初に選んだものが基準');
  assert.ok($(app, '#stage .sel-box'), '全体を点線で囲む');
  assert.equal($$(app, '#stage .grip').length, 0, '縁のつまみは出さない');
  assert.equal($(app, '#toolbar [data-action="align-left"]').disabled, false);
  assert.equal($(app, '#toolbar [data-action="distribute-h"]').disabled, true, '等間隔は 3 つから');
  assert.equal($$(app, '.ptable tr.sel').length, 2, '一覧表の行も 2 つ選んだ印');
  ctrlClick(app, partEl(ids[1]));
  assert.equal(api.ui.partId, ids[0], 'もう一度押すと外す');
  key(app, app.document.body, { key: 'a', ctrlKey: true });
  assert.equal(api.ui.sel.length, 3, 'Ctrl+A で全部');
});

test('揃える: 基準（最初に選んだもの）に合わせる。等間隔・同じ幅。元に戻すで 1 回で戻る', async (t) => {
  const { app, api, ids, at } = await bootThree(t);
  api.ui.sel = [{ k: 'p', id: ids[0] }, { k: 'p', id: ids[1] }, { k: 'p', id: ids[2] }];
  api.runCommand('alignLeft');
  assert.deepEqual(plain(ids.map((id) => at(id).x)), [160, 160, 160], 'いちばん左（40）ではなく、基準の 160 に合わせる');
  assert.ok(app, 'メニューバーのボタンは 1 つ目のテストで確かめた');
  api.store.undo();
  assert.deepEqual(plain(ids.map((id) => at(id).x)), [160, 40, 96]);
  api.runCommand('alignRight');
  assert.deepEqual(plain(ids.map((id) => at(id).x + at(id).w)), [480, 480, 480]);
  api.runCommand('sameWidth');
  assert.deepEqual(plain(ids.map((id) => at(id).w)), [320, 320, 320]);
  api.actions.movePart(api.ui.designId, api.currentScreen().id, ids[1], { ...at(ids[1]), y: 120 });
  api.runCommand('distributeV');
  const ys = ids.map((id) => at(id).y);
  assert.equal(ys[1] - (ys[0] + 64), ys[2] - (ys[1] + 64), '縦の間が等しい');
  assert.deepEqual([ys[0], ys[2]], [48, 272], '両端は動かさない');
});

test('まとめて動かす・消す・番号: 矢印のキーは全部を動かし、端に当たったところで止める', async (t) => {
  const { app, api, ids, at, screen } = await bootThree(t);
  const cid = api.actions.addCallout(api.ui.designId, screen().id, { x: -232, y: 48 }, ids[0]);
  api.runCommand('selectAll');
  assert.equal(api.ui.sel.length, 4, '部品 3 と吹き出し 1');
  key(app, app.document.body, { key: 'ArrowLeft' });
  assert.deepEqual(plain([at(ids[1]).x, screen().callouts[0].x]), [32, -240], 'まとめて 8 ドット');
  key(app, app.document.body, { key: 'ArrowLeft' });
  assert.equal(screen().callouts[0].x, -240, '吹き出しが範囲の端に当たったので、全部止める');
  assert.equal(at(ids[1]).x, 32);
  api.ui.sel = ids.map((id) => ({ k: 'p', id }));
  api.runCommand('numberOff');
  assert.deepEqual(plain(ids.map((id) => at(id).no)), [null, null, null]);
  api.runCommand('numberOn');
  assert.deepEqual(plain(ids.map((id) => at(id).no)), [1, 2, 3], '上から下の順に付ける');
  api.ui.sel = [{ k: 'p', id: ids[0] }, { k: 'c', id: cid }];
  key(app, app.document.body, { key: 'Delete' });
  assert.equal(screen().parts.length, 2);
  assert.equal(screen().callouts.length, 0);
  api.store.undo();
  assert.equal(screen().callouts[0].target, ids[0], '元に戻すで、つながりも戻る');
});

test('まとめてコピー・貼り付け: 一緒にコピーした部品につないだ吹き出しは、貼り付けた部品につなぐ', async (t) => {
  const { api, ids, screen } = await bootThree(t);
  api.actions.addCallout(api.ui.designId, screen().id, { x: -232, y: 48 }, ids[0]);
  const cid = screen().callouts[0].id;
  api.ui.sel = [{ k: 'p', id: ids[0] }, { k: 'c', id: cid }];
  api.runCommand('copyPart');
  api.runCommand('pastePart');
  assert.equal(screen().parts.length, 4);
  assert.equal(screen().callouts.length, 2);
  const newPart = screen().parts[3];
  assert.equal(screen().callouts[1].target, newPart.id, '貼り付けた部品へつなぐ');
  assert.deepEqual(plain(api.ui.sel.map((x) => x.k)), ['p', 'c'], '貼り付けたものを選ぶ');
  assert.notEqual(newPart.itemId, screen().parts[0].itemId, '同じ画面なので項目も写す');
  api.ui.sel = [{ k: 'c', id: cid }];
  api.runCommand('duplicatePart');
  assert.equal(screen().callouts[2].target, ids[0], '吹き出しだけを複製すると、元の部品につないだまま');
});

// ── 見直し用のエージェントが見つけた不具合（後半の部品と吹き出し）──

test('表: 見本の行の数を増やして画面の下からはみ出すときは、表を上へずらさず、画面を下へ伸ばす', async (t) => {
  const { api, add, screen } = await bootEditor(t);
  const tb = add('table');
  api.actions.movePart(api.ui.designId, screen().id, tb.id, { ...tb, y: 600 });
  api.actions.updatePart(api.ui.designId, screen().id, tb.id, { view: { rows: 12 } });
  const p = screen().parts[0];
  assert.deepEqual(plain([p.y, p.h]), [600, 472], '表の位置はそのまま、高さは 12 行分');
  assert.equal(screen().height, 1072, '画面を表の下の端まで伸ばす');
  api.store.undo();
  assert.deepEqual(plain([screen().parts[0].h, screen().height]), [168, 800], '元に戻すで 1 回で戻る');
});

test('表: スマホの画面を伸ばすときも、高さは機器の 1 画面分から 8 ドットずつ（読み込み直しても高さが変わらない）', async (t) => {
  const { api, add, screen } = await bootEditor(t);
  api.actions.updateScreen(api.ui.designId, screen().id, { device: 'phone' });
  const tb = add('table');
  api.actions.movePart(api.ui.designId, screen().id, tb.id, { ...tb, y: 560 });
  api.actions.updatePart(api.ui.designId, screen().id, tb.id, { view: { rows: 8 } });
  const p = screen().parts[0];
  const h = screen().height;
  assert.equal((h - 667) % 8, 0, `高さ ${h} は 667 から 8 ドットずつ`);
  assert.ok(h >= p.y + p.h && h - 8 < p.y + p.h, `表の下の端（${p.y + p.h}）まで伸ばす（高さ ${h}）`);
  assert.equal(api.snapHeight(h, 'phone'), h, '読み込み直しても同じ高さ');
});

test('取り込んだテーブル: この画面だけの設定で列を選んで、見本の値を書ける（項目の設定の枠は直せない）', async (t) => {
  const { app, api } = await bootEditor(t);
  const srcId = api.ui.designId;
  const sid = api.currentScreen().id;
  api.actions.addPart(srcId, sid, 'table', { x: 0, y: 48 });
  const tableItem = api.currentDesign().items[0];
  const dstId = api.actions.createDesign('受注管理', 'kintone');
  api.actions.importItems(dstId, srcId, [tableItem.id]);
  api.openDesign(dstId);
  const linked = api.currentDesign().items[0];
  const pid = api.actions.addItemPart(dstId, api.currentScreen().id, linked.id, { x: 0, y: 48 });
  api.selectPart(pid);
  assert.ok($(app, '#side-settings fieldset[disabled] [data-action="tb-col"]'), '項目の設定の枠の中の列は押せない');
  const pick = $(app, '#side-settings .pf-sec.here [data-action="tb-col"]');
  assert.ok(pick, 'この画面だけの設定に、列を選ぶボタン');
  click(pick);
  assert.ok(api.ui.colId);
  setValue($(app, '#side-settings .pf-sec.here [data-tb="sample"]'), '鉛筆\n消しゴム');
  assert.deepEqual(plain(api.currentScreen().parts[0].view.samples[api.ui.colId]), ['鉛筆', '消しゴム']);
});

test('関連レコード一覧の「列を足す」（名前を書く欄）: 打った後に命令を出してから離れても、列は 1 本だけ足す', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  const tb = add('table');
  api.actions.setTableKind(api.ui.designId, screen().id, tb.id, 'related');
  api.selectPart(tb.id);
  setValue($(app, '#side-settings [data-tb="db"]'), '__free__');
  const input = $(app, '#side-settings [data-tb="addColName"]');
  input.focus();
  input.value = '受注番号';
  api.runCommand('zoomIn'); // 命令を出す前に、打ちかけの欄を保存する
  input.dispatchEvent(new app.window.Event('change', { bubbles: true })); // その後で欄を離れる
  const cols = api.resolvePart(api.currentDesign(), screen().parts[0]).props.columns.map((c) => c.ref.name);
  assert.deepEqual(plain(cols), ['受注番号']);
});

test('画面の高さを縮めると、画面の下の余白に置いた吹き出しも、置ける範囲の中へ寄せる', async (t) => {
  const { api, screen } = await bootEditor(t);
  api.actions.updateScreen(api.ui.designId, screen().id, { height: 1200 });
  api.actions.addCallout(api.ui.designId, screen().id, { x: 0, y: 1300 }, null);
  api.actions.updateScreen(api.ui.designId, screen().id, { height: 800 });
  assert.equal(screen().callouts[0].y, 800 + 240 - 80);
});

test('吹き出しをドラッグしている間も、その吹き出しの線を描く', async (t) => {
  const { app, api, add, screen } = await bootEditor(t);
  const p = add('text1');
  const id = api.actions.addCallout(api.ui.designId, screen().id, { x: 400, y: 200 }, p.id);
  const el = $(app, `#stage .callout[data-callout-id="${id}"]`);
  mouse(app, el, 'mousedown', { clientX: 100, clientY: 100 });
  mouse(app, app.document, 'mousemove', { clientX: 140, clientY: 120 });
  assert.equal($$(app, '#co-lines line').length, 1, 'ドラッグ中も線がある');
  mouse(app, app.document, 'mouseup', { clientX: 140, clientY: 120 });
  assert.equal($$(app, '#co-lines line').length, 1);
});

test('グラフの見本の値: 全角の数字・桁の区切り・単位を読み、数字のない行は描かない。0 でない値が 1 つの円グラフは円で描く', async (t) => {
  const { api, add, screen, partEl } = await bootEditor(t);
  const g = add('graph');
  api.actions.updatePart(api.ui.designId, screen().id, g.id, { props: { chart: 'hbar', samples: '4月, １２０\n5月, 1,200\n6月, abc\n7月, 120万' } });
  const texts = [...partEl(g.id).querySelectorAll('svg text')].map((e) => e.textContent);
  assert.deepEqual(plain(texts), ['4月', '120', '5月', '1200', '7月', '120']);
  api.actions.updatePart(api.ui.designId, screen().id, g.id, { props: { chart: 'pie', samples: 'A, 100\nB, 0' } });
  assert.equal(partEl(g.id).querySelectorAll('svg circle').length, 1, '円で描く');
  api.actions.movePart(api.ui.designId, screen().id, g.id, { ...screen().parts[0], w: 80, h: 64 });
  api.actions.updatePart(api.ui.designId, screen().id, g.id, { props: { chart: 'bar', samples: 'A, 1\nB, 2' } });
  assert.ok([...partEl(g.id).querySelectorAll('svg rect')].every((r) => Number(r.getAttribute('width')) >= 0 && Number(r.getAttribute('height')) >= 0), '小さくしても負の幅・高さにしない');
});

test('ページ送り: 全部の件数が 0 のときは「0 件」とだけ出す', async (t) => {
  const { api, add, screen, partEl } = await bootEditor(t);
  const pg = add('pager');
  api.actions.updatePart(api.ui.designId, screen().id, pg.id, { props: { total: '0' } });
  assert.equal(partEl(pg.id).querySelector('em').textContent, '0 件');
});

// ── 見直し用のエージェントが見つけた不具合（まとめて操作）──

test('まとめて動かす: 範囲の外に出ている吹き出し（読み込んだデータなど）があっても、押した向きと逆へ跳ばない', async (t) => {
  const { app, api, ids, at, screen } = await bootThree(t);
  const cid = api.actions.addCallout(api.ui.designId, screen().id, { x: 0, y: 900 }, null);
  api.store.commit((s) => { s.designs[0].screens[0].callouts[0].y = 1304; }); // 範囲（下の端 1040）の外
  api.runCommand('selectAll');
  assert.equal(api.ui.sel.length, 4);
  const before = ids.map((id) => [at(id).x, at(id).y]);
  key(app, app.document.body, { key: 'ArrowRight' });
  assert.deepEqual(plain(ids.map((id) => [at(id).x, at(id).y])), plain(before.map(([x, y]) => [x + 8, y])), '右へ 8 だけ動き、上下には動かない');
  assert.ok(cid);
});

test('いくつか選んでいるときに、そのうちの 1 つを（Ctrl なしで）押しただけなら、その 1 つだけを選ぶ（Microsoft Office と同じ）', async (t) => {
  const { app, api, ids, partEl } = await bootThree(t);
  api.runCommand('selectAll');
  mouse(app, partEl(ids[1]), 'mousedown', { clientX: 10, clientY: 10 });
  mouse(app, app.document, 'mouseup', { clientX: 11, clientY: 10 });
  assert.deepEqual(plain(api.ui.sel.map((x) => x.id)), [ids[1]]);
  // ドラッグしたときは、選んだまま全部を動かす
  api.runCommand('selectAll');
  mouse(app, partEl(ids[1]), 'mousedown', { clientX: 10, clientY: 10 });
  mouse(app, app.document, 'mousemove', { clientX: 50, clientY: 10 });
  mouse(app, app.document, 'mouseup', { clientX: 50, clientY: 10 });
  assert.equal(api.ui.sel.length, 3);
});
