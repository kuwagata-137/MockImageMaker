'use strict';
// v1.05 段階 B: ステータスの流れの線と文字（画像 q170 の案A 本数・距離基準）。
// 線の文字は折り返して全部書く。右を回る線の文字は、線が出るボックスの右に書く。1 つのステータスに 4 本以上集まる線と、
// 間にほかのステータスが 5 個以上ある線は、線を描かずに行き先表示（「→ 8　S8」）にする。ステータスの名前は架空のものだけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

async function boot(t) {
  const app = bootApp({});
  t.after(() => app.close());
  const api = await app.api();
  return { app, api };
}
// ステータスの項目だけを持つ画面設計（viewHtml と processModel は items しか見ない）
function design(states, actions) {
  const st = states.map((name, i) => ({ id: 's' + i, name }));
  const at = (name) => st.find((s) => s.name === name).id;
  return { id: 'd-test', name: '試験用', items: [{ id: 'it-1', type: 'status', props: { states: st, actions: actions.map(([name, from, to, cond], i) => ({ id: 'a' + i, name, from: at(from), to: at(to), role: '', cond: cond || '' })) } }] };
}
function render(app, api, d) {
  const box = app.document.createElement('div');
  box.innerHTML = api.viewHtml('process', api.store.state, d);
  return box;
}
// 文字の幅の見積もり（アプリの wireTextW と同じ。半角 6.6・全角 12）
const textW = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 256 ? 6.6 : 12), 0);

test('線の文字は幅 192 で折り返して全部書き、切らない。右を回る線の文字は、線が出るボックスのすぐ右に書く', async (t) => {
  const { app, api } = await boot(t);
  const cond = '申請の内容に不備があり、申請者に書き直してほしいとき';
  const d = design(['受付', '確認待ち', '確認済み', '完了'], [['確かめる', '受付', '確認待ち', cond], ['承認する', '確認待ち', '確認済み'], ['完了にする', '確認済み', '完了'], ['差し戻す', '確認済み', '受付', cond]]);
  const box = render(app, api, d);
  const texts = [...box.querySelectorAll('svg text')].map((x) => x.textContent);
  assert.equal(texts.filter((s) => s.includes('…')).length, 0, '文字を「…」で切らない');
  assert.ok(texts.every((s) => textW(s) <= 192 + 1e-9), '1 行は幅 192 まで');
  // 条件の文が、折り返した行をつなぐと元の文に戻る（2 本の線の両方）
  const joined = texts.join('');
  assert.equal(joined.split(cond).length - 1, 2, '条件の文を全部書く');
  // 差し戻す（確認済み → 受付。間に確認待ちがあるので右を回る）の文字は、確認済みのボックスの右に書く
  const node = [...box.querySelectorAll('.mnode')].find((n) => n.textContent.includes('確認済み'));
  const [bx, by, bh] = [parseFloat(node.style.left), parseFloat(node.style.top), parseFloat(node.style.height)];
  const label = [...box.querySelectorAll('svg text')].find((x) => x.textContent === '差し戻す');
  const [lx, ly] = [Number(label.getAttribute('x')), Number(label.getAttribute('y'))];
  assert.ok(lx > bx + 200 && lx < bx + 200 + 30, '文字はボックスの右の縁のすぐ右');
  assert.ok(ly > by && ly < by + bh, '文字はボックスの高さの中');
});

test('行き先表示の基準: 4 本以上集まる線と、間に 5 個以上ある線は行き先表示。3 本・間が 4 個以下の線は線で描く。行き先表示を受けるボックスの右に来る元を書く', async (t) => {
  const { app, api } = await boot(t);
  const S = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  const forward = S.slice(0, -1).map((s, i) => ['進める', s, S[i + 1]]);
  const d = design(S, [
    ...forward,
    ['差し戻す', 'S3', 'S1'], ['差し戻す', 'S4', 'S1'], ['差し戻す', 'S5', 'S1'], // S1 に 3 本 → 線
    ['取り下げる', 'S2', 'S8'], ['取り下げる', 'S3', 'S8'], ['取り下げる', 'S4', 'S8'], ['取り下げる', 'S5', 'S8'], // S8 に 4 本 → 行き先表示
    ['飛ばす', 'S1', 'S7'], // 間に 5 個 → 行き先表示
    ['省く', 'S2', 'S6'], // 間に 3 個・S6 に 1 本 → 線
  ]);
  const box = render(app, api, d);
  const tags = [...box.querySelectorAll('svg rect.proc-tag')];
  assert.equal(tags.length, 5, '行き先表示は 5 つ');
  const texts = [...box.querySelectorAll('svg text')].map((x) => x.textContent);
  assert.equal(texts.filter((s) => s === '→ 8　S8').length, 4);
  assert.equal(texts.filter((s) => s === '→ 7　S7').length, 1);
  assert.ok(texts.join('').includes('← ステータス 2〜5（4 個）から「取り下げる」'), 'S8 の右に、来る元をまとめて書く（幅を超える行は折り返す）');
  assert.ok(texts.join('').includes('← ステータス 1　S1 から「飛ばす」'), '来る元が 1 つなら、番号と名前を書く');
  // 線: 隣への 7 本 ＋ 右を回る 4 本（S1 への 3 本・S2 → S6）
  assert.equal(box.querySelectorAll('svg path[marker-end]').length, 11);
});

test('文字どうしは重ならない（購買申請に似た、線の多い見本）', async (t) => {
  const { app, api } = await boot(t);
  const S = Array.from({ length: 12 }, (_, i) => `ステータス${i + 1}`);
  const acts = S.slice(0, -1).map((s, i) => ['承認して次へ進める', s, S[i + 1], i % 3 ? '' : '金額が 10 万円以上で、部長の確認が要るとき']);
  [2, 3, 4].forEach((i) => acts.push(['差し戻す', S[i], S[0], '申請の内容を書き直してほしいとき']));
  for (let i = 1; i <= 9; i++) acts.push(['取り下げる', S[i], S[11], i % 2 ? '購買をやめるとき（理由を備考に書く）' : '']);
  acts.push(['見積を省略する', S[5], S[8], '合計金額が 10 万円未満のとき']);
  const box = render(app, api, design(S, acts));
  const rects = [...box.querySelectorAll('svg text')].map((x) => {
    const fs = Number(x.getAttribute('font-size'));
    return { s: x.textContent, x: Number(x.getAttribute('x')), y: Number(x.getAttribute('y')) - fs + 2, w: textW(x.textContent) * (fs / 12), h: fs };
  });
  const hits = [];
  rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.s} ／ ${b.s}`);
  }));
  assert.deepEqual(hits, []);
  // 文字はボックスと重ならない
  const boxes = [...box.querySelectorAll('.mnode')].map((n) => ({ x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: 200, h: parseFloat(n.style.height) }));
  const onBox = rects.filter((a) => boxes.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)).map((a) => a.s);
  assert.deepEqual(onBox, []);
});
