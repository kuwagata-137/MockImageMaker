// mcp-schemas.js — MCP の道具の入力の形（zod）（第 7 段階）
// 入口（mcp-server.js）は形だけを確かめ、知らない欄を断る（綴りの誤りを早く知らせるため。ページの側は知らない欄を読まずに飛ばすので）。
// 値の中身（項目があるか・選べる値か・設定の欄 props の中身）は、ページの「AI の窓口」（mock_v*.html の AI_TOOLS）で確かめる。
// 選べる値を並べた所（機器・表の中身・吹き出しの色など）は、ページの値と同じにする（test/mcp.test.js で get_catalog と比べる）。
'use strict';

const { z } = require('zod');

const obj = (shape) => z.object(shape).strict();
const ref = (what) => z.union([z.string(), z.number()]).describe(what);
const opt = (schema) => schema.optional();

const DEVICES = ['pc', 'tablet', 'phone'];
const TABLE_KINDS = ['subtable', 'records', 'related'];
const CALLOUT_COLORS = ['yellow', 'red', 'blue', 'gray'];
const CALLOUT_TIPS = ['dot', 'arrow', 'none'];
const ALIGN_HOW = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hdist', 'vdist', 'width', 'height'];

const S = {
  design: ref('画面設計の id か名前'),
  screen: ref('画面の id か名前（その画面設計の中で）'),
  part: ref('部品の id か赤い番号（その画面の中で）'),
  item: ref('データベースの項目の id か項目名'),
  expect: opt(z.string().describe('読んだときの更新の印（get_design などの updatedAt）。今の印と違えば断る（人がアプリで直した後に上書きしないため）。省くと確かめない')),
  cursor: opt(z.string().describe('続きを読むときに、前の返事の nextCursor を書く')),
  props: z.record(z.any()).describe('設定の欄 { 欄の名前: 値 }。使える欄と値の形は get_catalog の parts[].props'),
  to: z.union([z.string(), obj({ screen: z.string() })]).describe('ボタンの移る先の画面（{ "screen": "一覧" }）。今の版では、ボタンの「押したとき」の文に書く'),
  labelPos: z.enum(['top', 'left']).describe('項目名の位置: "top"（入力欄の上）・"left"（入力欄の左）'),
  rows: z.number().int().min(1).max(20).describe('表の見本の行の数（1〜20）'),
  current: z.string().describe('ステータスの印・進み具合の矢印で、見本に出すステータス'),
  style: z.enum(['primary', 'normal']).describe('ボタンの見た目: "primary"（目立つ・青）・"normal"（ふつう・白）'),
  no: z.null().describe('null で赤い番号を外す'),
};
const where = { before: opt(z.union([z.string(), z.number()]).describe('この前に動かす')), after: opt(z.union([z.string(), z.number()]).describe('この後ろに動かす')), index: opt(z.number().int().describe('並べ替えた後の位置（0 がいちばん上）')) };
const rect = { x: opt(z.number()), y: opt(z.number()), w: opt(z.number()), h: opt(z.number()) };
const op = (name, shape, description) => obj({ op: z.literal(name), ...shape }).describe(description);

// ── 並べ方（layout。設計書の 9-3）──
const layoutPart = obj({
  item: opt(S.item.describe('置くデータベースの項目（項目名か id）。その名前の項目がなく type を書いたときは、項目を新しく作って置く')),
  type: opt(z.string().describe('部品の種類（get_catalog の parts[].type）。item を書いたときは省ける')),
  label: opt(z.string().describe('見出し・ボタン・説明の文字などの文字（新しく作る項目なら項目名）')),
  span: opt(z.union([z.literal(1), z.literal(2)]).describe('2 で 2 列の幅いっぱいに広げる')),
  sample: opt(z.string().describe('入力欄の見本の値')),
  placeholder: opt(z.string().describe('入力欄の薄い字')),
  labelPos: opt(S.labelPos),
  no: opt(S.no),
  props: opt(S.props),
  tableKind: opt(z.enum(TABLE_KINDS).describe('表の中身: "subtable"（テーブル）・"records"（レコード一覧）・"related"（関連レコード一覧）')),
  rows: opt(S.rows),
  current: opt(S.current),
  style: opt(S.style),
  to: opt(S.to),
  required: opt(z.boolean().describe('新しく作る項目を必須にする')),
  memo: opt(z.string().describe('新しく作る項目のメモ')),
  allowSameName: opt(z.boolean().describe('同じ名前の項目があっても新しく作る')),
});
const layoutRow = z.union([
  z.array(layoutPart).min(1).describe('1 行に並べる部品（左の列から）'),
  obj({ align: opt(z.enum(['left', 'center', 'right'])), parts: z.array(layoutPart).min(1) }).describe('列に合わせず横に並べ、左・真ん中・右に寄せる行（ボタンの行）'),
]);
const layout = obj({
  columns: opt(z.union([z.literal(1), z.literal(2)]).describe('列の数（2 列はパソコンの画面だけ）')),
  rows: z.array(layoutRow).min(1).describe('上から順に置く行'),
}).describe('部品の並べ方（read_guide の "layout"）。位置と大きさはアプリが決める');

