'use strict';
// ひな形「顧客の詳細」「問い合わせ対応の 3 列」（第 14 段階。画像 q120）のテスト。並び・番号・グループ枠に入る項目・サンプルの項目・見た目ごとのずらし。
// 画面設計の名前は架空の業務（顧客管理・問い合わせ管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function boot(t, name, look = 'standard') {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const id = api.actions.createDesign(name, 'salesforce', { look });
  api.openDesign(id);
  const design = () => api.store.state.designs.find((d) => d.id === id);
  const add = (tpl) => {
    const sid = api.actions.addScreen(id, tpl, design().screens[0].id);
    return design().screens.find((s) => s.id === sid);
  };
  const nameOf = (itemId) => (design().items.find((it) => it.id === itemId) || {}).name;
  return { app, api, id, design, add, nameOf };
}
const rect = (p) => [p.x, p.y, p.w, p.h];
// グループ枠と見出しの中のアイテムどうし・外のアイテムどうしは重ならない（container とその中のアイテムは重なってよい）
function assertNoOverlap(sc) {
  sc.parts.forEach((a, i) => sc.parts.slice(i + 1).forEach((b) => {
    if (a.inFrame === b.id || b.inFrame === a.id) return;
    assert.ok(!overlaps(a, b), `${a.type}（${a.no}）と ${b.type}（${b.no}）が重なる`);
  }));
  assert.ok(sc.parts.every((p) => p.y + p.h <= sc.height), 'アイテムは画面からはみ出さない');
}

test('ひな形: 「顧客の詳細」と「問い合わせ対応の 3 列」を、進捗の後ろに追加した', async (t) => {
  const { api } = await boot(t, '顧客管理');
  assert.deepEqual(plain(api.SCREEN_TEMPLATES.map((x) => x.id)), ['blank', 'input', 'detail', 'list', 'graph', 'agg', 'steps', 'crmDetail', 'crmCase', 'crmKanban', 'crmHome', 'winApproval', 'portalTop', 'winChat']);
  assert.deepEqual(plain(api.SCREEN_TEMPLATES.filter((x) => ['crmDetail', 'crmCase'].includes(x.id)).map((x) => x.name)), ['顧客の詳細', '問い合わせ対応の 3 列'], '第 14 段階のひな形 2 つ');
});

