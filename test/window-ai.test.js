'use strict';
// AI のツールの第 16 段階の分（小さなウィンドウ・お客さまポータル・ポータル画面用のアイテム 4 つ・ひな形 3 つ）のテスト。
// get_catalog・edit_screen の overlay・headerKind・portalMenu・update_design の portal・add_screen のひな形・layout_screen のウィンドウの中への並べ方と
// 幅いっぱいの大きな画像と検索欄・get_design と get_screen の返事・get_kintone_app・手引き（mcp-guide.js）。画面設計の名前は架空の業務（問い合わせ管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');
const { screen, item, design, STORAGE_KEY, plain } = require('./ai-fixtures');
const { layout: layoutSchema, S } = require('../mcp-schemas');

const field = (id, x, y, no) => ({ id, type: 'text1', x, y, w: 320, h: 64, no, labelPos: 'top', sample: '', placeholder: '', itemId: 'i1' });
// 問い合わせ管理（項目 1 つ・画面 3 つ。「問い合わせの詳細」にテキスト（1行）が 1 つ）
function state() {
  return { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [],
    designs: [design('d1', '問い合わせ管理', 'kintone', { items: [item('i1', '件名', 'text1')],
      screens: [screen('s1', '問い合わせの詳細', [field('p1', 32, 64, 1)]), screen('s2', '承認申請'), screen('s3', 'トップ')] })] };
}
async function boot() {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(state()) } });
  const T = await app.api();
  const send = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const call = async (tool, args = {}) => {
    const r = await send(tool, args);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.result;
  };
  const refuse = async (tool, args, re) => {
    const r = await send(tool, args);
    assert.equal(r.ok, false, `${tool} は断るはず`);
    assert.match(r.error.message, re);
  };
  const sc = (sid) => plain(T.store.state.designs[0].screens.find((s) => s.id === sid));
  const screenOp = (op) => call('edit_screen', { design: 'd1', ops: [{ op: 'update', ...op }] });
  return { app, T, send, call, refuse, sc, screenOp };
}
const valid = (schema, v, what) => {
  const r = schema.safeParse(v);
  assert.ok(r.success, `${what}: ${JSON.stringify(r.error && r.error.issues.slice(0, 3))}`);
};
function guideExample(text, heading) {
  const block = text.split(heading)[1];
  assert.ok(block, `${heading} の節がある`);
  return JSON.parse(block.slice(block.indexOf('{'), block.indexOf('\n}') + 2));
}

test('get_catalog: ポータル画面用のアイテム 4 つ（組・props）・ひな形 3 つ（新しい画面の名前）・ヘッダーの形・小さなウィンドウの数', async () => {
  const { app, call } = await boot();
  const c = await call('get_catalog');
  const by = Object.fromEntries(c.parts.map((p) => [p.type, p]));
  assert.deepEqual(['hero', 'tileMenu', 'articles', 'chat'].map((k) => [by[k].name, by[k].group, by[k].item]),
    [['大きな画像と検索欄', 'ポータル画面用', null], ['タイル', 'ポータル画面用', null], ['記事の一覧', 'ポータル画面用', null], ['チャット', 'ポータル画面用', null]]);
  assert.deepEqual(Object.keys(by.hero.props).sort(), ['ph', 'search', 'sub', 'title']);
  assert.deepEqual(Object.keys(by.articles.props).sort(), ['desc', 'more', 'rows']);
  assert.deepEqual(Object.keys(by.chat.props).sort(), ['head', 'lines', 'me', 'ph']);
  assert.deepEqual(c.templates.slice(-3).map((t) => [t.id, t.screenName]), [['winApproval', '承認申請'], ['portalTop', 'ホーム'], ['winChat', 'AI のアシスタント']]);
  assert.equal(c.templates[0].screenName, undefined, 'ひな形の名前と同じ画面の名前のひな形には書かない');
  assert.deepEqual(c.headerKinds, [{ id: 'app', name: 'アプリ', bandHeight: null, firstRowY: null }, { id: 'portal', name: 'お客さまポータル', bandHeight: 72, firstRowY: 96 }]);
  assert.deepEqual(c.window, { positions: { center: '真ん中', bottomRight: '右下', right: '右の端' }, headHeight: 56, footHeight: 64, size: { w: 640, h: 432 },
    minSize: { w: 240, h: 160 }, edge: 24, room: 32, firstRowGap: 24, footPadding: 24, footGap: 16 });
  app.close();
});

