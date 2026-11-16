'use strict';
// v1.05 段階 B: 線が近づかない仕組み（ユーザーの要望 2026-11-13「不用意に線が重ならないような仕組みにしたい」）。
// 平行に走る 2 本の線は、WIRE_GAP_MIN（10）以上離す。見本は架空の業務（顧客管理・申込受付・購買の申請に似たステータスの流れ）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
// HTML の中の直角の線（data-wps）を、線の id ごとの { wps } にする
function routesOf(html) {
  const out = {};
  for (const m of html.matchAll(/data-wire="([^"]*)" data-wps="([^"]*)"/g)) out[m[1]] = { wps: m[2].split(' ').map((s) => s.split(',').map(Number)) };
  return out;
}
// ステータスの流れの線（path の d の M・L・Q の端の点）を、線ごとの { wps } にする（Q の曲げる点は角なので、端の点だけを使う）
function procRoutesOf(html) {
  const out = {};
  [...html.matchAll(/<path d="([^"]*)" fill="none"/g)].forEach((m, i) => {
    const nums = [];
    for (const c of m[1].matchAll(/([MLQ])([^MLQ]*)/g)) {
      const v = c[2].trim().split(/[\s,]+/).map(Number);
      nums.push(c[1] === 'Q' ? v.slice(2, 4) : v.slice(0, 2));
    }
    out['p' + i] = { wps: nums };
  });
  return out;
}

// 見本: 顧客管理（画面「顧客詳細」から 12 画面へ行き来する）と、申込受付（一本道）。AI のツールで作る
const SUBS = [['見積作成', '見積を作成する'], ['契約登録', '契約を登録する'], ['訪問記録', '訪問を記録する'], ['問い合わせ登録', '問い合わせを登録する'],
  ['請求書発行', '請求書を発行する'], ['入金確認', '入金を確認する'], ['担当者変更', '担当者を変更する'], ['住所変更', '住所を変更する'],
  ['解約受付', '解約を受け付ける'], ['資料送付', '資料を送付する'], ['点検予約', '点検を予約する'], ['メモ登録', 'メモを登録する']];
async function bootSamples(t) {
  const app = bootApp();
  t.after(() => app.close());
  const T = await app.api();
  const call = async (tool, args) => {
    const r = plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const btn = (label, to, style = 'normal') => ({ type: 'button', label, style, to });
  await call('create_design', { name: '顧客管理', target: 'kintone' });
  await call('edit_screen', { design: '顧客管理', ops: [{ op: 'update', screen: '画面 1', name: '顧客一覧' }] });
  for (const name of ['顧客登録', '顧客詳細', ...SUBS.map((x) => x[0])]) await call('add_screen', { design: '顧客管理', name });
  await call('layout_screen', { design: '顧客管理', screen: '顧客一覧', layout: { columns: 2, rows: [
    [{ type: 'link', label: '顧客名（押すと顧客詳細を開く）', to: '顧客詳細' }], { align: 'right', parts: [btn('＋ 顧客を登録する', '顧客登録', 'primary')] }] } });
  await call('layout_screen', { design: '顧客管理', screen: '顧客登録', layout: { columns: 2, rows: [{ align: 'right', parts: [btn('登録する', '顧客詳細', 'primary'), btn('キャンセル', '顧客一覧')] }] } });
  await call('layout_screen', { design: '顧客管理', screen: '顧客詳細', layout: { columns: 4, rows: [
    ...[0, 4, 8].map((i) => SUBS.slice(i, i + 4).map(([to, label]) => btn(label, to))), { align: 'right', parts: [btn('一覧へ戻る', '顧客一覧')] }] } });
  for (const [name] of SUBS) {
    await call('layout_screen', { design: '顧客管理', screen: name, layout: { columns: 2, rows: [{ align: 'right', parts: [btn('登録する', '顧客詳細', 'primary'), btn('キャンセル', '顧客詳細')] }] } });
  }
  const LINE = [['申込一覧', [['＋ 申込を登録する', '申込登録']]], ['申込登録', [['確認へ進む', '内容確認'], ['キャンセル', '申込一覧']]],
    ['内容確認', [['申し込む', '審査'], ['修正する', '申込登録']]], ['審査', [['承認する', '結果通知'], ['差し戻す', '申込登録']]],
    ['結果通知', [['通知する', '完了']]], ['完了', [['一覧へ戻る', '申込一覧']]]];
  await call('create_design', { name: '申込受付', target: 'kintone' });
  await call('edit_screen', { design: '申込受付', ops: [{ op: 'update', screen: '画面 1', name: LINE[0][0] }] });
  for (const [name] of LINE.slice(1)) await call('add_screen', { design: '申込受付', name });
  for (const [name, bs] of LINE) {
    await call('layout_screen', { design: '申込受付', screen: name, layout: { columns: 2, rows: [{ align: 'right', parts: bs.map(([l, to], k) => btn(l, to, k ? 'normal' : 'primary')) }] } });
  }
  return { app, T };
}

test('wireOverlaps: 平行で間が 10 未満・並んで走る長さが 4 を超える 2 本の線を返す', async (t) => {
  const app = bootApp();
  t.after(() => app.close());
  const T = await app.api();
  assert.equal(T.WIRE_GAP_MIN, 10);
  const r = plain(T.wireOverlaps({ a: { wps: [[240, 73], [488, 73], [488, 172]] }, b: { wps: [[240, 51], [372, 51], [372, 72], [504, 72]] } }));
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].dir, r[0].gap, r[0].lap], ['h', 1, 116]);
  assert.deepEqual(plain(T.wireOverlaps({ a: { wps: [[0, 0], [100, 0]] }, b: { wps: [[0, 10], [100, 10]] } })), [], '間が 10 なら近づいていない');
  assert.deepEqual(plain(T.wireOverlaps({ a: { wps: [[0, 0], [100, 0]] }, b: { wps: [[96, 2], [200, 2]] } })), [], '並んで走る長さが 4 なら数えない');
  assert.deepEqual(plain(T.wireOverlaps({ a: { wps: [[0, 0], [100, 0]] }, b: { wps: [[50, -40], [50, 40]] } })), [], '交わる線は数えない');
});

