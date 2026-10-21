// bdm-inject.js — MPD（MultipurposeDiagramMaker〔旧名 ビジネスダイアグラムメーカー・BDM〕で保存した HTML）の埋め込みを、新しい図の中身に差し替える（第 11 段階）
// 役割:
//  - ① の印（<script id="swimlane-state">window.__SWIMLANE_STATE__={…};</script>）があれば、その JSON の場所を全部差し替える
//    （2 つ以上あると、MultipurposeDiagramMaker は後の script の値で、このアプリは前の値で読むため、全部を同じ中身にする）
//  - ① がなければ（② body の data-state・③ __SAVED_STATE__ だけの古い保存）、script・style・コメントの外の </head> の前に ① を入れる
//    （MultipurposeDiagramMaker の init() は ① を先に読むので、古い ②・③ は使われない。MultipurposeDiagramMaker の保存 buildSaveHtml も </head> の前に入れる）
//  - 文字は slice でつなぐ（String.replace に文字を渡すと、箱の字の「$&」「$'」が化けるため）
//  - JSON の「<」・U+2028・U+2029 は \u で書く（MultipurposeDiagramMaker は最初の「;</script>」までを切り出すので、中身に「</script>」があると壊れるため。
//    U+2028・U+2029 は、古い JavaScript では script の中の改行とみなされるため）
// Electron に触らない。node だけでテストできる
'use strict';

const { MaterialError } = require('./material-error');
const { locateStateScripts, BROKEN } = require('./bdm-state');

// script・style・コメントを飛ばして、最初の本物の </head> を探す（MultipurposeDiagramMaker のコードの文字列の中にも '</head>' がある）
const HEAD_END = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|(<\/head\s*>)/gi;
const NO_HEAD = 'MPD の中に、図の中身を入れる場所（</head>）が見つかりません。';
// U+2028・U+2029 と、その \u の書き方（ファイルに書く道具が \u の書き方を字に変えることがあるので、字の番号から作る）
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(92);
const ESCAPED = { lt: BACKSLASH + 'u003c', ls: BACKSLASH + 'u2028', ps: BACKSLASH + 'u2029' };

// 図の中身を、script の中に置ける JSON の文字にする（空白なし。MultipurposeDiagramMaker の保存と同じ JSON.stringify のまま）
function stateJson(state) {
  return JSON.stringify(state).split('<').join(ESCAPED.lt).split(LINE_SEP).join(ESCAPED.ls).split(PARA_SEP).join(ESCAPED.ps);
}

function headEndIndex(html) {
  for (const m of html.matchAll(HEAD_END)) if (m[1] !== undefined) return m.index;
  return -1;
}

// html（元の MPD の文字）の図の中身を state に差し替えた文字を返す。① が壊れている・</head> がないときは MaterialError('read_failed')
function injectBdmState(html, state) {
  const json = stateJson(state);
  const places = locateStateScripts(html);
  if (places.some((p) => p.end === null)) throw new MaterialError('read_failed', BROKEN);
  if (places.length) {
    let out = '';
    let at = 0;
    for (const p of places) {
      out += html.slice(at, p.start) + json;
      at = p.end;
    }
    return out + html.slice(at);
  }
  const head = headEndIndex(html);
  if (head < 0) throw new MaterialError('read_failed', NO_HEAD);
  return `${html.slice(0, head)}<script id="swimlane-state">window.__SWIMLANE_STATE__=${json};</script>\n${html.slice(head)}`;
}

module.exports = { injectBdmState, stateJson };
