'use strict';
// bdm-export.js（システムのスイムレーン図を、元にする MPD の埋め込みに入れた HTML を作る）と、それが使う bdm-compose.js・bdm-place.js・bdm-inject.js のテスト（第 11 段階）。
// どれも Electron に触らない純関数。MPD（MultipurposeDiagramMaker で保存した HTML）は、テストの中で文字として組み立てる
// （参考/diagram_v8.31.html の </head> の前に、MultipurposeDiagramMaker の保存 buildSaveHtml と同じ形で図の中身の script を差し込んだものも使う）。
// 出力した HTML は、読み取りの部品（planFromHtml）で読み直して、渡した形と同じスイムレーン図になるかで確かめる。図の中身は架空の業務（出張申請）だけ。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MaterialError } = require('../material-error');
const { extractBdmState } = require('../bdm-state');
const { bdmPlan, planFromHtml } = require('../bdm-swimlane');
const { exportBdmHtml } = require('../bdm-export');
const { injectBdmState } = require('../bdm-inject');

const ROOT = path.join(__dirname, '..');
const TRIP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'materials', 'bdm-trip-state.json'), 'utf8'));
const BDM_APP = fs.readFileSync(path.join(ROOT, '参考', 'diagram_v8.31.html'), 'utf8');
const BACKSLASH = String.fromCharCode(92);
const LINE_SEP = String.fromCharCode(0x2028);
const PATH_LIKE = /[A-Za-z]:\\|\/Users\//;

const failsWith = (fn, code, pattern) => assert.throws(fn, (e) => {
  assert.ok(e instanceof MaterialError, 'MaterialError であること');
  assert.equal(e.code, code);
  if (pattern) assert.match(e.message, pattern);
  assert.doesNotMatch(e.message, PATH_LIKE, '文にパスを入れない');
  return true;
});

// ── HTML の見本 ──
const page = (head = '', body = '<body>') => `<!DOCTYPE html>\n<html><head><title>図</title>${head}</head>\n${body}\n<div id="app"></div>\n</body></html>`;
const bdmJson = (st) => JSON.stringify(st).replace(/<\/script>/gi, '<' + BACKSLASH + '/script>');
const saveScript = (st) => `<script id="swimlane-state">window.__SWIMLANE_STATE__=${bdmJson(st)};</script>`;
const dataState = (st) => `<body data-state="${encodeURIComponent(JSON.stringify(st))}">`;
const savedScript = (st) => `<script>window.__SAVED_STATE__=${JSON.stringify(st)};</script>`;
const saved = (st) => page(saveScript(st));
const realApp = (st) => BDM_APP.replace('</head>', () => `${saveScript(st)}\n</head>`);

// ── 渡す形の見本 ──
// 読み取りの案（bdmPlan）を、アプリに取り込んだときと同じ形にする（作業の key は 'w-' ＋ 箱の id。withBox なら元の箱の id を box に入れる）
function payloadOf(plan, { withBox = true, name = '出張申請システム' } = {}) {
  return {
    name, lanes: plan.roles.slice(),
    steps: plan.steps.map((s) => ({ key: `w-${s.key}`, lane: plan.roles.indexOf(s.role), col: s.col, kind: s.kind, text: s.text, box: withBox ? s.key : null })),
    edges: plan.edges.map((e) => ({ from: `w-${e.from}`, to: `w-${e.to}`, label: e.label })),
  };
}
const TRIP_PLAN = bdmPlan(TRIP);
const step = (key, lane, col, kind, text, box = null) => ({ key, lane, col, kind, text, box });
const flow = (lanes, steps, edges = []) => ({ name: '出張申請システム', lanes, steps, edges: edges.map(([from, to, label = '']) => ({ from, to, label })) });
const BLANK = { diagramType: 'swimlane', orientation: 'vertical', lanes: [], nodes: [], edges: [], uid: 0, diagramName: '', appVer: '8.31', printPaper: 'A3' };