test('顧客の詳細: 項目がなければサンプルの項目を 8 つ追加し、見出し・ボタン・グループ枠・活動履歴・関連レコード一覧の並べて表示 3 つを、画像の番号の順に置く', async (t) => {
  const { add, design, nameOf } = await boot(t, '顧客管理');
  const sc = add('crmDetail');
  assert.deepEqual(plain(design().items.map((it) => [it.type, it.name])), [['text1', '顧客名'], ['text1', '顧客番号'], ['text1', '電話'], ['text1', '業種'], ['text1', '住所'],
    ['user', '担当者'], ['text1', '地域'], ['number', '年間の売上']]);
  assert.equal(sc.itemView, 'show', '項目は値だけ表示');
  assert.deepEqual(plain(sc.parts.map((p) => [p.no, p.type === 'table' ? `${p.tableKind}:${p.props.display}` : p.type, p.itemId ? nameOf(p.itemId) : p.label])), [
    [1, 'recordHead', ''], [2, 'button', '編集'], [3, 'button', '削除'], [4, 'frame', '顧客の情報'],
    [5, 'text1', '顧客名'], [6, 'text1', '顧客番号'], [7, 'text1', '電話'], [8, 'text1', '業種'], [9, 'text1', '住所'], [10, 'user', '担当者'], [11, 'text1', '地域'], [12, 'number', '年間の売上'],
    [13, 'activity', '活動'], [14, 'related:tiles', '顧客の担当者'], [15, 'related:tiles', '商談'], [16, 'related:tiles', '問い合わせ'],
  ]);
  const [head, edit, del, frame] = sc.parts;
  assert.deepEqual(plain([rect(head), rect(edit), rect(del)]), [[32, 56, 1216, 96], [1008, 80, 96, 40], [1136, 80, 96, 40]], 'ボタンは見出しの右に重ねる');
  assert.deepEqual(plain([edit.inFrame, del.inFrame]), [head.id, head.id]);
  assert.deepEqual(plain(head.props), { kind: '顧客', name: '株式会社サンプル商事', color: 'blue', items: ['電話', '業種', '担当者', '地域'].map((n) => design().items.find((it) => it.name === n).id),
    values: ['03-1234-5678', '卸売業', '佐藤 花子', '関東'] });
  assert.deepEqual(plain(rect(frame).slice(0, 3)), [32, 176, 784], '左の列（784）');
  const kids = sc.parts.filter((p) => p.itemId);
  assert.ok(kids.every((p) => p.inFrame === frame.id), '項目はグループ枠に入る');
  assert.deepEqual(plain(kids.slice(0, 2).map(rect)), [[56, 240, 352, 64], [440, 240, 352, 64]], 'グループ枠の中に 2 列で、列の幅いっぱい');
  assert.deepEqual(plain(kids.map((p) => p.sample).slice(0, 3)), ['株式会社サンプル商事', 'C-00125', '03-1234-5678']);
  const last = kids[kids.length - 1];
  assert.equal(frame.y + frame.h, last.y + last.h + 24, 'グループ枠の高さは中身に合わせる');
  const act = sc.parts[12];
  assert.deepEqual(plain(rect(act)), [32, frame.y + frame.h + 24, 784, 400]);
  const tiles = sc.parts.slice(13);
  assert.deepEqual(plain(tiles.map((p) => [p.x, p.w, p.h, p.view.rows, p.props.db.name, p.props.columns.map((c) => c.ref.name).join('・')])), [
    [848, 400, 280, 2, '顧客の担当者', '氏名・役職・電話・メール'],
    [848, 400, 280, 2, '商談', '商談名・段階・金額・完了予定日'],
    [848, 400, 280, 2, '問い合わせ', '問い合わせ番号・件名・状況・受付日'],
  ], '右の列（400）に、上から重ねる');
  assert.deepEqual(plain(tiles.map((p) => p.y)), [176, 480, 784]);
  assert.equal(tiles[0].view.samples[tiles[0].props.columns[0].id][0], '山田 太郎');
  assertNoOverlap(sc);
});

test('顧客の詳細: 項目がもうあれば、サンプルの項目は作らず、入力の項目をグループ枠に並べ、見出しの主な項目は最初の 4 つ（値は空）', async (t) => {
  const { api, id, add, design } = await boot(t, '顧客管理');
  ['顧客コード', '顧客名', '電話番号', 'メール', '住所'].forEach((n) => api.actions.updateItem(id, api.actions.addItem(id, 'text1'), { label: n }));
  const ids = plain(design().items.map((it) => it.id));
  const sc = add('crmDetail');
  assert.equal(design().items.length, 5, '項目は増えない');
  const frame = sc.parts.find((p) => p.type === 'frame');
  assert.deepEqual(plain(sc.parts.filter((p) => p.inFrame === frame.id).map((p) => p.itemId)), ids);
  const head = sc.parts[0];
  assert.deepEqual(plain([head.props.items, head.props.values]), [ids.slice(0, 4), ['', '', '', '']]);
  assertNoOverlap(sc);
});

