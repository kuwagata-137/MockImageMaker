'use strict';
// AI の窓口の export_bdm（スイムレーン図を MPD に出力する。第 11 段階の T4）のテスト。ページは render（kind "bdm"）を返し、HTML を作って書くのは main
// （automation-render.js の finishBdm。そのテストは test/automation-main.test.js）。資料の窓口（preload.js の materialsAPI）は身代わり。
// 名前は架空の業務（営業管理・出張申請など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { systemState, system, swStep, OLD, STORAGE_KEY, plain } = require('./ai-fixtures');
const { TOOLS } = require('../mcp-tools');
const { GUIDES } = require('../mcp-guide');

const mat = (id, name, kind, file) => ({ id, name, kind, size: 100, addedAt: OLD, memo: '', file });

// 営業管理システム（y1。役割 2 つ・作業 3 つ・矢印 2 本）に資料を 4 つ（文字・MPD 2 つ・ファイルのない MPD）。作業 w1 は m2 の箱 e4、w2 は m3 の箱 e9 から読んだ。
// ごみ箱の古いシステム（y3）に作業 1 つと MPD、出張申請システム（y4。作業がない）に MPD
function exportState() {
  const st = systemState();
  const y1 = st.systems[0];
  y1.materials = [mat('m1', '受注の流れ.txt', 'text', 'm1.txt'), mat('m2', '受注の流れ.html', 'bdm', 'm2.html'), mat('m3', '受注の流れ（前の版）.html', 'bdm', 'm3.html'), mat('m4', '消えた流れ.html', 'bdm', '')];
  y1.swimlane.steps[0].src = { id: 'e4', material: 'm2' };
  y1.swimlane.steps[1].src = { id: 'e9', material: 'm3' };
  Object.assign(st.systems[2], {
    roles: [{ id: 'l9', name: '総務', memo: '' }], swimlane: { steps: [swStep('w9', 'l9', 0, 'task', '片付ける')], edges: [] }, materials: [mat('m9', '古い流れ.html', 'bdm', 'm9.html')],
  });
  st.systems.push(system('y4', '出張申請システム', [], { materials: [mat('m7', '出張申請の流れ.html', 'bdm', 'm7.html')] }));
  return st;
}

function fakeMaterialsAPI() {
  const fail = async () => ({ ok: false, error: { code: 'unavailable', message: '身代わり' } });
  return { available: true, pick: fail, addDropped: fail, read: fail, bdmPlan: fail, bdmExport: fail, sweep: fail, removeSystem: fail };
}
async function boot({ state = exportState(), materialsAPI = fakeMaterialsAPI() } = {}) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state) }, materialsAPI });
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  return { app, T, call, sys: (id) => plain(T.store.state.systems.find((y) => y.id === id)) };
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
const ng = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r.result)); if (code) assert.equal(r.error.code, code, r.error.message); return r.error; };

test('export_bdm: 資料の MPD を id か名前で指し、main に作らせる render（kind "bdm"・システムの id・ファイルの名前・渡す形・ファイルの名前の案）を返す。読むだけで、システムは変わらない', async () => {
  const { app, call, sys } = await boot();
  const before = sys('y1');
  const r = await call('export_bdm', { system: '営業管理システム', material: '受注の流れ.html' });
  assert.deepEqual(ok(r), { system: { id: 'y1', name: '営業管理システム', updatedAt: OLD }, material: { id: 'm2', name: '受注の流れ.html' }, lanes: 2, steps: 3, edges: 2 });
  assert.deepEqual(r.render, {
    kind: 'bdm', systemId: 'y1', file: 'm2.html', name: '営業管理システム_スイムレーン.html',
    plan: {
      name: '営業管理システム', lanes: ['営業', '上長'],
      steps: [
        { key: 'w1', lane: 0, col: 0, kind: 'start', text: '始まり', box: 'e4' },
        { key: 'w2', lane: 0, col: 1, kind: 'input', text: '顧客を登録する', box: null },
        { key: 'w3', lane: 1, col: 2, kind: 'decision', text: '確かめる', box: null },
      ],
      edges: [{ from: 'w1', to: 'w2', label: '' }, { from: 'w2', to: 'w3', label: '' }],
    },
  });
  assert.deepEqual(sys('y1'), before, 'システムは変わらない（改訂履歴の行も足さない）');
  assert.deepEqual((await call('export_bdm', { system: 'y1', material: 'm3' })).render.plan.steps.map((s) => s.box), [null, 'e9', null], 'その MPD の箱から読んだ作業だけ box を付ける');
  assert.equal((await call('export_bdm', { system: '古いシステム', material: '古い流れ.html' })).render.file, 'm9.html', 'ごみ箱のシステムも出力できる');
  app.close();
});

