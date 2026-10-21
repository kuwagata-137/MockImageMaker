'use strict';
// 第 11 段階（T3）: システムのスイムレーン図を MPD に出力する入口（画像 q82）のテスト。
// 入口 A: 資料の表の MPD の行の「MPD に出力…」。入口 B: メニューバーの「出力」の小さなメニューの「MPD に出力…」と、元にする MPD を選ぶ窓。
// 資料の窓口（preload.js の materialsAPI）と出力の窓口（exportAPI）は身代わり。システムと資料の名前は架空の業務（出張申請・経費精算・備品管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const KEY = 'mockimagemaker.v1';
const OLD = '2026-10-01T00:00:00.000Z';
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async () => { await tick(); await tick(); };
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
// その日のその時刻（テストを動かす PC の時刻で作る。入れた日は PC の時刻の日付で出す）
const at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();

// ── 見本（架空の業務）──
const NO_REF = { designId: null, screenId: null, stateId: null };
const step = (id, roleId, col, kind, text, src = null) => ({ id, roleId, col, kind, text, memo: '', ref: { ...NO_REF }, src });
const material = (id, name, kind, file, addedAt, memo = '') => ({ id, name, kind, size: 4096, addedAt, memo, file });
const system = (id, name, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds: [], roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
// 出張申請システム（役割 2 つ・作業 3 つ〔列は 0・2・3〕・矢印 2 本。MPD の資料 2 つ。作業 w-1 は m-bdm の箱 e5、w-2 は m-old の箱 e7 から読んだ）・
// 経費精算システム（MPD の資料 1 つ。作業がない）・備品管理システム（作業はあるが、資料がない）
function sampleState() {
  return plain({
    schemaVersion: 3,
    settings: { customTargets: [], mapPos: {} },
    designs: [],
    systems: [
      system('y-trip', '出張申請システム', {
        roles: [{ id: 'l-app', name: '申請者', memo: '' }, { id: 'l-boss', name: '上長', memo: '' }],
        swimlane: {
          steps: [
            step('w-1', 'l-app', 0, 'start', '出張が決まる', { id: 'e5', material: 'm-bdm' }),
            step('w-2', 'l-app', 2, 'input', '出張申請を入力する', { id: 'e7', material: 'm-old' }),
            step('w-3', 'l-boss', 3, 'decision', '申請を確かめる'),
          ],
          edges: [{ id: 'e-1', from: 'w-1', to: 'w-2', label: '' }, { id: 'e-2', from: 'w-2', to: 'w-3', label: '出す' }],
        },
        materials: [
          material('m-xlsx', '出張申請書.xlsx', 'excel', 'm-xlsx.xlsx', at(19, 9, 30), '今の紙の様式'),
          material('m-bdm', '出張申請の流れ.html', 'bdm', 'm-bdm.html', at(19, 10, 0), '総務が描いた今の流れ'),
          material('m-old', '出張申請の流れ（前の版）.html', 'bdm', 'm-old.html', at(20, 8, 15)),
        ],
      }),
      system('y-exp', '経費精算システム', { materials: [material('m-flow', '経費精算の流れ.html', 'bdm', 'm-flow.html', at(17, 8, 0))] }),
      system('y-eq', '備品管理システム', { roles: [{ id: 'l-eq', name: '総務', memo: '' }], swimlane: { steps: [step('w-9', 'l-eq', 0, 'task', '備品を数える')], edges: [] } }),
    ],
  });
}

// 資料の窓口の身代わり。bdmExport の頼みを calls に控える。reply で返事を差し替える（最初は、保存の窓で選んだ所に書けた返事）
function fakeMaterialsAPI({ bdmExport = true } = {}) {
  const calls = [];
  let reply = async (req) => ({ ok: true, path: `C:\\出力\\${req.name}`, warnings: [], counts: { lanes: req.plan.lanes.length, steps: req.plan.steps.length, edges: req.plan.edges.length } });
  const api = {
    available: true,
    pick: async () => ({ ok: false, canceled: true }),
    addDropped: async () => ({ ok: true, added: [], skipped: [] }),
    read: async () => ({ ok: false, error: { code: 'unavailable', message: '身代わり' } }),
    bdmPlan: async () => ({ ok: false, error: { code: 'unavailable', message: '身代わり' } }),
    sweep: async () => ({ ok: true, removedFiles: 0, removedDirs: 0 }),
    removeSystem: async () => ({ ok: true, removed: 0 }),
  };
  if (bdmExport) api.bdmExport = (req) => { calls.push(plain(req)); return reply(req); };
  return { api, calls, reply: (fn) => { reply = fn; } };
}
const canceled = async () => ({ ok: false, canceled: true });
const fakeExportAPI = () => ({ saveHtml: canceled, savePdf: canceled, savePng: canceled, openHtml: canceled });

async function boot(t, { state = sampleState(), materials = fakeMaterialsAPI(), sysId = 'y-trip', panel = 'materials' } = {}) {
  const app = bootApp({ localStorage: { [KEY]: JSON.stringify(state) }, materialsAPI: materials.api, exportAPI: fakeExportAPI() });
  t.after(() => app.close());
  const api = await app.api();
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  api.openSystem(sysId, { panel });
  return {
    app, api, $, $$, materials, calls: materials.calls,
    // 資料の表の行の操作のボタンの文字
    ops: (id) => [...$(`#sys-view .mat-tbl tr[data-id="${id}"] .mat-ops`).querySelectorAll('button')].map((b) => b.textContent),
    btn: (action, id) => $(`#sys-view [data-action="${action}"][data-id="${id}"]`),
    toast: () => $('#toast').textContent,
    // 小さなメニューの項目 [文字, 小さな字, 押せないか]
    menu: () => $$('.sys-pop [role="menuitem"]').map((b) => [b.querySelector('b').textContent, b.querySelector('small').textContent, b.disabled]),
    openExportMenu: () => click($('#toolbar [data-action="export"]')),
  };
}

const TRIP_PLAN = {
  name: '出張申請システム', lanes: ['申請者', '上長'],
  steps: [
    { key: 'w-1', lane: 0, col: 0, kind: 'start', text: '出張が決まる', box: 'e5' },
    { key: 'w-2', lane: 0, col: 2, kind: 'input', text: '出張申請を入力する', box: null },
    { key: 'w-3', lane: 1, col: 3, kind: 'decision', text: '申請を確かめる', box: null },
  ],
  edges: [{ from: 'w-1', to: 'w-2', label: '' }, { from: 'w-2', to: 'w-3', label: '出す' }],
};

// ── 入口 A: 資料の表の MPD の行 ──
test('入口 A: MPD の行だけに「MPD に出力…」（「スイムレーン図にする」と「消す」の間）。資料の窓口に bdmExport がないときは出さない', async (t) => {
  const { ops, btn } = await boot(t);
  assert.deepEqual(ops('m-bdm'), ['読む', 'スイムレーン図にする', 'MPD に出力…', '消す']);
  assert.deepEqual(ops('m-old'), ['読む', 'スイムレーン図にする', 'MPD に出力…', '消す']);
  assert.deepEqual(ops('m-xlsx'), ['読む', '消す']);
  assert.match(btn('sys-mat-export', 'm-bdm').title, /元のファイルは書き換えません/);
  const old = await boot(t, { materials: fakeMaterialsAPI({ bdmExport: false }) });
  assert.deepEqual(old.ops('m-bdm'), ['読む', 'スイムレーン図にする', '消す']);
});

test('入口 A: 押した行の MPD を元に頼む（渡す形・<システムの名前>_スイムレーン.html）。その MPD の箱から読んだ作業だけ box を付ける。出力したら場所を知らせる', async (t) => {
  const { btn, calls, toast } = await boot(t);
  click(btn('sys-mat-export', 'm-bdm'));
  await ticks();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { systemId: 'y-trip', file: 'm-bdm.html', plan: TRIP_PLAN, name: '出張申請システム_スイムレーン.html' });
  assert.equal(toast(), 'MPD に出力しました（C:\\出力\\出張申請システム_スイムレーン.html）。');
  click(btn('sys-mat-export', 'm-old'));
  await ticks();
  assert.equal(calls[1].file, 'm-old.html');
  assert.deepEqual(calls[1].plan.steps.map((s) => s.box), [null, 'e7', null], '別の MPD の箱から読んだ作業には付けない');
});

