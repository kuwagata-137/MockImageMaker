'use strict';
// グループ枠（第 14 段階。画像 q115 の案B）のデータのテスト。アイテムがグループ枠に入る・出る・一緒に動く・削除・コピー・読み込み。
// 画面設計の名前は架空の業務（顧客管理など）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const rectOf = (p) => [p.x, p.y, p.w, p.h];

// 白紙の画面 1 つの画面設計（標準の見た目。帯の高さ 40）を開いた状態で起動する
async function bootScreen(t, opts) {
  const app = bootApp(opts);
  const api = await app.api();
  t.after(() => app.close());
  if (!opts) api.openDesign(api.actions.createDesign('顧客管理アプリ', 'kintone'));
  const did = () => api.ui.designId;
  const sid = () => api.currentScreen().id;
  const part = (id) => api.currentScreen().parts.find((p) => p.id === id);
  // 決めた位置と大きさに置く（置いた後に大きさを変えるので、グループ枠は「大きさを変えた」ときの決まりも通る）
  const put = (type, [x, y, w, h]) => {
    const id = api.actions.addPart(did(), sid(), type, { x, y });
    api.actions.movePart(did(), sid(), id, { x, y, w, h });
    return id;
  };
  return { app, api, did, sid, part, put };
}

test('グループ枠: 種類の名前と最初の大きさ。中にアイテムを入れられる種類の印を持つ', async (t) => {
  const { api } = await bootScreen(t);
  const f = api.PART_TYPES.frame;
  assert.deepEqual(plain([f.name, f.w, f.h, f.label, f.container, f.props]), ['グループ枠', 400, 240, 'グループ名', true, { color: 'blue' }]);
  assert.equal(api.PART_TYPES.text1.container, undefined, '入力の項目のアイテムは、ほかのアイテムを入れない');
});

test('グループ枠: アイテムを置くと、真ん中があるグループ枠に入る。外に置くと入らない', async (t) => {
  const { part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('text1', [600, 120, 320, 64]);
  assert.equal(part(a).inFrame, f);
  assert.equal('inFrame' in part(b), false, '入っていないアイテムは inFrame の欄を持たない');
  assert.equal('inFrame' in part(f), false, 'グループ枠はほかのグループ枠に入らない');
});

test('グループ枠: アイテムを動かして真ん中を中に入れると入り、外へ出すと出る。一部がはみ出していても真ん中が中なら入る', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [600, 120, 320, 64]);
  api.actions.movePart(did(), sid(), a, { x: 200, y: 120, w: 320, h: 64 }); // 真ん中 (360, 152) は中。右の端はグループ枠の外
  assert.equal(part(a).inFrame, f);
  api.actions.movePart(did(), sid(), a, { x: 400, y: 120, w: 320, h: 64 }); // 真ん中 (560, 152) は外
  assert.equal('inFrame' in part(a), false);
  api.store.undo();
  assert.equal(part(a).inFrame, f, '元に戻すで、入っていた形に戻る');
});

test('グループ枠: 重なったグループ枠では、上に描くもの（アイテムの並びで後ろ）に入る', async (t) => {
  const { part, put } = await bootScreen(t);
  put('frame', [40, 80, 600, 400]);
  const g2 = put('frame', [80, 120, 400, 240]);
  const a = put('text1', [96, 160, 320, 64]);
  assert.equal(part(a).inFrame, g2);
});

test('グループ枠: 置いたときは、全体が中にある、どこにも入っていないアイテムを入れる', async (t) => {
  const { part, put } = await bootScreen(t);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('text1', [300, 200, 320, 64]); // 右の端がはみ出す
  const f = put('frame', [40, 80, 400, 240]);
  assert.equal(part(a).inFrame, f);
  assert.equal('inFrame' in part(b), false, '一部がはみ出すアイテムは入れない');
  const g = put('frame', [700, 80, 400, 300]);
  const c = put('text1', [716, 120, 320, 64]);
  put('frame', [708, 104, 336, 96]); // 全体が中にある c は、もう g に入っている
  assert.equal(part(c).inFrame, g, 'ほかのグループ枠に入っているアイテムは取らない');
});

