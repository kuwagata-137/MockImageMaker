// tools/shoot-app.js の kintone の準備の場面（--only=kintone。場面 183〜192）。第 13 段階（画像 q111〜q114 のとおりか）を撮る。
// 見本は架空の業務（備品の貸し出し）。画面は PNG の出力と同じ HTML（exportPngDocs）で撮り、右の欄と「AI とつなぐ」の窓は編集の画面で撮る。
// AI の並べ方（ボタン・吹き出し・4 列）は、テスト用の窓口の aiDispatch で頼んで置く。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { connectInfo } = require('../automation-connect');

const item = (id, name, type, extra = {}) => ({ id, name, type, required: false, memo: '', props: {}, lookup: null, link: null, ...extra });
const ip = (id, itemId, type, x, y, no, sample = '', extra = {}) => ({ id, type, x, y, w: 400, h: 64, no, labelPos: 'top', sample, placeholder: '', itemId, ...extra });
const op = (id, type, x, y, w, h, no, label, props = {}) => ({ id, type, x, y, w, h, no, labelPos: 'top', sample: '', placeholder: '', label, required: false, memo: '', props });
const sc = (id, name, height, parts, extra = {}) => ({ id, name, device: 'pc', width: 1280, height, showHeader: true, tablePos: 'right', parts, callouts: [], ...extra });

// インストールした版の場所（架空のユーザー名）で作った登録の文（tools/shoot-app-ai.js と同じ）
const CONNECT = connectInfo({
  packaged: true,
  execPath: 'C:\\Users\\user\\AppData\\Local\\Programs\\mockimagemaker\\MockImageMaker.exe',
  resourcesPath: 'C:\\Users\\user\\AppData\\Local\\Programs\\mockimagemaker\\resources',
});

// 標準の見た目の位置で組み立てる（kintone の見た目には、アプリの見た目の切り替えでずらす）
function sampleState() {
  const items = [
    item('i_no', '貸出番号', 'text1', { kintone: { type: 'RECORD_NUMBER', code: '貸出番号' } }),
    item('i_at', '申請日時', 'datetime', { kintone: { type: 'CREATED_TIME' } }),
    item('i_by', '申請者', 'user', { kintone: { type: 'CREATOR' } }),
    item('i_org', '所属', 'user', { kintone: { type: 'ORGANIZATION_SELECT', code: '所属' } }),
    item('i_name', '備品名', 'dropdown', { required: true, props: { options: ['ノートパソコン', 'プロジェクター', 'カメラ'], initial: '' }, kintone: { code: 'item_name' } }),
    item('i_due', '返却予定日', 'date', { required: true }),
    item('i_qty', '数量', 'number', { required: true }),
    item('i_price', '単価', 'number', { props: { unit: '円' } }),
    item('i_sum', '金額', 'calc', { props: { formula: '数量 × 単価', unit: '円' }, kintone: { formula: '数量 * 単価' } }),
    item('i_use', '用途', 'text2'),
    item('st', '状況', 'status', {
      props: {
        states: [{ id: 't1', name: '申請' }, { id: 't2', name: '承認待ち' }, { id: 't3', name: '貸出中' }, { id: 't4', name: '返却済み' }, { id: 't5', name: '却下' }],
        actions: [
          { id: 'a1', name: '申請する', from: 't1', to: 't2', role: '申請者', cond: '' },
          { id: 'a2', name: '承認する', from: 't2', to: 't3', role: '上長', cond: '' },
          { id: 'a3', name: '返却する', from: 't3', to: 't4', role: '申請者', cond: '' },
          { id: 'a4', name: '却下する', from: 't2', to: 't5', role: '上長', cond: '' },
        ],
      },
    }),
  ];
  // 入力の形と表示の形で同じ並べ方（表示の形は見本の値を入れる）
  const form = (p, show) => [
    ip(p + '1', 'st', 'steps', 32, 64, 1, '', { w: 1216, h: 40, view: { current: 't2', showWord: true } }),
    ip(p + '2', 'i_no', 'text1', 32, 128, 2, show ? '1024' : ''), ip(p + '3', 'i_at', 'datetime', 480, 128, 3, show ? '2026-10-26 09:30' : ''),
    ip(p + '4', 'i_by', 'user', 32, 208, 4, show ? '佐藤 花子' : ''), ip(p + '5', 'i_org', 'user', 480, 208, 5, show ? '総務部' : ''),
    ip(p + '6', 'i_name', 'dropdown', 32, 288, 6, show ? 'プロジェクター' : ''), ip(p + '7', 'i_due', 'date', 480, 288, 7, show ? '2026-10-30' : '', { w: 200 }),
    ip(p + '8', 'i_qty', 'number', 32, 368, 8, show ? '1' : '', { w: 200 }), ip(p + '9', 'i_price', 'number', 480, 368, 9, show ? '3000' : '', { w: 200 }),
    ip(p + '10', 'i_sum', 'calc', 32, 448, 10, show ? '3000' : '', { w: 200 }),
    ip(p + '11', 'i_use', 'text2', 32, 528, 11, show ? '会議室での説明会に使う。' : '', { w: 848, h: 120 }),
    ...(show ? [] : [op(p + '12', 'button', 32, 680, 112, 40, 12, '申請する', { style: 'primary' }), op(p + '13', 'button', 160, 680, 112, 40, 13, 'キャンセル', { style: 'normal' })]),
  ];
  const d = {
    id: 'dk', name: '備品の貸し出し', target: 'kintone', look: 'standard', description: '架空の会社で、備品を借りる申請と承認をする。',
    createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', trashedAt: null, revisions: [], items, mapPos: {},
    screens: [
      sc('s_input', '貸し出しの申請', 760, form('n', false)),
      sc('s_detail', '貸し出しの詳細', 680, form('v', true), { itemView: 'show' }),
      sc('s_steps', '進み具合の矢印', 136, [ip('w1', 'st', 'steps', 32, 64, 1, '', { w: 1216, h: 40, view: { current: 't5', showWord: true } })]),
      sc('s_ai', 'AI が並べた画面', 800, []),
      sc('s_grid', 'AI が 4 列で並べた画面', 800, []),
    ],
  };
  return { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [d] };
}

