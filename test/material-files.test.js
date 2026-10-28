'use strict';
// material-files.js（資料の置き場）のテスト。Electron に触らず、.devdata/test-tmp/material-files/ に本物のファイルを作って確かめる。
// 見本は架空の出張申請の資料だけ。片付けは unlinkSync と rmdirSync だけで行う
// （fs.rmSync は、Windows の Node v24.12.0 で日本語の名前のファイルを渡すと Node ごと落ちるため）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createMaterialFiles } = require('../material-files');
const { storedName } = require('../material-kind');

const BASE = path.join(__dirname, '..', '.devdata', 'test-tmp', 'material-files');
const SYS = 'y-3f2a9c1e-7b4d-4e8a-9d10-5a6b7c8d9e0f';
const OTHER_SYS = 'y-aaaa1111-2222-3333-4444-555566667777';
const ZIP = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(100)]);
const OLE2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
const newMaterialId = () => `m-${crypto.randomUUID()}`;

function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(dir);
}

// 一時のフォルダ（dir）と、その中の root（<dir>/files）に作った置き場を返す。write は dir の下にファイルを作る
function workspace(t, options = {}) {
  fs.mkdirSync(BASE, { recursive: true });
  const dir = fs.mkdtempSync(path.join(BASE, 'w-'));
  t.after(() => removeTree(dir));
  const root = path.join(dir, 'files');
  const write = (relative, content = 'x') => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  return { dir, root, write, files: createMaterialFiles({ root, ...options }) };
}

const listNames = (dir) => fs.readdirSync(dir).sort();

test('pathOf — 正しい id と名前は、root の下の絶対パスになる', (t) => {
  const { files, root } = workspace(t);
  const file = storedName(newMaterialId(), '出張申請の手引き.pdf');
  assert.equal(files.pathOf(SYS, file), path.join(root, SYS, file));
  assert.ok(path.isAbsolute(files.pathOf(SYS, file)));
  // 長さの上限（id・資料の id の本体は 80 字、拡張子は 8 字）ちょうどは通る
  assert.doesNotThrow(() => files.pathOf('y-' + 'a'.repeat(80), 'm-' + 'a'.repeat(80) + '.' + 'z'.repeat(8)));
});

test('pathOf — システムの id の形が合わなければ bad_name で断る（.. や区切りで root の外に出られない）', (t) => {
  const { files, root } = workspace(t);
  const badIds = ['..', '.', '', 'y-', 'y-a/b', 'y-a\\b', 'y-..', '../y-a', 'a/b', 'x-abc', 'y-あ', 'y-a\n', 'y-' + 'a'.repeat(81), null, undefined, 42];
  for (const bad of badIds) {
    assert.throws(() => files.pathOf(bad, 'm-abc.pdf'), { name: 'MaterialError', code: 'bad_name' }, `システムの id ${JSON.stringify(bad)}`);
  }
  assert.throws(() => files.pathOf('..', 'm-abc.pdf'), (err) => !err.message.includes(root));
});

test('pathOf — 保存するファイルの名前の形が合わなければ bad_name で断る', (t) => {
  const { files } = workspace(t);
  const badFiles = ['..', '', 'a/b', '../m-a.pdf', 'm-a\\..\\b.pdf', 'm-a', 'm-.pdf', 'm-a.PDF', 'm-a.pdf.part', 'm-a.toolongext', 'y-a.pdf', 'm-あ.pdf', 'm-a.pdf\n', 'm-' + 'a'.repeat(81) + '.pdf', null, {}];
  for (const bad of badFiles) {
    assert.throws(() => files.pathOf(SYS, bad), { name: 'MaterialError', code: 'bad_name' }, `名前 ${JSON.stringify(bad)}`);
  }
});

test('storedName の結果は、元の名前がどんな形でも pathOf を通る', (t) => {
  const { files } = workspace(t);
  const names = ['出張申請.pdf', 'メモ', 'a.TXT', 'x.verylongext123', '.xlsx', 'a.b.c.docx', 'a.', 'C:\\work\\申請書.docx', '申請 一覧（最新）.xlsm', '..', ''];
  for (const name of names) {
    const file = storedName(newMaterialId(), name);
    assert.doesNotThrow(() => files.pathOf(SYS, file), `名前 ${JSON.stringify(name)} → ${file}`);
  }
});

