'use strict';
// 使用説明書（manual/。2026-10-24）のテスト。jsdom を使わない。
//   作り忘れ（原稿と画像を直したのに npm run manual を流していない）・画像の抜けと余り・原稿の言葉の決まり・
//   インストーラに入れるもの・「ヘルプ > 使い方」の窓口のつなぎを確かめる。
//   ページの命令（runCommand('openManual')）の動きは test/app.test.js で確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANUAL = path.join(ROOT, 'manual');
const IMG_DIR = path.join(MANUAL, 'images');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HTML_NAME = PKG.build.files.find((f) => /^mock_v.*\.html$/.test(f));
const build = require(path.join(MANUAL, '作成ツール', 'build.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('manual.html は、今の原稿と画像から作り直したものと同じ（直したら npm run manual で作り直す）', () => {
  const made = build.buildHtml(build.loadContent(), build.makeShots(build.loadManifest()));
  assert.ok(made === read('manual/manual.html'), 'manual/manual.html が古い。npm run manual で作り直す');
});

test('Word の別冊がある（名前の版はアプリの版と同じ）', () => {
  const version = read(HTML_NAME).match(/const APP_VERSION = '([^']+)'/)[1];
  assert.equal(build.DOCX_NAME, `モックイメージメーカー_使用説明書_v${version}.docx`);
  assert.ok(fs.existsSync(path.join(MANUAL, build.DOCX_NAME)), 'npm run manual で作る');
});

test('原稿が使う画像はすべてあり、使っていない画像・記録にない画像がない', () => {
  const manifest = build.loadManifest();
  const shots = build.makeShots(manifest);
  build.buildHtml(build.loadContent(), shots); // 画像がないと、ここで例外になる
  assert.deepEqual([...shots.used].sort(), Object.keys(manifest).sort(), '使っていない画像（capture.js で撮るのをやめるか、原稿で使う）');
  const files = fs.readdirSync(IMG_DIR).filter((f) => /\.(png|jpg)$/.test(f)).sort();
  assert.deepEqual(files, Object.values(manifest).map((m) => m.file).sort(), '_manifest.json にない画像のファイル（古い画像の消し忘れ）');
});

test('manual.html が読む画像は、すべて manual/images にある', () => {
  const html = read('manual/manual.html');
  const srcs = [...html.matchAll(/<img[^>]* src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  srcs.forEach((s) => {
    assert.match(s, /^images\/[^/]+\.(png|jpg)$/, '画像は同じフォルダの images/ から読む: ' + s);
    assert.ok(fs.existsSync(path.join(MANUAL, s)), 'ない画像: ' + s);
  });
});

test('原稿の言葉の決まり（CLAUDE.md の「画面と言葉」・文の書き方）', () => {
  const content = build.loadContent();
  const text = JSON.stringify(content);
  // エクスポートの意味は「出力する」にそろえた（q79）。MPD は「MPD の図」と書かない（2026-10-21）
  assert.doesNotMatch(text, /書き出/);
  assert.doesNotMatch(text, /MPD の図/);
  // 本文は丁寧語だけ（謙譲語を使わない）。「本書」と書かない
  assert.doesNotMatch(text, /いたし|ございま|でござい|おります|ておりま|申し上げ|におきまし/);
  assert.doesNotMatch(text, /本書/);
  // 見本は架空の業務だけ（出張申請システム）
  assert.match(text, /出張申請システム/);
});

test('インストーラに使い方（manual.html と画像）を入れ、Word の別冊と作る台本は入れない', () => {
  const files = PKG.build.files;
  assert.ok(files.includes('manual/manual.html'));
  assert.ok(files.includes('manual/images/*.{png,jpg}'));
  assert.ok(!files.some((f) => /docx|作成ツール|manual\/\*\*?$/.test(f)), files.join(' '));
});

test('ヘルプ > 使い方: メニュー → ページの runCommand → preload の窓口 → main の窓がつながっている', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const html = read(HTML_NAME);
  assert.match(main, /commandItem\('使い方', 'openManual'\)/, 'ヘルプのメニュー');
  assert.match(html, /case 'openManual': openManual\(\); return true;/, 'ページの runCommand');
  assert.match(preload, /openManual: \(\) => ipcRenderer\.invoke\('manual:open'\)/, 'preload の menuAPI');
  assert.match(main, /ipcMain\.handle\('manual:open'/, 'main の受け口');
  assert.match(main, /manualWin\.loadFile\(path\.join\('manual', 'manual\.html'\)\)/, '使い方の窓が開くファイル');
  assert.match(main, /if \(manualWin\) manualWin\.close\(\);/, 'アプリの窓を閉じたら使い方の窓も閉じる');
});
