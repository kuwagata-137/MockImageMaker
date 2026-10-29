'use strict';
// CRM の見本のシステム（第 17 段階。画像 q132〜q135）のテスト。中身（画面設計 5 つ・画面 11 個・項目・つながり・ステータスと操作・役割・スイムレーン図）・
// 構築先と見た目・1 回の変更・同じ名前の画面設計がほかにあっても見本の中でつながること。会社・人の名前は架空のものだけ。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));

async function boot(t) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const S = () => api.store.state;
  const sys = (id) => S().systems.find((y) => y.id === id);
  const design = (id) => S().designs.find((d) => d.id === id);
  const designsOf = (id) => sys(id).designIds.map(design);
  const byName = (id, name) => designsOf(id).find((d) => d.name === name);
  return { app, api, S, sys, design, designsOf, byName };
}

test('CRM の見本: システム・役割 5 つ・画面設計 5 つと画面 11 個（画像 q133 の表の順）', async (t) => {
  const { api, sys, designsOf } = await boot(t);
  const id = api.buildCrmSample();
  const y = sys(id);
  assert.equal(y.name, '顧客管理システム');
  assert.match(y.description, /架空の会社/);
  assert.deepEqual(plain(y.roles.map((r) => r.name)), ['お客さま', 'システム', 'サポート', '作業員', '営業']);
  assert.deepEqual(plain(designsOf(id).map((d) => [d.name, d.screens.map((s) => s.name)])), [
    ['顧客', ['顧客の一覧', '顧客の詳細']],
    ['商談', ['商談のかんばん', '商談の詳細', 'ホーム']],
    ['問い合わせ', ['問い合わせの詳細', '無償修理の承認申請']],
    ['作業指示', ['作業指示の一覧', '作業報告']],
    ['ナレッジ', ['ホーム', 'AI のアシスタント']],
  ]);
  assert.ok(designsOf(id).every((d) => d.look === 'salesforce' && d.target === 'salesforce'), '最初は構築先も見た目も Salesforce');
  // 小さなウィンドウの画面は、下に重ねる画面を指す
  const under = (d, name) => d.screens.find((s) => s.id === d.screens.find((x) => x.name === name).overlay.under).name;
  const [, , kase, work, know] = designsOf(id);
  assert.deepEqual([under(kase, '無償修理の承認申請'), under(work, '作業報告'), under(know, 'AI のアシスタント')], ['問い合わせの詳細', '作業指示の一覧', 'ホーム']);
  assert.equal(work.screens[1].overlay.pos, 'right');
  // アイテムは画面からはみ出さない
  designsOf(id).forEach((d) => d.screens.forEach((s) => s.parts.forEach((p) => {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= s.width && p.y + p.h <= s.height, `${d.name}・${s.name} の ${p.type} が画面からはみ出す`);
  })));
});

test('CRM の見本: 項目とステータスと操作（画像 q135 の表）', async (t) => {
  const { api, byName } = await boot(t);
  const id = api.buildCrmSample();
  const names = (d) => d.items.map((it) => it.name);
  assert.deepEqual(plain(names(byName(id, '顧客'))), ['顧客名', '顧客番号', '電話', '業種', '住所', '担当者', '地域', '年間の売上']);
  assert.deepEqual(plain(names(byName(id, '商談'))), ['商談名', '取引先名', '金額', '完了予定日', '段階']);
  assert.equal(names(byName(id, '問い合わせ'))[0], '問い合わせ番号', '問い合わせ番号は項目一覧のいちばん上');
  assert.deepEqual(plain(names(byName(id, '作業指示'))), ['作業指示番号', '問い合わせ番号', '顧客名', '訪問日', '作業員', 'ステータス', '作業の日', '作業の内容', '写真']);
  assert.deepEqual(plain(names(byName(id, 'ナレッジ'))), ['記事名', '種類', '本文', '公開日']);
  const flow = (d) => {
    const st = d.items.find((it) => it.type === 'status');
    const n = (sid) => st.props.states.find((s) => s.id === sid).name;
    return { states: st.props.states.map((s) => s.name), actions: st.props.actions.map((a) => `${a.name}:${n(a.from)}→${n(a.to)}:${a.role}`) };
  };
  assert.deepEqual(plain(flow(byName(id, '問い合わせ'))), { states: ['新規', '対応中', 'エスカレーション', '回答待ち', 'クローズ'], actions: [
    '受け付ける:新規→対応中:サポート', 'エスカレーションする:対応中→エスカレーション:サポート', '担当に戻す:エスカレーション→対応中:上長',
    'お客さまに確認する:対応中→回答待ち:サポート', '回答を受け取る:回答待ち→対応中:サポート', 'クローズする:対応中→クローズ:サポート'] });
  assert.deepEqual(plain(flow(byName(id, '商談'))), { states: ['見込み', '提案', '見積', '交渉', '受注'],
    actions: ['提案する:見込み→提案:営業', '見積を出す:提案→見積:営業', '交渉に進む:見積→交渉:営業', '受注にする:交渉→受注:営業'] });
  assert.deepEqual(plain(flow(byName(id, '作業指示'))), { states: ['指示', '作業中', '報告済み', '完了'],
    actions: ['作業を始める:指示→作業中:作業員', '報告する:作業中→報告済み:作業員', '完了にする:報告済み→完了:サポート'] });
});

