// 使用説明書を組む。原稿は content.js（ブロックの並び）、画像は capture.js が manual/images/ に撮ったもの（寸法は _manifest.json）。
// 写し元は MultipurposeDiagramMaker の マニュアル/作成ツール/create-manual.js（Word の組み方）。リポジトリのルートで:
//   node manual/作成ツール/build.js          … manual/manual.html（アプリの「ヘルプ > 使い方」で開く）と、
//                                              manual/モックイメージメーカー_使用説明書_v<版>.docx（Word の別冊）を作る
//   node manual/作成ツール/build.js --html   … HTML だけを作る（Word を組む docx のパッケージがないときなど）
// docx は devDependencies のもの、なければ NODE_PATH（クラウドのセッションでは /opt/node22/lib/node_modules）から読む。
// manual.html は、同じ原稿と画像からは同じ中身になる（作った日時を入れない）。test/manual.test.js が、作り直したものと同じかを確かめる。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANUAL = path.join(ROOT, 'manual');
const IMG_DIR = path.join(MANUAL, 'images');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => /^mock_v.*\.html$/.test(f));
const APP_VERSION = 'v' + fs.readFileSync(path.join(ROOT, HTML_NAME), 'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
// 原稿を直したら、この日付も直す（作るたびに今日の日付にすると、中身が同じでも manual.html が変わるため）
const LAST_UPDATED = '2026年10月23日';
const DOCX_NAME = `モックイメージメーカー_使用説明書_${APP_VERSION}.docx`;

function loadContent() {
  return require('./content.js')({ APP_VERSION, LAST_UPDATED });
}
function loadManifest() {
  const p = path.join(IMG_DIR, '_manifest.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

// ===================================================================
//  画像の寸法（HTML と Word で同じ考え方）
// ===================================================================
function makeShots(manifest) {
  const used = new Set();
  const info = (name) => {
    const m = manifest[name];
    if (!m) throw new Error('画像がありません（capture.js で撮ってください）: ' + name);
    const fp = path.join(IMG_DIR, m.file);
    if (!fs.existsSync(fp)) throw new Error('画像のファイルがありません: ' + fp);
    used.add(name);
    return { ...m, name, fp, type: m.file.endsWith('.png') ? 'png' : 'jpg' };
  };
  return { info, used };
}
// 表示の大きさ: width ＞ scale ＞（画面の全体＝maxW／切り抜き＝cropScale 倍）。maxW・maxH で上限
function dispSize(m, o, d) {
  let w;
  if (o.width) w = o.width;
  else if (o.scale) w = m.w * o.scale;
  else w = m.type === 'jpg' ? d.maxW : m.w * d.cropScale;
  w = Math.min(w, o.maxW || d.maxW);
  let h = w * m.h / m.w;
  if (o.maxH && h > o.maxH) { h = o.maxH; w = h * m.w / m.h; }
  return { w: Math.round(w), h: Math.round(h) };
}

// ===================================================================
//  アプリの中の使い方（HTML）
// ===================================================================
function buildHtml(content, shots, opts = {}) {
  const DIM = { maxW: 880, cropScale: 1 };
  let fig = 0;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const img = (name, o = {}, cls = '') => {
    const m = shots.info(name);
    const { w, h } = dispSize(m, o, DIM);
    return `<img${cls ? ` class="${cls}"` : ''} src="images/${esc(m.file)}" width="${w}" height="${h}" alt="${esc(o.alt || '')}" loading="lazy">`;
  };
  const runs = (parts) => (Array.isArray(parts) ? parts : [parts]).map((p) => {
    if (p == null) return '';
    if (typeof p === 'string') return esc(p);
    if (p.b) return '<b>' + esc(p.b) + '</b>';
    if (p.k) return '<kbd>' + esc(p.k) + '</kbd>';
    if (p.red) return '<span class="red">' + esc(p.red) + '</span>';
    if (p.gray) return '<span class="gray">' + esc(p.gray) + '</span>';
    return '';
  }).join('');
  const paras = (txt) => (Array.isArray(txt) && Array.isArray(txt[0]) ? txt : [txt]).map((t) => '<p>' + runs(t) + '</p>').join('');
  const cap = (t) => `<figcaption>図 ${++fig}　${esc(t)}</figcaption>`;
  // 見出しの id（目次から飛ぶ先）。番号があれば番号から作る（「2.1 画面の各部」→ s2-1）
  const ids = new Set();
  const idOf = (text) => {
    const m = text.match(/^(付録 )?([A-Z0-9]+(?:\.[0-9]+)*)\.?\s/);
    let id = m ? 's' + (m[1] ? 'app-' : '') + m[2].replace(/\./g, '-') : 's' + (ids.size + 1);
    while (ids.has(id)) id += '-';
    ids.add(id);
    return id;
  };
  const toc = [];
  function render(b) {
    switch (b.t) {
      case 'br': case 'toc': return '';
      case 'h': {
        const id = idOf(b.text);
        if (b.l <= 2) toc.push({ l: b.l, id, text: b.text });
        return `<h${b.l + 1} id="${id}">${esc(b.text)}</h${b.l + 1}>`;
      }
      case 'p': return '<p>' + runs(b.parts) + '</p>';
      case 'note': return '<p class="note">※ ' + runs(b.parts) + '</p>';
      case 'bullet': return `<ul class="l${b.level}"><li>${runs(b.parts)}</li></ul>`;
      case 'box': return `<div class="box ${b.kind}"><b class="tag">${b.kind === 'warn' ? '注意' : 'ヒント'}</b><div>${runs(b.parts)}</div></div>`;
      case 'todo': return `<p class="todo">（この章はこれから書きます: ${esc(b.text)}）</p>`;
      case 'fig': {
        let s = '<figure>' + img(b.img, b.o) + (b.cap ? cap(b.cap) : '') + '</figure>';
        if (b.o.callouts) s += '<table class="co">' + b.o.callouts.map((c, i) => `<tr><td class="n">${c.n || i + 1}</td><td class="nm">${esc(c.name)}</td><td>${paras(c.desc || '')}</td></tr>`).join('') + '</table>';
        return s;
      }
      case 'steps': {
        const rows = b.list.map((s, i) => `<tr><td class="n">${i + 1}</td><td class="tx">${paras(s.text)}</td><td class="im">${s.img ? img(s.img, { maxW: 420, scale: s.scale, maxH: s.maxH || 330 }) : ''}</td></tr>`).join('');
        return `<figure class="steps"><table class="st">${rows}</table>${b.o.caption ? cap(b.o.caption) : ''}</figure>`;
      }
      case 'tab': {
        return '<table class="tb"><tr>' + b.head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>'
          + b.rows.map((r) => '<tr>' + r.map((c, i) => '<td>' + (i === 0 && typeof c === 'string' ? '<b>' + esc(c) + '</b>' : paras(c)) + '</td>').join('') + '</tr>').join('') + '</table>';
      }
      default: throw new Error('知らないブロック: ' + b.t);
    }
  }
  const body = content.body.map(render).join('\n');
  // 目次（章の下に節。章を押すと節を開く）
  const tocHtml = [];
  let open = false;
  for (const t of toc) {
    if (t.l === 1) {
      if (open) tocHtml.push('</ol></li>');
      tocHtml.push(`<li class="ch"><a href="#${t.id}">${esc(t.text)}</a><ol>`);
      open = true;
    } else tocHtml.push(`<li><a href="#${t.id}">${esc(t.text)}</a></li>`);
  }
  if (open) tocHtml.push('</ol></li>');
  const c = content.cover;
  const layout = opts.layout || 'side';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>使い方 — モックイメージメーカー ${esc(APP_VERSION)}</title>
<!-- このファイルは manual/作成ツール/build.js が content.js から作る。直接は直さない -->
<style>
:root{--navy:#1d3f6e;--line:#e2e8f0;--ink:#1e293b;--sub:#64748b;--red:#dc2626}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:'Segoe UI','Yu Gothic UI','Meiryo',sans-serif;color:var(--ink);background:#f1f5f9;font-size:14px;line-height:1.75}
.top{position:fixed;left:0;right:0;top:0;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#fff;border-bottom:1px solid var(--line);z-index:2}
.top b{font-size:15px}.top span{color:var(--sub);font-size:12px}
nav{position:fixed;left:0;top:44px;bottom:0;width:268px;overflow:auto;background:#fff;border-right:1px solid var(--line);padding:10px 0 24px}
nav ol{list-style:none;margin:0;padding:0}
nav a{display:block;padding:3px 14px 3px 18px;color:var(--ink);text-decoration:none;font-size:13px;line-height:1.5;border-left:3px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav li.ch>a{font-weight:700;margin-top:6px}
nav li.ch ol a{padding-left:34px;color:#334155;font-size:12.5px}
nav li.ch:not(.open) ol{display:none}
nav a:hover{background:#f1f5f9}
nav a.on{border-left-color:var(--navy);background:#eef2f8;color:var(--navy)}
main{margin:44px 0 0 268px;padding:24px 40px 80px;height:calc(100% - 44px);overflow:auto}
.doc{max-width:900px}
h2{font-size:22px;color:var(--navy);border-bottom:2px solid var(--navy);padding-bottom:4px;margin:36px 0 12px}
h3{font-size:17px;color:var(--navy);margin:28px 0 8px;padding-left:8px;border-left:4px solid var(--navy)}
h4{font-size:15px;margin:20px 0 6px}
p{margin:6px 0}
.note{color:var(--sub);font-size:13px}
.todo{color:#94a3b8;font-style:italic}
ul{margin:4px 0;padding-left:22px}ul.l1{padding-left:44px}
kbd{font-family:inherit;font-size:12px;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 5px;background:#fff}
.red{color:#b91c1c}.gray{color:var(--sub)}
figure{margin:14px 0 6px;text-align:center}
figure img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:4px;background:#fff}
figcaption{font-size:12px;color:var(--sub);margin-top:4px}
table{border-collapse:collapse;width:100%;margin:8px 0 14px;background:#fff}
td,th{border:1px solid var(--line);padding:6px 10px;vertical-align:middle;text-align:left}
td p{margin:2px 0}
th{background:var(--navy);color:#fff;font-weight:600}
.co td.n{background:var(--red);color:#fff;font-weight:700;text-align:center;width:34px;font-family:Arial,sans-serif}
.co td.nm{background:#f3f6fa;font-weight:700;width:170px}
.st td.n{background:var(--navy);color:#fff;font-size:18px;font-weight:700;text-align:center;width:40px;font-family:Arial,sans-serif}
.st td.im{width:440px;text-align:center}
.box{display:flex;gap:10px;border:1px solid;border-left-width:5px;border-radius:4px;padding:8px 12px;margin:10px 0}
.box .tag{flex-shrink:0}
.box.tip{border-color:#2563eb;background:#eff6ff}.box.tip .tag{color:#1d4ed8}
.box.warn{border-color:#dc2626;background:#fef2f2}.box.warn .tag{color:#b91c1c}
.cover{background:#fff;border:1px solid var(--line);border-radius:8px;padding:28px 32px;margin-bottom:8px}
.cover .t{font-size:26px;font-weight:700;color:var(--navy)}
.cover .s{color:var(--sub)}
@media print{.top,nav{display:none}main{margin:0;height:auto;overflow:visible}}
${layout === 'one' ? `nav{position:static;width:auto;border:1px solid var(--line);border-radius:8px;margin:0 0 16px;max-height:none}main{margin-left:0}nav li.ch ol{display:block!important}nav{columns:2;padding:12px}` : ''}
</style>
</head>
<body>
<div class="top"><b>モックイメージメーカー 使い方</b><span>${esc(APP_VERSION)}・${esc(LAST_UPDATED)} 更新</span></div>
${layout === 'one' ? '' : `<nav aria-label="目次"><ol>${tocHtml.join('')}</ol></nav>`}
<main>
<div class="doc">
${layout === 'one' ? `<nav aria-label="目次"><ol>${tocHtml.join('')}</ol></nav>` : ''}
<div class="cover"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.app)}　${esc(c.sub)}</div></div>
${body}
</div>
</main>
<script>
// 目次: 読んでいる節に印を付け、その章の節を開く
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('nav a'));
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  var main = document.querySelector('main');
  function mark() {
    var top = main.getBoundingClientRect().top + 24, cur = 0;
    heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top <= top) cur = i; });
    links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    var ch = links[cur] && links[cur].closest('li.ch');
    document.querySelectorAll('nav li.ch').forEach(function (li) { li.classList.toggle('open', li === ch); });
  }
  main.addEventListener('scroll', mark);
  mark();
})();
</script>
</body>
</html>
`;
}

// ===================================================================
//  Word の別冊（docx）
// ===================================================================
function requireDocx() {
  try { return require('docx'); } catch (e) { /* 次を試す */ }
  for (const c of ['/opt/node22/lib/node_modules/docx', '/opt/node-tools/node_modules/docx']) {
    try { return require(c); } catch (e) { /* 次を試す */ }
  }
  throw new Error('docx が見つかりません。リポジトリのルートで npm install を実行してください。');
}

// style: 'manual'（写し元の MultipurposeDiagramMaker の操作マニュアルと同じ見た目）／'company'（社内の Word 文書の書式に寄せる。q87 の見比べ用）
function buildDocx(content, shots, style = 'manual') {
  const X = requireDocx();
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer, AlignmentType, LevelFormat,
    HeadingLevel, BorderStyle, WidthType, ShadingType, PageBreak, PageNumber, VerticalAlign, TableOfContents, TableLayoutType } = X;
  const S = style === 'company'
    ? { font: '游明朝', h: ['000000', '000000', '000000'], head: 'D9D9D9', headInk: '000000', step: 'D9D9D9', stepInk: '000000', line: '808080' }
    : { font: 'Meiryo UI', h: ['1D3F6E', '1D3F6E', '404040'], head: '1D3F6E', headInk: 'FFFFFF', step: '1D3F6E', stepInk: 'FFFFFF', line: 'CCCCCC' };
  const FONT = S.font;
  const DIM = { maxW: 640, cropScale: 0.75 };
  const FULL_W = 10200;
  const thin = { style: BorderStyle.SINGLE, size: 1, color: S.line };
  const allThin = { top: thin, bottom: thin, left: thin, right: thin };
  let fig = 0;
  const imgRun = (name, o = {}) => {
    const m = shots.info(name);
    const { w, h } = dispSize(m, o, DIM);
    return new ImageRun({ type: m.type, data: fs.readFileSync(m.fp), transformation: { width: w, height: h }, altText: { title: name, description: o.alt || name, name } });
  };
  const runs = (parts, size = 21) => (Array.isArray(parts) ? parts : [parts]).filter((p) => p != null).map((p) => {
    if (typeof p === 'string') return new TextRun({ text: p, font: FONT, size });
    if (p.b) return new TextRun({ text: p.b, font: FONT, size, bold: true });
    if (p.k) return new TextRun({ text: p.k, font: FONT, size, bold: true, color: '1D3F6E' });
    if (p.red) return new TextRun({ text: p.red, font: FONT, size, color: 'C00000' });
    if (p.gray) return new TextRun({ text: p.gray, font: FONT, size, color: '555555' });
    return new TextRun({ text: '' });
  });
  const paras = (txt, size) => (Array.isArray(txt) && Array.isArray(txt[0]) ? txt : [txt]).map((t, i, a) => new Paragraph({ spacing: { after: i < a.length - 1 ? 60 : 0 }, children: runs(t, size) }));
  const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: '図 ' + (++fig) + '　' + text, font: FONT, size: 18, color: '666666' })] });
  const cell = (w, children, o = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: allThin, verticalAlign: o.va || VerticalAlign.CENTER,
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR } : undefined,
    margins: o.m || { top: 50, bottom: 50, left: 100, right: 100 }, children,
  });
  const table = (widths, rows) => new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows });
  const headRow = (heads, widths) => new TableRow({ tableHeader: true, cantSplit: true, children: heads.map((h, i) => cell(widths[i], [new Paragraph({ alignment: style === 'company' ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: h, font: FONT, size: 19, bold: true, color: S.headInk })] })], { fill: S.head })) });
  const sp = (n = 160) => new Paragraph({ spacing: { before: n }, children: [] });
  function box(kind, parts) {
    const c = kind === 'warn' ? { line: 'C00000', fill: 'FDECEC', tag: '注意　' } : { line: '2563EB', fill: 'EFF6FF', tag: 'ヒント　' };
    return table([FULL_W], [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: FULL_W, type: WidthType.DXA },
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color: c.line }, bottom: { style: BorderStyle.SINGLE, size: 1, color: c.line }, left: { style: BorderStyle.SINGLE, size: 12, color: c.line }, right: { style: BorderStyle.SINGLE, size: 1, color: c.line } },
      shading: { fill: c.fill, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 200, right: 200 },
      children: [new Paragraph({ children: [new TextRun({ text: c.tag, font: FONT, size: 20, bold: true, color: c.line }), ...runs(parts, 20)] })],
    })] })]);
  }
  function render(b) {
    switch (b.t) {
      case 'toc': return [new TableOfContents('目次', { hyperlink: true, headingStyleRange: '1-2' })];
      case 'br': return [new Paragraph({ children: [new PageBreak()] })];
      case 'h': {
        const sizes = { 1: 32, 2: 26, 3: 23 };
        const hl = b.l === 1 ? HeadingLevel.HEADING_1 : b.l === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        return [new Paragraph({ heading: hl, keepNext: true, pageBreakBefore: !!b.o.newPage, spacing: { before: b.l === 1 ? 360 : 240, after: 120 }, children: [new TextRun({ text: b.text, font: FONT, size: sizes[b.l], bold: true, color: S.h[b.l - 1] })] })];
      }
      case 'p': return [new Paragraph({ spacing: { before: 80, after: 80 }, keepNext: !!b.o.keepNext, children: runs(b.parts) })];
      case 'note': return [new Paragraph({ spacing: { before: 60, after: 60 }, children: runs([{ gray: '※ ' }, ...b.parts.map((x) => (typeof x === 'string' ? { gray: x } : x))], 20) })];
      case 'bullet': return [new Paragraph({ numbering: { reference: 'bullets', level: b.level }, spacing: { before: 40, after: 40 }, children: runs(b.parts) })];
      case 'box': return [box(b.kind, b.parts), sp(60)];
      case 'todo': return [new Paragraph({ children: [new TextRun({ text: '（この章はこれから書きます: ' + b.text + '）', font: FONT, size: 20, italics: true, color: '94A3B8' })] })];
      case 'fig': {
        const out = [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 60 }, children: [imgRun(b.img, b.o)] })];
        if (b.cap) out.push(caption(b.cap));
        if (b.o.callouts) {
          const w = [560, 2400, FULL_W - 2960];
          out.push(table(w, b.o.callouts.map((it, i) => new TableRow({ cantSplit: true, children: [
            cell(w[0], [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(it.n || i + 1), font: 'Arial', size: 20, bold: true, color: 'FFFFFF' })] })], { fill: 'DC2626', m: { top: 40, bottom: 40, left: 60, right: 60 } }),
            cell(w[1], [new Paragraph({ children: runs([{ b: it.name }], 19) })], { fill: style === 'company' ? 'D9D9D9' : 'F3F6FA' }),
            cell(w[2], paras(it.desc || '', 19)),
          ] }))));
          out.push(sp(80));
        }
        return out;
      }
      case 'steps': {
        const W3 = b.o.imgCol || 5200, W1 = 620, W2 = FULL_W - W1 - W3, imgMax = Math.floor(W3 / 15) - 16;
        const rows = b.list.map((s, i) => new TableRow({ cantSplit: true, children: [
          cell(W1, [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(i + 1), font: 'Arial', size: 28, bold: true, color: S.stepInk })] })], { fill: S.step, m: { top: 40, bottom: 40, left: 40, right: 40 } }),
          cell(W2, paras(s.text, 20), { m: { top: 80, bottom: 80, left: 140, right: 120 } }),
          cell(W3, [new Paragraph({ alignment: AlignmentType.CENTER, children: s.img ? [imgRun(s.img, { maxW: imgMax, scale: s.scale, maxH: s.maxH || 330 })] : [] })], { m: { top: 60, bottom: 60, left: 60, right: 60 } }),
        ] }));
        return [table([W1, W2, W3], rows), ...(b.o.caption ? [caption(b.o.caption)] : [sp(40)]), sp(60)];
      }
      case 'tab': {
        const w = b.o.w || [2800, FULL_W - 2800];
        const rows = b.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(w[i], paras(i === 0 && typeof c === 'string' ? [{ b: c }] : c, 19), i === 0 && style === 'company' ? { fill: 'D9D9D9' } : {})) }));
        return [table(w, [headRow(b.head, w), ...rows]), sp(100)];
      }
      default: throw new Error('知らないブロック: ' + b.t);
    }
  }
  const children = content.body.flatMap(render);
  const pageProps = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, right: 567, bottom: 1134, left: 1134 } } };
  const c = content.cover;
  const metaRow = (label, value) => new TableRow({ children: [
    cell(2000, [new Paragraph({ children: [new TextRun({ text: label, font: FONT, size: 20, bold: true })] })], { fill: style === 'company' ? 'D9D9D9' : 'DCE5F0', m: { top: 60, bottom: 60, left: 120, right: 120 } }),
    cell(3000, [new Paragraph({ children: [new TextRun({ text: value, font: FONT, size: 20 })] })], { m: { top: 60, bottom: 60, left: 120, right: 120 } }),
  ] });
  const cover = {
    properties: { ...pageProps, titlePage: true },
    children: [
      new Paragraph({ spacing: { before: 1400 }, children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: c.title, font: FONT, size: 56, bold: true, color: S.h[0] })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: c.app, font: FONT, size: 36, color: S.h[0] })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 500 }, children: [new TextRun({ text: c.sub, font: FONT, size: 26, color: '404040' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [imgRun(c.img, { width: 560 })] }),
      new Table({ alignment: AlignmentType.CENTER, width: { size: 5000, type: WidthType.DXA }, columnWidths: [2000, 3000], layout: TableLayoutType.FIXED, rows: c.meta.map(([a, v]) => metaRow(a, v)) }),
      new Paragraph({ children: [new PageBreak()] }),
      new TableOfContents('目次', { hyperlink: true, headingStyleRange: '1-2' }),
    ],
  };
  const hdr = new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: S.h[0], space: 4 } }, children: [new TextRun({ text: 'モックイメージメーカー ' + APP_VERSION + ' 使用説明書', font: FONT, size: 18, color: S.h[0] })] })] });
  const ftr = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '808080' }), new TextRun({ text: ' / ', font: FONT, size: 18, color: '808080' }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: '808080' }),
  ] })] });
  const doc = new Document({
    features: { updateFields: true }, // 開いたときに目次を作り直す（docx の目次はフィールドなので、作った直後は空）
    styles: {
      default: { document: { run: { font: FONT, size: 21 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: FONT, color: S.h[0] }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: FONT, color: S.h[1] }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, font: FONT, color: S.h[2] }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: style === 'company' ? '・' : '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
    ] }] },
    sections: [cover, { properties: { ...pageProps }, headers: { default: hdr }, footers: { default: ftr }, children }],
  });
  return { doc, Packer, figCount: () => fig };
}

// ===================================================================
//  出力
// ===================================================================
async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const content = loadContent();
  const manifest = loadManifest();
  const htmlShots = makeShots(manifest);
  const htmlOut = val('html-out', path.join(MANUAL, 'manual.html'));
  fs.writeFileSync(htmlOut, buildHtml(content, htmlShots, { layout: val('layout', 'side') }));
  console.log('使い方（HTML）: ' + path.relative(ROOT, htmlOut));
  if (!args.includes('--html')) {
    const shots = makeShots(manifest);
    const { doc, Packer, figCount } = buildDocx(content, shots, val('style', 'manual'));
    const buf = await Packer.toBuffer(doc);
    const out = val('docx-out', path.join(MANUAL, DOCX_NAME));
    fs.writeFileSync(out, buf);
    console.log(`Word の別冊: ${path.relative(ROOT, out)}（${(buf.length / 1024 / 1024).toFixed(1)} MB・図 ${figCount()}・画像 ${shots.used.size} 枚）`);
  }
  const unused = Object.keys(manifest).filter((k) => !htmlShots.used.has(k));
  if (unused.length) console.log(`使っていない画像 ${unused.length} 枚: ${unused.join(' ')}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { buildHtml, buildDocx, loadContent, loadManifest, makeShots, APP_VERSION, LAST_UPDATED, DOCX_NAME };