test('グループ枠: 大きさを変えたときは、全体が中になったアイテムを入れ、真ん中が外になったアイテムを出す', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('text1', [56, 400, 320, 64]);
  api.actions.movePart(did(), sid(), f, { x: 40, y: 80, w: 400, h: 400 });
  assert.equal(part(b).inFrame, f, '下へ広げて全体が中になったので入る');
  assert.deepEqual(rectOf(part(a)), [56, 120, 320, 64], '大きさを変えても、中のアイテムは動かない');
  api.actions.movePart(did(), sid(), f, { x: 40, y: 80, w: 160, h: 400 });
  assert.equal('inFrame' in part(a), false, '狭めて真ん中が外になったので出る');
  assert.equal('inFrame' in part(b), false);
});

test('グループ枠: 動かすと中のアイテムも同じだけ動く。動かしただけでは、ほかのアイテムを入れない', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('button', [56, 240, 96, 40]);
  const c = put('text1', [536, 120, 320, 64]); // 動かした先で、グループ枠の中になるアイテム
  const before = plain(api.currentScreen().parts);
  api.actions.movePart(did(), sid(), f, { x: 520, y: 96, w: 400, h: 240 });
  assert.deepEqual(rectOf(part(f)), [520, 96, 400, 240]);
  assert.deepEqual(rectOf(part(a)), [536, 136, 320, 64]);
  assert.deepEqual(rectOf(part(b)), [536, 256, 96, 40]);
  assert.equal(part(a).inFrame, f);
  assert.equal('inFrame' in part(c), false, '動かしただけでは入れない');
  api.store.undo();
  assert.deepEqual(plain(api.currentScreen().parts), before, '元に戻す 1 回で、グループ枠と中のアイテムが元の位置に戻る');
});

test('グループ枠: まとめて動かす・矢印のキーでも、中のアイテムが一緒に動く。中のアイテムが画面の端に当たると止まる', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  api.actions.moveMany(did(), sid(), [{ k: 'p', id: f }], 80, 40);
  assert.deepEqual(rectOf(part(f)), [120, 120, 400, 240]);
  assert.deepEqual(rectOf(part(a)), [136, 160, 320, 64]);
  // 中のアイテムを、グループ枠の右からはみ出させてから、右の端まで動かす
  api.actions.movePart(did(), sid(), a, { x: 352, y: 160, w: 320, h: 64 });
  assert.equal(part(a).inFrame, f, '真ん中 (512, 192) はまだ中');
  api.actions.moveMany(did(), sid(), [{ k: 'p', id: f }], 2000, 0);
  assert.equal(part(a).x + part(a).w, 1280, '中のアイテムが画面の右の端に当たって止まる');
  assert.equal(part(a).x - part(f).x, 232, 'グループ枠と中のアイテムの間は変わらない');
});

test('グループ枠: 揃えるで動かしたときも、中のアイテムが同じだけ動く', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [160, 80, 400, 240]);
  const a = put('text1', [176, 120, 320, 64]);
  const b = put('button', [40, 400, 96, 40]);
  api.actions.alignMany(did(), sid(), [{ k: 'p', id: b }, { k: 'p', id: f }], 'left');
  assert.equal(part(f).x, 40);
  assert.equal(part(a).x, 56);
  assert.equal(part(a).inFrame, f);
});

