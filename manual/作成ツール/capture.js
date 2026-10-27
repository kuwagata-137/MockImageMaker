// 使用説明書の画面の撮影。写し元は MultipurposeDiagramMaker の マニュアル/作成ツール/capture-puppeteer.js（注釈の描き方・切り抜き・_manifest.json）。
//
// 使い方（リポジトリのルートで）:
//   node manual/作成ツール/capture.js            … 全部の章を撮る（manual/images/ へ出す）
//   node manual/作成ツール/capture.js home edit  … 章を絞って撮る（_manifest.json は今あるものに足す）
//   その後 node manual/作成ツール/build.js で、アプリの中の使い方（manual/manual.html）と Word の別冊を作る
//
// ブラウザ: puppeteer（devDependencies）があればそれを、なければ playwright の Chromium を使う
//   （クラウドのセッションで npm が使えないときは NODE_PATH=/opt/node22/lib/node_modules で playwright を使う）。
//   差のある所（画面の大きさ・evaluate の引数）は下の薄い関数でそろえる。
// Linux では日本語が中国語の字体に落ちるので、IPA P ゴシックを先にする fonts.conf を一時ファイルに書いて FONTCONFIG_FILE で渡す（Windows では何もしない）。
// 窓は出さない（headless）。見本は架空の業務（出張申請システムなど）だけを使い、AI の道具（テスト用の窓口の aiDispatch）で組み立てる。
// 注釈（赤い枠・番号・カーソルの絵・矢印・札）は、撮る直前にページのいちばん上へ重ねる SVG で描き、撮ったら外す。
//   注釈の先が見つからないときは例外で止める（画面が変わって注釈が黙ってずれるのを防ぐ）。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => /^mock_v.*\.html$/.test(f));
const OUT = path.join(ROOT, 'manual', 'images');
const MANIFEST = path.join(OUT, '_manifest.json');
// 窓の大きさ。アプリを初めて開いたときの窓（1280 × 800）に合わせる。画像は 2 倍の細かさで撮る
const VW = 1280, VH = 800, DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
//  ブラウザ（puppeteer と playwright の差をそろえる）
// ============================================================
function setupLinuxFonts() {
  if (process.platform !== 'linux' || process.env.FONTCONFIG_FILE) return;
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <match target="pattern">
    <test name="lang" compare="contains"><string>ja</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>IPAPGothic</string></edit>
  </match>
  <alias binding="strong"><family>sans-serif</family><prefer><family>DejaVu Sans</family><family>IPAPGothic</family><family>Noto Color Emoji</family></prefer></alias>
  <selectfont><rejectfont><glob>/usr/share/fonts/truetype/wqy/*</glob><glob>/usr/share/fonts/opentype/unifont/*</glob></rejectfont></selectfont>
</fontconfig>
`;
  const p = path.join(os.tmpdir(), 'mim-manual-fonts.conf');
  fs.writeFileSync(p, conf);
  process.env.FONTCONFIG_FILE = p;
}

async function launch() {
  setupLinuxFonts();
  let pp = null;
  try { pp = require('puppeteer'); } catch (e) { /* playwright を使う */ }
  if (pp) {
    const opts = { headless: true, args: ['--no-sandbox'] };
    if (process.env.MIM_CHROME_PATH) opts.executablePath = process.env.MIM_CHROME_PATH;
    const browser = await pp.launch(opts);
    return {
      browser, kind: 'puppeteer',
      newPage: async () => {
        const p = await browser.newPage();
        await p.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
        // Windows のコントラストの表示（ハイコントラスト）のとき、Chrome はページの色を置き換える（白が暗い灰色に撮れた。2026-10-26）。置き換えを止めて撮る
        const cdp = await p.createCDPSession();
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
        return p;
      },
      setSize: (w, h) => page.setViewport({ width: w, height: h, deviceScaleFactor: DSF }),
      size: () => page.viewport(),
      initScript: (fn, arg) => page.evaluateOnNewDocument(fn, arg),
      eval: (fn, arg) => page.evaluate(fn, arg),
    };
  }
  const { chromium } = require('playwright');
  // 日付の欄の形（2026/11/02）は Chromium が環境変数 LANG で決める（locale の指定だけでは 11/02/2026 のまま）
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'ja_JP.UTF-8', LC_ALL: 'ja_JP.UTF-8', LANGUAGE: 'ja' } });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, locale: 'ja-JP', forcedColors: 'none' });
  return {
    browser, kind: 'playwright',
    newPage: () => ctx.newPage(),
    setSize: (w, h) => page.setViewportSize({ width: w, height: h }),
    size: () => page.viewportSize(),
    initScript: (fn, arg) => page.addInitScript(fn, arg),
    eval: (fn, arg) => page.evaluate(fn, arg),
  };
}