test('入口 A: 読み直しの食い違いは注意として添える。保存の窓の取りやめは知らせない。失敗は資料の窓口の文（文がないときは決まりの文）', async (t) => {
  const { $, btn, materials, toast } = await boot(t);
  const press = async () => { click(btn('sys-mat-export', 'm-bdm')); await ticks(); };
  materials.reply(async () => ({ ok: true, path: 'C:\\出力\\a.html', warnings: ['作業「出張が決まる」は、MPD で読み直すと種類が「作業」になります（アプリでは「始まり」）。', '2 つ目'] }));
  await press();
  assert.equal(toast(), 'MPD に出力しました（C:\\出力\\a.html）。注意: 作業「出張が決まる」は、MPD で読み直すと種類が「作業」になります（アプリでは「始まり」）。（ほか 1 件）');
  $('#toast').textContent = '';
  materials.reply(canceled);
  await press();
  assert.equal(toast(), '', '取りやめは知らせない');
  materials.reply(async () => ({ ok: false, error: { code: 'read_failed', message: '「出張申請の流れ.html」を読めませんでした。' } }));
  await press();
  assert.equal(toast(), '「出張申請の流れ.html」を読めませんでした。');
  materials.reply(async () => ({ ok: false }));
  await press();
  assert.equal(toast(), '「出張申請の流れ.html」を元に、MPD に出力できませんでした。');
});

