# ビジネスダイアグラムメーカー — AI向け仕様書

このドキュメントは、**AI（コーディングアシスタント）に本アプリの仕様を素早く正確に理解させる**ことを目的とした説明書です。実装ファイル（`diagram_v8.24.html`）を全文読まなくても、アーキテクチャ・データモデル・主要関数・拡張時の注意点を把握できるように構成しています。

- 対象実装: `diagram_v8.24.html`（最新版。運用は「最新版を直接更新」。版番号は定数 `APP_VER='8.24'` にも持ち、保存データの `appVer` に書き込まれる）
- **注意**: 本文中の行番号は v8.24 時点（全15077行）のもの。以後の追加で数百行ずれる。**関数名で `grep` して現在位置を確かめること**。
  v8.10 で追加された関数の索引は「付録B」、v8.11〜v8.31 の追加ぶんは「付録C」を参照（いずれも関数名で引く）。
- 併読推奨: `CLAUDE.md`（プロジェクト指示・**現行ステータス＝各版の変更点の要約**）／`運用ルール.txt`（バージョニング）／`開発ロードマップ.txt`（計画）／`開発記録_v8.txt`（why・経緯）
- 本ファイルはコードの「what/how の索引」。**why・バグ経緯は `開発記録*.txt` が正**。仕様変更時は本ファイルも追随更新すること。

---

## 1. アプリ概要

- **単一 HTML ファイル完結**のビジネス図エディタ。ビルド・サーバー・外部CDN不要。ブラウザで開くだけで動作する。
- 依存ライブラリ（ExcelJS＝Excel出力用）も**実行時フェッチせずインライン同梱**（`<script id="exceljs-lib">`）。オフライン完結が設計の絶対条件。
- **コアエンジン共通化**が設計思想。ノード配置・接続線ルーティング・保存/復元・エクスポートを全図種で共用し、図種ごとに「パレット・レーン有無・描画」だけを切り替える。
- 保存ファイル自体が**自己完結HTML**（アプリ＋状態を1ファイルに埋め込み）。開けば編集を再開できる。

### 対応図種（10種）
`swimlane`（スイムレーン図）／`flowchart`（フローチャート）／`bpmn`（プロセスフロー BPMN）／`statechart`（状態遷移図）／`er`（ER図）／`orgchart`（樹状図。旧「組織図」。**内部キーは後方互換のため `orgchart` 固定**）／`sequence`（シーケンス図）／`gantt`（ガントチャート／工程表）／`mindmap`（マインドマップ）／`uml`（UMLクラス図）。

---

## 2. 技術構成・制約

| 項目 | 内容 |
|---|---|
| 言語 | 素の HTML + CSS + Vanilla JavaScript（フレームワーク・ビルドツール一切なし） |
| 描画 | SVG（`<svg id="diagram-svg">` に全図形を描画。DOM直接操作） |
| 状態 | 単一グローバルオブジェクト `S`（後述）。DOMは`render()`で状態から毎回再生成 |
| 依存 | ExcelJS（MIT・インライン同梱）。それ以外の外部依存なし |
| 座標 | SVGユーザー座標系。ズームは `transform: scale()` で表現（`svgPt` は `getScreenCTM` 経由で画面→図座標へ換算） |
| 永続化 | 保存＝自己完結HTMLダウンロード。復元＝そのHTMLを読み込み `window.__SWIMLANE_STATE__` を復元 |
| 版番号 | `APP_VER`（保存データの `appVer` に記録。旧版データの移行判定に使う） |

**絶対に守る制約**: ①単一HTML完結を崩さない（外部リクエスト追加禁止）、②既存図種の後方互換維持（保存済みファイルが開けること）、③コアエンジン改修は最小限に。

---

## 3. ファイル内の区画マップ（`diagram_v8.24.html`・全15077行）

| 行 | 区画 | 内容 |
|---|---|---|
| 1–6 | `<head>` | メタ情報 |
| 7–402 | `<style>` | 全CSS（見出しバー・Office風メニューバー・サイドバー・モーダル・SVG要素スタイル・固定表示の重ね箱 `.gstick`） |
| 407 | ExcelJS | インライン同梱ライブラリ（`<script id="exceljs-lib">`・**ミニファイ済み1行が長大**。読む必要はほぼ無い） |
| 404–1105 | `<body>` UI | 見出しバー `#app-title-bar`（図種バッジ＋図の名称 `#diagram-name`）・メニューバー `#toolbar`（`#toolbar-scroll` 横スクロール＋下段バー `#tb-bottombar`）・左右サイドバー・キャンバス `#canvas-wrap`（固定表示の重ね箱 `#gstick-*` ＋ 本体 `#diagram-svg`）・`#hint`／`#toast`・各種モーダル |
| 1106–15075 | メインJS | アプリ本体（約14000行・関数747個）。以降の全ロジック |
| 15076– | 終了タグ | |

> 注意: このHTMLには**極端に長い行（ミニファイ済みブロック）**が含まれる。`Read` で全文読むとトークン超過する。`awk 'NR>=A && NR<=B && length($0)<400'` 等で範囲＋行長を絞って読むこと。

### メインJSの主なセクション順（1106行〜）
定数・図種定義（`DIAGRAM_TYPES` 1140行〜／`SD` 1229行〜／`APP_VER` 1276／`STYLES` 1288／`STEP_THEMES` 1318）→ グローバル状態 `S`（1413行）→ ジオメトリ/レーン/判定ヘルパ（`isFreeShape`・`isOverlayShape`・`isGroupType`・文字サイズ系）→ `init()`（2510）→ ノード/エッジ操作・履歴 → 接続線ルーティング（`orthoRoute` 4461〜・ポート割当・交差ブリッジ）→ 図種別ロジック（ガント・マインドマップ・シーケンス・樹状図・UML）→ 描画パイプライン（`render()` 7724〜／`shapeEl` 8623〜／`renderGroupBands` 8868〜）→ 入力ハンドラ（`svgMD` 9545／`svgRC` 9588／`onDocMouseMove` 10049／キー 11635〜）→ グループ枠の切り欠き（`groupCuts` 11011〜）→ 未保存判定（`docState` 11794〜）→ 保存（`saveHtmlCore` 12046〜）→ 印刷・改ページ（`printPagePlan` 12324〜）→ 書き出し（`buildExportSvg` 12472〜／`expPDF` 12574〜）→ インポート・テキスト作図。

---

## 4. グローバル状態モデル `S`

すべての編集状態は単一オブジェクト `S` に集約（1413行 `let S={...}`）。

```js
let S = {
  diagramType:'swimlane',  // 現在の図種キー（DIAGRAM_TYPES のキー）
  orientation:'vertical',  // 'vertical' | 'horizontal'（縦横。図種により固定/非表示あり）
  lanes:[],   // レーン配列（useLanes 図種のみ）。{id,name,bg,hd,w}
  nodes:[],   // シェイプ配列（下記データモデル）
  edges:[],   // 接続線配列（下記データモデル）
  sel:[],     // 選択中ノードidの配列（複数選択対応）
  mode:'select',  // 'select' | 'connect' | 'hand' | パレット配置中はパレット由来のモード（保存対象外）
  conn:null,  // 接続作成中の始点情報（接続モード）
  drag:null,  // ドラッグ中の一時状態
  hist:[], hi:-1,  // Undo/Redo履歴（JSON文字列スタック・最大80）
  uid:0,      // id採番カウンタ（uid()が'e'+(++S.uid)を返す）
  gantt:defaultGantt(),   // ガント時間軸・見出し欄・凡例モデル
  mindLayout:'radial',    // マインドマップのレイアウト 'radial' | 'tree'
  gridOn:true,   // 方眼グリッド表示
  style:'standard',  // デザインテンプレート（STYLES のキー）
  stepNums:false,    // ステップ番号バッジ表示
  docId:null,        // 文書ID（読み込み直後に遅延生成。未保存判定の指紋からは除く）
  mindBranch:'curve',   // マインドマップの枝線の形
  mindReserve:[],       // マインドマップのリザーブ領域（未配置トピック・v8.11追補）
  printPaper:'A4', printOrient:'portrait',  // 印刷用紙・向き（v8.22。改ページ計算に使う・保存対象）
  pbPreview:false       // 改ページプレビュー表示（画面のみ・保存対象外）
};
```

補足:
- 図面名は別変数 `S_diagramName`（入力欄 `#diagram-name`）。保存時にHTMLの `<title>` にも反映される。
- **モジュール変数で持つ一時状態**（`S` に入れない設計）: クイック接続の接続元 `hoverConn`、ハンドツールのパン `panState`、編集中の欄 `_editTarget`、選択ヒント表示中フラグ `_hintSel`、端オートスクロール `edgeAutoScroll`、切り欠きドラッグ `groupCutState`／`groupNotchState`、○＋の登録簿 `_qcHover`（v8.29）。`S.mode` を増やさないのは「`S.mode==='select'` 判定のUI（リサイズハンドル・⧉ 等）を巻き添えにしない」ため。
- **ポップアップ（`#lane-choice` 系・図種メニュー）の外側クリック**は `bindOutsideClose(el,onClose,{delay,ignore})`（v8.29）＝document の mousedown を**キャプチャ段階**で拾う（図の中＝stopPropagation する要素の上でも閉じる）。新しいポップアップも必ずこれを使い、自前で document のバブル段階に登録しない。
- **ポップアップの位置は `placePopupAt(dlg,x,y,{dx,dy}=12)`**（v8.30）＝body に付けてから実寸（`getBoundingClientRect`・offsetWidth は整数丸めで端がはみ出す）を測り、四辺とも画面内に収める。錨は「押した点」（`_lastPointer`＝document のキャプチャ段階 mousedown で記録。`showLaneChoice` はこれ）か「図座標×`zoomLevel`」（`showEventChoice` 等）。**固定の高さ見込み（`innerHeight−160` のような値）で置かない**＝レーン数・項目数で高さが変わる。

---

## 5. データモデル

### ノード（`S.nodes[]` の要素）
```js
{
  id, type,          // type は SD/DIAGRAM_TYPES.palette のキー
  x, y, w, h,        // 左上座標とサイズ（SVGユーザー座標）
  text,              // 主ラベル
  lid,               // 所属レーンid（レーン無し図種は VIRTUAL_LANE.id='__virtual__'）
  // 以下はオプショナル（機能ごとに付与・後方互換のため未定義でも動く。既定値と一致したらキーごと削除する流儀）
  color, stroke,     // 個別色（未指定は SD のデフォルト）
  variant,           // シェイプの変種
  note, noteAlign,   // note/sys_input_desc/state_detail の補足本文と揃え（量に応じ自動リサイズ）
  sections,          // ER/UML/組織ノードの区画（複数行の内部テーブル）。sections[i].align で区画ごとの揃え
  textAlign,         // 'left'|'center'|'right'
  fontSize,          // 文字サイズpx（v8.14。既定は defaultFontSize(n)＝通常12・グループ枠16。既定値ならキー削除。説明有シェイプでは名称の欄）
  noteFontSize,      // 説明有シェイプの説明欄の文字サイズpx（v8.29。既定 NOTE_FONT=10・既定値ならキー削除。noteFontSize(n) で読む）
  manualW, manualH,  // 手動リサイズ済みの印（v8.10）。付いていると autoFitNodeSize が下限扱い＝縮めない・文字は fitNodeFontSize で縮小
  dashed,            // true のみ保持＝点線（v8.18。枠線 stroke-dasharray を継承で内部仕切り線まで波及）
  groupId,           // グループ化（swimlane/flowchart/bpmn 等のみ）
  flowId, flowKind,  // ステップ図（番号サークル/ピル/矢羽）の列管理
  // 図種・シェイプ固有:
  cuts,              // group_box の切り欠き（v8.18/v8.24）: {tl|tr|bl|br: {w,h} | [{w,h},...], t|b|l|r: {c,w,h}}
                     //   角＝1段なら {w,h}、2段以上は配列（w昇順・h降順の階段）。辺中央の凹＝{c:中心,w:開口幅,h:深さ}
  thick,             // crosslane（複数レーンプロセス）の帯の厚み（v8.14）
  mainPos,           // crosslane の主軸固定位置。x/y/w/h は normalizeCrosslaneGeometry が毎 render 作り直す派生値
  row, phaseId,      // gantt: 行番号・所属フェーズ
  parentId, collapsed, importance, branchIdx, // mindmap 系（※親子は主にエッジで表現）
  lifelineId,        // sequence: activation が属する lifeline
  busPos,            // 樹状図/組織図のバス型接続線の分岐位置(0.08〜0.92)
}
```

**シェイプ分類の判定関数**（挙動の差はこれらで分岐する）:
- `isFreeShape(type)`: レーンに束縛されない type（グループ枠・ライフライン・ガント・マインド・UML 等）。
- `isOverlayShape(type)`: **重ね置きシェイプ**＝`doc`（書類）／`parallelogram`（データ）／`supplement`（補足情報）。レーンには属す（`lid` 追従）が位置クランプ免除・経路の障害物にならない・吸着無効（例外＝書類・データどうしの中心そろえ `computeOverlaySnap`・v8.29）・最前面描画・クイック接続の○＋を出さない。
- `isGroupType(t)`: `group_box`／`org_group`（グループ枠）。接続先にならない（`nodeAtPoint(x,y,{noGroup:true})`）。
- `isDiamondShape`（判断＝頂点固定接続）／`isReplaceableShape`（重ねドロップ置換の対象）／`isResizable`。

