'use strict';
// 見た目（第 12 段階。業務アプリの見た目とCRM_設計書.md の 5 章・画像 q105〜q108）のテスト。
// 標準・Salesforce・kintone の見た目の描き分け、見た目を変えたときに部品をずらすこと、項目の出し方（表示の形）、右の欄と新しい画面設計の窓、
// AI の道具の look・bandTabs・itemView。画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, waitFor } = require('./harness');
const { sampleState, STORAGE_KEY, plain } = require('./ai-fixtures');

const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function check(el) {
  el.checked = true;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

async function boot(state = sampleState()) {
  const app = bootApp(state ? { localStorage: { [STORAGE_KEY]: JSON.stringify(state) } } : {});
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const d = (id) => plain(T.store.state.designs.find((x) => x.id === id));
  return { app, T, call, d };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };
const ys = (scr) => Object.fromEntries(scr.parts.map((p) => [p.id, p.y]));

test('見た目のない画面設計は標準として読み、標準の画面の HTML には見た目のクラスを付けない（帯は前と同じ 1 行）', async () => {
  const { app, T, d } = await boot();
  const d1 = d('d1');
  assert.deepEqual([d1.look, d1.bandTabs, d1.screens.map((s) => s.itemView)], ['standard', [], ['input', 'input']]);
  const html = T.screenHtml(T.store.state.designs[0], T.store.state.designs[0].screens[0]);
  assert.ok(html.startsWith('<div class="screen" style="width:1280px;height:800px"><div class="screen-band">顧客管理 ／ 新規登録</div>'), html.slice(0, 120));
  T.openDesign('d1');
  assert.equal($(app, '.screen-frame .screen').className, 'screen grid');
  assert.deepEqual(plain(T.LOOKS.map((l) => [l.id, l.label, l.band])), [['standard', '標準', 40], ['salesforce', 'Salesforce', 88], ['kintone', 'kintone', 88]]);
  app.close();
});

test('知らない見た目・帯のタブ・項目の出し方は、読み込むときに直す（タブは文字だけ・前後の空白を取る・空の行を捨てる・12 個まで）', async () => {
  const st = sampleState();
  Object.assign(st.designs[0], { look: 'blue', bandTabs: [' ホーム ', '', 3, '顧客', null] });
  st.designs[0].screens[0].itemView = 'table';
  st.designs[0].screens[1].itemView = 'show';
  Object.assign(st.designs[1], { look: 'kintone', bandTabs: Array.from({ length: 15 }, (_, i) => `タブ ${i + 1}`) });
  const { app, d } = await boot(st);
  assert.deepEqual([d('d1').look, d('d1').bandTabs, d('d1').screens.map((s) => s.itemView)], ['standard', ['ホーム', '顧客'], ['input', 'show']]);
  assert.equal(d('d2').look, 'kintone');
  assert.equal(d('d2').bandTabs.length, 12);
  app.close();
});

test('Salesforce の見た目: 帯は 2 行。タブを書いていなければ「ホーム」と画面設計の名前で、画面設計の名前のタブに下線。kintone の見た目: 場所と画面の名前', async () => {
  const { app, T } = await boot();
  T.actions.updateDesignInfo('d1', { look: 'salesforce' });
  T.openDesign('d1');
  assert.equal($(app, '.screen-frame .screen').className, 'screen grid look-sf');
  assert.ok($(app, '.screen-frame .screen-band.sfb .sfb-logo'), 'ロゴの所は点線の箱');
  assert.equal($(app, '.screen-frame .sfb-app').textContent, '顧客管理');
  const tabs = () => $$(app, '.screen-frame .sfb-tab').map((e) => e.textContent.replace(/\s*▾$/, ''));
  assert.deepEqual(tabs(), ['ホーム', '顧客管理']);
  assert.equal($(app, '.screen-frame .sfb-tab.on').textContent.replace(/\s*▾$/, ''), '顧客管理');
  T.actions.updateDesignInfo('d1', { bandTabs: ['ホーム', '取引先', 'レポート'] });
  assert.deepEqual(tabs(), ['ホーム', '取引先', 'レポート']);
  assert.equal($(app, '.screen-frame .sfb-tab.on'), null, '画面設計の名前と同じタブがなければ、下線は付けない');

  T.actions.updateDesignInfo('d1', { look: 'kintone' });
  assert.equal($(app, '.screen-frame .screen').className, 'screen grid look-kt');
  assert.equal($(app, '.screen-frame .ktb-crumb').textContent, 'ポータル ＞ 顧客管理');
  assert.deepEqual([$(app, '.screen-frame .ktb-appname').textContent, $(app, '.screen-frame .ktb-view').textContent], ['顧客管理', '新規登録']);
  assert.equal($(app, '.screen-frame .sfb-tab'), null);
  app.close();
});

test('見た目を変えると、帯のある画面の帯の下の部品と吹き出しを帯の高さの差だけずらし、画面も伸ばす。帯の上の部品・帯のない画面は動かさない', async () => {
  const st = sampleState();
  st.designs[0].screens[0].parts.push({ id: 'pb', type: 'button', x: 1100, y: 0, w: 96, h: 40, no: null, label: '閉じる', props: { style: 'normal' } });
  st.designs[0].screens[1] = { ...st.designs[0].screens[1], showHeader: false, parts: [{ id: 'pc', type: 'heading', x: 32, y: 64, w: 400, h: 32, no: null, label: '一覧' }] };
  const { app, T, d } = await boot(st);
  const before = d('d1');
  assert.deepEqual(ys(before.screens[0]), { p1: 64, p2: 152, p3: 64, pb: 0 });
  T.actions.updateDesignInfo('d1', { look: 'salesforce' });
  const sf = d('d1');
  assert.deepEqual(ys(sf.screens[0]), { p1: 112, p2: 200, p3: 112, pb: 0 }, '帯の下の部品だけ 48 下へ');
  assert.equal(sf.screens[0].callouts[0].y, 148, '吹き出しも一緒にずらす');
  assert.equal(sf.screens[0].height, 848);
  assert.deepEqual([ys(sf.screens[1]), sf.screens[1].height], [{ pc: 64 }, 800], '帯のない画面は動かさない');
  T.actions.updateDesignInfo('d1', { look: 'kintone' });
  assert.deepEqual(ys(d('d1').screens[0]), { p1: 112, p2: 200, p3: 112, pb: 0 }, '帯の高さが同じ見た目どうしでは動かさない');
  T.actions.updateDesignInfo('d1', { look: 'standard' });
  assert.deepEqual([ys(d('d1').screens[0]), d('d1').screens[0].height, d('d1').screens[0].callouts[0].y], [{ p1: 64, p2: 152, p3: 64, pb: 0 }, 800, 100], '標準に戻すと元の位置');
  // 見た目の変更は 1 回の変更（元に戻すで、見た目と位置がまとめて戻る）
  T.actions.updateDesignInfo('d1', { look: 'salesforce' });
  T.runCommand('undo');
  assert.deepEqual([d('d1').look, ys(d('d1').screens[0])], ['standard', { p1: 64, p2: 152, p3: 64, pb: 0 }]);
  app.close();
});

test('帯の高い見た目では、部品を置くとき・ひな形の画面の部品が、帯の高さの差だけ下になる', async () => {
  const { app, T, d } = await boot();
  T.actions.updateDesignInfo('d1', { look: 'salesforce' });
  const pid = T.actions.addPart('d1', 's2', 'text1', { x: 32, y: 10 });
  assert.equal(d('d1').screens[1].parts.find((p) => p.id === pid).y, 88, '帯の下に置く');
  const sid = T.actions.addScreen('d1', 'input');
  assert.equal(Math.min(...d('d1').screens.find((s) => s.id === sid).parts.map((p) => p.y)), 112);
  const sid2 = T.actions.addScreen('d2', 'input');
  assert.equal(Math.min(...d('d2').screens.find((s) => s.id === sid2).parts.map((p) => p.y)), 64, '標準の見た目は前と同じ');
  app.close();
});

test('右の欄: 見た目を選べ、Salesforce のときだけ帯のタブ（1 行に 1 つ）を書ける。帯の欄の説明も見た目に合わせる', async () => {
  const { app, T, d } = await boot();
  T.openDesign('d1');
  assert.equal($(app, '[data-field="design-look"]:checked').value, 'standard');
  assert.equal($(app, '[data-field="design-tabs"]'), null);
  check($(app, '[data-field="design-look"][value="salesforce"]'));
  assert.equal(d('d1').look, 'salesforce');
  assert.equal($(app, '[data-field="design-tabs"]').getAttribute('placeholder'), 'ホーム\n顧客管理');
  setValue($(app, '[data-field="design-tabs"]'), 'ホーム\n\n 取引先 \n');
  assert.deepEqual(d('d1').bandTabs, ['ホーム', '取引先']);
  assert.match($(app, '[data-field="screen-header"]').closest('label').textContent, /ロゴ・検索・アプリ名・タブ/);
  check($(app, '[data-field="design-look"][value="kintone"]'));
  assert.equal($(app, '[data-field="design-tabs"]'), null);
  assert.match($(app, '[data-field="screen-header"]').closest('label').textContent, /ロゴ・場所・アプリ名・画面の名前/);
  app.close();
});

test('項目の出し方: 右の欄で表示の形を選ぶと、その画面に view-show が付く。変更内容の一覧にも出る', async () => {
  const { app, T, d } = await boot();
  const before = plain(T.store.state.designs[0]);
  T.openDesign('d1');
  assert.equal($(app, '[data-field="item-view"]:checked').value, 'input');
  check($(app, '[data-field="item-view"][value="show"]'));
  assert.deepEqual(d('d1').screens.map((s) => s.itemView), ['show', 'input']);
  assert.ok($(app, '.screen-frame .screen').classList.contains('view-show'));
  T.actions.updateDesignInfo('d1', { look: 'salesforce', bandTabs: ['ホーム', '取引先'] });
  const rows = plain(T.designDiff(before, T.store.state.designs[0], T.store.state).rows);
  const design = rows.find((r) => r.screen === '画面設計').text;
  assert.match(design, /見た目：標準 → Salesforce/);
  assert.match(design, /帯のタブ：ホーム・顧客管理 → ホーム・取引先/);
  assert.match(rows.find((r) => r.screen === '新規登録' && r.change === '画面の設定変更').text, /項目の出し方：入力の形 → 表示の形/);
  app.close();
});

test('新しい画面設計の窓: 作る先を選ぶと見た目も同じものになり（その他は標準）、見た目は選び直せる', async () => {
  const { app, T } = await boot(null);
  const open = async () => {
    click($(app, '[data-action="new"]'));
    await waitFor(() => $(app, '.modal [name=new-look]'));
  };
  const look = () => $(app, '.modal [name=new-look]:checked').value;
  await open();
  assert.equal(look(), 'kintone', '最初の作る先 kintone の見た目');
  setValue($(app, '.modal .target-select'), 'b:salesforce');
  assert.equal(look(), 'salesforce');
  setValue($(app, '.modal .target-select'), 'b:claude');
  assert.equal(look(), 'standard');
  setValue($(app, '.modal .target-select'), 'b:kintone');
  check($(app, '.modal [name=new-look][value="standard"]'));
  setValue($(app, '.modal [name=name]'), '顧客管理');
  click($(app, '[data-dlg="ok"]'));
  await waitFor(() => T.ui.view === 'editor', { label: '編集の画面' });
  assert.deepEqual([T.store.state.designs[0].target, T.store.state.designs[0].look], ['kintone', 'standard'], '選び直した見た目で作る');
  click($(app, '[data-action="home"]'));
  await open();
  setValue($(app, '.modal .target-select'), '__other__');
  assert.equal(look(), 'standard', 'その他は標準');
  app.close();
});

test('中身の印: 見た目の欄が最初の値（標準・タブなし・入力の形）なら、v1.00 と同じ中身で比べる（v1.00 で出力した HTML を取り込むときのため）', async () => {
  const { app, T } = await boot();
  const content = () => T.comparableContent(T.store.state.designs[0], T.store.state);
  assert.doesNotMatch(content(), /"look"|"bandTabs"|"itemView"/);
  assert.match(T.legacyContent(T.store.state.designs[0], T.store.state), /^(?!.*"look").*$/s);
  T.actions.updateDesignInfo('d1', { look: 'kintone' });
  assert.match(content(), /"look":"kintone"/);
  app.close();
});

test('AI: create_design は look を省くと作る先の見た目。update_design で見た目と帯のタブを直すと、ずらしたことを知らせる。get_design・get_catalog に見た目', async () => {
  const { app, call, d } = await boot();
  assert.equal(ok(await call('create_design', { name: '経費精算', target: 'kintone' })).look, 'kintone');
  assert.equal(ok(await call('create_design', { name: '出張申請', target: 'その他の作る先' })).look, 'standard');
  const sf = ok(await call('create_design', { name: '商談管理', target: 'Salesforce', bandTabs: ['ホーム', '商談管理', '取引先'] }));
  assert.equal(sf.look, 'salesforce');
  assert.deepEqual(d(sf.id).bandTabs, ['ホーム', '商談管理', '取引先']);
  assert.equal(ok(await call('create_design', { name: '日報', target: 'kintone', look: 'standard' })).look, 'standard');
  ng(await call('create_design', { name: '在庫管理', look: 'blue' }), 'bad_request');

  const r = ok(await call('update_design', { design: 'd1', look: 'salesforce' }));
  assert.equal(r.look, 'salesforce');
  assert.match(r.warnings[0], /帯の高さが 40 から 88 になったので.*48 ドットずらしました/);
  assert.deepEqual(ys(d('d1').screens[0]), { p1: 112, p2: 200, p3: 112 });
  const g = ok(await call('get_design', { design: 'd1' }));
  assert.deepEqual([g.look, g.bandTabs, g.screens.map((s) => s.itemView)], ['salesforce', ['ホーム', '顧客管理'], ['input', 'input']]);
  ok(await call('update_design', { design: 'd1', bandTabs: ['ホーム', '取引先'] }));
  assert.deepEqual(d('d1').bandTabs, ['ホーム', '取引先']);
  ok(await call('update_design', { design: 'd1', bandTabs: null }));
  assert.deepEqual(d('d1').bandTabs, []);
  ng(await call('update_design', { design: 'd1', bandTabs: 'ホーム' }), 'bad_request');
  assert.equal(ok(await call('update_design', { design: 'd1', look: 'kintone' })).warnings, undefined, '帯の高さが同じなら知らせない');
  assert.equal(ok(await call('get_design', { design: 'd1' })).bandTabs, undefined, 'Salesforce の見た目のときだけ帯のタブを返す');
  assert.equal(ok(await call('list_designs')).designs.find((x) => x.id === 'd1').look, 'kintone');

  const cat = ok(await call('get_catalog'));
  assert.deepEqual(cat.looks, [
    { id: 'standard', name: '標準', bandHeight: 40, firstRowY: 64 }, { id: 'salesforce', name: 'Salesforce', bandHeight: 88, firstRowY: 112 }, { id: 'kintone', name: 'kintone', bandHeight: 88, firstRowY: 112 },
  ]);
  assert.deepEqual(cat.itemViews, { input: '入力の形', show: '表示の形' });
  app.close();
});

test('AI: edit_screen で項目の出し方を直し、get_screen で読める。並べ方の最初の行は見た目の帯の下（帯の高い見た目は y=112）', async () => {
  const { app, call, d } = await boot();
  const r = ok(await call('edit_screen', { design: 'd1', ops: [{ op: 'update', screen: '新規登録', itemView: 'show' }] }));
  assert.equal(r.screens[0].itemView, 'show');
  assert.equal(ok(await call('get_screen', { design: 'd1', screen: '新規登録' })).itemView, 'show');
  ng(await call('edit_screen', { design: 'd1', ops: [{ op: 'update', screen: '新規登録', itemView: 'table' }] }), 'bad_request');
  ok(await call('update_design', { design: 'd1', look: 'kintone' }));
  const lay = ok(await call('layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ item: '顧客コード' }]] } }));
  assert.equal(lay.parts[0].y, 112);
  assert.equal(d('d1').screens[1].parts[0].y, 112);
  app.close();
});
