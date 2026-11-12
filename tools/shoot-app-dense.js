// tools/shoot-app.js の、線の多い図の場面（--only=dense。場面 278〜）。v1.05（図の接続線と PDF の縮小を見やすくする）の試作と確認に使う。
// 見本は架空の業務で、AI のツール（テスト用の窓口の aiDispatch）で組み立てる:
//   顧客管理 … 画面「顧客詳細」から 12 画面へ行き来する（1 つのボックスに線が集まる画面遷移図）
//   購買申請 … ステータス 20 個。「見送り」に 13 本、「下書き」に差し戻しが 3 本集まる（線の多いステータスの流れ）
// 試作の線（protoFlow）は、アプリの swimRoutes（スイムレーン図と同じ直角の線）に、出入りの位置（fromPin・toPin）と曲がる位置（mid）を渡して引き、
// 今の図の SVG と差し替えて撮る（アプリの本体の描き方は変えない）。
'use strict';

const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY = { schemaVersion: 3, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] };

// 顧客詳細から行き来する 12 画面: [画面の名前, 顧客詳細のボタンの文字]
const SUBS = [
  ['見積作成', '見積を作成する'], ['契約登録', '契約を登録する'], ['訪問記録', '訪問を記録する'], ['問い合わせ登録', '問い合わせを登録する'],
  ['請求書発行', '請求書を発行する'], ['入金確認', '入金を確認する'], ['担当者変更', '担当者を変更する'], ['住所変更', '住所を変更する'],
  ['解約受付', '解約を受け付ける'], ['資料送付', '資料を送付する'], ['点検予約', '点検を予約する'], ['メモ登録', 'メモを登録する'],
];
const STATES = ['下書き', '申請中', '課長承認待ち', '部長承認待ち', '社長決裁待ち', '決裁済み', '見積依頼中', '見積受領', '発注準備', '発注済み',
  '納期回答待ち', '納品待ち', '検収待ち', '検収済み', '請求書待ち', '請求書受領', '支払承認待ち', '支払済み', '完了', '見送り'];
const FORWARD = ['申請する', '受け付ける', '承認する', '承認する', '決裁する', '見積を依頼する', '見積を受け取る', '発注を準備する', '発注する', '納期を問い合わせる',
  '納期を登録する', '納品を受け取る', '検収する', '請求書を待つ', '請求書を受け取る', '支払を申請する', '支払を承認する', '完了にする'];
const ROLES = ['申請者', '購買担当', '課長', '部長', '社長', '購買担当', '購買担当', '購買担当', '購買担当', '購買担当',
  '購買担当', '申請者', '申請者', '経理担当', '経理担当', '経理担当', '経理課長', '経理担当'];