test('画面遷移図（横向き・縦向き）: 見本の 2 つの画面設計で、平行に近づく線がない。列を飛ばすリンクの線は、間の画面へ入る線より手前で曲がる', async (t) => {
  const { T } = await bootSamples(t);
  for (const d0 of T.store.state.designs) {
    for (const v of [false, true]) {
      T.actions.setFlowVertical(d0.id, v);
      const d = T.store.state.designs.find((x) => x.id === d0.id);
      const routes = routesOf(T.viewHtml('flow', T.store.state, d, d.flowPos, { bare: true }));
      assert.ok(Object.keys(routes).length >= 6, `${d.name}: 線がある`);
      assert.deepEqual(plain(T.wireOverlaps(routes)), [], `${d.name}（${v ? '縦向き' : '横向き'}）`);
    }
  }
  // 顧客一覧 → 顧客詳細 のリンクの線（列を飛ばす）は、顧客一覧 → 顧客登録 のボタンの線が曲がる位置の 10 手前で曲がる（今までは顧客登録の手前まで並んで走っていた）
  const d = T.store.state.designs.find((x) => x.name === '顧客管理');
  T.actions.setFlowVertical(d.id, false);
  const key = (name) => 's:' + d.screens.find((s) => s.name === name).id;
  const routes = routesOf(T.viewHtml('flow', T.store.state, T.store.state.designs.find((x) => x.id === d.id), {}, { bare: true }));
  const link = routes[`${key('顧客一覧')}|${key('顧客詳細')}|link`].wps;
  const button = routes[`${key('顧客一覧')}|${key('顧客登録')}|button`].wps;
  assert.equal(Math.round((button[1][0] - link[1][0]) * 10) / 10, 10);
});

test('ステータスの流れ: 線の多い見本で、平行に近づく線がない（右を回る線は 22 ずつ離した通り道）', async (t) => {
  const app = bootApp();
  t.after(() => app.close());
  const T = await app.api();
  const S = Array.from({ length: 12 }, (_, i) => `ステータス${i + 1}`);
  const st = S.map((name, i) => ({ id: 's' + i, name }));
  const at = (name) => st.find((x) => x.name === name).id;
  const acts = S.slice(0, -1).map((s, i) => ['承認して次へ進める', s, S[i + 1]]);
  [2, 3, 4].forEach((i) => acts.push(['差し戻す', S[i], S[0]]));
  for (let i = 1; i <= 9; i++) acts.push(['取り下げる', S[i], S[11]]);
  acts.push(['見積を省略する', S[5], S[8]]);
  const d = { id: 'd-test', name: '試験用', items: [{ id: 'it-1', type: 'status', props: { states: st, actions: acts.map(([name, from, to], i) => ({ id: 'a' + i, name, from: at(from), to: at(to), role: '', cond: '' })) } }] };
  const routes = procRoutesOf(T.viewHtml('process', T.store.state, d));
  assert.ok(Object.keys(routes).length >= 12);
  assert.deepEqual(plain(T.wireOverlaps(routes)), []);
});