### エッジ（`S.edges[]` の要素）
```js
{
  id, from, to,      // 接続元/先ノードid
  label, fromLabel, toLabel,  // 中央/端点ラベル
  fromLid, toLid,    // 端点のレーン参照（crosslane の接続矩形をレーンに絞るのに使う。無ければ端点位置から推定）
  // オプショナル:
  labelDX, labelDY,  // ラベルの手動オフセット
  dashed,            // true のみ保持＝点線（矢印マーカーは実線のまま）
  msgType, msgY,     // sequence: 同期/非同期・メッセージのY位置
  depType,           // gantt: 依存タイプ
  umlType,           // uml: 関連の種類（継承/実装/集約/コンポジション等でマーカー切替）
  // 手動編集の証拠（付いていれば手動編集済み・無ければ毎回ルーターが引き直す）:
  waypoints,         // 手動経由点（曲線・区間スライド）
  orthoWps, midPos,  // 直交経路の手動曲がり角／中間線の位置
  fromPin, toPin,    // 接続位置ピン {side:'top'|'bottom'|'left'|'right', frac:0〜1}（frac はどこからも不可侵。クイック接続は fromPin={side,frac:0.5} を載せる）
}
```

### レーン（`S.lanes[]`）
`{id, name, bg（背景色）, hd（見出し色）, w（幅＝縦モードでは横幅・横モードでは高さ）}`。色プリセットは定数 `LC`。レーン無し図種は `VIRTUAL_LANE` を用いる。

### ガントモデル（`S.gantt`）
`defaultGantt()` が生成。時間軸（`startDate`/`endDate`/`scale='hour'|'day'|'week'|'month'`（既定 day・v8.06 で hour 追加）/`colWidth`）、左情報欄の列幅（`nameW`/`descW`/`assigneeW`・追加列は列単位のラベル `r3Label`/`r4Label`・旧データ移行 `ganttMigrateColLabels`）、見出し欄 `header`（工事名・自由な「ラベル：値」行・作成日・承認欄・`collapsed`＝畳み状態）、凡例 `legend` を持つ。工程表用途に対応する汎用カラムモデル。

---

## 6. 図種定義 `DIAGRAM_TYPES`（1140行〜）

各図種の「振る舞いの差」を宣言的に持つテーブル。新図種追加や図種特性の理解はまずここを見る。

```js
DIAGRAM_TYPES[key] = {
  name,             // 表示名（日本語）
  useLanes,         // レーンを使うか（true/false）
  defaultLanes,     // 初期レーン数
  palette:[...],    // 左パレットに並ぶシェイプtypeの配列
  palLabels:{...},  // パレットの表示ラベル
  shapeTexts:{...}, // 配置時の初期テキスト
  noArrow,          // 接続線に矢印を付けない（orgchart/mindmap）
  fixedOrientation, // 縦横固定（gantt='horizontal'）
}
```

- シェイプ既定サイズ・色は別テーブル `SD`（1229行〜）。`SD[type] = {w,h,text,fill,stroke}`。判断（`diamond`）の既定は 180×59（v8.23）。ひし形系は `isDiamondShape`＝`diamond`/`er_relation`/`gateway_xor`/`gateway_par`。
- `useLanes()` / `getDT()` / `usesLanes()` 等のヘルパで図種特性を参照する。
- 図種切替は `selectDiagramType(type)`（**全リセットして切替**・未保存なら `confirmSave4` の4択）→ `applyDiagramType()` がUI表示（メニューバーの図種ツール群・サイドバーのデザイン/ステップ等）を切り替える。
- スイムレーン／フローチャート／BPMN の3図種で共通に使えるシェイプ: プロセス系・判断・グループ枠 `group_box`・複数レーンプロセス `crosslane`・書類 `doc`・データ `parallelogram`・補足情報 `supplement`・システム入力 `sys_input`／`sys_input_desc`（説明有）・複数レーンシステム入力 `crosslane_sys_input`（v8.29＝crosslane と同じ帯に両端の二重線）。
- パレットの並びは3図種とも「プロセス／説明有／複数レーンプロセス」「システム入力／説明有／複数レーンシステム入力」「判断…」の族順（v8.29）。凡例（`exportLegendItems`）はパレット順。

---

## 7. 座標系・縦横・レーン

- **縦横（orientation）**: `isV()`＝縦モード判定。多くのロジックが「主軸（フローの進む向き）」と「交差軸（レーンをまたぐ向き）」で書かれる。`isV()`のとき主軸=Y・交差軸=X。
- `tV()` / `textUpright()`: 組織図（樹状図）は横向きでも箱・文字を回転させない例外。
- レーン: `laneAt(pos)`（座標→レーン）、`laneX(id)`（レーン左端）、`headerSize()`（レーン見出し帯の厚み）、`nodeLaneIdx(n)`（位置からレーンを判定）。
- 自由図種（レーン無し）では全ノードが `VIRTUAL_LANE` 所属になる。
- **キャンバスの自動拡張**: レーン図は主軸のみ、非レーン図は両軸が「内容の端＋200px・`GRID_STEP`(80px) 切り上げ」まで伸びる（`calcCanvasSize`・移動/リサイズ中も `syncZoomSpacer()` でスクロール範囲を即時追随）。`#zoom-spacer` は最下部シェイプを画面中央まで送るための余白（`SVG_H` は変えない＝書き出しに空白は増えない）。
- **画面端オートスクロール** `edgeAutoScroll`（v8.23）: 範囲選択・リサイズ・移動・切り欠きドラッグ中にカーソルが `#canvas-wrap` の端24px以内へ来ると rAF ループでスクロールし、最後のマウス位置で `onDocMouseMove` を合成イベントで再実行する。ガント・シーケンス・マインドマップは対象外。`window` の blur で停止。**v8.31追補⑨**: ハンドツール中も対象（パン中は `tick` が止める）・`busy()` に接続線を引いている間（`S.mode==='connect'&&S.conn`・`hoverConn`＝ボタンを離したままでも効く＝グループ枠の 2 クリック配置と同じ）と接続線のドラッグ（`edgeReconnectState`・`waypointDragState`・`segDragState`・`crankDragState`・`labelDragState`）を追加・`update(ev)` は止まっていれば動かし始める。`tick` は実行中に `raf` を空にしない（中で呼ぶ `onDocMouseMove`→`update` が 2 本目のループを始めて倍々になる）。

---

## 8. コア機能と主要関数

### 配置・選択・移動
- `addNode(type,sx,sy,opts)`: シェイプ配置の中枢。レーン吸着・他シェイプへの整列スナップを行う。**v8.05以降、配置直後は選択状態にしない**（マインドマップだけは例外＝選択＝次の配置の親）。
- パレット操作: `palClick` / `palDragStart`（クリック・ドラッグ配置）、`placeShape` / `place`。グループ枠は2クリック配置（コーナー2点。空白でのみ置く＝シェイプ上のクリックは選択）。**クリック配置は「左ボタンを離した位置」で行う**（v8.29）: `svgMD` は保留 `palPlaceState={type}` を立てるだけ、document の mouseup が `placePtAtClient(clientX,clientY)`（`#canvas-wrap` の見えている範囲・svg 矩形・見出し帯より内側＝パレットドラッグと同じ条件）を通して `placeShape`／`groupBoxClick`。`chordToggleMode`（左右同時押し）・`clearPal`（Esc・右クリック・モード切替）は保留を破棄。配置を mousedown に戻さないこと（同時押しの1発目で置かれる）。**パレットで次のコマンドを始めたら前のコマンドを終える**（v8.31追補④ `endCommandsForPalette`）＝クリックで選んだとき・ドラッグを始めたとき（押した位置から 4px 動いた時点）に、スペース挿入／調整・貼り付け・グループ枠の 1 点目・○＋の接続先選択を終える（ドラッグではクリックで選んでいたシェイプも解除）。
- 選択: 単一/複数（Ctrl・Shift＋クリック・範囲選択）。`selectAll()`（Ctrl+A）、`selWithGroup()`（グループ単位選択）、`selectGroupContents`（グループ枠の ⧉ ＝枠内シェイプ一括選択）。当たり判定は `nodeAtPoint(x,y,opts)`（グループ枠は後回し・`{noGroup:true}` で除外）。
- 移動: ドラッグ、`nudgeSel(dx,dy)`（矢印キー微移動）。Shiftドラッグ＝水平/垂直固定。**Ctrl(⌘)を押している間だけコピー**（`convertDragToCopy`／`revertDragToCopy` でドラッグ中に双方向切替。crosslane 系も対象＝v8.29。原本を開始位置へ戻すときは `syncCrosslaneMain` で mainPos も戻す）。複数選択ドラッグは掴んだシェイプを代表に単一移動と同じ吸着を計算し、移動量を全員へ一律適用（v8.16。crosslane は `syncCrosslaneMain` で主軸のみ）。
- 整列スナップ: `computeAlignSnap`（非レーン図・許容差 `alignTol()`＝フローチャートは3px）/ `equalSpaceSnap`（等間隔）／`snapMainToShapes`（主軸）／`snapCrossInLane`（レーン内 1/4・中央・3/4 ガイド、20px）／**接続相手優先** `snapCrossToPartners`（相手との中心揃えを最優先・ピンク破線 `appendPartnerGuideV/H`。**v8.31追補⑫**: 目標は `partnerSnapTargets`＝線の向きの軸では相手側の線の付け根（相手の辺の端が 2 本以上／位置固定のピン。1 本なら中心）に自分側の付け根を合わせる位置・`snapMainToShapes` の相手優先と `computeAlignSnap` の相手優先も同じ）。ガイド線描画 `renderGuides`／`renderAlignGuides`。方眼吸着 `gridSnapActive()`（Altで一時解除）。重ね置きシェイプは全吸着無効——**例外は書類・データどうしの吸着**（v8.29 `computeOverlaySnap`／`overlaySnapType`＝`doc`・`parallelogram` のみ・補足情報は対象外。相手の外接矩形の隙間が `OVERLAY_SNAP_NEAR`=60px 以内なら縦横それぞれ芯のずれ `OVERLAY_SNAP_TOL`=±6px で吸着。`addNode`・単一ドラッグ（レーン図／非レーン図）・パレットのプレビュー `previewOverlaySnapGuides` で共用。Alt／Shift 固定中は無効。ガイドは `renderOverlaySnapGuides`＝芯はピンク破線）。**v8.31追補⑩**: 芯＝文字の芯（`overlayCoreDY`＝書類は (h−`DOC_WAVE`)/2＝描画の `textCy` と同じ・データは h/2）／等間隔 `overlayEqualSpace`（隣との間隔を「隣とさらに隣の間隔」に・2 つの間では両側を同じに。間隔 0〜60px・紫の区間ガイド `type:'space'`）／軸ごとに芯そろえと等間隔のうちずらす量の小さいほう＝`overlaySnapMany(items,ex,{lockX,lockY})`／**複数選択の移動にも**（選んだ書類・データのどれかが吸着すれば全員が同じだけ動く・掴んだシェイプの吸着が決まった軸は lock）。詳細は付録「v8.31追補⑨⑩」。**v8.31追補⑪**: 並びの続きが無い側（2 個目を置くとき）は既定の間隔 `OVERLAY_DEFAULT_GAP`=4px に吸着（±6px・縦も同じ・並びがある側はその間隔だけ）／データどうしの横の間隔は斜めの辺どうしの間で測る（`overlayGap`＝外接矩形の隙間＋`DATA_SKEW`14）／紫の間隔の印は図形の外側（横の並び＝上・縦の並び＝左・`OVERLAY_GUIDE_OFF`）。詳細は付録「v8.31追補⑪」。
- リサイズ: `startNodeResize`（8方向ハンドル `addResizeHandles`）。crosslane はハンドルを「跨ぐ長さ span／帯の厚み thick」へ割り当てる専用処理（`CROSSLANE_HANDLE_MAP_V/H`）。グループ枠は枠線上の透明帯 `renderGroupBands` からも掴める。
- 文字と大きさ: `autoFitNodeSize(n)`（文字量から w/h。`setSizeKeepCenter` で中心固定）／`fitNodeFontSize`（手動幅の箱で文字を縮める・下限8px・明示改行ぶんは確保）／判断は `diamondLayout`／`diamondAutoSize`（ひし形の内接条件 (tw+12)/A + (th+6)/B ≤ 1 で折り返し幅を決める。描画・自動サイズ・縮小・編集欄の4か所が同じ関数）。
- グループ化: `groupSel` / `ungroupSel`（`groupingAllowed()`＝gantt/sequence/mindmap以外）。点線トグル `toggleDashed`／`syncDashUI`。
- 重ねドロップ置換: 配置済みシェイプへ別種をドロップすると型を置換（`replaceNodeType`・`isReplaceableShape`）。サイズ・manualW/H・fontSize は新種別の既定へリセット（テキスト・備考・揃えは保持）。**帯どうし（`crosslane`↔`crosslane_sys_input`）は type だけ差し替え**（v8.30・`replaceTargetAt` の crosslane 分岐＝レーン・mainPos・crossX/crossW・厚み・文字・色を保持）。帯⇔通常シェイプは対象外（幾何のモデルが違う）。**置換はパレットのドラッグ＆ドロップだけ**＝クリック配置で既存シェイプの上を押すのは「選択」（v8.23）。
- スペース挿入／調整（v8.25／v8.30・`gapState={axis,pos,dragFrom,op:'insert'|'adjust'}`・`toggleGapMode(op,axis)`／`endGapMode()`・`S.mode` は増やさない）: 挿入＝点線の位置でクリック 80px／ドラッグで幅指定（mouseup で `commitGapInsert`→`insertGap(axis,at,gap,laneOpt)`）。調整＝mousedown で即 `commitGapAdjust`＝`computeGapAdjust(axis,pos)`（A＝始点<pos で終端最大・B＝始点≥pos で始点最小・pitch＝`ceil((lenA/2+lenB/2+LAYOUT_MIN_ROW_GAP)/GRID_STEP)*GRID_STEP`・delta＝中心間−pitch）→ 縮める `collapseGap`（B の手前の帯を潰す・上限＝B を囲むグループ枠の見出しと `LANE_MIN_W`）／広げる `insertGap(axis,B.start,−delta)`。**走査は `remapGapAxis(axis,{d,dEnd,group},lane)` に一本化**＝座標ごとの「移動量」で動かす（始点「≥at」・終端「>at」・`+=gap` の演算まで v8.29 の挿入と同じ＝新しい写像を足すときもこの関数を通す）。切り欠きは `remapGroupCutsForGap`。レーンをまたぐ向き（`gapIsLaneCross`）は点線のあるレーンの幅を ± する。