test('edit_screen: overlay で小さなウィンドウにする（下に重ねる画面は名前で書ける）・位置と大きさを変える・null でふつうの画面に戻す。get_screen と get_design が overlay を返す', async () => {
  const { app, call, sc, screenOp } = await boot();
  const r = await screenOp({ screen: '承認申請', overlay: { under: '問い合わせの詳細' } });
  assert.deepEqual(r.screens[0].overlay, { under: '問い合わせの詳細', underId: 's1', pos: 'center', width: 640, height: 432, foot: true, x: 320, y: 184 });
  assert.equal(sc('s2').overlay.under, 's1');
  const r2 = await screenOp({ screen: 's2', overlay: { pos: 'bottomRight', width: 400, height: 560, foot: false } });
  assert.deepEqual(r2.screens[0].overlay, { under: '問い合わせの詳細', underId: 's1', pos: 'bottomRight', width: 400, height: 560, foot: false, x: 856, y: 216 });
  const g = await call('get_screen', { design: 'd1', screen: 's2' });
  assert.deepEqual([g.overlay.under, g.overlay.pos], ['問い合わせの詳細', 'bottomRight']);
  const d = await call('get_design', { design: 'd1' });
  assert.deepEqual(d.screens.map((s) => (s.overlay ? s.overlay.under : null)), [null, '問い合わせの詳細', null]);
  // 範囲の外の大きさは直して知らせる
  const r3 = await call('edit_screen', { design: 'd1', ops: [{ op: 'update', screen: 's2', overlay: { width: 5000 } }] });
  assert.equal(r3.screens[0].overlay.width, 1248);
  assert.match(r3.warnings[0], /ウィンドウの幅は 240〜（画面の幅−32）なので、1248 にしました/);
  await screenOp({ screen: 's2', overlay: null });
  assert.equal(sc('s2').overlay, undefined, 'null でふつうの画面に戻す');
  app.close();
});

test('edit_screen: 選べない下の画面・小さなウィンドウの画面の device と headerKind・ポータルでない画面の portalMenu・知らない欄は断る', async () => {
  const { app, refuse, screenOp } = await boot();
  const up = (op) => ({ design: 'd1', ops: [{ op: 'update', ...op }] });
  await refuse('edit_screen', up({ screen: 's2', overlay: { under: 's2' } }), /自分の画面は、下に重ねる画面にできません/);
  await refuse('edit_screen', up({ screen: 's2', overlay: { under: 'ない画面' } }), /ない画面/);
  await refuse('edit_screen', up({ screen: 's2', overlay: { pos: 'center' } }), /overlay\.under に下に重ねる画面/);
  await screenOp({ screen: 's2', overlay: { under: 's1' } });
  await refuse('edit_screen', up({ screen: 's3', overlay: { under: 's2' } }), /「承認申請」は小さなウィンドウの画面なので、下に重ねる画面にできません/);
  await refuse('edit_screen', up({ screen: 's1', overlay: { under: 's3' } }), /この画面は「承認申請」の下に重ねられているので、小さなウィンドウにできません/);
  await refuse('edit_screen', up({ screen: 's2', device: 'phone' }), /小さなウィンドウの画面の機器は、下に重ねる画面（「問い合わせの詳細」）と同じです/);
  await refuse('edit_screen', up({ screen: 's2', headerKind: 'portal' }), /小さなウィンドウの画面にはヘッダーがないので/);
  await refuse('edit_screen', up({ screen: 's3', portalMenu: 'ホーム' }), /portalMenu を書けるのは、ヘッダーの形が "portal"/);
  await refuse('edit_screen', up({ screen: 's3', headerKind: 'site' }), /headerKind は "app"（アプリ）・"portal"（お客さまポータル）/);
  await refuse('edit_screen', up({ screen: 's2', overlay: { pos: 'left' } }), /overlay\.pos は "center"（真ん中）・"bottomRight"（右下）・"right"（右の端）/);
  await refuse('edit_screen', up({ screen: 's2', overlay: { size: 1 } }), /overlay に「size」という欄はありません/);
  app.close();
});

