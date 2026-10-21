'use strict';
// システムの説明書（PDF。第 10 段階の後半）のテストで使う見本。架空の業務（出張申請システム・経費精算システム）だけを使う。
// 出張申請（一覧・詳細。ステータスと操作・移る先）と経費精算（出張申請をルックアップ）を AI の道具で作り、
// 出張申請システム（役割 3 つ・作業 7 つ・設計ノートの行）と、経費精算だけが入った経費精算システム、出張申請が入ったごみ箱のシステムを作る

const { bootApp } = require('./harness');

const AT = '2026-10-20T00:00:00.000Z';
// 説明書の全部のページ（窓・exportSystemDocument の opts・AI の入力で同じ名前）
const ALL = { paper: 'A4', orient: 'landscape', systemCover: true, swimlane: true, notes: true, cover: true, map: true, items: true, process: true, flow: true };
// 画面設計を 1 つ出力するときの全部のページ
const PER = { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true };
// ⑤（説明書と出力）の決めたことに AI が書く、出力したファイルの場所（説明書の PDF に入れない）
const DOCS_PATH = 'D:\\共有\\モックイメージメーカー\\AI の出力\\出張申請システム_説明書.pdf';

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

// 出張申請システムを作り、その id を返す。steps: false で作業の箱を作らない、notes: false で設計ノートの行を書かない
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

// 見本を作ったアプリを起動する。opts: { steps, notes }（buildSystems へ）・exportAPI（出力の窓口の身代わり）
async function bootSystemDoc(t, { exportAPI = null, ...opts } = {}) {
  const app = bootApp({ exportAPI });
  t.after(() => app.close());
  const api = await app.api();
  await buildDesigns(api);
  const sysId = buildSystems(api, opts);
  const y = () => api.store.state.systems.find((x) => x.id === sysId);
  const d = (n) => api.store.state.designs.find((x) => x.name === n);
  const parse = (html) => new app.window.DOMParser().parseFromString(html, 'text/html');
  return { app, api, sysId, y, d, parse };
}

module.exports = { AT, ALL, PER, DOCS_PATH, buildDesigns, buildSystems, bootSystemDoc };
