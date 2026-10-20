// tools/check-electron.js の場面 12（設計ノートの打ちかけの文字。第 10 段階の前半）。本物の Electron のアプリを窓を出さずに起動し、
// システムの画面の「設計ノート」の文字の欄（data-sy 6 つ）に文字を打ち、欄を離れない（change が起きていない）まま閉じても、その文字が designs.json に残り、
// 起動し直すと欄に出ることを確かめる。jsdom のテストでは、アプリを閉じる前の確定（flushSideField）を確かめていないため。
//  欄 6 つ: 読み取ったこと（① の札）・メモ・まだ決まっていないことの文・その答え・決めたことの文・その理由（行の欄は、行の id を data-note に持つ）
//  閉じ方 2 つ（メインプロセスを --inspect で起動し、Node の inspector から呼んで再現する。3 と同じ作り）: 窓の ×（BrowserWindow.close()）・ファイル > 終了（app.quit()）
//  → 6 つの欄 × 2 つの閉じ方 = 12 回、起動して閉じる。答えの欄は、打って閉じると「決まった」（resolvedAt）になることも確かめる。
//  最後にもう一度起動し直し、12 回に打った文字が、6 つの欄に全部出る。
// 見本は架空の出張申請システム 1 つ（① の札に、読み取ったこと・まだ決まっていないこと 2 つ・決めたこと 2 つ・メモ）。保存先は .devdata/check-userData-notes（毎回消してから始める）。
// node tools/check-electron.js --only=notes で、この 12 だけを動かす。途中で止まったときは、起動した Electron を残さず終わらせる（check-electron-materials-app.js の killLeftovers）。
'use strict';

const fs = require('fs');
const path = require('path');
const { removeTree } = require('./material-sample-place');
const { open, closeApp, killLeftovers, saved } = require('./check-electron-materials-app');

const SYSTEM_NAME = '出張申請システム（設計ノートの確かめ）';
const SEED = {
  findings: '業務: 社員が出張の前に申請し、上長が承認する。出張から戻ったら 7 日以内に旅費を精算する。\n登場人物（役割）: 申請者・上長・経理',
  memo: 'ベンダーとの打ち合わせは 10/25。',
  questions: ['海外出張も、このシステムで申請するか', '宿泊費の上限を、役職で変えるか'],
  decisions: [['役割は、申請者・上長・経理の 3 つにする', '旅費規程の第 5 条から'], ['承認は上長の 1 段にする', '現場の手間を減らすため']],
};

const rowOf = (rows, id) => rows.find((r) => r.id === id);
// 欄 6 つ。of は行の種類（q: まだ決まっていないこと・d: 決めたこと。なければ全体の欄）。read は designs.json の設計ノート n から、その欄の文を読む
const SPECS = [
  { name: '読み取ったこと', sy: 'note-findings', of: null, read: (n) => n.findings },
  { name: 'メモ', sy: 'note-memo', of: null, read: (n) => n.memo },
  { name: 'まだ決まっていないことの文', sy: 'note-q-text', of: 'q', read: (n, id) => rowOf(n.questions, id).text },
  { name: 'まだ決まっていないことの答え', sy: 'note-q-answer', of: 'q', read: (n, id) => rowOf(n.questions, id).answer },
  { name: '決めたことの文', sy: 'note-d-text', of: 'd', read: (n, id) => rowOf(n.decisions, id).text },
  { name: '決めたことの理由', sy: 'note-d-reason', of: 'd', read: (n, id) => rowOf(n.decisions, id).reason },
];
const HOWS = [['x', '窓の ×'], ['quit', 'ファイル > 終了']]; // 行の欄は、窓の × では 1 行目、ファイル > 終了では 2 行目に打つ

const report = (ok, label, detail = '') => { console.log(`${ok ? 'OK' : 'NG'} 設計ノート: ${label}${detail ? ` … ${detail}` : ''}`); return ok; };
const tail = (s) => { const t = s.replace(/\s+/g, ' '); return t.length > 26 ? `…${t.slice(-26)}` : t; }; // 改行は空白 1 つにして、後ろの 26 字だけ出す

// ページの中で動かす: 見本のシステムと設計ノートを actions で作る。戻り値は { id, q: [行の id 2 つ], d: [行の id 2 つ] }
function buildNotes(seed, name) {
  const { actions: a } = window.__test__;
  const id = a.createSystem({ name });
  a.setNoteFindings(id, seed.findings);
  a.setNoteMemo(id, seed.memo);
  const q = seed.questions.map((text) => a.addNoteQuestion(id, { stage: 'read', text }));
  const d = seed.decisions.map(([text, reason]) => a.addNoteDecision(id, { stage: 'read', text, reason }));
  return { id, q, d };
}

const rowFor = (c, ids, how) => (c.of ? ids[c.of][how === 'x' ? 0 : 1] : null);
// 12 回の打つ文字（欄・閉じ方ごとに別の文字。designs.json に残った文字を見分けるため）
const casesFor = (ids) => HOWS.flatMap(([how, howName]) => SPECS.map((spec) => ({
  how, spec, row: rowFor(spec, ids, how), label: `${howName}・${spec.name}`, text: `（${howName}で打った${spec.name}）`,
})));

const STATE_FILE = (h) => path.join(h.USER_DATA_NOTES, 'data', 'designs.json');
const savedNotes = (h, id) => JSON.parse(fs.readFileSync(STATE_FILE(h), 'utf8')).systems.find((y) => y.id === id).notes;