test('CRM の見本: つながり（ルックアップ 3 つ・関連レコード一覧の元）は見本の画面設計を id で指し、関連レコード一覧の列は元の項目につながる', async (t) => {
  const { api, byName, design } = await boot(t);
  const id = api.buildCrmSample();
  const nameOfDb = (db) => (db && db.designId ? design(db.designId).name : null);
  const lookups = (d) => d.items.filter((it) => it.lookup).map((it) => [it.name, nameOfDb(it.lookup.db)]);
  assert.deepEqual(plain(lookups(byName(id, '商談'))), [['取引先名', '顧客']]);
  assert.deepEqual(plain(lookups(byName(id, '問い合わせ'))), [['顧客名', '顧客']]);
  assert.deepEqual(plain(lookups(byName(id, '作業指示'))), [['問い合わせ番号', '問い合わせ']]);
  const related = (d) => d.screens.flatMap((s) => s.parts.filter((p) => p.tableKind === 'related').map((p) => [p.label, nameOfDb(p.props.db)]));
  assert.deepEqual(plain(related(byName(id, '顧客'))), [['顧客の担当者', null], ['商談', '商談'], ['問い合わせ', '問い合わせ']]);
  assert.deepEqual(plain(related(byName(id, '商談'))), [['見積', null], ['問い合わせ', '問い合わせ']]);
  assert.deepEqual(plain(related(byName(id, '問い合わせ'))), [['ほかの問い合わせ', '問い合わせ'], ['ナレッジの記事', 'ナレッジ']]);
  const know = byName(id, 'ナレッジ');
  const articles = byName(id, '問い合わせ').screens[0].parts.find((p) => p.label === 'ナレッジの記事');
  assert.deepEqual(plain(articles.props.columns.map((c) => (know.items.find((it) => it.id === c.ref.itemId) || {}).name)), ['記事名', '種類']);
});