async function openKintoneApp(browser, { ROOT, HTML_NAME }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.evaluateOnNewDocument((data, info) => {
    window.__test__ = {};
    window.aiAPI = {
      onRequest() {},
      ready() {},
      onStatus(cb) { setTimeout(() => cb({ clients: [{ session: 's-1', client: 'claude-code' }] }), 0); },
      connectInfo: async () => info,
      copyText: async () => true,
    };
    localStorage.clear();
    localStorage.setItem('mockimagemaker.v1', data);
  }, JSON.stringify(sampleState()), CONNECT);
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  return page;
}
const ai = async (page, tool, args) => {
  const r = await page.evaluate((t, a) => window.__test__.aiDispatch(t, a, { session: 's-1', client: 'claude-code' }), tool, args);
  if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
  return r.result;
};

module.exports = async function shootKintone(browser, env) {
  const { ROOT, shot, OUT, VERSION } = env;
  const page = await openKintoneApp(browser, env);
  const setLook = (look) => page.evaluate((lk) => window.__test__.actions.updateDesignInfo('dk', { look: lk }), look);
  const setCurrent = (stateId) => page.evaluate((id) => window.__test__.actions.updatePart('dk', 's_steps', 'w1', { view: { current: id } }), stateId);
  // 画面を PNG の出力と同じ HTML で開いて撮る
  const shootScreen = async (screenId, name, opts = { table: false, callouts: false }, clipH = 0) => {
    const doc = await page.evaluate((id, o) => {
      const T = window.__test__;
      const d = T.store.state.designs.find((x) => x.id === 'dk');
      const x = T.exportPngDocs(d, T.store.state, [id], null, o)[0];
      return { html: x.html, width: x.width, height: x.height };
    }, screenId, opts);
    const p = await browser.newPage();
    await p.setViewport({ width: doc.width, height: doc.height });
    await p.setContent(doc.html, { waitUntil: 'load' });
    const file = path.join(OUT, `v${VERSION}_${name}.png`);
    await p.screenshot({ path: file, ...(clipH ? { clip: { x: 0, y: 0, width: doc.width, height: clipH } } : {}) });
    console.log('saved', path.relative(ROOT, file));
    await p.close();
  };
  const STEPS_CLIP = 220; // 進み具合の矢印は、帯と矢印の所だけを切り取る（画面の最小の高さで下が空くため）

  // 183: 右の欄の「kintone のフィールド」（自動計算の値の「金額」を選ぶと、kintone の計算式の欄も出る）
  await setLook('kintone');
  await page.evaluate(() => {
    const T = window.__test__;
    T.openDesign('dk');
    T.openScreen('s_input');
    T.selectPart('n10');
    // 右の欄の「kintone のフィールド」の組を、欄の上の方へ送って見えるようにする
    // （scrollIntoView はページ全体も動かすので、送れる親の欄だけを送る）
    const sep = [...document.querySelectorAll('.pf-sep')].find((x) => x.textContent.includes('kintone のフィールド'));
    let box = sep && sep.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (box) box.scrollTop += sep.getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
  });
  await shot(page, '183_kintone_右の欄_kintoneのフィールド');
  await page.evaluate(() => window.__test__.goHome());

  // 184・185: kintone の種類で描いた入力の形と、表示の形
  await shootScreen('s_input', '184_kintone_kintoneの種類で描いた入力の形');
  await shootScreen('s_detail', '185_kintone_kintoneの種類で描いた表示の形');

  // 186〜189: 進み具合の矢印の分かれる終わり（却下）。標準の見た目は見本が「承認待ち」と「却下」、Salesforce・kintone の見た目は「却下」
  await setLook('standard');
  await setCurrent('t2');
  const noTable = { table: false, callouts: false };
  await shootScreen('s_steps', '186_kintone_進み具合の矢印_分かれる終わり_標準_見本が承認待ち', noTable, STEPS_CLIP - 48); // 標準の帯は 48 ドット低い
  await setCurrent('t5');
  await shootScreen('s_steps', '187_kintone_進み具合の矢印_分かれる終わり_標準_見本が却下', noTable, STEPS_CLIP - 48);
  await setLook('salesforce');
  await shootScreen('s_steps', '188_kintone_進み具合の矢印_分かれる終わり_Salesforce_見本が却下', noTable, STEPS_CLIP);
  await setLook('kintone');
  await shootScreen('s_steps', '189_kintone_進み具合の矢印_分かれる終わり_kintone_見本が却下', noTable, STEPS_CLIP);

  // 190: AI が並べたボタン（幅は文字に合わせ、style を書かないと行の最初だけ青）と、場所を書かずに置いた吹き出し（左半分の部品は左の外）
  const laid = await ai(page, 'layout_screen', { design: 'dk', screen: 's_ai', layout: { columns: 2, rows: [
    [{ item: '備品名' }, { item: '数量' }],
    [{ item: '用途', span: 2 }],
    { align: 'right', parts: [{ type: 'button', label: '申請する' }, { type: 'button', label: '下書きとして保存する' }, { type: 'button', label: 'キャンセル' }] },
  ] } });
  const no = (label) => laid.parts.find((p) => p.label === label).no;
  await ai(page, 'edit_callouts', { design: 'dk', screen: 's_ai', ops: [
    { op: 'add', text: '一覧から選ぶ。貸し出し中の備品は出さない。', target: no('備品名') },
    { op: 'add', text: '押すと、入力した内容を消して一覧に戻る。', target: no('キャンセル') },
  ] });
  await shootScreen('s_ai', '190_kintone_AIが並べたボタンと置いた吹き出し', { table: false, callouts: true });

  // 191: AI が 4 列で並べた画面（span: 4 で 4 列の幅いっぱい）
  await ai(page, 'layout_screen', { design: 'dk', screen: 's_grid', layout: { columns: 4, rows: [
    [{ item: '貸出番号' }, { item: '申請日時' }, { item: '申請者' }, { item: '所属' }],
    [{ item: '備品名' }, { item: '返却予定日' }, { item: '数量' }, { item: '単価' }],
    [{ item: '金額' }],
    [{ item: '用途', span: 4 }],
  ] } });
  await shootScreen('s_grid', '191_kintone_AIが4列で並べた画面');

  // 192: 「AI とつなぐ」の窓（Claude のデスクトップアプリは、登録した後に終了して起動し直す）
  await page.evaluate(() => window.__test__.runCommand('aiConnect'));
  await page.waitForSelector('.modal .aic-code');
  await shot(page, '192_kintone_AIとつなぐの窓');
  await page.close();
};
