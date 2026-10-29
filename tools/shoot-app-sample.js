// tools/shoot-app.js の CRM の見本の場面（--only=sample。場面 257〜277）。第 17 段階（画像 q132〜q135 のとおりか）を撮る。
// 「＋ 新しいシステム」のウィンドウ（白紙のシステム・CRM の見本）・作った後の最初の画面・システムの画面・スイムレーン図・関連図・見本の 11 画面・
// kintone と標準の見た目の画面・PDF のページを撮る。見本の会社と人の名前は、アプリの見本（buildCrmSample）の架空のものだけ。
// 画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、ウィンドウと最初の画面とシステムの画面は、アプリの画面で撮る。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSampleApp(browser, { ROOT, HTML_NAME }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 860 });
  await page.evaluateOnNewDocument(() => {
    window.__test__ = {};
    localStorage.clear();
  });
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  return page;
}
// システムの画面設計と画面の id を名前で引く（[画面設計の名前, 画面の名前]）
const screenIds = (page, sysId, pairs) => page.evaluate((sid, list) => {
  const S = window.__test__.store.state;
  const y = S.systems.find((x) => x.id === sid);
  return list.map(([dn, sn]) => {
    const d = S.designs.find((x) => y.designIds.includes(x.id) && x.name === dn);
    return { id: d.id, screen: d.screens.find((s) => s.name === sn).id };
  });
}, sysId, pairs);

const SCREENS = [['顧客', '顧客の一覧'], ['顧客', '顧客の詳細'], ['商談', '商談のかんばん'], ['商談', '商談の詳細'], ['商談', 'ホーム'],
  ['問い合わせ', '問い合わせの詳細'], ['問い合わせ', '無償修理の承認申請'], ['作業指示', '作業指示の一覧'], ['作業指示', '作業報告'],
  ['ナレッジ', 'ホーム'], ['ナレッジ', 'AI のアシスタント']];

module.exports = async function shootSample(browser, env) {
  const { ROOT, shot, OUT, VERSION } = env;
  const page = await openSampleApp(browser, env);
  const save = (name) => path.join(OUT, `v${VERSION}_${name}.png`);
  // HTML を新しいタブで開いて撮る（fullPage）
  const shootHtml = async ({ html, width, height }, name) => {
    const p = await browser.newPage();
    await p.setViewport({ width: Math.ceil(width), height: Math.ceil(height) });
    await p.setContent(html, { waitUntil: 'load' });
    await p.screenshot({ path: save(name), fullPage: true });
    console.log('saved', path.relative(ROOT, save(name)));
    await p.close();
  };
  const shootScreen = async ({ id, screen }, name) => shootHtml(await page.evaluate((did, sid) => {
    const T = window.__test__;
    const d = T.store.state.designs.find((x) => x.id === did);
    const x = T.exportPngDocs(d, T.store.state, [sid], null, { table: false, callouts: false })[0];
    return { html: x.html, width: x.width, height: x.height };
  }, id, screen), name);
  const modalShot = async (name) => {
    await (await page.$('.modal')).screenshot({ path: save(name) });
    console.log('saved', path.relative(ROOT, save(name)));
  };

  // 257・258: 「＋ 新しいシステム」のウィンドウ（最初は白紙のシステム／CRM の見本を選んだとき）
  await page.click('.home-head [data-action="new-system"]');
  await page.waitForSelector('.modal [data-sys-kind]');
  await modalShot('257_sample_新しいシステムのウィンドウ_白紙のシステム');
  await page.click('.modal [data-sys-kind="crm"]');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await modalShot('258_sample_新しいシステムのウィンドウ_CRMの見本');
  // 259: 作った後の最初の画面（左の一覧で見本のシステムを選び、お知らせを出す）
  await page.click('[data-dlg="ok"]');
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await sleep(300);
  await shot(page, '259_sample_作った後の最初の画面');
  const sysId = await page.evaluate(() => window.__test__.ui.homeGroup);
  const ids = await screenIds(page, sysId, SCREENS);

  // 260: 関連図（5 つの画面設計のルックアップと関連レコード一覧のつながり）
  await page.setViewport({ width: 1760, height: 1000 });
  await page.click('[data-action="home-map"]');
  await sleep(300);
  await shot(page, '260_sample_関連図');
  await page.click('[data-action="home-cards"]');
  await page.setViewport({ width: 1400, height: 860 });
  // 261: システムの画面（スイムレーン図）。262: スイムレーン図の全体（出力と同じ HTML）
  await page.click('.sys-head [data-action="open-system"]');
  await sleep(400);
  await shot(page, '261_sample_システムの画面');
  await shootHtml(await page.evaluate((id) => {
    const T = window.__test__;
    const doc = T.swimlaneImageDoc(T.store.state, T.store.state.systems.find((s) => s.id === id));
    return { html: doc.html, width: doc.width, height: doc.height };
  }, sysId), '262_sample_スイムレーン図');
  await page.evaluate(() => window.__test__.goHome());

  // 263〜273: 見本の 11 画面（Salesforce の見た目）
  for (let i = 0; i < SCREENS.length; i++) await shootScreen(ids[i], `${263 + i}_sample_${SCREENS[i][0]}_${SCREENS[i][1].replace(/ /g, '')}`);

  // 274・275: kintone の見た目（構築先も kintone）と標準の見た目で作った見本の画面
  for (const [no, look, label, pick] of [[274, 'kintone', 'kintone', 5], [275, 'standard', '標準', 1]]) {
    const id = await page.evaluate((lk) => window.__test__.buildCrmSample({ name: `顧客管理システム（${lk}）`, target: lk === 'standard' ? 'claude' : lk, look: lk }), look);
    const [one] = await screenIds(page, id, [SCREENS[pick]]);
    await shootScreen(one, `${no}_sample_${SCREENS[pick][1]}_${label}`);
  }

  // 276: PDF のページ（問い合わせの画面設計。小さなウィンドウの画面のページ）
  const pdf = await page.evaluate((did) => {
    const T = window.__test__;
    const d = T.store.state.designs.find((x) => x.id === did);
    return T.exportDocument(d, T.store.state, { paper: 'A4', orient: 'landscape', cover: false, map: false, items: true, process: true, flow: false }).html;
  }, ids[5].id);
  const pp = await browser.newPage();
  await pp.setViewport({ width: 1123, height: 794 });
  await pp.setContent(pdf, { waitUntil: 'load' });
  const pages = await pp.$$('.pg');
  for (const [i, el] of pages.slice(0, 2).entries()) {
    await el.screenshot({ path: save(`${276 + i}_sample_PDFのページ_問い合わせ_${i + 1}`) });
    console.log('saved', path.relative(ROOT, save(`${276 + i}_sample_PDFのページ_問い合わせ_${i + 1}`)));
  }
  await pp.close();
  await page.close();
};