test('CRM の見本: スイムレーン図は工程 12 個・矢印 12 本。工程は見本の画面設計・画面・ステータスを指す', async (t) => {
  const { api, sys, design } = await boot(t);
  const id = api.buildCrmSample();
  const y = sys(id);
  const role = (rid) => y.roles.find((r) => r.id === rid).name;
  const refName = (ref) => {
    if (!ref.designId) return '';
    const d = design(ref.designId);
    const st = d.items.find((it) => it.type === 'status');
    return [d.name, ref.screenId ? d.screens.find((s) => s.id === ref.screenId).name : '', ref.stateId ? st.props.states.find((s) => s.id === ref.stateId).name : ''].join('/');
  };
  assert.deepEqual(plain(y.swimlane.steps.map((w) => [role(w.roleId), w.col, w.kind, w.text, refName(w.ref)])), [
    ['お客さま', 0, 'start', 'エアコンが冷えない', ''],
    ['お客さま', 1, 'input', 'サポートサイトで調べ、問い合わせる', 'ナレッジ/ホーム/'],
    ['システム', 2, 'task', '問い合わせを登録し、受付のメールを送る', '問い合わせ//新規'],
    ['サポート', 3, 'input', '問い合わせを受け付け、担当者を決める', '問い合わせ/問い合わせの詳細/対応中'],
    ['サポート', 4, 'decision', '電話で直せるか', ''],
    ['サポート', 5, 'task', 'ナレッジの記事で直し方を案内する', 'ナレッジ//'],
    ['サポート', 5, 'input', '作業指示を出す', '作業指示/作業指示の一覧/指示'],
    ['作業員', 6, 'task', '訪問して修理する', '作業指示//作業中'],
    ['作業員', 7, 'input', '作業報告を書く', '作業指示/作業報告/報告済み'],
    ['営業', 8, 'input', '入れ替えの商談を作る', '商談/商談のかんばん/見込み'],
    ['サポート', 8, 'input', '結果を知らせて、クローズする', '問い合わせ/問い合わせの詳細/クローズ'],
    ['お客さま', 9, 'end', '直ったことを確認する', ''],
  ]);
  const text = (sid) => y.swimlane.steps.find((w) => w.id === sid).text;
  assert.equal(y.swimlane.edges.length, 12);
  assert.deepEqual(plain(y.swimlane.edges.filter((e) => e.label).map((e) => [text(e.from), text(e.to), e.label])), [
    ['電話で直せるか', 'ナレッジの記事で直し方を案内する', '直せる'], ['電話で直せるか', '作業指示を出す', '直せない'], ['作業報告を書く', '入れ替えの商談を作る', '入れ替えが要る'],
  ]);
});

test('CRM の見本: 構築先と見た目を選べる（kintone・Claude で作るアプリと標準）', async (t) => {
  const { api, designsOf } = await boot(t);
  const kt = api.buildCrmSample({ target: 'kintone', look: 'kintone' });
  assert.ok(designsOf(kt).every((d) => d.look === 'kintone' && d.target === 'kintone'));
  const std = api.buildCrmSample({ name: '顧客管理（標準）', target: 'claude', look: 'standard' });
  assert.ok(designsOf(std).every((d) => d.look === 'standard' && d.target === 'claude'));
  // 帯の高さが違っても、アイテムは画面からはみ出さない
  [kt, std].forEach((id) => designsOf(id).forEach((d) => d.screens.forEach((s) => assert.ok(s.parts.every((p) => p.y + p.h <= s.height), `${d.look}: ${d.name}・${s.name}`))));
});

test('CRM の見本: 1 回の変更（Ctrl+Z 1 回でシステムと画面設計 5 つが消え、やり直すで戻る）', async (t) => {
  const { api, S } = await boot(t);
  api.buildCrmSample();
  assert.equal(api.store.undoStack.length, 1);
  assert.deepEqual([S().systems.length, S().designs.length], [1, 5]);
  api.runCommand('undo');
  assert.deepEqual([S().systems.length, S().designs.length], [0, 0]);
  api.runCommand('redo');
  assert.deepEqual([S().systems.length, S().designs.length], [1, 5]);
});

test('CRM の見本: 同じ名前の画面設計がほかにあっても、見本の中だけでつなぐ。2 回作ると、それぞれの見本の中でつながる', async (t) => {
  const { api, byName, design, S } = await boot(t);
  ['顧客', '商談', '問い合わせ', 'ナレッジ'].forEach((n) => api.actions.createDesign(n, 'kintone'));
  const a = api.buildCrmSample();
  const b = api.buildCrmSample();
  assert.equal(S().designs.length, 4 + 10);
  for (const id of [a, b]) {
    const own = new Set(api.store.state.systems.find((y) => y.id === id).designIds);
    const dbs = [];
    byName(id, '商談').items.concat(byName(id, '問い合わせ').items, byName(id, '作業指示').items).filter((it) => it.lookup).forEach((it) => dbs.push(it.lookup.db.designId));
    ['顧客', '商談', '問い合わせ'].forEach((n) => byName(id, n).screens.forEach((s) => s.parts.filter((p) => p.tableKind === 'related' && p.props.db.designId)
      .forEach((p) => dbs.push(p.props.db.designId))));
    assert.equal(dbs.length, 3 + 5);
    assert.ok(dbs.every((did) => own.has(did)), `見本の外の画面設計を指している: ${dbs.filter((did) => !own.has(did)).map((did) => design(did).name)}`);
  }
});
