// tools/shoot-app.js の見た目の場面（--only=looks。場面 171〜182）。第 12 段階（画像 q105〜q108 のとおりか）を撮る。
// 見本は架空の業務（問い合わせ管理）。画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、右の欄と新しい画面設計の窓は編集の画面で撮る。
'use strict';

const path = require('path');

const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ip = (id, itemId, type, x, y, no, sample = '', extra = {}) => ({ id, type, x, y, w: 400, h: 64, no, labelPos: 'top', sample, placeholder: '', itemId, ...extra });
// 項目を指さない部品。props は書いた欄だけ（ほかの欄は読み込むときに最初の値で埋まる）
const op = (id, type, x, y, w, h, no, label, props = {}, extra = {}) => ({ id, type, x, y, w, h, no, labelPos: 'top', sample: '', placeholder: '', label, required: false, memo: '', props, ...extra });
const sc = (id, name, height, parts, extra = {}) => ({ id, name, device: 'pc', width: 1280, height, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });

// 標準の見た目の位置で組み立てる（Salesforce・kintone の見た目には、アプリの見た目の切り替えでずらす）
function sampleState() {
  const items = [
    item('i_no', '問い合わせ番号', 'text1'),
    item('i_sub', '件名', 'text1', { required: true }),
    item('i_cust', '顧客名', 'text1', { required: true }),
    item('i_tel', '電話', 'text1'),
    item('i_pri', '優先度', 'dropdown', { props: { options: ['高', '中', '低'], initial: '中' } }),
    item('i_src', '発生源', 'dropdown', { props: { options: ['電話', 'Web', 'メール'], initial: '' } }),
    item('i_date', '受付日', 'date', { props: { initial: 'today', initialDate: '' } }),
    item('i_user', '担当者', 'user', { props: { scope: '受付の担当', multiple: false, initial: 'me' } }),
    item('i_way', '連絡方法', 'radio', { props: { options: ['電話', 'メール'], initial: '電話', dir: 'h' } }),
    item('i_kind', '対応の種類', 'checkbox', { props: { options: ['修理', '点検', '説明'], initial: [], dir: 'h' } }),
    item('i_desc', '説明', 'text2'),
    item('i_file', '添付ファイル', 'file'),
    item('st', '状況', 'status', { props: { states: [{ id: 't1', name: '新規' }, { id: 't2', name: '対応中' }, { id: 't3', name: 'エスカレーション' }, { id: 't4', name: '顧客待ち' }, { id: 't5', name: 'クローズ' }], actions: [] } }),
  ];
  const cols = (ids) => ids.map((itemId, i) => ({ id: 'c' + i, ref: { itemId, name: items.find((x) => x.id === itemId).name } }));
  const table = (id, x, y, w, h, no, label, ids, samples, rows) => op(id, 'table', x, y, w, h, no, label, { columns: cols(ids), sort: '受付日の新しい順' },
    { tableKind: 'records', view: { rows, samples: Object.fromEntries(samples.map((s, i) => ['c' + i, s])), widths: {} } });
  const list = sc('s_list', '問い合わせの一覧', 800, [
    op('l1', 'search', 32, 64, 320, 40, 1, '検索の欄', { button: true }),
    op('l2', 'filter', 384, 64, 480, 40, 2, '絞り込みの欄'),
    op('l3', 'button', 1120, 64, 128, 40, 3, '＋ 新規', { style: 'primary' }),
    table('l4', 32, 128, 1216, 248, 4, '問い合わせの一覧', ['i_no', 'i_sub', 'i_cust', 'i_pri', 'i_date'],
      [['00002934', '00002933', '00002931', '00002930', '00002928'], ['エアコンが冷えない', '請求書の再発行', '点検の日の変更', '部品の取り寄せ', '引っ越しの手続き'],
        ['山田 太郎', '鈴木 一郎', '高橋 花子', '田中 次郎', '伊藤 三郎'], ['高', '低', '中', '高', '中'], ['2026-10-20', '2026-10-20', '2026-10-19', '2026-10-19', '2026-10-18']], 5),
    op('l5', 'pager', 32, 384, 360, 32, 5, 'ページ送り', { perPage: '20', total: '128', showCount: true }),
    op('l6', 'graph', 32, 448, 584, 320, 6, '優先度ごとの件数', { chart: 'bar', samples: '高, 5\n中, 12\n低, 7', unit: '件' }),
    op('l7', 'graph', 664, 448, 584, 320, 7, '発生源の割合', { chart: 'pie', samples: '電話, 20\nWeb, 9\nメール, 6' }),
  ]);
  const input = sc('s_input', '問い合わせの入力', 800, [
    ip('n1', 'i_sub', 'text1', 32, 64, 1, '', { w: 848 }),
    ip('n2', 'i_cust', 'text1', 32, 144, 2), ip('n3', 'i_tel', 'text1', 480, 144, 3),
    ip('n4', 'i_pri', 'dropdown', 32, 224, 4), ip('n5', 'i_src', 'dropdown', 480, 224, 5),
    ip('n6', 'i_date', 'date', 32, 304, 6, '', { w: 200 }), ip('n7', 'i_user', 'user', 480, 304, 7),
    ip('n8', 'i_way', 'radio', 32, 384, 8), ip('n9', 'i_kind', 'checkbox', 480, 384, 9),
    ip('n10', 'i_desc', 'text2', 32, 464, 10, '', { w: 848, h: 120 }),
    ip('n11', 'i_file', 'file', 32, 608, 11, '', { h: 96 }),
    op('n12', 'button', 32, 736, 96, 40, 12, '保存', { style: 'primary' }),
    op('n13', 'button', 144, 736, 112, 40, 13, 'キャンセル', { style: 'normal' }),
  ]);
  const detail = sc('s_detail', '問い合わせの詳細', 1000, [
    ip('d1', 'st', 'steps', 32, 64, 1, '', { w: 1216, h: 40, view: { current: 't2', showWord: true } }),
    op('d2', 'tabs', 32, 120, 480, 40, 2, 'タブ', { tabs: ['詳細', '関連', '活動'], current: '詳細' }),
    op('d3', 'heading', 32, 176, 1216, 32, null, '問い合わせの情報'),
    ip('d4', 'i_no', 'text1', 32, 224, 3, '00002934'), ip('d5', 'st', 'status', 480, 240, 4, '', { w: 400, h: 32, view: { current: 't2', showWord: true } }),
    ip('d6', 'i_sub', 'text1', 32, 304, 5, 'エアコンが冷えない'), ip('d7', 'i_pri', 'dropdown', 480, 304, 6, '高'),
    ip('d8', 'i_cust', 'text1', 32, 384, 7, '山田 太郎'), ip('d9', 'i_src', 'dropdown', 480, 384, 8, '電話'),
    ip('d10', 'i_tel', 'text1', 32, 464, 9, '03-1234-5678'), ip('d11', 'i_date', 'date', 480, 464, 10, '2026-10-20'),
    ip('d12', 'i_user', 'user', 32, 544, 11, '佐藤 花子'), ip('d13', 'i_way', 'radio', 480, 544, 12),
    ip('d14', 'i_desc', 'text2', 32, 624, 13, '冷房が効かないとの電話。リモコンにエラーの番号 E-11 が出ている。', { w: 848, h: 104 }),
    op('d15', 'heading', 32, 752, 1216, 32, null, 'この顧客のほかの問い合わせ'),
    table('d16', 32, 800, 848, 136, 14, 'この顧客のほかの問い合わせ', ['i_no', 'i_sub', 'i_date'], [['00002811', '00002702'], ['リモコンの交換', '点検の日の相談'], ['2026-09-02', '2026-07-15']], 2),
    op('d17', 'button', 32, 952, 96, 40, 15, '編集', { style: 'primary' }),
    op('d18', 'button', 144, 952, 96, 40, 16, '削除', { style: 'normal' }),
  ], { itemView: 'show' });
  const d = {
    id: 'dm', name: '問い合わせ管理', target: 'salesforce', look: 'standard', description: '架空の会社の問い合わせを受けて対応する。',
    createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', trashedAt: null, revisions: [], items, screens: [list, input, detail], mapPos: {},
  };
  return { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [d] };
}

