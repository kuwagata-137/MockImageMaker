'use strict';
// カレンダー（第 15 段階。画像 q125）とメールの作成欄（画像 q126 の案A）のテスト。描き方（月・週・予定の読み方）・右のパネル・設定一覧・
// アイテム一覧の組・中に重ねたボタンが一緒に動くこと・見た目。画面設計の名前は架空の業務（営業管理・顧客管理）だけを使う。

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./harness');

const plain = (v) => JSON.parse(JSON.stringify(v));
const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
const partEl = (app, id) => $$(app, '#stage .screen .part').find((e) => e.dataset.partId === id);
function fire(app, el, value) {
  if (value === undefined) el.checked = !el.checked || el.type === 'radio';
  else el.value = value;
  el.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}

// 白紙の画面にアイテムを 1 つ置いて開いた状態で起動する
async function bootPart(t, type, props = {}) {
  const app = bootApp();
  const api = await app.api();
  t.after(() => app.close());
  const did = api.actions.createDesign('営業管理', 'other');
  api.openDesign(did);
  const sid = api.currentScreen().id;
  const id = api.actions.addPart(did, sid, type, { x: 32, y: 56 });
  const update = (patch) => api.actions.updatePart(did, sid, id, patch);
  if (Object.keys(props).length) update({ props });
  const part = () => api.currentScreen().parts.find((p) => p.id === id);
  return { app, api, did, sid, id, part, update, el: () => partEl(app, id) };
}
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((e) => e.textContent);

test('カレンダー: 種類の名前・最初の大きさ・最初の中身。アイテム一覧の「一覧画面用」の組の最後', async (t) => {
  const { app, api } = await bootPart(t, 'calendar');
  const c = api.PART_TYPES.calendar;
  assert.deepEqual(plain([c.name, c.w, c.h, c.label, c.props.mode, c.props.today, c.props.hours]), ['カレンダー', 800, 520, '予定', 'month', '2026-10-22', '8:00-18:00']);
  assert.equal(c.props.samples.split('\n').length, 11);
  assert.deepEqual(plain(api.PALETTE_GROUPS.find((g) => g.id === 'list').types.slice(-1)), ['calendar']);
  assert.deepEqual(plain(api.PALETTE_GROUPS.find((g) => g.id === 'detail').types.slice(-1)), ['mail']);
  assert.ok($(app, '.pal-btn[data-type="calendar"]'));
});

test('カレンダーの月の表示: 今日のある月を日曜はじまりの 7 列 5 段。前後の月の日は薄く、今日に印、終日の予定は塗った帯、時刻のある予定は時刻を太字', async (t) => {
  const { el } = await bootPart(t, 'calendar');
  assert.equal(el().querySelector('.plabel-text').textContent, '予定');
  assert.equal(el().querySelector('.pcal-top b').textContent, '2026年10月');
  assert.deepEqual(texts(el(), '.pcal-mode i.on'), ['月']);
  assert.deepEqual(texts(el(), '.pcal-wd span'), ['日', '月', '火', '水', '木', '金', '土']);
  const cells = [...el().querySelectorAll('.pcal-c')];
  assert.equal(cells.length, 35);
  assert.deepEqual(cells.filter((c) => c.classList.contains('out')).map((c) => c.querySelector('.pcal-d').textContent), ['27', '28', '29', '30'], '9 月の 27〜30 日は薄く');
  assert.equal(el().querySelector('.pcal-d.today').textContent, '22');
  const day = (n) => cells.find((c) => !c.classList.contains('out') && c.querySelector('.pcal-d').textContent === String(n));
  assert.deepEqual(texts(day(9), '.pcal-ev.allday'), ['創立記念日']);
  assert.deepEqual(texts(day(22), '.pcal-ev'), ['10:00株式会社サンプル商事を訪問', '15:00社内の勉強会']);
  assert.deepEqual(texts(day(22), '.pcal-ev em'), ['10:00', '15:00']);
  assert.ok(cells[0].classList.contains('w0') && cells[6].classList.contains('w6'), '日曜と土曜の印（色は CSS）');
});

test('カレンダーの月の表示: マスに入りきらない予定は「ほか N 件」。月によって 6 段。終日の予定を先に、時刻の早い順', async (t) => {
  const { el, update } = await bootPart(t, 'calendar');
  update({ props: { samples: '2026-10-15, 15:00, 会議 C\n2026-10-15, 09:00, 会議 A\n2026-10-15, , 研修\n2026-10-15, 13:00-14:00, 会議 B' } });
  const day15 = [...el().querySelectorAll('.pcal-c')].find((c) => c.querySelector('.pcal-d').textContent === '15');
  assert.deepEqual(texts(day15, '.pcal-ev'), ['研修'], '高さ 520 のマスには 2 つまで。入りきらないときは 1 つと「ほか N 件」');
  assert.equal(day15.querySelector('.pcal-more').textContent, 'ほか 3 件');
  update({ props: { samples: '2026-10-15, 15:00, 会議 C\n2026-10-15, 09:00, 会議 A' } });
  assert.deepEqual(texts([...el().querySelectorAll('.pcal-c')].find((c) => c.querySelector('.pcal-d').textContent === '15'), '.pcal-ev em'), ['9:00', '15:00']);
  update({ props: { today: '2026-08-15' } });
  assert.equal(el().querySelector('.pcal-top b').textContent, '2026年8月');
  assert.equal(el().querySelectorAll('.pcal-c').length, 42, '8 月 1 日が土曜なので 6 段');
  assert.match(el().querySelector('.pcal-grid').getAttribute('style'), /repeat\(6,1fr\)/);
});