### 接続線ルーティング（A* 直交配線）
本アプリの技術的核心。
- `addEdge(f,t,opts)`: エッジ生成（`opts.fromPin` で接続位置ピンを snap 前に載せる）。重複・自己接続は null（シーケンス図は許可）。
- `routePath(...)` → `orthoRoute(sx,sy,ex,ey,exitSide,entrySide,fromId,toId,midPos)`: **A*直交ルーティング**。箱の縁を格子線にして、箱を最短で迂回する直角折れ経路を探索。ループ/逆走/箱貫通を構造的に回避。
  - 近道: 出入りの軸が直交し2本ともどの箱も通らなければ A* を回さず即L字（`lShapeClear`）。
  - 後処理: `centerZ`（Z字の交差セグメントを隙間の中央へ）、`avoidLaneLines`（レーン境界の真上を避ける）、`separateOverlaps`（無関係な線の共線重なりを退避）。
  - **迂回の中央寄せ（v8.31追補⑧）**: `renderEdges` で全線の経路がそろった後、`separateOverlaps` の前に `centerDetourRoutes(edgeData)`＝曲がり 3 回以上の自動経路（`d.fresh`・クランク `d.crank` と手動・バス経路は対象外）の内側の区間を平行移動＝段は動ける範囲の中央・シェイプを迂回しているコの字の底は外側で当たるもの（次のシェイプ・レーン境界）までの中央（最大 `DETOUR_MAX`=40）。ほかの線と同じ線上に並ぶ長さが増える位置には置かない（1 本ずつの経路計算の中で寄せると、判断の下から出る線と判断の真下へ横から入る線が縦に重なるため、`orthoRoute` の中ではなく全線そろった後で行う）。
  - 逆向きピン（出口/入口が相手と逆向き）は自箱の辺±PAD の格子線を追加し反転に大コストを課す（v8.21）。自動割当の線はこの分岐に入らない。
- 障害物 `routeObs`（重ね置きシェイプ・始終点を内包する箱は除外）、経路キャッシュ `_edgeRouteCache`。
- **接続点の割当** `allocatePorts`: 1st pass 辺の決定 → 2nd pass 同一辺の扇状分散（ピンは pinned として母数に算入し最寄りスロットを消費・自動線は残りを相手位置順に取る。**同じ相手との往復は出口＝相手のある側・入口＝反対側**＝同値の並びを `sortKey` の ±0.01px で決める・v8.29）→ 3rd pass 等間隔・最小10px（詰まっている辺だけ。`growForPorts` が箱を広げる）。`processFan`／`rankedSides`／別レーンは L字（出口＝主軸の辺／入口＝源のある側の横辺）。**辺の本数は必ず出入り合計 `sideN(key)` で数える**（v8.29: `sMulti`・`srcFan`/`tgtFan`・`restraighten`。同じ向きだけ数えると「出1本＋入1本」の辺の片方が中央(0.5)へ上書きされる）。直交群の hub 位置は 2nd pass のスロットを群の中で並べ替えるだけ（`(c-i)/(c+1)` を計算し直さない）。hub＝端の多い辺・同数なら始点側。
- 判断（ひし形）は頂点固定接続（`assignDiamondPorts`）。差戻し戻り線 `isReturnEdge` の整形。
- **交差ブリッジ**（半円の飛び越え）: `findCrossingsRaw`（全ペア総当たり・エッジ別蓄積）→ `bridgeCollect` → `bridgeNormalize`（同一点除去・近接統合・角丸半径を端部マージン）。跨ぐ側は「戻り線／同種なら `S.edges` で後の線」。描画は `renderEdges` 末尾の第3パスで「山ごとに白5px→本体色」を最前面へ。
- crosslane（複数レーンプロセス）の接続矩形は `nodeRef` が「レーン矩形∩帯の実体」で返す（横入りの矢印が必ず帯に接する）。**帯の端は相手（通常シェイプ）の端の位置に合わせて動く側**（v8.29）: 1st pass の `aBand`／`bBand`（nodeRef が別オブジェクトを返した端）で判定し、帯と通常シェイプを平行な辺で結ぶ線（`bandFollows`）は processFan の群分けで通常シェイプ側を必ず hub（1本＝辺の中央・複数＝スロット・ピン＝その位置）にし、帯の端は `alignBandTo` で相手の端の実位置へ（帯側の辺の本数 `sMulti` は見ない）。相手がひし形なら群分けの後に頂点へ、3rd pass の `restraighten` も相手が帯なら本数に関わらず合わせる。相手の中心が帯∩レーンの 0.12〜0.88 の外なら生の frac を置いて `exitPt` の丸め＝最寄りから Z 字。詰まり（10px 未満）は 3rd pass が等間隔に分け直す（従来の形）。帯どうし・L 字（直交する辺）・位置固定のピンが付いた帯の端・レーンの無い図種の帯は従来どおり。**帯を hub にする処理を足さないこと**（帯には中心が無い＝ユーザーの設計「接続先ベース」）。
- 手動編集: 区間スライド（`startSegDrag`/`buildOrthoManualPts`。斜めになったら自動経路へフォールバック）、経由点ハンドル（`wpAddHandle`/`waypoints`）、ラベル移動、端点ドラッグ（繋ぎ替え・ピン吸着 `pinSideSlotCount`＝本数連動の既定位置＋経路整列候補・琥珀/ピンク破線 `drawReconnectGhost`・Alt で解除・ゴースト）。シェイプ移動時は接する線の曲がり角も同量ずらし mouseup の `bakeManualRouteShift()` で焼き込む。
- **クイック接続（○＋・v8.21）**: 選択モード／ハンドツール（v8.28）でシェイプにホバーすると最寄りの辺の外側12pxに○＋（`quickConnAllowed()`＝何も選択なし or 通常シェイプ本体だけの選択。重ね置き・グループ枠・ガント・マインドマップは対象外）。**表示の判定は幾何**（v8.29 `qcHoverMove`＝svg の mousemove 1本で、登録簿 `_qcHover` のうち「本体の内側か辺の外側 `QC_NEAR`=25px 以内」で最寄りのシェイプの最寄り辺だけ出す。ノードごとの mousemove／透明ブリッジは廃止＝外側から近づけても出る・隣のシェイプが奪わない）。クリックで `hoverConn={fromId,fromLid,fromSide}`、接続先クリックで `commitConnection()`（接続モード `S.conn` と共用。図種別の後処理＝レーン選択・メッセージ種別・ER/UML/状態遷移ラベル）。取消は何もない所で右クリック（`svgRC`）／Esc／空白左クリック。

### 履歴（Undo/Redo）
- `snap()`: `S.lanes/nodes/edges/gantt/mindLayout` をJSON化して履歴スタックに push（最大80）。**状態変更の確定時に必ず呼ぶ**。動かさずに離した操作（枠クリック・ハンドル空クリック）は「変化があったときだけ snap」で履歴を汚さない。
- `restore(json)` / `undo()`（Ctrl+Z）/ `redo()`（Ctrl+Y / Ctrl+Shift+Z）。
- 履歴に載らない項目（方眼・デザイン・図の名称・レーン名・用紙）があるため、**未保存判定は履歴ではなく指紋方式**（§11）。

### 自動レイアウト・その他
- `autoLayout()`（整列ボタン）、`fitView()` / `centerOnRect()`（表示調整）、`zoomIn/zoomOut/applyZoom`、`zoomAtPointer`（カーソル中心。Ctrl+ホイール／ハンドツール中のホイール）。
- 検索/置換パネル: `openSearch`/`searchUpdate`/`replaceAll`。
- 色変更: `showShapeColorMenu` / `showLaneColorMenu` / `applyColorTheme`（配色テーマ一括）。文字サイズ: `showFontSizeMenu`（Word/Excel 風の数値欄＋一覧＋拡大/縮小）。**対象の決め方（v8.29）**＝`fontSizeEditField()`（編集欄が開いていて `_editTarget` がノードなら「その欄」：説明有の `note` 欄は `n.noteFontSize`・それ以外は `n.fontSize`）→無ければ `fontSizeTargets()`（選択中のシェイプ全体＝説明有は名称・説明の両方。`stepFontSize` は欄ごとに 1 段・`applyFontSize` は同じ値）。編集中は編集欄を閉じない（▾・A˄・A˅・一覧の項目は mousedown の `preventDefault`／数値欄へ移る blur は `openSvgEditor` が確定を保留・Enter で `reopenSvgEditorKeepCaret` が同じ欄を開き直してフォーカスを戻す・数値欄から他へ移ると `fontSizeInputBlur` が `fo._commit` で確定）。文字サイズ UI を触る変更では、この「編集中＝その欄／選択＝全体」を文字揃え（`setTextAlign`）と同じ流儀で保つこと。
- ハンドツール: `setMode('hand')`／`initHandTool()`／`panState`。

---

## 9. 図種別・シェイプ別の特記事項

### グループ枠（`group_box`・スイムレーン／フローチャート／BPMN）
- 2クリック配置。移動・名称編集はタイトル帯（高さ `groupTitleH(n)`＝max(22, fontSize×1.5)・既定16px→24px）。帯右端の ⧉ で枠内シェイプ一括選択（`groupContainedNodeIds`＝シェイプ中心が外形の内側）。
- 枠線は太線（通常 max(2.5, stySW()+1)・選択時3.5）。点線時は長破線 `GROUP_DASH='12,6'`（他は `NODE_DASH`/`EDGE_DASH`='6,4'）。
- **切り欠き** `n.cuts`（§5）: `groupCuts(n)` が角を `{w:最大w,h:最大h,steps:[...]}` に正規化して返す。外周 path は `groupOutlinePath`（`stairPts`＋`cornerAbs` で階段の点列・直交多角形）。正規化 `canonGroupSteps`（丸め・14px未満除去・並べ替え・隣の段に含まれる段の除去）。リサイズ時は `clampGroupCuts`（各辺最低24px残し）。ハンドルは選択中に枠の外側10px（角＝L型／辺中央＝凹型）、各段の内側の角に実線○、階段の凸角に点線○＋（内側へ14px以上ドラッグで段を挿入）。ドラッグ中の一時状態は `groupCutState`／`groupNotchState`（`only` で壁1本だけ動かす）。
- **透明帯** `renderGroupBands()`（レイヤ `g-group-bands`＝`g-edges` より下）: 外枠の辺・角＝枠全体のリサイズ（`startNodeResize`）、切り欠きの内壁＝その壁だけ動く。動かさず離せば選択のみ。枠 rect／輪郭 path 自体は pointer-events:none。**枠が内部のシェイプ・接続線のクリックを奪わない**のは層の順序で保証。
- `org_group`（樹状図の部門枠）は全面当たり判定・自動囲み `orgFitGroups` のため帯・切り欠きの対象外。
- 印刷では**グループ枠を絶対に途切れさせない**（§12 改ページ）。

### 複数レーンプロセス（`crosslane`）・複数レーンシステム入力（`crosslane_sys_input`）
- **挙動の分岐は必ず `isCrosslaneType(t)`（`CROSSLANE_TYPES`）を通す**（v8.29）。`type==='crosslane'` の直接比較を書かない＝crosslane 系を増やすときは Set に足すだけで挙動がそろい、描画は `shapeEl` の crosslane 分岐の中で type 別に足す。
- 主軸位置 `mainPos`・跨ぐレーン span・厚み `thick` から `normalizeCrosslaneGeometry` が毎 render に x/y/w/h を作り直す。**移動は必ず `mainPos` を書く**（`syncCrosslaneMain`）。x/y だけ書くと次の render で元位置へ戻る。
- リサイズは8方向ハンドル＝span と thick への割り当て（`startNodeResize` は使えない）。
- 接続矩形は「レーン∩帯」（§8）。○＋は帯に対しても出る。接続位置は相手（通常シェイプ）の端に合わせて帯側が動く（§8・v8.29）。

### 重ね置きシェイプ（書類 `doc`・データ `parallelogram`・補足情報 `supplement`）
- `isOverlayShape`。レーンに属すが位置は自由・線は避けない・常に最前面（`renderNodes` の z ソート＝枠系／通常／重ね置きの3層）。接続線を付けない想定（○＋非表示。接続モードからは繋げる）。

