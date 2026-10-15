'use strict';
// AI の窓口（第 7 段階）のテストで使う見本と道具。画面設計の名前は架空の業務（顧客管理など）だけを使う。

const screen = (id, name, parts = [], extra = {}) => ({ id, name, device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });
const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ipart = (id, x, y, no, itemId, type = 'text1') => ({ id, type, x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId });
const design = (id, name, target, extra = {}) => ({
  id, name, target, description: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: null,
  revisions: [], items: [], screens: [screen('s-' + id, '一覧')], mapPos: {}, ...extra,
});

// 顧客管理（項目 3 つ・画面 2 つ）と、顧客管理から項目を取り込んでいる受注管理、ごみ箱の出張申請
function sampleState() {
  return {
    schemaVersion: 2,
    settings: { customTargets: [], mapPos: {} },
    designs: [
      design('d1', '顧客管理', 'kintone', {
        description: '取引先と顧客の連絡先を管理する。',
        items: [
          item('i1', '顧客コード', 'text1', { required: true, props: { maxLen: '10', initial: '' } }),
          item('i2', '顧客名', 'text1', { props: { maxLen: '50', initial: '' } }),
          item('i3', '区分', 'dropdown', { props: { options: ['法人', '個人'], initial: '' } }),
        ],
        screens: [
          screen('s1', '新規登録', [ipart('p1', 32, 64, 1, 'i1'), ipart('p2', 32, 152, 2, 'i2'), ipart('p3', 400, 64, 3, 'i3', 'dropdown')], {
            callouts: [{ id: 'k1', x: 1300, y: 100, w: 200, h: 80, text: '顧客コードは自動で振る。', color: 'yellow', tip: 'arrow', target: 'p1' }],
          }),
          screen('s2', '一覧'),
        ],
      }),
      design('d2', '受注管理', 'kintone', {
        items: [item('o1', '顧客名', 'text1', { props: { maxLen: '50', initial: '' }, link: { designId: 'd1', itemId: 'i2', designName: '顧客管理', lost: false } })],
      }),
      design('d3', '出張申請', 'その他', { trashedAt: '2026-10-05T00:00:00.000Z' }),
    ],
  };
}

// ── 版 3 のシステム（第 9 段階）──
const OLD = '2026-10-01T00:00:00.000Z';
const NO_REF = { designId: null, screenId: null, stateId: null };
const swStep = (id, roleId, col, kind, text, ref = NO_REF, extra = {}) => ({ id, roleId, col, kind, text, memo: '', ref: { ...NO_REF, ...ref }, src: null, ...extra });
const swEdge = (id, from, to, label = '') => ({ id, from, to, label });
const system = (id, name, designIds, extra = {}) => ({
  id, name, description: '', createdAt: OLD, updatedAt: OLD, trashedAt: null, designIds, roles: [], swimlane: { steps: [], edges: [] },
  materials: [], notes: {}, revisions: [], ...extra,
});
// sampleState の画面設計（顧客管理にはステータスの項目を足す）に、システムを 3 つ足した版 3 の見本:
// 営業管理システム（顧客管理・受注管理。役割 2 つ・作業 3 つ・矢印 2 本）・請求管理システム（顧客管理を共通の画面設計として使う）・ごみ箱の古いシステム
function systemState() {
  const st = sampleState();
  st.schemaVersion = 3;
  st.designs[0].items.push(item('st', 'ステータス', 'status', { props: { states: [{ id: 't1', name: '申請' }, { id: 't2', name: '承認待ち' }], actions: [] } }));
  st.systems = [
    system('y1', '営業管理システム', ['d1', 'd2'], {
      description: '顧客の登録から受注までをまとめる。',
      roles: [{ id: 'l1', name: '営業', memo: '' }, { id: 'l2', name: '上長', memo: '課長以上' }],
      swimlane: {
        steps: [
          swStep('w1', 'l1', 0, 'start', '始まり'),
          swStep('w2', 'l1', 1, 'input', '顧客を登録する', { designId: 'd1', screenId: 's1', stateId: 't1' }),
          swStep('w3', 'l2', 2, 'decision', '確かめる', { designId: 'd1', screenId: 's2', stateId: 't2' }),
        ],
        edges: [swEdge('e1', 'w1', 'w2'), swEdge('e2', 'w2', 'w3')],
      },
      materials: [{ id: 'm1', name: '受注の流れ.txt', kind: 'text', size: 10, addedAt: OLD, memo: '', file: 'm1.txt' }],
      notes: { memo: '設計ノートのメモ' },
    }),
    system('y2', '請求管理システム', ['d1']),
    system('y3', '古いシステム', [], { trashedAt: '2026-10-05T00:00:00.000Z' }),
  ];
  return st;
}

const STORAGE_KEY = 'mockimagemaker.v1';
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

module.exports = { screen, item, ipart, design, sampleState, systemState, system, swStep, swEdge, NO_REF, OLD, STORAGE_KEY, plain, tick };