test('問い合わせ対応の 3 列: 見出し・ボタン・進捗バーの下に、3 列（288・576・288）でグループ枠・関連レコード一覧・活動履歴を、画像の番号の順に置く', async (t) => {
  const { add, design, nameOf } = await boot(t, '問い合わせ管理');
  const sc = add('crmCase');
  assert.deepEqual(plain(sc.parts.map((p) => [p.no, p.type === 'table' ? `${p.tableKind}:${p.props.display}` : p.type, p.itemId ? nameOf(p.itemId) : p.label])), [
    [1, 'recordHead', ''], [2, 'button', '編集'], [3, 'button', '削除'], [4, 'steps', 'ステータス'],
    [5, 'frame', '顧客の情報'], [6, 'text1', '顧客名'], [7, 'text1', '電話'], [8, 'text1', 'メール'], [9, 'related:tiles', 'ほかの問い合わせ'],
    [10, 'frame', '問い合わせの情報'], [11, 'text1', '件名'], [12, 'dropdown', '優先度'], [13, 'dropdown', '発生源'], [14, 'date', '受付日'], [15, 'dropdown', '連絡方法'],
    [16, 'user', '担当者'], [17, 'text2', '説明'],
    [18, 'activity', '活動'], [19, 'related:tiles', 'ナレッジの記事'],
  ]);
  const status = design().items.find((it) => it.type === 'status');
  assert.deepEqual(plain(status.props.states.map((s) => s.name)), ['新規', '対応中', 'エスカレーション', '回答待ち', 'クローズ'], 'ステータスの項目がなければ、問い合わせの並びで作る');
  const steps = sc.parts[3];
  assert.deepEqual(plain([rect(steps), steps.view.current]), [[32, 176, 1216, 40], status.props.states[1].id]);
  const head = sc.parts[0];
  assert.deepEqual(plain([head.props.kind, head.props.name, head.props.items.map(nameOf), head.props.values]),
    ['問い合わせ', '00002934 エアコンが冷えない', ['優先度', '顧客名', '担当者', '受付日'], ['高', '株式会社サンプル商事', '佐藤 花子', '2026-10-20']]);
  const col = (no) => sc.parts.find((p) => p.no === no);
  assert.deepEqual(plain([5, 10, 18].map((no) => [col(no).x, col(no).y, col(no).w])), [[32, 240, 288], [352, 240, 576], [960, 240, 288]]);
  assert.deepEqual(plain([col(6).x, col(6).w]), [56, 240], '左のグループ枠の中は 1 列');
  assert.deepEqual(plain([11, 12, 13, 17].map((no) => [col(no).x, col(no).w])), [[376, 528], [376, 248], [656, 248], [376, 528]], '真ん中のグループ枠の中は 2 列。件名と説明は 2 列の幅');
  assert.ok([6, 7, 8].every((no) => col(no).inFrame === col(5).id) && [11, 12, 13, 14, 15, 16, 17].every((no) => col(no).inFrame === col(10).id));
  assert.deepEqual(plain([col(9).x, col(9).y, col(9).w]), [32, col(5).y + col(5).h + 24, 288]);
  assert.deepEqual(plain([col(19).x, col(19).y]), [960, col(18).y + col(18).h + 24]);
  assertNoOverlap(sc);
  add('crmCase');
  assert.equal(design().items.filter((it) => it.type === 'status').length, 1, 'ステータスの項目は 1 つだけ');
});

test('CRM のひな形: どの見た目でも選べ、帯の高い見た目では帯の高さの差だけ下へずらす。関連レコード一覧の元は、同じ名前の画面設計があれば接続する', async (t) => {
  const { api, add, design } = await boot(t, '顧客管理', 'salesforce');
  const deal = api.actions.createDesign('商談', 'salesforce', { look: 'salesforce' });
  const shift = api.LOOKS.find((l) => l.id === 'salesforce').band - api.LOOKS[0].band;
  const sc = add('crmDetail');
  assert.equal(sc.parts[0].y, 56 + shift);
  const tiles = sc.parts.filter((p) => p.type === 'table');
  assert.deepEqual(plain(tiles.map((p) => [p.props.db.name, p.props.db.designId === deal])), [['顧客の担当者', false], ['商談', true], ['問い合わせ', false]]);
  assertNoOverlap(sc);
  const kt = await boot(t, '問い合わせ管理', 'kintone');
  const sc2 = kt.add('crmCase');
  assert.equal(sc2.parts[0].y, 56 + kt.api.LOOKS.find((l) => l.id === 'kintone').band - kt.api.LOOKS[0].band);
  assertNoOverlap(sc2);
  assert.ok(design());
});