test('カレンダーの予定の読み方: 「日付, 件名」の 2 つだけの行は終日。日付・時刻の読めない行は描かない。全角の数字と 2026/10/5 も読む', async (t) => {
  const { el, update } = await bootPart(t, 'calendar');
  update({ props: { samples: '2026-10-05, 打ち合わせ\nあした, 10:00, 読めない日付\n2026-10-06, 午前, 読めない時刻\n2026-02-30, , ない日付\n２０２６/10/7，10:00〜10:30，全角\n\n2026年10月8日\t11:00\tタブ' } });
  assert.deepEqual(texts(el(), '.pcal-ev'), ['打ち合わせ', '10:00全角', '11:00タブ']);
  assert.ok(el().querySelector('.pcal-ev.allday'));
  update({ props: { today: '今日', samples: '2026-12-03, 09:00, 一つだけ' } });
  assert.equal(el().querySelector('.pcal-top b').textContent, '2026年12月', '今日が読めないときは、最初の予定の日');
});

test('カレンダーの週の表示: 今日のある週（日〜土）。左に時刻、予定は時刻の位置と長さの箱。終日の予定があるときだけ終日の行', async (t) => {
  const { el, update } = await bootPart(t, 'calendar', { mode: 'week' });
  assert.equal(el().querySelector('.pcal-top b').textContent, '2026年10月18日〜24日');
  assert.deepEqual(texts(el(), '.pcal-mode i.on'), ['週']);
  assert.deepEqual(texts(el(), '.pcal-wk-head b'), ['18', '19', '20', '21', '22', '23', '24']);
  assert.equal(el().querySelector('.pcal-wk-head .today b').textContent, '22');
  assert.equal(el().querySelectorAll('.pcal-wk-times span').length, 10, '8 時から 18 時まで 1 時間ごと');
  assert.equal(el().querySelector('.pcal-wk-all'), null, 'この週に終日の予定はない');
  const boxes = [...el().querySelectorAll('.pcal-wev')];
  assert.equal(boxes.length, 6);
  const visit = boxes.find((b) => b.textContent.includes('株式会社サンプル商事'));
  assert.equal(visit.querySelector('em').textContent, '10:00〜12:00');
  assert.match(visit.getAttribute('style'), /top:calc\(20\.00% \+ 1px\);height:calc\(20\.00% - 3px\)/, '8〜18 時の 10 時から 2 時間');
  update({ props: { hours: '9:00-17:00', samples: '2026-10-20, , 休み\n2026-10-21, 10:00-11:00, 会議 A\n2026-10-21, 10:30-11:30, 会議 B' } });
  assert.equal(el().querySelectorAll('.pcal-wk-times span').length, 8);
  assert.deepEqual(texts(el(), '.pcal-wk-all .pcal-ev'), ['休み']);
  const [a, b] = [...el().querySelectorAll('.pcal-wev')];
  assert.match(a.getAttribute('style'), /left:calc\(0\.00% \+ 2px\);width:calc\(50\.00% - 5px\)/, '時刻の重なる予定は横に並べる');
  assert.match(b.getAttribute('style'), /left:calc\(50\.00% \+ 2px\)/);
});

test('カレンダーの週の範囲の文: 月や年をまたぐときは、またいだ所から書く', async (t) => {
  const { el, update } = await bootPart(t, 'calendar', { mode: 'week' });
  const title = (today) => { update({ props: { today } }); return el().querySelector('.pcal-top b').textContent; };
  assert.equal(title('2026-10-29'), '2026年10月25日〜31日');
  assert.equal(title('2026-10-01'), '2026年9月27日〜10月3日');
  assert.equal(title('2026-12-30'), '2026年12月27日〜2027年1月2日');
});