test('グループ枠: 削除しても中のアイテムは残り、どこにも入っていない形になる', async (t) => {
  const { api, did, sid, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  api.actions.deletePart(did(), sid(), f);
  assert.equal(part(f), undefined);
  assert.equal('inFrame' in part(a), false);
  api.store.undo();
  assert.equal(part(a).inFrame, f);
  api.actions.deleteMany(did(), sid(), [{ k: 'p', id: f }]);
  assert.equal('inFrame' in part(a), false, 'まとめて削除しても同じ');
});

test('グループ枠: 複製すると中のアイテムも一緒にコピーし、新しいグループ枠に入れる', async (t) => {
  const { api, part, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('button', [56, 240, 96, 40]);
  api.ui.sel = [{ k: 'p', id: f }];
  api.runCommand('duplicatePart');
  const parts = api.currentScreen().parts;
  assert.equal(parts.length, 6);
  const nf = parts[3];
  assert.equal(nf.type, 'frame');
  assert.deepEqual(rectOf(nf), [56, 96, 400, 240]);
  const kids = parts.slice(4);
  assert.deepEqual(plain(kids.map((p) => [p.type, p.x, p.y, p.inFrame])), [['text1', 72, 136, nf.id], ['button', 72, 256, nf.id]]);
  assert.equal(part(a).inFrame, f, '元のアイテムは元のグループ枠に入ったまま');
  assert.equal(part(b).inFrame, f);
  assert.deepEqual(plain(api.ui.sel.map((x) => x.id)), [nf.id], '複製した後は、新しいグループ枠を選ぶ');
});

test('グループ枠: 中のアイテムだけを複製したときは、置いた先の真ん中で入るグループ枠を決める', async (t) => {
  const { api, put } = await bootScreen(t);
  const f = put('frame', [40, 80, 400, 240]);
  const a = put('text1', [56, 120, 320, 64]);
  const b = put('text1', [56, 280, 320, 64]); // 真ん中 (216, 312) は中。複製すると (232, 328) で外
  api.ui.sel = [{ k: 'p', id: a }];
  api.runCommand('duplicatePart');
  assert.equal(api.currentScreen().parts.at(-1).inFrame, f);
  api.ui.sel = [{ k: 'p', id: b }];
  api.runCommand('duplicatePart');
  assert.equal('inFrame' in api.currentScreen().parts.at(-1), false);
});

test('グループ枠: 読み込むときに、ない・中に入れられないアイテムを指す inFrame を消す', async (t) => {
  const P = (id, type, x, y, extra = {}) => ({ id, type, x, y, w: type === 'frame' ? 400 : 160, h: type === 'frame' ? 240 : 64, no: null, label: 'x', props: type === 'frame' ? { color: 'blue' } : {}, ...extra });
  const state = {
    schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [],
    designs: [{
      id: 'd1', name: '顧客管理', target: 'other', look: 'standard', bandTabs: [], description: '',
      createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', trashedAt: null, revisions: [], items: [],
      screens: [
        { id: 's1', name: '詳細', device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', itemView: 'input', callouts: [], parts: [
          P('f1', 'frame', 40, 80),
          P('p1', 'heading', 56, 120, { inFrame: 'f1' }),
          P('p2', 'heading', 56, 200, { inFrame: 'nope' }),
          P('p3', 'heading', 56, 280, { inFrame: 'p1' }),
          P('f2', 'frame', 600, 80, { inFrame: 'f1' }),
          P('p4', 'heading', 600, 400),
          P('p5', 'heading', 600, 480, { inFrame: 'f9' }),
        ] },
        { id: 's2', name: '一覧', device: 'pc', width: 1280, height: 800, showHeader: true, tablePos: 'right', itemView: 'input', callouts: [], parts: [P('f9', 'frame', 40, 80)] },
      ],
      mapPos: {}, processPos: {}, flowPos: {},
    }],
  };
  const { api } = await bootScreen(t, { localStorage: { 'mockimagemaker.v1': JSON.stringify(state) } });
  const parts = api.store.state.designs[0].screens[0].parts;
  const inFrame = Object.fromEntries(parts.map((p) => [p.id, 'inFrame' in p ? p.inFrame : '（なし）']));
  assert.deepEqual(plain(inFrame), { f1: '（なし）', p1: 'f1', p2: '（なし）', p3: '（なし）', f2: '（なし）', p4: '（なし）', p5: '（なし）' });
});
