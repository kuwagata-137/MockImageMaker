'use strict';
// 版のそろい方のテスト。版を上げたときに直し忘れやすい 4 か所が、同じ版を指しているかを確かめる。
//   アプリの HTML のファイル名（mock_v1.00.html）・HTML の中の APP_VERSION・main.js が開く HTML・
//   package.json の version と build.files。版の対応は v1.00＝1.0.0、v1.01＝1.0.1、v1.10＝1.0.10。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, PKG, HTML_NAME } = require('./harness');

function toPackageVersion(appVersion) {
  const [major, minor] = appVersion.split('.');
  return `${Number(major)}.0.${Number(minor)}`;
}

test('版のそろい方', async (t) => {
  const m = /^mock_v(\d+\.\d{2})\.html$/.exec(HTML_NAME || '');
  assert.ok(m, `build.files の HTML の名前が mock_v<版>.html になっていない: ${HTML_NAME}`);
  const appVersion = m[1];

  await t.test('package.json の version が、HTML のファイル名の版と対応している', () => {
    assert.equal(PKG.version, toPackageVersion(appVersion));
  });

  await t.test('HTML の中の APP_VERSION が、ファイル名の版と同じ', () => {
    const html = fs.readFileSync(path.join(ROOT, HTML_NAME), 'utf8');
    assert.match(html, new RegExp(`const APP_VERSION = '${appVersion.replace('.', '\\.')}';`));
  });

  await t.test('main.js が開く HTML が、build.files の HTML と同じ', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(main, new RegExp(`const APP_HTML = '${HTML_NAME.replace(/\./g, '\\.')}';`));
  });

  await t.test('作業フォルダに、古い版の HTML が残っていない', () => {
    const htmls = fs.readdirSync(ROOT).filter((f) => /^mock_v.*\.html$/.test(f));
    assert.deepEqual(htmls, [HTML_NAME]);
  });

  await t.test('版の対応（v1.00＝1.0.0、v1.01＝1.0.1、v1.10＝1.0.10）', () => {
    assert.equal(toPackageVersion('1.00'), '1.0.0');
    assert.equal(toPackageVersion('1.01'), '1.0.1');
    assert.equal(toPackageVersion('1.10'), '1.0.10');
  });
});
