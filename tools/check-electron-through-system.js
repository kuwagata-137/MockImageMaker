// tools/check-electron-through.js（通しの確かめ）のシステムの段。最初の画面の「＋ 新しいシステム」から架空の出張申請システムを作り、
// 人が使う順に、資料を入れて読む → MPD の資料から「スイムレーン図にする」→ 役割を足す → 作業の箱を置いてつなぎ、画面設計を指す → 設計ノート、と進める。
// 資料は、窓を出さない起動の「＋ ファイルを入れる…」（環境変数 MIM_MATERIAL_FILES の見本の 6 種類。make-material-samples.js が作る架空の資料）。
// 操作はどれも本物のマウスとキー（check-electron-through-ui.js）。できた中身は、ページの中の状態で確かめる。
'use strict';

const { noModal, dialogOk, typeField, selectByText, stateOf, report } = require('./check-electron-through-ui');
const { SAMPLE_FILES } = require('./material-sample-place');

const SYSTEM = '出張申請システム';
const NEW_ROLE = '総務';
const NEW_STEP = '出張の記録を残す';
const NOTE = {
  findings: '業務: 社員が出張の前に申請し、上長が承認する。戻ったら経理が概算払いを処理する。',
  question: '海外出張も、このシステムで申請するか',
  decision: '役割に総務を足し、出張の記録を残す',
  reason: '旅費規程の第 2 条から',
};

const systemOf = (s, name = SYSTEM) => s.systems.find((y) => y.name === name && !y.trashedAt);
const openPanel = (page, panel) => page.click(`#sys-list .db-entry[data-panel="${panel}"]`);

// 最初の画面の「＋ 新しいシステム」→ 名前と説明 →「作る」→ 左の一覧で選ばれたシステムの「開く」
async function createSystem(page) {
  await page.click('.home-head [data-action="new-system"]');
  await page.waitForSelector('.modal [name=name]');
  await page.type('.modal [name=name]', SYSTEM);
  await page.type('.modal [name=description]', '出張の事前申請と、上長の承認、旅費の精算までをまとめる。');
  await dialogOk(page);
  const id = systemOf(await stateOf(page)).id;
  await page.click(`[data-action="open-system"][data-id="${id}"]`);
  await page.waitForSelector('#sys-view', { visible: true });
  return id;
}

// 資料: 「＋ ファイルを入れる…」で 6 種類 → Word の行の「読む」の窓に規程の文が出る → MPD の行の「スイムレーン図にする」
async function materialsToSwimlane(page) {
  await openPanel(page, 'materials');
  await page.click('#sys-view [data-action="sys-mat-pick"]');
  await page.waitForFunction(() => document.querySelectorAll('#sys-view .mat-tbl tbody tr').length === 6, { timeout: 30000 });
  const mats = systemOf(await stateOf(page)).materials;
  const word = mats.find((m) => m.name === SAMPLE_FILES.word);
  await page.click(`#sys-view [data-action="sys-mat-read"][data-id="${word.id}"]`);
  await page.waitForFunction(() => /第 1 条/.test((document.querySelector('.modal .rd-text') || {}).textContent || ''), { timeout: 60000 });
  const read = await page.$eval('.modal .rd-text', (e) => e.textContent);
  await page.click('.modal [data-dlg="cancel"]');
  await noModal(page);
  report(mats.length === 6 && /旅費規程/.test(read), '資料: 「＋ 資料を追加する…」で 6 種類を入れ、Word の行の「読む」の窓に規程の文が出る',
    `資料 ${mats.map((m) => m.name).join('・')}`);
  const bdm = mats.find((m) => m.kind === 'bdm');
  await page.click(`#sys-view [data-action="sys-mat-swim"][data-id="${bdm.id}"]`);
  await page.waitForFunction(() => window.__test__.ui.sysPanel === 'swimlane', { timeout: 60000 });
  const y = systemOf(await stateOf(page));
  report(y.roles.map((r) => r.name).join() === '申請者,上長,経理' && y.swimlane.steps.length === 8 && y.swimlane.edges.length === 8,
    '資料の MPD の行の「スイムレーン図にする」で、役割 3・工程 8・矢印 8 が入る', `役割 ${y.roles.map((r) => r.name).join('・')}`);
}

// 役割の入口の「＋ 役割を足す」で「総務」を足す（足すと名前の欄が選ばれた形でフォーカスが来る）
async function addRole(page) {
  await openPanel(page, 'roles');
  await page.click('#sys-view [data-action="sys-role-add"]');
  await page.keyboard.type(NEW_ROLE);
  await page.keyboard.press('Tab');
}