async function buildDense(page) {
  const call = async (tool, args) => {
    const r = await page.evaluate((t, a) => window.__test__.aiDispatch(t, a, { session: 's-1', client: 'claude-code' }), tool, args);
    if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  await call('create_design', { name: '顧客管理', target: 'kintone', description: '顧客の登録と、顧客ごとの手続き（架空の業務）' });
  await call('edit_screen', { design: '顧客管理', ops: [{ op: 'update', screen: '画面 1', name: '顧客一覧' }] });
  for (const name of ['顧客登録', '顧客詳細', ...SUBS.map((s) => s[0])]) await call('add_screen', { design: '顧客管理', name });
  const btn = (label, to, style = 'normal') => ({ type: 'button', label, style, to });
  await call('layout_screen', { design: '顧客管理', screen: '顧客一覧', layout: { columns: 2, rows: [
    [{ type: 'search' }, { type: 'filter' }],
    [{ type: 'link', label: '顧客名（押すと顧客詳細を開く）', to: '顧客詳細' }],
    { align: 'right', parts: [btn('＋ 顧客を登録する', '顧客登録', 'primary')] },
  ] } });
  await call('layout_screen', { design: '顧客管理', screen: '顧客登録', layout: { columns: 2, rows: [
    [{ type: 'text1', label: '顧客名' }, { type: 'text1', label: '電話番号' }],
    { align: 'right', parts: [btn('登録する', '顧客詳細', 'primary'), btn('キャンセル', '顧客一覧')] },
  ] } });
  await call('layout_screen', { design: '顧客管理', screen: '顧客詳細', layout: { columns: 4, rows: [
    [{ item: '顧客名', span: 2 }, { item: '電話番号', span: 2 }],
    ...[0, 4, 8].map((i) => SUBS.slice(i, i + 4).map(([to, label]) => btn(label, to))),
    { align: 'right', parts: [btn('一覧へ戻る', '顧客一覧')] },
  ] } });
  for (const [name] of SUBS) {
    await call('layout_screen', { design: '顧客管理', screen: name, layout: { columns: 2, rows: [
      [{ type: 'heading', label: name, span: 2 }],
      { align: 'right', parts: [btn('登録する', '顧客詳細', 'primary'), btn('キャンセル', '顧客詳細')] },
    ] } });
  }
  // 購買申請（ステータスの流れ）。条件の文は、16 字を超えるものを混ぜる（文字が切れる・重なるのを確かめるため）
  await call('create_design', { name: '購買申請', target: 'kintone', description: '物品の購買の申請から支払まで（架空の業務）' });
  const ops = [{ op: 'set_states', states: STATES }];
  FORWARD.forEach((name, i) => ops.push({ op: 'add_action', name, from: STATES[i], to: STATES[i + 1], role: ROLES[i] }));
  [2, 3, 4].forEach((i) => ops.push({ op: 'add_action', name: '差し戻す', from: STATES[i], to: '下書き', role: ROLES[i], cond: '申請の内容を書き直してほしいとき' }));
  for (let i = 1; i <= 13; i++) ops.push({ op: 'add_action', name: '取り下げる', from: STATES[i], to: '見送り', role: '申請者', ...(i % 4 === 1 ? { cond: '購買をやめるとき（理由を備考に書く）' } : {}) });
  ops.push({ op: 'add_action', name: '課長承認を省略する', from: '申請中', to: '部長承認待ち', role: '購買担当', cond: '申請者が課長のとき' });
  ops.push({ op: 'add_action', name: '見積を省略する', from: '決裁済み', to: '発注準備', role: '購買担当', cond: '合計金額が 10 万円未満のとき' });
  await call('edit_process', { design: '購買申請', ops });
  await call('layout_screen', { design: '購買申請', screen: '画面 1', layout: { columns: 2, rows: [[{ type: 'steps', span: 2 }], [{ type: 'status' }]] } });
  return page.evaluate(() => Object.fromEntries(window.__test__.store.state.designs.map((d) => [d.name, d.id])));
}

// 試作: 開いている画面遷移図を、直角の線で引き直す（ページの中で動く。外の変数は使えない）。
// opts: merge（同じ 2 つの画面の間の行きと帰りを 1 本の両矢印にまとめる）・grow（線の多いボックスを縦に伸ばす）
function protoFlow(opts) {
  const T = window.__test__;
  const d = T.currentDesign();
  const model = T.flowModel(T.store.state, d);
  const [W, H0, TRACK, LINE_H, MAXW] = [200, 64, 14, 14, 176];
  const charW = (ch) => (ch.charCodeAt(0) < 256 ? 6.6 : 12);
  const textW = (s) => [...s].reduce((w, ch) => w + charW(ch), 0);
  const clip = (s) => { // 幅 MAXW を超える文字は「…」で切る
    if (textW(s) <= MAXW) return s;
    let [out, w] = ['', 0];
    for (const ch of s) { if (w + charW(ch) > MAXW - 12) break; out += ch; w += charW(ch); }
    return out + '…';
  };
  // 1) 線。同じ 2 つの画面の間の行きと帰りをまとめる
  let edges = model.edges.map((e, i) => ({ from: e.from, to: e.to, kind: e.kind, id: `${e.from}|${e.to}|${e.kind}`, fwd: e.labels.slice(0, 3).map(clip), back: null, i }));
  if (opts.merge) {
    const seen = new Map();
    const out = [];
    edges.forEach((e) => {
      const m = seen.get(`${e.to}|${e.from}|${e.kind}`);
      if (m) { m.back = e.fwd; return; }
      seen.set(`${e.from}|${e.to}|${e.kind}`, e);
      out.push(e);
    });
    edges = out;
  }
  // 2) 出入りの辺（今の mapSides と同じ決まり）
  const sideOf = (a, b) => (b.x >= a.x + W ? ['right', 'left'] : b.x + W <= a.x ? ['left', 'right'] : b.y >= a.y ? ['bottom', 'top'] : ['top', 'bottom']);
  const pos0 = T.mapLayout(model);
  edges.forEach((e) => { [e.sa, e.sb] = sideOf(pos0[e.from], pos0[e.to]); });
  // 端に書く文字。opts.label が 'far' でなければ、ボタンのある画面の側の端（出る側に行きの文字、まとめた線は入る側に帰りの文字）。
  // 'far' は、線の少ない側の端に、行きと帰りの文字をまとめて書く（進む向きの矢印を頭に付ける）
  const sideCount = new Map();
  edges.forEach((e) => [[e.from, e.sa], [e.to, e.sb]].forEach(([k, s]) => sideCount.set(`${k}|${s}`, (sideCount.get(`${k}|${s}`) || 0) + 1)));
  const GLYPH = { right: ['→', '←'], left: ['←', '→'], top: ['↑', '↓'], bottom: ['↓', '↑'] }; // [その辺から出ていく向き, 入ってくる向き]
  const ends = [];
  edges.forEach((e) => {
    let [a, b] = [e.fwd, e.back || []];
    if (opts.label === 'far') {
      const atFrom = sideCount.get(`${e.from}|${e.sa}`) <= sideCount.get(`${e.to}|${e.sb}`);
      const side = atFrom ? e.sa : e.sb;
      const all = [...e.fwd.map((s) => `${GLYPH[side][atFrom ? 0 : 1]} ${s}`), ...(e.back || []).map((s) => `${GLYPH[side][atFrom ? 1 : 0]} ${s}`)];
      [a, b] = atFrom ? [all, []] : [[], all];
    }
    ends.push({ e, end: 'from', node: e.from, other: e.to, side: e.sa, lines: a });
    ends.push({ e, end: 'to', node: e.to, other: e.from, side: e.sb, lines: b });
  });
  const bySide = new Map();
  ends.forEach((p) => { const k = `${p.node}|${p.side}`; bySide.set(k, [...(bySide.get(k) || []), p]); });
  const pitchOf = (list) => Math.max(18, ...list.map((p) => (p.lines.length ? p.lines.length * LINE_H + 8 : 0)));
  const hOf = (key) => (!opts.grow ? H0 : Math.max(H0, ...['left', 'right'].map((s) => { const l = bySide.get(`${key}|${s}`) || []; return (l.length + 1) * pitchOf(l); })));
  // 3) 位置。列の間は、端の文字の幅と、通る線の数で広げる
  const pos1 = T.mapLayout(model, hOf);
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const rankOf = (k) => Math.round((pos1[k].x - 40) / 400);
  const maxRank = Math.max(0, ...[...linked].map(rankOf));
  const endW = (p) => (p.lines.length ? Math.max(...p.lines.map(textW)) + 16 : 0);
  const chan = [];
  for (let c = 0; c < maxRank; c++) {
    const adj = edges.filter((e) => linked.has(e.from) && Math.min(rankOf(e.from), rankOf(e.to)) === c && Math.max(rankOf(e.from), rankOf(e.to)) === c + 1);
    const through = edges.filter((e) => Math.min(rankOf(e.from), rankOf(e.to)) <= c && Math.max(rankOf(e.from), rankOf(e.to)) > c + 1).length;
    const leftEnds = adj.map((e) => (rankOf(e.from) === c ? ends.find((p) => p.e === e && p.end === 'from') : ends.find((p) => p.e === e && p.end === 'to')));
    const rightEnds = adj.map((e) => (rankOf(e.from) === c ? ends.find((p) => p.e === e && p.end === 'to') : ends.find((p) => p.e === e && p.end === 'from')));
    const [lw, rw] = [Math.max(24, ...leftEnds.map(endW)), Math.max(24, ...rightEnds.map(endW))];
    chan.push({ adj, lw, rw, gap: Math.max(120, lw + (adj.length + through + 2) * TRACK + rw) });
  }
  const colX = [40];
  chan.forEach((ch, c) => colX.push(colX[c] + W + ch.gap));
  const pos = {};
  model.nodes.forEach((n) => { pos[n.key] = { x: linked.has(n.key) ? colX[rankOf(n.key)] : pos1[n.key].x, y: pos1[n.key].y, h: hOf(n.key) }; });
  // 4) 出入りの位置（相手の位置の順に、辺に等間隔で並べる）
  const center = (k) => [pos[k].x + W / 2, pos[k].y + pos[k].h / 2];
  bySide.forEach((list) => {
    const lr = list[0].side === 'left' || list[0].side === 'right';
    list.sort((p, q) => center(p.other)[lr ? 1 : 0] - center(q.other)[lr ? 1 : 0] || p.e.i - q.e.i || (p.end === q.end ? 0 : p.end === 'from' ? -1 : 1));
    list.forEach((p, j) => { p.frac = (j + 1) / (list.length + 1); });
  });
  const ptOf = (p) => {
    const b = pos[p.node];
    return p.side === 'left' ? [b.x, b.y + b.h * p.frac] : p.side === 'right' ? [b.x + W, b.y + b.h * p.frac] : p.side === 'top' ? [b.x + W * p.frac, b.y] : [b.x + W * p.frac, b.y + b.h];
  };
  ends.forEach((p) => { p.pt = ptOf(p); });
  const endOf = (e, end) => ends.find((p) => p.e === e && p.end === end);
  // 5) 曲がる位置。隣の列への線は、列の間に 1 本ずつ縦の通り道を割り振る（下がる線は上のものほど右、上がる線は上のものほど左）
  chan.forEach((ch, c) => {
    const xl = colX[c] + W + ch.lw;
    const rows = ch.adj.map((e) => {
      const [a, b] = [endOf(e, 'from'), endOf(e, 'to')];
      const [l, r] = rankOf(e.from) === c ? [a, b] : [b, a];
      return { e, yl: l.pt[1], yr: r.pt[1] };
    }).filter((r) => Math.abs(r.yl - r.yr) >= 1);
    const up = rows.filter((r) => r.yr < r.yl).sort((p, q) => p.yl - q.yl);
    const down = rows.filter((r) => r.yr > r.yl).sort((p, q) => q.yl - p.yl);
    [...up, ...down].forEach((r, j) => { r.e.mid = xl + (j + 1) * TRACK; });
  });
  // 6) 線の道（スイムレーン図と同じ swimRoutes）
  const w = Math.max(...model.nodes.map((n) => pos[n.key].x + W)) + 80;
  const h = Math.max(...model.nodes.map((n) => pos[n.key].y + pos[n.key].h)) + 80;
  const input = () => ({ vertical: false, w, h, lanes: [],
    nodes: model.nodes.map((n) => ({ id: n.key, type: 'rect', x: pos[n.key].x, y: pos[n.key].y, w: W, h: pos[n.key].h })),
    edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, fromPin: { side: e.sa, frac: endOf(e, 'from').frac }, toPin: { side: e.sb, frac: endOf(e, 'to').frac }, ...(e.mid != null ? { mid: e.mid } : {}) })) });
  const times = [];
  let routes = null;
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); routes = T.swimRoutes(input()); times.push(performance.now() - t0); }
  // 7) SVG
  const styleOf = (e) => (e.kind === 'link' ? { col: '#16a34a', dash: ' stroke-dasharray="3 4"', mark: 'g' } : { col: '#1d3f6e', dash: '', mark: 'n' });
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const marker = (id, col) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`;
  const [lines, arcs, labels] = [[], [], []];
  // 文字の下地が、ボックス・先に置いた文字と重ならない所を探す（線の上 → 線の下 → 外へずらした上 → 外へずらした下。だめなら線の上）
  const placed = model.nodes.map((n) => ({ x: pos[n.key].x, y: pos[n.key].y, w: W, h: pos[n.key].h }));
  const hit = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
  const spot = (cands) => { const r = cands.find((c) => !placed.some((b) => hit(c, b))) || cands[0]; placed.push(r); return r; };
  edges.forEach((e) => {
    const r = routes[e.id];
    if (!r) return;
    const st = styleOf(e);
    lines.push(`<path d="${r.d}" fill="none" stroke="${st.col}" stroke-width="1.8"${st.dash} marker-end="url(#pf-arrow-${st.mark})"${e.back ? ` marker-start="url(#pf-arrow-${st.mark})"` : ''}/>`);
    r.arcs.forEach((a) => arcs.push(`<path d="${a}" fill="none" stroke="#fff" stroke-width="5"/><path d="${a}" fill="none" stroke="${st.col}" stroke-width="1.8"${st.dash}/>`));
    ['from', 'to'].forEach((end) => {
      const p = endOf(e, end);
      if (!p.lines.length) return;
      const tw = Math.max(...p.lines.map(textW)) + 8;
      const th = p.lines.length * LINE_H + 2;
      const lr = p.side === 'left' || p.side === 'right';
      // 左右の辺: ボックスを出てすぐの横の線の上に書く。上下の辺: 縦の線の右に書く
      const xAt = (k) => (p.side === 'right' ? p.pt[0] + 6 + k * (tw + 8) : p.pt[0] - 6 - tw - k * (tw + 8));
      const { x, y } = lr
        ? spot([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]].map(([k, below]) => ({ x: xAt(k), y: below ? p.pt[1] + 3 : p.pt[1] - 3 - th, w: tw, h: th })))
        : spot([{ x: p.pt[0] + 6, y: p.side === 'bottom' ? p.pt[1] + 6 : p.pt[1] - 6 - th, w: tw, h: th }, { x: p.pt[0] - 6 - tw, y: p.side === 'bottom' ? p.pt[1] + 6 : p.pt[1] - 6 - th, w: tw, h: th }]);
      labels.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${tw.toFixed(1)}" height="${th}" rx="3" fill="#fff" opacity=".92"/>`
        + p.lines.map((s, j) => `<text x="${(x + 4).toFixed(1)}" y="${(y + 11 + j * LINE_H).toFixed(1)}" font-size="12" font-weight="700" fill="${st.col}">${esc(s)}</text>`).join(''));
    });
  });
  const svg = `<svg width="${w}" height="${h}" font-family="'Segoe UI','Yu Gothic UI','Meiryo',sans-serif" aria-hidden="true"><defs>${marker('pf-arrow-n', '#1d3f6e')}${marker('pf-arrow-g', '#16a34a')}</defs>${lines.join('')}${arcs.join('')}${labels.join('')}</svg>`;
  // 8) 今の図と差し替える（確認ツールの中だけで使う。SVG の文字は上の esc を通してある）
  const inner = document.querySelector('#design-map .map-inner');
  inner.style.width = w + 'px';
  inner.style.height = h + 'px';
  inner.querySelector('svg').outerHTML = svg;
  inner.querySelectorAll('.mnode').forEach((el) => {
    const p = pos[el.dataset.node];
    Object.assign(el.style, { left: p.x + 'px', top: p.y + 'px', height: p.h + 'px' });
  });
  times.sort((a, b) => a - b);
  return { edges: edges.length, boxes: model.nodes.length, w, h, ms: Math.round(times[2] * 10) / 10, missing: edges.filter((e) => !routes[e.id]).length };
}

