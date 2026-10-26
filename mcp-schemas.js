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
// 見た目（第 12 段階）と画面の項目の出し方。ページの LOOKS・ITEM_VIEWS（get_catalog の looks・itemViews）と同じ
const LOOKS = ['standard', 'salesforce', 'kintone'];
const ITEM_VIEWS = ['input', 'show'];
const BAND_TABS_MAX = 12;
const TABLE_KINDS = ['subtable', 'records', 'related'];
const CALLOUT_COLORS = ['yellow', 'red', 'blue', 'gray'];
const CALLOUT_TIPS = ['dot', 'arrow', 'none'];
const ALIGN_HOW = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hdist', 'vdist', 'width', 'height'];
// AI の頼みで伸ばせる画面の高さの上限（ドット）。ページの AI_SCREEN_H_MAX（get_catalog の maxScreenHeight）と同じ（test/ai-write.test.js で比べる）
const MAX_SCREEN_HEIGHT = 20000;

const S = {
  design: ref('画面設計の id か名前'),
  system: ref('システムの id か名前'),
  role: ref('役割の id か名前（そのシステムの中で）'),
  material: ref('資料の id か名前（そのシステムの資料の置き場の中で。list_materials の id・name）'),
  screen: ref('画面の id か名前（その画面設計の中で）'),
  part: ref('部品の id か赤い番号（その画面の中で）'),
  item: ref('データベースの項目の id か項目名'),
  expect: opt(z.string().describe('読んだときの更新の印（get_design などの updatedAt）。今の印と違えば断る（人がアプリで直した後に上書きしないため）。省くと確かめない')),
  cursor: opt(z.string().describe('続きを読むときに、前の返事の nextCursor を書く')),
  props: z.record(z.any()).describe('設定の欄 { 欄の名前: 値 }。使える欄と値の形は get_catalog の parts[].props'),
  to: z.union([
    z.string(),
    obj({ screen: z.union([z.string(), z.number()]).describe('画面の id か名前'), design: opt(z.union([z.string(), z.number()]).describe('ほかの画面設計の画面のとき、その画面設計の id か名前')) }),
    obj({ url: z.string() }),
    z.null(),
  ]).describe('ボタン・リンクの文字の移る先: この画面設計の画面（"一覧" か { "screen": "一覧" }）・ほかの画面設計の画面（{ "design": "経費精算", "screen": "精算の入力" }）・URL（{ "url": "https://…" }）・null（なし）'),
  labelPos: z.enum(['top', 'left']).describe('項目名の位置: "top"（入力欄の上）・"left"（入力欄の左）'),
  rows: z.number().int().min(1).max(20).describe('表の見本の行の数（1〜20）'),
  current: z.string().describe('ステータスの印・進み具合の矢印で、見本に出すステータス'),
  // 表の見本の値（第 13 段階。q114 の ⑤）
  samples: z.record(z.array(z.union([z.string(), z.number(), z.null()])).max(20))
    .describe('表の見本の値 { 列名か列の id: [上の行からの値, …] }（20 行まで）。書いた列だけを直し、値の数が見本の行の数より多いときは行を増やす'),
  look: z.enum(LOOKS).describe('見た目: "standard"（標準）・"salesforce"（Salesforce に似せる）・"kintone"（kintone に似せる）。帯の形と高さ、部品の色と枠が変わる'),
  bandTabs: z.array(z.string()).max(BAND_TABS_MAX).describe(`Salesforce の見た目の帯に並べるタブ（文字の配列。${BAND_TABS_MAX} 個まで。空なら「ホーム」と画面設計の名前）`),
  style: z.enum(['primary', 'normal']).describe('ボタンの見た目: "primary"（目立つ・青）・"normal"（ふつう・白）'),
  no: z.null().describe('null で赤い番号を外す'),
  // kintone のフィールドの情報（第 13 段階）。テーブルの列は props.columns[].kintone に同じ形で書く
  kintone: z.union([
    obj({
      type: opt(z.string().describe('kintone の種類（get_catalog の kintoneTypes の type。部品の種類で選べるものだけ。"" で既定）')),
      code: opt(z.string().describe('フィールドコード（文字・数字・_ だけで、数字で始めない。128 字まで。アプリの中で重ねない。"" で項目名から作る）')),
      formula: opt(z.string().describe('kintone の書き方の計算式（自動計算の値の項目だけ。例 "数量 * 単価"）')),
    }),
    z.null(),
  ]).describe('kintone のフィールドの情報。書いた欄だけを直し、null で外す（read_guide の "kintone"）'),
};
const where = { before: opt(z.union([z.string(), z.number()]).describe('この前に動かす')), after: opt(z.union([z.string(), z.number()]).describe('この後ろに動かす')), index: opt(z.number().int().describe('並べ替えた後の位置（0 がいちばん上）')) };
const rect = { x: opt(z.number()), y: opt(z.number()), w: opt(z.number()), h: opt(z.number()) };
const op = (name, shape, description) => obj({ op: z.literal(name), ...shape }).describe(description);