### 説明有シェイプ（`note`・`sys_input_desc`・`state_detail`・`diamond_desc`）
- タイトル帯（`noteTitleH(n)`＝改行数で可変・既定37px）＋備考欄 `note`。備考量に応じ高さ自動（`setSizeKeepCenter`）。Alt+Enter で改行。判定は `isNoteType(t)` に一本化（種類ごとの列挙を書かない）。
- 文字の左右（横モードは上下）余白は **`noteTextInset(n)`**（既存 3 種は 8・六角形は `hexInset(n)+6`＝26）、編集欄の食い込みは **`noteEditInset(n)`**（＝余白−5。インセット＋枠 1px＋padX 4＝余白）。描画・`render()` の高さ計算・`editText`／`editNote`・`inplaceRect`・`textInsetX` が同じ物差し＝**折り返し幅は「描画＝編集欄」**（v8.30）。
- **判断(説明有) `diamond_desc`**（v8.30・スイムレーン／フローチャート）: 左右が尖った六角形（`HEX_K`=20・`hexInset(n)`＝頂点のある辺の長さ/2−4 が上限）に note のレイアウト。縦モード＝左右が頂点・上下が平ら／横モード＝上下が頂点。描画は `shapeEl` の polygon＋区切り線（斜辺の内側どうし・食い込み ins＝k×|div−中心|/半分）＋説明欄の白半透明 polygon。接続点 `exitPt`＝頂点のある辺は頂点だけ（frac 無効・ひし形と同じ考え方）・平らな辺は尖りの内側で割り付け。当たり判定・経路探索・○＋は外接矩形のまま。`STY_ACCENT_TYPES` には入れない（判断も入っていない）。

### ガントチャート／工程表（`gantt*` 関数群・最多）
- 横固定（`fixedOrientation:'horizontal'`）。座標はドラッグではなく**日付×行から計算**（`calcGanttPositions`/`ganttDateToX`/`ganttXToDate`）。ゆえに `nudgeSel`・グループ化の対象外。
- シェイプ: `gantt_task`（バー）/`gantt_milestone`（◆）/`gantt_summary`（フェーズ＝括り）。
- フェーズ: タスクの所属フェーズ（`phaseId`）が変わると色を自動追従（`ganttSyncPhaseTaskColors`）。空フェーズ掃除 `ganttCleanupPhases`。
- 左情報欄は汎用カラムモデル（列の追加/削除/幅調整・`ganttAddColumn` 等）。見出し欄（表題部）＋承認欄（押印枠）＋凡例。見出し欄は「▲ 見出しを隠す」で畳める（`header.collapsed`・履歴には積まない）。
- **固定表示**（v8.11）: 見出し欄・時間軸ヘッダー・タスク名列を `position:sticky` の重ね箱 `#gstick-top`／`#gstick-left`／`#gstick-corner`（中のSVGにレイヤ `g-gantt-top`/`g-gantt-left`/`g-gantt-corner`）へ描く（`syncGanttSticky`／`ganttStickyOn`）。当たり判定は本体と同じ座標系（`ganttStickyPt` で読み替え・`ganttStickyShield` で下のバーを掴まない）。書き出し時は `buildExportSvg` が3レイヤを取り込む。
- **Excel(.xlsx)出力対応**（`expExcel`・ExcelJS使用。左情報欄の縦結合/縦書き・時間軸色バーを再現）。印刷は v4.30 方式B（用紙自由・`<table class="pgt">` の行＝分割禁止ブロック）。**v8.31: ページ数（縦）を指定したときだけ** `ganttPrintPlan()` の計画（タスク行の境界だけを切れ目にする分割禁止ブロック・倍率は 100% 上限で縮小のみ）に従い「1 ページ＝1 `<tr>`」＋`pg-break` を出す（指定なしは従来どおり）。**ページ数指定のときは `@page` に用紙の寸法（size）を出す**（v8.31。追補③で撤去→追補⑥でユーザー決定により戻した＝送信先「PDFに保存」ならダイアログで何も選ばなくてもアプリの用紙・向きの PDF になる。PDF24 などプリンター経由では Chrome が「レイアウト」欄を消して向き「縦」を渡すので図が横倒しになる＝了承済みのトレードオフ・案内文で「PDFに保存」を選ぶよう伝える。指定なしは size なし＝用紙自由）。
- **ガントの縦グリッド線・網掛け・フェーズ帯・行区切り線は共用レイヤ `#g-grid`** に描く（`renderGanttGrid`→`ganttLayer('g-grid')`）。`buildExportSvg` の `#g-grid` クリアはガント以外だけ（v8.31。v8.18〜v8.30 は一律クリアで書き出しから欠落していた）。
- **軸の右端＝完了日の翌日 0:00 ちょうど**（v8.31追補）＝`ganttUnitsToEndExact(origin,end,scale)`（小数の単位数・時刻付きなら＋1 時間）で `calcCanvasSize` が `SVG_W` を切り、`ganttComputeColW`（画面幅への拡大・見出し表示時の下限 `headMin`）も同じ値で計算する。**週・月は最後の列が途中で終わる**（折り返し表示の「段の終わりで切る」と同じ考え方）。完了日なしは列の整数本ちょうど（+40px の余白なし・`MIN_CANVAS`／`GANTT_HEAD_MIN_W` も列単位で満たす）。`ganttTotalUnits()`（切り上げ）は列の本数、**描く範囲の右端は `ganttRightEdge()`**（通常＝`SVG_W`・折り返し＝段の終わり）＝`renderGanttHeader`／`renderGanttGrid` は列数×列幅で描かない（切り上げぶんの列・右端からはみ出す日付文字は描かない）。`ganttUnitsToEnd`（切り上げ）は `expExcel` の列数用。v8.31 の「軸を列の整数本に切り上げ＋上段セルはラベルが収まるときだけ」では、太い列で次の月のラベルが収まって出ていた。
- **外枠は `renderGanttFrame`**（v8.31／v8.31追補で `GANTT_FRAME_W`=4・`GANTT_FRAME_COLOR`=#1e293b＝時間軸ヘッダーと同じ濃紺）＝時間軸ヘッダー＋行を最前面 `g-dividers` で囲う（固定表示中は左辺＋下辺の名称列ぶんを L 字の path で `g-gantt-left` にも写す＝重ね箱の白背景に覆われない・印刷は `expPDF` の `_ser` が最終スライスに閉じ線）。上辺は濃紺のヘッダー帯そのものが縁。

### マインドマップ（`mind*` 関数群）
- 親子は**エッジで表現**（`mindChildren`/`mindParentId`/`mindDescendants`/`mindRoot`）。中心トピック `mind_root` は削除不可。
- シェイプ3種: `mind_topic`（問題）/`mind_action`（対策・矢印タグ型）/`mind_note`（補足情報・付箋型／枝色に染まらない）。
- レイアウト: `mindLayoutRadial`（放射状）/`mindLayoutTree`（樹状）。`S.mindLayout`で切替。枝色は `n.branchIdx`（`mindAssignBranchIdx`）。
- 操作: ノード追加（Tab＝子`mindAddChild`／Enter＝兄弟`mindAddSibling`）、サブツリー連動移動＋ドラッグ再ペアレント（`mindReparent`/`mindDropTargetAt`）、折りたたみ（`collapsed`）、フォーカスモード、表示レベル1/2/3/全。
- メタデータ: 合意状態・重要度・確信度・工数。属性絞り込み。すべてoptionalプロパティ＝後方互換維持。凡例自動表示（`renderMindLegend`）。
- **リザーブ領域** `S.mindReserve`／`renderMindReserve`（右サイドバー。ドラッグで図へ配置）。

### シーケンス図（`sequence`）
- `lifeline`（ライフライン）と `activation`（活性区間）。activationは lifeline に従属（`lifelineId`・削除カスケード）。
- 自己呼出・同一ペア重複エッジを許可（他図種は禁止）。同期/非同期メッセージ（`msgType`）を専用マーカーで描画（`renderSequenceEdges`）。水平メッセージなのでピン・クイック接続の辺指定は対象外。編集ジャンル（グループ化・点線）は非表示。

### 樹状図（`orgchart`＝旧組織図・`org*` 関数群）
- ノード: `org_node`（ラベル有）/`org_node_plain`（役職なし）/`org_group`（部門枠）。矢印なし（`noArrow`）。
- バス型接続線（親から子へ横バス経由・`orgBusRoutes`/`busPos`調整）。ツリー自動レイアウト（`orgTreeLayout`）、部下追加＋ボタン（`orgAddSubordinate`）、部門枠の自動フィット（`orgFitGroups`）、内部テーブル編集（`orgEditTable`）。

### UMLクラス図（`uml`）
- `uml_class`/`uml_interface`。区画（属性/操作）を `sections` で保持。関連ごとに個別マーカー（継承・実装・集約・コンポジション等＝`umlType`/`umlEdgeStyle`）。抽象/インターフェーストグル。

---

## 10. 見た目（デザインテンプレート・ステップ図・文字）

- **デザインテンプレート `STYLES`**（1288行〜）: 色は変えず**形の装飾だけ**を差し替える。standard/soft/flat/shadow/card/business/rich/accent/chevron/pill。`curStyle()`/`styRx()`/`stySW()`で参照。形の差し替え（矢羽/ピル）は `rect` 専用。UIはガント・マインドマップでは効かないため左サイドバー（`showDesignMenu`/`showStepMenu`）。
- **ステップ図**（`insertStepFlow`/`flowAddStep`/`flowRemoveStep`）: 番号サークル・ピル・矢羽のレイアウトを一括挿入。`flowId`で1列を管理し、現在の縦横モードに沿って自動配置＋末尾に＋/−ボタン。
- **番号バッジ**（`S.stepNums`/`stepBadgeMap`）: プロセス系シェイプに配置順で 1,2,3… を自動採番。
- **配色テーマ `STEP_THEMES`**（vivid/warm/cool/navy）: `applyColorTheme` で対象シェイプにステップ順で循環適用。
- **文字**: 既定 `AUTO_FONT`=12px・グループ枠 `GROUP_FONT`=16px（`defaultFontSize`/`nodeFontSize`）。行送り `lineH`・縦書き列間隔 `vch`/`vcol` は文字サイズに比例。説明有シェイプ（`isNoteType`＝note/sys_input_desc/state_detail）の説明欄は別枠＝`NOTE_FONT`=10px（`noteFontSize(n)`＝`n.noteFontSize`）・行送り `noteLineH`（×1.2）・列間隔 `noteVcol`（×1.4）・文字送り `vch`。名称の帯 `noteTitleH(n)` は名称の文字サイズが 12 より大きいぶんだけ広がる（小さくしても 37）。描画（`renderNodes` の説明有分岐）・`render()` 冒頭の高さ計算・編集欄（`editText`／`editNote`）は必ず同じ関数を通すこと（v8.29 まで描画だけ 12／10 固定で文字サイズが効かなかった）。折り返しは `wrapText`（横）/`wrapTextByCount`（縦・文字数）、幅計測 `textW`。余白は `autoFitPad`（幅・システム入力/補足情報は+12）/`autoFitPadH`。
- **インライン編集**（v8.20）: `openSvgEditor(target, opts)` が「シェイプの内側をくり抜いた」透明エディタを `inplaceRect(n)`（シェイプ別の内側矩形）に置く。編集中は `_editTarget`／`isEditingField()` を描画側が見て旧テキストを描かない。接続線ラベルは `_edgeLabelGeom`／`_editingEdgeLabel`。opts: `multiline`・`onInput`（ライブ追従・snap しない）・`host`（レーン見出しは `#gstick-lane` 内）・`inplace/bg/color/fontWeight/borderColor/padY/vCenter`。**枠線は `border` でなく `outline`（`outline-offset:-幅`）で描き、枠線幅は padding に含める**（v8.29）: Chrome はブラウザ倍率が 100% 以外だと border をデバイスピクセルの整数に丸める（80% で 1px→1.25px）ため、border だと文字欄の内側が倍率で変わり、自動リサイズで余裕 0 の箱では編集中だけ最後の1文字が折り返す。文字欄の内側の幅＝W−2×(枠線幅+padX) を `_syncVPad` の wrapText と同じ式で保つこと。倍率の検証はヘッドレス＋プロファイルの既定倍率（`Preferences` の `partition.default_zoom_level`）で行う（実ウインドウを開かない＝ユーザー指示）。
- **操作ヒント** `#hint`（`hint(msg)`）: 選択内容に応じた案内は `render()` 末尾の `syncSelectionHint()`（`_hintSel` で既定文言へ戻す）。編集開始・ドラッグ中（ピン吸着・ガント進捗/期間）もリアルタイム表示。保存結果は `#toast`。

---

## 11. 保存/復元フォーマット

### 保存（`saveHtmlCore(name)`・12046行〜）
1. 現在の `document.documentElement.outerHTML` を取得（＝アプリ本体そのもの）。
2. 状態オブジェクト `st = {diagramType,orientation,lanes,nodes,edges,uid,diagramName,gantt,mindLayout,gridOn,style,stepNums,docId,mindBranch,mindReserve,printPaper,printOrient,appVer:APP_VER}` をJSON化。
3. 既存の状態埋め込みscriptを除去し、`</head>` の直前に `<script id="swimlane-state">window.__SWIMLANE_STATE__={...};</script>` を注入。
4. `<filename>.html` としてダウンロード（`dl()`・File System Access API の `showSaveFilePicker` があれば `id:'bdm-save'`＋`startIn` で同じ場所へ）。→ **アプリ＋データが1ファイルに同梱された自己完結HTML**。

### 未保存判定（v8.11追補・指紋方式）
- `docState()`（保存内容そのもの。`uid`・`docId`・`pbPreview` は除く）→ `docFingerprint()`（JSON文字列）。`markSaved()` で基準を取り、`isDirty()` で比較。
- 図を捨てる操作（図種切替・新規・読み込み）の前に `confirmSave4`（上書き／名前を付けて／保存しない／キャンセル）。タブを閉じるときは `beforeunload`。