// 読み直した案が、渡した形と同じスイムレーン図か（役割の並び・作業の役割と列〔詰めた順〕と種類と文字・矢印）
function assertSameFlow(html, payload, out) {
  assert.deepEqual(out.warnings, [], '読み直しの食い違いがない');
  const read = planFromHtml(html);
  const ranks = [...new Set(payload.steps.map((s) => s.col))].sort((a, b) => a - b);
  const want = payload.steps.map((s) => [payload.lanes[s.lane], ranks.indexOf(s.col), s.kind, s.text]).sort();
  assert.deepEqual(read.steps.map((s) => [s.role, s.col, s.kind, s.text]).sort(), want);
  assert.equal(read.edges.length, payload.edges.length);
  return read;
}
// 縦の図のレーンの x の範囲（横の図は y の範囲）
const laneRanges = (st) => {
  let at = 0;
  return st.lanes.map((l) => { const r = { id: l.id, start: at, end: at + l.w }; at += l.w; return r; });
};

test('exportBdmHtml — 取り込んだ図をそのまま出力すると、元の箱の id・種類・位置・欄を使い回し、読み直して同じ', () => {
  const html = realApp(TRIP);
  const payload = payloadOf(TRIP_PLAN);
  const out = exportBdmHtml(html, payload);
  assertSameFlow(out.html, payload, out);
  const st = extractBdmState(out.html);
  for (const n of TRIP.nodes) assert.deepEqual(st.nodes.find((x) => x.id === n.id), n, `箱 ${n.id} は元のまま`);
  assert.deepEqual(st.lanes, TRIP.lanes);
  assert.deepEqual(st.edges, TRIP.edges, '矢印も元の欄のまま');
  assert.equal(st.uid, TRIP.uid, '新しい id を使っていないので uid は元のまま');
  assert.deepEqual(out.counts, { lanes: 3, steps: 8, edges: 8 });
});

test('exportBdmHtml — 図の欄: 種類は swimlane・名前はシステムの名前・docId は null・向きや用紙・appVer などほかの欄は元のまま', () => {
  const st = extractBdmState(exportBdmHtml(saved({ ...TRIP, diagramType: 'bpmn' }), payloadOf(TRIP_PLAN, { name: '  出張申請システム  ' })).html);
  assert.equal(st.diagramType, 'swimlane');
  assert.equal(st.diagramName, '出張申請システム');
  assert.equal(st.docId, null, '元の docId（doc-trip-sample）を写さない');
  for (const k of ['orientation', 'printPaper', 'printOrient', 'appVer', 'style', 'gridOn', 'stepNums', 'mindLayout']) assert.deepEqual(st[k], TRIP[k], k);
  assert.deepEqual(st.gantt, TRIP.gantt);
});

test('exportBdmHtml — 元の位置を使わない（box なし）とき、MultipurposeDiagramMaker の整列の寸法で置き、読み直して同じ', () => {
  const payload = payloadOf(TRIP_PLAN, { withBox: false });
  const out = exportBdmHtml(saved(TRIP), payload);
  assertSameFlow(out.html, payload, out);
  const st = extractBdmState(out.html);
  assert.ok(st.nodes.every((n) => Number(n.id.slice(1)) > TRIP.uid), '新しい id は元の uid より後');
  assert.equal(st.uid, Math.max(...[...st.lanes, ...st.nodes, ...st.edges].map((o) => Number(o.id.slice(1)))), 'uid は最後に使った番号（箱と矢印に振った番号を含む）');
  const first = st.nodes.find((n) => n.text === '開始');
  assert.equal(first.y + first.h / 2, 124.5, '最初の列の中心は、見出しの帯 44 ＋ 格子 80（丸めの 0.5 だけずれる）');
  const ranges = laneRanges(st);
  for (const n of st.nodes) {
    const r = ranges.find((x) => x.id === n.lid);
    assert.ok(n.x >= r.start + 4 && n.x + n.w <= r.end - 4, `箱「${n.text}」はレーンの中`);
    assert.ok(n.y >= 48, `箱「${n.text}」は見出しの帯の外`);
  }
  const keiri = st.lanes.find((l) => l.name === '経理');
  assert.equal(keiri.w, 224, '同じ列に作業と書類の 2 つを並べる経理のレーンは、220 から広げる（端 10×2 ＋ 120 ＋ 60 ＋ 間 24）');
  const [rect, doc] = ['概算払いを処理する', '出張精算書'].map((t) => st.nodes.find((n) => n.text === t));
  assert.ok(doc.x - (rect.x + rect.w) >= 24, '同じ枠の箱の間は 24 以上');
});

