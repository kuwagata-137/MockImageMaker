// tools/shoot-app.js の設計ノートの場面（--only=notes。場面 150〜157）。第 10 段階の前半の「設計ノート」の入口（画像 k75 の「段階ごとの札と進み具合のボタン」）のとおりかを撮る。
// 見本は架空の出張申請システム。AI の道具（テスト用の窓口 window.__test__ の aiDispatch）で、役割・画面設計・設計ノートの中身
// （① ② 確認済み・③ 確認待ち・④ ⑤ まだ。読み取ったこと・決めたこと 4 つ・まだ決まっていないこと 3 つ〔① の 1 つは決まった〕・メモ）を組み立てる。
// 札・進み具合のボタン・メニューは、Puppeteer で実際にマウスを押して動かす（headless・窓を出さない）。画像は screenshots/ に置く。
// どの場面も、撮るたびに、大事な所が出ているかを need() で確かめる（出ていなければ止まる）。
//  150 ③ の札（最初に開く札）／ 151 ① の札（読み取ったこと）／ 152 進み具合のメニューを開いたところ／ 153 メニューで「確認済みにする」を押した後／
//  154 確かめずに進めた札（点線）のある札の並び／ 155 まだ始めていないシステム／ 156 ブラウザで開いたとき（資料の窓口なし。入口は 5 つ）／
//  157 AI が設計ノートだけを直したときの紫の帯（変更の数）
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { SCHEMA_VERSION } = require('./material-sample-place');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, message) => { if (!ok) throw new Error(message); };
const SYS_NAME = '出張申請システム';
const STATES = ['todo', 'doing', 'review', 'done', 'skipped'];

// ── ページの中で動かす（起動の前に置く）: 保存先の用意と、資料の窓口の身代わり（デスクトップ版のときだけ。入口の「資料」を出すため）──
function installPage(opts) {
  window.__test__ = {};
  localStorage.clear();
  localStorage.setItem('mockimagemaker.v1', JSON.stringify({ schemaVersion: opts.schemaVersion, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] }));
  if (!opts.api) return;
  const ok = async () => ({ ok: true });
  window.materialsAPI = { available: true, pick: async () => ({ ok: false, canceled: true }), addDropped: ok, read: ok, bdmPlan: ok,
    sweep: async () => ({ ok: true, removedFiles: 0, removedDirs: 0 }), removeSystem: async () => ({ ok: true, removed: 0 }) };
}

