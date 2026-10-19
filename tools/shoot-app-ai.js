// tools/shoot-app.js の AI の場面（--only=ai。場面 94〜100）。第 7 段階の AI の見た目（仕様_細かい決めごと.md の「AI の見た目の細かい決めごと」）を撮る。
// preload の aiAPI の身代わりを入れてアプリを開き、AI の頼みはテスト用の窓口の aiDispatch で送る。中身は架空の業務（顧客管理など）だけ。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { sampleState } = require('../test/ai-fixtures');
const { connectInfo } = require('../automation-connect');
const { trayIconPng } = require('../automation-tray');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GLOW_PEAK_MS = 450; // 紫の枠がいちばん強く光るころ（2 秒で 2 回光る）

// インストールした版の場所（架空のユーザー名）で作った登録の文
const CONNECT = connectInfo({
  packaged: true,
  execPath: 'C:\\Users\\user\\AppData\\Local\\Programs\\mockimagemaker\\MockImageMaker.exe',
  resourcesPath: 'C:\\Users\\user\\AppData\\Local\\Programs\\mockimagemaker\\resources',
});

async function openAiApp(browser, { ROOT, HTML_NAME }, clients) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 860 });
  await page.evaluateOnNewDocument((data, info, list) => {
    window.__test__ = {};
    window.aiAPI = {
      onRequest() {},
      ready() {},
      onStatus(cb) { setTimeout(() => cb({ clients: list }), 0); },
      connectInfo: async () => info,
      copyText: async () => true,
    };
    localStorage.clear();
    localStorage.setItem('mockimagemaker.v1', data);
  }, JSON.stringify(sampleState()), CONNECT, clients);
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  await sleep(50);
  return page;
}
const ai = async (page, tool, args, session = 's-1') => {
  const r = await page.evaluate((t, a, s) => window.__test__.aiDispatch(t, a, { session: s, client: 'claude-code' }), tool, args, session);
  if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
  return r;
};
const CC = [{ session: 's-1', client: 'claude-code' }];

module.exports = async function shootAi(browser, env) {
  const { shot } = env;
  // 94: 一覧の画面。紫の札と、AI が作ったカード・帯
  let page = await openAiApp(browser, env, CC);
  await ai(page, 'create_design', { name: '経費精算', target: 'kintone', description: '立て替えた経費を申請し、上長が承認する。' });
  await ai(page, 'update_design', { design: '受注管理', description: '受注から請求までを管理する。' });
  await sleep(GLOW_PEAK_MS);
  await shot(page, '94_AI_一覧の画面_紫の札とAIが作ったカード');
  await page.close();

  // 95〜97: 開いている画面設計を AI が直したとき（紫の帯・札と光り方・ほかの画面の「AI」の印・変更内容の窓）
  page = await openAiApp(browser, env, CC);
  await page.evaluate(() => window.__test__.openDesign('d1'));
  for (let i = 0; i < 3; i++) await page.click('[data-action="zoom-out"]');
  await ai(page, 'edit_items', { design: 'd1', ops: [{ op: 'add', name: '電話番号', type: 'text1' }, { op: 'add', name: 'メールアドレス', type: 'text1' }, { op: 'update', item: '区分', name: '顧客区分' }] });
  await ai(page, 'layout_screen', { design: 'd1', screen: '新規登録', mode: 'append', layout: { columns: 2, rows: [[{ item: '電話番号' }, { item: 'メールアドレス' }]] } });
  await ai(page, 'layout_screen', { design: 'd1', screen: '一覧', layout: { rows: [[{ type: 'search' }, { type: 'filter' }], [{ type: 'table', tableKind: 'records', rows: 6, span: 2 }]] } });
  await sleep(GLOW_PEAK_MS);
  await shot(page, '95_AI_開いている画面設計を直したとき_紫の帯と札');
  await page.click('#screen-list .sl-item[data-id="s2"]');
  await sleep(GLOW_PEAK_MS);
  await shot(page, '96_AI_AIの印の付いた画面を開いたとき');
  await page.click('[data-action="ai-show-changes"]');
  await page.waitForSelector('.modal .cg-table');
  await shot(page, '97_AI_変更内容を見る窓');
  await page.click('.modal [data-dlg="cancel"]');
  await page.close();

  // 98: 元に戻すの履歴を消したとき（オレンジの帯）と、その後の Ctrl+Z の知らせ
  page = await openAiApp(browser, env, CC);
  await page.evaluate(() => {
    window.__test__.openDesign('d1');
    window.__test__.actions.updateDesignInfo('d1', { description: '取引先と顧客の連絡先を管理する（人の変更）。' });
  });
  for (let i = 0; i < 3; i++) await page.click('[data-action="zoom-out"]');
  await ai(page, 'update_design', { design: '受注管理', description: '受注から請求までを管理する。' });
  await page.evaluate(() => window.__test__.runCommand('undo')); // 履歴を消した後の Ctrl+Z（下に黒い帯のお知らせ）
  await shot(page, '98_AI_元に戻すの履歴を消したとき_オレンジの帯');
  await page.close();

  // 99: 「AI とつなぐ」の窓（2 つつながっているとき）
  page = await openAiApp(browser, env, [...CC, { session: 's-2', client: 'cursor' }]);
  await page.evaluate(() => window.__test__.openDesign('d1'));
  await page.click('#ai-chip');
  await page.waitForSelector('.modal .aic-sec');
  await page.click('.modal [data-copy="claude"]');
  await shot(page, '99_AI_AIとつなぐ窓');
  await page.close();

  // 100: タスクトレイのアイコン（automation-tray.js が作る PNG を、そのままの大きさと 4 倍で並べる）
  page = await browser.newPage();
  await page.setViewport({ width: 720, height: 400 });
  const img = (size, dot, scale) => `<img src="data:image/png;base64,${trayIconPng(size, dot).toString('base64')}" width="${size * scale}" height="${size * scale}" style="image-rendering:pixelated">`;
  const row = (dot) => `<div class="row"><b>${dot ? 'AI がつながっている（右下に紫の点）' : '裏で動いている（AI はつながっていない）'}</b>
    <span>${[16, 24, 32].map((s) => img(s, dot, 1)).join('')}</span><span>${img(32, dot, 4)}</span></div>`;
  await page.setContent(`<!DOCTYPE html><meta charset="utf-8"><style>body{font-family:'Yu Gothic UI','Meiryo',sans-serif;margin:20px;color:#1e293b}
    .row{display:flex;align-items:center;gap:24px;margin:14px 0}.row b{width:300px;font-size:14px}.row span{display:flex;align-items:flex-end;gap:12px}
    .bar{background:#e2e8f0;padding:6px 10px;border-radius:6px;display:inline-flex;gap:10px}</style>
    <h3 style="margin:0 0 6px">タスクトレイのアイコン（16・24・32 ドットと、32 ドットを 4 倍にしたもの）</h3>${row(false)}${row(true)}`);
  await shot(page, '100_AI_タスクトレイのアイコン');
  await page.close();
};