// 1 回目: 見本を作り、保存の終わりを待って閉じる
async function buildRun(h) {
  const app = await open(h, h.USER_DATA_NOTES);
  const ids = await app.page.evaluate(buildNotes, SEED, SYSTEM_NAME);
  await saved(app.page);
  const code = await closeApp(h, app);
  const n = savedNotes(h, ids.id);
  const ok = report(code === 0 && n.findings === SEED.findings && n.memo === SEED.memo && n.questions.length === 2 && n.decisions.length === 2 && n.questions.every((q) => !q.resolvedAt),
    '見本（読み取ったこと・メモ・まだ決まっていないこと 2 つ・決めたこと 2 つ）が designs.json に残る', `終了コード ${code}・まだ決まっていないこと ${n.questions.length}・決めたこと ${n.decisions.length}`);
  return { ids, ok };
}

// システムの設計ノートの ① の札を開き、欄の終わりに文字を打って、欄を離れないまま閉じる
async function typeThenClose(h, c, ids) {
  const app = await open(h, h.USER_DATA_NOTES, {}, [`--inspect=${h.MAIN_PORT}`]);
  const { page } = app;
  await page.evaluate((id) => window.__test__.openSystem(id, { panel: 'notes' }), ids.id);
  await page.waitForSelector('#sys-view .nt-tab[data-stage="read"]');
  await page.click('#sys-view .nt-tab[data-stage="read"]');
  const sel = `#sys-view [data-sy="${c.spec.sy}"]${c.row ? `[data-note="${c.row}"]` : ''}`;
  await page.waitForSelector(sel);
  await page.focus(sel);
  await page.$eval(sel, (el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(c.text);
  await h.sleep(500);
  const before = c.spec.read(savedNotes(h, ids.id), c.row);
  const focused = await page.$eval(sel, (el) => document.activeElement === el);
  const code = await closeApp(h, app, c.how);
  const n = savedNotes(h, ids.id);
  return { before, after: c.spec.read(n, c.row), focused, code, resolved: c.spec.sy === 'note-q-answer' ? !!rowOf(n.questions, c.row).resolvedAt : null };
}

// 12 回: 打つ → 閉じる → designs.json に残ったかを見る。戻り値は { ok, want }（want は、欄ごとの、見本の文＋打った文字の全部）
async function typingRuns(h, ids) {
  const base = savedNotes(h, ids.id);
  const want = new Map();
  let ok = true;
  for (const c of casesFor(ids)) {
    const key = `${c.spec.sy}|${c.row || ''}`;
    if (!want.has(key)) want.set(key, c.spec.read(base, c.row));
    const r = await typeThenClose(h, c, ids);
    const kept = r.focused && !r.before.includes(c.text) && r.after === `${want.get(key)}${c.text}` && r.code === 0 && r.resolved !== false;
    want.set(key, `${want.get(key)}${c.text}`);
    ok = report(kept, `${c.label}: 打ちかけのまま閉じても保存される${r.resolved ? '（答えを書いた行は「決まった」になる）' : ''}`,
      `閉じる直前も欄にいたか ${r.focused} ／ 閉じる前の designs.json「${tail(r.before)}」→ 閉じたあと「${tail(r.after)}」 ／ 終了コード ${r.code}`) && ok;
  }
  return { ok, want };
}

// 起動し直して、① の札の 6 つの欄に、見本の文と 12 回に打った文字が全部出るか（行の答えを書いたので、2 つの行は「決まった」の灰色の行になる）
async function reloadRun(h, ids, want) {
  const app = await open(h, h.USER_DATA_NOTES);
  const { page } = app;
  await page.evaluate((id) => window.__test__.openSystem(id, { panel: 'notes' }), ids.id);
  await page.waitForSelector('#sys-view .nt-tab[data-stage="read"]');
  await page.click('#sys-view .nt-tab[data-stage="read"]');
  const shown = await page.evaluate((specs) => specs.map((s) => [...document.querySelectorAll(`#sys-view [data-sy="${s.sy}"]`)].map((el) => [el.dataset.note || '', el.value])), SPECS.map((s) => ({ sy: s.sy })));
  const resolved = await page.$$eval('#sys-view .nt-qs tbody tr.resolved', (trs) => trs.length);
  const code = await closeApp(h, app);
  const lines = [];
  let ok = code === 0;
  SPECS.forEach((spec, i) => {
    const byRow = new Map(shown[i]);
    const targets = spec.of ? ids[spec.of] : [''];
    const missing = targets.filter((row) => byRow.get(row) !== want.get(`${spec.sy}|${row}`));
    ok = ok && missing.length === 0 && byRow.size === targets.length;
    lines.push(`${spec.name} ${targets.length - missing.length}/${targets.length}`);
  });
  return report(ok && resolved === 2, '起動し直すと、12 回に打った文字が、① の札の 6 つの欄にそのまま出て、答えを書いた 2 つの行は「決まった」の行になる', `${lines.join('・')} ／ 決まった行 ${resolved} ／ 終了コード ${code}`);
}

// h は check-electron.js の道具 { launch, connect, appPage, enableTestHooks, withTimeout, sleep, PORT, MAIN_PORT, evalInMain, MAIN_CLOSE, USER_DATA_NOTES }
module.exports = async function checkNotes(h) {
  removeTree(h.USER_DATA_NOTES);
  try {
    const built = await buildRun(h);
    const typing = await typingRuns(h, built.ids);
    const again = await reloadRun(h, built.ids, typing.want);
    return built.ok && typing.ok && again;
  } finally {
    await killLeftovers();
  }
};
