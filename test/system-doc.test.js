'use strict';
// システムの説明書（PDF）のページの組み方のテスト（第 10 段階の後半。q76・q77・q80・q81。仕様_細かい決めごと.md の「説明書（PDF）の細かい決めごと」）。
// システムの表紙 → スイムレーン図 → 画面設計ごとのページ（画面設計を 1 つ出力したときと同じ）→ 設計ノート。ページの番号は説明書の全体の通し番号。
// jsdom では要素の大きさを測れないので、表紙・表を続きのページに分ける所は tools/check-export.js（Electron）で確かめる。
// 見本は架空の業務（出張申請システム・経費精算システム）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { AT, ALL, PER, DOCS_PATH, bootSystemDoc } = require('./system-doc-fixtures');

async function boot(t, opts) {
  const b = await bootSystemDoc(t, opts);
  const doc = (o = ALL) => b.api.exportSystemDocument(b.y(), b.api.store.state, o, AT);
  return { ...b, doc };
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

test('表紙の札「〇〇でも使っている」: ほかのシステムの名前は 2 つまで、残りは「ほか N つ」。名前の切れ目でだけ折り返す（見直しの B-5）', async (t) => {
  const { parse, api } = await boot(t);
  const tag = (names) => parse(api.systemShareTag(names)).querySelector('.share-tag');
  assert.equal(tag(['経費精算システム']).textContent, '経費精算システムでも使っている');
  assert.equal(tag(['経費精算システム', '購買システム']).textContent, '経費精算システム・購買システムでも使っている');
  const many = tag(['経費精算システム', '購買システム', '社用車の予約システム', '会議室の予約システム']);
  assert.equal(many.textContent, '経費精算システム・購買システムほか 2 つでも使っている');
  // 折り返さない塊は、名前ごと（最後の名前は「でも使っている」と一緒）
  assert.deepEqual([...many.querySelectorAll('.nw')].map((x) => x.textContent), ['経費精算システム', '購買システムほか 2 つでも使っている']);
  assert.equal(tag(['<b>&システム']).querySelector('b'), null, '名前は文字として入れる');
});

test('表紙の役割の表: 入る数（roleMax）までにし、残りを省いたことを表の下に書く。測れないとき（jsdom）は全部入れる（見直しの B-2）', async (t) => {
  const { parse, api, y, doc } = await boot(t);
  const P = { w: 1123, h: 794 };
  const c = (roleMax) => parse(api.systemCoverHtml(y(), api.store.state, P, [], 1, AT, { roleMax }));
  const one = c(1);
  assert.equal(one.querySelectorAll('.cv-revs tbody tr').length, 1);
  assert.equal(one.querySelector('.cv-revs .cv-desc-cut').textContent, '（表紙に入りきらないため、残りの役割 2 つを省略しました。全部はアプリのシステムの「役割」で見られます）');
  const zero = c(0);
  assert.equal(zero.querySelectorAll('.cv-revs tbody tr').length, 0);
  assert.match(zero.querySelector('.cv-revs').textContent, /残りの役割 3 つを省略しました/);
  const all = c(null);
  assert.equal(all.querySelectorAll('.cv-revs tbody tr').length, 3);
  assert.equal(all.querySelector('.cv-revs .cv-desc-cut'), null);
  assert.equal(parse(doc().pages[0]).querySelectorAll('.cv-revs tbody tr').length, 3, '測れないときは全部');
});
