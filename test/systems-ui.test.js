'use strict';
// 第 9 段階の前半（T5）: 最初の画面のシステムのまとまり（画像 q61 の案B）のテスト。左のシステムの一覧・右のまとまり・共通の画面設計の札・名前で探す・
// 新しいシステムの窓・名前と説明を変える・システムのごみ箱・画面設計をごみ箱へ移す確かめ・このシステムから外す・入れる窓と複製して入れる窓（画像 q46・q47）・
// 新しい画面設計の窓の「入れるシステム」・ファイルを落とす先・システムの画面（仮）との行き来・AI の知らせ。
// 画面設計とシステムの名前は架空の業務（出張申請・経費精算・社員マスタなど）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
function setValue(el, value, type = 'input') {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
function key(app, target, init) {
  target.dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
// ファイルを落とす（jsdom には DataTransfer がないので、使う所だけの身代わりを付ける）
function fileEvent(app, el, type, text = '') {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [{ size: text.length, text: async () => text }], dropEffect: '' } });
  el.dispatchEvent(ev);
}

// ── 見本（架空の業務）──
const screen = (id, name) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts: [], callouts: [] });
const item = (id, name, link = null) => ({ id, name, type: 'text1', required: false, memo: '', props: { maxLen: '', initial: '' }, lookup: null, link });
const design = (id, name, updatedAt, extra = {}) => ({
  id, name, target: 'kintone', description: '', createdAt: OLD, updatedAt, trashedAt: null, revisions: [], items: [],
  screens: [screen('s-' + id, '一覧')], mapPos: {}, processPos: {}, flowPos: {}, ...extra,
});
const system = (id, name, designIds, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds, roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
// 出張申請システム（出張申請・ごみ箱の古い申請・社員マスタ）と経費精算システム（経費精算・社員マスタ）。社員マスタは 2 つのシステムで使う共通の画面設計。
// 日報は、ごみ箱のシステムにだけ入っている（入っていないとみなす）。経費精算は出張申請の項目を、日報は取引先マスタの項目を取り込んでいる
function sampleState() {
  return {
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d-trip', '出張申請', '2026-10-05T00:00:00.000Z', { items: [item('i-dest', '行き先')] }),
      design('d-emp', '社員マスタ', '2026-10-04T00:00:00.000Z'),
      design('d-exp', '経費精算', '2026-10-03T00:00:00.000Z', {
        items: [item('o-dest', '行き先', { designId: 'd-trip', itemId: 'i-dest', designName: '出張申請', lost: false })],
      }),
      design('d-daily', '日報', '2026-10-02T00:00:00.000Z', {
        items: [item('o-cli', '取引先名', { designId: 'd-cli', itemId: 'i-cli', designName: '取引先マスタ', lost: false })],
      }),
      design('d-cli', '取引先マスタ', '2026-10-06T00:00:00.000Z', { items: [item('i-cli', '取引先名')] }),
      design('d-gone', '古い申請', OLD, { trashedAt: '2026-10-07T00:00:00.000Z' }),
    ],
    systems: [
      system('y-trip', '出張申請システム', ['d-trip', 'd-gone', 'd-emp'], {
        description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム',
        roles: [{ id: 'l-a', name: '申請者', memo: '' }, { id: 'l-b', name: '上長', memo: '' }, { id: 'l-c', name: '経理', memo: '' }],
      }),
      system('y-exp', '経費精算システム', ['d-exp', 'd-emp']),
      system('y-old', '古いシステム', ['d-daily'], { trashedAt: '2026-10-08T00:00:00.000Z' }),
    ],
  };
}

async function boot(t, state = sampleState()) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) } });
  t.after(() => app.close());
  const api = await app.api();
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  const S = () => api.store.state;
  return {
    app, api, $, $$, S,
    sys: (id) => plain(S().systems.find((y) => y.id === id) || null),
    d: (id) => S().designs.find((x) => x.id === id),
    // 左の一覧の行 [名前, 数, 選んでいるか]
    rows: () => $$('.sys-list .sys-item').map((b) => [b.querySelector('.nm').textContent, b.querySelector('small').textContent, b.classList.contains('on')]),
    cards: () => $$('.sys-block .card-name').map((e) => e.textContent),
    item: (group) => $(`.sys-list .sys-item[data-group="${group}"]`),
    toast: () => $('#toast').textContent,
    call: async (tool, args = {}) => plain(await api.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' })),
  };
}
const dialogButtons = ($$) => $$('.modal-actions button').filter((b) => !b.hidden).map((b) => b.textContent);

