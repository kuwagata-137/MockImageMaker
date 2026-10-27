// tools/check-export-doc.js — check-export.js の場面 6: システムの説明書（PDF。第 10 段階の後半。仕様_細かい決めごと.md の「説明書（PDF）の細かい決めごと」）
// check-export.js から呼ぶ（単体では動かさない）。見本に足す画面設計 2 つとシステム 1 つ（addDocSample）と、説明書の PDF を確かめる場面（checkSystemDoc）。PDF のページごとの文字を読む pdfPageTexts は、check-electron-through.js も使う。
//  1. 最初の画面から出張申請システムを開き、メニューバーの「出力」→ 説明書の窓 →「出力…」で 出張申請システム_説明書.pdf を書く（MIM_EXPORT_DIR）
//  2. 同じ設定でアプリの中で組んだページ（exportSystemDocument）を正しい答えにして、PDF を pdfjs-dist で読み、
//     ①ページ数が同じ（はみ出したページがない）②ページごとに見出し（表紙は小見出しと名前）がある ③下の端の「n / N」が 1〜N の通し ④表紙の「全 N ページ」
//     ⑤表紙の一覧の始まりのページの番号が、その画面設計の表紙のページ ⑥続きのページに分かれた表（画面の一覧・改訂履歴・項目の一覧表・設計ノート）の全部の行の文字がある
//     ⑦設計ノートの ⑤（docs）の行の文字（出力したファイルの場所）がない、を確かめる
// 見本は架空の業務（出張申請システム）だけ。社員マスタ（画面 24 個）で表紙の画面の一覧が、旅費規程（項目 40 個・版 20 個）で項目の一覧表と
// 表紙の改訂履歴（デバッグとリリースの見直し②-1）が、設計ノートの行 50 個で設計ノートが、それぞれ続きのページに分かれる。
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRadicals } = require('../material-text');

const OLD = '2026-10-01T00:00:00.000Z';
const NO_REF = { designId: null, screenId: null, stateId: null };
const step = (id, roleId, col, kind, text) => ({ id, roleId, col, kind, text, memo: '', ref: { ...NO_REF }, src: null });
const DOCS_PATH = 'C:\\Users\\someone\\Documents\\モックイメージメーカー\\AI の出力\\出張申請システム_システム設計書.pdf';
// 続きのページに分かれる表の、全部の行の文字（どの行も、ほかの行の文字の頭にならない名前にする。「〇〇 1 番」と「〇〇 10 番」）
const n = (count, f) => Array.from({ length: count }, (_, i) => f(i + 1));
const ROWS = { screens: n(24, (k) => `社員の画面 ${k} 番`), items: n(40, (k) => `規程の項目 ${k} 番`), decisions: n(40, (k) => `決めたこと ${k} の文`),
  questions: n(10, (k) => `まだ決まっていないこと ${k} の文`), revisions: n(20, (k) => `版の内容 ${k} 番`) };