module.exports = async function shootDense(browser, env) {
  const { openDeskApp, OUT, VERSION, ROOT } = env;
  const page = await openDeskApp(browser, EMPTY);
  const ids = await buildDense(page);
  // 図の全体が入る窓の大きさにしてから、図の所だけを撮る
  const shootMap = async (name) => {
    const size = await page.evaluate(() => { const el = document.querySelector('#design-map .map-inner'); return { w: el.offsetWidth, h: el.offsetHeight }; });
    await page.setViewport({ width: Math.min(6000, size.w + 700), height: Math.min(6000, size.h + 320) });
    await sleep(120);
    const r = await page.evaluate(() => { const b = document.querySelector('#design-map .map-inner').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
    const file = path.join(OUT, `v${VERSION}_${name}.png`);
    await page.screenshot({ path: file, clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height } });
    console.log('saved', path.relative(ROOT, file), `${Math.round(r.width)}×${Math.round(r.height)}`);
  };
  const open = async (id, cmd) => {
    await page.setViewport({ width: 1600, height: 1000 });
    await page.evaluate((i, c) => { window.__test__.openDesign(i); window.__test__.runCommand(c); }, id, cmd);
    await sleep(150);
  };
  // 278: 今の画面遷移図（顧客詳細から 12 画面へ行き来する）
  await open(ids['顧客管理'], 'openFlow');
  await shootMap('278_dense_画面遷移図_今の線');
  // 279〜281: 試作の線
  for (const [name, opts] of [
    ['279_dense_画面遷移図_試作_行きと帰りを別の線', { merge: false, grow: true }],
    ['280_dense_画面遷移図_試作_行きと帰りを1本にまとめる', { merge: true, grow: true }],
    ['281_dense_画面遷移図_試作_ボックスを伸ばさない', { merge: true, grow: false }],
    ['285_dense_画面遷移図_試作_文字を線の少ない側に書く', { merge: true, grow: false, label: 'far' }],
  ]) {
    await open(ids['顧客管理'], 'openFlow');
    console.log(name, JSON.stringify(await page.evaluate(protoFlow, opts)));
    await shootMap(name);
  }
  // 282: 今のステータスの流れ（ステータス 20 個）
  await open(ids['購買申請'], 'openProcess');
  await shootMap('282_dense_ステータスの流れ_今の線');
  // 283・284: PDF（A4 横）の図のページと、縮小率
  for (const [name, scenes] of [['顧客管理', { 画面遷移図: '283_dense_PDF_画面遷移図（A4横）' }], ['購買申請', { ステータスの流れ: '284_dense_PDF_ステータスの流れ（A4横）' }]]) {
    const html = await page.evaluate((id) => {
      const T = window.__test__;
      return T.exportDocument(T.store.state.designs.find((x) => x.id === id), T.store.state, { paper: 'A4', orient: 'landscape', cover: true, map: true, items: true, process: true, flow: true }).html;
    }, ids[name]);
    const doc = await browser.newPage();
    await doc.setViewport({ width: 1200, height: 1200 });
    await doc.setContent(html, { waitUntil: 'load' });
    const info = await doc.$$eval('body > .pg', (els) => els.map((e) => ({
      title: (e.querySelector('.pg-head h2') || e.querySelector('.cv-title')).textContent,
      zoom: [...e.querySelectorAll('.xp-fit [style*="zoom"]')].map((x) => x.style.zoom).join(','),
    })));
    console.log(`PDF（A4 横・${name}）:`, info.map((p) => p.title + (p.zoom ? `〔倍率 ${p.zoom}〕` : '')).join('・'));
    const pages = await doc.$$('body > .pg');
    for (const [i, p] of info.entries()) {
      if (!scenes[p.title]) continue;
      const file = path.join(OUT, `v${VERSION}_${scenes[p.title]}.png`);
      await pages[i].screenshot({ path: file });
      console.log('saved', path.relative(ROOT, file));
    }
    await doc.close();
  }
  await page.close();
};