// ── ページの中で動かす: 見本のシステムを AI の道具で組み立てる ──
// opts: { name, description, full }。full が偽なら、システムだけを作る（役割・画面設計・資料・設計ノートの中身なし）
async function buildSystem(opts) {
  const T = window.__test__;
  const call = async (tool, args) => {
    const r = await T.aiDispatch(tool, args, { session: 'shoot-notes', client: 'claude-code' });
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const sys = (await call('create_system', { name: opts.name, description: opts.description })).id;
  if (opts.full) {
    await call('update_system', { system: sys, ops: [{ op: 'add', name: '申請者' }, { op: 'add', name: '上長' }, { op: 'add', name: '経理' }] });
    await call('set_swimlane', { system: sys,
      steps: [
        { key: 'a', role: '申請者', kind: 'start', text: '出張が決まる' }, { key: 'b', role: '申請者', kind: 'input', text: '出張申請を入力する' },
        { key: 'c', role: '上長', kind: 'decision', text: '申請を確かめる' }, { key: 'd', role: '上長', kind: 'task', text: '承認する' },
        { key: 'e', role: '経理', kind: 'task', text: '旅費を精算する' }, { key: 'f', role: '経理', kind: 'doc', text: '精算書を出す' }, { key: 'g', role: '経理', kind: 'end', text: '終わり' },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: '承認' }, { from: 'c', to: 'b', label: '差し戻し' },
        { from: 'd', to: 'e' }, { from: 'e', to: 'f' }, { from: 'f', to: 'g' }] });
    await call('create_design', { name: '出張申請', target: 'kintone', description: '社員が出張の前に申請し、上長が承認する。', system: sys });
    await call('edit_items', { design: '出張申請', ops: [{ op: 'add', name: '申請者', type: 'user' }, { op: 'add', name: '行き先', type: 'text1' }, { op: 'add', name: '出発日', type: 'date' }] });
    await call('layout_screen', { design: '出張申請', screen: '画面 1', layout: { columns: 2, rows: [[{ item: '申請者' }, { item: '行き先' }], [{ item: '出発日' }]] } });
    await call('create_design', { name: '経費精算', target: 'kintone', description: '出張の旅費と、立て替えた経費を精算する。', system: sys });
    await call('layout_screen', { design: '経費精算', screen: '画面 1', layout: { columns: 2, rows: [[{ type: 'text1', label: '精算の件名' }, { type: 'number', label: '精算の金額' }]] } });
    T.actions.addMaterials(sys, [
      { id: 'm-1', name: '出張申請書.xlsx', kind: 'excel', size: 48000, file: 'm-1.xlsx' },
      { id: 'm-2', name: '旅費規程.pdf', kind: 'pdf', size: 1200000, file: 'm-2.pdf' },
      { id: 'm-3', name: '出張申請の流れ.html', kind: 'bdm', size: 2100000, file: 'm-3.html' },
    ]);
    const FINDINGS = '業務: 社員が出張の前に申請し、上長が承認する。出張から戻ったら 7 日以内に旅費を精算し、経理が確かめて支払う。\n'
      + '登場人物（役割）: 申請者（社員）・上長・経理\n今の手順: 紙の出張申請書に書いて上長の印をもらい、総務に回す。\n'
      + '様式「出張申請書」の欄: 申請者（必須）・行き先（必須）・出発日と帰着日（必須）・概算の金額（円）・出張の目的';
    const w = await call('update_notes', { system: sys, ops: [
      { op: 'set_findings', text: FINDINGS },
      { op: 'set_memo', text: 'ベンダーとの打ち合わせは 10/25。説明書の PDF を前の日までに送る。' },
      { op: 'add_question', stage: 'items', text: '宿泊費の上限（1 泊 9,000 円）を、役職で変えるか' },
      { op: 'add_question', stage: 'items', text: '「出張の目的」の欄を、必ず書く欄（必須）にするか' },
      { op: 'add_question', stage: 'read', text: '海外出張も、このシステムで申請するか' },
      { op: 'add_decision', stage: 'read', text: '役割は、申請者・上長・経理の 3 つにする', reason: '旅費規程の第 5 条と、出張申請書の承認の欄から' },
      { op: 'add_decision', stage: 'flow', text: '承認は上長の 1 段にする', reason: '理念の「現場の手間を減らす」から。部長の承認は、金額が 10 万円以上のときだけにする' },
      { op: 'add_decision', stage: 'flow', text: '差し戻すと、申請者の「申請」に戻す', reason: '今の流れ（資料の「出張申請の流れ.html」）と同じにした' },
      { op: 'add_decision', stage: 'items', text: '経費精算は、出張申請と別の画面設計にする', reason: '精算は経理が確かめ、出張のない経費も入るため' },
    ] });
    const qRead = w.added.filter((a) => a.op === 'add_question')[2].id; // ① の、まだ決まっていないこと（答えを書いて「決まった」にする）
    await call('update_notes', { system: sys, ops: [{ op: 'answer_question', id: qRead, answer: '国内だけにする（総務に確かめた）' }] });
    for (const [stage, states] of [['read', ['doing', 'review', 'done']], ['flow', ['doing', 'review', 'done']], ['items', ['doing', 'review']]]) {
      for (const state of states) await call('set_stage', { system: sys, stage, state });
    }
  }
  T.aiView.cards.clear(); // AI が作った印（紫の札・帯）を外す
  T.aiView.band = null;
  T.aiView.warn = null;
  T.goHome();
  return sys;
}