module.exports = async function shootLooks(browser, { ROOT, shot, openApp, OUT, VERSION }) {
  const page = await openApp(browser, sampleState());
  // 画面ごとに、PNG の出力と同じ HTML を別のページで開いて撮る
  const shootScreens = async (look, label) => {
    await page.evaluate((lk) => {
      const T = window.__test__;
      T.actions.updateDesignInfo('dm', lk === 'salesforce' ? { look: lk, bandTabs: ['ホーム', '問い合わせ管理', '顧客', 'ナレッジ', 'レポート'] } : { look: lk });
    }, look);
    const docs = await page.evaluate(() => {
      const T = window.__test__;
      const d = T.store.state.designs.find((x) => x.id === 'dm');
      return T.exportPngDocs(d, T.store.state, null, null, { table: false, callouts: false }).map((x) => ({ html: x.html, width: x.width, height: x.height }));
    });
    const doc = await browser.newPage();
    for (const [i, name] of ['一覧', '入力', '詳細_表示の形'].entries()) {
      await doc.setViewport({ width: docs[i].width, height: docs[i].height });
      await doc.setContent(docs[i].html, { waitUntil: 'load' });
      const file = path.join(OUT, `v${VERSION}_${label[i]}_${name}.png`);
      await doc.screenshot({ path: file });
      console.log('saved', path.relative(ROOT, file));
    }
    await doc.close();
  };
  await shootScreens('salesforce', ['171_見た目_Salesforce', '172_見た目_Salesforce', '173_見た目_Salesforce']);
  await shootScreens('kintone', ['174_見た目_kintone', '175_見た目_kintone', '176_見た目_kintone']);
  await shootScreens('standard', ['177_見た目_標準', '178_見た目_標準', '179_見た目_標準']);

  // 右の欄（見た目・帯のタブ・項目の出し方）。Salesforce の見た目の詳細の画面を開く
  await page.evaluate(() => {
    const T = window.__test__;
    T.actions.updateDesignInfo('dm', { look: 'salesforce' });
    T.openDesign('dm');
    T.openScreen('s_detail');
  });
  await page.setViewport({ width: 1400, height: 1000 });
  await shot(page, '180_見た目_右の欄_Salesforce');
  // 新しい画面設計の窓（作る先 kintone → 見た目 kintone。作る先を Salesforce にすると見た目も Salesforce）
  await page.click('[data-action="home"]');
  await page.click('[data-action="new"]');
  await page.waitForSelector('.modal [name=new-look]');
  await page.type('.modal [name=name]', '顧客管理');
  await shot(page, '181_見た目_新しい画面設計の窓');
  await page.select('.modal .target-select', 'b:salesforce');
  await shot(page, '182_見た目_新しい画面設計の窓_作る先をSalesforceにした');
  await page.close();
};