// 見本（check-export.js の SAMPLE。画面設計の helper を受け取る）に、画面設計 2 つと出張申請システム（顧客管理・社員マスタ・旅費規程を入れる）を足す
function addDocSample(sample, { design, screen, item }) {
  const many = design('d5', '社員マスタ', 'kintone', { screens: ROWS.screens.map((nm, i) => screen(`m${i + 1}`, nm)) });
  const rule = design('d6', '旅費規程', 'kintone', {
    description: '社員の出張と、その旅費の精算をまとめて扱う。'.repeat(40),
    items: ROWS.items.map((nm, i) => item(`L${i + 1}`, nm, i % 3 ? 'text1' : 'text2', { memo: '役職ごとに金額が違う。'.repeat(i % 4) })),
    revisions: ROWS.revisions.map((t, i) => ({ id: `rv${i + 1}`, kind: 'revision', no: i + 1, date: '2026-10-20T01:00:00.000Z',
      note: `${t}。` + '日当の額を見直した。'.repeat(i % 3), changes: null, baseNo: null })),
  });
  const stages = ['read', 'flow', 'items', 'screens'];
  const decisions = ROWS.decisions.map((t, i) => ({ id: `nd${i + 1}`, date: '2026-10-20', stage: stages[Math.floor(i / 10)],
    text: `${t}。` + '承認は上長の 1 段にする。'.repeat(i % 3), reason: `理由 ${i + 1}` }));
  decisions.push({ id: 'nd-docs', date: '2026-10-20', stage: 'docs', text: 'システム設計書を出力した場所の行', reason: DOCS_PATH });
  const questions = ROWS.questions.map((t, i) => ({ id: `nq${i + 1}`, date: '2026-10-20', stage: stages[i % 4], text: t,
    answer: i % 3 === 0 ? `答え ${i + 1}` : '', resolvedAt: i % 3 === 0 ? '2026-10-20T01:00:00.000Z' : null }));
  const system = {
    id: 'y1', name: '出張申請システム', description: '出張の事前申請から、上長の承認、旅費の精算までをまとめる。', createdAt: OLD, updatedAt: OLD, trashedAt: null,
    designIds: ['d1', 'd5', 'd6'],
    roles: [{ id: 'l1', name: '申請者', memo: '出張する社員' }, { id: 'l2', name: '上長', memo: '申請者の所属の課長' }, { id: 'l3', name: '経理', memo: '' }],
    swimlane: {
      steps: [step('w1', 'l1', 0, 'start', '出張が決まる'), step('w2', 'l1', 1, 'input', '申請する'), step('w3', 'l2', 2, 'decision', '確かめる'),
        step('w4', 'l2', 3, 'task', '承認する'), step('w5', 'l3', 4, 'task', '精算する'), step('w6', 'l3', 5, 'doc', '精算書'), step('w7', 'l3', 6, 'end', '終わり')],
      edges: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w, i) => ({ id: `e${i + 1}`, from: w, to: `w${i + 2}`, label: '' })),
    },
    materials: [], notes: { decisions, questions }, revisions: [],
  };
  return { ...sample, designs: [...sample.designs, many, rule], systems: [system] };
}

// PDF のページごとの文字（空白を除く）。pdfjs-dist で、字体と cMap はパッケージの中のフォルダ（material-pdf.js と同じ読み方）。
// Chrome の PDF から取り出すと「面」「一」などが康熙部首の字（⾯・⼀）になるので、通常の漢字に直してから比べる
async function pdfPageTexts(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const url = (name) => `${path.join(dir, name).split(path.sep).join('/')}/`;
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    cMapUrl: url('cmaps'), cMapPacked: true, standardFontDataUrl: url('standard_fonts'), verbosity: 0 });
  const pdf = await task.promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    texts.push(normalizeRadicals(c.items.map((x) => x.str || '').join('')).replace(/\s+/g, ''));
  }
  await task.destroy();
  return texts;
}

// アプリの中で、窓と同じ設定で説明書のページを組み、ページごとの { head（見出しか、表紙の小見出し＋名前）, no（下の端の文字）, cover } と、表紙の一覧の番号の食い違いを返す
function appPages(opts) {
  const T = window.__test__;
  const y = T.store.state.systems.find((x) => x.id === 'y1');
  const doc = T.exportSystemDocument(y, T.store.state, opts);
  const parse = (h) => new DOMParser().parseFromString(h, 'text/html');
  const pages = doc.pages.map((h) => {
    const p = parse(h);
    const k = p.querySelector('.cv-kicker');
    const head = k ? k.textContent + p.querySelector('.cv-title').textContent : p.querySelector('.pg-head h2').textContent;
    const no = (p.querySelector('.pg-foot span:last-child') || p.querySelector('.cv-foot span:last-child')).textContent;
    return { head, no, cover: !!k, title: k ? p.querySelector('.cv-title').textContent : '' };
  });
  const firstOf = Object.fromEntries(pages.map((x, i) => [x.cover ? x.title : '', i + 1]).filter(([n]) => n));
  const wrong = [];
  doc.pages.forEach((h) => parse(h).querySelectorAll('.cv-table tbody tr:not(.lead)').forEach((tr) => {
    const nm = tr.querySelector('.nm');
    const no = tr.querySelector('.no');
    if (!nm || !no || !nm.childNodes[0]) return;
    const n = nm.childNodes[0].textContent;
    if (firstOf[n] && String(firstOf[n]) !== no.textContent) wrong.push(`${n}: ${no.textContent}（${firstOf[n]} のはず）`);
  }));
  return { total: doc.total, pages, wrong };
}