test('exportBdmHtml — 横の図: 流れの向きは x、箱の w と h を入れ替える（MultipurposeDiagramMaker の横の図と同じ）', async (t) => {
  const across = { ...TRIP, orientation: 'horizontal', nodes: TRIP.nodes.map((n) => ({ ...n, x: n.y, y: n.x, w: n.h, h: n.w })) };
  const plan = bdmPlan(across);
  await t.test('元の位置を使う', () => {
    const out = exportBdmHtml(saved(across), payloadOf(plan));
    assertSameFlow(out.html, payloadOf(plan), out);
    const st = extractBdmState(out.html);
    for (const n of across.nodes) assert.deepEqual(st.nodes.find((x) => x.id === n.id), n);
  });
  await t.test('新しく置く', () => {
    const payload = payloadOf(plan, { withBox: false });
    const out = exportBdmHtml(saved(across), payload);
    assertSameFlow(out.html, payload, out);
    const st = extractBdmState(out.html);
    const rect = st.nodes.find((n) => n.text === '出張を申請する');
    assert.deepEqual([rect.w, rect.h], [37, 120], '作業の箱は 37 × 120');
    const ranges = laneRanges(st);
    for (const n of st.nodes) {
      const r = ranges.find((x) => x.id === n.lid);
      assert.ok(n.y >= r.start + 4 && n.y + n.h <= r.end - 4, `箱「${n.text}」はレーン（横の帯）の中`);
      assert.ok(n.x >= 48);
    }
  });
});

test('exportBdmHtml — 列とレーン', async (t) => {
  await t.test('列の空き（0・2・5）は詰めて出力し、読み直すと 0・1・2', () => {
    const payload = flow(['申請者'], [step('a', 0, 0, 'start', '出張が決まる'), step('b', 0, 2, 'task', '申請する'), step('c', 0, 5, 'end', '終わり')], [['a', 'b'], ['b', 'c']]);
    const out = exportBdmHtml(saved(BLANK), payload);
    assert.deepEqual(assertSameFlow(out.html, payload, out).steps.map((s) => s.col), [0, 1, 2]);
  });
  await t.test('作業のない役割もレーンとして残る。新しいレーンは色の並びの順の色・幅 220', () => {
    const payload = flow(['申請者', '上長', '経理'], [step('a', 0, 0, 'task', '申請する'), step('b', 2, 1, 'task', '精算する')], [['a', 'b']]);
    const out = exportBdmHtml(saved(BLANK), payload);
    assert.deepEqual(assertSameFlow(out.html, payload, out).roles, ['申請者', '上長', '経理']);
    const st = extractBdmState(out.html);
    assert.deepEqual(st.lanes.map((l) => [l.bg, l.hd, l.w]), [['#eff6ff', '#bfdbfe', 220], ['#f0fdf4', '#bbf7d0', 220], ['#fefce8', '#fde68a', 220]]);
  });
  await t.test('元と同じ名前の役割は、元のレーンの id・色・幅を使い回す（前後の空白だけ違う名前も）。名前はアプリの役割の名前にする', () => {
    const orig = { ...TRIP, lanes: [{ ...TRIP.lanes[0], name: ' 申請者 ', bg: '#123456', w: 300 }, ...TRIP.lanes.slice(1)] };
    const payload = flow(['総務', '申請者'], [step('a', 1, 0, 'task', '申請する'), step('b', 0, 1, 'task', '受け付ける')], [['a', 'b']]);
    const st = extractBdmState(exportBdmHtml(saved(orig), payload).html);
    assert.deepEqual(st.lanes[1], { ...orig.lanes[0], name: '申請者' });
    assert.ok(Number(st.lanes[0].id.slice(1)) > TRIP.uid, '総務は新しいレーン');
    assert.equal(st.lanes.length, 2, 'アプリにない役割（上長・経理）のレーンは入れない');
  });
  await t.test('元の図に同じ名前のレーンが 2 つあれば、順に使い回す', () => {
    const orig = { ...TRIP, lanes: [{ ...TRIP.lanes[0], id: 'e1' }, { ...TRIP.lanes[0], id: 'e2', bg: '#000000' }] };
    const payload = flow(['申請者', '申請者'], [step('a', 0, 0, 'task', '申請する'), step('b', 1, 1, 'task', '直す')], [['a', 'b']]);
    const out = exportBdmHtml(saved(orig), payload);
    assert.deepEqual(extractBdmState(out.html).lanes.map((l) => l.id), ['e1', 'e2']);
    assert.match(out.warnings.join('\n'), /役割の並びが「申請者」になります/, '同じ名前の役割は、読み直すと 1 つにまとまるので知らせる');
  });
});