test('入口 A: 作業がないスイムレーン図は出力しない。役割の見つからない作業とその矢印は外し、外した数を知らせる', async (t) => {
  const exp = await boot(t, { sysId: 'y-exp' });
  click(exp.btn('sys-mat-export', 'm-flow'));
  await ticks();
  assert.equal(exp.calls.length, 0);
  assert.equal(exp.toast(), 'スイムレーン図に作業がないので、MPD に出力しません。');
  const state = sampleState();
  state.systems[0].swimlane.steps[2].roleId = 'l-gone';
  const trip = await boot(t, { state });
  click(trip.btn('sys-mat-export', 'm-bdm'));
  await ticks();
  assert.deepEqual(trip.calls[0].plan.steps.map((s) => s.key), ['w-1', 'w-2']);
  assert.deepEqual(trip.calls[0].plan.edges, [{ from: 'w-1', to: 'w-2', label: '' }]);
  assert.equal(trip.toast(), 'MPD に出力しました（C:\\出力\\出張申請システム_スイムレーン.html）。役割の見つからない作業 1 つは入れませんでした。');
});

test('入口 A: 打ちかけのメモを頼む前に保存する。待つ間は、同じ資料の 2 回目の頼みを重ねない（待ちが終わると、また頼める）', async (t) => {
  const { api, $, btn, calls, materials } = await boot(t);
  const memo = $('#sys-view [data-sy="mat-memo"][data-mat="m-bdm"]');
  memo.focus();
  memo.value = '出力の元にする流れ';
  let release = null;
  materials.reply(() => new Promise((r) => { release = () => r({ ok: true, path: 'C:\\出力\\a.html', warnings: [] }); }));
  click(btn('sys-mat-export', 'm-bdm'));
  await tick();
  assert.equal(api.store.state.systems[0].materials[1].memo, '出力の元にする流れ');
  click(btn('sys-mat-export', 'm-bdm'));
  await tick();
  assert.equal(calls.length, 1, '待つ間は重ねない');
  release();
  await ticks();
  click(btn('sys-mat-export', 'm-bdm'));
  await tick();
  assert.equal(calls.length, 2);
});

