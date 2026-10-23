// tools/check-electron-through.js（通しの確かめ）の画面設計の段。システムの画面の左の「＋ 画面設計を入れる」から、架空の画面設計を 2 つ作る。
//  出張申請: 説明・画面の名前の変更（「…」のメニュー）・部品の箱からドラッグして項目の部品 4 つ（データベースの項目も 4 つ増える）とステータスとボタン・
//    ひな形から「詳細」「一覧」の画面・ボタンの移る先（詳細の画面）・操作する人・改訂する（第 1 版）・ステータスの移り方と画面の移り方の図
//  社員マスタ: 画面の名前の変更・項目の部品 3 つ
// 操作はどれも本物のマウスとキー（check-electron-through-ui.js）。できた中身は、ページの中の状態（window.__test__.store.state）で確かめる。
'use strict';

const { dialogOk, typeField, selectByText, fitScreen, dropPart, stateOf, report } = require('./check-electron-through-ui');

const TRIP = '出張申請';
const EMPLOYEE = '社員マスタ';
// [部品の種類, 項目名, 置く位置（画面の左上からのドット）]。2 列に並べ、重ならないように離す
const TRIP_PARTS = [['user', '申請者', 60, 100], ['text1', '行き先', 480, 100], ['date', '出発日', 60, 200], ['number', '概算の金額', 480, 200]];
const EMPLOYEE_PARTS = [['text1', '社員番号', 60, 100], ['text1', '氏名', 480, 100], ['text1', '部署', 60, 200]];

// システムの画面の左の「＋ 画面設計を入れる」→「新しい画面設計を作る」→ 名前 →「作って開く」。編集の画面が開くまで待つ
async function newDesignInSystem(page, name) {
  await page.click('#sys-list .sys-add');
  await page.click('#sys-menu-root [data-action="sys-add-new"]');
  await page.waitForSelector('.modal [name=name]');
  await page.type('.modal [name=name]', name);
  await dialogOk(page);
  await page.waitForSelector('#side-panel [data-field="design-desc"]', { visible: true });
}

// 左の画面の一覧の「…」→「名前の変更」で、開いている画面の名前を変える
async function renameScreen(page, name) {
  const id = await page.$eval('.sl-item.active', (e) => e.dataset.id);
  await page.hover(`.sl-wrap[data-id="${id}"]`);
  await page.click(`.sl-more[data-id="${id}"]`);
  await page.click('.screen-menu [data-action="screen-rename"]');
  await page.waitForSelector('.modal [name=name]');
  await page.$eval('.modal [name=name]', (el) => el.select());
  await page.keyboard.type(name);
  await dialogOk(page);
}

// 画面の全体が見えるまで縮めてから、部品の箱から部品をドラッグして置き、項目名の欄に名前を打つ
async function addParts(page, list) {
  await fitScreen(page);
  for (const [type, label, x, y] of list) {
    await dropPart(page, type, x, y);
    await typeField(page, '#side-settings [data-pf="label"]', label);
  }
}

// 左の「＋」→ ひな形を選ぶ →「足す」
async function addScreenFromTemplate(page, tpl) {
  await page.click('.sl-add');
  await page.waitForSelector(`.modal .tpl[data-tpl="${tpl}"]`);
  await page.click(`.modal .tpl[data-tpl="${tpl}"]`);
  await dialogOk(page);
}

const designNamed = (s, name) => s.designs.find((d) => d.name === name && !d.trashedAt);

// 「申請する」のボタンを選び直し、移る先を「詳細」の画面にする。ステータスの最初の操作の「操作する人」を打つ
async function setFlowAndProcess(page) {
  const d = designNamed(await stateOf(page), TRIP);
  const first = d.screens.find((s) => s.name === '新規申請');
  const button = first.parts.find((p) => p.type === 'button');
  await page.click(`.sl-item[data-action="select-screen"][data-id="${first.id}"]`);
  await page.click(`#stage .part[data-part-id="${button.id}"]`);
  await page.select('#side-settings [data-pf="props.to"]', 'screen');
  await selectByText(page, '#side-settings [data-pf="props.screenId"]', '詳細の画面');
  const status = d.items.find((x) => x.type === 'status');
  const statusPart = first.parts.find((p) => p.itemId === status.id);
  await page.click(`#stage .part[data-part-id="${statusPart.id}"]`);
  await typeField(page, `#side-settings [data-pa="${status.props.actions[0].id}"][data-k="role"]`, '申請者');
}