// ── 左の一覧と右のまとまり ──
test('左の一覧: ごみ箱にないシステムを作った順に、名前と画面設計の数（ごみ箱の画面設計は数えない）。点線の区切り・「システムに入っていない」・「＋ 新しいシステム」。最初はいちばん上のシステム', async (t) => {
  const { $, $$, rows, cards } = await boot(t);
  assert.equal($('.home-head h1').textContent, 'システムと画面設計');
  assert.deepEqual(rows(), [['出張申請システム', '2 つ', true], ['経費精算システム', '2 つ', false], ['システムに入っていない', '2 つ', false]]);
  assert.equal($$('.sys-list hr').length, 2);
  assert.equal($('.sys-list [data-action="new-system"]').textContent, '＋ 新しいシステム');
  // 右: 見出し（名前・数・ボタン）と説明と、designIds の順のカード（ごみ箱の画面設計は出さない）
  assert.equal($('.sys-block .sys-head h2').textContent, '出張申請システム');
  assert.equal($('.sys-block .sys-head .meta').textContent, '画面設計 2 つ・役割 3 つ');
  assert.equal($('.sys-block .sys-desc').textContent, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  assert.deepEqual(cards(), ['出張申請', '社員マスタ']);
  const open = $('.sys-head [data-action="open-system"]');
  assert.equal(open.textContent, 'このシステムを開く');
  assert.ok(open.classList.contains('primary'));
  assert.equal($('.sys-head [data-action="sys-add-menu"]').textContent, '＋ 画面設計を追加する ▾');
  assert.equal($('.sys-head [data-action="sys-menu"]').textContent, '…');
  // 見出しのボタン: 「＋ 新しい画面設計」（ふつうの見た目・data-action は new のまま）と「＋ 新しいシステム」（目立つ）
  const head = $$('.home-head button').map((b) => b.textContent);
  assert.deepEqual(head, ['▦ 並べて表示', '⇄ 関連図', '⇩ HTML を取り込む', '＋ 新しい画面設計', '＋ 新しいシステム']);
  assert.equal($('.home-head [data-action="new"]').classList.contains('primary'), false);
  assert.ok($('.home-head [data-action="new-system"]').classList.contains('primary'));
  assert.match($('.home-note').textContent, /システムごとに、入っている画面設計を並べています。/);
});

test('左の一覧の選び替え: 「システムに入っていない」は点線の枠・見出しは名前と数だけ・更新の新しい順。空のシステムは案内の文。選んでいたシステムがなくなったら、いちばん上を選び直す', async (t) => {
  const { api, $, rows, cards, item } = await boot(t);
  click(item('lone'));
  assert.equal(api.ui.homeGroup, 'lone');
  assert.ok($('.sys-block.lone'));
  assert.equal($('.sys-block.lone .sys-head h2').textContent, 'システムに入っていない');
  assert.equal($('.sys-block.lone .sys-head .meta').textContent, '画面設計 2 つ');
  assert.equal($('.sys-block.lone .sys-head button'), null, 'ボタンはない');
  assert.deepEqual(cards(), ['取引先マスタ', '日報'], '更新の新しい順。ごみ箱のシステムにだけ入っているものも、入っていないとみなす');
  click(item('y-exp'));
  assert.deepEqual(rows().map((r) => r[2]), [false, true, false]);
  assert.deepEqual(cards(), ['経費精算', '社員マスタ']);
  assert.equal($('.sys-block .sys-desc'), null, '説明が空なら出さない');
  const y = api.actions.createSystem({ name: '日報システム' });
  click(item(y));
  assert.equal($('.sys-block .sys-head .meta').textContent, '画面設計 0 つ・役割 0 つ');
  assert.match($('.sys-block').textContent, /まだ画面設計が入っていません。「＋ 画面設計を追加する」から追加します。/);
  api.actions.trashSystem(y);
  assert.equal(api.ui.homeGroup, null, '選んでいないことにする');
  assert.deepEqual(rows()[0], ['出張申請システム', '2 つ', true], 'いちばん上を出す');
  api.actions.restoreSystem(y);
  assert.deepEqual(rows()[0], ['出張申請システム', '2 つ', true], '戻しても、選び直したまま');
});

test('人が選んでいないときは、いちばん上を出すだけで覚えない（システムがない間に「システムに入っていない」を出していても、システムができたら、いちばん上のシステムを出す）', async (t) => {
  const { api, rows } = await boot(t, { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, designs: [], systems: [] });
  assert.deepEqual(rows(), [['システムに入っていない', '0 つ', true]]);
  assert.equal(api.ui.homeGroup, null);
  api.actions.createSystem({ name: '出張申請システム' });
  assert.deepEqual(rows(), [['出張申請システム', '0 つ', true], ['システムに入っていない', '0 つ', false]]);
});

test('システムがないとき: 「システムに入っていない」だけを選び、画面設計がなければ始め方の案内', async (t) => {
  const { rows, $ } = await boot(t, { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, designs: [], systems: [] });
  assert.deepEqual(rows(), [['システムに入っていない', '0 つ', true]]);
  assert.match($('#home-cards').textContent, /まだ画面設計がありません。「＋ 新しい画面設計」から始めましょう。/);
});

test('共通の画面設計: ごみ箱にないシステム 2 つ以上に入っていると、緑の枠と札。札を押すと、使っているシステムの名前をお知らせで出す（カードは開かない）', async (t) => {
  const { api, $ } = await boot(t);
  const emp = $('.sys-block .card[data-id="d-emp"]');
  assert.ok(emp.classList.contains('shared'));
  const tag = emp.querySelector('.share-tag');
  assert.equal(tag.textContent, '2 つのシステムで使っている');
  assert.match(tag.title, /出張申請システム・経費精算システム/);
  assert.equal($('.card[data-id="d-trip"]').classList.contains('shared'), false);
  assert.equal($('.card[data-id="d-trip"] .share-tag'), null);
  click(tag);
  assert.equal($('#toast').textContent, '「社員マスタ」は、出張申請システム・経費精算システムで使っています。');
  assert.equal(api.ui.view, 'home', 'カードは開かない');
  api.actions.trashSystem('y-exp');
  assert.equal($('.card[data-id="d-emp"]').classList.contains('shared'), false, 'ごみ箱のシステムは数えない');
});

test('名前で検索: 左は当たるまとまりだけ（数は当たった数）、右は選んだまとまりの中で当たるカード。システムの名前が当たれば、そのシステムのカードを全部', async (t) => {
  const { api, $, rows, cards, item } = await boot(t);
  click(item('y-trip'));
  setValue($('#home-search'), 'マスタ');
  assert.deepEqual(rows(), [['出張申請システム', '1 つ', true], ['経費精算システム', '1 つ', false], ['システムに入っていない', '1 つ', false]]);
  assert.deepEqual(cards(), ['社員マスタ']);
  setValue($('#home-search'), '経費');
  assert.deepEqual(rows(), [['経費精算システム', '2 つ', true]], '選んでいたまとまりに当たりがなければ、当たりのある最初のまとまり');
  assert.deepEqual(cards(), ['経費精算', '社員マスタ']);
  assert.equal(api.ui.homeGroup, 'y-trip', '探している間は、選んでいたものを覚えておく');
  setValue($('#home-search'), '日報');
  assert.deepEqual(rows(), [['システムに入っていない', '1 つ', true]]);
  assert.deepEqual(cards(), ['日報']);
  setValue($('#home-search'), '在庫');
  assert.equal($('#home-cards').textContent.trim(), '「在庫」に当たる画面設計はありません。');
  setValue($('#home-search'), '');
  assert.deepEqual(rows()[0], ['出張申請システム', '2 つ', true]);
});

// ── システムの窓とメニュー ──
test('「＋ 新しいシステム」の窓: 名前は要る・説明は書かなくてよい。同じ名前でも作れる。作ったら最初の画面のまま、左の一覧でそのシステムを選ぶ。編集の画面からは一覧へ戻ってから開く', async (t) => {
  const { app, api, $, $$, S, rows } = await boot(t);
  click($('.home-head [data-action="new-system"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '新しいシステム');
  assert.deepEqual(dialogButtons($$), ['システムを作る', 'キャンセル']);
  assert.equal($('.modal [name=description]').tagName, 'TEXTAREA');
  click($('[data-dlg="ok"]'));
  assert.match($('.modal-error').textContent, /名前を書いてください/);
  setValue($('.modal [name=name]'), '  経費精算システム ');
  $('.modal [name=description]').value = '立て替えた経費を申請する';
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'), { label: '窓が閉じる' });
  const y = S().systems.at(-1);
  assert.deepEqual([y.name, y.description], ['経費精算システム', '立て替えた経費を申請する']);
  assert.equal(api.ui.view, 'home');
  assert.equal(api.ui.homeGroup, y.id);
  assert.deepEqual(rows().map((r) => r[2]), [false, false, true, false]);
  assert.match($('#toast').textContent, /「経費精算システム」を作りました。/);
  // 左の一覧の「＋ 新しいシステム」からも同じ窓
  click($('.sys-list [data-action="new-system"]'));
  await waitFor(() => $('.modal'));
  click($('[data-dlg="cancel"]'));
  // 編集の画面から（アプリのメニューと同じ命令）
  api.openDesign('d-trip');
  api.runCommand('newSystem');
  assert.equal(api.ui.view, 'home');
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '新しいシステム');
  key(app, $('.modal [name=name]'), { key: 'Escape' });
  assert.equal($('.modal'), null);
});

test('「…」のメニュー: 名前と説明を変える（元に戻すで戻る）・ごみ箱へ移す（確かめの窓は出さない）', async (t) => {
  const { app, api, $, $$, sys, rows } = await boot(t);
  click($('.sys-head [data-action="sys-menu"]'));
  assert.deepEqual($$('.sys-pop [role="menuitem"]').map((b) => b.textContent), ['このシステムの名前と説明を変更する…', 'このシステムを削除する（ごみ箱へ移す）']);
  key(app, app.document.body, { key: 'Escape' });
  assert.equal($('.sys-pop'), null, 'Esc で閉じる');
  click($('.sys-head [data-action="sys-menu"]'));
  click($('.sys-pop [data-action="sys-edit"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.sys-pop'), null, 'メニューは閉じる');
  assert.equal($('.modal h2').textContent, 'このシステムの名前と説明を変更する');
  assert.deepEqual(dialogButtons($$), ['名前と説明を変更する', 'キャンセル']);
  assert.equal($('.modal [name=name]').value, '出張申請システム');
  assert.equal($('.modal [name=description]').value, '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム');
  setValue($('.modal [name=name]'), ' ');
  click($('[data-dlg="ok"]'));
  assert.match($('.modal-error').textContent, /名前を書いてください/);
  setValue($('.modal [name=name]'), '国内出張システム');
  $('.modal [name=description]').value = '国内の出張だけ';
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'));
  assert.deepEqual([sys('y-trip').name, sys('y-trip').description], ['国内出張システム', '国内の出張だけ']);
  assert.equal(rows()[0][0], '国内出張システム');
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.equal(sys('y-trip').name, '出張申請システム');
  // ごみ箱へ移す
  click($('.sys-head [data-action="sys-menu"]'));
  click($('.sys-pop [data-action="sys-trash"]'));
  assert.equal($('.modal'), null, '確かめの窓は出さない');
  assert.ok(sys('y-trip').trashedAt);
  assert.equal($('#toast').textContent, '「出張申請システム」をごみ箱へ移しました。入っていた画面設計は残っています。');
  assert.deepEqual(rows(), [['経費精算システム', '2 つ', true], ['システムに入っていない', '3 つ', false]], '出張申請はどのシステムにも入っていないとみなす');
  assert.equal(api.store.canUndo(), true, 'ごみ箱へ移すのは元に戻せる');
});

test('「名前と説明を変える」: 何も変えずに「変える」を押しても、更新日時も元に戻すの履歴も変わらない（名前は前後の空白を削り、説明は削らない）', async (t) => {
  const st = sampleState();
  st.systems[0].description = '出張の申請をまとめる\n';
  const { api, $, sys } = await boot(t, st);
  const undo0 = api.store.undoStack.length;
  click($('.sys-head [data-action="sys-menu"]'));
  click($('.sys-pop [data-action="sys-edit"]'));
  await waitFor(() => $('.modal'));
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'));
  assert.deepEqual([sys('y-trip').description, sys('y-trip').updatedAt, api.store.undoStack.length], ['出張の申請をまとめる\n', OLD, undo0]);
  click($('.sys-head [data-action="sys-menu"]'));
  click($('.sys-pop [data-action="sys-edit"]'));
  await waitFor(() => $('.modal'));
  setValue($('.modal [name=name]'), '  国内出張システム  ');
  $('.modal [name=description]').value = '  国内の出張だけ\n';
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'));
  assert.deepEqual([sys('y-trip').name, sys('y-trip').description], ['国内出張システム', '  国内の出張だけ\n']);
});

test('ごみ箱: システムも出す（「システム」と「画面設計」の小見出し・数は合計）。戻す・完全に削除（確かめの窓。画面設計は残り、元に戻すの履歴は消える）', async (t) => {
  const { api, $, $$, S, sys, rows } = await boot(t);
  api.actions.trashSystem('y-exp');
  assert.equal($('.trash-toggle').textContent, '▸ ごみ箱（3）');
  click($('.trash-toggle'));
  assert.deepEqual($$('.trash-sub').map((e) => e.textContent), ['システム', '画面設計']);
  const sysRows = $$('.trash-row.sys').map((r) => [r.querySelector('.trash-name').textContent, r.querySelector('.trash-meta').textContent]);
  assert.deepEqual(sysRows, [['経費精算システム', '画面設計 2 つ'], ['古いシステム', '画面設計 1 つ']], 'ごみ箱へ移した日時の新しい順');
  assert.match($('.trash-row.sys').textContent, /ごみ箱へ移した日時 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.deepEqual($$('.trash-row:not(.sys) .trash-name').map((e) => e.textContent), ['古い申請']);
  click($('.trash-row.sys [data-action="restore-system"][data-id="y-exp"]'));
  assert.equal(sys('y-exp').trashedAt, null);
  assert.equal($('#toast').textContent, '「経費精算システム」を一覧に戻しました。');
  assert.equal(rows()[1][0], '経費精算システム');
  // 完全に削除
  click($('.trash-row.sys [data-action="delete-system-forever"][data-id="y-old"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '「古いシステム」を完全に削除しますか？');
  assert.equal($('.modal-body').textContent.trim(),
    '「古いシステム」を完全に削除します。システムの役割とスイムレーン図が消えます。入っていた画面設計は消えません。元に戻せません（元に戻す〔Ctrl+Z〕の履歴も消えます）。');
  assert.deepEqual(dialogButtons($$), ['システムを完全に削除する', 'キャンセル'], '画面設計の窓と同じ「完全に削除する」');
  assert.ok($('[data-dlg="ok"]').classList.contains('danger'));
  assert.equal($('[data-dlg="cancel"]').ownerDocument.activeElement, $('[data-dlg="cancel"]'), '最初のフォーカスはキャンセル');
  click($('[data-dlg="ok"]'));
  await waitFor(() => !sys('y-old'), { label: '完全に削除' });
  assert.ok(S().designs.some((x) => x.id === 'd-daily'), '入っていた画面設計は残る');
  assert.equal(api.store.canUndo(), false);
  assert.equal($('#toast').textContent, '「古いシステム」を完全に削除しました。');
  assert.equal($('.trash-toggle').textContent, '▾ ごみ箱（1）');
  assert.equal($('.trash-sub'), null, 'ごみ箱にシステムがなければ小見出しは出さない');
});

test('画面設計をごみ箱へ移す: システムに入っていれば確かめの窓で知らせる（取り込まれているときと両方なら 1 つの窓に 2 つの段落）。どちらでもなければ確かめない', async (t) => {
  const { app, api, $, $$, d, sys, item } = await boot(t);
  const trashFromCard = (id) => { click($(`.card-more[data-id="${id}"]`)); click($(`.card-menu [data-action="trash"][data-id="${id}"]`)); };
  // システムに入っている（社員マスタ）
  trashFromCard('d-emp');
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '「社員マスタ」をごみ箱へ移しますか？');
  assert.match($('.modal-body').textContent, /「社員マスタ」は、出張申請システム・経費精算システムで使っています。ごみ箱へ移すと、どのシステムからも見えなくなります。ごみ箱から戻すと、元のシステムに戻ります。/);
  assert.doesNotMatch($('.modal-body').textContent, /取り込んでいます/);
  assert.deepEqual(dialogButtons($$), ['画面設計をごみ箱へ移す', 'キャンセル']);
  assert.equal(app.document.activeElement, $('[data-dlg="cancel"]'));
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  assert.equal(d('d-emp').trashedAt, null);
  trashFromCard('d-emp');
  await waitFor(() => $('.modal'));
  click($('[data-dlg="ok"]'));
  await waitFor(() => d('d-emp').trashedAt, { label: 'ごみ箱へ移す' });
  assert.deepEqual(sys('y-trip').designIds, ['d-trip', 'd-gone', 'd-emp'], 'designIds からは外さない');
  // システムに入っていて、取り込まれてもいる（出張申請）: 1 つの窓に 2 つの段落
  trashFromCard('d-trip');
  await waitFor(() => $('.modal'));
  const paras = $$('.modal-body p').map((p) => p.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(paras.some((p) => /^「出張申請」は、出張申請システムで使っています。/.test(p)));
  assert.ok(paras.some((p) => /この画面設計の項目を、ほかの 1 つの画面設計（経費精算）が取り込んでいます。/.test(p)));
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  // 取り込まれているだけ（取引先マスタ）: 今までの窓
  click(item('lone'));
  trashFromCard('d-cli');
  await waitFor(() => $('.modal'));
  assert.doesNotMatch($('.modal-body').textContent, /で使っています/);
  assert.match($('.modal-body').textContent, /この画面設計の項目を、ほかの 1 つの画面設計（日報）が取り込んでいます。/);
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  // どちらでもない（日報）: 確かめない
  trashFromCard('d-daily');
  assert.equal($('.modal'), null);
  assert.ok(d('d-daily').trashedAt);
  assert.ok(api.store.canUndo());
});

test('カードの「…」の「このシステムから外す」: システムのまとまりのカードだけに出る。外しても画面設計は残る。複製はそのシステムに入れる', async (t) => {
  const { api, $, $$, S, sys, cards, item } = await boot(t);
  click($('.card-more[data-id="d-emp"]'));
  assert.deepEqual($$('.card-menu [role="menuitem"]').map((b) => b.textContent), ['この画面設計の名前を変更する', 'この画面設計を複製する', 'この画面設計を出力…', '画面設計をこのシステムから外す', 'この画面設計を削除する（ごみ箱へ移す）']);
  click($('.card-menu [data-action="remove-from-system"]'));
  assert.deepEqual(sys('y-trip').designIds, ['d-trip', 'd-gone']);
  assert.ok(S().designs.some((x) => x.id === 'd-emp'));
  assert.equal($('#toast').textContent, '「社員マスタ」を出張申請システムから外しました。画面設計は残っています。');
  assert.deepEqual(cards(), ['出張申請']);
  api.store.undo();
  // 複製: システムのまとまりのカードからは、そのシステムに入れる
  click($('.card-more[data-id="d-trip"]'));
  click($('.card-menu [data-action="duplicate"]'));
  const copy = S().designs.at(-1);
  assert.equal(copy.name, '出張申請 のコピー');
  assert.deepEqual(sys('y-trip').designIds, ['d-trip', 'd-gone', 'd-emp', copy.id]);
  assert.deepEqual(sys('y-exp').designIds, ['d-exp', 'd-emp']);
  // 「システムに入っていない」のカードには「このシステムから外す」はなく、複製はどのシステムにも入れない
  click(item('lone'));
  click($('.card-more[data-id="d-cli"]'));
  assert.equal($('.card-menu [data-action="remove-from-system"]'), null);
  click($('.card-menu [data-action="duplicate"]'));
  const copy2 = S().designs.at(-1);
  assert.equal(copy2.name, '取引先マスタ のコピー');
  assert.deepEqual(plain(api.systemsOf(S(), copy2.id)), []);
});

test('「＋ 画面設計を追加する ▾」のメニュー（q46）: 新しい画面設計を作る・今ある画面設計を追加する・複製して入れる（小さな字の説明つき）', async (t) => {
  const { app, $, $$ } = await boot(t);
  const btn = $('.sys-head [data-action="sys-add-menu"]');
  click(btn);
  assert.equal(btn.getAttribute('aria-expanded'), 'false', '描き直した後のボタンを見る');
  assert.equal($('.sys-head [data-action="sys-add-menu"]').getAttribute('aria-expanded'), 'true');
  const items = $$('.sys-pop [role="menuitem"]').map((b) => [b.dataset.action, b.querySelector('b').textContent, (b.querySelector('small') || {}).textContent || '']);
  assert.deepEqual(items, [
    ['sys-add-new', '新しい画面設計を作る', ''],
    ['sys-add-same', '今ある画面設計を追加する', '同じもの。編集内容は常に自動で同期する'],
    ['sys-add-copy', '今ある画面設計を複製して追加する', '別のもの。新しい id。同期しない'],
  ]);
  click(app.document.querySelector('.home-head h1'));
  assert.equal($('.sys-pop'), null, 'ほかの所を押すと閉じる');
});

test('今ある画面設計を追加する窓（q47）: いくつでも選べる。このシステムに入っているものは薄くして選べない。ごみ箱の画面設計は出さない。名前とシステムで絞り込む。入れるのは 1 回の変更', async (t) => {
  const { app, api, $, $$, sys, item, cards } = await boot(t);
  click(item('y-exp'));
  click($('.sys-head [data-action="sys-add-menu"]'));
  click($('.sys-pop [data-action="sys-add-same"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '今ある画面設計を追加する（経費精算システム）');
  assert.match($('.modal-body').textContent, /ほかのシステムにある画面設計を選んで、経費精算システムにも並べます。選んだ画面設計の編集内容は、常に自動で同期します。/);
  assert.deepEqual(dialogButtons($$), ['画面設計を追加する', 'キャンセル']);
  const names = () => $$('.pick-card:not([hidden]) .bd b').map((e) => e.textContent);
  assert.deepEqual(names(), ['取引先マスタ', '出張申請', '社員マスタ', '経費精算', '日報'], '更新の新しい順。ごみ箱の画面設計は出さない');
  const card = (id) => $(`.pick-card[data-pick="${id}"]`);
  assert.equal(card('d-trip').querySelector('.where').textContent, '出張申請システム・画面 1・項目 1');
  assert.equal(card('d-daily').querySelector('.where').textContent, 'システムに入っていない・画面 1・項目 1');
  assert.equal(card('d-emp').querySelector('.where').textContent, '出張申請システム・経費精算システム・画面 1・項目 0');
  assert.match(card('d-emp').querySelector('.date').textContent, /^更新 2026-10-0\d$/);
  assert.ok(card('d-emp').classList.contains('off'));
  assert.ok(card('d-emp').disabled);
  assert.equal(card('d-emp').querySelector('.pick-in').textContent, 'このシステムに入っている');
  assert.ok($('[data-dlg="ok"]').disabled, '選んでいないときは押せない');
  assert.equal($('.pick-note').textContent, '追加する画面設計を選んでください（いくつでも選べます）。');
  click(card('d-emp'));
  assert.equal(card('d-emp').getAttribute('aria-pressed'), 'false', '薄い札は選べない');
  click(card('d-trip'));
  assert.equal(card('d-trip').getAttribute('aria-pressed'), 'true');
  assert.equal($('[data-dlg="ok"]').disabled, false);
  assert.equal($('.pick-note').textContent,
    '選んでいるもの：出張申請（1 つ）。経費精算システムにも並び、画面設計に「2 つのシステムで使っている」のマークが付きます。別のものとして使いたいときは、「＋ 画面設計を追加する」の「今ある画面設計を複製して追加する」を使います。');
  // 名前で探す・システムで絞る
  setValue($('.pick-search'), '日報');
  assert.deepEqual(names(), ['日報']);
  setValue($('.pick-search'), '');
  assert.deepEqual($$('.pick-sys option').map((o) => o.textContent), ['すべてのシステム', '出張申請システム', '経費精算システム', 'システムに入っていない']);
  setValue($('.pick-sys'), 'lone', 'change');
  assert.deepEqual(names(), ['取引先マスタ', '日報']);
  setValue($('.pick-search'), '在庫');
  assert.equal($('.pick-none').hidden, false, '当たらないときの文');
  setValue($('.pick-search'), '');
  click(card('d-daily'));
  assert.match($('.pick-note').textContent, /^選んでいるもの：出張申請・日報（2 つ）。経費精算システムにも並び、/);
  setValue($('.pick-sys'), 'y:y-trip', 'change');
  assert.deepEqual(names(), ['出張申請', '社員マスタ']);
  const undo0 = api.store.undoStack.length;
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'));
  assert.deepEqual(sys('y-exp').designIds, ['d-exp', 'd-emp', 'd-trip', 'd-daily'], '見えていない札も、選んだものは入れる');
  assert.equal(api.store.undoStack.length, undo0 + 1, '1 回の変更');
  assert.equal($('#toast').textContent, '2 つの画面設計を経費精算システムに追加しました。');
  assert.deepEqual(cards(), ['経費精算', '社員マスタ', '出張申請', '日報']);
  assert.ok($('.card[data-id="d-trip"]').classList.contains('shared'));
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.deepEqual(sys('y-exp').designIds, ['d-exp', 'd-emp'], 'Ctrl+Z 1 回で戻る');
});

test('今ある画面設計を複製して追加する窓: このシステムに入っているものも選べる。複製は「◯◯ のコピー」でこのシステムにだけ入る（1 回の変更）', async (t) => {
  const { app, api, $, $$, S, sys, item } = await boot(t);
  click(item('y-exp'));
  click($('.sys-head [data-action="sys-add-menu"]'));
  click($('.sys-pop [data-action="sys-add-copy"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '今ある画面設計を複製して追加する（経費精算システム）');
  assert.deepEqual(dialogButtons($$), ['画面設計を複製して追加する', 'キャンセル']);
  const card = (id) => $(`.pick-card[data-pick="${id}"]`);
  assert.equal(card('d-emp').disabled, false);
  assert.equal(card('d-emp').querySelector('.pick-in'), null);
  assert.ok($('[data-dlg="ok"]').disabled);
  key(app, $('.pick-search'), { key: 'Enter' });
  assert.ok($('.modal'), 'Enter を押しても、選んでいなければ閉じない');
  assert.equal($('.modal-error').hidden, true, '肯定のボタンを押せないときの Enter は何もしない（T9 の見直し）');
  click(card('d-emp'));
  assert.equal($('.pick-note').textContent,
    '選んでいるもの：社員マスタ（1 つ）。選んだ画面設計を複製して、経費精算システムに追加します。複製は別のもので、元を変更しても変わりません。');
  const before = S().designs.length;
  const undo0 = api.store.undoStack.length;
  click($('[data-dlg="ok"]'));
  await waitFor(() => !$('.modal'));
  assert.equal(S().designs.length, before + 1);
  const copy = S().designs.at(-1);
  assert.equal(copy.name, '社員マスタ のコピー');
  assert.notEqual(copy.id, 'd-emp');
  assert.deepEqual(sys('y-exp').designIds, ['d-exp', 'd-emp', copy.id]);
  assert.deepEqual(sys('y-trip').designIds, ['d-trip', 'd-gone', 'd-emp']);
  assert.equal(api.store.undoStack.length, undo0 + 1);
  assert.equal($('#toast').textContent, '「社員マスタ のコピー」を経費精算システムに追加しました。');
  assert.equal($(`.card[data-id="${copy.id}"]`).classList.contains('shared'), false);
  api.runCommand('undo');
  assert.equal(S().designs.length, before);
  assert.deepEqual(sys('y-exp').designIds, ['d-exp', 'd-emp']);
});

test('新しい画面設計の窓の「入れるシステム」: 最初は選んでいるシステム（「システムに入っていない」なら入れない）。メニューの「新しい画面設計を作る」はそのシステム。作ると編集の画面を開く', async (t) => {
  const { app, api, $, $$, S, sys, item } = await boot(t);
  click($('.home-head [data-action="new"]'));
  await waitFor(() => $('.modal'));
  assert.deepEqual($$('.modal [name=system] option').map((o) => o.textContent), ['（追加しない）', '出張申請システム', '経費精算システム']);
  assert.equal($('.modal [name=system]').value, 'y-trip');
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  click(item('lone'));
  click($('.home-head [data-action="new"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal [name=system]').value, '');
  setValue($('.modal [name=name]'), '備品の貸し出し');
  click($('[data-dlg="ok"]'));
  await waitFor(() => api.ui.view === 'editor', { label: '編集の画面' });
  assert.deepEqual(plain(api.systemsOf(S(), api.ui.designId)), [], '入れない');
  api.goHome();
  assert.equal(api.ui.homeGroup, 'lone', '一覧へ戻っても、選んでいたまとまりのまま');
  click(item('y-exp'));
  click($('.sys-head [data-action="sys-add-menu"]'));
  click($('.sys-pop [data-action="sys-add-new"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal [name=system]').value, 'y-exp');
  setValue($('.modal [name=name]'), '精算の入力');
  click($('[data-dlg="ok"]'));
  await waitFor(() => api.ui.view === 'editor', { label: '編集の画面' });
  assert.equal(sys('y-exp').designIds.at(-1), api.ui.designId);
  // アプリのメニューの「新しい画面設計…」（編集の画面からは一覧へ戻ってから開く）
  api.runCommand('newDesign');
  assert.equal(api.ui.view, 'home');
  await waitFor(() => $('.modal'));
  assert.equal($('.modal h2').textContent, '新しい画面設計');
  key(app, $('.modal [name=name]'), { key: 'Escape' });
});

test('新しい画面設計の窓: システムがないときは「入れるシステム」の欄を出さない', async (t) => {
  const { $ } = await boot(t, { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, designs: [], systems: [] });
  click($('.home-head [data-action="new"]'));
  await waitFor(() => $('.modal'));
  assert.equal($('.modal [name=system]'), null);
  click($('[data-dlg="cancel"]'));
});

test('ファイルを落とす: 右のシステムのまとまりか、左の一覧のシステムの名前の上に落としたときだけ、そのシステムに入れる。上にいる間は枠を青くする', async (t) => {
  const { app, api, $, $$, S, sys, item } = await boot(t);
  // 取り込む HTML（一覧にない画面設計を作って出力し、完全に削除しておく）
  const htmlOf = (name) => {
    const id = api.actions.createDesign(name, 'kintone');
    const html = api.buildStandaloneHtml(S().designs.find((x) => x.id === id), S());
    api.actions.deleteDesignForever(id);
    return { id, html };
  };
  const a = htmlOf('出張の精算');
  fileEvent(app, $('.sys-block .cards'), 'dragover');
  assert.ok($('.sys-block').classList.contains('drop-on'));
  assert.ok(app.document.body.classList.contains('file-over'));
  fileEvent(app, item('y-exp'), 'dragover');
  assert.equal($('.sys-block').classList.contains('drop-on'), false);
  assert.ok(item('y-exp').classList.contains('drop-on'));
  fileEvent(app, item('lone'), 'dragover');
  assert.equal($$('.drop-on').length, 0, '「システムに入っていない」は落とす先にならない');
  fileEvent(app, $('.sys-block .sys-head'), 'drop', a.html);
  await waitFor(() => S().designs.some((x) => x.id === a.id), { label: '取り込み' });
  assert.equal(sys('y-trip').designIds.at(-1), a.id);
  assert.equal($$('.drop-on').length, 0);
  assert.equal(app.document.body.classList.contains('file-over'), false);
  const b = htmlOf('経費の精算');
  fileEvent(app, item('y-exp'), 'drop', b.html);
  await waitFor(() => S().designs.some((x) => x.id === b.id), { label: '取り込み' });
  assert.equal(sys('y-exp').designIds.at(-1), b.id);
  const c = htmlOf('備品の貸し出し');
  fileEvent(app, $('.home-head'), 'drop', c.html);
  await waitFor(() => S().designs.some((x) => x.id === c.id), { label: '取り込み' });
  assert.deepEqual(plain(api.systemsOf(S(), c.id)), [], 'ほかの所に落としたときは、どのシステムにも入れない');
});

// ── システムの画面（仮）との行き来 ──
test('「開く」でシステムの画面（ui.view が system）を開き、元に戻すの履歴を空にする。「← 一覧へ」で戻ると、選んでいたシステムのまま', async (t) => {
  const { app, api, $, rows, item } = await boot(t);
  click(item('y-exp'));
  api.actions.updateSystem('y-exp', { description: '人の変更' });
  assert.ok(api.store.canUndo());
  click($('.sys-head [data-action="open-system"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId], ['system', 'y-exp']);
  assert.equal(api.store.canUndo(), false);
  assert.match($('.brandbar').textContent, /経費精算システム/);
  assert.ok($('#sys-view'), 'システムの画面（中身は test/system-screen.test.js）');
  assert.ok($('#ai-bands'));
  // システムの画面で中身が変わったら描き直す
  api.actions.updateSystem('y-exp', { name: '経費精算システム（改）' });
  assert.match($('.brandbar').textContent, /経費精算システム（改）/);
  key(app, app.document.body, { key: 'z', ctrlKey: true });
  assert.match($('.brandbar').textContent, /経費精算システム(?!（改）)/);
  click($('[data-action="home"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId], ['home', null]);
  assert.equal(api.ui.homeGroup, 'y-exp');
  assert.deepEqual(rows()[1], ['経費精算システム', '2 つ', true]);
  // アプリのメニューの「一覧へ戻る」
  api.openSystem('y-trip');
  api.runCommand('goHome');
  assert.equal(api.ui.view, 'home');
});

test('システムの画面を開いている間に、そのシステムがごみ箱に入った・消えたら一覧へ戻る', async (t) => {
  const { api } = await boot(t);
  api.openSystem('y-exp');
  api.actions.trashSystem('y-exp');
  assert.equal(api.ui.view, 'home');
  api.openSystem('y-trip');
  api.actions.deleteSystemForever('y-trip');
  assert.equal(api.ui.view, 'home');
  api.openSystem('y-old');
  assert.equal(api.ui.view, 'home', 'ごみ箱のシステムは開かない');
});

// ── AI の知らせ ──
test('AI がシステムを作ると一覧を描き直し、紫の帯の「開く」でシステムの画面を開く。システムの画面では帯を閉じても画面はそのまま', async (t) => {
  const { app, api, $, rows, call } = await boot(t);
  const r = await call('create_system', { name: '在庫管理システム' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(rows().map((x) => x[0]), ['出張申請システム', '経費精算システム', '在庫管理システム', 'システムに入っていない']);
  assert.match($('#ai-band').textContent, /Claude Code が「在庫管理システム」を作りました。/);
  click($('#ai-band [data-action="ai-open-system"]'));
  assert.deepEqual([api.ui.view, api.ui.systemId], ['system', r.result.id]);
  assert.equal($('#ai-band'), null, '開いたら帯を片付ける');
  // システムの画面で、ほかのシステムを AI が直す: そのシステムの名前の「開く」
  const v = await call('update_system', { system: 'y-trip', description: 'AI の変更' });
  assert.equal(v.ok, true, JSON.stringify(v.error));
  assert.equal($('#ai-band [data-action="ai-open-system"]').textContent, '「出張申請システム」を開く');
  assert.match($('#ai-band').textContent, /開いている「在庫管理システム」は変わっていません。/);
  // 開いているシステムを AI が直す: 紫の帯（「開く」は出さない。元に戻すの 1 回分として積む〔q66〕）
  const u = await call('update_system', { system: r.result.id, description: 'AI が書いた説明' });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.match($('#ai-band').textContent, /Claude Code が「在庫管理システム」を変更しました（変更点 1 件）。/);
  assert.equal($('#ai-band [data-action="ai-open-system"]'), null);
  assert.ok($('#ai-band [data-action="undo"]'));
  click($('#ai-band [data-action="ai-band-close"]'));
  assert.equal($('#ai-band'), null);
  assert.equal(api.ui.view, 'system', '一覧へ戻らない');
  assert.match(app.document.querySelector('.brandbar').textContent, /在庫管理システム/);
});

test('AI がシステムを直して元に戻すの履歴を消したとき、オレンジの帯の「「〇〇」の履歴を開く」でそのシステムの画面を開く', async (t) => {
  const { api, $, call } = await boot(t);
  api.actions.updateSystem('y-exp', { description: '人の変更' });
  const r = await call('update_system', { system: 'y-trip', description: 'AI の変更' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const btn = $('#ai-warn [data-action="ai-open-system-history"]');
  assert.equal(btn.textContent, '「出張申請システム」の履歴を開く');
  click(btn);
  assert.deepEqual([api.ui.view, api.ui.systemId], ['system', 'y-trip']);
});

// ── 見直しで見つけたもの（第 9 段階の T9）──
test('画面設計の「完全に削除」の窓: システムに入っていれば、どのシステムからも外れ、作業の指す先も外れることを知らせる。ボタンはどちらの窓も「完全に削除する」', async (t) => {
  const { api, $, $$ } = await boot(t);
  api.actions.trashDesign('d-emp');
  click($('.trash-toggle'));
  click($('.trash-row [data-action="delete-forever"][data-id="d-emp"]'));
  await waitFor(() => $('.modal'));
  assert.match($('.modal-body').textContent,
    /「社員マスタ」は、出張申請システム・経費精算システムに入っています。完全に削除すると、どのシステムからも外れ、スイムレーン図の工程の指す先も外れます。/);
  assert.deepEqual(dialogButtons($$), ['画面設計を完全に削除する', 'キャンセル']);
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  // どのシステムにも入っていない画面設計（ごみ箱のシステムにだけ入っている日報も）では書かない
  api.actions.trashDesign('d-daily');
  click($('.trash-row [data-action="delete-forever"][data-id="d-daily"]'));
  await waitFor(() => $('.modal'));
  assert.doesNotMatch($('.modal-body').textContent, /に入っています/);
  assert.deepEqual(dialogButtons($$), ['画面設計を完全に削除する', 'キャンセル']);
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
});

test('入れる窓・複製して入れる窓: 名前で検索欄の Enter では入れない（窓は開いたまま）。肯定のボタンを押せないときの Enter も何もしない。ほかのウィンドウの Enter は今までどおり', async (t) => {
  const { app, $, $$, sys, item } = await boot(t);
  click(item('y-exp'));
  for (const mode of ['same', 'copy']) {
    click($('.sys-head [data-action="sys-add-menu"]'));
    click($(`.sys-pop [data-action="sys-add-${mode}"]`));
    await waitFor(() => $('.modal'));
    const ids = sys('y-exp').designIds;
    // 何も選ばずに Enter（名前で探す欄の上でも、ほかの所でも）
    key(app, $('.pick-search'), { key: 'Enter' });
    key(app, $('.pick-sys'), { key: 'Enter' });
    assert.ok($('.modal'), `${mode}: 窓は開いたまま`);
    assert.equal($('.modal-error').hidden, true, `${mode}: 誤りの文を出さない`);
    // 選んでから、名前で探す欄で Enter
    click($('.pick-card[data-pick="d-cli"]'));
    setValue($('.pick-search'), '取引');
    key(app, $('.pick-search'), { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok($('.modal'), `${mode}: 名前で検索欄の Enter では入れない`);
    assert.deepEqual(sys('y-exp').designIds, ids);
    // 名前で探す欄の外（システムで絞る欄）の Enter は、今までどおり肯定
    key(app, $('.pick-sys'), { key: 'Enter' });
    await waitFor(() => !$('.modal'), { label: `${mode}: 肯定` });
  }
  assert.equal(sys('y-exp').designIds.length, 4, '入れる（d-cli）と複製して入れる（d-cli のコピー）');
  // ほかの窓（新しいシステム）の名前の欄の Enter は、今までどおり肯定
  click($('.home-head [data-action="new-system"]'));
  await waitFor(() => $('.modal [name=name]'));
  setValue($('.modal [name=name]'), '備品管理システム');
  key(app, $('.modal [name=name]'), { key: 'Enter' });
  await waitFor(() => !$('.modal'), { label: '新しいシステム' });
  assert.ok($$('.sys-list .sys-item .nm').some((e) => e.textContent === '備品管理システム'));
});

test('システムの画面から「新しい画面設計…」: 入れるシステムの最初の値は、開いていたシステム（最初の画面で選んでいたまとまりではない）', async (t) => {
  const { api, $, item } = await boot(t);
  click(item('y-exp'));
  api.openSystem('y-trip');
  api.runCommand('newDesign');
  assert.equal(api.ui.view, 'home');
  await waitFor(() => $('.modal [name=system]'));
  assert.equal($('.modal [name=system]').value, 'y-trip');
  click($('[data-dlg="cancel"]'));
  await waitFor(() => !$('.modal'));
  // 最初の画面からは、今までどおり選んでいるまとまり
  api.runCommand('newDesign');
  await waitFor(() => $('.modal [name=system]'));
  assert.equal($('.modal [name=system]').value, 'y-exp');
  click($('[data-dlg="cancel"]'));
});