test('export_bdm: MPD でない資料・作業がないスイムレーン図は bad_request、ファイルのない資料は file_missing、ない資料は not_found、資料の窓口がなければ unavailable', async () => {
  const { app, call } = await boot();
  assert.match(ng(await call('export_bdm', { system: 'y1', material: 'm1' }), 'bad_request').message, /^「受注の流れ\.txt」は MPD の資料ではありません（種類: 文字）。/);
  assert.equal(ng(await call('export_bdm', { system: 'y4', material: 'm7' }), 'bad_request').message, 'スイムレーン図に作業がないので、MPD に出力しません。');
  assert.match(ng(await call('export_bdm', { system: 'y1', material: 'm4' }), 'file_missing').message, /「消えた流れ\.html」のファイルがありません/);
  ng(await call('export_bdm', { system: 'y1', material: 'ない流れ.html' }), 'not_found');
  ng(await call('export_bdm', { system: 'y1' }), 'bad_request');
  app.close();
  const none = await boot({ materialsAPI: null });
  ng(await none.call('export_bdm', { system: 'y1', material: 'm2' }), 'unavailable');
  none.app.close();
});

test('export_bdm: 役割の見つからない作業とその矢印は外し、返事の droppedSteps に数を書く。役割のある作業がなければ、そう書いて断る', async () => {
  const state = exportState();
  state.systems[0].swimlane.steps[2].roleId = 'l-gone';
  const { app, call } = await boot({ state });
  const r = await call('export_bdm', { system: 'y1', material: 'm2' });
  assert.equal(ok(r).droppedSteps, 1);
  assert.deepEqual(r.render.plan.steps.map((s) => s.key), ['w1', 'w2']);
  assert.deepEqual(r.render.plan.edges, [{ from: 'w1', to: 'w2', label: '' }]);
  app.close();
  const orphan = exportState();
  orphan.systems[0].swimlane.steps.forEach((w) => { w.roleId = 'l-gone'; });
  const b = await boot({ state: orphan });
  assert.equal(ng(await b.call('export_bdm', { system: 'y1', material: 'm2' }), 'bad_request').message, 'スイムレーン図に役割のある作業がないので、MPD に出力しません。', '作業はあるが、どれも役割が見つからない');
  b.app.close();
});

test('export_bdm: 入口の道具は system と material を受け取り、時間のかかる道具。手引きの守ることと段階 ⑤ に export_bdm を書く', () => {
  const t = TOOLS.find((x) => x.name === 'export_bdm');
  assert.equal(t.title, 'MPD に出力');
  assert.equal(t.slow, true);
  assert.deepEqual(Object.keys(t.input.shape).sort(), ['material', 'system']);
  assert.match(t.description, /人に頼まれたときだけ使う/);
  assert.match(t.description, /元の資料のファイルは書き換えない/);
  assert.match(GUIDES.rules.text, /export_bdm（スイムレーンを MPD に出力する）も、人に頼まれたときだけ使ってください。/);
  assert.match(GUIDES.stages.text, /スイムレーンの MPD が要るときは export_bdm/);
  assert.match(GUIDES.overview.text, /7\. スイムレーンを MPD に出力する（人に頼まれたとき）/);
});
