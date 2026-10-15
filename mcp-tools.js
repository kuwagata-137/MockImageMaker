// mcp-tools.js — AI の入口（mcp-server.js）が出す MCP の道具の一覧（第 7 段階。第 8 段階で 3 つ足した。設計書の 9-2）
// 名前・日本語の説明・入力の形（mcp-schemas.js）・読むだけか・時間がかかるか、を決める。道具の中身はページの「AI の窓口」にある。
// read_guide だけは入口の中で返す（local。アプリが動いていなくても読めるように）。
// slow の道具は、アプリの側（automation-main.js の SLOW_TOOLS）でも時間切れを 5 分にしている。2 か所を同じにする。
'use strict';

const { z, obj, S, layout, itemOps, screenOps, partOps, calloutOps, processOps } = require('./mcp-schemas');
const { GUIDE_TOPICS } = require('./mcp-guide');

const read = (name, title, description, shape, extra = {}) => ({ name, title, description, input: obj(shape), readOnly: true, ...extra });
const write = (name, title, description, shape, extra = {}) => ({ name, title, description, input: obj(shape), readOnly: false, ...extra });

const TOOLS = [
  read('read_guide', '手引きを読む',
    'モックイメージメーカーの使い方の手引きを読む。初めて使うときは "overview" を最初に読む。"layout" は部品の並べ方、"catalog" は部品のカタログの読み方、"rules" は守ること。',
    { topic: z.enum(GUIDE_TOPICS).describe('手引きの名前') }, { local: true }),
  read('list_designs', '画面設計の一覧',
    '画面設計の一覧（id・名前・作る先・画面と項目の数・最新の版・更新の印 updatedAt）を返す。query で名前を探せる。',
    { query: z.string().optional().describe('名前に含まれる文字'), trashed: z.boolean().optional().describe('ごみ箱にある画面設計も出す'), cursor: S.cursor }),
  read('get_design', '画面設計の中身',
    '画面設計の中身の要約を返す: 名前・作る先・説明・データベースの項目の一覧（設定の文つき）・画面の一覧（id・名前・機器・大きさ・部品の数）・改訂履歴の行・取り込まれている項目・更新の印 updatedAt。',
    { design: S.design, cursor: S.cursor }),
  read('get_screen', '画面の中身',
    '画面 1 つの中身を返す: 部品（id・赤い番号・種類・項目名・位置と大きさ・設定の文）・吹き出し・部品の設定の一覧表の文。' +
    '多いときは、部品・吹き出し・一覧表の行の順に分けて返し、nextCursor を付ける（cursor に渡すと続きを読める。全部の数は partsTotal・calloutsTotal・tableTotal）。',
    { design: S.design, screen: S.screen, cursor: S.cursor }),
  read('get_screen_image', '画面の画像',
    '画面の画像（PNG。長い辺を 1568 ドットまでに縮める）を返す。作った画面の見た目を確かめるときに使う。',
    { design: S.design, screen: S.screen, withTable: z.boolean().optional().describe('部品の設定の一覧表と吹き出しも写す（既定は写さない）') }, { slow: true }),
  read('get_flow', 'ステータスの移り方と画面の移り方',
    'ステータスの移り方（ステータスの並びと、ステータスを進める操作。前のステータス・次のステータス・操作する人・条件）と、' +
    '画面の移り方（ボタン・リンクの文字ごとの移る先と、ほかの画面設計から移ってくるもの）を表の形で返す。' +
    '多いときは、操作・移る先・移ってくるもの の順に分けて nextCursor を付ける（全部の数は actionsTotal・movesTotal・incomingTotal）。',
    { design: S.design, cursor: S.cursor }),
  read('get_view_image', '図の画像',
    '図の画像（PNG。長い辺を 1568 ドットまでに縮める）を返す。view: "map"（つながりの図。ルックアップと取り込みでつながる画面設計）・' +
    '"process"（ステータスの移り方の図）・"screenflow"（画面の移り方の図）。作った移り方を見て確かめるときに使う。',
    { design: S.design, view: z.enum(['map', 'process', 'screenflow']).describe('図の種類') }, { slow: true }),
  read('get_catalog', '部品のカタログ',
    '部品の種類（type・名前・最初の大きさ・設定の欄と値の形）・項目の種類・ひな形・機器・作る先・吹き出しの色・並べ方の数を返す。',
    {}),
  write('create_design', '画面設計を作る',
    '新しい画面設計を作る（白紙の画面が 1 つ入る）。作った画面設計の id と、最初の画面の id を返す。',
    { name: z.string().describe('画面設計の名前（業務アプリの名前。例 "顧客管理"）'), target: z.string().optional().describe('作る先（"kintone"・"Salesforce"・"Claude で作るアプリ" か、ほかの名前）'), description: z.string().optional().describe('説明') }),
  write('update_design', '画面設計の情報を直す',
    '画面設計の名前・作る先・説明を直す。',
    { design: S.design, expect: S.expect, name: z.string().optional(), target: z.string().optional(), description: z.string().optional() }),
  write('edit_items', 'データベースの項目を直す',
    'データベースの項目を足す・直す・消す・並べ替える・ルックアップを付ける・ほかの画面設計から取り込む・つながりを切る・一覧表に戻す（ops に並べて 1 回で行う）。',
    { design: S.design, expect: S.expect, ops: itemOps }),
  write('add_screen', '画面を足す',
    '画面を足す。template（ひな形）か copyOf（複製する画面）で中身を決め、layout を書くと部品をその並べ方で足す。パソコン以外の機器の画面は、template "blank" と layout で作る。',
    {
      design: S.design, expect: S.expect,
      template: z.string().optional().describe('ひな形（get_catalog の templates の id。例 "input"・"list"。既定は "blank"）'),
      copyOf: S.screen.optional().describe('複製する画面'), name: z.string().optional().describe('画面の名前'),
      after: S.screen.optional().describe('この画面の後ろに入れる（既定はいちばん後ろ）'),
      device: z.enum(['pc', 'tablet', 'phone']).optional().describe('機器（既定は "pc"）'), layout: layout.optional(),
    }),
  write('edit_screen', '画面を直す',
    '画面の名前・機器・高さ・帯・一覧表の位置を直す・並べ替える・画面を消す（ops に並べて 1 回で行う）。',
    { design: S.design, expect: S.expect, ops: screenOps }),
  write('layout_screen', '部品を並べて置く',
    '並べ方（layout。read_guide の "layout"）で部品を置く。位置と大きさはアプリが決める。mode "append" は今の部品の下に足し、"replace" は部品と吹き出しを全部消してから置く。',
    { design: S.design, screen: S.screen, expect: S.expect, layout, mode: z.enum(['append', 'replace']).optional().describe('既定は "append"') }),
  write('edit_parts', '部品を直す',
    '部品を直す・位置と大きさを数で直す・ずらす・消す・赤い番号を振り直す・揃える・表の中身を変える・番号を付け外しする（ops に並べて 1 回で行う）。',
    { design: S.design, screen: S.screen, expect: S.expect, ops: partOps }),
  write('edit_callouts', '吹き出しを直す',
    '吹き出しを足す・直す・動かす・消す（ops に並べて 1 回で行う）。',
    { design: S.design, screen: S.screen, expect: S.expect, ops: calloutOps }),
  write('edit_process', 'ステータスと操作を直す',
    'ステータスの移り方（kintone のプロセス管理に当たる）を直す: ステータスの並び（申請 → 承認待ち → 承認済み など）と、ステータスを進める操作' +
    '（例「承認する」: 承認待ち → 承認済み。操作する人・条件つき）を足す・直す・消す・並べ替える（ops に並べて 1 回で行う）。ステータスと操作は id か名前で指す。',
    { design: S.design, expect: S.expect, ops: processOps }),
  write('add_revision', '改訂する',
    '改訂する: 次の版の番号（第◯版）と今日の日付の行を改訂履歴に足し、今の中身の写しを残す。note は変えた内容（PDF の表紙の改訂履歴に出る）。',
    { design: S.design, expect: S.expect, note: z.string().optional().describe('変えた内容') }),
  write('restore_revision', '前の版に戻す',
    '前の版の中身に戻す。戻す前の中身は改訂履歴の「戻す前の状態」の行に自動で残る。人に頼まれたときだけ使う。',
    { design: S.design, expect: S.expect, revision: z.union([z.string(), z.number()]).describe('改訂履歴の行の id か版の番号（2・"第 2 版"）') }),
  write('export_design', '書き出す',
    '画面設計を PDF・HTML・PNG に書き出し、決めたフォルダ（ドキュメント\\モックイメージメーカー\\AI の書き出し）に書いたファイルの場所を返す。同じ名前のファイルがあれば番号を付ける。',
    {
      design: S.design, format: z.enum(['pdf', 'html', 'png']).describe('書き出す形'),
      screens: z.array(S.screen).optional().describe('書き出す画面（既定は全部。PDF・PNG）'),
      paper: z.enum(['A4', 'A3', 'slide']).optional().describe('PDF の用紙（既定は "A4"。"slide" は 16:9 の横）'),
      orient: z.enum(['landscape', 'portrait']).optional().describe('PDF の向き（既定は "landscape"）'),
      cover: z.boolean().optional().describe('PDF に表紙を入れる（既定は入れる）'),
      map: z.boolean().optional().describe('PDF につながりの図のページを入れる（つながりがあるとき。既定は入れる）'),
      items: z.boolean().optional().describe('PDF にデータベースの項目の一覧表のページを入れる（項目があるとき。既定は入れる）'),
      process: z.boolean().optional().describe('PDF にステータスの移り方のページ（図と操作の一覧表）を入れる（操作があるとき。既定は入れる）'),
      flow: z.boolean().optional().describe('PDF に画面の移り方のページを入れる（ボタン・リンクの文字の移る先があるとき。既定は入れる）'),
      diffWith: z.union([z.string(), z.number()]).optional().describe('この版（改訂履歴の行の id か版の番号）との違いを「新」「変」の印で示す'),
    }, { slow: true }),
];

const TOOL_NAMES = TOOLS.map((t) => t.name);

module.exports = { TOOLS, TOOL_NAMES };