// 場面 6。env: { page, OUT, check, waitFile, enableTestHooks }
async function checkSystemDoc({ page, OUT, check, waitFile, enableTestHooks }) {
  await enableTestHooks(page);
  await page.evaluate(() => window.__test__.openSystem('y1'));
  await page.waitForSelector('#toolbar [data-action="export"]');
  const file = path.join(OUT, '出張申請システム_システム設計書.pdf');
  if (fs.existsSync(file)) fs.unlinkSync(file); // fs.rmSync は日本語の名前で Node ごと落ちる（2026-10-14）
  await page.click('#toolbar [data-action="export"]');
  await page.waitForSelector('#sys-menu-root [data-action="sys-export-doc"]'); // 第 11 段階から、「出力」は小さなメニューを開く
  await page.click('#sys-menu-root [data-action="sys-export-doc"]');
  await page.waitForSelector('.modal [data-dpage]');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.modal [data-dpage]')].map((x) => `${x.dataset.dpage}:${x.checked ? '入れる' : '外す'}`));
  check('6. 説明書の窓が開き、最初は 8 つのページを全部入れる', shown.length === 8 && shown.every((s) => s.endsWith('入れる')), shown.join('・'));
  const opts = await page.evaluate(() => ({ ...window.__test__.docOpts }));
  await page.click('.modal [data-dlg="ok"]');
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await waitFile(file, '説明書の PDF', 120000);
  const app = await page.evaluate(appPages, opts);
  const texts = await pdfPageTexts(file);
  const N = app.total;
  check('6. 説明書の PDF のページ数が、アプリの数え方と同じ（はみ出したページがない）', texts.length === N, `PDF ${texts.length} ページ・アプリ ${N} ページ`);
  const bad = [];
  app.pages.forEach((x, i) => {
    const t = texts[i] || '';
    if (!t.includes(x.head.replace(/\s+/g, ''))) bad.push(`${i + 1} ページ目に「${x.head}」がない`);
    const want = x.cover ? `全${N}ページ` : `${i + 1}/${N}`;
    if (x.no.replace(/\s+/g, '') !== want) bad.push(`${i + 1} ページ目の番号「${x.no}」（${want} のはず）`);
    if (!t.includes(want)) bad.push(`${i + 1} ページ目の PDF に「${want}」がない`);
  });
  check('6. 説明書のページの見出しの順と、下の端の「n / N」・表紙の「全 N ページ」', !bad.length, bad.slice(0, 5).join('／') || app.pages.map((x) => x.head).filter((h, i, a) => a.indexOf(h) === i).slice(0, 12).join(' → '));
  check('6. 表紙の一覧の始まりのページの番号が、その画面設計の表紙のページ', !app.wrong.length, app.wrong.join('／') || '社員マスタ・旅費規程・顧客管理');
  const heads = app.pages.map((x) => x.head);
  const split = ['画面の一覧（続き）', '改訂履歴（続き）', '項目一覧（続き）', '設計ノート（続き）'].filter((h) => !heads.includes(h));
  check('6. 表紙の画面の一覧・改訂履歴・項目一覧・設計ノートが、続きのページに分かれる', !split.length, split.length ? `分かれていない: ${split.join('・')}` : '4 つとも分かれた');
  const all = texts.join('');
  const lost = Object.values(ROWS).flat().filter((w) => !all.includes(w.replace(/\s+/g, '')));
  check('6. 分かれた表の全部の行の文字が PDF にある（ページの下の端で切れて消えていない）', !lost.length, lost.length ? `見つからない: ${lost.slice(0, 8).join('・')}`
    : `画面 ${ROWS.screens.length}・版 ${ROWS.revisions.length}・項目 ${ROWS.items.length}・決めたこと ${ROWS.decisions.length}・まだ決まっていないこと ${ROWS.questions.length} の行`);
  const leak = ['someone', 'システム設計書を出力した場所の行'].filter((w) => all.includes(w));
  check('6. 設計ノートの ⑤（docs）の行（出力したファイルの場所）は PDF に入らない', !leak.length, leak.length ? `入っている: ${leak.join('・')}` : '入っていない');
}

module.exports = { addDocSample, checkSystemDoc, pdfPageTexts };
