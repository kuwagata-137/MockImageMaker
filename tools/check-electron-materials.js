// tools/check-electron.js の場面 11（資料の置き場。第 9 段階の後半）。本物の Electron のアプリを窓を出さずに起動し、システムに資料のファイルを入れ、読み、消えるかを確かめる。
// 見本は make-material-samples.js が作る架空の出張申請の資料。保存先は .devdata/check-userData-mat（毎回消してから始める）。
//  1 回目: システムを 1 つ作り、システムの資料の入口の「＋ ファイルを入れる…」を押す（窓を出さず、環境変数 MIM_MATERIAL_FILES の見本の 6 種類を入れる）。
//     表に 6 行・<userData>/data/files/<システムの id>/ に 6 つのファイル（見本と同じ中身）。本物の Electron で materialsAPI.read（Excel の番地・Word の見出し・
//     PDF の日本語の文字と 3 ページ目の画像・BDM の文・Shift_JIS の文字・PNG）と bdmPlan。「スイムレーン図にする」で役割と作業が入る。
//     1 行を消して閉じる → 消した行のファイルは残る（元に戻すで行が戻ったときにファイルが要るため）
//  2 回目（起動し直す）: 行は 5 つ。1 つ前の保存（.bak）に消した行が残っているので、消した行のファイルはまだ残る（設計どおり）。
//     ファイルを落とす操作を CDP の Input.dispatchDragEvent で試し（できなければ「手で確かめる」と出す）、次の保存（メモ）を挟んで閉じる
//  3 回目（もう一度起動し直す）: 消した行のファイルが消え、ほかのファイルは残る。システムをごみ箱へ移して完全に削除すると、そのフォルダが消える
//  4 回目: 保存を止める起動（データの形の版 99 の designs.json）では、どの行にも指されていないファイルが消えず、designs.json も変わらない
'use strict';

const fs = require('fs');
const path = require('path');
const { removeTree, ensureSamples, SAMPLE_FILES, SAMPLES_DIR } = require('./material-sample-place');
const { report, readAll, checkReads, noteParallelReads, SIX } = require('./check-electron-materials-read');

const KIND_NAMES = ['Excel', 'Word', 'PDF', 'BDM の図', '文字', '画像'];
const DELETED = SAMPLE_FILES.image; // 1 回目で消す行
const DROPPED = SAMPLE_FILES.legacy; // 2 回目で落とすファイル（古い形の Excel）
// 条件がそろうまで待つ（そろえば true、ms たってもそろわなければ false）
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

// アプリを起動して、テスト用の窓口つきのページを返す。extraEnv は環境変数（MIM_MATERIAL_FILES）
async function open(h, userData, extraEnv = {}) {
  const child = h.launch([`--remote-debugging-port=${h.PORT}`], userData, extraEnv);
  const browser = await h.connect();
  const page = await h.appPage(browser);
  await h.enableTestHooks(page);
  return { child, browser, page };
}
async function closeApp(h, { child, browser, page }) {
  await page.evaluate(() => window.close());
  browser.disconnect();
  return h.withTimeout(child.exited, 30000, '資料の確かめのアプリが閉じない');
}
const saved = (page) => page.evaluate(() => window.__test__.store.whenSaved());
const materialsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__test__.store.state.systems[0].materials)));