### 復元（`init` / `extractSavedState` / `importStateFromHtml`）
- 起動時に `window.__SWIMLANE_STATE__` があれば読み込んで `S` を復元。
- 別の保存HTMLを取り込む場合は `importFromFile`→`extractSavedState(html)`（正規表現で埋め込み状態を抽出）。
- **旧版データの移行** `migrateLegacyEdgeRouting(appVer)`: `appVer` を持たない v8.13 以前の保存だけ、経路指定5フィールド（waypoints/orthoWps/midPos/fromPin/toPin）を落として今のルーターで引き直す。v8.14 以降は版が違っても手動編集を残す（5 フィールドは手で編集したときにしか付かない＝編集していない線は常に今の版の規則で引き直される）。経緯: v8.14 落とす → v8.16 残す（ユーザー 2026-08-26）→ v8.26 版が違えば全部落とす（ユーザー 2026-09-07）→ **v8.31追補⑤ 残す（ユーザー 2026-09-25「編集した箇所は引き継ぎ、デフォルトのままの箇所はデフォルトに」）**。変える前にユーザーへ確認すること。
- **後方互換**: 旧キー（`swimlane-state`/`__state__`/`data-state`）も読めるよう配慮。新プロパティは未定義でも動くようにする（optional前提）。配列形の `cuts`（v8.24）を v8.23 以前で開くとその角の切り欠きだけ黙って消える（落ちない）。

---

## 12. エクスポート／インポート

| 機能 | 関数 | 補足 |
|---|---|---|
| PNG | `expPNG` | `buildExportSvg`で白背景＋図面名タイトル帯（＋シェイプ凡例）付きSVGを生成→ラスタライズ |
| SVG | `expSVG` | 同上（ベクター） |
| PDF | `expPDF` | 印刷（`@page` 余白 10mm/左25mm・**size＝用紙欄の用紙**＝非ガントは常に・ガントはページ数指定のときだけ。v8.31追補⑥＝送信先は「PDFに保存」・PDF24 などプリンター経由では向きが縦になる。図面名帯の日付は右上＝凡例の上・v8.31追補⑦）。**非ガントは改ページ計画 `printPagePlan()` に従う**（下記）。**ガントはページ数（縦）指定時だけ `ganttPrintPlan()` に従う**（v8.31・指定なしは v4.30 方式B＝用紙自由） |
| Excel | `expExcel` | ガント/工程表専用。ExcelJSで真の.xlsx |
| Markdown | `mindToMarkdown`/`nodeMD` 系 | マインドマップ等のテキスト書き出し |
| OPML | `mindToOpml`/`generateFromOpml` | 往復（シェイプ種別も `_shape`/`SHAPE_BDM` で保持） |
| FreeMind(.mm) | `mindToFreeMind`/`generateFromFreeMind` | 往復 |

- **書き出しのクリーンアップ** `buildExportSvg`: clone から `class="ui-only"`（透明帯・⧉・○＋・改ページ線・ガント開閉ボタン等）・`g-grid`（方眼/ガイド・**ガント以外だけ**＝ガントでは縦グリッド線等の本体なので残す・v8.31）・`g-guides`・`g-replace-hl`・`#prev-edge` を落とす。**画面操作専用の要素には必ず `class:'ui-only'` を付ける**。固定レイヤ（`g-lane-hdr`／`g-gantt-*`）は「子があれば取り込む」ので、図種をまたいで残さないこと（`render()` 冒頭で全部空にする・v8.31 で `g-lane-hdr` も追加）。
- **レーン図の主軸トリム** `laneExportMainExtent()`（v8.13）: PNG/SVG/印刷で主軸だけを内容までに切り詰め、トリム位置に外枠の閉じ線を1本描き足す。交差軸と見出し帯は全レーン残す。
- **シェイプ凡例**（v8.16・`EXPORT_LEGEND_DT`＝スイムレーン/BPMN/フローチャート）: 図で使われているシェイプから自動生成（`exportLegendItems`/`exportLegendMetrics`/`legendSwatch`・`LEGEND_SCALE`=1.5）。PNG/SVG はタイトル帯右上、印刷は図面名帯の右端（幅不足なら図面名の下へ段積み `_lgStack`）。画面には出さない。
- **印刷の改ページ**（v8.22・非ガント全図種）: `printPagePlan(userScale)` が唯一の入口。用紙 `S.printPaper`/`S.printOrient`（`PAPER_SIZES`/`printAreaMm`/`pageBudgetPx`・安全代 `PAGE_SAFE_MM`=2mm＝`printAreaSafeH()`。v8.31追補で比率 4% から固定 2mm に＝行 1〜2 本ぶんを捨てていた）から1ページの高さを実寸計算し、Y軸の分割禁止区間3層（hard=シェイプ／group=グループ枠／soft=接続線ラベル・上下 `PAGE_GAP_PAD`=10px）を `pageAvoidSets` で作り、`pageBlocks` が「①何も跨がない ②ラベルだけ ③グループ枠の線だけ ④強制」の優先順で切れ目を選ぶ（`pagePack`）。横レーンはレーン境界だけを候補にする（`pageAllowedBoundaries`/`pageUseLaneBoundaries`）。`lifeline`/`activation` は分割禁止から除外（`PAGE_SPLITTABLE`）。収まらないブロックは `printAutoScale` が倍率を下げる（入力欄は書き換えず `hint` で通知）。出力は `<table class="pgt">` の `<tr>`＝分割禁止ブロック、縦レーンは `<thead>` で見出し帯を各ページ反復（`printRepeatHeadPx`・`svgViewToPngURL` でラスタ化）。1ブロックなら従来の `pg-center`。共有関数 `printViewBox`/`printBandMetrics`（図面名帯＝図面名・日付・凡例の寸法と置き場。v8.31追補⑦: 日付は帯の右上＝凡例と横並びなら凡例の上で右端をそろえる・図面名が長く日付と同じ行に入らないときは最上段に 1 行。帯の高さ `bandH2` は計画と実出力で共有）。
- **印刷のページ数指定**（v8.27・非ガント）: `S.printFitTall`/`S.printFitWide`（`#print-fit-tall`/`#print-fit-wide`・`printFitNorm`/`printFitSpec`）。指定があれば `printFitScale`（解析上限から `printFitSearch` で 5% ずつ下げ→1% 刻みで詰める・二分探索しない）が倍率を決め、`printPlanAt` が行＋列（`ax='x'` の `pageBlocks`）の計画を返す。倍率欄は無効化し `syncPrintFitUI` が「→ nn%」を読み出す（`printFitEffectiveScale`）。
- **ガントのページ数指定**（v8.31・縦のみ）: `ganttPrintRowBlocks`（タスク行の境界だけの分割禁止ブロック。フェーズ見出しは直後の行と一体・折り返しは段見出し＋時間軸ヘッダー＋先頭行が一体）→`ganttPrintPlanAt(scale,blocks)`（`pageBudgetPx`/`pagePack` を共用・1 ページ目は見出し欄＋時間軸ヘッダーぶん狭い）→`ganttPrintFitScale`（上限＝解析値と 100% の小さい方・`printFitSearch`・`_ganttFitCache`）→**`ganttPrintPlan()` が `expPDF`・`renderGanttPageBreaks`・`printFitEffectiveScale` の共通入口**。横欄はガントでは「1」の固定表示（`S.printFitWide` に書かない）・`updatePageBreakBtn` は指定中だけ活性。
- **改ページプレビュー** `togglePageBreakPrev`/`updatePageBreakBtn`/`renderPageBreaks`（レイヤ `g-pagebreak`・ui-only。`S.pbPreview`）: 印刷と同じ `printPagePlan()` で描くので実出力と必ず一致。ガントは `renderGanttPageBreaks`（`renderGantt` 末尾から呼ぶ・固定表示中は `g-gantt-left` にも `class="ui-only pgb"` で線を写す）。

### テキスト→図（Text to Diagram）
`openText2Diagram`／`runText2Diagram`。**Mermaid** 記法（`parseMermaidFlowchart`/`parseMermaidSequence`/`parseMermaidState`/`parseMermaidER`/`parseMermaidClass`/`parseMermaidGantt` → `generateFromMermaid*`）や CSV（`parseGanttCsv`/`parseOrgCsv`）・アウトライン（`parseOutline`）・OPML/.mm からの図生成をサポート。Mermaid の `[[...]]` はシステム入力 `sys_input`。

---

## 13. 描画パイプライン `render()`（7724行〜）

状態 `S` から SVG を毎回作り直す（差分更新はしない）。

```
render():
  ui-only の残留クリア（グループ帯など）・syncDashUI()
  if gantt   → renderGantt()   （専用パス・return）
  if mindmap → renderMindmap()  （専用パス・return）
  それ以外:
    calcCanvasSize()                     // キャンバスサイズ算出（→ syncZoomSpacer）
    note/sections の自動リサイズ・autoFitNodeSize（setSizeKeepCenter で中心固定）
    orgFitGroups()                       // 部門枠フィット
    renderLanes()（末尾で syncLaneSticky）; renderGrid(); renderLifelines();
    renderEdges()（seqは renderSequenceEdges）＋ 第3パス＝交差ブリッジ描き直し
    renderNodes()（冒頭で renderGroupBands＝グループ枠の透明帯 g-group-bands）; renderDividers(); renderPageBreaks();
    renderEdgeReconnectHandles(); renderOrgAddButton();
    applyZoom();
    syncSelectionHint()                  // 選択内容に応じた操作案内
```

- **SVGレイヤ（`#diagram-svg` 内・下から上の順）**:

| レイヤ | 役割 |
|---|---|
| `g-lanes` | レーン背景・区切り線・外枠 |
| `g-grid` | 方眼・横ガイドライン（書き出しから除去）。**ガントでは縦グリッド線・網掛け・フェーズ帯・行区切り線の本体**（書き出しに残す・v8.31） |
| `g-lifelines` | シーケンス図のライフライン |
| `g-guides` | 整列ガイド（黄色）・相手揃えガイド（ピンク）。書き出しから除去 |
| `g-lane-bands` | レーン境界のドラッグ帯（**境界は他の何よりも優先度が低い**＝層で保証・v8.15） |
| `g-group-bands` | グループ枠の透明帯（外枠＝リサイズ／内壁＝壁だけ移動・v8.19/v8.24） |
| `g-edges` | 接続線・ラベル・ブリッジ |
| `g-nodes` | シェイプ・リサイズハンドル・切り欠きハンドル・⧉・○＋ |
| `g-replace-hl` | 重ねドロップ置換のハイライト（pointer-events なし） |
| `g-pagebreak` | 改ページプレビュー（ui-only） |
| `g-dividers` | 最前面＝凡例・組織図＋ボタン・再接続ハンドル |

- **固定表示の重ね箱**（本体SVGの外・`position:sticky`・幅0高さ0の `.gstick`）: `#gstick-lane`（レーン見出し `g-lane-hdr`＝縦モード上端／横モード左端・`syncLaneSticky`）、`#gstick-top`/`#gstick-left`/`#gstick-corner`（ガント）、`#gstick-headbtn`（ガント見出しの開閉ボタン・HTML）。座標系は本体と同じ。
- 個別シェイプ描画は `shapeEl(n,sel)` / `mindShapeEl` / `renderGantt*` 系。SVG要素生成は `e(tag,attrs)` ヘルパ。`renderNodes` の z 順は「枠系→通常→重ね置き」の3層（各層は作成順）。
- 描画側は編集中の欄（`isEditingField()`）・編集中の接続線ラベル（`_editingEdgeLabel`）を描かない。

---

## 14. 入力操作（マウス／キーボード）

### マウス（SVG上）
- `svgMD`（mousedown）: 配置の保留（`palPlaceState`・確定は document mouseup）/選択/接続開始/各種ドラッグ開始の振り分け。先頭で `closeSvgEditor()`。
- `svgRC`（contextmenu＝右クリック）: 何もない所で右クリック＝接続モード・クイック接続・グループ枠配置（1点目あり→取消しパレット維持・無し→パレット解除）・通常シェイプのクリック配置を中断。
- `svgDbl`（dblclick）: テキスト編集（`openSvgEditor`/`editText`/`editNote`/`editSection`）、レーン見出し改名、ダブルクリック追加配置。
- document の `mousemove` は `onDocMouseMove(ev)`（`edgeAutoScroll` が合成イベントで再実行できるよう名前付き）。
- 各種ドラッグ状態: ノード移動（複数選択含む）、リサイズ（`startNodeResize`・crosslane 専用）、レーンドラッグ/リサイズ、接続線区間/経由点/ラベル/端点、バス位置、マインド再ペアレント、ガントバー、グループ枠の透明帯・切り欠きハンドル。
- ホイール: `#canvas-wrap` 上の **Ctrl(⌘)+ホイール＝図のズーム**（`zoomAtPointer`・ブラウザ拡大を抑止）、ハンドツール中はホイール単体でズーム。メニューバー `#toolbar-scroll` 上の縦ホイールは横スクロールへ読み替え（Ctrl+ホイールは素通し）。

### キーボード（`document.addEventListener('keydown'…`・11635行〜）
| キー | 動作 |
|---|---|
| Delete / Backspace | 選択削除 `delSel()` |
| Ctrl+Z | Undo ／ Ctrl+Y・Ctrl+Shift+Z | Redo |
| Ctrl+A | 全選択（貼付モード中は無効） |
| Escape | 選択/モード/接続/クイック接続/配置を全部解除・検索/モーダル/編集欄（取消）を閉じる |
| 矢印キー | 選択の微移動 `nudgeSel`（手動経路も同量ずらす） |
| Ctrl+C / Ctrl+V | コピー／貼付（`copySelection`/`pasteAt`/貼付モード） |
| Ctrl(⌘) 押下/解放 | ドラッグ中にコピー⇔移動を切替（`convertDragToCopy`/`revertDragToCopy`） |
| Enter / Alt+Enter / Esc（編集中） | 確定／改行／取消（ミニ表は Enter改行・枠外クリック確定） |
| Tab / Enter（マインドマップ） | 子追加／兄弟追加 |

