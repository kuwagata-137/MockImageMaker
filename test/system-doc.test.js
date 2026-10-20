'use strict';
// システムの説明書（PDF）のページの組み方のテスト（第 10 段階の後半。q76・q77・q80・q81。仕様_細かい決めごと.md の「説明書（PDF）の細かい決めごと」）。
// システムの表紙 → スイムレーン図 → 画面設計ごとのページ（画面設計を 1 つ出力したときと同じ）→ 設計ノート。ページの番号は説明書の全体の通し番号。
// jsdom では要素の大きさを測れないので、表紙・表を続きのページに分ける所は tools/check-export.js（Electron）で確かめる。
// 見本は架空の業務（出張申請システム・経費精算システム）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const AT = '2026-10-20T00:00:00.000Z';
const ALL = { paper: 'A4', orient: 'landscape', systemCover: true, swimlane: true, notes: true, cover: true, map: true, items: true, process: true, flow: true };
const PER = { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true };
const DOCS_PATH = 'D:\\共有\\モックイメージメーカー\\AI の出力\\出張申請システム_説明書.pdf';

// 出張申請（一覧・新規申請・詳細。ステータスと操作・移る先）と経費精算（出張申請をルックアップ）を AI の道具で作り、
// 出張申請システム（役割 3 つ・作業 7 つ・設計ノートの行）と、経費精算だけが入った経費精算システム、出張申請が入ったごみ箱のシステムを作る
async function buildDesigns(api) {
  const call = async (tool, args) => {
    const r = await api.aiDispatch(tool, args, { session: 'test', client: 'claude-code' });
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  await call('create_design', { name: '出張申請', target: 'kintone', description: '社員が出張の前に申請し、上長が承認する。' });
  await call('edit_items', { design: '出張申請', ops: [
    { op: 'add', name: '申請番号', type: 'text1' }, { op: 'add', name: '申請者', type: 'user' }, { op: 'add', name: '行き先', type: 'text1' },
    { op: 'add', name: '概算の金額', type: 'number', props: { unit: '円' } },
  ] });
  await call('edit_process', { design: '出張申請', ops: [
    { op: 'set_states', states: ['申請', '承認待ち', '完了'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' },
    { op: 'add_action', name: '承認する', from: '承認待ち', to: '完了', role: '上長' },
  ] });
  await call('edit_screen', { design: '出張申請', ops: [{ op: 'update', screen: '画面 1', name: '一覧' }] });
  await call('add_screen', { design: '出張申請', name: '詳細' });
  await call('create_design', { name: '経費精算', target: 'kintone', description: '出張の旅費を精算する。' });
  await call('edit_items', { design: '経費精算', ops: [{ op: 'add', name: '出張申請の番号', type: 'text1' }] });
  await call('edit_items', { design: '経費精算', ops: [{ op: 'lookup', item: '出張申請の番号', lookup: { design: '出張申請', key: '申請番号', copies: [{ from: '行き先', to: '行き先', create: true }] } }] });
  await call('edit_screen', { design: '経費精算', ops: [{ op: 'update', screen: '画面 1', name: '精算の入力' }] });
  await call('layout_screen', { design: '出張申請', screen: '一覧', layout: { columns: 1, rows: [{ align: 'right', parts: [{ type: 'button', label: '詳細を見る', style: 'primary', to: '詳細' }] }] } });
  await call('layout_screen', { design: '出張申請', screen: '詳細', layout: { columns: 2, rows: [
    [{ type: 'status' }], [{ item: '申請者' }, { item: '行き先' }],
    [{ type: 'link', label: '精算する', to: { design: '経費精算', screen: '精算の入力' } }],
  ] } });
  await call('layout_screen', { design: '経費精算', screen: '精算の入力', layout: { columns: 1, rows: [[{ item: '出張申請の番号' }], [{ type: 'button', label: '出張申請へ戻る', style: 'normal', to: { design: '出張申請', screen: '一覧' } }]] } });
}
function buildSystems(api, { steps = true, notes = true } = {}) {
  const a = api.actions;
  const design = (n) => api.store.state.designs.find((d) => d.name === n);
  const sys = a.createSystem({ name: '出張申請システム', description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。' });
  const role = {};
  const memo = { 申請者: '出張する社員', 上長: '申請者の所属の課長', 経理: '経理課の担当' };
  for (const n of ['申請者', '上長', '経理']) { role[n] = a.addRole(sys, n); a.setRoleMemo(sys, role[n], memo[n]); }
  if (steps) {
    const st = (r, kind, text) => a.addStep(sys, { roleId: role[r], kind, text });
    const s = [st('申請者', 'start', '出張が決まる'), st('申請者', 'input', '出張申請を入力する'), st('上長', 'decision', '申請を確かめる'),
      st('上長', 'task', '承認する'), st('経理', 'task', '旅費を精算する'), st('経理', 'doc', '精算書を出す'), st('経理', 'end', '終わり')];
    for (let i = 0; i + 1 < s.length; i++) a.addEdge(sys, s[i], s[i + 1], '');
  }
  a.addDesignToSystem(sys, design('出張申請').id);
  a.addDesignToSystem(sys, design('経費精算').id);
  const other = a.createSystem({ name: '経費精算システム', description: '' });
  a.addDesignToSystem(other, design('経費精算').id);
  const old = a.createSystem({ name: '古い申請システム', description: '' });
  a.addDesignToSystem(old, design('出張申請').id);
  a.trashSystem(old);
  if (notes) {
    a.addNoteDecision(sys, { stage: 'items', text: '経費精算は、出張申請と別の画面設計にする', reason: '精算は経理が確かめるため' });
    a.addNoteDecision(sys, { stage: 'read', text: '役割は、申請者・上長・経理の 3 つにする', reason: '旅費規程の第 5 条から' });
    a.addNoteDecision(sys, { stage: 'flow', text: '承認は上長の 1 段にする', reason: '現場の手間を減らすため' });
    a.addNoteDecision(sys, { stage: 'docs', text: '説明書を出力した', reason: DOCS_PATH });
    a.addNoteDecision(sys, { stage: 'flow' }); // 空の行（PDF に入れない）
    a.addNoteQuestion(sys, { stage: 'items', text: '宿泊費の上限を、役職で変えるか' });
    const q = a.addNoteQuestion(sys, { stage: 'read', text: '海外出張も、このシステムで申請するか' });
    a.answerNoteQuestion(sys, q, '国内だけにする');
    a.addNoteQuestion(sys, { stage: 'flow', text: '部長の承認は要るか' });
    a.addNoteQuestion(sys, { stage: 'docs', text: '説明書は A3 で出すか' });
  }
  return sys;
}
async function boot(t, opts) {
  const app = bootApp();
  t.after(() => app.close());
  const api = await app.api();
  await buildDesigns(api);
  const sysId = buildSystems(api, opts);
  const y = () => api.store.state.systems.find((x) => x.id === sysId);
  const d = (n) => api.store.state.designs.find((x) => x.name === n);
  const parse = (html) => new app.window.DOMParser().parseFromString(html, 'text/html');
  const doc = (o = ALL) => api.exportSystemDocument(y(), api.store.state, o, AT);
  return { app, api, sysId, y, d, parse, doc };
}
// ページの名前（表紙は小見出し、ほかは見出し）と、下の端の番号の文字
const pageName = (parse, html) => {
  const p = parse(html);
  const k = p.querySelector('.pg-cover .cv-kicker');
  return k ? `表紙:${k.textContent}:${p.querySelector('.cv-title').textContent}` : p.querySelector('.pg-head h2').textContent;
};
const pageNo = (parse, html) => {
  const p = parse(html);
  const f = p.querySelector('.pg-foot span:last-child');
  return f ? f.textContent : p.querySelector('.cv-foot span:last-child').textContent;
};

test('説明書のページの並び: システムの表紙 → スイムレーン図 → 出張申請のページ → 経費精算のページ → 設計ノート。番号は全体の通し番号', async (t) => {
  const { parse, doc, d, api } = await boot(t);
  const x = doc();
  const N = x.pages.length;
  assert.equal(x.total, N);
  const names = [...x.pages].map((h) => pageName(parse, h));
  const one = (n) => api.exportDocument(d(n), api.store.state, PER, AT).pages.length;
  const [a, b] = [one('出張申請'), one('経費精算')];
  assert.equal(N, 2 + a + b + 1);
  assert.equal(names[0], '表紙:システムの説明書:出張申請システム');
  assert.equal(names[1], 'スイムレーン図');
  assert.equal(names[2], '表紙:画面設計書:出張申請');
  assert.equal(names[2 + a], '表紙:画面設計書:経費精算');
  assert.equal(names[N - 1], '設計ノート');
  // 表紙のほかのページは「n / N」、表紙（システム・画面設計）は「全 N ページ」
  [...x.pages].forEach((h, i) => {
    const no = pageNo(parse, h);
    if (/^表紙/.test(names[i])) assert.equal(no, `全 ${N} ページ`, names[i]);
    else assert.equal(no, `${i + 1} / ${N}`, names[i]);
  });
  // 戻り値の designs の始まりのページと、表紙の画面設計の一覧のページの番号
  assert.deepEqual(JSON.parse(JSON.stringify(x.designs.map((r) => [r.name, r.firstPage, r.pages]))), [['出張申請', 3, a], ['経費精算', 3 + a, b]]);
  const rows = [...parse(x.pages[0]).querySelectorAll('.cv-list tbody tr')].map((tr) => [tr.querySelector('.nm').childNodes[0].textContent, tr.querySelector('.no').textContent]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['スイムレーン図', '2'], ['出張申請', '3'], ['経費精算', String(3 + a)], ['設計ノート', String(N)]]);
  assert.deepEqual(JSON.parse(JSON.stringify(x.included)), { systemCover: true, swimlane: true, notes: true });
});

test('説明書の中の画面設計のページは、その画面設計を 1 つ出力したときのページと、番号と矢印の印の id の頭のほかは同じ', async (t) => {
  const { doc, d, api } = await boot(t);
  const x = doc();
  const norm = (h) => h.replace(/\d+ \/ \d+/g, 'n / N').replace(/全 \d+ ページ/g, '全 N ページ').replace(/<td class="no">\d+<\/td>/g, '<td class="no">n</td>')
    .replace(/\bp\d+-/g, 'pN-').replace(/xp-(map|proc|flow)-d\d+-/g, 'xp-$1-');
  for (const r of x.designs) {
    const single = api.exportDocument(d(r.name), api.store.state, PER, AT).pages;
    const inDoc = [...x.pages].slice(r.firstPage - 1, r.firstPage - 1 + r.pages);
    assert.equal(inDoc.length, single.length, r.name);
    inDoc.forEach((h, i) => assert.equal(norm(h), norm(single[i]), `${r.name} の ${i + 1} ページ目`));
  }
  // 画面設計ごとに出す図のページがある（矢印の印の id の頭が画面設計ごとに違う）
  const all = x.pages.join('\n');
  for (const head of ['xp-map-d1-arrow', 'xp-map-d2-arrow', 'xp-proc-d1-arrow', 'xp-flow-d1-arrow']) assert.ok(all.includes(head), head);
});

test('説明書の全部のページで、要素の id と矢印の印の id が重ならない', async (t) => {
  const { doc } = await boot(t);
  const all = doc().pages.join('\n');
  const ids = [...all.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 10);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

test('システムの表紙: 小見出し・名前・説明・数・役割とメモ・作る先・ほかの（ごみ箱でない）システムでも使っている画面設計の札・出力した日', async (t) => {
  const { parse, doc } = await boot(t);
  const c = parse(doc().pages[0]);
  assert.equal(c.querySelector('.cv-kicker').textContent, 'システムの説明書');
  assert.match(c.querySelector('.cv-desc').textContent, /出張の事前申請と/);
  const meta = c.querySelector('.cv-meta').textContent;
  assert.match(meta, /出力した日 2026-10-20/);
  assert.match(meta, /役割 3 つ・画面設計 2 つ・作業 7 つ/);
  const roles = [...c.querySelectorAll('.cv-revs tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  assert.deepEqual(JSON.parse(JSON.stringify(roles)), [['申請者', '出張する社員'], ['上長', '申請者の所属の課長'], ['経理', '経理課の担当']]);
  const tr = (n) => [...c.querySelectorAll('.cv-list tbody tr')].find((x) => x.querySelector('.nm').childNodes[0].textContent === n);
  assert.equal(tr('経費精算').querySelector('.share-tag').textContent, '経費精算システムでも使っている');
  assert.equal(tr('出張申請').querySelector('.share-tag'), null, 'ごみ箱のシステムは数えない');
  assert.match(tr('出張申請').querySelector('.dev').textContent, /kintone/);
  assert.match(c.querySelector('.cv-foot').textContent, /モックイメージメーカー v1\.00 で出力/);
});

test('スイムレーン図のページ: 凡例と図（矢印の印の id の頭は xp-swim）。左の端はシステムの名前', async (t) => {
  const { parse, doc } = await boot(t);
  const p = parse(doc().pages[1]);
  assert.equal(p.querySelector('.pg-head span').textContent, '役割ごとの帯に、作業の箱を左から順に並べた業務の流れ');
  assert.match(p.querySelector('.xp-legend').textContent, /戻る流れ/);
  assert.ok(p.querySelector('.pg-body').innerHTML.includes('xp-swim-arrow'));
  assert.equal(p.querySelectorAll('.mnode').length, 7);
  assert.equal(p.querySelector('.pg-foot span').textContent, '出張申請システム ／ スイムレーン図');
});

test('設計ノートのページ（q80 案C）: 決めたことと理由（段階の順）→ まだ決まっていないこと（答えのない行 → 答えのある行を灰色で）。空の行と ⑤ の行は入れない', async (t) => {
  const { parse, doc } = await boot(t);
  const x = doc();
  const p = parse(x.pages[x.pages.length - 1]);
  assert.equal(p.querySelector('.pg-head span').textContent, '決めたことと理由 3 つ・まだ決まっていないこと 2 つ（決まったもの 1 つ）');
  assert.match(p.querySelector('.xp-nt-key').textContent, /段階: ① 資料から読み取る　② 業務の流れ　③ データベースの項目　④ 画面$/);
  assert.deepEqual(JSON.parse(JSON.stringify([...p.querySelectorAll('.xp-doc-h3')].map((h) => h.childNodes[0].textContent))), ['決めたことと理由', 'まだ決まっていないこと']);
  const [dt, qt] = p.querySelectorAll('table.xp-itable');
  const cells = (tb) => [...tb.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  const ds = cells(dt);
  assert.deepEqual(JSON.parse(JSON.stringify(ds.map((r) => [r[1], r[2]]))), [['①', '役割は、申請者・上長・経理の 3 つにする'], ['②', '承認は上長の 1 段にする'], ['③', '経費精算は、出張申請と別の画面設計にする']]);
  assert.match(ds[0][0], /^\d{4}-\d{2}-\d{2}$/);
  const qs = cells(qt);
  assert.deepEqual(JSON.parse(JSON.stringify(qs.map((r) => r.slice(0, 3)))), [['②', '部長の承認は要るか', ''], ['③', '宿泊費の上限を、役職で変えるか', ''], ['①', '海外出張も、このシステムで申請するか', '国内だけにする']]);
  assert.match(qs[2][3], /^\d{1,2}\/\d{1,2} に決まった$/);
  const trs = qt.querySelectorAll('tbody tr');
  assert.equal(trs[2].className, 'done');
  assert.notEqual(trs[0].className, 'done');
  const all = x.pages.join('\n');
  assert.ok(!all.includes('共有') && !all.includes('説明書は A3 で出すか') && !all.includes('説明書を出力した'), '⑤（docs）の行は入れない');
  assert.equal(p.querySelector('.pg-foot span').textContent, '出張申請システム ／ 設計ノート');
});

test('noteDocRows と systemDocCan: PDF に入れる行の見分けは 1 か所（空の行・知らない段階の行・⑤ の行は入れない）', async (t) => {
  const { api } = await boot(t, { notes: false });
  const S = api.store.state;
  const fake = (decisions, questions) => ({ id: 'y-x', designIds: [], roles: [], swimlane: { steps: [], edges: [] }, notes: { decisions, questions } });
  const rows = api.noteDocRows(fake(
    [{ stage: 'flow', text: '', reason: '' }, { stage: 'later', text: '知らない段階', reason: '' }, { stage: 'docs', text: '出力した', reason: DOCS_PATH }, { stage: 'screens', text: '', reason: '理由だけ' }],
    [{ stage: 'docs', text: '⑤ の問い', answer: '' }, { stage: 'items', text: '', answer: '答えだけ', resolvedAt: AT }],
  ));
  assert.deepEqual(JSON.parse(JSON.stringify(rows.decisions.map((r) => r.reason))), ['理由だけ']);
  assert.equal(rows.open.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.decided.map((r) => r.answer))), ['答えだけ']);
  // ⑤ の行だけのシステムは、窓でも PDF でも「設計ノートに行がない」
  const onlyDocs = fake([{ stage: 'docs', text: '出力した', reason: DOCS_PATH }], []);
  assert.equal(api.systemDocCan(onlyDocs, S).notes, false);
  assert.equal(api.systemDocCan(onlyDocs, S).swimlane, false);
  assert.equal(api.systemDocCan(onlyDocs, S).designs, 0);
});

test('出せないページは黙って外す: 作業の箱がない → スイムレーン図なし・設計ノートに行がない → 設計ノートなし。表紙の一覧からも外れる', async (t) => {
  const { parse, doc, api, y } = await boot(t, { steps: false, notes: false });
  const x = doc();
  const names = [...x.pages].map((h) => pageName(parse, h));
  assert.ok(!names.includes('スイムレーン図') && !names.includes('設計ノート'));
  assert.deepEqual(JSON.parse(JSON.stringify(x.included)), { systemCover: true, swimlane: false, notes: false });
  assert.equal(x.designs[0].firstPage, 2);
  const listed = [...parse(x.pages[0]).querySelectorAll('.cv-list .nm')].map((n) => n.childNodes[0].textContent);
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), ['出張申請', '経費精算']);
  const can = api.systemDocCan(y(), api.store.state);
  assert.deepEqual(JSON.parse(JSON.stringify(can)), { swimlane: false, notes: false, designs: 2 });
});

test('印を外したページは入らない: システムの表紙・スイムレーン図・設計ノート・画面設計ごとの表紙など。画面のページはいつも入る', async (t) => {
  const { parse, doc, d, api } = await boot(t);
  const x = doc({ ...ALL, systemCover: false, swimlane: false, notes: false, cover: false, map: false, items: false, process: false, flow: false });
  const screens = d('出張申請').screens.length + d('経費精算').screens.length;
  assert.equal(x.pages.length, screens);
  assert.deepEqual(JSON.parse(JSON.stringify(x.included)), { systemCover: false, swimlane: false, notes: false });
  assert.equal(pageNo(parse, x.pages[0]), `1 / ${screens}`);
  assert.deepEqual(JSON.parse(JSON.stringify(x.designs.map((r) => r.included))), [
    { cover: false, map: false, items: false, process: false, flow: false }, { cover: false, map: false, items: false, process: false, flow: false }]);
  // 全部入れたときの画面設計ごとの included（経費精算にはステータスがないので process は false）
  const full = doc();
  assert.deepEqual(JSON.parse(JSON.stringify(full.designs.map((r) => r.included))), [
    { cover: true, map: true, items: true, process: true, flow: true }, { cover: true, map: true, items: true, process: false, flow: true }]);
  void api;
});

test('画面設計が入っていないシステム: 表紙の一覧は「（画面設計は入っていません）」。縦の用紙では表紙の 2 列が上下', async (t) => {
  const { parse, api } = await boot(t);
  const empty = api.actions.createSystem({ name: '空のシステム', description: '' });
  const y = api.store.state.systems.find((x) => x.id === empty);
  const x = api.exportSystemDocument(y, api.store.state, { ...ALL, paper: 'A3', orient: 'portrait' }, AT);
  assert.equal(x.pages.length, 1);
  const c = parse(x.pages[0]);
  assert.match(c.querySelector('.cv-list').textContent, /（画面設計は入っていません）/);
  assert.match(c.querySelector('.cv-revs').textContent, /（役割はまだありません）/);
  assert.ok(c.querySelector('.cv-cols').classList.contains('stack'));
  assert.deepEqual(JSON.parse(JSON.stringify(x.designs)), []);
  assert.match(x.html, /<title>空のシステム_説明書<\/title>/);
});