test('exportBdmHtml — 元の箱の使い回し', async (t) => {
  const payload = payloadOf(TRIP_PLAN);
  const keyOf = (text) => payload.steps.find((s) => s.text === text).key;
  await t.test('列を変えた作業は、元の位置を使わない（読み直しても列の並びが崩れない）', () => {
    const moved = { ...payload, steps: payload.steps.map((s) => (s.key === keyOf('出張申請システムに入力') ? { ...s, col: 7 } : s)) };
    const out = exportBdmHtml(saved(TRIP), moved);
    assertSameFlow(out.html, moved, out);
    const st = extractBdmState(out.html);
    assert.notEqual(st.nodes.find((n) => n.id === 'e6').y, 210);
    assert.equal(st.nodes.find((n) => n.id === 'e5').y, 140, 'ほかの箱は元の位置');
  });
  await t.test('役割を変えた作業は、元の位置を使わず、新しいレーンの中に置く', () => {
    const moved = { ...payload, steps: payload.steps.map((s) => (s.key === keyOf('出張を申請する') ? { ...s, lane: 1 } : s)) };
    const out = exportBdmHtml(saved(TRIP), moved);
    assertSameFlow(out.html, moved, out);
    const st = extractBdmState(out.html);
    const n = st.nodes.find((x) => x.id === 'e5');
    assert.equal(n.lid, 'e2');
    assert.ok(n.x >= 224 && n.x + n.w <= 436);
  });
  await t.test('種類を変えた作業は、id だけ残し、種類と大きさを付け直し、元の欄（説明など）は消す', () => {
    const changed = { ...payload, steps: payload.steps.map((s) => (s.key === keyOf('上長が承認する') ? { ...s, kind: 'decision' } : s)) };
    const out = exportBdmHtml(saved(TRIP), changed);
    assertSameFlow(out.html, changed, out);
    const n = extractBdmState(out.html).nodes.find((x) => x.id === 'e7');
    assert.deepEqual([n.type, n.w, n.h, 'note' in n], ['diamond', 180, 59, false]);
  });
  await t.test('同じ箱を指す作業が 2 つあれば、2 つ目は新しい箱にする', () => {
    const twice = { ...payload, steps: [...payload.steps, step('w-copy', 0, 3, 'task', '写した作業', 'e5')] };
    const out = exportBdmHtml(saved(TRIP), twice);
    assertSameFlow(out.html, twice, out);
    const ids = extractBdmState(out.html).nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'id が重ならない');
  });
  await t.test('複数レーンの箱（crosslane）は、作り直す（作業の箱にする）', () => {
    const cross = { ...TRIP, nodes: TRIP.nodes.map((n) => (n.id === 'e9' ? { ...n, type: 'crosslane', fromLid: 'e2', toLid: 'e3', mainPos: 480, thick: 37 } : n)) };
    const plan = bdmPlan(cross);
    const out = exportBdmHtml(saved(cross), payloadOf(plan));
    assertSameFlow(out.html, payloadOf(plan), out);
    const n = extractBdmState(out.html).nodes.find((x) => x.id === 'e9');
    assert.equal(n.type, 'rect');
    assert.equal('fromLid' in n, false);
  });
  await t.test('元の図の箱でない物（グループ枠）を指す box は使わない。元の図にない box も使わない', () => {
    const framed = { ...TRIP, nodes: [...TRIP.nodes, { id: 'e30', type: 'group_box', x: 0, y: 60, w: 220, h: 200, text: '申請', lid: 'e1' }], uid: 30 };
    const odd = { ...payload, steps: payload.steps.map((s, i) => (i === 0 ? { ...s, box: 'e30' } : i === 1 ? { ...s, box: 'e99' } : s)) };
    const st = extractBdmState(exportBdmHtml(saved(framed), odd).html);
    assert.equal(st.nodes.some((n) => n.type === 'group_box'), false, 'グループ枠は入れない');
    assert.equal(st.nodes.filter((n) => n.text === '開始' || n.text === '出張を申請する').every((n) => Number(n.id.slice(1)) > 30), true);
  });
});