---

## 15. よく使う関数の索引（役割つき）

**判定/ヘルパ**: `isV`（縦モード）`tV`/`textUpright`（回転しない図種）`usesLanes`/`getDT`/`useLanes`（図種特性）`isFreeShape`/`isOverlayShape`/`isGroupType`/`isMindShape`/`isGanttShape`/`isUmlShape`/`isDiamondShape`/`isReplaceableShape`/`isResizable`／`nodeAtPoint`（座標→ノード）`nodeLaneIdx`／`uid`（id採番）`e`（SVG要素生成）`svgPt`（画面→SVG座標）`nc`（中心座標）`hint`（画面下部メッセージ）`toast`／`nodeFontSize`/`defaultFontSize`/`groupTitleH`/`noteTitleH`。

**状態変更**: `addNode`/`addEdge`/`delSel`/`nudgeSel`/`groupSel`/`ungroupSel`/`setTextAlign`/`toggleDashed`/`replaceNodeType`/`snap`/`undo`/`redo`/`restore`/`setSizeKeepCenter`。

**図種**: `selectDiagramType`/`applyDiagramType`/`changeDiagramType`/`buildPalette`/`palClick`。

**描画**: `render`/`renderNodes`/`renderEdges`/`renderLanes`/`renderGrid`/`renderGroupBands`/`renderPageBreaks`/`renderGantt`/`renderMindmap`/`shapeEl`/`applyZoom`/`syncZoomSpacer`/`syncLaneSticky`/`syncGanttSticky`/`syncSelectionHint`。

**接続**: `routePath`/`orthoRoute`/`routeObs`/`lShapeClear`/`allocatePorts`/`processFan`/`assignDiamondPorts`/`growForPorts`/`findCrossingsRaw`/`bridgeNormalize`/`renderOneEdge`/`commitConnection`/`quickConnAllowed`。

**グループ枠**: `groupCuts`/`groupOutlinePath`/`canonGroupSteps`/`clampGroupCuts`/`groupContainedNodeIds`/`selectGroupContents`/`renderGroupBands`。

**文字**: `autoFitNodeSize`/`fitNodeFontSize`/`diamondLayout`/`inplaceRect`/`openSvgEditor`/`wrapText`/`textW`。

**保存/出力**: `saveHtmlCore`/`confirmSaveAs`/`confirmSave4`/`docState`/`isDirty`/`markSaved`/`buildExportSvg`/`laneExportMainExtent`/`expPNG`/`expSVG`/`expPDF`/`printPagePlan`/`expExcel`/`importFromFile`/`extractSavedState`/`migrateLegacyEdgeRouting`。

（全関数一覧は本体を `grep -oE '^(async )?function [a-zA-Z0-9_]+'` で取得可能。747個ある。）

---

## 16. 拡張・改修時の指針

### 新しい図種を追加する手順（概略）
1. `DIAGRAM_TYPES` にキーを追加（`name`/`useLanes`/`palette`/`palLabels`/`shapeTexts`/必要なら`noArrow`/`fixedOrientation`）。
2. `SD` に新シェイプtypeの既定（`w,h,text,fill,stroke`）を追加。
3. シェイプ描画が特殊なら `shapeEl` 系に分岐を追加。専用レイアウト/描画が要るなら `render()` に `renderXxx()` の分岐を足す（ガント/マインドが前例）。
4. 図種専用ツールバーが要るなら `<body>` の `#toolbar` にジャンル（`.rgroup`）を足し `applyDiagramType` で表示切替。
5. 保存対象プロパティが増えるなら `saveHtmlCore` の `st`・`docState()`（未保存判定）・`snap()`/`restore()` に含める（**後方互換のため未定義許容**）。

### 新しいシェイプを既存図種に足すとき（前例: v8.15 システム入力・v8.18 補足情報）
- `SD`・`DIAGRAM_TYPES.palette/palLabels/shapeTexts` に追加し、`shapeEl` に描画分岐。
- 分類を決める: レーンに縛られるか（`isFreeShape`）／重ね置きか（`isOverlayShape`）／置換対象か（`isReplaceableShape`）／自動リサイズ対象か（`autoFitTarget`・`AUTO_FIT_SKIP`）。
- 文字余白（`autoFitPad`/`autoFitPadH`）・編集欄の内側矩形（`inplaceRect`）・凡例の見本（`legendSwatch`）・番号バッジ・配色テーマの対象判定を確認。
- crosslane 系（レーンを跨ぐ帯）を増やすなら `CROSSLANE_TYPES` に足す＝挙動は全部そろう（v8.29 `crosslane_sys_input` が前例）。パレット順は族順（プロセス／説明有／複数レーン）を保つ。
- v8.13 以前のファイルが読めることを確認（旧 type 名は改名しない）。知らない type は `shapeEl` 末尾が矩形で描く（v8.29）＝古い版で新型入りファイルを開いても落ちないのは v8.29 以降だけ。

### 後方互換の鉄則
- 既存プロパティの意味を変えない。新機能は**optionalプロパティ**で足し、未定義時にデフォルト動作する分岐を書く。既定値と一致したらキーを削除する（`fontSize`/`dashed` の流儀）。
- `orgchart` のように**内部キーは改名しない**（表示名だけ変える）。
- 保存フォーマットの読み取りは旧キーもフォールバックする。旧版の移行は `appVer` で判定する。
- ピンなし・手動編集なしの接続線の割当・経路は「完全不変」を目標に変更する（既存図の線が動くと利用者の図が崩れる）。

### 設計上の約束ごと（繰り返し出てくる流儀）
- **画面操作専用の要素は `class:'ui-only'`** ＝書き出し・印刷に載らない。透明な当たり判定帯も同様。
- **クリックの優先順位は層の順序で決める**（穴あけや例外分岐で奪い合わない）。
- **crosslane は `mainPos` を書く**、グループ枠の切り欠きは `groupCuts()` の正規化を通す、複数の描画箇所が同じ寸法を使うなら関数に一本化する（`groupTitleH`/`noteTitleH`/`diamondLayout`/`printPagePlan`）。
- **snap は変化があったときだけ**（クリックだけの操作で履歴を汚さない）。
- 一時的な UI 状態は `S.mode` を増やさずモジュール変数で持つ。

### コードスタイル
- 周囲のコードに合わせる（1行密度が高い・日本語コメントで版番号と意図を記す＝例 `// v8.24: …`）。
- 状態変更後は `snap()`→`render()` を忘れない。
- 変更後は Puppeteer（`channel:'chrome'`）で実DOM検証し、完成イメージを `screenshots/v8xx_*.png` に残す（gitignore 対象）。

---

## 17. 運用ルール（要約・詳細は `運用ルール.txt`/`CLAUDE.md`）

- **1セッション＝1バージョン＝1PR。** バグ修正以外の変更をしたらバージョンを1つだけ上げ、同一feature ブランチにまとめる。
- **バグ修正のみは版番据置の「追補」**＝新ファイルを作らず最新版HTMLを直接更新。
- **版アップは `git mv` でリネーム採番**（旧版ファイルは残さない・Git履歴から復元。`99_旧バージョン/` は 2026-08-29 に廃止）。`APP_VER` も上げる。
- **`main`へ直接pushしない。** feature ブランチ → PR → マージで**バージョン単位のマージ履歴**を残すことがGit運用の主目的。PRタイトルは `#v8-<連番> v8.xx: …`。
- **PRはユーザーの明示指示があるまで作らない。**
- 版を上げたら `CLAUDE.md` の「現行ステータス」欄と `開発ロードマップ.txt`、マニュアル生成スクリプト（`capture-puppeteer.js` の `URL`・`create-manual.js` の `APP_VERSION`）を更新。why/経緯があれば `開発記録_v8.txt`（アクティブ）へ。
- コミットメッセージに what（何を変えたか）を具体的に書く。why は開発記録に。
- リポジトリは GitHub **public**。社内固有の図・スクリーンショット・PDF はコミットしない（`.gitignore` 済み）。

---

## 付録A: AIが調査を始めるときの初手

1. 本ファイル（AI向け仕様書）→ `CLAUDE.md` の現行ステータス（各版の変更点）を読む。
2. 図種特性は `DIAGRAM_TYPES`（1140行〜）、シェイプ既定は `SD`（1229行〜）。
3. 状態は `S`（1413行）、データモデルは本書§5。
4. 特定機能は §15／§9／付録B・C の関数名で `grep -nE 'function 名前' diagram_v8.24.html` して該当箇所へ。版番号コメント（`// v8.xx:`）で grep すると、その版の変更箇所が全部拾える。
5. 全文読み込みはトークン超過に注意（§3）。範囲＋行長フィルタで読む。

---

## 付録B: v8.10 で追加された主な関数（行番号ではなく関数名で引くこと）

### シェイプの自動リサイズ・自動折り返し
| 関数/定数 | 役割 |
|---|---|
| `AUTO_W_MAX` / `AUTO_PAD` / `AUTO_LINE_H` / `AUTO_FONT` | 自動幅の上限(260。v8.14 以降はレーン幅で頭打ち)・文字の左右余白(片側5)・行高(15)・本文サイズ(12) |
| `autoFitTarget(n)` | 自動リサイズの対象シェイプか（`isResizable` ＋ 区画/note/枠外ラベル/ステップ列を除外） |
| `autoFitNodeSize(n)` | 文字量から `n.w`/`n.h` を決める。`render()` の note リサイズ直後で全ノードに掛ける |
| `textW(line,fs)` | `wrapText` と同じ近似で1行の幅を測る |
| `wrapTextByCount(text,maxChars)` | 縦書き用の折り返し（縦書きは半角も全角も同じ送りなので文字数で切る） |
| `appendVTextWrap(...)` | 縦書きラベルを列で折り返して描く（`appendVText` の折り返し版） |
| `n.manualW` / `n.manualH` | 手動リサイズ済みの印と、伸びる側の下限（optional・後方互換） |
| `openSvgEditor(..., {onInput})` | 入力中のライブ追従用フック。`editText`/`mindEditNode` から渡す。**snap() は呼ばない** |
| `MIND_W_MAX` / `mindTextLines(n)` | マインドマップの上限幅(240)と折り返し済みの行 |

### ハンドツール（余白＝パン・それ以外は選択モードと同じ操作）
| 関数 | 役割 |
|---|---|
| `initHandTool()` | `#canvas-wrap` のキャプチャフェーズで mousedown/click/dblclick を握りつぶす（余白＝パン・クリックで選択解除 v8.29）。`init()` から呼ぶ |
| `handPassThrough(t)` | 握りつぶさずに通す要素＝シェイプ本体 `[data-nid]`（ハンドル類を含む）・編集欄・接続線 `#g-edges`・端点○・グループ枠の外枠の帯 `#g-group-bands`（v8.29） |
| `editHandlesOn()` | 選択したシェイプのハンドル類（8方向リサイズ・複数レーン系・切り欠き○・⧉・活性区間・グループ枠の帯）を出すモード＝`select`／`hand`（v8.29。ハンドツール中はカーソルを CSS で復元） |
| `panState` | パン中の一時状態。`mousemove`/`mouseup` の先頭で処理 |
| `setMode('hand')` | パレット選択を解除しカーソルを掴む手に。`S.mode` は保存対象外 |

ハンドツール中に**できない**のは、パレットからの配置・範囲選択・余白ダブルクリックの箱追加・レーン境界／見出しのドラッグ・画面端オートスクロールだけ（v8.29 時点）。

### レーン見出しの固定表示（※v8.11 で作り直し済み）
| 関数/要素 | 役割 |
|---|---|
| `<g id="g-lane-hdr">` | 見出しレイヤ。v8.11 以降は本体SVGの外の重ね箱 `#gstick-lane` 内のSVGにある |
| `renderLanes()` | 本体は `g-lanes`、見出しは `g-lane-hdr` へ描き分ける |
| `syncLaneSticky()` | 向きに応じて止める軸を切り替える（縦＝上端／横＝左端）。旧 `stickyLaneHeader`/`initStickyHeader`（JSで平行移動する方式）は v8.11 で廃止＝`position:sticky` に任せる |
| `buildExportSvg` / `buildSaveHtml` | 書き出し前に見出しレイヤを本体へ取り込む |

### 文字編集中のクリック
| 関数 | 役割 |
|---|---|
| `svgEditorActive()` | インラインエディタが開いているか |
| `closeSvgEditor()` | blur で確定させ、選択も外す（マインドマップは選択を残す）。`svgMD` の先頭で呼ぶ |

### マインドマップの枝色・整列
| 関数/プロパティ | 役割 |
|---|---|
| `n.branchIdx` | ルート直下ノードに焼き付けた枝色の番号（optional・未設定なら従来のエッジ順） |
| `mindAssignBranchIdx()` | 未設定ノードへ番号を割り当てる。`renderMindmap()` の冒頭で呼ぶ |
| `mindLayoutRadial()` の `rot` | 現在の枝の向きに合わせた起点角（円周平均）。整列で図が回らなくなる |
| `renderGuides()` | マインドマップでは配置ガイドを描かず即 return |

---

## 付録C: v8.11〜v8.31 で追加された主な関数・定数（関数名で引くこと）

各版の変更内容の要約は `CLAUDE.md` の「現行ステータス」に版ごとにある。ここでは**コードを探すための名前**だけを挙げる。

