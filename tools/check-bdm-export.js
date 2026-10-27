// 使い方: node tools/check-bdm-export.js
// スイムレーン図を MPD に出力した HTML（bdm-export.js の exportBdmHtml。第 11 段階）を headless の Chrome で開き、MultipurposeDiagramMaker 自体が読めるかを確かめる。
// 元にする MPD は、参考/diagram_v8.31.html に test/fixtures/materials/bdm-trip-state.json の状態を入れたもの（make-material-samples.js の出張申請の流れ.html と同じ作り）。
//  1. 取り込んだ図をそのまま出力する（作業の箱はどれも元の箱を使い回す。縦の図）
//  2. アプリで役割と作業を足した図（新しい箱は MultipurposeDiagramMaker の整列と同じ寸法で置く。判断の分かれ・書類・終わり・列の空き）
//  3. 横の図（元の図が横で、中身が空）に、新しい箱だけで出力する
//  4. 保存していない本体だけの HTML（図の中身の印がない。向きは縦の既定）に出力する
// どの場面も: 出力の注意（読み直しの食い違い）がない ／ ページの失敗（pageerror・console.error・窓）がない ／ init() が読んだ S の向き・レーン・箱・矢印の id が、
//   出力した状態と同じで、docId は null・id の番号は uid 以下 ／ MultipurposeDiagramMaker の保存（buildSaveHtml）で保存し直した HTML を planFromHtml で読むと、
//   出力した HTML を読んだ案と同じ ／ 全体を表示して撮った画像を screenshots/ に残す
// 窓は出さない（headless）。Chrome の場所は環境変数 MIM_CHROME_PATH で変えられる（shoot-app.js と同じ）。出力した HTML は .devdata/check-bdm-export に置く
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');
const { extractBdmState } = require('../bdm-state');
const { injectBdmState } = require('../bdm-inject');
const { planFromHtml } = require('../bdm-swimlane');
const { exportBdmHtml } = require('../bdm-export');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.devdata', 'check-bdm-export');
const SHOTS = path.join(ROOT, 'screenshots');
const BDM_APP = fs.readFileSync(path.join(ROOT, '参考', 'diagram_v8.31.html'), 'utf8');
const TRIP = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'materials', 'bdm-trip-state.json'), 'utf8'));
const BLANK = { diagramType: 'swimlane', lanes: [], nodes: [], edges: [], uid: 0, diagramName: '', appVer: '8.31' };

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'} ${label}${detail ? ` … ${detail}` : ''}`);
  if (!ok) failed++;
}

// 読み取りの案を、アプリに取り込んだときと同じ渡す形にする（作業の key は 'w-' ＋ 箱の id。元の箱の id を box に入れる。test/bdm-export.test.js の payloadOf と同じ）
function payloadOf(plan) {
  return {
    name: '出張申請システム', lanes: plan.roles.slice(),
    steps: plan.steps.map((s) => ({ key: `w-${s.key}`, lane: plan.roles.indexOf(s.role), col: s.col, kind: s.kind, text: s.text, box: s.key })),
    edges: plan.edges.map((e) => ({ from: `w-${e.from}`, to: `w-${e.to}`, label: e.label })),
  };
}
const step = (key, lane, col, kind, text) => ({ key, lane, col, kind, text, box: null });
const edge = (from, to, label = '') => ({ from, to, label });

// 場面 2: 取り込んだ図に、役割「総務」と作業 4 つ（列を 1 つ空ける）を足す。元の図の作業（種類が作業）から、足した作業へつなぐ
function grownPayload(base) {
  const p = JSON.parse(JSON.stringify(base));
  const last = Math.max(...p.steps.map((s) => s.col));
  const from = p.steps.find((s) => s.kind === 'task');
  p.lanes.push('総務');
  const lane = p.lanes.length - 1;
  p.steps.push(step('w-n1', lane, last + 1, 'task', '出張の記録を残す'), step('w-n2', lane, last + 3, 'decision', '記録に漏れがあるか'),
    step('w-n3', 0, last + 4, 'doc', '記録の控え'), step('w-n4', lane, last + 5, 'end', '終わり'));
  p.edges.push(edge(from.key, 'w-n1'), edge('w-n1', 'w-n2'), edge('w-n2', 'w-n3', 'ある'), edge('w-n2', 'w-n4', 'ない'));
  return p;
}
// 場面 3・4: 新しい箱だけの図（差し戻しの矢印あり）
const FRESH = {
  name: '経費精算システム', lanes: ['申請者', '上長', '経理'],
  steps: [step('a', 0, 0, 'start', '経費を使う'), step('b', 0, 1, 'input', '経費を入力する'), step('c', 1, 2, 'decision', '内容を確かめる'),
    step('d', 2, 3, 'task', '精算する'), step('e', 2, 4, 'end', '終わり')],
  edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd', '承認'), edge('c', 'b', '差し戻し'), edge('d', 'e')],
};

