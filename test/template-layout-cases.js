'use strict';
// ひな形の置き方の見本（test/fixtures/template-layout.json）を作る場面と、比べる形への直し方。
// 見本は、並べ方を 1 つの関数にまとめる前（第 7 段階の T3）のひな形で作った。直した後も同じ置き方になるかを test/layout.test.js で確かめる。

const { item } = require('./ai-fixtures');

const ITEM_SETS = {
  none: [],
  three: [item('a', '顧客コード', 'text1'), item('b', '顧客名', 'text1'), item('c', '電話番号', 'text1')],
  wide: [
    item('a', '氏名', 'text1'), item('b', '住所', 'text2'), item('c', '連絡方法', 'checkbox'), item('d', '年齢', 'number'),
    item('e', '生年月日', 'date'), item('f', '添付', 'file'), item('g', '区分', 'radio'),
  ],
  tables: [
    item('a', '件名', 'text1'),
    item('b', '明細', 'table', { props: { columns: [{ id: 'c1', name: '品名', type: 'text1', required: false, memo: '', props: {} }] } }),
    item('c', '経費', 'table', { props: { columns: [{ id: 'c2', name: '金額', type: 'number', required: false, memo: '', props: {} }] } }),
    item('d', '日付', 'date'),
  ],
  status: [item('a', '件名', 'text1'), item('b', 'ステータス', 'status', { props: { states: ['申請', '承認待ち', '承認済み', '完了'] } }), item('c', '種別', 'dropdown')],
};
const TEMPLATE_IDS = ['blank', 'input', 'detail', 'list', 'graph', 'agg', 'steps'];

// 足した画面と項目を、id を項目名に置き換えた比べる形にする（乱数の id は消す）
function layoutSnapshot(design, screen, itemsBefore) {
  const nameOf = (id) => {
    const it = design.items.find((x) => x.id === id);
    return it ? it.name : null;
  };
  const scrub = (v) => {
    if (Array.isArray(v)) return v.map(scrub);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'id') continue;
      out[k] = k === 'itemId' ? nameOf(x) : scrub(x);
    }
    return out;
  };
  return {
    height: screen.height,
    parts: screen.parts.map((p) => ({
      type: p.type, x: p.x, y: p.y, w: p.w, h: p.h, no: p.no, label: p.label == null ? null : p.label,
      tableKind: p.tableKind || null, item: p.itemId ? nameOf(p.itemId) : null, view: p.view || null,
      props: p.itemId ? null : scrub(p.props || null),
    })),
    newItems: design.items.slice(itemsBefore).map((it) => ({ name: it.name, type: it.type })),
  };
}

module.exports = { ITEM_SETS, TEMPLATE_IDS, layoutSnapshot };