test('exportBdmHtml — 矢印: 文字が変われば fromLabel・toLabel を空に、端の箱が動いたら経路の欄を消す。新しい矢印は MultipurposeDiagramMaker の形', () => {
  const orig = { ...TRIP, edges: TRIP.edges.map((e, i) => (i === 0 ? { ...e, fromLabel: '元', waypoints: [{ x: 1, y: 2 }] } : i === 1 ? { ...e, midPos: 0.5 } : e)) };
  const payload = payloadOf(bdmPlan(orig));
  payload.edges[0].label = 'はい';
  payload.steps = payload.steps.map((s) => (s.text === '出張申請システムに入力' ? { ...s, col: 9 } : s));
  payload.edges.push({ from: payload.steps[0].key, to: payload.steps[3].key, label: '' });
  const out = exportBdmHtml(saved(orig), payload);
  const st = extractBdmState(out.html);
  const [first, second] = [st.edges.find((e) => e.id === TRIP.edges[0].id), st.edges.find((e) => e.id === TRIP.edges[1].id)];
  assert.deepEqual([first.label, first.fromLabel, first.toLabel, first.waypoints], ['はい', '', '', [{ x: 1, y: 2 }]], '端の箱が動いていない矢印の経路は残す');
  assert.equal('midPos' in second, false, '端の箱（出張申請システムに入力）が動いた矢印の経路は消す');
  const added = st.edges[st.edges.length - 1];
  assert.deepEqual(Object.keys(added), ['id', 'from', 'to', 'label', 'fromLabel', 'toLabel', 'fromLid', 'toLid']);
  assert.equal(planFromHtml(out.html).edges.find((e) => e.from === first.from && e.to === first.to).label, 'はい');
});

test('exportBdmHtml — 始まり・終わりは矢印で読み直されるので、食い違えば warnings で知らせる', () => {
  const payload = flow(['申請者'], [step('a', 0, 0, 'task', '申請する'), step('b', 0, 1, 'end', '受付')], [['b', 'a']]);
  const out = exportBdmHtml(saved(BLANK), payload);
  assert.deepEqual(out.warnings, ['作業「受付」は、MPD で読み直すと種類が「始まり」になります（アプリでは「終わり」）。']);
});

test('exportBdmHtml — id: 元の uid が小さい・id が e 番号でない・同じ id があっても、重ならない id を振り、uid は最後の番号', () => {
  const orig = { ...TRIP, uid: 3, lanes: TRIP.lanes.map((l, i) => (i === 2 ? { ...l, id: 'e1' } : l)), nodes: [...TRIP.nodes, { id: 'x-free', type: 'rect', x: 0, y: 0, w: 1, h: 1, text: '', lid: 'e1' }] };
  const payload = payloadOf(bdmPlan(orig));
  const st = extractBdmState(exportBdmHtml(saved(orig), payload).html);
  const ids = [...st.lanes, ...st.nodes, ...st.edges].map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(st.uid, Math.max(...ids.filter((id) => /^e\d+$/.test(id)).map((id) => Number(id.slice(1)))));
  assert.ok(st.uid >= 19, '元の id の番号（e19 まで）より前に戻らない');
});

test('exportBdmHtml — 箱の文字に </script>・<!--・$&・$\'・"・\\・U+2028・改行があっても、壊れずに読み直せる', () => {
  const text = `見出し</script><!--$&$'"${BACKSLASH}${LINE_SEP}2 行目\n3 行目`;
  const payload = flow(['申請者'], [step('a', 0, 0, 'task', text)]);
  const out = exportBdmHtml(realApp(TRIP), payload);
  assert.equal(planFromHtml(out.html).steps[0].text, text.replace(/\r\n?/g, '\n').trim());
  const at = out.html.indexOf('window.__SWIMLANE_STATE__={');
  const scriptEnd = out.html.indexOf('</script>', at);
  assert.equal(out.html.slice(at, scriptEnd).includes('<'), false, '埋め込みの中に「<」を書かない');
  assert.equal(out.html.slice(at, scriptEnd).includes(LINE_SEP), false);
});