test('edit_screen と update_design: ヘッダーの形をお客さまポータルにし、サイト名・メニュー・右上のボタンを書く。下線のメニューがメニューにないときは知らせる', async () => {
  const { app, call, sc, screenOp, refuse } = await boot();
  const r = await screenOp({ screen: 'トップ', headerKind: 'portal' });
  assert.deepEqual([r.screens[0].headerKind, r.screens[0].portalMenu], ['portal', 'トップ'], 'メニューを書かないときは、ポータルの画面の名前');
  const u = await call('update_design', { design: 'd1', portal: { site: 'サポートサイト', menu: ['ホーム', 'よくある質問', 'お問い合わせ'], button: 'マイページ' } });
  assert.deepEqual(u.portal, { site: 'サポートサイト', menu: ['ホーム', 'よくある質問', 'お問い合わせ'], button: 'マイページ' });
  const r2 = await screenOp({ screen: 's3', portalMenu: 'お問い合わせ' });
  assert.equal(r2.screens[0].portalMenu, 'お問い合わせ');
  const r3 = await screenOp({ screen: 's3', portalMenu: '会社案内' });
  assert.match(r3.warnings[0], /「会社案内」はお客さまポータルのメニュー（ホーム・よくある質問・お問い合わせ）にないので、下線は「ホーム」に付きます/);
  const d = await call('get_design', { design: 'd1' });
  assert.deepEqual(d.portal, { site: 'サポートサイト', menu: ['ホーム', 'よくある質問', 'お問い合わせ'], button: 'マイページ' });
  assert.equal(d.screens[2].headerKind, 'portal');
  await call('update_design', { design: 'd1', portal: { button: null } });
  assert.equal((await call('get_design', { design: 'd1' })).portal.button, 'ログイン', '書いた欄だけを変える（null は書いていないときの値）');
  await call('update_design', { design: 'd1', portal: null });
  assert.deepEqual((await call('get_design', { design: 'd1' })).portal, { site: '問い合わせ管理', menu: ['トップ'], button: 'ログイン' }, 'null はどれも消す');
  await refuse('update_design', { design: 'd1', portal: { logo: 'x' } }, /portal に「logo」という欄はありません/);
  await screenOp({ screen: 's3', headerKind: 'app' });
  assert.equal(sc('s3').headerKind, undefined);
  assert.equal((await call('get_design', { design: 'd1' })).portal, undefined, 'ポータルの画面も portal の欄もなければ返さない');
  app.close();
});

test('add_screen: 小さなウィンドウのひな形は after の画面を下に重ね、device は断る。ポータルのトップの画面の名前は「ホーム」', async () => {
  const { app, call, refuse, sc } = await boot();
  const r = await call('add_screen', { design: 'd1', template: 'winApproval', after: '問い合わせの詳細' });
  assert.equal(r.screen.name, '承認申請 2', '同じ名前の画面があれば番号を付ける');
  assert.deepEqual([r.screen.overlay.under, r.screen.overlay.pos], ['問い合わせの詳細', 'center']);
  const c = await call('add_screen', { design: 'd1', template: 'winChat', after: r.screen.id, name: 'チャット' });
  assert.deepEqual([c.screen.name, c.screen.overlay.under, c.screen.overlay.pos], ['チャット', '問い合わせの詳細', 'bottomRight'], '小さなウィンドウの画面の後ろでも、その下の画面を下に重ねる');
  await refuse('add_screen', { design: 'd1', template: 'winChat', device: 'phone' }, /小さなウィンドウのひな形の画面の機器は、下に重ねる画面と同じになります/);
  const p = await call('add_screen', { design: 'd1', template: 'portalTop' });
  assert.deepEqual([p.screen.name, p.screen.headerKind, p.screen.height], ['ホーム', 'portal', 1080]);
  assert.deepEqual(sc(p.screen.id).parts.map((x) => x.type), ['hero', 'tileMenu', 'articles', 'articles']);
  app.close();
});

