// automation-render.js — AI の画面の画像と書き出し（get_screen_image・export_design）の、main の側の仕上げ（第 7 段階の T6）
// ページの AI の窓口は、ファイルに書かず、印刷用の HTML（render）を返す。ここでそれを PNG・PDF にする。
//  - 画面の画像（render.kind 'image'）: PNG（長い辺を 1568 ピクセルまでに縮める）にして、返事の image（base64）に入れる
//  - 書き出し（'pdf'・'png'・'files'）: 決めたフォルダ（ドキュメント\モックイメージメーカー\AI の書き出し）に書き、場所を返事の files に入れる。
//    同じ名前のファイルは上書きせず、番号を付けた別のファイルにする（writeUnique）。PDF は開かない
// 確かめ（headless か開発版）のときだけ、環境変数 MIM_AI_EXPORT_DIR で書くフォルダを変えられる。設計は AI設計基盤_設計書.md の 8-7・9-2。
'use strict';

const path = require('path');
const { writeUnique } = require('./automation');
const { safeName } = require('./export');

const IMAGE_MAX_SIDE = 1566; // 画面の画像の長い辺（1568 に収める。細かさの端数で 1 ピクセル増えないように少し小さく）
const IMAGE_SCALE = 2; // 小さい画面（スマホなど）は 2 倍まで細かくする

function createRenderFinisher({ app, renderer, headless = false }) {
  const exportDir = () => ((headless || !app.isPackaged) && process.env.MIM_AI_EXPORT_DIR
    ? path.resolve(process.env.MIM_AI_EXPORT_DIR)
    : path.join(app.getPath('documents'), 'モックイメージメーカー', 'AI の書き出し'));

  async function makeFile(kind, f) {
    if (kind === 'pdf') return renderer.renderPdf({ html: f.html, pageSize: f.pageSize });
    if (kind === 'png') return renderer.renderPng({ html: f.html, width: f.width, height: f.height });
    return Buffer.from(String(f.text), 'utf8');
  }

  // ページの返事 { ok, result, render } を { ok, result, image? } にする（render がなければそのまま返す）
  async function finish(res) {
    if (!res || res.ok !== true || !res.render) return res;
    const { render, ...rest } = res;
    try {
      if (render.kind === 'image') {
        const png = await renderer.renderPng({ html: render.html, width: render.width, height: render.height, scale: IMAGE_SCALE, maxSide: IMAGE_MAX_SIDE });
        return { ...rest, image: png.toString('base64'), result: { ...rest.result, image: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } } };
      }
      const dir = exportDir();
      const files = [];
      for (const f of render.files || []) files.push(await writeUnique(dir, safeName(f.name, 'export'), await makeFile(render.kind, f)));
      return { ...rest, result: { ...rest.result, files, folder: dir } };
    } catch (err) {
      return { ok: false, error: { code: 'render_failed', message: `画像・ファイルを作れませんでした（${(err && err.message) || err}）。` } };
    }
  }

  return { finish, exportDir };
}

module.exports = { createRenderFinisher, IMAGE_MAX_SIDE };