test('injectBdmState — 埋め込みの場所', async (t) => {
  const NEW = { ...BLANK, diagramName: '新しい図' };
  const read = (html) => extractBdmState(html).diagramName;
  await t.test('① があれば、その JSON だけを差し替え、ほかの文字は 1 字も変えない', () => {
    const html = saved(TRIP);
    const out = injectBdmState(html, NEW);
    const at = html.indexOf('window.__SWIMLANE_STATE__=') + 'window.__SWIMLANE_STATE__='.length;
    assert.equal(out.slice(0, at), html.slice(0, at));
    assert.ok(out.endsWith(';</script></head>\n<body>\n<div id="app"></div>\n</body></html>'));
    assert.equal(read(out), '新しい図');
  });
  await t.test('① が 2 つなら両方を差し替える', () => {
    const out = injectBdmState(page(saveScript(TRIP) + saveScript(TRIP)), NEW);
    assert.equal(out.split('"新しい図"').length - 1, 2);
  });
  await t.test('② だけ・③ だけ（古い保存）なら、</head> の前に ① を入れる（① が先に読まれる）', () => {
    for (const html of [page('', dataState(TRIP)), page(savedScript(TRIP))]) {
      const out = injectBdmState(html, NEW);
      assert.match(out, /<script id="swimlane-state">window\.__SWIMLANE_STATE__=\{.*\};<\/script>\n<\/head>/);
      assert.equal(read(out), '新しい図');
    }
  });
  await t.test('本物の MultipurposeDiagramMaker の本体: script の中の「</head>」の文字ではなく、本物の </head> の前に入れる', () => {
    const out = injectBdmState(BDM_APP, NEW);
    const inserted = `<script id="swimlane-state">window.__SWIMLANE_STATE__=${JSON.stringify(NEW)};</script>\n`;
    const at = out.indexOf(inserted);
    assert.ok(at > 0);
    assert.equal(out.slice(0, at) + out.slice(at + inserted.length), BDM_APP, '本体の文字は変えない');
    assert.ok(out.slice(at + inserted.length).startsWith('</head>'));
    assert.equal(read(out), '新しい図');
  });
  await t.test('① が壊れている・</head> がないときは read_failed', () => {
    failsWith(() => injectBdmState(page('<script id="swimlane-state">window.__SWIMLANE_STATE__={"nodes":[;</script>'), NEW), 'read_failed', /壊れて/);
    failsWith(() => injectBdmState(`<body data-state="${encodeURIComponent('{}')}">`, NEW), 'read_failed', /<\/head>/);
  });
});

test('exportBdmHtml — 元にする図の形', async (t) => {
  const payload = flow(['申請者', '上長'], [step('a', 0, 0, 'start', '出張が決まる'), step('b', 1, 1, 'end', '承認した')], [['a', 'b']]);
  await t.test('白紙の図・フローチャート・読めない種類（ER 図）を元にしても、スイムレーン図として出力できる', () => {
    for (const orig of [BLANK, { ...TRIP, diagramType: 'flowchart' }, { ...TRIP, diagramType: 'er' }]) {
      const out = exportBdmHtml(saved(orig), payload);
      assertSameFlow(out.html, payload, out);
    }
  });
  await t.test('図の中身がない HTML（保存していない MultipurposeDiagramMaker の本体）は read_failed', () => {
    failsWith(() => exportBdmHtml(BDM_APP, payload), 'read_failed', /MultipurposeDiagramMaker で保存した図の中身が見つかりません/);
  });
  await t.test('作業がない・形の違う渡す形は bad_request', () => {
    failsWith(() => exportBdmHtml(saved(TRIP), flow(['申請者'], [])), 'bad_request', /作業がないので、MPD に出力しません/);
    for (const bad of [null, { lanes: [], steps: 'x', edges: [] }, flow(['申請者'], [step('a', 1, 0, 'task', 'x')]), flow(['申請者'], [step('a', 0, -1, 'task', 'x')]),
      flow(['申請者'], [step('a', 0, 0, 'memo', 'x')]), flow(['申請者'], [step('a', 0, 0, 'task', 'x'), step('a', 0, 1, 'task', 'y')])]) {
      failsWith(() => exportBdmHtml(saved(TRIP), bad), 'bad_request', /スイムレーン図の形が正しくありません/);
    }
  });
  await t.test('矢印の両端の作業がない・自分への・同じ向きの 2 本目の矢印は外す', () => {
    const p = flow(['申請者'], [step('a', 0, 0, 'start', '始め'), step('b', 0, 1, 'end', '終わり')], [['a', 'b'], ['a', 'b'], ['a', 'a'], ['a', 'zz']]);
    assert.equal(extractBdmState(exportBdmHtml(saved(BLANK), p).html).edges.length, 1);
  });
});
