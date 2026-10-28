// automation-render.js — AI の画面の画像・図の画像と出力（get_screen_image・get_view_image・export_design・export_system_doc〔第 10 段階の後半〕・export_bdm〔第 11 段階〕）と資料を読む（read_material）の、main の側の仕上げ（第 7 段階の T6）
// ページの AI の窓口は、ファイルに書かず、印刷用の HTML（render）を返す。ここでそれを PNG・PDF にする。
//  - 画面の画像（render.kind 'image'）: PNG（長い辺を 1568 ピクセルまでに縮める）にして、返事の image（base64）に入れる
//  - 出力（'pdf'・'png'・'files'）: 決めたフォルダ（ドキュメント\モックイメージメーカー\AI の出力）に書き、場所を返事の files に入れる。
//    同じ名前のファイルは上書きせず、番号を付けた別のファイルにする（writeUnique）。PDF は開かない
//  - 資料を読む（'material'。第 9 段階の後半）: 資料の窓口（materials-main.js の finishRead）が読み、中身を返事の result に、画像の PNG（base64）を images に入れる。
//    断り書き notice は result の JSON のいちばん前に置く（資料の文より先に読まれるように）
//  - MPD に出力する（'bdm'。第 11 段階）: 資料の窓口（materials-main.js の bdmExport）が資料の MPD を元に HTML を作り、出力と同じフォルダに書く（writeUnique）
// 確かめ（headless か開発版）のときだけ、環境変数 MIM_AI_EXPORT_DIR で書くフォルダを変えられる。設計は AI設計基盤_設計書.md の 8-7・9-2。
'use strict';

const path = require('path');
const { writeUnique } = require('./automation');
const { safeName } = require('./export');

const IMAGE_MAX_SIDE = 1566; // 画面の画像の長い辺（1568 に収める。細かさの端数で 1 ピクセル増えないように少し小さく）
const IMAGE_SCALE = 2; // 小さい画面（スマホなど）は 2 倍まで細かくする

// materials は materials-main.js の initMaterials の戻り値（{ files, finishRead }）。ないときの資料を読む頼みは unavailable
function createRenderFinisher({ app, renderer, headless = false, materials = null }) {
  const exportDir = () => ((headless || !app.isPackaged) && process.env.MIM_AI_EXPORT_DIR
    ? path.resolve(process.env.MIM_AI_EXPORT_DIR)
    : path.join(app.getPath('documents'), 'モックイメージメーカー', 'AI の出力'));

  async function makeFile(kind, f) {
    if (kind === 'pdf') return renderer.renderPdf({ html: f.html, pageSize: f.pageSize });
    if (kind === 'png') return renderer.renderPng({ html: f.html, width: f.width, height: f.height });
    return Buffer.from(String(f.text), 'utf8');
  }

  // 資料を読む。finishRead の返事 { ok, content, images } を、ページの返事の result（system・material）と合わせる。失敗はその code と文で返す
  async function finishMaterial(rest, render) {
    const failed = { ok: false, error: { code: 'read_failed', message: '資料を読めませんでした。もう一度依頼してください。' } };
    if (!materials) return { ok: false, error: { code: 'unavailable', message: '資料を使えません。アプリを起動し直してください。' } };
    let r;
    try {
      r = await materials.finishRead(render);
    } catch (err) {
      console.error('[automation] 資料を読めませんでした:', err); // 文にファイルの場所が入ることがあるので、AI には返さない
      return failed;
    }
    if (!r || r.ok !== true) return r && r.error ? { ok: false, error: r.error } : failed;
    return { ...rest, result: { notice: r.content.notice, ...rest.result, ...r.content }, images: r.images || [] };
  }

  // MPD に出力する（export_bdm。第 11 段階）。render は { kind: 'bdm', systemId, file, plan, name }。資料の窓口（materials-main.js の bdmExport）が
  // 資料の MPD を元に HTML を作り、ここで AI の出力のフォルダに書く。返事の result に files・folder・warnings（読み直しの食い違い）を足す
  async function finishBdm(rest, render) {
    if (!materials || typeof materials.bdmExport !== 'function') return { ok: false, error: { code: 'unavailable', message: '資料を使えません。アプリを起動し直してください。' } };
    const failed = { code: 'render_failed', message: 'MPD に出力できませんでした。' };
    let r;
    try {
      r = await materials.bdmExport({ systemId: render.systemId, file: render.file, plan: render.plan });
    } catch (err) {
      console.error('[automation] MPD に出力できませんでした:', err); // 文にファイルの場所が入ることがあるので、AI には返さない
      return { ok: false, error: failed };
    }
    if (!r || r.ok !== true) return { ok: false, error: (r && r.error) || failed };
    try {
      const dir = exportDir();
      const file = await writeUnique(dir, safeName(render.name, 'export.html'), Buffer.from(r.html, 'utf8'));
      return { ...rest, result: { ...rest.result, files: [file], folder: dir, warnings: r.warnings } };
    } catch (err) {
      return { ok: false, error: { code: 'render_failed', message: `ファイルを書けませんでした（${(err && err.message) || err}）。` } };
    }
  }

  // ページの返事 { ok, result, render } を { ok, result, image?, images? } にする（render がなければそのまま返す）
  async function finish(res) {
    if (!res || res.ok !== true || !res.render) return res;
    const { render, ...rest } = res;
    if (render.kind === 'material') return finishMaterial(rest, render);
    if (render.kind === 'bdm') return finishBdm(rest, render);
    const files = []; // 書けたファイル（途中で失敗したときも、失敗の文で知らせる。AI がやり直して「(2)」のファイルを増やさないように）
    try {
      if (render.kind === 'image') {
        const png = await renderer.renderPng({ html: render.html, width: render.width, height: render.height, scale: IMAGE_SCALE, maxSide: IMAGE_MAX_SIDE });
        return { ...rest, image: png.toString('base64'), result: { ...rest.result, image: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } } };
      }
      const dir = exportDir();
      for (const f of render.files || []) files.push(await writeUnique(dir, safeName(f.name, 'export'), await makeFile(render.kind, f)));
      return { ...rest, result: { ...rest.result, files, folder: dir } };
    } catch (err) {
      const written = files.length ? `途中まで書けたファイル（${files.length} 個）は残しています: ${files.join('、')}` : '';
      return { ok: false, error: { code: 'render_failed', message: `画像・ファイルを作れませんでした（${(err && err.message) || err}）。${written}` } };
    }
  }

  return { finish, exportDir };
}

module.exports = { createRenderFinisher, IMAGE_MAX_SIDE };