test('カレンダーの右のパネル: 名前・表示のしかた（月・週）・今日として描く日・予定。描く時刻は週のときだけ。設定一覧の文', async (t) => {
  const { app, api, id, part } = await bootPart(t, 'calendar');
  api.selectPart(id);
  const side = (sel) => $(app, `#side-settings ${sel}`);
  assert.match(side('[data-pf="label"]').closest('.field').textContent, /カレンダーの名前/);
  assert.equal(side('[data-pf="props.hours"]'), null, '月のときは描く時刻を出さない');
  assert.ok(side('[data-pf="props.samples"]'));
  assert.match(side('#pf-out').textContent, /表示のしかた＝月/);
  assert.match(side('#pf-out').textContent, /今日＝2026-10-22/);
  assert.match(side('#pf-out').textContent, /予定＝11 件/);
  fire(app, $$(app, '#side-settings [data-pf="props.mode"]').find((e) => e.value === 'week'));
  assert.equal(part().props.mode, 'week');
  assert.ok(side('[data-pf="props.hours"]'));
  assert.match(side('#pf-out').textContent, /表示のしかた＝週/);
});

test('メールの作成欄: 種類の名前・最初の大きさ。見出しの行・差出人・宛先の札・件名・書式のボタンの行・本文・送信。項目一覧には入らない', async (t) => {
  const { api, did, el, update } = await bootPart(t, 'mail');
  const m = api.PART_TYPES.mail;
  assert.deepEqual(plain([m.name, m.pal, m.w, m.h, m.label, m.container]), ['メールの作成欄', 'メールの\n作成欄', 560, 440, 'メールを作成', true]);
  assert.equal(el().querySelector('.pfr-head b').textContent, 'メールを作成');
  assert.ok(el().querySelector('.pfr-ic.fc-blue svg'));
  assert.deepEqual(texts(el(), '.pml-row small'), ['差出人', '宛先', '件名']);
  assert.equal(el().querySelector('.pml-row span').textContent, '佐藤 花子 <sato@example.com>');
  assert.deepEqual(texts(el(), '.pml-chip').map((s) => s.replace('✕', '')), ['山田 太郎']);
  assert.ok(el().querySelector('.pml-tb'));
  assert.match(el().querySelector('.pml-body').innerHTML, /山田 太郎 様<br><br>いつもお世話になっております。/);
  assert.equal(el().querySelector('.pml-send').textContent, '送信');
  update({ props: { to: '山田 太郎、鈴木 一郎', toolbar: false, color: 'none', subject: '' } });
  assert.deepEqual(texts(el(), '.pml-chip').map((s) => s.replace('✕', '')), ['山田 太郎', '鈴木 一郎'], '「、」で区切ると宛先を分けて出す');
  assert.equal(el().querySelector('.pml-tb'), null);
  assert.equal(el().querySelector('.pfr-ic'), null);
  assert.equal(el().querySelectorAll('.pml-row .pph')[0].textContent, '件名');
  assert.equal(api.store.state.designs.find((d) => d.id === did).items.length, 0, '項目一覧には何も追加しない');
});

test('メールの作成欄: 上に重ねたボタンのアイテムは中に入り、メールの作成欄を動かすと一緒に動く。設定一覧に中のアイテムの番号', async (t) => {
  const { app, api, did, sid, id, part } = await bootPart(t, 'mail');
  const btn = api.actions.addPart(did, sid, 'button', { x: 400, y: 420 });
  const b = () => api.currentScreen().parts.find((p) => p.id === btn);
  assert.equal(b().inFrame, id);
  const [bx, by] = [b().x, b().y];
  api.actions.movePart(did, sid, id, { ...part(), x: part().x + 64, y: part().y + 32 });
  assert.deepEqual([b().x, b().y], [bx + 64, by + 32]);
  api.selectPart(id);
  const out = $(app, '#side-settings #pf-out').textContent;
  assert.match(out, /宛先＝山田 太郎/);
  assert.match(out, /件名＝点検の日の連絡/);
  assert.match(out, new RegExp(`中のアイテム＝${b().no}`));
});

test('メールの作成欄の右のパネル: 見出しの文字・差出人・宛先・件名・本文・書式のボタンの行・アイコンの色', async (t) => {
  const { app, api, id, part } = await bootPart(t, 'mail');
  api.selectPart(id);
  const keys = $$(app, '#side-settings [data-pf]').map((e) => e.dataset.pf).filter((k, i, a) => a.indexOf(k) === i);
  assert.deepEqual(keys.filter((k) => k !== 'numbered' && k !== 'memo'), ['label', 'props.from', 'props.to', 'props.subject', 'props.body', 'props.toolbar', 'props.color']);
  fire(app, $(app, '#side-settings [data-pf="props.toolbar"]'));
  assert.equal(part().props.toolbar, false);
});

test('カレンダーとメールの作成欄の見た目: Salesforce と kintone の形', async (t) => {
  const { api } = await bootPart(t, 'calendar');
  const css = api.appStyle();
  assert.match(css, /\.look-sf \.pcal-mode i\.on\{[^}]*background:#0176d3/);
  assert.match(css, /\.look-kt \.pcal-mode i\.on\{[^}]*background:#3498db/);
  assert.match(css, /\.look-sf \.pml-chip\{[^}]*border-radius:4px/);
  assert.match(css, /\.look-kt \.pml-body\{[^}]*border-color:#e3e7e8/);
});