test('addFromPaths — 日本語の名前のファイルを写し、行（id・name・kind・size・file・legacy）を返す', async (t) => {
  const { files, write, root } = workspace(t);
  const text = write('src/出張申請の手引き.txt', '出張の前に申請します。');
  const pdf = write('src/旅費規程.pdf', '%PDF-1.7\n%旅費の規程');
  const docx = write('src/出張申請書.docx', ZIP);
  const legacy = write('src/古い出張申請書.doc', OLE2);

  const r = await files.addFromPaths(SYS, [text, pdf, docx, legacy]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.added.map((a) => [a.name, a.kind, a.legacy]), [
    ['出張申請の手引き.txt', 'text', false],
    ['旅費規程.pdf', 'pdf', false],
    ['出張申請書.docx', 'word', false],
    ['古い出張申請書.doc', 'word', true],
  ]);
  for (const added of r.added) {
    assert.deepEqual(Object.keys(added).sort(), ['file', 'id', 'kind', 'legacy', 'name', 'size']);
    assert.match(added.id, /^m-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(added.file, storedName(added.id, added.name));
    assert.doesNotThrow(() => files.pathOf(SYS, added.file));
  }
  assert.equal(new Set(r.added.map((a) => a.id)).size, 4);
  assert.equal(r.added[0].size, Buffer.byteLength('出張の前に申請します。'));
  assert.equal(r.added[2].size, ZIP.length);
  assert.match(r.added[0].file, /\.txt$/);
  assert.match(r.added[3].file, /\.doc$/);
  // 中身がそのまま写されていて、写した先には .part が残らない。元のファイルは動かさない
  assert.equal(fs.readFileSync(files.pathOf(SYS, r.added[0].file), 'utf8'), '出張の前に申請します。');
  assert.deepEqual(fs.readFileSync(files.pathOf(SYS, r.added[2].file)), ZIP);
  assert.deepEqual(listNames(path.join(root, SYS)), r.added.map((a) => a.file).sort());
  assert.equal(fs.readFileSync(text, 'utf8'), '出張の前に申請します。');
});

test('addFromPaths — HTML は全体を読んで種類を決める（図のデータの印が 64KB より後ろにあっても bdm になる）', async (t) => {
  const { files, write } = workspace(t);
  const filler = `<!-- ${'あ'.repeat(40000)} -->`; // 約 120KB
  const bdmHtml = `<!doctype html><html><body>${filler}<script id="swimlane-state" type="application/json">{}</script></body></html>`;
  const plainHtml = `<!doctype html><html><body>${filler}<p>出張申請のお知らせ</p></body></html>`;
  assert.ok(Buffer.byteLength(bdmHtml) > 64 * 1024 * 1.5);
  const bdm = write('src/出張申請の業務フロー.html', bdmHtml);
  const plain = write('src/お知らせ.htm', plainHtml);
  const r = await files.addFromPaths(SYS, [bdm, plain]);
  assert.deepEqual(r.added.map((a) => [a.name, a.kind]), [['出張申請の業務フロー.html', 'bdm'], ['お知らせ.htm', 'other']]);
});

test('addFromPaths — 上限（maxBytes）を超える物は写さず skipped にする。ちょうどの大きさは写す', async (t) => {
  const { files, write, root } = workspace(t, { maxBytes: 10 });
  const ok = write('src/ちょうど.txt', '0123456789');
  const big = write('src/大きすぎる資料.txt', '01234567890');
  const r = await files.addFromPaths(SYS, [ok, big]);
  assert.deepEqual(r.added.map((a) => a.name), ['ちょうど.txt']);
  assert.deepEqual(r.skipped, [{ name: '大きすぎる資料.txt', reason: 'ファイルが大きすぎます（50MB まで）' }]);
  assert.deepEqual(listNames(path.join(root, SYS)), [r.added[0].file]);
});

test('addFromPaths — 上限の既定は 50MB（material-kind の MATERIAL_MAX_BYTES）', async (t) => {
  const { files, write, root } = workspace(t);
  const sparse = write('src/とても大きい.bin', '');
  fs.truncateSync(sparse, 50 * 1024 * 1024 + 1); // 中身が空の 50MB 超（実際のディスクはほとんど使わない）
  const r = await files.addFromPaths(SYS, [sparse]);
  assert.deepEqual(r.added, []);
  assert.equal(r.skipped[0].reason, 'ファイルが大きすぎます（50MB まで）');
  assert.deepEqual(fs.existsSync(path.join(root, SYS)) ? listNames(path.join(root, SYS)) : [], []);
});

test('addFromPaths — フォルダ・ないファイル・形の合わない指定は skipped（理由は日本語で、パスを含まない）。ほかのファイルは写す', async (t) => {
  const { files, write, dir } = workspace(t);
  const folder = path.join(dir, 'src', '資料のフォルダ');
  fs.mkdirSync(folder, { recursive: true });
  const missing = path.join(dir, 'src', 'ない資料.pdf');
  const ok = write('src/あるメモ.txt', 'メモ');
  const r = await files.addFromPaths(SYS, [folder, missing, 123, '', ok]);
  assert.deepEqual(r.added.map((a) => a.name), ['あるメモ.txt']);
  assert.deepEqual(r.skipped, [
    { name: '資料のフォルダ', reason: 'ふつうのファイルではありません' },
    { name: 'ない資料.pdf', reason: 'ファイルが見つかりません' },
    { name: '', reason: 'ファイルの指定が正しくありません' },
    { name: '', reason: 'ファイルの指定が正しくありません' },
  ]);
  assert.equal(JSON.stringify(r).includes(dir), false);
});

test('addFromPaths — 同じファイルをもう一度入れると、別の id の別のファイルになる', async (t) => {
  const { files, write } = workspace(t);
  const src = write('src/旅費規程.txt', '規程');
  const first = await files.addFromPaths(SYS, [src]);
  const second = await files.addFromPaths(SYS, [src]);
  assert.notEqual(first.added[0].id, second.added[0].id);
  assert.notEqual(first.added[0].file, second.added[0].file);
  assert.equal(fs.existsSync(files.pathOf(SYS, first.added[0].file)), true);
  assert.equal(fs.existsSync(files.pathOf(SYS, second.added[0].file)), true);
});

test('addFromPaths — システムの id の形が合わなければ bad_name で断り、フォルダも作らない', async (t) => {
  const { files, write, dir, root } = workspace(t);
  const src = write('src/旅費規程.txt', '規程');
  await assert.rejects(files.addFromPaths('../evil', [src]), { name: 'MaterialError', code: 'bad_name' });
  await assert.rejects(files.addFromPaths(undefined, [src]), { code: 'bad_name' });
  assert.equal(fs.existsSync(root), false);
  assert.equal(fs.existsSync(path.join(dir, 'evil')), false);
});

test('addFromPaths — 指定が空・配列でないときは何も写さず、空の返事を返す', async (t) => {
  const { files } = workspace(t);
  assert.deepEqual(await files.addFromPaths(SYS, []), { added: [], skipped: [] });
  assert.deepEqual(await files.addFromPaths(SYS, null), { added: [], skipped: [] });
  assert.deepEqual(await files.addFromPaths(SYS, 'not-an-array'), { added: [], skipped: [] });
});

test('addFromPaths — 写す途中で失敗したら .part を消して skipped にする（理由にパスを入れない）', async (t) => {
  const { files, write, root, dir } = workspace(t);
  const src = write('src/旅費規程.txt', '規程');
  const failures = {
    '写している途中': () => t.mock.method(fs.promises, 'copyFile', async (from, to) => {
      fs.writeFileSync(to, 'は');
      throw new Error(`EIO: i/o error, copyfile '${from}' -> '${to}'`);
    }),
    '名前を変えるとき': () => t.mock.method(fs.promises, 'rename', async (from, to) => {
      throw new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`);
    }),
  };
  const warn = t.mock.method(console, 'warn', () => {});
  for (const [when, install] of Object.entries(failures)) {
    const mocked = install();
    const r = await files.addFromPaths(SYS, [src]);
    mocked.mock.restore();
    assert.deepEqual(r.added, [], when);
    assert.deepEqual(r.skipped, [{ name: '旅費規程.txt', reason: 'ファイルをコピーできませんでした' }], when);
    assert.deepEqual(listNames(path.join(root, SYS)), [], `${when}: .part が残っている`);
    assert.equal(JSON.stringify(r).includes(dir), false, when);
  }
  // 元の例外（EIO・EPERM など）は、返事には入れず main の console にだけ残す（人から「入らない」と言われたときに調べるため）
  assert.equal(warn.mock.callCount(), 2);
  assert.deepEqual(warn.mock.calls.map((c) => [c.arguments[0], /^(EIO|EPERM)/.test(c.arguments[1].message)]), [['資料をコピーできませんでした:', true], ['資料をコピーできませんでした:', true]]);
});

test('写している途中に掃除を頼んでも、掃除は写し終わってから行われ、写し終えたファイルは一覧になくても消さない', async (t) => {
  const { files, write } = workspace(t);
  const src = write('src/旅費規程.txt', '規程');
  const realCopy = fs.promises.copyFile;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  t.mock.method(fs.promises, 'copyFile', async (from, to) => {
    started();
    await gate;
    return realCopy(from, to);
  });
  const adding = files.addFromPaths(SYS, [src]);
  await startedPromise;
  let sweepFinished = false;
  const sweeping = files.sweep({ [SYS]: [] }).then((r) => { sweepFinished = true; return r; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sweepFinished, false, '写している間は掃除が始まらない');
  release();
  const added = await adding;
  const swept = await sweeping;
  assert.equal(added.added.length, 1);
  assert.deepEqual(added.skipped, []);
  assert.deepEqual(swept, { removedFiles: 0, removedDirs: 0 }); // 写し終わった後に掃除が走ったが、この起動で入れたファイルは一覧になくても残る
  assert.equal(fs.existsSync(files.pathOf(SYS, added.added[0].file)), true);
});

test('sweep — この起動で入れたファイルは、一覧（keep・alsoKeep）になくても必ず残る。ほかの起動で入れたファイルは、一覧になければ消える', async (t) => {
  const { files, write, root } = workspace(t);
  const src = write('src/出張申請の手引き.txt', '手引き');
  const earlier = (await files.addFromPaths(SYS, [src])).added[0]; // 前の起動で入れたファイル
  const later = createMaterialFiles({ root }); // 起動し直した（この起動で入れたファイルの控えは空になる）
  const current = (await later.addFromPaths(SYS, [src])).added[0];
  const currentOther = (await later.addFromPaths(OTHER_SYS, [src])).added[0];

  // 一覧は空のシステムの分だけ（OTHER_SYS は一覧にもないシステム）。前の起動のファイルだけが消える
  assert.deepEqual(await later.sweep({ [SYS]: [] }), { removedFiles: 1, removedDirs: 0 });
  assert.equal(fs.existsSync(later.pathOf(SYS, earlier.file)), false);
  assert.equal(fs.existsSync(later.pathOf(SYS, current.file)), true);
  // 一覧が空でも（システムが一覧にない場合も）、この起動で入れたファイルとそのフォルダは残る
  assert.deepEqual(await later.sweep({}, {}), { removedFiles: 0, removedDirs: 0 });
  assert.equal(fs.existsSync(later.pathOf(SYS, current.file)), true);
  assert.equal(fs.existsSync(later.pathOf(OTHER_SYS, currentOther.file)), true);
  // また起動し直すと、一覧になければ消える（行を消してもファイルはすぐ消さず、次の起動の掃除で片付く）
  const next = createMaterialFiles({ root });
  assert.deepEqual(await next.sweep({}, {}), { removedFiles: 2, removedDirs: 2 });
  assert.equal(fs.existsSync(path.join(root, SYS)), false);
});

test('removeSystem の後は、そのシステムでこの起動に入れたファイルの控えも消える（同じ名前のファイルが現れても、掃除で消える）', async (t) => {
  const { files, write, root } = workspace(t);
  const src = write('src/出張申請の手引き.txt', '手引き');
  const added = (await files.addFromPaths(SYS, [src])).added[0];
  assert.deepEqual(await files.removeSystem(SYS), { removed: 1 });
  write(`files/${SYS}/${added.file}`, 'x'); // 消した後に、同じ名前で現れたファイル
  assert.deepEqual(await files.sweep({ [SYS]: [] }), { removedFiles: 1, removedDirs: 0 });
  assert.equal(fs.existsSync(path.join(root, SYS, added.file)), false);
});

test('removeSystem — システムのフォルダを、日本語の名前のファイルごと消す。ほかのシステムのフォルダは消さない', async (t) => {
  const { files, write, root, dir } = workspace(t);
  const src = write('src/出張申請の手引き.txt', '手引き');
  const added = (await files.addFromPaths(SYS, [src, src])).added;
  await files.addFromPaths(OTHER_SYS, [src]);
  write(`files/${SYS}/日本語のメモ.txt`, 'メモ'); // 置き場がつくる名前ではないファイルも、フォルダごと消える
  write('outside/y-keep/m-1.pdf', 'x');
  assert.equal(added.length, 2);

  const r = await files.removeSystem(SYS);
  assert.deepEqual(r, { removed: 3 });
  assert.equal(fs.existsSync(path.join(root, SYS)), false);
  assert.equal(fs.readdirSync(path.join(root, OTHER_SYS)).length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'outside', 'y-keep', 'm-1.pdf')), true);
});

test('removeSystem — フォルダがなければ { removed: 0 }。id の形が合わなければ bad_name。root の外は消さない', async (t) => {
  const { files, write, root, dir } = workspace(t);
  fs.mkdirSync(root, { recursive: true });
  const outside = write('outside/m-1.pdf', 'x');
  assert.deepEqual(await files.removeSystem(SYS), { removed: 0 });
  for (const bad of ['..', '../outside', 'y-', '', undefined]) {
    await assert.rejects(files.removeSystem(bad), { name: 'MaterialError', code: 'bad_name' }, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(outside), true);
  assert.equal(fs.existsSync(dir), true);
});

test('removeSystem — フォルダの中にフォルダがあって消せないときは read_failed（理由にパスを入れず、中のフォルダはたどらない）', async (t) => {
  const { files, write, root, dir } = workspace(t);
  write(`files/${SYS}/m-1.txt`, 'x');
  const inner = write(`files/${SYS}/inner/資料.txt`, 'x');
  await assert.rejects(files.removeSystem(SYS), (err) => err.code === 'read_failed' && !err.message.includes(dir));
  assert.equal(fs.existsSync(inner), true);
  assert.equal(fs.existsSync(path.join(root, SYS, 'm-1.txt')), false);
});

// 掃除の見本: 残すフォルダ A（keep と alsoKeep に分けて残す）・どちらにもないフォルダ B・alsoKeep だけにあるフォルダ C・一覧が空のフォルダ D
function sweepFixture(t) {
  const ws = workspace(t);
  const { write, root } = ws;
  const A = 'y-aaaa';
  const B = 'y-bbbb';
  const C = 'y-cccc';
  const D = 'y-dddd';
  const put = (system, name) => write(`files/${system}/${name}`, 'x');
  put(A, 'm-keep.pdf');
  put(A, 'm-also.docx');
  put(A, 'm-stray.txt');
  put(A, 'm-keep.pdf.part');
  put(A, 'm-stray.png.part');
  put(A, '旅費のメモ.txt'); // 名前の形が合わない物には触らない
  put(A, 'README');
  put(A, 'm-UPPER.PDF');
  put(A, 'inner/m-stray.txt'); // 中のフォルダはたどらない
  put(B, 'm-one.pdf');
  put(B, 'm-two.txt.part');
  put(B, '日本語の名前の資料.txt'); // フォルダごと消すときは、名前を問わず消える
  put(C, 'm-also.txt');
  put(D, 'm-gone.pdf');
  // 名前の形が合わない物（root の直下）
  write('files/notes/m-1.pdf', 'x');
  write('files/y-/m-1.pdf', 'x');
  write('files/y-あ/m-1.pdf', 'x');
  write('files/readme.txt', 'x');
  write('files/y-file', 'x');
  // root の外
  write('outside/y-bbbb/m-one.pdf', 'x');
  write('outside/m-1.pdf', 'x');
  return { ...ws, A, B, C, D, exists: (...parts) => fs.existsSync(path.join(root, ...parts)) };
}

test('sweep — keep と alsoKeep のファイルは残り、どちらにもないファイルと .part は消える', async (t) => {
  const fx = sweepFixture(t);
  const { exists, A, C, D } = fx;
  const r = await fx.files.sweep(
    { [A]: ['m-keep.pdf'], [D]: [] },
    { [A]: ['m-also.docx'], [C]: ['m-also.txt'] },
  );
  assert.equal(exists(A, 'm-keep.pdf'), true);
  assert.equal(exists(A, 'm-also.docx'), true);
  assert.equal(exists(A, 'm-stray.txt'), false);
  assert.equal(exists(A, 'm-keep.pdf.part'), false); // .part は一覧にあっても消す
  assert.equal(exists(A, 'm-stray.png.part'), false);
  assert.equal(exists(C, 'm-also.txt'), true);
  assert.equal(exists(D, 'm-gone.pdf'), false); // 一覧が空のシステムは、フォルダを残して中を消す
  assert.equal(exists(D), true);
  // removedFiles＝A の 3 つ（m-stray.txt・2 つの .part）＋ B の 3 つ ＋ D の 1 つ、removedDirs＝B の 1 つ
  assert.deepEqual(r, { removedFiles: 7, removedDirs: 1 });
});

test('sweep — どちらにもないシステムのフォルダは、日本語の名前のファイルも含めて中を消してから消す', async (t) => {
  const fx = sweepFixture(t);
  await fx.files.sweep({ [fx.A]: ['m-keep.pdf'] }, {});
  assert.equal(fx.exists(fx.B), false);
  assert.equal(fx.exists(fx.C), false);
  assert.equal(fx.exists(fx.D), false);
  assert.equal(fx.exists(fx.A), true);
});

test('sweep — 名前の形が合わない物・中のフォルダ・root の外には触らない', async (t) => {
  const fx = sweepFixture(t);
  const { exists, A, dir } = fx;
  await fx.files.sweep({ [A]: [] }, {});
  assert.equal(exists(A, '旅費のメモ.txt'), true);
  assert.equal(exists(A, 'README'), true);
  assert.equal(exists(A, 'm-UPPER.PDF'), true);
  assert.equal(exists(A, 'inner', 'm-stray.txt'), true);
  for (const name of ['notes', 'y-', 'y-あ']) assert.equal(exists(name, 'm-1.pdf'), true, name);
  assert.equal(exists('readme.txt'), true);
  assert.equal(exists('y-file'), true);
  assert.equal(fs.existsSync(path.join(dir, 'outside', 'y-bbbb', 'm-one.pdf')), true);
  assert.equal(fs.existsSync(path.join(dir, 'outside', 'm-1.pdf')), true);
});

test('sweep — 一覧の中の ../ などは、root の外へのパスとして使われない', async (t) => {
  const fx = sweepFixture(t);
  const { dir, A } = fx;
  await fx.files.sweep({ [A]: ['../../outside/m-1.pdf', '../y-bbbb/m-one.pdf'], '../outside': ['m-1.pdf'] }, {});
  assert.equal(fs.existsSync(path.join(dir, 'outside', 'm-1.pdf')), true);
  assert.equal(fx.exists('y-bbbb', 'm-one.pdf'), false); // 一覧にないシステムなので、フォルダごと消える
});

test('sweep — junction（フォルダへの印）のシステムのフォルダはたどらない', async (t) => {
  const fx = sweepFixture(t);
  const { dir, root } = fx;
  const target = path.join(dir, 'outside', 'linked');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'm-1.pdf'), 'x');
  const link = path.join(root, 'y-link');
  fs.symlinkSync(target, link, 'junction');
  try {
    await fx.files.sweep({}, {});
    assert.equal(fs.existsSync(path.join(target, 'm-1.pdf')), true);
    assert.deepEqual(await fx.files.removeSystem('y-link'), { removed: 0 });
    assert.equal(fs.existsSync(path.join(target, 'm-1.pdf')), true);
  } finally {
    fs.unlinkSync(link); // 印だけを消す（先のフォルダの中身は片付けのときに消える）
  }
});

test('sweep — 一覧の形が正しくなければ bad_name で断り、何も消さない（空の一覧と取り違えて全部消さない）', async (t) => {
  const fx = sweepFixture(t);
  for (const [keep, alsoKeep] of [[null, {}], [undefined, {}], [[], {}], ['x', {}], [{ 'y-aaaa': 'm-keep.pdf' }, {}], [{}, null], [{}, { 'y-aaaa': {} }]]) {
    await assert.rejects(fx.files.sweep(keep, alsoKeep), { name: 'MaterialError', code: 'bad_name' }, JSON.stringify([keep, alsoKeep]));
  }
  assert.equal(fx.exists(fx.A, 'm-stray.txt'), true);
  assert.equal(fx.exists(fx.B, 'm-one.pdf'), true);
});

test('sweep — root がなければ何も消さず { removedFiles: 0, removedDirs: 0 }。alsoKeep は省ける', async (t) => {
  const { files } = workspace(t);
  assert.deepEqual(await files.sweep({}), { removedFiles: 0, removedDirs: 0 });
});