// ── 項目の操作（edit_items）──
const lookup = obj({
  design: ref('ルックアップ元のデータベース（画面設計の id か名前。一覧にないデータベースは名前）'),
  key: z.string().describe('探すときに使う、元のデータベースの項目名'),
  copies: opt(z.array(obj({
    from: z.string().describe('元のデータベースの項目名'),
    to: z.string().describe('写す先の、この画面設計の項目名'),
    create: opt(z.boolean().describe('写す先の項目がなければ、同じ名前で新しく作る')),
  })).describe('一緒に写す項目')),
});
const itemFields = {
  required: opt(z.boolean()), memo: opt(z.string()),
  props: opt(S.props.describe('項目の設定の欄（get_catalog の parts[].props と itemProps。テーブルは columns、ステータスは states）')),
  allowSameName: opt(z.boolean().describe('同じ名前の項目があってもよい')),
};
const itemOps = z.discriminatedUnion('op', [
  op('add', { type: z.string().describe('項目の種類（get_catalog の itemTypes。例 "text1"・"dropdown"・"table"・"status"）'), name: z.string(), ...itemFields }, 'データベースの項目を足す（一覧表のいちばん下。画面には置かない）'),
  op('update', { item: S.item, name: opt(z.string()), type: opt(z.string().describe('入力欄の部品の種類のあいだだけで変えられる')), ...itemFields }, '項目を直す'),
  op('delete', { item: S.item }, '項目を一覧表から消す（画面の部品は、消したときの中身で残る）'),
  op('move', { item: S.item, ...where }, '項目を並べ替える（before・after・index のどれか）'),
  op('lookup', { item: S.item, lookup: z.union([lookup, z.null()]).describe('ルックアップ（null で外す）') }, 'テキスト（1行）・数値の項目にルックアップを付ける・外す'),
  op('import', { from: ref('取り込む元の画面設計の id か名前'), items: z.array(S.item).min(1).describe('取り込む元の項目'), allowSameName: opt(z.boolean()) }, 'ほかの画面設計から項目を取り込む（元とつながったまま。取り込んだ項目はここでは直せない）'),
  op('unlink', { item: S.item }, '取り込んだ項目のつながりを切る（そのときの中身を写した、この画面設計だけの項目になる）'),
  op('restore', { item: z.string().describe('一覧表から消した項目の id') }, '一覧表から消した項目を戻す（画面に部品が残っているときだけ）'),
]);

// ── 画面の操作（edit_screen）──
const screenOps = z.discriminatedUnion('op', [
  op('update', {
    screen: S.screen, name: opt(z.string()), device: opt(z.enum(DEVICES).describe('機器: "pc"・"tablet"・"phone"')), height: opt(z.number().describe('画面の高さ（ドット）')),
    showHeader: opt(z.boolean().describe('いちばん上の紺色の帯を出す')), tablePos: opt(z.enum(['right', 'bottom']).describe('部品の設定の一覧表の位置')),
  }, '画面の名前・機器・高さ・帯・一覧表の位置を直す'),
  op('move', { screen: S.screen, ...where }, '画面を並べ替える'),
  op('delete', { screen: S.screen }, '画面を消す（最後の 1 つは消せない）'),
]);

// ── 部品の操作（edit_parts）──
const partOps = z.discriminatedUnion('op', [
  op('update', {
    part: S.part, label: opt(z.string()), required: opt(z.boolean()), memo: opt(z.string()), props: opt(S.props), style: opt(S.style), to: opt(S.to),
    labelPos: opt(S.labelPos), sample: opt(z.string()), placeholder: opt(z.string()), numbered: opt(z.boolean().describe('赤い番号を付ける・外す')), no: opt(S.no),
    rows: opt(S.rows), current: opt(S.current),
  }, '部品を直す（項目を指す部品の項目名・必須・メモ・設定は、項目に書かれる）'),
  op('move', { part: S.part, ...rect }, '部品の位置と大きさを数で直す（8 ドットのマス目にそろう）'),
  op('move_by', { parts: z.array(S.part).min(1), dx: opt(z.number()), dy: opt(z.number()) }, '部品をまとめてずらす'),
  op('delete', { part: S.part }, '部品を消す（項目は一覧表に残る）'),
  op('renumber', {}, '赤い番号を上から下・左から右の順に振り直す'),
  op('align', { parts: z.array(S.part).min(2), how: z.enum(ALIGN_HOW).describe('揃え方（最初に書いた部品に合わせる）') }, '部品を揃える・同じ幅や高さにする'),
  op('table_kind', { part: S.part, kind: z.enum(TABLE_KINDS) }, '表の中身を変える'),
  op('number', { parts: z.array(S.part).min(1), on: z.boolean() }, '赤い番号をまとめて付ける・外す'),
]);

// ── 吹き出しの操作（edit_callouts）──
const color = z.enum(CALLOUT_COLORS).describe('色: "yellow"・"red"・"blue"・"gray"');
const tip = z.enum(CALLOUT_TIPS).describe('線の先: "dot"（点）・"arrow"（矢印）・"none"（なし）');
const calloutOps = z.discriminatedUnion('op', [
  op('add', { text: z.string(), target: opt(S.part.describe('線でつなぐ部品')), color: opt(color), tip: opt(tip), ...rect }, '吹き出しを足す（位置を書かなければ、つなぐ部品の右の画面の外に置く）'),
  op('update', { callout: z.string().describe('吹き出しの id'), text: opt(z.string()), color: opt(color), tip: opt(tip), target: opt(z.union([S.part, z.null()]).describe('つなぐ部品（null で線を外す）')) }, '吹き出しを直す'),
  op('move', { callout: z.string(), ...rect }, '吹き出しの位置と大きさを直す'),
  op('delete', { callout: z.string() }, '吹き出しを消す'),
]);

const opsOf = (union) => z.array(union).min(1).describe('操作の並び（まとめて 1 回の変更になる）');

module.exports = {
  z, obj, S, layout, itemOps: opsOf(itemOps), screenOps: opsOf(screenOps), partOps: opsOf(partOps), calloutOps: opsOf(calloutOps),
  DEVICES, TABLE_KINDS, CALLOUT_COLORS, CALLOUT_TIPS, ALIGN_HOW,
};