// 1 回目: 入れる → 表と置き場 → 読む → スイムレーン図にする → 1 行を消す
async function buildRun(h) {
  const files = SIX.map((n) => path.join(SAMPLES_DIR, n));
  const app = await open(h, h.USER_DATA_MAT, { MIM_MATERIAL_FILES: JSON.stringify(files) });
  const { page } = app;
  const sysId = await page.evaluate(() => {
    const T = window.__test__;
    const id = T.actions.createSystem({ name: '出張申請システム（資料の確かめ）' });
    T.openSystem(id, { panel: 'materials' });
    return id;
  });
  await page.waitForSelector('#sys-view [data-action="sys-mat-pick"]');
  await page.click('#sys-view [data-action="sys-mat-pick"]');
  await page.waitForFunction(() => document.querySelectorAll('#sys-view .mat-tbl tbody tr').length === 6, { timeout: 30000 });
  const table = await page.$$eval('#sys-view .mat-tbl tbody tr', (trs) => trs.map((tr) => [tr.querySelector('.mat-name b').textContent, tr.children[1].textContent.trim()]));
  const rows = await materialsOf(page);
  await saved(page);
  const dir = path.join(h.USER_DATA_MAT, 'data', 'files', sysId);
  const same = rows.every((m, i) => fs.existsSync(path.join(dir, m.file)) && fs.readFileSync(path.join(dir, m.file)).equals(fs.readFileSync(files[i])));
  let ok = report(table.map((t) => t.join('=')).join() === SIX.map((n, i) => `${n}=${KIND_NAMES[i]}`).join() && listFiles(dir).length === 6 && same && rows.every((m) => /^m-[A-Za-z0-9-]+\.[a-z0-9]+$/.test(m.file)),
    '「＋ ファイルを入れる…」で 6 種類を入れると、表に 6 行・置き場（data/files/<システムの id>/）に 6 つのファイル（見本と同じ中身）', table.map((t) => `${t[0]}（${t[1]}）`).join('、'));
  ok = checkReads(await page.evaluate(readAll, rows, sysId, false)) && ok;
  noteParallelReads(await page.evaluate(readAll, rows, sysId, true));
  ok = (await swimFromBdm(page, rows)) && ok;
  await page.evaluate(() => window.__test__.openSystemPanel('materials'));
  const image = rows.find((m) => m.name === DELETED);
  await page.click(`#sys-view [data-action="sys-mat-del"][data-id="${image.id}"]`);
  await page.waitForFunction(() => document.querySelectorAll('#sys-view .mat-tbl tbody tr').length === 5);
  await saved(page);
  const stored = JSON.parse(fs.readFileSync(path.join(h.USER_DATA_MAT, 'data', 'designs.json'), 'utf8')).systems[0];
  ok = report(stored.materials.length === 5 && listFiles(dir).length === 6 && fs.existsSync(path.join(dir, image.file)),
    `「${DELETED}」の行を消して保存すると、designs.json は 5 行・ファイルは 6 つのまま（行が戻る場合に備えて消さない）`, `行 ${stored.materials.length}・ファイル ${listFiles(dir).length}`) && ok;
  const code = await closeApp(h, app);
  return { sysId, dir, imageFile: image.file, rows, ok: ok && code === 0 };
}

// 「スイムレーン図にする」（BDM の行）。bdmPlan の案と、置き換えた後の役割・作業・矢印・作業の src
async function swimFromBdm(page, rows) {
  const bdm = rows.find((m) => m.kind === 'bdm');
  const sysId = await page.evaluate(() => window.__test__.ui.systemId);
  const plan = await page.evaluate((id, m) => window.materialsAPI.bdmPlan({ systemId: id, file: m.file }), sysId, bdm);
  await page.click(`#sys-view [data-action="sys-mat-swim"][data-id="${bdm.id}"]`);
  await page.waitForFunction(() => window.__test__.ui.sysPanel === 'swimlane', { timeout: 30000 });
  const y = await page.evaluate(() => {
    const s = window.__test__.store.state.systems[0];
    return JSON.parse(JSON.stringify({ roles: s.roles.map((r) => r.name), steps: s.swimlane.steps, edges: s.swimlane.edges.length }));
  });
  return report(plan.ok && plan.plan.roles.join() === '申請者,上長,経理' && plan.plan.steps.length === 8 && y.roles.join() === '申請者,上長,経理' && y.steps.length === 8 && y.edges === 8
    && y.steps.every((w) => w.src && w.src.material === bdm.id),
  '本物の Electron の bdmPlan の案から、「スイムレーン図にする」で役割 3・作業 8・矢印 8 が入り、作業の src に資料の id が入る', `案 ${plan.ok ? `役割 ${plan.plan.roles.length}・作業 ${plan.plan.steps.length}` : JSON.stringify(plan.error)} ／ 図 役割 ${y.roles.join('・')}・作業 ${y.steps.length}・矢印 ${y.edges}`);
}

// ファイルを落とす操作を CDP で試す。戻り値は入った行の数（0 なら落とせなかった）
async function tryDrop(page, filePath) {
  const before = (await materialsOf(page)).length;
  const cdp = await page.createCDPSession();
  const box = await (await page.waitForSelector('#sys-view .mat-drop')).boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...at, data });
    await page.waitForFunction((n) => window.__test__.store.state.systems[0].materials.length > n, { timeout: 5000 }, before);
  } catch (_) { /* 落とせなかった */ }
  return (await materialsOf(page)).length - before;
}

