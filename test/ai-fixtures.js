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

const STORAGE_KEY = 'mockimagemaker.v1';
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

module.exports = { screen, item, ipart, design, sampleState, STORAGE_KEY, plain, tick };
