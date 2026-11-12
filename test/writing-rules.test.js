'use strict';
// 説明文ルール（v1.05 段階 E。質問 q178・q179。仕様_細かい決めごと.md の「説明文ルールの細かい決めごと」）のテスト。
// - 追加ルールの保存と読み込み（mcp-writing-rules.js）
// - 手引き "writing" と、追加ルールを最後に追加して返す入口（mcp-server.js の guideText）
// - AI が書き込んだ説明文の点検（ページの aiTextWarnings。返事の warnings）
// - 「AI と連携」のウィンドウの「説明文ルール」の欄と［追加ルールを保存する］

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bootApp } = require('./harness');
const { systemState, STORAGE_KEY, plain, tick } = require('./ai-fixtures');
const { INSTRUCTIONS, GUIDES, GUIDE_TOPICS, PROMPTS } = require('../mcp-guide');
const { TOOLS } = require('../mcp-tools');
const { guideText } = require('../mcp-server');
const WR = require('../mcp-writing-rules');

const BASE = path.join(__dirname, '..', '.devdata');
let dirSeq = 0;
// fs.rmSync は使わない（Windows の Node v24.12.0 で落ちることがある）
function makeDir(t) {
  const dir = path.join(BASE, `test-writing-${process.pid}-${++dirSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => {
    const data = path.join(dir, 'data');
    if (fs.existsSync(data)) {
      fs.readdirSync(data).forEach((n) => fs.unlinkSync(path.join(data, n)));
      fs.rmdirSync(data);
    }
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  });
  return dir;
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const long = (n, head = '') => head + 'あ'.repeat(n - [...head].length);

async function boot({ ai } = {}) {
  const app = bootApp({ localStorage: { [STORAGE_KEY]: JSON.stringify(systemState()) }, ...(ai ? { aiAPI: ai } : {}) });
  const T = await app.api();
  const call = async (tool, args = {}) => plain(await T.aiDispatch(tool, args, { session: 's-1', client: 'claude-code' }));
  const ok = async (tool, args) => { const r = await call(tool, args); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.result; };
  const $ = (sel) => app.document.querySelector(sel);
  const $$ = (sel) => [...app.document.querySelectorAll(sel)];
  return { app, T, call, ok, $, $$ };
}

test('追加ルール: 1 行に 1 項目で保存し、空の行は除く。保存先は <userData>/data/writing-rules.json。項目数と文字数の上限を超えると保存しない', (t) => {
  const dir = makeDir(t);
  assert.deepEqual(WR.readWritingRules(dir), [], 'ファイルがない時は空');
  const r = WR.saveWritingRules(dir, '金額は税込で書く\r\n\r\n  ボタン名は ［ ］ で囲む  \n敬語を使わない\n');
  assert.deepEqual(r, { ok: true, rules: ['金額は税込で書く', 'ボタン名は ［ ］ で囲む', '敬語を使わない'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', WR.WRITING_RULES_FILE), 'utf8')), { version: 1, rules: r.rules });
  assert.deepEqual(WR.readWritingRules(dir), r.rules);
  const many = WR.saveWritingRules(dir, Array.from({ length: WR.MAX_RULES + 1 }, (_, i) => `ルール ${i + 1}`).join('\n'));
  assert.equal(many.ok, false);
  assert.match(many.error, /追加ルールは 30 項目までです（今は 31 項目）。/);
  const wide = WR.saveWritingRules(dir, `短いルール\n${'あ'.repeat(WR.MAX_RULE_CHARS + 1)}`);
  assert.match(wide.error, /追加ルールは 1 項目 100 字までです（2 項目めが 101 字）。/);
  assert.deepEqual(WR.readWritingRules(dir), r.rules, '保存できなかった時は、前の追加ルールのまま');
  assert.deepEqual(WR.saveWritingRules(dir, '\n \n'), { ok: true, rules: [] }, '全部を消して保存できる');
  assert.deepEqual(WR.readWritingRules(dir), []);
  fs.writeFileSync(path.join(dir, 'data', WR.WRITING_RULES_FILE), '{ 壊れた', 'utf8');
  assert.deepEqual(WR.readWritingRules(dir), [], '読めないファイルは空として扱う');
  assert.deepEqual(WR.readWritingRules(undefined), []);
});

test('手引き "writing": 5 項目のルールと文字数の目安があり、追加ルールは最後に追加して返す（ほかの手引きには追加しない）', (t) => {
  const dir = makeDir(t);
  const base = GUIDES.writing.text;
  assert.ok(GUIDE_TOPICS.includes('writing'));
  assert.match(base, /^# 説明文の書き方/);
  ['読み手を意識して書く', '結論だけを簡潔に書く', '検討の経緯を書かない', '理由と未決事項は設計ノートに書く', '技術用語を控える'].forEach((rule, i) => {
    assert.ok(base.includes(`${i + 1}. ${rule}。`), rule);
  });
  assert.equal(guideText('writing', dir), base, '追加ルールがない時は、手引きのまま');
  WR.saveWritingRules(dir, '金額は税込で書く\n敬語を使わない');
  const withRules = guideText('writing', dir);
  assert.ok(withRules.startsWith(base));
  assert.match(withRules.slice(base.length), /^\n\n## 追加ルール（このアプリの利用者が追加したルール）\n.*追加ルールを優先します。\n- 金額は税込で書く\n- 敬語を使わない$/s);
  assert.equal(guideText('rules', dir), GUIDES.rules.text);
  assert.equal(guideText('writing', undefined), base, '保存先が分からない時も、手引きは返す');
});

test('AI への伝え方: 接続時の文・ツールの説明・手引き "rules" "stages"・prompts が "writing" を読むよう伝える。項目のメモに元を書かせない', () => {
  assert.match(INSTRUCTIONS, /説明文（[^）]*吹き出し[^）]*）を書き込む前に、read_guide の "writing" を読んでください。/);
  assert.match(INSTRUCTIONS.split(/\r?\n/)[1], /説明文の書き方は "writing"/);
  assert.match(TOOLS.find((x) => x.name === 'read_guide').description, /"writing" は説明文の書き方/);
  assert.match(GUIDES.rules.text, /read_guide の "writing"（説明文の書き方）/);
  const stages = GUIDES.stages.text;
  assert.doesNotMatch(stages, /項目のメモに「様式/, '検討の経緯（項目の元）を、項目のメモに書かせない');
  assert.match(stages, /項目の元（どの様式のどの欄か）は add_decision（段階 items）。項目のメモには書かない。/);
  assert.match(stages, /検討の経緯・決定の理由・未決事項は、説明文に書かず、設計ノートに書く。/);
  assert.match(PROMPTS.make_screen.text({ request: '一覧' }), /read_guide の "writing"/);
  assert.match(PROMPTS.fix_design.text({ design: '顧客管理', request: '直す' }), /read_guide の "writing"/);
});

test('文字数の目安は、手引き "writing" の表と、ページの点検（AI_TEXT_LIMITS）と、ウィンドウに並べる 5 項目で同じ', async () => {
  const { app, T } = await boot();
  const limits = plain(T.AI_TEXT_LIMITS);
  assert.deepEqual(limits, { cond: 30, callout: 60, itemMemo: 60, action: 60, step: 20, stepMemo: 60, roleMemo: 60, description: 200 });
  const row = (label) => Number(GUIDES.writing.text.match(new RegExp(`\\| ${label} \\|[^|]*\\| (\\d+) 字 \\|`))[1]);
  assert.equal(row('ステータスの操作の条件'), limits.cond);
  assert.equal(row('吹き出し'), limits.callout);
  assert.equal(row('項目のメモ'), limits.itemMemo);
  assert.equal(row('ボタンの「押したとき」'), limits.action);
  assert.equal(row('スイムレーン図の工程'), limits.step);
  assert.equal(row('工程のメモ・役割のメモ'), limits.stepMemo);
  assert.equal(row('画面設計とシステムの説明'), limits.description);
  plain(T.AI_WRITING_RULES).forEach((rule) => assert.ok(GUIDES.writing.text.includes(rule), rule));
  app.close();
});

test('点検: 目安の文字数を超える説明文と、質問番号・日付・「仮」「未確認」・ファイルの保存場所を含む説明文を書き込むと、書き込みは通り、warnings で修正を促す', async () => {
  const { app, ok } = await boot();
  // 吹き出し（60 字）
  const short = await ok('edit_callouts', { design: 'd1', screen: 's1', ops: [{ op: 'update', callout: 'k1', text: '顧客コードは、登録時に自動で付ける。' }] });
  assert.equal(short.warnings, undefined, 'ルールに合う説明文には何も返さない');
  const c = await ok('edit_callouts', { design: 'd1', screen: 's1', ops: [{ op: 'update', callout: 'k1', text: long(85, '仮: 質問 P12 で決めた。') }] });
  assert.equal(c.changed, true);
  assert.deepEqual(c.warnings, ['画面「新規登録」の吹き出し（k1）が 85 字あります（目安 60 字）。質問番号・「仮」が含まれています。簡潔に書き直し、検討の経緯と理由は設計ノートに書いてください（read_guide の "writing"）。']);
  // 文字数は目安の中でも、検討の経緯を含む説明文
  const m = await ok('edit_items', { design: 'd1', ops: [{ op: 'update', item: 'i1', memo: '2026-11-02 に決定。資料は 03_資料\\開発記録\\目次.md。未確認。' }] });
  assert.deepEqual(m.warnings, ['項目「顧客コード」のメモを確認してください。日付・「未確認」・ファイルの保存場所が含まれています。検討の経緯と理由は設計ノートに書いてください（read_guide の "writing"）。']);
  // ステータスの操作の条件（30 字）と、画面設計の説明（200 字）
  const p = await ok('edit_process', { design: 'd1', ops: [{ op: 'add_action', name: '承認する', from: '申請', to: '承認待ち', role: '上長', cond: long(31) }] });
  assert.deepEqual(p.warnings, ['ステータスの操作「承認する」の条件が 31 字あります（目安 30 字）。簡潔に書き直し、検討の経緯と理由は設計ノートに書いてください（read_guide の "writing"）。']);
  assert.equal((await ok('update_design', { design: 'd1', description: long(200) })).warnings, undefined, '目安ちょうどは返さない');
  assert.match((await ok('update_design', { design: 'd1', description: long(201) })).warnings[0], /^画面設計「顧客管理」の説明が 201 字あります（目安 200 字）。/);
  // 業務の言葉の「未確認」・金額の \ ・質問番号でない英数字は、検討の経緯とみなさない
  const biz = await ok('edit_callouts', { design: 'd1', screen: 's1', ops: [{ op: 'update', callout: 'k1', text: '未確認の請求書は赤で表示する。金額は \\1,000 から。区分 B1 と Q4 を選べる。' }] });
  assert.equal(biz.warnings, undefined);
  app.close();
});

test('点検: システムの説明・役割のメモ・スイムレーン図の工程と工程のメモも点検する。変えていない説明文は、もう一度渡しても返さない', async () => {
  const { app, ok } = await boot();
  const y = await ok('update_system', { system: 'y1', description: long(201), ops: [{ op: 'set_memo', role: '上長', memo: long(61) }] });
  assert.deepEqual(y.warnings.map((w) => w.replace(/。.*$/, '')), ['システム「営業管理システム」の説明が 201 字あります（目安 200 字）', '役割「上長」のメモが 61 字あります（目安 60 字）']);
  const sys = await ok('get_system', { system: 'y1' });
  const steps = sys.steps.map((w) => ({ id: w.id, roleId: w.roleId, text: w.text }));
  steps[1] = { ...steps[1], text: long(21), memo: long(61) };
  const s1 = await ok('set_swimlane', { system: 'y1', steps });
  assert.deepEqual(s1.warnings.map((w) => w.replace(/。.*$/, '')), [
    `スイムレーン図の工程「${long(21)}」が 21 字あります（目安 20 字）`,
    `スイムレーン図の工程「${long(21)}」のメモが 61 字あります（目安 60 字）`,
  ]);
  // 長いままの工程をそのまま渡し、別の工程だけを変える: 変えた工程だけを点検する
  steps[0] = { ...steps[0], text: '受注の連絡を受ける' };
  const s2 = await ok('set_swimlane', { system: 'y1', steps });
  assert.equal(s2.changed, true);
  assert.equal(s2.warnings, undefined);
  app.close();
});

test('点検: 1 回の返事に入れるのは 8 個まで。前の版に戻す時（restore_revision）は点検しない', async () => {
  const { app, ok } = await boot();
  const ops = Array.from({ length: 10 }, (_, i) => ({ op: 'add', text: long(61, `${i}`) }));
  const r = await ok('edit_callouts', { design: 'd1', screen: 's2', ops });
  assert.equal(r.warnings.length, 9);
  assert.equal(r.warnings[8], 'ほかにも、説明文ルールに合わない説明文が 2 個あります（read_guide の "writing"）。');
  // 長い吹き出しのある版を作り、短く直してから、その版に戻す
  const rev = await ok('add_revision', { design: 'd1', title: '長い吹き出しの版' });
  const d = await ok('get_design', { design: 'd1' });
  const sc = await ok('get_screen', { design: 'd1', screen: 's2' });
  await ok('edit_callouts', { design: 'd1', screen: 's2', expect: d.updatedAt, ops: sc.callouts.map((k) => ({ op: 'update', callout: k.id, text: '短い説明文。' })) });
  const back = await ok('restore_revision', { design: 'd1', revision: (rev.revision && rev.revision.id) || rev.id });
  assert.equal(back.changed, true);
  assert.equal(back.warnings, undefined);
  app.close();
});

// preload の aiAPI の代わり。saved に、保存を依頼された入力欄の値を残す
function fakeAiAPI(rules, save) {
  const f = {
    saved: [],
    onRequest() {},
    ready() {},
    onStatus() {},
    connectInfo: async () => ({ claudeCommand: 'claude mcp add mockimagemaker', json: '{}', dev: false }),
    copyText: async () => true,
    writingRules: async () => rules,
    saveWritingRules: async (value) => { f.saved.push(value); return save(value); },
  };
  return f;
}

test('「AI と連携」のウィンドウ: 「説明文ルール」に 5 項目と追加ルールの入力欄。［追加ルールを保存する］を左、［このウィンドウを閉じる］を右に並べ、保存してもウィンドウは閉じない', async () => {
  const ai = fakeAiAPI(['金額は税込で書く', '敬語を使わない'], (value) => ({ ok: true, rules: value.split('\n').map((x) => x.trim()).filter(Boolean) }));
  const { app, T, $, $$ } = await boot({ ai });
  T.runCommand('aiConnect');
  await tick();
  await tick();
  assert.equal(text($('.aic-rules h3')), '説明文ルール');
  assert.deepEqual($$('.aic-rule-list li').map(text), ['読み手を意識して書く', '結論だけを簡潔に書く', '検討の経緯を書かない', '理由と未決事項は設計ノートに書く', '技術用語を控える']);
  assert.equal(text($('.aic-rules-label')), '追加ルール（1 行に 1 項目。AI が次に手引きを読んだ時から適用されます）');
  assert.equal($('#aic-rules').value, '金額は税込で書く\n敬語を使わない');
  assert.match(text($('.aic-rules')), /追加ルールは、このパソコンのアプリに保存されます。出力した HTML には含まれません。/);
  assert.deepEqual($$('.modal-actions button:not([hidden])').map((b) => b.textContent), ['追加ルールを保存する', 'このウィンドウを閉じる']);
  assert.equal($('#aic-rules-saved').hidden, true);
  $('#aic-rules').value = '金額は税込で書く\n\n  ボタン名は ［ ］ で囲む  ';
  $('[data-dlg="ok"]').click();
  await tick();
  await tick();
  assert.deepEqual(ai.saved, ['金額は税込で書く\n\n  ボタン名は ［ ］ で囲む  ']);
  assert.ok($('#dialog-root .modal'), '保存してもウィンドウは閉じない');
  assert.equal($('#aic-rules').value, '金額は税込で書く\nボタン名は ［ ］ で囲む', '保存した形（空の行を除いた形）に直す');
  assert.equal($('#aic-rules-saved').hidden, false);
  assert.equal(text($('#aic-rules-saved')), '✓ 追加ルールを保存しました');
  $('[data-dlg="cancel"]').click();
  assert.equal($('#dialog-root .modal'), null);
  app.close();
});

test('「AI と連携」のウィンドウ: 保存できなかった時は、理由を表示してウィンドウを閉じない。追加ルールの窓口がない時（前の版の preload）は、欄もボタンも表示しない', async () => {
  const ai = fakeAiAPI([], () => ({ ok: false, error: '追加ルールは 30 項目までです（今は 31 項目）。' }));
  const { app, T, $, $$ } = await boot({ ai });
  T.runCommand('aiConnect');
  await tick();
  await tick();
  assert.equal($('#aic-rules').value, '');
  $('[data-dlg="ok"]').click();
  await tick();
  await tick();
  assert.equal(text($('.modal-error')), '追加ルールは 30 項目までです（今は 31 項目）。');
  assert.equal($('.modal-error').hidden, false);
  assert.equal($('#aic-rules-saved').hidden, true);
  assert.ok($('#dialog-root .modal'));
  $('[data-dlg="cancel"]').click();
  delete ai.writingRules;
  T.runCommand('aiConnect');
  await tick();
  await tick();
  assert.equal($('.aic-rules'), null);
  assert.deepEqual($$('.modal-actions button:not([hidden])').map((b) => b.textContent), ['このウィンドウを閉じる']);
  app.close();
});
