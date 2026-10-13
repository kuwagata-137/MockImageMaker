// 使い方: node tools/shoot.js <html のパス> <png の出力先> [幅] [倍率]
// HTML を headless の Chrome で開き、ページ全体を撮影する（引継書 7-3 の起動設定）。
// Chrome のプロファイルは作業フォルダの .devdata/chrome-profile に置く（指定しないと %TEMP% に作られるため）。
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const [htmlPath, pngPath, widthArg, scaleArg] = process.argv.slice(2);
if (!htmlPath || !pngPath) {
  console.error('usage: node tools/shoot.js <html> <png> [width] [scale]');
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    channel: 'chrome',
    userDataDir: path.join(ROOT, '.devdata', 'chrome-profile'),
    args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Number(widthArg) || 1400,
      height: 600,
      deviceScaleFactor: Number(scaleArg) || 1,
    });
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log('saved', pngPath);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('NG', e);
  process.exit(1);
});
