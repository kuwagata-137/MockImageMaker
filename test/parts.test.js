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

test('部品の箱: 基本と入力の画面用の組に 15 種類。組の見出しで閉じたり開いたりできる', async (t) => {
  const { app, api } = await bootEditor(t);
  assert.deepEqual($$(app, '.pal-head').map((e) => e.textContent.replace(/\s+/g, ' ').trim()), ['▼ 基本11', '▼ 入力の画面用4']);
  assert.equal($$(app, '.pal-btn').length, 15);
  click($(app, '.pal-head[data-id="basic"]'));
  assert.equal($$(app, '.pal-btn').length, 4, '基本を閉じた');
  assert.equal(api.ui.paletteClosed.basic, true);
  api.goHome();
  api.openDesign(api.store.state.designs[0].id);
  assert.equal($$(app, '.pal-btn').length, 4, '画面設計を開き直しても閉じたまま');
  click($(app, '.pal-head[data-id="basic"]'));
  assert.equal($$(app, '.pal-btn').length, 15);
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