// メニューバーの ▼ の「改訂する」で第 1 版を作る
async function addRevision(page, note) {
  await page.click('#tb-rev-arrow');
  await page.click('#rev-menu-root [data-action="add-revision"]');
  await page.waitForSelector('.modal [name="rv-note"]');
  await page.type('.modal [name="rv-note"]', note);
  await dialogOk(page);
}

// 左の一覧の「ステータスの移り方」「画面の移り方」を押し、真ん中に出た図の箱の数を返す
async function openDiagram(page, action, view) {
  await page.click(`#screen-list .db-entry[data-action="${action}"]`);
  await page.waitForSelector(`#db-view .map-inner[data-view="${view}"]`, { visible: true });
  return page.$$eval(`#db-view .map-inner[data-view="${view}"] .mnode`, (n) => n.length);
}

async function buildTrip(page) {
  await newDesignInSystem(page, TRIP);
  await typeField(page, '#side-panel [data-field="design-desc"]', '社員が出張の前に申請し、上長が承認する。');
  await renameScreen(page, '新規申請');
  await addParts(page, TRIP_PARTS);
  await dropPart(page, 'status', 60, 320);
  await addParts(page, [['button', '申請する', 60, 440]]);
  await addScreenFromTemplate(page, 'detail');
  await addScreenFromTemplate(page, 'list');
  await setFlowAndProcess(page);
  await addRevision(page, '最初の版（通しの確かめ）。');
  const processNodes = await openDiagram(page, 'open-process', 'process');
  const flowNodes = await openDiagram(page, 'open-flow', 'flow');
  const d = designNamed(await stateOf(page), TRIP);
  const items = d.items.map((x) => x.name);
  const screens = d.screens.map((s) => s.name);
  const button = d.screens[0].parts.find((p) => p.type === 'button');
  const status = d.items.find((x) => x.type === 'status');
  const detail = d.screens.find((s) => s.name === '詳細');
  report(d.description === '社員が出張の前に申請し、上長が承認する。' && screens.join() === '新規申請,詳細,一覧'
    && TRIP_PARTS.every(([, n]) => items.includes(n)) && !!status && d.screens[0].parts.length === 6,
  '画面設計「出張申請」: 説明・画面の名前の変更・項目の部品 4 つとステータスとボタン・ひな形の画面 2 つ', `画面 ${screens.join('・')} ／ 項目 ${items.join('・')}`);
  report(button && button.label === '申請する' && button.props.to === 'screen' && detail && button.props.screenId === detail.id
    && status.props.actions[0].role === '申請者' && processNodes === status.props.states.length && flowNodes >= 2,
  'ボタンの移る先（詳細）と操作する人。ステータスの移り方と画面の移り方の図が出る', `ステータスの図の箱 ${processNodes} ／ 画面の図の箱 ${flowNodes}`);
  report(d.revisions.length === 1 && d.revisions[0].kind === 'revision' && d.revisions[0].no === 1 && !!d.revisions[0].snapshot,
    '改訂する（第 1 版と写し）', d.revisions.map((r) => `第 ${r.no} 版・${r.note}`).join('、'));
  return d;
}

async function buildEmployee(page) {
  await newDesignInSystem(page, EMPLOYEE);
  await renameScreen(page, '一覧');
  await addParts(page, EMPLOYEE_PARTS);
  const d = designNamed(await stateOf(page), EMPLOYEE);
  report(d.screens.map((s) => s.name).join() === '一覧' && d.items.map((x) => x.name).join() === EMPLOYEE_PARTS.map(([, n]) => n).join(),
    '画面設計「社員マスタ」: 画面の名前の変更・項目の部品 3 つ', d.items.map((x) => x.name).join('・'));
  return d;
}

// システムの画面へ戻る（編集の画面のメニューバーの「←システムへ」）
async function backToSystem(page) {
  await page.click('#tb-home');
  await page.waitForSelector('#sys-view', { visible: true });
}

module.exports = { buildTrip, buildEmployee, backToSystem, TRIP, EMPLOYEE };