// 図の中の位置（帯 roleName・列 col の枠の真ん中）を、画面の上のマウスの位置にする（swimPoint の逆）
function cellPoint(page, roleName, col) {
  return page.evaluate((name, c) => {
    const T = window.__test__;
    const y = T.store.state.systems.find((x) => x.id === T.ui.systemId);
    const lane = T.swimlaneLayout(T.swimlaneModel(T.store.state, y), y).lanes.find((l) => l.role.name === name);
    const r = document.querySelector('#sys-swim .swim-inner').getBoundingClientRect();
    return { x: r.left + (T.SWIM_X0 + c * T.SWIM_COL + 100) * T.ui.sysZoom, y: r.top + (lane.y + lane.h / 2) * T.ui.sysZoom };
  }, roleName, col);
}

// スイムレーン図: 全体を表示 → 置き場の「作業」を押して総務の帯に置き、文字を打つ → 接続モードで「概算払いを処理する」からつなぐ →
// 入力の作業の箱を選び、右の欄で指す画面設計・画面・ステータスを選ぶ
async function editSwimlane(page) {
  await openPanel(page, 'swimlane');
  await page.click('#toolbar [data-action="zoom-fit"]');
  await page.click('#sys-box .pal-btn[data-kind="task"]');
  const at = await cellPoint(page, NEW_ROLE, 1);
  await page.mouse.click(at.x, at.y);
  await typeField(page, '#sys-side [data-sw="text"]', NEW_STEP);
  await page.click('#sys-box .pal-btn[data-kind="task"]'); // もう一度押して、置くのをやめる
  let y = systemOf(await stateOf(page));
  const added = y.swimlane.steps.find((w) => w.text === NEW_STEP);
  const from = y.swimlane.steps.find((w) => w.text === '概算払いを処理する');
  await page.click('#toolbar [data-action="swim-connect"]');
  await page.click(`#sys-swim .mnode[data-node="w:${from.id}"]`);
  await page.click(`#sys-swim .mnode[data-node="w:${added.id}"]`);
  await page.click('#toolbar [data-action="swim-select"]');
  const input = y.swimlane.steps.find((w) => w.kind === 'input');
  await page.click(`#sys-swim .mnode[data-node="w:${input.id}"]`);
  await selectByText(page, '#sys-side [data-sw="ref-design"]', '出張申請');
  await selectByText(page, '#sys-side [data-sw="ref-screen"]', '新規申請');
  await selectByText(page, '#sys-side [data-sw="ref-state"]', '申請');
  y = systemOf(await stateOf(page));
  const role = y.roles.find((r) => r.name === NEW_ROLE);
  const step = y.swimlane.steps.find((w) => w.id === added.id);
  const ref = y.swimlane.steps.find((w) => w.id === input.id).ref;
  const trip = (await stateOf(page)).designs.find((d) => d.name === '出張申請');
  report(role && step && step.roleId === role.id && step.kind === 'task' && y.swimlane.edges.some((e) => e.from === from.id && e.to === added.id),
    `役割「${NEW_ROLE}」を足し、その帯に作業の箱「${NEW_STEP}」を置いて「概算払いを処理する」からつなぐ`, `作業 ${y.swimlane.steps.length}・矢印 ${y.swimlane.edges.length}`);
  report(ref.designId === trip.id && ref.screenId === trip.screens[0].id && ref.stateId === trip.items.find((x) => x.type === 'status').props.states[0].id,
    `作業の箱「${input.text}」が、出張申請の「新規申請」の画面と「申請」のステータスを指す`);
}

// 設計ノート: ① の札の「読み取ったこと」・まだ決まっていないことを足す・決めたことと理由を足す
async function writeNotes(page) {
  await openPanel(page, 'notes');
  await page.click('#sys-view .nt-tab[data-stage="read"]');
  await typeField(page, '#sys-view [data-sy="note-findings"]', NOTE.findings);
  await page.click('#sys-view [data-action="sys-note-add-q"]');
  await page.keyboard.type(NOTE.question);
  await page.keyboard.press('Tab');
  await page.click('#sys-view [data-action="sys-note-add-d"]');
  await page.keyboard.type(NOTE.decision);
  await page.keyboard.press('Tab');
  const d = systemOf(await stateOf(page)).notes.decisions.find((x) => x.text === NOTE.decision);
  await typeField(page, `#sys-view [data-sy="note-d-reason"][data-note="${d.id}"]`, NOTE.reason);
  const n = systemOf(await stateOf(page)).notes;
  report(n.findings === NOTE.findings && n.questions.some((q) => q.text === NOTE.question) && n.decisions.some((x) => x.text === NOTE.decision && x.reason === NOTE.reason),
    '設計ノート: 読み取ったこと・まだ決まっていないこと・決めたことと理由');
}

module.exports = { createSystem, materialsToSwimlane, addRole, editSwimlane, writeNotes, SYSTEM, NEW_STEP, NOTE };