// ── 並べ方（layout。設計書の 9-3）──
const layoutPart = obj({
  item: opt(S.item.describe('置くデータベースの項目（項目名か id）。その名前の項目がなく type を書いたときは、項目を新しく作って置く')),
  type: opt(z.string().describe('部品の種類（get_catalog の parts[].type）。item を書いたときは省ける')),
  label: opt(z.string().describe('見出し・ボタン・説明の文字などの文字（新しく作る項目なら項目名）')),
  span: opt(z.number().int().min(1).max(4).describe('またぐ列の数（1〜4。2 列の並べ方では 2 で 2 列の幅いっぱい、3・4 列ではその数の列の幅）')),
  sample: opt(z.string().describe('入力欄の見本の値')),
  placeholder: opt(z.string().describe('入力欄の薄い字')),
  labelPos: opt(S.labelPos),
  no: opt(S.no),
  props: opt(S.props),
  tableKind: opt(z.enum(TABLE_KINDS).describe('表の中身: "subtable"（テーブル）・"records"（レコード一覧）・"related"（関連レコード一覧）')),
  rows: opt(S.rows),
  samples: opt(S.samples),
  current: opt(S.current),
  style: opt(S.style),
  to: opt(S.to),
  required: opt(z.boolean().describe('新しく作る項目を必須にする')),
  memo: opt(z.string().describe('新しく作る項目のメモ')),
  kintone: opt(S.kintone.describe('項目の kintone のフィールドの情報（新しく作る項目にも、今ある項目にも書ける。read_guide の "kintone"）')),
  allowSameName: opt(z.boolean().describe('同じ名前の項目があっても新しく作る')),
});
const layoutRow = z.union([
  z.array(layoutPart).min(1).describe('1 行に並べる部品（左の列から）'),
  obj({ align: opt(z.enum(['left', 'center', 'right'])), parts: z.array(layoutPart).min(1) }).describe('列に合わせず横に並べ、左・真ん中・右に寄せる行（ボタンの行）'),
]);
const layout = obj({
  columns: opt(z.number().int().min(1).max(4).describe('列の数（1〜4。2 列はパソコンの画面だけ。3・4 列は列の幅が 160 より狭くなる機器では列を減らす）')),
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
  props: opt(S.props.describe('項目の設定の欄（get_catalog の parts[].props と itemProps。テーブルは columns〔列にも kintone を書ける〕、ステータスは states）')),
  kintone: opt(S.kintone),
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
    screen: S.screen, name: opt(z.string()), device: opt(z.enum(DEVICES).describe('機器: "pc"・"tablet"・"phone"')), height: opt(z.number().max(MAX_SCREEN_HEIGHT).describe(`画面の高さ（ドット。${MAX_SCREEN_HEIGHT} まで）`)),
    showHeader: opt(z.boolean().describe('いちばん上の帯を出す')), tablePos: opt(z.enum(['right', 'bottom']).describe('部品の設定の一覧表の位置')),
    itemView: opt(z.enum(ITEM_VIEWS).describe('項目の出し方: "input"（入力の形。入力欄の枠）・"show"（表示の形。値と下の線。詳細の画面に使う）')),
  }, '画面の名前・機器・高さ・帯・一覧表の位置・項目の出し方を直す'),
  op('move', { screen: S.screen, ...where }, '画面を並べ替える'),
  op('delete', { screen: S.screen }, '画面を消す（最後の 1 つは消せない）'),
]);