// ── ページを開いて見本を作り、設計ノートの入口を開く ──
// opts: { api（資料の窓口の身代わりを置くか。偽ならブラウザで開いたとき）, full（見本の中身を作るか）, name, description }
async function openPage(ctx, opts = {}) {
  const { api = true, full = true, name = SYS_NAME, description = '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。' } = opts;
  const page = await ctx.browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  await page.evaluateOnNewDocument(installPage, { api, schemaVersion: SCHEMA_VERSION });
  page.on('pageerror', (e) => { ctx.errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto(pathToFileURL(path.join(ctx.root, ctx.htmlName)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  const sysId = await page.evaluate(buildSystem, { name, description, full });
  await page.evaluate((id) => window.__test__.openSystem(id, { panel: 'notes' }), sysId);
  await toastGone(page); // 作る途中のお知らせが、次の場面に写り込まないように
  await sleep(250);
  return { page, sysId };
}
const toastGone = (page) => page.waitForFunction(() => document.querySelector('#toast').hidden, { timeout: 8000 });

// ── 画面を読む・押す ──
// 札（段階・状態・開いているか・高さ）・進み具合のボタンの文字・左の入口の小さな字・表の行の数・欄の文字・開いているメニューの項目と四角
const readNotes = (page) => page.evaluate((states) => {
  const all = (s) => [...document.querySelectorAll(s)];
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const val = (sy) => { const el = document.querySelector(`#sys-view [data-sy="${sy}"]`); return el ? el.value : null; };
  const pill = document.querySelector('#sys-view .nt-pill');
  return {
    tabs: all('#sys-view .nt-tab').map((t) => ({ stage: t.dataset.stage, state: states.find((s) => t.classList.contains(s)), on: t.classList.contains('on'), h: Math.round(t.getBoundingClientRect().height),
      border: getComputedStyle(t).borderTopStyle, mark: txt(t.querySelector('i')) })),
    pill: txt(pill), pillBorder: pill ? getComputedStyle(pill).borderTopStyle : null, expanded: pill ? pill.getAttribute('aria-expanded') : null, pillRect: rect(pill),
    entry: txt(document.querySelector('#sys-list [data-panel="notes"] small')),
    entries: all('#sys-list .db-entry[data-panel]').map((e) => e.dataset.panel),
    activeEntry: (all('#sys-list .db-entry.active')[0] || { dataset: {} }).dataset.panel,
    findings: val('note-findings'), memo: val('note-memo'),
    openQ: all('#sys-view .nt-qs tbody tr:not(.resolved)').length, doneQ: all('#sys-view .nt-qs tbody tr.resolved').length, decisions: all('#sys-view .nt-ds tbody tr').length,
    tables: all('#sys-view .nt-tbl').length,
    menu: all('#sys-menu-root .nt-menu [role="menuitem"]').map((b) => b.dataset.state), menuRect: rect(document.querySelector('#sys-menu-root .nt-menu')),
    undoDisabled: (document.querySelector('#toolbar [data-action="undo"]') || {}).disabled,
    band: txt(document.querySelector('#ai-band')), bandBtn: (document.querySelector('#ai-band [data-action^="ai-open"]') || { dataset: {} }).dataset.action || null,
  };
}, STATES);
const stagesOf = (r) => r.tabs.map((t) => t.state).join();
const openTab = (r) => (r.tabs.find((t) => t.on) || {}).stage;
async function click(page, sel) {
  await page.click(sel);
  await sleep(180);
}
const pillClick = (page) => click(page, '#sys-view [data-action="sys-note-stage-menu"]');
const tabClick = (page, stage) => click(page, `#sys-view .nt-tab[data-stage="${stage}"]`);
const DATE = /（\d{4}-\d{2}-\d{2}）/;

// 150〜154: 1 つのページで、札を押す・メニューを開く・状態を変える（状態が順に変わるので、同じページで続けて撮る）
async function shootTabs(ctx) {
  const { shot } = ctx;
  const { page } = await openPage(ctx);
  // 150: ③ の札（最初に開く札。確認待ちの段階）
  let r = await readNotes(page);
  need(r.tabs.length === 5 && stagesOf(r) === 'done,done,review,todo,todo' && openTab(r) === 'items', `最初の札の並びが見本と違う: ${JSON.stringify(r.tabs)}`);
  need(/^確認待ち ▾$/.test(r.pill) && r.entry === '③ 確認待ち' && r.activeEntry === 'notes', `進み具合のボタン・入口の小さな字が違う: ${r.pill} ／ ${r.entry}`);
  need(r.findings === null && /ベンダーとの打ち合わせ/.test(r.memo) && r.openQ === 2 && r.doneQ === 0 && r.decisions === 1, `③ の札の中身が違う（読み取ったこと ${r.findings}・まだ決まっていない ${r.openQ}・決まった ${r.doneQ}・決めたこと ${r.decisions}）`);
  await shot(page, '150_設計ノート_③の札（確認待ち。最初に開く札）');
  // 151: ① の札（読み取ったこと・決まった行）
  await tabClick(page, 'read');
  r = await readNotes(page);
  need(openTab(r) === 'read' && DATE.test(r.pill) && /^確認済み（/.test(r.pill), `① の札を押しても、① が開いて「確認済み（日付）」にならない: ${openTab(r)} ／ ${r.pill}`);
  need(/^業務: 社員が出張の前に申請し/.test(r.findings) && r.openQ === 0 && r.doneQ === 1 && r.decisions === 1, `① の札の中身が違う（読み取ったこと「${(r.findings || '').slice(0, 20)}」・まだ決まっていない ${r.openQ}・決まった ${r.doneQ}・決めたこと ${r.decisions}）`);
  await shot(page, '151_設計ノート_①の札（読み取ったこと・決まった行）');
  // 152: ③ に戻って「確認待ち ▾」を押し、メニューを開く（ボタンの左下に、今の状態を除いた 3 つの項目）
  await tabClick(page, 'items');
  await pillClick(page);
  r = await readNotes(page);
  const gap = r.menuRect ? { dx: Math.round(r.menuRect.l - r.pillRect.l), dy: Math.round(r.menuRect.t - r.pillRect.b) } : null;
  need(r.menu.join() === 'done,skipped,todo' && r.expanded === 'true' && gap && Math.abs(gap.dx) <= 20 && gap.dy >= -2 && gap.dy <= 12, `進み具合のメニューが、ボタンの左下に 3 つの項目で開いていない: ${JSON.stringify({ menu: r.menu, expanded: r.expanded, gap })}`);
  await shot(page, '152_設計ノート_進み具合のメニューを開いたところ（③ 確認待ち。項目は 3 つ）');
  // 153: メニューの「確認済みにする」を押した後（③ が確認済みになり、確認の日付が付く。入口の小さな字は ④ まだ）
  await click(page, '#sys-menu-root .nt-menu [role="menuitem"][data-state="done"]');
  r = await readNotes(page);
  need(stagesOf(r) === 'done,done,done,todo,todo' && openTab(r) === 'items' && /^確認済み（\d{4}-\d{2}-\d{2}） ▾$/.test(r.pill) && !r.menu.length && r.entry === '④ まだ',
    `「確認済みにする」を押した後が違う: ${stagesOf(r)} ／ ${r.pill} ／ メニュー ${r.menu.length} ／ ${r.entry}`);
  need(r.undoDisabled === false, '進み具合を変えたのに、元に戻す（Ctrl+Z）のボタンが使えない状態のまま');
  await toastGone(page);
  await shot(page, '153_設計ノート_メニューで「確認済みにする」を押した後（③ が確認済み）');
  // 154: ④ の札で「確かめずに進めたことにする」を押す → 点線の枠の札（⤼）。今の状態を除いた項目は 2 つ
  await tabClick(page, 'screens');
  r = await readNotes(page);
  need(openTab(r) === 'screens' && /^まだ ▾$/.test(r.pill), `④ の札が開かない: ${openTab(r)} ／ ${r.pill}`);
  await pillClick(page);
  r = await readNotes(page);
  need(r.menu.join() === 'done,skipped', `まだの段階のメニューの項目が 2 つ（確認済み・確かめずに進めた）になっていない: ${r.menu.join()}`);
  await click(page, '#sys-menu-root .nt-menu [role="menuitem"][data-state="skipped"]');
  r = await readNotes(page);
  need(stagesOf(r) === 'done,done,done,skipped,todo' && /^確認を飛ばした（\d{4}-\d{2}-\d{2}） ▾$/.test(r.pill) && r.pillBorder === 'dashed' && r.entry === '⑤ まだ',
    `確かめずに進めた段階の進み具合のボタン（点線）・入口の小さな字が違う: ${stagesOf(r)} ／ ${r.pill} ／ ${r.pillBorder} ／ ${r.entry}`);
  // 点線の札が選ばれていると濃い紺で塗られて点線が見えないので、③ の札へ移ってから撮る（札の並びに、点線の ④ の札が見える）
  await tabClick(page, 'items');
  r = await readNotes(page);
  const sk = r.tabs[3];
  const heights = r.tabs.map((t) => t.h);
  need(openTab(r) === 'items' && !sk.on && sk.border === 'dashed' && sk.mark === '⤼', `確かめずに進めた札（④）が、選ばれていない点線の札（⤼）になっていない: ${openTab(r)} ／ ${JSON.stringify(sk)}`);
  need(Math.max(...heights) - Math.min(...heights) <= 2, `点線の札があると札の高さがそろわない（札の高さ ${heights.join('・')}）`);
  await toastGone(page);
  await shot(page, '154_設計ノート_確かめずに進めた札（点線）のある札の並び（④ が点線・⤼）');
  await page.close();
}

// 155: まだ始めていないシステム（5 つの札がどれも「まだ」。表はなく、数は「なし」）
async function shootEmpty(ctx) {
  const { page } = await openPage(ctx, { full: false, name: '経費精算システム', description: '立て替えた経費を申請し、経理が支払うシステム。' });
  const r = await readNotes(page);
  need(stagesOf(r) === 'todo,todo,todo,todo,todo' && openTab(r) === 'read' && /^まだ ▾$/.test(r.pill) && r.entry === 'まだ始めていません',
    `まだ始めていないシステムの札・入口の小さな字が違う: ${stagesOf(r)} ／ ${openTab(r)} ／ ${r.pill} ／ ${r.entry}`);
  need(r.findings === '' && r.memo === '' && r.tables === 0 && r.decisions === 0, `まだ始めていないのに表・文字が入っている（表 ${r.tables}・読み取ったこと「${r.findings}」）`);
  await ctx.shot(page, '155_設計ノート_まだ始めていないシステム（札は 5 つとも「まだ」・表なし）');
  await page.close();
}

// 156: ブラウザで開いたとき（資料の窓口がない）。入口は 概要・役割・スイムレーン図・設計ノート・履歴 の 5 つで、設計ノートが開いている
async function shootWeb(ctx) {
  const { page } = await openPage(ctx, { api: false });
  const r = await readNotes(page);
  need(r.entries.join() === 'overview,roles,swimlane,notes,history' && r.activeEntry === 'notes' && r.tabs.length === 5 && openTab(r) === 'items',
    `資料の窓口がないときの入口の並び（5 つ）・開いている入口が違う: ${r.entries.join()} ／ ${r.activeEntry} ／ 札 ${r.tabs.length}`);
  await ctx.shot(page, '156_設計ノート_ブラウザで開いたとき（資料の窓口がないので入口は 5 つ。設計ノートはある）');
  await page.close();
}

// 157: AI が設計ノートだけを直したとき（システムの画面を開いたまま）の紫の帯。変更の数は、まだ決まっていないこと 1・決めたこと 1・メモ 1・段階 1 の 4 件
async function shootAiBand(ctx) {
  const { page, sysId } = await openPage(ctx);
  const ai = (tool, args) => page.evaluate(async (t, a) => {
    const r = await window.__test__.aiDispatch(t, a, { session: 'shoot-ai', client: 'claude-code' });
    if (!r.ok) throw new Error(`${t}: ${JSON.stringify(r.error)}`);
    return r.result;
  }, tool, args);
  let r = await readNotes(page);
  need(!r.band, `AI が直す前なのに、紫の帯が出ている: ${r.band}`);
  await ai('update_notes', { system: sysId, ops: [
    { op: 'add_question', stage: 'items', text: '概算の金額は、宿泊の有無で分けて入れるか' },
    { op: 'add_decision', stage: 'items', text: '「出張の目的」の欄は、複数行の文字の欄にする', reason: '出張申請書の記入例に、長い目的が書かれているため' },
    { op: 'set_memo', text: 'ベンダーとの打ち合わせは 10/25。説明書の PDF を前の日までに送る。項目の案は、打ち合わせの前に見てもらう。' },
  ] });
  await ai('set_stage', { system: sysId, stage: 'screens', state: 'doing' });
  await sleep(300);
  r = await readNotes(page);
  need(/が「出張申請システム」を直しました（変更 4 件）/.test(r.band || ''), `紫の帯の変更の数が 4 件になっていない: ${r.band}`);
  need(openTab(r) === 'items' && r.openQ === 3 && r.decisions === 2 && stagesOf(r) === 'done,done,review,doing,todo',
    `AI が直した中身が、開いている ③ の札に出ていない（開いている札 ${openTab(r)}・まだ決まっていない ${r.openQ}・決めたこと ${r.decisions}・${stagesOf(r)}）`);
  await ctx.shot(page, '157_設計ノート_AIが設計ノートだけを直したときの紫の帯（変更 4 件）');
  // 最初の画面に戻る（戻ると紫の帯は消える）。そこで AI が設計ノートだけをもう一度直すと、帯の「開く」は設計ノートの入口で開く
  await page.evaluate(() => window.__test__.goHome());
  await ai('update_notes', { system: sysId, ops: [{ op: 'set_memo', text: 'ベンダーとの打ち合わせは 10/25。' }] });
  await sleep(200);
  r = await readNotes(page);
  need(r.bandBtn === 'ai-open-system-notes', `最初の画面の紫の帯の「開く」が設計ノートの入口になっていない: ${r.bandBtn}（帯の文「${r.band}」）`);
  await click(page, '#ai-band [data-action="ai-open-system-notes"]');
  const at = await page.evaluate(() => ({ view: window.__test__.ui.view, panel: window.__test__.ui.sysPanel, id: window.__test__.ui.systemId }));
  need(at.view === 'system' && at.panel === 'notes' && at.id === sysId, `帯の「開く」を押しても、システムの設計ノートの入口が開かない: ${JSON.stringify(at)}`);
  await page.close();
}

module.exports = async function shootNotes(browser, env) {
  const ctx = { browser, root: env.ROOT, htmlName: env.HTML_NAME, errors: [], shot: async (p, name) => { await sleep(120); await env.shot(p, name); } };
  await shootTabs(ctx);
  await shootEmpty(ctx);
  await shootWeb(ctx);
  await shootAiBand(ctx);
  need(!ctx.errors.length, `ページで例外が出た: ${ctx.errors.join(' ／ ')}`);
};