### v8.11〜v8.12（固定表示・未保存判定・リザーブ領域）
| 名前 | 役割 |
|---|---|
| `#gstick-lane` / `#gstick-top` / `#gstick-left` / `#gstick-corner` / `#gstick-headbtn` | `position:sticky` の重ね箱（`.gstick`）。中のSVGにレイヤ `g-lane-hdr`／`g-gantt-top`／`g-gantt-left`／`g-gantt-corner` |
| `syncLaneSticky` / `syncGanttSticky` / `ganttStickyOn` / `ganttStickyPt` / `ganttStickyShield` | 固定表示の同期・当たり判定の座標読み替え・下のバーを掴まない透明シールド |
| `docState` / `docFingerprint` / `markSaved` / `isDirty` / `savedFingerprint` / `savedSeq` | 未保存判定（指紋方式） |
| `confirmSave4` / `toast` / `SAVE_ERR_JA` / `saveErrText` | 4択ダイアログ・保存結果トースト・エラー文言の日本語化 |
| `S.mindReserve` / `renderMindReserve` | マインドマップのリザーブ領域 |
| `S.gantt.header.collapsed` | ガント見出し欄の畳み状態（履歴に積まない） |

### v8.13〜v8.14（書き出しトリム・接続線・文字サイズ）
| 名前 | 役割 |
|---|---|
| `laneExportMainExtent` | レーン図の書き出しで主軸を内容まで切り詰める |
| `bridgeCollect` / `bridgeNormalize` / `findCrossingsRaw` / `sampleSmoothPts` / `bridgeCollectVsPoly` | 交差ブリッジの収集・正規化（v8.14追補で曲線・自己交差も対象） |
| `lShapeClear` / `growForPorts` / `separateOverlaps` / `avoidLaneLines` / `centerZ` | L字近道・辺の等間隔化の箱拡張・共線退避・レーン境界回避・Z字の中央寄せ |
| `setSizeKeepCenter` | サイズ変更時に中心固定（autoFit・note・sections・マインド） |
| `nodeFontSize` / `lineH` / `vch` / `vcol` / `fitNodeFontSize` / `showFontSizeMenu` | 文字サイズ（`n.fontSize`）と比例する行送り・自動縮小・UI |
| `_editTarget` / `setEditTarget` / `clearEditTarget` / `isEditingField` | 編集中の欄（揃えボタンの対象・描画の抑止） |
| `revertDragToCopy` / `convertDragToCopy` / `_lastMouseCtrl` | Ctrl 押下中だけコピー |
| `n.thick` / `normalizeCrosslaneGeometry` / `nodeRef` | crosslane の厚み・派生ジオメトリ・接続矩形（レーン∩帯） |
| `nodeLaneIdx` | 位置からレーンを判定（書類・データのレーン連動） |
| `APP_VER` / `migrateLegacyEdgeRouting` | 保存データの版番号と旧版の経路指定の移行 |
| `isOverlayShape` / `alignTol` / `bakeManualRouteShift` | 重ね置きシェイプ・整列許容差（図種分岐）・手動経路の平行移動の焼き込み |

### v8.15〜v8.17（シェイプ拡充・レイヤ・凡例・スナップ・メニューバー）
| 名前 | 役割 |
|---|---|
| `sys_input` / `sys_input_desc` / `supplement` | システム入力（二重線）・説明有・補足情報（v8.18）。`SD`・パレット・`shapeEl` に分岐 |
| `g-lane-bands` | レーン境界のドラッグ帯レイヤ（`g-edges` より下） |
| `noteTitleH` / `editNote` の `multiline` | 説明有シェイプの見出し行数に応じた帯高さ・備考の複数行編集 |
| `_edgeLabelGeom` / `_editingEdgeLabel` | 接続線ラベルの実描画中心・編集中の旧ラベル抑止 |
| `zoomAtPointer` | Ctrl+ホイール／ハンドツールのホイールでカーソル中心ズーム |
| `EXPORT_LEGEND_DT` / `LEGEND_SCALE` / `exportLegendItems` / `exportLegendMetrics` / `legendSwatch` / `legendTextW` / `_lgStack` | 書き出し・印刷のシェイプ凡例 |
| `snapCrossToPartners` / `snapMainToShapes(preferIds)` / `computeAlignSnap` の中心優先枠 / `appendPartnerGuideV` / `appendPartnerGuideH` | 接続相手優先の吸着とピンク破線ガイド |
| `#toolbar-scroll` / `#tb-bottombar` / `.rgroup` / `.glabel` / `.bigbtn` / `tbScrollBy` / `updateTbArrows` / `grp-edit` / `grp-arrange` | Office 風メニューバー（横スクロール・ジャンル枠の出し分け） |

### v8.18〜v8.19（切り欠き・点線・外枠帯・ピン吸着）
| 名前 | 役割 |
|---|---|
| `n.cuts` / `groupCuts` / `groupOutlinePath` / `clampGroupCuts` / `groupCornerSteps` / `groupEdgeFreeSpan` / `cornerLocal` / `groupCutState` / `groupNotchState` | グループ枠の切り欠き（L型・凹型）と外周パス・クランプ・ドラッグ状態 |
| `groupContainedNodeIds` / `selectGroupContents` / `groupMembers` / `groupBoxClick` | ⧉ による枠内一括選択・枠のクリック |
| `n.dashed` / `ed.dashed` / `toggleDashed` / `syncDashUI` / `NODE_DASH` / `EDGE_DASH` / `GROUP_DASH` | 点線トグル |
| `GRID_STEP`（80） | 横ガイドラインの間隔・キャンバス拡張の切り上げ単位 |
| `renderGroupBands` / `g-group-bands` | グループ枠の透明帯（外枠リサイズ・v8.24 で内壁も） |
| `pinSideSlotCount` / `_portSideCount` / `_portAssign` / `drawReconnectGhost` | 接続位置ピンの既定位置吸着（本数連動）とガイド |

### v8.20〜v8.21（インライン編集・クイック接続・ヒント）
| 名前 | 役割 |
|---|---|
| `inplaceRect` / `openSvgEditor` の `inplace`/`bg`/`color`/`fontWeight`/`borderColor`/`padY`/`vCenter` | シェイプ内側をくり抜いた編集欄 |
| `_flowDirsG` | 番号サークルの縦横に追随するラベル枠 |
| `hoverConn` / `quickConnAllowed` / `commitConnection` / `ed.fromPin` / `addEdge(opts.fromPin)` | クイック接続（○＋）と辺指定ピン |
| `_oppExit` / `_oppEntry` | 逆向きピンの自箱貫通回避（`orthoRoute`） |
| `svgRC` | 右クリックでの取消（接続・クイック接続・枠配置・クリック配置） |
| `syncSelectionHint` / `_hintSel` / `hint` | 選択内容に応じた操作案内（`display:'block'` 修正で表示されるように） |
| `gsw` / `isGroupType` | グループ枠の線幅・種別判定 |

### v8.22（印刷の改ページ・crosslane ハンドル）
| 名前 | 役割 |
|---|---|
| `S.printPaper` / `S.printOrient` / `#print-paper` / `#print-orient` / `PAPER_SIZES` / `printPaperMm` / `printPaperLabel` / `printAreaMm` / `pageBudgetPx` / `PAGE_SAFE_MM` / `printAreaSafeH` | 用紙・向きと1ページの実寸（安全代は固定 2mm・v8.31追補） |
| `printPagePlan` / `pageAvoidSets` / `pageBlocks` / `pagePack` / `pageIndivisibleMax` / `pageAllowedBoundaries` / `pageUseLaneBoundaries` / `PAGE_GAP_PAD` / `PAGE_SPLITTABLE` / `printAutoScale` / `printRepeatHeadPx` | 改ページ計画（唯一の入口）・分割禁止区間・横レーンの境界候補・自動縮小・見出し反復 |
| `printViewBox` / `printBandMetrics` | `expPDF` から切り出した共有計算（プレビューと印刷で同一）。`printBandMetrics` は帯の高さ `bandH2` と図面名・日付・凡例の置き場（`titleY`／`dateY`／`lgY`・`dateRight`・`dateOwnRow`）も返す（v8.31追補⑦） |
| `S.pbPreview` / `togglePageBreakPrev` / `updatePageBreakBtn` / `renderPageBreaks` / `g-pagebreak` | 改ページプレビュー |
| `CROSSLANE_HANDLE_MAP_V` / `CROSSLANE_HANDLE_MAP_H` | crosslane の8方向ハンドル→span/thick の割り当て |

### v8.23（複数選択移動・端オートスクロール・判断）
| 名前 | 役割 |
|---|---|
| `syncCrosslaneMain` | 複数選択移動・コピー戻しで crosslane の `mainPos` を同期 |
| `edgeAutoScroll` / `onDocMouseMove` / `syncZoomSpacer` | 画面端オートスクロール・名前付き mousemove・スクロール範囲の即時追随 |
| `GROUP_FONT` / `defaultFontSize` / `groupTitleH` | グループ枠の見出し16px・帯高さの一本化 |
| `diamondLayout` / `diamondAutoSize` | 判断の内接条件による折り返し・自動サイズ（既定 180×59） |
| `nodeAtPoint(x,y,{noGroup:true})` | 端点ドラッグでグループ枠を接続先候補から外す |

### v8.24（多段切り欠き・内壁の帯・右クリック取消・枠モード中の選択）
| 名前 | 役割 |
|---|---|
| `canonGroupSteps` / `stairPts` / `cornerAbs` / `groupCuts` の `steps` | 角の切り欠きを階段状の多段（配列形）に。正規化と点列生成 |
| `renderGroupBands` の内壁帯 / `groupCutState.only` / `groupNotchState.only` | 切り欠きの内壁1本ごとの透明帯（クリック＝選択・ドラッグ＝その壁だけ） |
| `svgRC` のグループ枠分岐 | 右クリックで枠配置を中断（1点目あり→取消しパレット維持） |
| `svgMD` の枠モード分岐 | 枠配置モード中でもシェイプ上のクリックは選択（コーナーは空白でのみ） |

### v8.27（印刷のページ数指定・横方向の分割。※v8.31 で表を追加）
| 名前 | 役割 |
|---|---|
| `S.printFitTall` / `S.printFitWide` / `#print-fit-tall` / `#print-fit-wide` / `#pdf-scale-eff` / `printFitNorm` / `printFitSpec` | ページ数指定の状態・入力欄・読み出し欄・正規化・指定の有無（保存・指紋に含む） |
| `onPrintFitChange` / `syncPrintFitUI` / `printFitEffectiveScale`（v8.31） | 入力→状態→倍率欄の排他（Excel と同じ）・「→ nn%」の読み出し |
| `printFitScale` / `printFitSearch`（v8.31 に切り出し） / `_printFitCache` / `printGeomKey` | ページ数から倍率を決める走査（解析上限から 5% ずつ下げ→1% 刻み・二分探索しない）とメモ化 |
| `printPlanAt(pv,headPx,sideHead,name,W,scale)` / `printRepeatSidePx` | 倍率 scale のときの行＋列の計画（列＝`pageBlocks(...,'x')`・横レーンの 2 列目以降は見出し列ぶん狭い） |
| `expPDF` の `_cols>1` 分岐 / `.pg-col` / `.pg-colbrk` / `.pg-tile` / `.pg-break` | 列ごとの `<table>`・2 列目以降で改ページ・左寄せタイル・計画どおりの行で改ページ |

### v8.31追補⑨⑩（移動・接続中の画面端スクロール／書類・データの吸着＝文字の芯・等間隔・複数移動）
| 名前 | 役割 |
|---|---|
| `edgeAutoScroll.allowed()` / `busy()` / `update(ev)` / `tick()` | ⑨: ハンドツールも対象・busy に接続線を引いている間（接続モードの接続元選択後・`hoverConn`）と接続線のドラッグ 5 種・update は止まっていれば開始（`allowed`・`busy`・パン中でないとき）・tick は実行中に raf を空にしない＝中の `onDocMouseMove`→`update` が 2 本目のループを始めない |
| `overlayCoreDY(n)` / `DOC_WAVE` | ⑩: 上端から文字の芯まで＝書類 (h−10)/2（`shapeEl` の `textCy`）・データ h/2。芯そろえ・ガイドの高さに使う |
| `overlaySnapMany(items,ex,opt)` | ⑩: 動かしている書類・データ（`items`＝[{n,x,y}]）を、`ex` 以外の書類・データに吸着。軸ごとに芯そろえ（隙間 60px 以内・±6px）と等間隔の候補のうち、ずらす量の小さいもの（同じなら芯）。`opt.lockX/lockY`＝その軸は吸着しない（複数選択で掴んだシェイプの吸着が決まった軸）。戻り値 {dx,dy,guides,snappedX,snappedY} |
| `overlayEqualSpace(items,ex,axis,odx,ody)` | ⑩: 等間隔の候補。隣＝直交方向の範囲が重なる書類・データのうちその側で最も近いもの（大きく重なる／動かしているものなら隣なし）。手前の隣 L とその手前 LL の間隔を続ける・先の隣 R とその先 RR の間隔を続ける・L と R の間で両側を同じに（間隔 0〜60px）。odx/ody＝もう一方の軸で先に決まった芯そろえの量（行・列の判定用） |
| `overlayAxisBox` / `overlaySpaceGuides` / `renderOverlaySnapGuides` | ⑩: 並びの向きの区間と直交範囲・等間隔ガイド（そろえた間隔ごとに紫の線＋両端の目盛り・⑩では 2 つの重なる範囲の中ほど→⑪で図形の外側＝上／左へ）・ガイドの描画（'v'/'h'＝ピンク破線・'space'＝紫） |
| `computeOverlaySnap(n,nx,ny,ex)` | ⑩: 1 つだけ動かすとき（単一ドラッグ・`addNode`・`previewOverlaySnapGuides`）の入口＝`overlaySnapMany` の薄い包み。疑似ノードにも `type` を渡す（芯の位置が type で決まる） |
| `onDocMouseMove` の複数選択（`S.drag.group`） | ⑩: 掴んだシェイプの吸着（非レーン図の整列・方眼／レーン図の主軸・交差軸）が決まった軸を `_snX/_snY` に控え、選んだ書類・データ全部を `overlaySnapMany` に渡して残りの軸だけ吸着 |