const withState = (st) => injectBdmState(BDM_APP, st);
const CASES = [
  { no: 1, label: '取り込んだ図をそのまま', src: withState(TRIP), payload: () => payloadOf(planFromHtml(withState(TRIP))) },
  { no: 2, label: '役割と作業を追加した図', src: withState(TRIP), payload: () => grownPayload(payloadOf(planFromHtml(withState(TRIP)))) },
  { no: 3, label: '横の図に新しい箱だけ', src: withState({ ...BLANK, orientation: 'horizontal' }), payload: () => FRESH },
  { no: 4, label: '本体だけの HTML', src: BDM_APP, payload: () => FRESH },
];

// 出力した HTML を MultipurposeDiagramMaker で開き、読んだ S・ページの失敗・保存し直した HTML を返す。全体を表示して撮る
async function openInMpd(browser, file, shot) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`窓: ${d.message()}`); d.dismiss().catch(() => {}); });
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 400));
    const got = await page.evaluate(() => ({
      orientation: S.orientation, diagramType: S.diagramType, uid: S.uid, docId: S.docId,
      lanes: S.lanes.map((l) => l.id), nodes: S.nodes.map((n) => n.id), edges: S.edges.map((e) => e.id),
    }));
    // 開いた直後に MultipurposeDiagramMaker が出す「上書き先を決めますか？」の窓（askBindSaveTarget）は「あとで決める」で閉じてから、全体を表示して撮る
    await page.evaluate(() => {
      const later = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'あとで決める');
      if (later) later.click();
      if (typeof fitView === 'function') fitView();
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: shot });
    const resaved = await page.evaluate(() => buildSaveHtml(S_diagramName).html);
    return { errors, got, resaved };
  } finally {
    await page.close();
  }
}

// 読み取りの案の比べる所（役割の並び・作業の key と役割と列と種類と文字・矢印）
const flowOf = (plan) => JSON.stringify({
  roles: plan.roles,
  steps: plan.steps.map((s) => [s.key, s.role, s.col, s.kind, s.text]).sort(),
  edges: plan.edges.map((e) => [e.from, e.to, e.label]).sort(),
});
const idNumbersOk = (st) => [...st.lanes, ...st.nodes, ...st.edges].every((x) => !/^e\d+$/.test(x.id) || Number(x.id.slice(1)) <= st.uid);
const sameIds = (a, b) => a.join() === b.map((x) => x.id).join();

async function checkCase(browser, c) {
  const payload = c.payload();
  const out = exportBdmHtml(c.src, payload);
  const file = path.join(OUT, `${c.no}_${c.label}.html`);
  fs.writeFileSync(file, out.html, 'utf8');
  const st = extractBdmState(out.html);
  const ids = [...st.lanes, ...st.nodes, ...st.edges].map((x) => x.id);
  check(`${c.no}. ${c.label}: 出力の注意がなく、id は重ならず uid 以下・docId は null`, !out.warnings.length && new Set(ids).size === ids.length && idNumbersOk(st) && st.docId === null,
    `レーン ${st.lanes.length}・箱 ${st.nodes.length}・矢印 ${st.edges.length}・uid ${st.uid}・向き ${st.orientation}${out.warnings.length ? ` ／ 注意 ${out.warnings.join(' ')}` : ''}`);
  const shot = path.join(SHOTS, `stage11_mpd_${c.no}_${c.label}.png`);
  const r = await openInMpd(browser, file, shot);
  check(`${c.no}. ${c.label}: MultipurposeDiagramMaker で開いても、ページの失敗がない`, !r.errors.length, r.errors.join(' ／ ') || '失敗なし');
  check(`${c.no}. ${c.label}: init() が読んだ向き・レーン・箱・矢印の id が、出力した状態と同じ（docId は null）`,
    r.got.diagramType === 'swimlane' && r.got.orientation === (st.orientation || 'vertical') && r.got.uid === st.uid && r.got.docId === null
      && sameIds(r.got.lanes, st.lanes) && sameIds(r.got.nodes, st.nodes) && sameIds(r.got.edges, st.edges),
    `向き ${r.got.orientation} ／ レーン ${r.got.lanes.length}・箱 ${r.got.nodes.length}・矢印 ${r.got.edges.length} ／ uid ${r.got.uid}`);
  check(`${c.no}. ${c.label}: MultipurposeDiagramMaker で保存し直しても、読み取りの案が同じ`, flowOf(planFromHtml(r.resaved)) === flowOf(planFromHtml(out.html)), path.relative(ROOT, shot));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.MIM_CHROME_PATH ? { executablePath: process.env.MIM_CHROME_PATH } : { channel: 'chrome' }),
    userDataDir: path.join(ROOT, '.devdata', 'chrome-profile-bdm-export'),
    args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  try {
    for (const c of CASES) await checkCase(browser, c);
  } catch (err) {
    check('途中で止まった', false, err.stack || String(err));
  } finally {
    await browser.close();
  }
  console.log(failed ? `NG ${failed} 件` : 'OK');
  process.exitCode = failed ? 1 : 0;
})();