test('layout_screen: 手引きの小さなウィンドウの例は、そのまま通り、ウィンドウの中に並べて、最後のボタンの行を下のボタンの行に置く', async () => {
  const { GUIDES } = require('../mcp-guide');
  const example = guideExample(GUIDES.layout.text, '## 小さなウィンドウの書き方の例');
  valid(layoutSchema, example, '手引きの小さなウィンドウの例');
  const { app, call, refuse, sc, screenOp } = await boot();
  await screenOp({ screen: 's2', overlay: { under: 's1', pos: 'center' } });
  const r = await call('layout_screen', { design: 'd1', screen: 's2', layout: example });
  const ps = sc('s2').parts;
  assert.deepEqual(ps.map((p) => [p.type, p.no, p.x, p.y, p.w]), [
    ['desc', null, 352, 264, 400], ['user', 1, 352, 336, 320], ['text2', 2, 352, 424, 400], ['button', 3, 712, 568, 96], ['button', 4, 824, 568, 112],
  ], '最初の行は見出しの行の下に 24（184＋56＋24）、左端はウィンドウの左から 32。ボタンは下のボタンの行に、右から 24・間 16（キャンセルの幅は文字に合わせて 112）');
  assert.deepEqual(r.createdItems.map((it) => it.name), ['承認者', 'コメント']);
  assert.equal(ps[4].props.screenId, 's1', 'キャンセルの移動先は下の画面');
  // 下のボタンの行にアイテムがあるときに、ボタンの行を書くと断る。ウィンドウの下の端を超える並べ方も断る（どちらも何も変わらない）
  await refuse('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [{ align: 'right', parts: [{ type: 'button', label: '保存' }] }] } }, /下のボタンの行には、もうアイテムがあります/);
  await refuse('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ type: 'table', label: '明細' }]] } }, /ウィンドウの中の下の端（y 552。下のボタンの行の上）を超えます/);
  assert.equal(sc('s2').parts.length, 5);
  app.close();
});

test('layout_screen: 手引きのお客さまポータルの例は、そのまま通り、大きな画像と検索欄をヘッダーのすぐ下に幅いっぱいで置く', async () => {
  const { GUIDES } = require('../mcp-guide');
  const example = guideExample(GUIDES.layout.text, '## お客さまポータルの書き方の例');
  valid(layoutSchema, example, '手引きのお客さまポータルの例');
  const { app, call, sc, screenOp } = await boot();
  await screenOp({ screen: 's3', headerKind: 'portal' });
  await call('layout_screen', { design: 'd1', screen: 's3', layout: example });
  const ps = sc('s3').parts;
  assert.deepEqual(ps.map((p) => [p.type, p.x, p.y, p.w, p.h]), [
    ['hero', 0, 72, 1280, 320], ['tileMenu', 32, 416, 1200, 160], ['articles', 32, 600, 784, 416], ['articles', 864, 600, 368, 416],
  ]);
  assert.equal(ps[3].props.desc, false);
  // ふつうの並べ方の途中に書いても、1 行を 1 つで使う。今のアイテムの下に追加するときは、ヘッダーのすぐ下には置かない
  await call('layout_screen', { design: 'd1', screen: 's3', layout: { columns: 2, rows: [[{ type: 'heading', label: 'A' }, { type: 'hero' }, { type: 'heading', label: 'B' }]] } });
  const added = sc('s3').parts.slice(4);
  assert.deepEqual(added.map((p) => [p.type, p.x, p.y, p.w]), [['heading', 32, 1040, 400], ['hero', 0, 1096, 1280], ['heading', 32, 1440, 400]]);
  app.close();
});

test('layout_screen: 小さなウィンドウの中の大きな画像と検索欄は、ウィンドウの幅いっぱい。最初の行は見出しの行のすぐ下', async () => {
  const { app, call, sc, screenOp } = await boot();
  await screenOp({ screen: 's2', overlay: { under: 's1', pos: 'right', width: 480, foot: false } });
  await call('layout_screen', { design: 'd1', screen: 's2', layout: { rows: [[{ type: 'hero', props: { search: false } }], [{ type: 'desc', label: '説明' }]] } });
  const [hero, desc] = sc('s2').parts;
  assert.deepEqual([hero.x, hero.y, hero.w], [800, 56, 480], '右の端のウィンドウ（x 800・幅 480）の見出しの行の下');
  assert.deepEqual([desc.x, desc.y], [832, 400]);
  app.close();
});

test('get_kintone_app: ポータル画面用のアイテムを warnings で知らせ、manualSteps に小さなウィンドウとお客さまポータルの画面の作り方を書く', async () => {
  const { app, call, screenOp } = await boot();
  await screenOp({ screen: 's2', overlay: { under: 's1' } });
  await screenOp({ screen: 's3', headerKind: 'portal' });
  await call('layout_screen', { design: 'd1', screen: 's1', layout: { rows: [[{ type: 'chat' }], [{ type: 'articles' }]] } });
  const r = await call('get_kintone_app', { design: 'd1', screen: 's1' });
  const warn = r.warnings.join('\n');
  assert.match(warn, /（チャット）は kintone のフィールドにないので、フォームに入れていません/);
  assert.match(warn, /「よくある質問」（記事の一覧）は kintone のフィールドにないので/);
  const steps = r.manualSteps.join('\n');
  assert.match(steps, /小さなウィンドウ: 画面「承認申請」は、画面「問い合わせの詳細」の上に開く小さなウィンドウ。kintone の標準の機能にないので、カスタマイズ（JavaScript）かプラグインで作る/);
  assert.match(steps, /お客さまポータル: 画面 「トップ」 は、お客さま向けの Web のサイトの画面で、kintone のアプリの画面ではないので、kintone の外の仕組みで作る/);
  app.close();
});

test('入口: edit_screen の overlay・headerKind・portalMenu と update_design の portal の形。手引きに小さなウィンドウ・ヘッダーの形・ポータル画面用のアイテム・ひな形', async () => {
  const { screenOps } = require('../mcp-schemas');
  valid(screenOps, [{ op: 'update', screen: '承認申請', overlay: { under: '問い合わせの詳細', pos: 'bottomRight', width: 400, height: 560, foot: false } }], 'overlay');
  valid(screenOps, [{ op: 'update', screen: 's2', overlay: null, headerKind: 'portal', portalMenu: 'ホーム' }], 'overlay null と headerKind');
  assert.equal(screenOps.safeParse([{ op: 'update', screen: 's2', overlay: { under: 's1', left: 3 } }]).success, false, 'overlay の知らない欄は断る');
  valid(S.portal, { site: 'サポートサイト', menu: ['ホーム'], button: null }, 'portal');
  const { GUIDES } = require('../mcp-guide');
  for (const w of ['小さなウィンドウ', 'ヘッダーの形（headerKind）', 'update_design の portal']) assert.ok(GUIDES.overview.text.includes(w), `overview に ${w}`);
  for (const w of ['大きな画像と検索欄（hero', 'タイル（tileMenu', '記事の一覧（articles', 'チャット（chat', '"winApproval"', '"portalTop"', 'screenName', 'headerKinds']) {
    assert.ok(GUIDES.catalog.text.includes(w), `catalog に ${w}`);
  }
  assert.ok(GUIDES.layout.text.includes('## 小さなウィンドウの中の並べ方の決まり'));
  assert.match(GUIDES.kintone.text, /小さなウィンドウの画面は kintone の標準の機能にない/);
});