// ============================================================
//  ページの中で動かす: 注釈と場所の求め方（ページを開くたびに入れ直す）
// ============================================================
function pageHelpers() {
  const NSV = 'http://www.w3.org/2000/svg';
  const RED = '#dc2626';
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // 先 → 画面の上の四角 {x,y,w,h}。先は 'セレクタ' ／ {sel, text, i, pad} ／ {c:[x,y,w,h]}（画面の座標）／ 配列（全部を囲む）
  const box = (t) => {
    if (Array.isArray(t)) {
      const bs = t.map(box);
      const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
      const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (typeof t === 'string') t = { sel: t };
    let b;
    if (t.sel) {
      let els = [...document.querySelectorAll(t.sel)].filter(vis);
      if (t.text) els = els.filter((el) => el.textContent.includes(t.text));
      if (t.i != null) els = els[t.i] ? [els[t.i]] : [];
      if (!els.length) throw new Error('注釈の先が見つかりません: ' + t.sel + (t.text ? ' / ' + t.text : ''));
      const rs = els.map((el) => el.getBoundingClientRect());
      const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top));
      const x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (t.c) {
      b = { x: t.c[0], y: t.c[1], w: t.c[2], h: t.c[3] };
    } else throw new Error('注釈の先の書き方が違います: ' + JSON.stringify(t));
    const pad = t.pad || 0;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  };
  // 点: [x,y]（画面の座標）／ {...先, at:'c|t|b|l|r|tl|tr|bl|br', dx, dy}
  const pt = (p) => {
    if (Array.isArray(p)) return p;
    if (typeof p === 'string') p = { sel: p };
    const b = box(p), at = p.at || 'c';
    let x = b.x + b.w / 2, y = b.y + b.h / 2;
    if (at.includes('l')) x = b.x;
    if (at.includes('r')) x = b.x + b.w;
    if (at.includes('t')) y = b.y;
    if (at.includes('b')) y = b.y + b.h;
    return [x + (p.dx || 0), y + (p.dy || 0)];
  };
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NSV, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  // 注釈を描く。返すのは描いたものを囲む四角（切り抜きに含めるため）
  const draw = (items) => {
    clear();
    const W = innerWidth, H = innerHeight;
    const host = document.createElement('div');
    host.id = '__mnl_anno';
    host.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:2147483647`;
    const svg = mk('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    host.appendChild(svg);
    document.body.appendChild(host);
    const defs = mk('defs', {}, svg);
    const mar = mk('marker', { id: '__mnl_ah', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    mk('path', { d: 'M0,0 L10,5 L0,10 z', fill: RED }, mar);
    const ext = [];
    const grow = (x0, y0, x1, y1) => ext.push([x0, y0, x1, y1]);
    const badge = (x, y, num, r) => {
      r = r || 12;
      mk('circle', { cx: x, cy: y, r: r + 1.5, fill: '#fff' }, svg);
      mk('circle', { cx: x, cy: y, r, fill: RED }, svg);
      const t = mk('text', { x, y: y + r * 0.38, 'text-anchor': 'middle', 'font-size': r * 1.15, 'font-weight': 700, fill: '#fff', 'font-family': 'Arial,sans-serif' }, svg);
      t.textContent = String(num);
      grow(x - r - 2, y - r - 2, x + r + 2, y + r + 2);
    };
    const label = (x, y, text, side, fs) => { // side: 'r'＝(x,y) の右に／'l'＝左に／'b'＝下に／'t'＝上に
      fs = fs || 13;
      const t = mk('text', { 'font-size': fs, 'font-weight': 700, fill: '#991b1b', 'font-family': 'sans-serif' }, svg);
      t.textContent = text;
      const tw = t.getComputedTextLength(), ph = fs + 10, pw = tw + 16;
      let bx = x, by = y - ph / 2;
      if (side === 'l') bx = x - pw;
      if (side === 'b') { bx = x - pw / 2; by = y; }
      if (side === 't') { bx = x - pw / 2; by = y - ph; }
      bx = Math.max(2, Math.min(W - pw - 2, bx)); by = Math.max(2, Math.min(H - ph - 2, by));
      const r = mk('rect', { x: bx, y: by, width: pw, height: ph, rx: 5, fill: '#fff', stroke: RED, 'stroke-width': 1.8 }, svg);
      svg.insertBefore(r, t);
      t.setAttribute('x', bx + 8); t.setAttribute('y', by + ph / 2 + fs * 0.36);
      grow(bx, by, bx + pw, by + ph);
    };
    const cursor = (x, y) => { // 矢印のカーソル（先が (x,y)）
      const g = mk('g', { transform: `translate(${x},${y}) scale(1.35)` }, svg);
      mk('path', { d: 'M0,0 L0,17 L4.2,13 L7.3,20 L10,18.8 L7,12 L12.5,12 Z', fill: '#fff', stroke: '#111', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, g);
      grow(x - 2, y - 2, x + 19, y + 29);
    };
    for (const it of items) {
      if (it.box) {
        const b = box(it.box);
        const p = it.pad != null ? it.pad : 4;
        const x = b.x - p, y = b.y - p, w = b.w + p * 2, h = b.h + p * 2;
        mk('rect', { x, y, width: w, height: h, rx: it.rx != null ? it.rx : 6, fill: 'none', stroke: RED, 'stroke-width': it.sw || 3, 'stroke-dasharray': it.dash ? '8,5' : 'none' }, svg);
        grow(x - 2, y - 2, x + w + 2, y + h + 2);
        if (it.n != null) {
          const at = it.at || 'tl', r = it.r || 12;
          let bx = x, by = y;
          if (at.includes('r')) bx = x + w;
          if (at.includes('b')) by = y + h;
          if (at === 't' || at === 'b') bx = x + w / 2;
          if (at === 'l' || at === 'r') by = y + h / 2;
          bx += it.bdx || 0; by += it.bdy || 0;
          badge(bx, by, it.n, r);
          if (it.label) label(bx + (it.labelSide === 'l' ? -r - 4 : r + 4), by, it.label, it.labelSide || 'r', it.fs);
        }
      }
      if (it.badge != null) { const [x, y] = pt(it.at); badge(x, y, it.badge, it.r); }
      if (it.arrow) {
        const [x0, y0] = pt(it.arrow[0]), [x1, y1] = pt(it.arrow[1]);
        mk('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: RED, 'stroke-width': it.sw || 3, 'stroke-dasharray': it.solid ? 'none' : '7,5', 'marker-end': 'url(#__mnl_ah)' }, svg);
        grow(Math.min(x0, x1) - 6, Math.min(y0, y1) - 6, Math.max(x0, x1) + 6, Math.max(y0, y1) + 6);
      }
      if (it.cursor) { const [x, y] = pt(it.cursor); cursor(x, y); }
      if (it.text) { const [x, y] = pt(it.at); label(x, y, it.text, it.side || 'r', it.fs); }
    }
    if (!ext.length) return null;
    const x0 = Math.min(...ext.map((e) => e[0])), y0 = Math.min(...ext.map((e) => e[1]));
    const x1 = Math.max(...ext.map((e) => e[2])), y1 = Math.max(...ext.map((e) => e[3]));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const clear = () => { const el = document.getElementById('__mnl_anno'); if (el) el.remove(); };
  window.__mnl = { box, pt, draw, clear };
}

// ============================================================
//  撮影の共通の処理
// ============================================================
let B, page;
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const ev = (fn, arg) => B.eval(fn, arg);
const pt = (p) => ev((q) => window.__mnl.pt(q), p);

const box = (t) => ev((q) => window.__mnl.box(q), t);

// ページの中で動かす（読み込む前に置く）: 保存の中身を空にし、デスクトップ版の窓口の身代わりを置く
function seedPage(o) {
  window.__test__ = {};
  localStorage.clear();
  localStorage.setItem('mockimagemaker.v1', JSON.stringify({ schemaVersion: o.schemaVersion, settings: { customTargets: [], mapPos: {} }, systems: [], designs: [] }));
  if (!o.desk) return;
  const docs = 'C:\\Users\\user\\Documents\\';
  window.exportAPI = {
    saveHtml: async (p) => ({ ok: true, path: docs + p.name }),
    savePdf: async (p) => ({ ok: true, path: docs + p.name }),
    savePng: async (p) => ({ ok: true, count: p.files.length, path: p.files[0].name, dir: docs }),
    openHtml: async () => ({ ok: false, canceled: true }),
  };
  // AI の窓口（「AI とつなぐ」の窓と紫の札）。つながっている AI は window.__aiStatus で変える
  window.aiAPI = {
    onRequest: () => {}, onStatus: (fn) => { window.__aiStatus = fn; }, ready: () => {},
    connectInfo: async () => o.connectInfo, copyText: async () => true,
  };
  // 資料の窓口（資料の入口を出すため。ファイルは読まない）
  const canceled = async () => ({ ok: false, canceled: true });
  window.materialsAPI = {
    available: true, pick: canceled, addDropped: canceled, read: canceled, bdmPlan: canceled, bdmExport: canceled,
    sweep: async () => ({ ok: true, removedFiles: 0, removedDirs: 0 }), removeSystem: async () => ({ ok: true, removed: 0 }),
  };
}

// 新しいページでアプリを開き直す（章ごとに開き直し、前の章の操作と、前に置いた読み込み前の処理が残らないようにする）
async function open(opts = {}) {
  if (page) await page.close();
  page = await B.newPage();
  page.on('pageerror', (e) => { console.error('ページの失敗:', e.message); });
  await B.setSize(opts.size ? opts.size[0] : VW, opts.size ? opts.size[1] : VH);
  const html = fs.readFileSync(path.join(ROOT, HTML_NAME), 'utf8');
  const schemaVersion = Number((html.match(/const SCHEMA_VERSION = (\d+)/) || [])[1] || 3);
  // 「AI とつなぐ」の窓の登録の文（インストールした版の形。場所は見本）
  const { connectInfo } = require(path.join(ROOT, 'automation-connect.js'));
  const where = 'C:\\Users\\user\\AppData\\Local\\Programs\\MockImageMaker';
  const info = connectInfo({ packaged: true, execPath: where + '\\MockImageMaker.exe', resourcesPath: where + '\\resources', root: ROOT });
  await B.initScript(seedPage, { schemaVersion, desk: opts.desk !== false, connectInfo: info });
  await page.goto(pathToFileURL(path.join(ROOT, HTML_NAME)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__test__ && window.__test__.ready);
  await ev(pageHelpers);
  await sleep(150);
}

// AI の道具で見本を組む（テスト用の窓口 aiDispatch）。失敗したら止める
async function call(tool, args) {
  const r = await ev((a) => window.__test__.aiDispatch(a[0], a[1], { session: 'manual', client: 'claude-code' }), [tool, args]);
  if (!r.ok) throw new Error(`${tool}: ${JSON.stringify(r.error)}`);
  return r;
}
// AI の紫の印（カードの札・帯）を外して最初の画面に戻る（見本を AI の道具で組んだ跡を写さない）
async function clearAiMarks() {
  await ev(() => { const T = window.__test__; T.aiView.cards.clear(); T.aiView.band = null; T.goHome(); });
  await sleep(150);
}

// 押す先が窓の外にあれば、窓の中へ送ってから動かす
async function move(p) {
  if (!Array.isArray(p)) {
    await ev((q) => {
      if (typeof q === 'string') q = { sel: q };
      if (!q.sel) return;
      let els = [...document.querySelectorAll(q.sel)];
      if (q.text) els = els.filter((el) => el.textContent.includes(q.text));
      const el = q.i != null ? els[q.i] : els[0];
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, p);
  }
  const [x, y] = await pt(p);
  await page.mouse.move(x, y, { steps: 6 });
  return [x, y];
}
async function click(p) { const [x, y] = await move(p); await page.mouse.down(); await page.mouse.up(); await sleep(150); return [x, y]; }

// 撮る。opts:
//   clip … 省略＝画面の全体（JPEG）／先（box と同じ書き方）＝その範囲を切り抜く（PNG）
//   pad  … 切り抜きの余白（CSS の px・既定 16）
//   anno … 注釈の並び（pageHelpers の draw）
async function shot(name, opts = {}) {
  let annoBox = null;
  if (opts.anno && opts.anno.length) annoBox = await ev((a) => window.__mnl.draw(a), opts.anno);
  await sleep(60);
  const { width: vw, height: vh } = B.size();
  let clip = null;
  if (opts.clip) {
    let b = await box(opts.clip);
    if (annoBox) {
      const x0 = Math.min(b.x, annoBox.x), y0 = Math.min(b.y, annoBox.y);
      const x1 = Math.max(b.x + b.w, annoBox.x + annoBox.w), y1 = Math.max(b.y + b.h, annoBox.y + annoBox.h);
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const p = opts.pad != null ? opts.pad : 16;
    const x0 = Math.max(0, Math.floor(b.x - p)), y0 = Math.max(0, Math.floor(b.y - p));
    const x1 = Math.min(vw, Math.ceil(b.x + b.w + p)), y1 = Math.min(vh, Math.ceil(b.y + b.h + p));
    clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  const fmt = opts.fmt || (clip ? 'png' : 'jpeg');
  const file = name + (fmt === 'png' ? '.png' : '.jpg');
  const so = { path: path.join(OUT, file), type: fmt };
  if (fmt === 'jpeg') so.quality = 85;
  if (clip) so.clip = clip;
  // puppeteer は切り抜くとき、既定で窓の大きさを一時的に変える。アプリは窓の大きさが変わるとシステムのメニューを閉じるので、変えずに撮る
  if (clip && B.kind === 'puppeteer') so.captureBeyondViewport = false;
  await page.screenshot(so);
  await ev(() => window.__mnl.clear());
  manifest[name] = { file, w: clip ? clip.width : vw, h: clip ? clip.height : vh, dsf: DSF };
  console.log(`  ${file}  ${manifest[name].w}×${manifest[name].h}`);
}

// ============================================================
//  見本（架空の業務: 出張申請システム）
// ============================================================
const SYS = '出張申請システム';
const T = (fn, arg) => ev(fn, arg); // ページの中で window.__test__ を使う短い書き方
const designId = (name) => T((n) => window.__test__.store.state.designs.find((d) => d.name === n).id, name);
const systemId = () => T((n) => window.__test__.store.state.systems.find((y) => y.name === n).id, SYS);
// 画面の部品を、項目名か文字で探して id を返す（AI の道具の get_screen）
async function partId(design, screen, label) {
  const r = await call('get_screen', { design, screen });
  const p = r.result.parts.find((x) => x.label === label);
  if (!p) throw new Error(`アイテムが見つかりません: ${design} ／ ${screen} ／ ${label}`);
  return p.id;
}

// 見本を組む。システム 1 つ（役割 3・画面設計 3・スイムレーン・資料・設計ノート）と、システムに入っていない画面設計 2 つ
// 画面設計は、作る先が kintone・Salesforce でも標準の見た目で作る（使用説明書の画像の多くは標準の見た目で説明する。ほかの見た目は 3.10 の looks で撮る）
async function sampleAll({ notes = true, materials = true } = {}) {
  await call('create_system', { name: SYS, description: '出張の事前申請と、上長の承認、旅費の精算までをまとめるシステム。紙の申請書と押印をやめ、申請から精算までの進捗を、誰でも見られるようにする。' });
  await call('update_system', { system: SYS, ops: [
    { op: 'add', name: '申請者', memo: '出張する社員' }, { op: 'add', name: '上長', memo: '申請者の課の課長' }, { op: 'add', name: '経理', memo: '経理課の担当者' },
  ] });

  // 社員マスタ（出張申請のルックアップ元）
  await call('create_design', { name: '社員マスタ', target: 'kintone', look: 'standard', description: '社員の番号・氏名・所属', system: SYS });
  await call('edit_items', { design: '社員マスタ', ops: [
    { op: 'add', name: '社員番号', type: 'text1', required: true }, { op: 'add', name: '氏名', type: 'text1', required: true },
    { op: 'add', name: '所属', type: 'text1' }, { op: 'add', name: '役職', type: 'dropdown', props: { options: ['一般', '主任', '課長', '部長'] } },
  ] });
  await call('add_screen', { design: '社員マスタ', template: 'list', name: '一覧' });
  await call('add_screen', { design: '社員マスタ', template: 'detail', name: '詳細' });
  await call('edit_screen', { design: '社員マスタ', ops: [{ op: 'delete', screen: '画面 1' }] });

  // 出張申請
  await call('create_design', { name: '出張申請', target: 'kintone', look: 'standard', description: '出張の事前申請と、上長の承認', system: SYS });
  await call('edit_items', { design: '出張申請', ops: [
    { op: 'add', name: '申請者', type: 'user', required: true },
    { op: 'add', name: '社員番号', type: 'text1', required: true },
    { op: 'add', name: '行き先', type: 'text1', required: true, props: { maxLen: '50' } },
    { op: 'add', name: '交通手段', type: 'radio', props: { options: ['電車', '飛行機', '車'], initial: '電車' } },
    { op: 'add', name: '出発日', type: 'date', required: true },
    { op: 'add', name: '帰着日', type: 'date', required: true },
    { op: 'add', name: '概算の金額', type: 'number', props: { unit: '円', min: '0' } },
    { op: 'add', name: '目的', type: 'text2', memo: '訪問先と用件を書く' },
  ] });
  await call('edit_items', { design: '出張申請', ops: [
    { op: 'lookup', item: '社員番号', lookup: { design: '社員マスタ', key: '社員番号', copies: [{ from: '氏名', to: '氏名', create: true }, { from: '所属', to: '所属', create: true }] } },
  ] });
  await call('edit_items', { design: '出張申請', ops: [{ op: 'move', item: '氏名', after: '社員番号' }, { op: 'move', item: '所属', after: '氏名' }] });
  await call('edit_process', { design: '出張申請', ops: [
    { op: 'set_states', states: ['申請', '承認待ち', '承認済み', '精算済み'] },
    { op: 'add_action', name: '申請する', from: '申請', to: '承認待ち', role: '申請者' },
    { op: 'add_action', name: '承認する', from: '承認待ち', to: '承認済み', role: '上長', cond: '概算の金額が 10 万円まで' },
    { op: 'add_action', name: '差し戻す', from: '承認待ち', to: '申請', role: '上長' },
    { op: 'add_action', name: '精算を済ませる', from: '承認済み', to: '精算済み', role: '経理' },
  ] });
  await call('edit_screen', { design: '出張申請', ops: [{ op: 'update', screen: '画面 1', name: '一覧' }] });
  await call('add_screen', { design: '出張申請', template: 'blank', name: '新規申請' });
  await call('add_screen', { design: '出張申請', template: 'detail', name: '詳細' });
  await call('add_screen', { design: '出張申請', template: 'steps', name: '承認' });

  // 旅費精算（出張申請から項目を取り込む）
  await call('create_design', { name: '旅費精算', target: 'kintone', look: 'standard', description: '出張から戻った後の旅費の精算', system: SYS });
  await call('edit_items', { design: '旅費精算', ops: [
    { op: 'import', from: '出張申請', items: ['行き先', '出発日', '帰着日'] },
    { op: 'add', name: '交通費', type: 'number', props: { unit: '円' } },
    { op: 'add', name: '宿泊費', type: 'number', props: { unit: '円' } },
    { op: 'add', name: '合計', type: 'calc', props: { formula: '交通費 + 宿泊費', unit: '円' } },
    { op: 'add', name: '領収書', type: 'file' },
  ] });
  await call('edit_screen', { design: '旅費精算', ops: [{ op: 'update', screen: '画面 1', name: '精算の入力' }] });
  await call('layout_screen', { design: '旅費精算', screen: '精算の入力', mode: 'replace', layout: { columns: 2, rows: [
    [{ item: '行き先' }], [{ item: '出発日' }, { item: '帰着日' }], [{ item: '交通費' }, { item: '宿泊費' }], [{ item: '合計' }], [{ item: '領収書', span: 2 }],
    { align: 'right', parts: [{ type: 'button', label: '精算する', style: 'primary' }] },
  ] } });

  // 出張申請の画面（移る先の画面と画面設計ができてから並べる）
  await call('layout_screen', { design: '出張申請', screen: '一覧', mode: 'replace', layout: { columns: 2, rows: [
    [{ type: 'search' }],
    [{ type: 'table', label: '出張申請の一覧', tableKind: 'records', rows: 6, span: 2, props: { columns: ['申請者', '行き先', '出発日', '概算の金額', 'ステータス'] } }],
    { align: 'right', parts: [{ type: 'pager' }] },
    { align: 'left', parts: [{ type: 'button', label: '＋ 新規申請', style: 'primary', to: '新規申請' }, { type: 'link', label: '旅費精算へ', to: { design: '旅費精算', screen: '精算の入力' } }] },
  ] } });
  await call('layout_screen', { design: '出張申請', screen: '新規申請', mode: 'replace', layout: { columns: 2, rows: [
    [{ item: '申請者' }, { item: '社員番号' }], [{ item: '氏名' }, { item: '所属' }], [{ item: '行き先', sample: '大阪支店' }, { item: '交通手段' }],
    [{ item: '出発日' }, { item: '帰着日' }], [{ item: '概算の金額', sample: '32,000' }], [{ item: '目的', span: 2 }],
    { align: 'right', parts: [{ type: 'button', label: '申請する', style: 'primary', to: '詳細' }, { type: 'button', label: 'キャンセル', style: 'normal', to: '一覧' }] },
  ] } });
  await call('edit_callouts', { design: '出張申請', screen: '新規申請', ops: [
    { op: 'add', text: '10 万円を超えるときは、部長の承認も要る', target: await partId('出張申請', '新規申請', '概算の金額') },
  ] });

  // システムに入っていない画面設計
  await call('create_design', { name: '取引先マスタ', target: 'Salesforce', look: 'standard', description: '取引先の会社名と担当者' });
  await call('layout_screen', { design: '取引先マスタ', screen: '画面 1', layout: { columns: 2, rows: [
    [{ item: '会社名', type: 'text1' }, { item: '担当者', type: 'text1' }], [{ item: '電話番号', type: 'text1' }],
  ] } });
  await call('create_design', { name: '日報', target: 'Claude で作るアプリ', description: '毎日の作業の記録' });
  await call('layout_screen', { design: '日報', screen: '画面 1', layout: { columns: 1, rows: [[{ item: '日付', type: 'date' }], [{ item: '作業の内容', type: 'text2' }]] } });

  // スイムレーン図
  await call('set_swimlane', { system: SYS, steps: [
    { key: 's', role: '申請者', kind: 'start', text: '出張が決まる' },
    { key: 'a', role: '申請者', kind: 'input', text: '出張申請を入力する', ref: { design: '出張申請', screen: '新規申請' } },
    { key: 'b', role: '上長', kind: 'decision', text: '申請を確かめる', ref: { design: '出張申請', screen: '承認', state: '承認待ち' } },
    { key: 'c', role: '申請者', kind: 'task', text: '出張に行く' },
    { key: 'd', role: '申請者', kind: 'input', text: '旅費の精算を入力する', ref: { design: '旅費精算', screen: '精算の入力' } },
    { key: 'e', role: '経理', kind: 'task', text: '精算を確かめて支払う' },
    { key: 'f', role: '経理', kind: 'end', text: '終わり' },
  ], edges: [
    { from: 's', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a', label: '差し戻し' }, { from: 'b', to: 'c', label: '承認' },
    { from: 'c', to: 'd' }, { from: 'd', to: 'e' }, { from: 'e', to: 'f' },
  ] });

  if (notes) {
    await call('update_notes', { system: SYS, ops: [
      { op: 'set_findings', text: '・今は紙の出張申請書に書き、上長の押印をもらってから出張している。\n・出張から戻ったら、旅費精算書に領収書を貼って経理へ出す。\n・申請書の欄: 申請者・社員番号・所属・行き先・交通手段・出発日・帰着日・概算の金額・目的。' },
      { op: 'add_decision', stage: 'read', text: '紙の出張申請書の欄を、そのままデータベースの項目にする', reason: '申請者が今の様式と同じ順で書けるため' },
      { op: 'add_decision', stage: 'flow', text: '概算の金額が 10 万円を超える出張は、部長の承認も要る', reason: '旅費規程の第 5 条のため' },
      { op: 'add_decision', stage: 'items', text: '氏名と所属は、社員番号から社員マスタをルックアップして入れる', reason: '申請者が毎回書かなくてよいため' },
      { op: 'add_question', stage: 'flow', text: '差し戻した申請を、申請者が取り下げられるか' },
      { op: 'add_question', stage: 'items', text: '日当を、申請のときに書くか、精算のときに書くか' },
    ] });
    const n = (await call('get_notes', { system: SYS })).result;
    const q = n.questions.find((x) => x.text.startsWith('差し戻した'));
    await call('update_notes', { system: SYS, ops: [{ op: 'answer_question', id: q.id, answer: '取り下げられる（ステータスを「取り下げ」にする）' }] });
    await call('set_stage', { system: SYS, stage: 'read', state: 'done' });
    await call('set_stage', { system: SYS, stage: 'flow', state: 'done' });
    await call('set_stage', { system: SYS, stage: 'items', state: 'review' });
  }
  if (materials) {
    const rows = [
      { id: 'm-1', name: '出張申請書（今の様式）.xlsx', kind: 'excel', size: 49152, file: 'm-1.xlsx', memo: '今の紙の様式' },
      { id: 'm-2', name: '旅費規程.pdf', kind: 'pdf', size: 1258291, file: 'm-2.pdf', memo: '日当の決まりは第 5 条' },
      { id: 'm-3', name: '今の出張申請の流れ.html', kind: 'bdm', size: 231424, file: 'm-3.html', memo: '総務が描いた今の流れ' },
    ];
    await T(([name, rows]) => {
      const t = window.__test__;
      const y = t.store.state.systems.find((s) => s.name === name);
      const added = t.actions.addMaterials(y.id, rows.map(({ memo, ...r }) => r));
      added.forEach((m, i) => { if (rows[i].memo) t.actions.setMaterialMemo(y.id, m.id, rows[i].memo); });
    }, [SYS, rows]);
  }
}

// 画面設計を開く（画面の名前を書けば、その画面を開く）。拡大縮小の倍率 zoom を書けば、その倍率にして左上へ送る
async function openDesignAt(name, screen, { zoom } = {}) {
  await T(([n, s]) => {
    const t = window.__test__;
    const d = t.store.state.designs.find((x) => x.name === n);
    t.openDesign(d.id);
    if (s) t.openScreen(d.screens.find((x) => x.name === s).id);
  }, [name, screen || null]);
  await sleep(250);
  if (zoom) await setZoom(zoom);
}
async function setZoom(z) {
  for (let i = 0; i < 30; i++) {
    const cur = await T(() => window.__test__.ui.zoom);
    if (Math.abs(cur - z) < 0.01) break;
    await T((c) => window.__test__.runCommand(c), cur > z ? 'zoomOut' : 'zoomIn');
  }
  await T(() => { const w = document.querySelector('#canvas-wrap'); if (w) { w.scrollLeft = 0; w.scrollTop = 0; } });
  await sleep(200);
}
// 真ん中の欄（#canvas-wrap）を、要素の左上が欄の左上から gap の所に来るように送る
async function scrollCanvasTo(sel, gap = 16) {
  await T(([q, g]) => {
    const w = document.querySelector('#canvas-wrap'), el = document.querySelector(q);
    const wr = w.getBoundingClientRect(), r = el.getBoundingClientRect();
    w.scrollLeft += r.left - wr.left - g; w.scrollTop += r.top - wr.top - g;
  }, [sel, gap]);
  await sleep(150);
}
// 要素を、それを含む欄（中で送れる箱）の中だけで送り、上から gap の所に出す（ページ全体は送らない）
async function scrollInBox(sel, text, gap = 4) {
  await T(([q, tx, g]) => {
    let els = [...document.querySelectorAll(q)];
    if (tx) els = els.filter((x) => x.textContent.includes(tx));
    const el = els[0];
    let c = el.parentElement;
    while (c && !(c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    if (c) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - g;
    document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
  }, [sel, text || null, gap]);
  await sleep(150);
}
// 真ん中の欄を、いくつかの要素をまとめた範囲の左上が欄の左上から gap の所に来るように送る
async function scrollCanvasToAll(sels, gap = 16) {
  await T(([qs, g]) => {
    const w = document.querySelector('#canvas-wrap'), wr = w.getBoundingClientRect();
    const rs = qs.map((q) => document.querySelector(q).getBoundingClientRect());
    w.scrollLeft += Math.min(...rs.map((r) => r.left)) - wr.left - g; w.scrollTop += Math.min(...rs.map((r) => r.top)) - wr.top - g;
  }, [sels, gap]);
  await sleep(150);
}
// 窓を高くして撮る（右の欄が窓の高さで切れないように）。撮ったら元の高さに戻す
// （右の欄の上の部品の箱は、設定の欄に 340 ドットだけを残して伸びるので、撮る間だけ隠す）
async function shotTall(name, opts, h = 1500) {
  await B.setSize(VW, h);
  await T(() => { const b = document.querySelector('#side-box'); if (b) b.style.display = 'none'; });
  await sleep(250);
  await shot(name, opts);
  await T(() => { const b = document.querySelector('#side-box'); if (b) b.style.display = ''; });
  await B.setSize(VW, VH);
  await sleep(200);
}
// マウスを窓の右下の端へ置き、フォーカスを外す（カードの「…」やボタンの色が、マウスを置いた形で写らないように）
const rest = async () => { await page.mouse.move(VW - 2, VH - 2); await T(() => { if (document.activeElement) document.activeElement.blur(); }); await sleep(100); };
// 左の画面の一覧と、ページ全体を上へ戻す
const listTop = () => T(() => { const l = document.querySelector('#screen-list'); if (l) l.scrollTop = 0; document.documentElement.scrollTop = 0; });
const run = (cmd) => T((c) => window.__test__.runCommand(c), cmd);
// 窓（showDialog）を開く。窓が閉じるまで待たない
const openDlg = async (fnName, arg) => { await T(([f, a]) => { window.__test__[f](a); }, [fnName, arg]); await sleep(300); };
// 窓を閉じる（キャンセル）
const closeDlg = async () => { await T(() => { const b = document.querySelector('.modal [data-dlg="cancel"]'); if (b) b.click(); }); await sleep(200); };
async function toastGone() { await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !t || t.hidden; }, null, { timeout: 10000 }).catch(() => {}); }
const waitToast = toastGone;

// 画面設計の改訂履歴から、AI の自動の行（AI が直す前の状態）を外す（見本を AI の道具で組んだ跡を、改訂履歴の章に写さない）。元に戻すの履歴も消す
async function dropAiRows() {
  await T(() => {
    const t = window.__test__;
    t.store.commit((s) => { s.designs.forEach((d) => { d.revisions = d.revisions.filter((r) => r.kind !== 'ai'); }); });
    t.store.clearHistory();
  });
  await sleep(150);
}
// 単体で開いて編集できる HTML を、デスクトップ版の窓口を置かない新しいページで開く（ベンダーがブラウザで開いた形）
async function openStandalone(design) {
  const html = await T((n) => { const t = window.__test__; const d = t.store.state.designs.find((x) => x.name === n); return t.buildStandaloneHtml(d, t.store.state); }, design);
  const file = path.join(os.tmpdir(), 'mim-manual-standalone.html');
  fs.writeFileSync(file, html);
  await page.close();
  page = await B.newPage();
  page.on('pageerror', (e) => { console.error('ページの失敗:', e.message); });
  await B.setSize(VW, VH);
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await sleep(600);
  await ev(pageHelpers);
}

// 印刷用の文書（PDF の中身）のページを、別のページで開いて撮る。pages は撮るページの番号（0 から。負の数は後ろから）と名前の組
async function shootDocPages(html, list) {
  const file = path.join(os.tmpdir(), 'mim-manual-doc.html');
  fs.writeFileSync(file, html);
  const ctx = page.context ? page.context() : null;
  const p2 = ctx ? await ctx.newPage() : await B.browser.newPage();
  if (!ctx) await p2.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
  await p2.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await sleep(300);
  for (const [i, name] of list) {
    const els = await p2.$$('body > *');
    const el = els[i < 0 ? els.length + i : i];
    const out = path.join(OUT, name + '.png');
    await el.screenshot({ path: out });
    const bb = await el.boundingBox();
    manifest[name] = { file: name + '.png', w: Math.round(bb.width), h: Math.round(bb.height), dsf: DSF };
    console.log(`  ${name}.png  ${manifest[name].w}×${manifest[name].h}`);
  }
  await p2.close();
}

// ============================================================
//  章ごとの撮影
// ============================================================
const CHAPTERS = {
  // 2 章 最初の画面
  async home() {
    await open();
    await sampleAll();
    await clearAiMarks();
    await shot('home_overview', { anno: [
      { box: '.home-head h1', n: 1 },
      { box: '.home-tools', n: 2 },
      { box: '.sys-list', n: 3 },
      { box: '.sys-block .sys-head', n: 4 },
      { box: { sel: '.sys-block .card', i: 0 }, n: 5 },
    ] });
    await shot('home_card', { clip: { sel: '.sys-block .card', i: 0 }, anno: [{ box: { sel: '.sys-block .card .card-more', i: 0 }, n: 1, at: 'tr', pad: 2 }] });
    // カードの「…」のメニュー
    await click({ sel: '.sys-block .card .card-more', i: 0 });
    await shot('home_cardmenu', { clip: [{ sel: '.sys-block .card', i: 0 }, '.card-menu'], pad: 12 });
    await page.keyboard.press('Escape');
    // ごみ箱（日報を移してから開く）
    await T(() => { const t = window.__test__; t.actions.trashDesign(t.store.state.designs.find((d) => d.name === '日報').id); t.goHome(); });
    await sleep(200);
    await toastGone();
    await click('#home-trash .trash-toggle');
    await T(() => { const el = document.querySelector('#home-trash'); el.scrollIntoView({ block: 'end' }); });
    await sleep(200);
    await shot('home_trash', { clip: '#home-trash', pad: 10 });
    // つながりの図
    await T(() => { window.__test__.goHome(); window.scrollTo(0, 0); document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); });
    await sleep(150);
    await click({ sel: '.home-tools .btn', text: '関連図' });
    await sleep(400);
    await shot('home_map');
  },
  // 2.2 新しい画面設計を作る
  async newdesign() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await shot('new_step1', { clip: [{ sel: '.home-tools .btn', text: 'HTML を取り込む' }, { sel: '.home-tools .btn', text: '新しいシステム' }], pad: 14,
      anno: [{ box: { sel: '.home-tools .btn', text: '新しい画面設計' }, n: 1, at: 'l', pad: 3 }] });
    await click({ sel: '.home-tools .btn', text: '新しい画面設計' });
    await sleep(200);
    await page.keyboard.type('備品貸出');
    await shot('new_step2', { clip: '.modal', pad: 12, anno: [
      { box: '.modal input[name="name"]', n: 1, at: 'l', pad: 3 },
      { box: { sel: '.modal .btn', text: '画面設計を作って開く' }, n: 2, at: 'l', pad: 3 },
    ] });
    await click({ sel: '.modal .btn', text: '画面設計を作って開く' });
    await page.waitForFunction(() => window.__test__.ui.view === 'editor');
    await sleep(300);
    await shot('new_step3');
  },
  // 3 章 画面設計を描く
  async editor() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    await scrollCanvasTo('#stage .screen', 16);
    await shot('ed_overview', { anno: [
      { box: '#toolbar', n: 1, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
      { box: '#screen-list', n: 2, pad: -4, bdx: 16, bdy: 16 },
      { box: '#stage .screen', n: 3 },
      { box: '#stage .callout', n: 4 },
      { box: '#side-box', n: 5, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
      { box: '#side-settings', n: 6, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
    ] });
    // 部品の設定の一覧表
    await setZoom(0.8);
    await scrollCanvasTo('#stage .ptable', 24);
    await shot('ed_ptable', { clip: '#stage .ptable', pad: 8 });

    // 3.2 部品を置く: 部品の箱の「テキスト（1行）」を画面へドラッグする
    await setZoom(0.5);
    await scrollCanvasTo('#stage .screen', 16);
    await scrollInBox('#side-box .pal-group', '基本', 4);
    // 置く先: 右の列の「概算の金額」の行（空いている所）
    const travel = await partId('出張申請', '新規申請', '帰着日');
    const target = { sel: `#stage .part[data-part-id="${travel}"]`, at: 'l', dx: 12, dy: 53 };
    await shot('ed_place1', { anno: [
      { box: '.pal-btn[data-type="text1"]', n: 1, pad: 2 },
      { arrow: [{ sel: '.pal-btn[data-type="text1"]', at: 'l' }, target] },
      { cursor: target },
    ] });
    const [fx, fy] = await move('.pal-btn[data-type="text1"]');
    const [tx, ty] = await pt(target);
    await page.mouse.down();
    await page.mouse.move(fx - 20, fy, { steps: 4 });
    await page.mouse.move(tx, ty, { steps: 12 });
    await page.mouse.up();
    await sleep(300);
    await shot('ed_place2', { anno: [{ box: '#stage .part.sel', n: 1 }, { box: '#side-settings', n: 2, pad: -4, at: 'tr', bdx: -16, bdy: 16 }] });
    await run('undo');
    await sleep(200);

    // 3.3 選ぶ・動かす・揃える: 3 つを Ctrl を押しながら選び、「揃える」の組を出す
    await run('deselectPart');
    const ids = [];
    for (const l of ['行き先', '出発日', '概算の金額']) ids.push(await partId('出張申請', '新規申請', l));
    await click({ sel: `#stage .part[data-part-id="${ids[0]}"]`, at: 'c' });
    await page.keyboard.down('Control');
    await click({ sel: `#stage .part[data-part-id="${ids[1]}"]`, at: 'c' });
    await click({ sel: `#stage .part[data-part-id="${ids[2]}"]`, at: 'c' });
    await page.keyboard.up('Control');
    await click('.fold-btn[data-fold="align"]');
    await sleep(200);
    await shot('ed_align', { anno: [
      { box: '.fold-btn[data-fold="align"]', n: 1, pad: 2, at: 'l' },
      { box: '.rgroup.open > .fold-pop', n: 2, pad: 2, at: 'bl' },
    ] });
    await page.keyboard.press('Escape');
    // 3.3 の「編集」の組（q122）: 組のボタンを押して、縦に 1 列に並んだ編集のボタンを出す（ツールバーの左から「項目」の組までを切り抜く）
    await click('.fold-btn[data-fold="edit"]');
    await sleep(200);
    await shot('ed_edit', { clip: [{ sel: '#toolbar .rgroup', text: 'ファイル' }, '#toolbar .rgroup[data-fold="items"]', '.rgroup.open > .fold-pop'], pad: 8, anno: [
      { box: '.fold-btn[data-fold="edit"]', n: 1, pad: 2, at: 'l' },
      { box: '.rgroup.open > .fold-pop', n: 2, pad: 2, at: 'r' },
    ] });
    await page.keyboard.press('Escape');
    await T(() => { if (document.activeElement) document.activeElement.blur(); });
    await run('deselectPart');

    // 3.4 部品の設定: 「行き先」を選んだときの右の欄
    await T((id) => window.__test__.selectPart(id), ids[0]);
    await sleep(200);
    await shotTall('ed_settings', { clip: '#side-settings > *', pad: 12 });
    await run('deselectPart');

    // 3.5 データベースの項目の一覧表
    await run('openItems');
    await sleep(300);
    await shot('ed_items', { anno: [
      { box: { sel: '#screen-list .db-entry', i: 0 }, n: 1, pad: 2 },
      { box: { sel: '#db-view button', text: '項目を追加する' }, n: 2, pad: 2, at: 'l' },
      { box: { sel: '#db-view button', text: 'ほかの画面設計から項目を取り込む' }, n: 3, pad: 2, at: 'r' },
    ] });
    // 3.6 ルックアップ: 項目の一覧表で「社員番号」を選んだときの右の欄
    await T(() => { const t = window.__test__; const d = t.currentDesign(); t.selectItem(d.items.find((i) => i.name === '社員番号').id); });
    await sleep(250);
    await shotTall('ed_lookup_set', { clip: '#side-settings > *', pad: 12 });
    // 画面の上のルックアップの印
    await openDesignAt('出張申請', '新規申請', { zoom: 1 });
    await scrollCanvasTo('#stage .screen', 8);
    const [a1, a2] = [await partId('出張申請', '新規申請', '社員番号'), await partId('出張申請', '新規申請', '所属')];
    await scrollCanvasTo(`#stage .part[data-part-id="${a1}"]`, 24);
    await shot('ed_lookup_parts', { clip: [`#stage .part[data-part-id="${a1}"]`, `#stage .part[data-part-id="${a2}"]`], pad: 12 });

    // 3.6 ほかのモックから項目を取り込む窓（旅費精算から開き、出張申請を選ぶ）
    await openDesignAt('旅費精算', '精算の入力');
    await run('importItems');
    await sleep(300);
    await T(() => { const b = [...document.querySelectorAll('.modal button, .modal [role="option"], .modal li')].find((x) => x.textContent.includes('出張申請')); if (b) b.click(); });
    await sleep(250);
    await shot('ed_import', { clip: '.modal', pad: 12 });
    await closeDlg();

    // 3.7 表: 一覧の画面のレコード一覧を選んだときの右の欄
    await openDesignAt('出張申請', '一覧', { zoom: 0.5 });
    await T(async () => {
      const t = window.__test__; const sc = t.currentScreen();
      t.selectPart(sc.parts.find((p) => p.type === 'table').id);
    });
    await sleep(250);
    await shotTall('ed_table', { clip: '#side-settings > *', pad: 12 });
    await run('deselectPart');

    // 3.8 吹き出し
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    const money = await partId('出張申請', '新規申請', '概算の金額');
    await scrollCanvasToAll([`#stage .part[data-part-id="${money}"]`, '#stage .callout'], 24);
    await shot('ed_callout', { clip: [`#stage .part[data-part-id="${money}"]`, '#stage .callout'], pad: 24 });
  },

  // 4 章 複数の画面と移り方
  // 3.10 見た目を変える（出張申請を Salesforce・kintone の見た目にして撮る）
  async looks() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await call('update_design', { design: '出張申請', look: 'salesforce', bandTabs: ['ホーム', '出張申請', '旅費精算', 'レポート'] });
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    await scrollCanvasTo('#stage .screen', 16);
    await scrollInBox('#side-settings .field', '見た目', 8);
    await shot('look_panel', { anno: [
      { box: { sel: '#side-settings .field', text: '見た目' }, n: 1, pad: 2 },
      { box: { sel: '#side-settings .field', text: 'ヘッダーのタブ' }, n: 2, pad: 2 },
      { box: '#stage .screen-band', n: 3 },
    ] });
    await call('update_design', { design: '出張申請', look: 'kintone' });
    await setZoom(0.6);
    await scrollCanvasTo('#stage .screen', 16);
    await shot('look_kt', { clip: '#stage .screen', pad: 4 });
    // 表示の形: Salesforce の見た目の詳細の画面
    await call('update_design', { design: '出張申請', look: 'salesforce' });
    await call('edit_screen', { design: '出張申請', ops: [{ op: 'update', screen: '詳細', itemView: 'show' }] });
    await openDesignAt('出張申請', '詳細', { zoom: 0.5 });
    await scrollCanvasTo('#stage .screen', 16);
    await scrollInBox('#side-settings .field', '項目の表示', 8);
    await shot('look_show', { anno: [
      { box: { sel: '#side-settings .field', text: '項目の表示' }, n: 1, pad: 2 },
      { box: '#stage .screen', n: 2 },
    ] });
  },
  // 3.5 kintone のフィールドの欄・4.3 進み具合の矢印の分かれる終わり（第 13 段階）
  async kintone() {
    await open();
    await sampleAll({ notes: false, materials: false });
    // 出張申請（作る先 kintone）の「申請者」を作成者（自動で入る）にし、「行き先」にフィールドコードを書く
    await call('edit_items', { design: '出張申請', ops: [
      { op: 'update', item: '申請者', kintone: { type: 'CREATOR' } },
      { op: 'update', item: '行き先', kintone: { code: 'destination' } },
    ] });
    // ステータスに「却下」を足し、承認待ちから分かれる終わりにする。承認の画面の進み具合の矢印の見本は却下
    await call('edit_process', { design: '出張申請', ops: [
      { op: 'set_states', states: ['申請', '承認待ち', '承認済み', '精算済み', '却下'] },
      { op: 'add_action', name: '却下する', from: '承認待ち', to: '却下', role: '上長' },
    ] });
    const steps = await T(() => {
      const d = window.__test__.store.state.designs.find((x) => x.name === '出張申請');
      return d.screens.find((x) => x.name === '承認').parts.find((p) => p.type === 'steps').id;
    });
    await call('edit_parts', { design: '出張申請', screen: '承認', ops: [{ op: 'update', part: steps, current: '却下' }] });
    await clearAiMarks();
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    await scrollCanvasTo('#stage .screen', 16);
    const who = await partId('出張申請', '新規申請', '申請者');
    await T((id) => window.__test__.selectPart(id), who);
    await sleep(250);
    await scrollInBox('#side-settings .pf-sep', 'kintone のフィールド', 32);
    await shot('ed_kintone', { anno: [
      { box: `#stage .part[data-part-id="${who}"]`, n: 1, pad: 2 },
      { box: { sel: '#side-settings .field', text: 'kintone の種類' }, n: 2, pad: 2 },
      { box: { sel: '#side-settings .field', text: 'フィールドコード' }, n: 3, pad: 2 },
    ] });
    await run('deselectPart');
    await openDesignAt('出張申請', '承認', { zoom: 0.8 });
    await scrollCanvasTo(`#stage .part[data-part-id="${steps}"]`, 24);
    await shot('sc_steps_branch', { clip: `#stage .part[data-part-id="${steps}"]`, pad: 24 }); // 左の外の赤い番号も入れる
  },
  // 3.11 レコードの画面を描く（第 14 段階）: ひな形「顧客の詳細」の画面と、グループ枠・レコードの見出し・並べて表示の設定、ツリー
  async crm() {
    await open();
    await call('create_design', { name: '顧客管理', target: 'Salesforce', look: 'salesforce', description: '取引先の会社の情報と、担当者・商談・問い合わせ' });
    await call('add_screen', { design: '顧客管理', template: 'crmDetail', name: '顧客の詳細' });
    await call('edit_screen', { design: '顧客管理', ops: [{ op: 'delete', screen: '画面 1' }] });
    // ツリー（一覧画面用）は、別の画面に 1 つだけ置いて撮る
    await call('add_screen', { design: '顧客管理', template: 'blank', name: '契約書の一覧' });
    await call('layout_screen', { design: '顧客管理', screen: '契約書の一覧', layout: { columns: 4, rows: [[{ type: 'tree' }]] } });
    await clearAiMarks();
    const ids = await T(() => {
      const d = window.__test__.store.state.designs.find((x) => x.name === '顧客管理');
      const of = (name, type) => d.screens.find((s) => s.name === name).parts.find((p) => p.type === type).id;
      return { head: of('顧客の詳細', 'recordHead'), frame: of('顧客の詳細', 'frame'), act: of('顧客の詳細', 'activity'), tiles: of('顧客の詳細', 'table'), tree: of('契約書の一覧', 'tree') };
    });
    const part = (id) => `#stage .part[data-part-id="${id}"]`;
    await openDesignAt('顧客管理', '顧客の詳細', { zoom: 0.5 });
    await scrollCanvasTo('#stage .screen', 16);
    await shot('rec_page', { anno: [
      { box: part(ids.head), n: 1 },
      { box: part(ids.frame), n: 2 },
      { box: part(ids.act), n: 3 },
      { box: part(ids.tiles), n: 4, at: 'tr' },
    ] });
    for (const [name, id] of [['rec_frame_set', ids.frame], ['rec_head_set', ids.head]]) {
      await T((x) => window.__test__.selectPart(x), id);
      await sleep(250);
      await shotTall(name, { clip: '#side-settings > *', pad: 12 });
    }
    // 並べて表示の設定は、右のパネルの「表の名前」から「アイコンの色」までを切り取る（パネル全体は縦に長いため）
    await T((x) => window.__test__.selectPart(x), ids.tiles);
    await sleep(250);
    await shotTall('rec_tiles_set', { clip: [{ sel: '#side-settings .field', text: '表の名前' }, { sel: '#side-settings .field', text: 'アイコンの色' }], pad: 12 });
    await run('deselectPart');
    await openDesignAt('顧客管理', '契約書の一覧', { zoom: 1 });
    await scrollCanvasTo(part(ids.tree), 24);
    await shot('rec_tree', { clip: part(ids.tree), pad: 24 }); // 左の外の上の赤い番号も入れる
  },
  async screens() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    // 画面を足す窓
    await click('#screen-list .sl-add');
    await sleep(300);
    await shotTall('sc_add', { clip: '.modal', pad: 12 }, 1100); // ひな形が 9 つになり、窓の高さ 800 には入らない（第 14 段階）
    await closeDlg();
    // 画面の一覧の「…」のメニュー
    await move({ sel: '#screen-list .sl-item', i: 1 });
    await click({ sel: '#screen-list .sl-more', i: 1 });
    await sleep(200);
    await shot('sc_menu', { clip: ['#screen-list', '.screen-menu'], pad: 4 });
    await page.keyboard.press('Escape');
    await T(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.mouse.move(VW - 4, VH - 4);
    // ステータスの移り方
    await run('openProcess');
    await sleep(400);
    await listTop();
    await shot('sc_process', { anno: [
      { box: { sel: '#screen-list .db-entry', text: 'ステータスの流れ' }, n: 1, pad: 2 },
      { box: '#db-view', n: 2, pad: -4, bdx: 16, bdy: 16 },
      { box: '#side-settings', n: 3, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
    ] });
    // 画面の移り方
    await run('openFlow');
    await sleep(400);
    await listTop();
    await shot('sc_flow', { anno: [{ box: { sel: '#screen-list .db-entry', text: '画面遷移図' }, n: 1, pad: 2 }] });
  },

  // 5 章 改訂履歴
  async revisions() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await dropAiRows();
    const did = await designId('出張申請');
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    // メニューバーの「改訂履歴」の ▼ のメニュー
    await click('#tb-rev-arrow');
    await sleep(200);
    await shot('rv_menu', { clip: [{ sel: '#toolbar .rgroup', text: '改訂' }, '#rev-menu-root > *'], pad: 10 });
    await page.keyboard.press('Escape');
    await T(() => { if (document.activeElement) document.activeElement.blur(); });
    // 第 1 版を残し、項目を 1 つ足して変える
    const rev1 = await T((id) => window.__test__.actions.addRevision(id, { note: '最初の版。ベンダーに見積もりを依頼した。', day: '2026-10-01' }), did);
    await call('edit_items', { design: '出張申請', ops: [{ op: 'add', name: '日当', type: 'number', props: { unit: '円' }, memo: '旅費規程の第 5 条で決まる' }] });
    await call('layout_screen', { design: '出張申請', screen: '新規申請', mode: 'append', layout: { columns: 2, rows: [[{ item: '日当' }]] } });
    await clearAiMarks();
    await dropAiRows();
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    // 改訂する窓
    await openDlg('openAddRevisionDialog');
    await page.keyboard.type('日当の欄を追加した。');
    await shot('rv_add', { clip: '.modal', pad: 12, anno: [
      { box: '.modal [name="rv-note"]', n: 1, at: 'l', pad: 3 },
      { box: '.modal .rv-cg', n: 2, at: 'tr', pad: 2 },
    ] });
    await click('.modal [data-dlg="ok"]');
    await sleep(300);
    await toastGone();
    // 改訂履歴の窓
    await openDlg('openRevisionsDialog');
    await shot('rv_list', { clip: '.modal', pad: 12 });
    await closeDlg();
    // 前の版を見る（黄色い帯）
    await T((id) => window.__test__.startViewRevision(id), rev1);
    await sleep(300);
    await shot('rv_view', { anno: [{ box: '#rv-band', n: 1, pad: 0, at: 'b', bdx: -120, bdy: 4 }] });
    await T(() => window.__test__.leaveViewing());
    await sleep(200);
    // PDF の違いの印（第 1 版と比べる）
    const doc = await T(([id, r]) => {
      const t = window.__test__; const d = t.store.state.designs.find((x) => x.id === id);
      const sc = d.screens.find((x) => x.name === '新規申請');
      return t.exportDocument(d, t.store.state, { ...t.exportOpts, cover: false, map: false, items: false, process: false, flow: false, screenIds: [sc.id], diffRevId: r }).html;
    }, [did, rev1]);
    await shootDocPages(doc, [[-1, 'rv_diffpage']]);
  },

  // 6 章 出力と受け渡し
  async export() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await dropAiRows();
    const did = await designId('出張申請');
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    await shot('ex_button', { clip: { sel: '#toolbar .rgroup', text: 'ファイル' }, pad: 6, anno: [{ box: { sel: '#toolbar .bigbtn', text: '画面設計を出力する' }, n: 1, pad: 2 }] });
    await run('exportDialog');
    await sleep(300);
    await shot('ex_pdf', { clip: '.modal', pad: 12 });
    await click('.modal [data-xkind="html"]');
    await shot('ex_html', { clip: '.modal', pad: 12 });
    await click('.modal [data-xkind="png"]');
    await shot('ex_png', { clip: '.modal', pad: 12 });
    await closeDlg();
    // 取り込む: 出力した HTML（ベンダーが直したもの）と、アプリの中の今の中身が違うときの確かめの窓
    const html = await T((id) => { const t = window.__test__; const d = t.store.state.designs.find((x) => x.id === id); return t.buildStandaloneHtml(d, t.store.state); }, did);
    await call('edit_items', { design: '出張申請', ops: [{ op: 'add', name: '日当', type: 'number', props: { unit: '円' } }] });
    await clearAiMarks();
    await T((h) => { window.__test__.importHtmlText(h); }, html);
    await sleep(400);
    await shot('ex_import', { clip: '.modal', pad: 12 });
    await closeDlg();
  },

  // 7 章 システム
  async system() {
    await open();
    await sampleAll();
    await clearAiMarks();
    const yid = await systemId();
    // 新しいシステムの窓
    await run('newSystem');
    await sleep(300);
    await page.keyboard.type('備品管理システム');
    await shot('sys_new', { clip: '.modal', pad: 12 });
    await closeDlg();
    // システムの画面（概要）
    await T((id) => window.__test__.openSystem(id, { panel: 'overview' }), yid);
    await sleep(400);
    await shot('sys_overview', { anno: [
      { box: '#toolbar', n: 1, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
      { box: { sel: '#sys-list .sys-entry', text: '概要' }, n: 2, pad: 2, at: 'tr', bdx: -10 },
      { box: '#sys-list .sys-dhead', n: 3, pad: 4, at: 'tr', bdx: -10 },
      { box: '#sys-view .itable', n: 4, pad: 2 },
      { box: '#sys-side', n: 5, pad: -4, at: 'bl', bdx: 16, bdy: -16 },
    ] });
    // 「＋ 画面設計を入れる ▾」のメニュー
    await click('#sys-list [data-action="sys-add-menu"]');
    await sleep(200);
    await T(() => { if (document.activeElement) document.activeElement.blur(); });
    await shot('sys_insert', { clip: ['#sys-list [data-action="sys-add-menu"]', '.sys-pop'], pad: 10 });
    await page.keyboard.press('Escape');
    await T(() => { const l = document.querySelector('#sys-list'); if (l) l.scrollTop = 0; });
    await rest();
    // 役割
    await T(() => window.__test__.openSystemPanel('roles'));
    await sleep(300);
    await shot('sys_roles', { clip: '#sys-view > *', pad: 12 });
    // スイムレーン図（作業を選んだところ）
    await T(() => window.__test__.openSystemPanel('swimlane'));
    await sleep(300);
    await T(() => window.__test__.runCommand('zoomFit'));
    await sleep(300);
    const sid = await T((id) => window.__test__.store.state.systems.find((y) => y.id === id).swimlane.steps.find((x) => x.text === '申請を確かめる').id, yid);
    await T((id) => window.__test__.selectStep(id), sid);
    await sleep(300);
    await shot('sys_swim', { anno: [
      { box: '#toolbar', n: 1, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
      { box: '#sys-swim', n: 2, pad: 2 },
      { box: '#sys-box', n: 3, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
      { box: '#sys-side', n: 4, pad: -4, at: 'tr', bdx: -16, bdy: 16 },
    ] });
    await T(() => window.__test__.selectStep(null));
    // 資料
    await T(() => window.__test__.openSystemPanel('materials'));
    await sleep(300);
    await shot('sys_materials', { clip: '#sys-view > *', pad: 12 });
    // 設計ノート
    await T(() => window.__test__.openSystemPanel('notes'));
    await sleep(300);
    await shot('sys_notes');
    // 履歴
    await T(() => window.__test__.openSystemPanel('history'));
    await sleep(300);
    await shot('sys_history', { clip: '#sys-view > *', pad: 12 });
    // メニューバーの「出力」の小さなメニュー
    await T(() => window.__test__.openSystemPanel('swimlane'));
    await sleep(300);
    await click('#toolbar [data-action="export"]');
    await sleep(200);
    await shot('sys_exportmenu', { clip: [{ sel: '#toolbar .rgroup', text: 'ファイル' }, '.sys-pop'], pad: 10 });
    // 説明書（PDF）の窓
    await click({ sel: '.sys-pop [role="menuitem"]', text: 'システム設計書' });
    await sleep(300);
    await shot('sys_doc', { clip: '.modal', pad: 12 });
    await closeDlg();
    // MPD に出力（元にする MPD を選ぶ窓）
    await click('#toolbar [data-action="export"]');
    await sleep(200);
    await click('.sys-pop [data-action="sys-export-mpd"]');
    await sleep(300);
    await shot('sys_mpd', { clip: '.modal', pad: 12 });
    await closeDlg();
  },

  // 8 章 AI とつなぐ
  async ai() {
    await open();
    await sampleAll({ notes: false, materials: false });
    // AI が作った画面設計のカード（紫の札）
    await T(() => window.__test__.goHome());
    await sleep(300);
    await shot('ai_cards', { clip: { sel: '.sys-block', i: 0 }, pad: 8 });
    await clearAiMarks();
    // AI がつながっている（紫の札）
    await T(() => window.__aiStatus({ clients: [{ session: 's1', client: 'claude-code' }] }));
    await sleep(200);
    await shot('ai_chip', { clip: '.brandbar', pad: 0 });
    // AI とつなぐ窓
    await B.setSize(VW, 1150);
    await run('aiConnect');
    await sleep(500);
    await shot('ai_connect', { clip: '.modal', pad: 12 });
    await B.setSize(VW, VH);
    await closeDlg();
    // 開いている画面設計を AI が直したとき（紫の帯と、光る枠）
    await openDesignAt('出張申請', '新規申請', { zoom: 0.5 });
    await T(() => window.__test__.aiDispatch('edit_items', { design: '出張申請', ops: [{ op: 'update', item: '行き先', props: { maxLen: '100' } }] }, { session: 's1', client: 'claude-code' }));
    await sleep(500);
    await shot('ai_band', { anno: [{ box: '#ai-bands', n: 1, pad: 0, at: 'b', bdx: -120, bdy: 4 }] });
  },

  // 9 章 ベンダーの方へ
  async vendor() {
    await open();
    await sampleAll({ notes: false, materials: false });
    await clearAiMarks();
    await dropAiRows();
    const did = await designId('出張申請');
    await T((id) => window.__test__.actions.addRevision(id, { note: '最初の版。', day: '2026-10-01' }), did);
    // PDF の表紙と画面のページ
    const doc = await T((id) => {
      const t = window.__test__; const d = t.store.state.designs.find((x) => x.id === id);
      const sc = d.screens.find((x) => x.name === '新規申請');
      return t.exportDocument(d, t.store.state, { ...t.exportOpts, map: false, items: false, process: false, flow: false, screenIds: [sc.id] }).html;
    }, did);
    await shootDocPages(doc, [[0, 'vd_pdf_cover'], [-1, 'vd_pdf_screen']]);
    // 単体で開いた HTML（ブラウザ）
    await openStandalone('出張申請');
    // 50% にして、画面の全体が見えるようにする（縮小のボタンを押す。テスト用の窓口はないので、倍率の札の文字で確かめる）
    for (let i = 0; i < 10; i++) {
      const z = await T(() => { const b = [...document.querySelectorAll('#toolbar .zoom-label')].find((x) => x.offsetParent); return b ? b.textContent.trim() : ''; });
      if (z === '50%') break;
      await click({ sel: '#toolbar [data-action="zoom-out"]' });
    }
    await scrollCanvasTo('#stage .screen', 16);
    await rest();
    await shot('vd_html', { anno: [
      { box: '#sa-bar', n: 1, pad: 0, at: 'b', bdx: -200, bdy: 4 },
      { box: { sel: '#sa-bar button', text: 'HTML を保存する' }, n: 2, pad: 3, at: 'l' },
    ] });
  },
};

// ブラウザを起こす（ほかの台本から使うときも、これを最初に呼ぶ）
async function start() {
  B = await launch();
  return B;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const names = want.length ? want : Object.keys(CHAPTERS);
  for (const n of names) if (!CHAPTERS[n]) throw new Error('知らない章の名前: ' + n + '（' + Object.keys(CHAPTERS).join('・') + '）');
  await start();
  console.log(`ブラウザ: ${B.kind}・窓 ${VW}×${VH}・${DSF} 倍`);
  try {
    for (const n of names) {
      console.log(`[${n}]`);
      await CHAPTERS[n]();
    }
  } finally {
    const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
    fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 1) + '\n');
    await B.browser.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { start, open, call, clearAiMarks, shot, ev, click, move, sleep, sampleAll, openDesignAt, setZoom, CHAPTERS, page: () => page, browser: () => B };