// ── 入口 B: メニューバーの「出力」の小さなメニューと、元にする MPD を選ぶ窓 ──
test('入口 B: メニューバーの「出力」で小さなメニュー。「MPD に出力…」は押せないとき、理由を小さな字で出す', async (t) => {
  const { api, $, menu, openExportMenu } = await boot(t, { panel: 'swimlane' });
  openExportMenu();
  assert.deepEqual(menu(), [['説明書（PDF）を出力…', 'システム 1 つ分を、1 つの PDF にする', false], ['MPD に出力…', '資料の MPD を元にして、スイムレーン図を入れる', false]]);
  assert.equal($('.sys-pop').getAttribute('aria-label'), '出力');
  api.openSystem('y-exp');
  openExportMenu();
  assert.deepEqual(menu()[1], ['MPD に出力…', 'スイムレーン図に作業がありません', true]);
  api.openSystem('y-eq');
  openExportMenu();
  assert.deepEqual(menu()[1], ['MPD に出力…', '資料に MPD がありません（左の「資料」から入れます）', true]);
  const old = await boot(t, { materials: fakeMaterialsAPI({ bdmExport: false }), panel: 'swimlane' });
  old.openExportMenu();
  assert.deepEqual(old.menu()[1], ['MPD に出力…', 'デスクトップ版のアプリで使えます', true]);
});

test('入口 B: 元にする MPD を選ぶ窓。題・ボタンの並び（「出力…」が左）・資料の MPD の行（最初の行を選ぶ）。キャンセルでは頼まない。選んだ MPD で頼む', async (t) => {
  const { $, $$, calls, toast, openExportMenu } = await boot(t, { panel: 'swimlane' });
  const openPicker = async () => {
    openExportMenu();
    click($('.sys-pop [data-action="sys-export-mpd"]'));
    await tick();
  };
  await openPicker();
  assert.equal($('.sys-pop'), null, '項目を押すとメニューは閉じる');
  assert.equal($('.modal h2').textContent, '「出張申請システム」のスイムレーン図を MPD に出力');
  assert.deepEqual($$('.modal-actions button').map((b) => b.textContent), ['出力…', 'キャンセル']);
  assert.match($('.modal .xp-note').textContent, /^スイムレーン図（役割 2・作業 3・矢印 2）を、MultipurposeDiagramMaker で開いて直せる HTML ファイルに出力します。/);
  assert.match($('.modal .xp-note').textContent, /元のファイルは書き換えません/);
  assert.deepEqual($$('.mpd-pick label').map((l) => [l.querySelector('b').textContent, l.querySelector('small').textContent, l.querySelector('input').checked]), [
    ['出張申請の流れ.html', '総務が描いた今の流れ・2026-10-19 に入れた', true],
    ['出張申請の流れ（前の版）.html', '2026-10-20 に入れた', false],
  ]);
  click($('[data-dlg="cancel"]'));
  await ticks();
  assert.equal(calls.length, 0);
  await openPicker();
  $$('.mpd-pick input')[1].checked = true;
  click($('[data-dlg="ok"]'));
  await ticks();
  assert.equal($('.modal'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'm-old.html');
  assert.deepEqual(calls[0].plan.steps.map((s) => s.box), [null, 'e7', null]);
  assert.equal(toast(), 'MPD に出力しました（C:\\出力\\出張申請システム_スイムレーン.html）。');
});

test('入口 B: 打ちかけの役割の名前を、メニューを開く前に保存し、出力する図に入れる', async (t) => {
  const { api, $, calls } = await boot(t, { panel: 'roles' });
  const name = $('#sys-view [data-sy="role-name"][data-role="l-app"]');
  name.focus();
  name.value = '申請する人';
  api.runCommand('exportDialog');
  assert.equal(api.store.state.systems[0].roles[0].name, '申請する人');
  click($('.sys-pop [data-action="sys-export-mpd"]'));
  await tick();
  click($('[data-dlg="ok"]'));
  await ticks();
  assert.deepEqual(calls[0].plan.lanes, ['申請する人', '上長']);
});