### v8.31追補⑪（書類・データの 2 個目を置くときの既定の間隔）
| 名前 | 役割 |
|---|---|
| `OVERLAY_DEFAULT_GAP`（=4） | 並びの続きが無い側（LL／RR が無い・離れすぎ・重なり＝2 個目を置くとき）の既定の間隔。`overlayEqualSpace` の候補（±`OVERLAY_SNAP_TOL`・縦も同じ）。並びがある側はその間隔だけ（既定は候補にしない＝既定と違う間隔の並びを崩さない）。値はモックの 4 案（0／4／10／20px）からユーザー決定（実ファイルの書類どうしの間隔の中央値 約 4px） |
| `overlayGap(P,Q,axis)` / `overlayGapAdj` / `DATA_SKEW`（=14） | 手前 P と先 Q の見た目の間隔。データどうしの横は平行な斜辺の横の距離＝外接矩形の隙間＋14（外接矩形で測ると 14px 広く見える）。書類とデータ・縦は外接矩形の隙間。等間隔の隣の判定・並びの間隔・既定の間隔・印の長さがすべてこれ。`shapeEl` の平行四辺形の sk も `DATA_SKEW` |
| `overlaySpaceGuides(c,axis,dx,dy)` / `OVERLAY_GUIDE_OFF`（=9） | 紫の間隔の印を図形の外側に（横の並び＝上端−9・縦の並び＝左端−9・1 回の吸着の印は同じ高さ）。従来の「重なる範囲の中ほど」は `g-guides` が `g-nodes` の下＝0〜4px で図形に隠れ、ピンクの芯の線とも重なった。等間隔（⑩）の印も同じ |
| `overlayEqualSpace` の `consider` | 同じずらし量なら間隔の組の多い候補（2 つの間＝両側の印・並びの続き）を採る |

### v8.31追補⑫（接続相手への吸着を線の位置に）
| 名前 | 役割 |
|---|---|
| `partnerSnapTargets(n,ex,axis)` | 動かしているシェイプ（`ex`・掴んだのは `n`）と線で繋がる相手ごとの吸着目標 [{t＝n の中心の目標, g＝ガイドの位置, o＝相手}]。線の向きの軸（相手の辺が上下＝x・左右＝y）では相手側の付け根（その辺の端が 2 本以上か位置固定のピン＝`_portAssign` と `exitPt` の実位置。1 本なら相手の中心）に自分側の付け根を合わせる（自分の辺にも 2 本以上／ピンなら付け根と中心のずれを引く）。もう一方の軸・手動経路（`waypoints`／`orthoWps`）・帯（複数レーン系）・樹状図（バス経路）は相手の中心。群で動かすときは線の端のシェイプと `n` の中心のずれを足す。端が 1 本の辺の付け根は一直線化で動く側なので目標にしない（自分に付いてきて「いつも吸着済み」になる） |
| `snapCrossToPartners(n,crossPos,ex)` | 交差軸の相手優先（許容差 20）。戻り値 {c＝n の中心の目標, g＝線の位置, o}。呼び出し側のピンクのガイドは `g` |
| `snapMainToShapes(mainPos,ex,prefer)` | 第 3 引数が id の集合から `partnerSnapTargets` の候補（{t}）に変わった（許容差 15・最優先）。`connectedPartners` は廃止 |
| `computeAlignSnap` の相手優先 | 非レーン図（許容差 max(alignTol,6)）も `partnerSnapTargets`。ガイドは線の位置 |

### v8.31追補⑧（迂回する接続線の中央寄せ）
| 名前 | 役割 |
|---|---|
| `centerDetourRoutes(edgeData)` | 全線の経路がそろった後（`renderEdges`・`separateOverlaps` の前）に、曲がり 3 回以上の自動経路の内側の区間（両端が曲がり角）を平行移動する＝形（曲がる順番・向き）は変えない。段（前後の区間が反対側へ伸びる）＝動ける範囲の中央。コの字の底（前後が同じ側）で内側へ寄れないのがシェイプ（`clear` が偽）のときだけ、外側で当たるもの（次のシェイプ・レーン境界）までの中央へ（最大 `DETOUR_MAX`）。内側がレーン境界・キャンバスの端・前後の区間で決まる底（差戻しの U 字・隣のレーンへ出ている線）は動かさない。先に段、次にコの字の底の順 |
| 動ける範囲（`tryMove` の `ok`） | その区間と伸び縮みする前後の区間がシェイプ（±`DETOUR_PAD`=9・`orthoRoute` の `clr` と同じ判定）に当たらない・前後の区間の向きが変わらない（内側の区間は 4px 以上）・始点／終点の助走（`DETOUR_STUB`=16 か元の長さ）を削らない・レーン境界と平行な区間は今いるレーンの中（境界から `LANE_EDGE_CLR`）・キャンバスの内側 |
| 重なりの重さ（`conflict`） | ほかの線（自動・手動直交・バス経路。曲線は除く）の同じ向きの区間で `DETOUR_TRACK`=10 以内に平行なもの＝本当に重なる長さは 4 倍＋`DETOUR_GAP`×2（16px）、端どうしが 16px 未満に近づくぶん。今の位置より重くなる位置には置かない（中央に近い順に探し、無ければ動かさない）。同じ重さで数えると「横の接しを解く代わりに縦が重なる」移動を許した |
| `edgeData` の `fresh` / `crank` | fresh＝その描画で自動経路を求めた線（ドラッグ中は動かしている線だけ・ほかはキャッシュ＝寄せた後）／crank＝`midPos`・段違いトラック `autoMid` 付き（クランク経路＝対象外） |

### v8.31（ガントの印刷＝縦グリッド線の修正・ページ数指定（縦のみ）／追補①〜⑦・⑧は上の表）
| 名前 | 役割 |
|---|---|
| `buildExportSvg` の `_wipe` | `#g-grid` を空にするのはガント以外だけ（ガントは縦グリッド線・網掛け・フェーズ帯・行区切り線の本体） |
| `ganttPrintRowBlocks()` | タスク行の境界だけを切れ目にする分割禁止ブロック `[{top,bottom}]`（フェーズ見出し＋直後の行・折り返しは段見出し＋ヘッダー＋先頭行） |
| `ganttPrintPlanAt(scale,blocks)` | 倍率 scale の計画（`pageBudgetPx`/`pagePack` 共用・`onceTop`/`headH` は expPDF と同じ式・`forced`） |
| `ganttPrintGeomKey` / `ganttPrintFitScale(fit,blocks)` / `_ganttFitCache` | 縦 tall ページに収める倍率（上限＝解析値と 100% の小さい方・`printFitSearch`）とメモ化 |
| `ganttPrintPlan()` | 共通入口（ガント以外・指定なしは null）＝`expPDF`（`_gp`）・`renderGanttPageBreaks`・`printFitEffectiveScale` が使う |
| `renderGanttPageBreaks(g)` / `.pgb` | ガントの改ページプレビュー（`renderGantt` 末尾から・固定表示中は `g-gantt-left` にも `ui-only pgb` で写す） |
| `render()` のガント分岐（`syncPrintPaperUI` を `renderGantt` の後に）/ `render()` 冒頭のクリアに `g-lane-hdr` | 読み出しを行レイアウト確定後に／レーン図からの切替後の旧レーン見出しの書き出し混入を防ぐ |
| `onPrintPaperChange` の `syncPrintFitUI` | 用紙を変えたとき読み出し「→ nn%」を即更新 |
| `ganttUnitsToEndExact(origin,end,scale)` / `ganttUnitsToEnd` | 原点から完了日の翌日 0:00 までの正味の単位数（小数可）／その切り上げ。`calcCanvasSize`（`SVG_W`）・`ganttComputeColW`（見出し表示時の下限 `headMin` も）は正味の値、`expExcel` は切り上げ（v8.31追補） |
| `ganttRightEdge()` | 描く範囲の右端（通常＝`SVG_W`・折り返し＝段の終わり）。`renderGanttHeader`／`renderGanttGrid` の `endX`（v8.31追補で統一） |
| `renderGanttHeader` の `drawTopCell(x,w,label,short)` / `ymShort` | 上段セル＝幅 0 は描かない・収まるラベルだけ（短い形→文字なし） |
| `renderGanttFrame` / `GANTT_FRAME_W`（4） / `GANTT_FRAME_COLOR`（#1e293b） / `expPDF` の `_ser`・`_frameBot` | 工程表の外枠（太線）と印刷の最終スライスの閉じ線。固定表示中は `g-gantt-left` に左辺＋下辺の名称列ぶんを L 字で写す（v8.31追補） |
| `endCommandsForPalette()` | パレットで次のコマンドを始めるとき（`palClick`・`palDragStart` の動き始め＝4px 以上）に、スペース挿入／調整・貼り付け・グループ枠の 1 点目・○＋の接続先選択を終える。戻り値＝案内の文言（v8.31追補④）。ドラッグの動き始めではクリックで選んでいたシェイプも解除（`clearPal`）。押した時点では終えない（押して離せば `palClick`＝選択の切替） |
| `migrateLegacyEdgeRouting(savedVer)` | `appVer` を持たない v8.13 以前のファイルだけ 5 フィールドを落とす（v8.31追補⑤で v8.16 の規則に戻した・v8.26 の「版が違えば全部落とす」は撤回） |
| `manualRouteFitsSides(ed,exitSide,entrySide)` | 手で直した直交経路（`orthoWps`）がその出入りの辺の組で描けるか（端の区間は辺と直角＝曲がり角どうしの区間が水平なら上下の辺・垂直なら左右の辺／曲がり角 1 つは L 字）。`allocatePorts` 1st pass の L 字の規則は描けない組を選ばない（v8.31追補⑤: v8.28 で○＋の線も L 字の対象にしたため、v8.27 以前に Z 字へ直した線をインポートすると手動経路が捨てられていた） |
| `expPDF` の `_pageSize` | `@page{size:<幅>mm <高さ>mm}`（`printPaperMm()`）＝非ガントは常に・ガントはページ数指定のときだけ。v8.31追補⑥で追補③の撤去を撤回（ユーザー決定: 送信先は「PDFに保存」。PDF24 などプリンター経由で縦になるのは了承済み）。案内文（`.hint`・`hint()`）も「PDFに保存」を選ぶよう伝える |
| `printBandMetrics(W,vbW,name)` の置き場 | 日付は帯の右上（v8.31追補⑦）: 凡例と横並び＝右の列の上に日付の行（上 6＋文字＋下 4）・その下に凡例・`bandH2=max(bandH, 日付の行＋凡例＋6)`・図面名は縦中央・日付の右端＝凡例の右端（−8）。凡例なし・下段積み＝図面名と同じ行の右端（従来）。図面名が長く同じ行に入らないときだけ日付を最上段に 1 行（`dateOwnRow`）。ガントの表題部の上端 `onceTop` も `bandH2` |
| `ganttPrintGeomKey` / `printFitScale` の鍵・`onDiagramNameInput` | 倍率のメモ化の鍵に図面名と日付を含める（帯の高さが図面名・日付の幅で変わる）。図面名の入力で改ページ位置のプレビュー（`S.pbPreview`）かページ数指定があれば `renderPageBreaks`＋`syncPrintFitUI`（v8.31追補⑦） |

### v8.30（スペース調整・判断(説明有)・帯どうしの置換・ポップの位置）
| 名前 | 役割 |
|---|---|
| `gapState.op` / `toggleGapMode(op,axis)` / `endGapMode()` / `gapOpName` / `gapAdjustClick` | スペース挿入（'insert'）と調整（'adjust'）の共通モード管理（終了文言・ボタン点灯はモード別） |
| `computeGapAdjust(axis,pos)` | 点線の両側の最寄りシェイプ A／B・ピッチ・delta・上限（limited）を返す純関数（プレビューと確定が共用） |
| `collapseGap(axis,bandStart,delta,lane,aEnd)` / `commitGapAdjust()` | 帯 [bandStart,bandStart+delta) を潰す／mousedown での確定 |
| `remapGapAxis(axis,{d,dEnd,group},lane)` / `remapGroupCutsForGap` | 挿入と縮小の共通走査（座標ごとの移動量）。`insertGap` はこれを呼ぶだけ・`shiftGroupCutsForGap` の後継 |
| `HEX_K` / `hexInset(n)` / `noteTextInset(n)` / `noteEditInset(n)` | 六角形の尖りの奥行き／説明有シェイプの文字余白・編集欄の食い込み（既存 3 種は 8／3） |
| `SD.diamond_desc` / `shapeEl` の diamond_desc 分岐 / `exitPt` の六角形分岐 / `legendSwatch` | 判断(説明有)の定義・描画・接続点・凡例 |
| `replaceTargetAt` の crosslane 分岐 / `replaceNodeType` の帯どうし分岐 | 帯どうしの重ねドロップ置換（type だけ差し替え） |
| `placePopupAt(dlg,x,y,{dx,dy})` / `_lastPointer` | ポップアップを押した点の右下・画面内に置く（`showLaneChoice` ほか同型 6 ポップ） |
| `#sidebar` 220px / `#gap-row`（grid 2 段）/ `#btn-gap-adjust` | サイドバー幅とスペース行の 2 段化 |