// ── 部品の操作（edit_parts）──
const partOps = z.discriminatedUnion('op', [
  op('update', {
    part: S.part, label: opt(z.string()), required: opt(z.boolean()), memo: opt(z.string()), props: opt(S.props), style: opt(S.style), to: opt(S.to),
    labelPos: opt(S.labelPos), sample: opt(z.string()), placeholder: opt(z.string()), numbered: opt(z.boolean().describe('赤い番号を付ける・外す')), no: opt(S.no),
    rows: opt(S.rows), samples: opt(S.samples), current: opt(S.current),
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
  op('add', { text: z.string(), target: opt(S.part.describe('線でつなぐ部品')), color: opt(color), tip: opt(tip), ...rect }, '吹き出しを足す（位置を書かなければ、画面の外に置く。つなぐ部品の真ん中が画面の左半分なら左の外、ほかは右の外）'),
  op('update', { callout: z.string().describe('吹き出しの id'), text: opt(z.string()), color: opt(color), tip: opt(tip), target: opt(z.union([S.part, z.null()]).describe('つなぐ部品（null で線を外す）')) }, '吹き出しを直す'),
  op('move', { callout: z.string(), ...rect }, '吹き出しの位置と大きさを直す'),
  op('delete', { callout: z.string() }, '吹き出しを消す'),
]);

// ── ステータスと操作（edit_process。第 8 段階）──
const stateRef = (what) => ref(`${what}（ステータスの id か名前）`);
const actionRef = ref('操作の id か名前（同じ名前の操作が 2 つ以上あるときは id）');
const processOps = z.discriminatedUnion('op', [
  op('set_states', { states: z.array(z.string()).min(1).describe('ステータスの名前の並び（上から順に進む）') },
    'ステータスの並びをまとめて書く（同じ名前のステータスは今のものを残す。なくなったステータスを使う操作は消える。ステータスの項目がなければ作る）'),
  op('add_state', { name: z.string(), ...where }, 'ステータスを足す（既定はいちばん下。ステータスの項目がなければ作る）'),
  op('rename_state', { state: stateRef('名前を変えるステータス'), name: z.string() }, 'ステータスの名前を変える'),
  op('move_state', { state: stateRef('動かすステータス'), ...where }, 'ステータスを並べ替える（before・after・index のどれか）'),
  op('delete_state', { state: stateRef('消すステータス') }, 'ステータスを消す（そのステータスを使う操作も消える。最後の 1 つは消せない）'),
  op('add_action', {
    name: z.string().describe('操作の名前（例 "承認する"）'), from: stateRef('前のステータス'), to: stateRef('次のステータス'),
    role: opt(z.string().describe('操作する人（例 "上長"）')), cond: opt(z.string().describe('条件（例 "金額が 10 万円まで"）')),
  }, '操作（ステータスを進めるボタン）を足す（いちばん下）'),
  op('update_action', { action: actionRef, name: opt(z.string()), from: opt(stateRef('前のステータス')), to: opt(stateRef('次のステータス')), role: opt(z.string()), cond: opt(z.string()) }, '操作を直す'),
  op('move_action', { action: actionRef, ...where }, '操作を並べ替える（before・after・index のどれか）'),
  op('delete_action', { action: actionRef }, '操作を消す'),
]);

// ── システムの役割（update_system。第 9 段階）──
const roleOps = z.discriminatedUnion('op', [
  op('add', { name: z.string().describe('役割の名前（例 "申請者"・"上長"・"経理"）'), memo: opt(z.string().describe('役割のメモ')) }, '役割を足す（いちばん下のレーン）'),
  op('rename', { role: S.role, name: z.string() }, '役割の名前を変える（同じシステムに同じ名前の役割は作れない）'),
  op('set_memo', { role: S.role, memo: z.string() }, '役割のメモを書く'),
  op('move', { role: S.role, to: z.number().int().min(0).describe('動かした後の位置（0 がいちばん上のレーン）') }, '役割（スイムレーンのレーン）を並べ替える'),
  op('delete', { role: S.role }, '役割を消す（その役割の作業と、その作業につながる矢印も消える）'),
]);

// ── スイムレーン（set_swimlane。第 9 段階）──
// 作業の種類。ページの SWIM_KINDS と同じ（test/mcp.test.js で比べる）
const SWIM_KINDS = ['start', 'task', 'input', 'decision', 'doc', 'end'];
// 作業の指す先の欄。id か名前か、get_system の返事の形（{ id, name }。id を使う）か null（なし）
const swimRefField = (what) => opt(z.union([z.string(), z.number(), obj({ id: z.string(), name: opt(z.string()) }), z.null()])
  .describe(`${what}（get_system の返事の { id, name } の形も書ける。null はなし）`));
const swimStep = obj({
  key: opt(z.string().describe('この頼みの中で、矢印（edges の from・to）から指すための名前（省くと text）')),
  id: opt(z.string().describe('今ある作業の id（get_system の steps[].id）。書くと同じ id を残し、書かなかった kind・memo・ref・col は今のまま。新しい作業は書かない')),
  role: opt(z.union([z.string(), z.number(), z.null()]).describe('どの役割（レーン）の作業か。役割の id か名前。ない役割は、先に update_system で足す。roleId を書けば省ける')),
  roleId: opt(z.string().describe('役割の id（get_system の steps[].roleId）。role と両方を書くときは、同じ役割を指すこと')),
  kind: opt(z.enum(SWIM_KINDS).describe('作業の種類: "start"（始まり）・"task"（作業。既定）・"input"（システムへの入力）・"decision"（判断）・"doc"（書類）・"end"（終わり）')),
  text: z.string().describe('作業の文（例 "出張申請書を書く"）'),
  memo: opt(z.string()),
  col: opt(z.number().int().min(0).describe('左から何番目の列か（0 から）。省くと、今ある作業（id を書いた作業）は今の列のまま、新しい作業は矢印の順からアプリが付ける')),
  ref: opt(z.union([
    obj({
      design: swimRefField('このシステムに入っている画面設計の id か名前'),
      screen: swimRefField('その画面設計の画面の id か名前'),
      state: swimRefField('その画面設計のステータスの id か名前'),
    }),
    z.null(),
  ]).describe('この作業で使う画面設計・画面・ステータス（null で外す）。今ある作業の今と同じ指す先（get_system で読んだまま）は、そのまま残す')),
});
const swimEdge = obj({
  id: opt(z.string().describe('今ある矢印の id（get_system の edges[].id）。書くと、その矢印の id のまま元・先・文字を直す。' +
    '書かなくても、同じ「元 → 先」の矢印が今あれば、その id を使い回す。新しい矢印は書かない')),
  from: z.string().describe('矢印の元の作業（key か id か文字）'),
  to: z.string().describe('矢印の先の作業（key か id か文字）'),
  label: opt(z.string().describe('矢印の文字（例 "差し戻し"）。省くと、今の矢印の文字のまま（新しい矢印は文字なし）')),
});

// ── 資料の置き場（list_materials・read_material・swimlane_from_bdm。第 9 段階の後半。export_bdm は第 11 段階）──
// 入力の形の欄（mcp-tools.js の read・write が obj で包み、知らない欄を断る）。ファイルの場所を受け取る欄は作らない（設計書の 1-4）
const materialInputs = {
  list: { system: S.system, cursor: S.cursor },
  read: { system: S.system, material: S.material, cursor: S.cursor },
  swimlaneFromBdm: {
    system: S.system, material: S.material, expect: S.expect,
    replace: opt(z.boolean().describe('今のスイムレーン図に作業があるとき、置き換えてよいか。人に確かめてから true を書く（省くと、今の図に作業があれば断る）')),
  },
  exportBdm: { system: S.system, material: S.material },
};

const opsOf = (union) => z.array(union).min(1).describe('操作の並び（まとめて 1 回の変更になる）');

// ── 設計ノート（get_notes・update_notes・set_stage。第 10 段階の前半）──
// 段階の鍵と進み具合。ページの NOTE_STAGES・NOTE_STATES と同じ（test/mcp.test.js で比べる）。
// set_stage の todo（まだ）は、ページが「前の段階を直すときは review に戻す」の文で断る（その文を AI に届けるため、入口の形では断らない）
const NOTE_STAGES = ['read', 'flow', 'items', 'screens', 'docs'];
const NOTE_STATES = ['todo', 'doing', 'review', 'done', 'skipped'];
const noteStage = z.enum(NOTE_STAGES).describe('段階: "read"（① 資料から読み取る）・"flow"（② 業務の流れ）・"items"（③ データベースの項目）・"screens"（④ 画面）・"docs"（⑤ 説明書と出力）');
const noteRow = (what) => z.string().describe(`${what}の行の id（get_notes の id）`);
const noteOps = z.discriminatedUnion('op', [
  op('set_findings', { text: z.string().describe('読み取ったことの全体（8000 字まで。空の文で消す）') },
    '① で資料から読み取ったこと（業務の要約・登場人物・今の手順・様式ごとの欄の一覧）を書く（今の文を全部置き換える。足すときは get_notes で読んだ文に足して書く）'),
  op('set_memo', { text: z.string().describe('メモの全体（8000 字まで。空の文で消す）') }, 'メモを書く（今の文を全部置き換える）'),
  op('add_decision', {
    stage: noteStage, text: z.string().describe('決めたこと'),
    reason: opt(z.string().describe('理由（理念・概要の文を判断に使ったときは、そのことも書く）')),
  }, '決めたことと理由の行を足す'),
  op('edit_decision', { id: noteRow('決めたこと'), stage: opt(noteStage), text: opt(z.string()), reason: opt(z.string()) }, '決めたことの行を直す（書いた欄だけ変える）'),
  op('remove_decision', { id: noteRow('決めたこと') }, '決めたことの行を消す'),
  op('add_question', { stage: noteStage, text: z.string().describe('まだ決まっていないこと（資料でわからないこと・人に聞きたいこと）') }, 'まだ決まっていないことの行を足す'),
  op('edit_question', { id: noteRow('まだ決まっていないこと'), stage: opt(noteStage), text: opt(z.string()) }, 'まだ決まっていないことの行を直す（書いた欄だけ変える。答えは answer_question で書く）'),
  op('answer_question', { id: noteRow('まだ決まっていないこと'), answer: z.string().describe('人の答え（空の文にすると、まだ決まっていないことに戻る）') },
    'まだ決まっていないことに、人の答えを書く（人の答えで決まったとき）'),
  op('remove_question', { id: noteRow('まだ決まっていないこと') }, 'まだ決まっていないことの行を消す'),
]);
// 入力の形の欄（materialInputs と同じく、mcp-tools.js の read・write が obj で包み、知らない欄を断る）
const noteInputs = {
  get: { system: S.system, cursor: S.cursor },
  update: { system: S.system, expect: S.expect, ops: opsOf(noteOps) },
  stage: {
    system: S.system, stage: noteStage,
    state: z.enum(NOTE_STATES).describe('進み具合: "doing"（作業中）・"review"（確認待ち）・"done"（確認済み）・"skipped"（確認を飛ばした）。"todo"（まだ）には戻せない（断る。前の段階を直すときは "review" に戻す）'),
    expect: S.expect,
  },
};

// prompts（mcp-server.js の registerPrompt）の引数の形。args は mcp-guide.js の PROMPTS の { 名前: { required, description } }。引数は文字だけ
const promptArgs = (args) => Object.fromEntries(Object.entries(args).map(([k, a]) => [k, (a.required ? z.string() : z.string().optional()).describe(a.description)]));

module.exports = {
  z, obj, S, layout, itemOps: opsOf(itemOps), screenOps: opsOf(screenOps), partOps: opsOf(partOps), calloutOps: opsOf(calloutOps), processOps: opsOf(processOps),
  roleOps: opsOf(roleOps), swimSteps: z.array(swimStep).describe('作業の並び（今のスイムレーンの作業を全部置き換える。空の並びで作業を全部消す）'),
  swimEdges: z.array(swimEdge).describe('矢印の並び（今の矢印を全部置き換える。省くと、今の矢印のうち両端の作業が残っているものを残す。[] で全部消す）'),
  materialInputs, noteInputs, promptArgs, DEVICES, LOOKS, ITEM_VIEWS, TABLE_KINDS, CALLOUT_COLORS, CALLOUT_TIPS, ALIGN_HOW, MAX_SCREEN_HEIGHT, SWIM_KINDS, NOTE_STAGES, NOTE_STATES,
};