// 2 回目: 起動し直す → 行は 5 つ・消した行のファイルはまだ残る → 落とす操作 → 次の保存（メモ）を挟んで閉じる
async function restartRun(h, b) {
  const app = await open(h, h.USER_DATA_MAT);
  const { page } = app;
  await page.evaluate((id) => window.__test__.openSystem(id, { panel: 'materials' }), b.sysId);
  await page.waitForSelector('#sys-view .mat-tbl tbody tr');
  await h.sleep(1500); // 起動時の掃除（書き込みが済んでから動く）を待つ
  const rows = await page.$$eval('#sys-view .mat-tbl tbody tr', (t) => t.length);
  let ok = report(rows === 5 && fs.existsSync(path.join(b.dir, b.imageFile)) && listFiles(b.dir).length === 6,
    '起動し直すと表は 5 行。1 つ前の保存（.bak）に消した行が残っているので、消した行のファイルは、この起動の掃除ではまだ消えない', `行 ${rows}・ファイル ${listFiles(b.dir).length}`);
  const dropped = await tryDrop(page, path.join(SAMPLES_DIR, DROPPED));
  if (dropped === 1) {
    const last = (await materialsOf(page)).pop();
    ok = report(last.name === DROPPED && fs.existsSync(path.join(b.dir, last.file)), `ファイルを落とす操作（CDP の Input.dispatchDragEvent）で「${DROPPED}」が資料に入り、置き場にファイルができる`, `行 ${last.name}・${last.file}`) && ok;
  } else {
    console.log(`… 資料: ファイルを落とす操作（CDP の Input.dispatchDragEvent の files）では、資料が入らなかった。手で確かめる: 資料の入口の枠にエクスプローラーからファイルを落とし、行が増えてファイルが置き場にできるか`);
  }
  await page.evaluate(() => { const T = window.__test__; T.actions.setMaterialMemo(T.ui.systemId, T.store.state.systems[0].materials[0].id, '保存を 1 回挟むためのメモ'); });
  await saved(page);
  const code = await closeApp(h, app);
  return { ok: ok && code === 0, dropped: dropped === 1 };
}

// 3 回目: 消した行のファイルが消え、ほかは残る → システムをごみ箱へ移して完全に削除 → フォルダが消える
async function sweepRun(h, b, restart) {
  const app = await open(h, h.USER_DATA_MAT);
  const { page } = app;
  const want = SIX.filter((n) => n !== DELETED).length + (restart.dropped ? 1 : 0);
  await h.sleep(500);
  const gone = await waitFor(() => !fs.existsSync(path.join(b.dir, b.imageFile)), 15000);
  const left = listFiles(b.dir);
  let ok = report(gone && left.length === want, `もう一度起動し直すと、消した行のファイルが片付けられ、ほかのファイル（${want} つ）は残る`, `ファイル ${left.length}（消した行のファイルは${gone ? 'ない' : 'まだある'}）`);
  await page.evaluate(() => window.__test__.goHome());
  await page.waitForSelector('.sys-head [data-action="sys-menu"]');
  await page.click('.sys-head [data-action="sys-menu"]');
  await page.click('.sys-pop [data-action="sys-trash"]');
  await page.click('[data-action="toggle-trash"]');
  await page.click('.trash-row.sys [data-action="delete-system-forever"]');
  await page.waitForSelector('.modal [data-dlg="ok"]');
  await page.click('.modal [data-dlg="ok"]');
  const removed = await waitFor(() => !fs.existsSync(b.dir), 15000);
  ok = report(removed && (await page.evaluate(() => window.__test__.store.state.systems.length)) === 0,
    'システムをごみ箱へ移して完全に削除すると、そのシステムの資料のフォルダが消える', `フォルダ${removed ? 'は消えた' : 'が残っている'}`) && ok;
  const code = await closeApp(h, app);
  return ok && code === 0;
}

// 4 回目: 保存を止める起動（データの形の版 99）。どの行にも指されていないファイルが消えず、designs.json も変わらない
async function blockedRun(h) {
  const data = path.join(h.USER_DATA_MAT, 'data');
  const orphan = path.join(data, 'files', 'y-block-1', 'm-block-1.txt');
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, '指されていないファイル（保存を止める起動では消さない）', 'utf8');
  const stateFile = path.join(data, 'designs.json');
  fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 99, settings: {}, systems: [], designs: [] }), 'utf8');
  const before = fs.readFileSync(stateFile, 'utf8');
  const app = await open(h, h.USER_DATA_MAT);
  const blocked = await app.page.evaluate(() => !!window.__test__.store.blockReason);
  await h.sleep(2500); // 掃除が動くなら、動く時間を待つ
  const code = await closeApp(h, app);
  return report(blocked && fs.existsSync(orphan) && fs.readFileSync(stateFile, 'utf8') === before && code === 0,
    '保存を止める起動（データの形の版 99）では、どの行にも指されていないファイルを消さず、designs.json も変えない', `保存を止めた ${blocked}・ファイル ${fs.existsSync(orphan) ? '残った' : '消えた'}`);
}

// h は check-electron.js の道具 { launch, connect, appPage, enableTestHooks, withTimeout, sleep, PORT, USER_DATA_MAT }
module.exports = async function checkMaterials(h) {
  removeTree(h.USER_DATA_MAT);
  await ensureSamples();
  const built = await buildRun(h);
  const restart = await restartRun(h, built);
  const swept = await sweepRun(h, built, restart);
  const blocked = await blockedRun(h);
  return built.ok && restart.ok && swept && blocked;
};
