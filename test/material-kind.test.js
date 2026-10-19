'use strict';
// material-kind.js（資料の種類の見分け・保存する名前）と material-error.js（資料の失敗の種類）のテスト。
// どちらも Electron に触らない純関数なので、ファイルは作らず、先頭のバイトの並び（Buffer）を直接渡して確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const { MaterialError } = require('../material-error');
const {
  MATERIAL_MAX_BYTES,
  MATERIAL_KINDS,
  detectKind,
  storedName,
  MaterialError: ReExportedError,
} = require('../material-kind');

// 先頭のバイトの見本（OLE2＝古い Word・Excel の印、PK＝zip＝docx・xlsx の印）
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n%....');
const PLAIN = Buffer.from('出張申請の一覧');
const html = (body) => Buffer.from(`<!doctype html><html><body>${body}</body></html>`, 'utf8');

test('material-kind.js — 定数', () => {
  assert.equal(MATERIAL_MAX_BYTES, 52428800);
  assert.equal(MATERIAL_MAX_BYTES, 50 * 1024 * 1024);
  assert.deepEqual([...MATERIAL_KINDS], ['text', 'image', 'pdf', 'word', 'excel', 'bdm', 'other']);
});

test('material-kind.js — 拡張子で見分ける（先頭のバイトは問わないもの）', async (t) => {
  await t.test('画像（拡張子の大文字小文字を区別しない）', () => {
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', '写真.JPG', '写真.JPEG', 'A.PNG']) {
      assert.deepEqual(detectKind(name, PLAIN), { kind: 'image', legacy: false }, name);
    }
  });

  await t.test('文字（txt・csv・tsv・md・json・log）', () => {
    for (const name of ['a.txt', 'a.csv', 'a.tsv', 'a.md', 'a.json', 'a.log', '一覧.CSV', 'メモ.TXT']) {
      assert.deepEqual(detectKind(name, PLAIN), { kind: 'text', legacy: false }, name);
    }
  });

  await t.test('知らない拡張子・拡張子なし・名前が空・先頭が点だけの名前は other', () => {
    for (const name of ['a.zip', 'a.exe', 'a.pptx', 'README', '', '.html', 'a.', 'a.漢字']) {
      assert.deepEqual(detectKind(name, PLAIN), { kind: 'other', legacy: false }, JSON.stringify(name));
    }
  });

  await t.test('名前に場所がついていても、最後の名前の拡張子で見る', () => {
    assert.deepEqual(detectKind('C:\\docs\\出張申請.XLSX', ZIP), { kind: 'excel', legacy: false });
    assert.deepEqual(detectKind('docs.v2/出張申請', ZIP), { kind: 'other', legacy: false });
  });
});

test('material-kind.js — zip の印（docx・xlsx・xlsm）', async (t) => {
  await t.test('.docx で先頭が PK なら word', () => {
    assert.deepEqual(detectKind('出張申請.docx', ZIP), { kind: 'word', legacy: false });
    assert.deepEqual(detectKind('出張申請.DOCX', ZIP), { kind: 'word', legacy: false });
  });

  await t.test('.xlsx・.xlsm（大文字も）で先頭が PK なら excel', () => {
    assert.deepEqual(detectKind('出張申請.xlsx', ZIP), { kind: 'excel', legacy: false });
    assert.deepEqual(detectKind('出張申請.XLSX', ZIP), { kind: 'excel', legacy: false });
    assert.deepEqual(detectKind('出張申請.xlsm', ZIP), { kind: 'excel', legacy: false });
  });

  await t.test('先頭が PK でない .docx・.xlsx・.xlsm は other（壊れた・中身の違うファイル）', () => {
    for (const name of ['a.docx', 'a.xlsx', 'a.xlsm']) {
      assert.deepEqual(detectKind(name, PLAIN), { kind: 'other', legacy: false }, name);
      assert.deepEqual(detectKind(name, Buffer.alloc(0)), { kind: 'other', legacy: false }, name);
      assert.deepEqual(detectKind(name, null), { kind: 'other', legacy: false }, name);
    }
  });
});

test('material-kind.js — OLE2 の印（古い Word・Excel）', async (t) => {
  await t.test('OLE2 の印のある .doc は word の古い形', () => {
    assert.deepEqual(detectKind('旅費.doc', OLE2), { kind: 'word', legacy: true });
    assert.deepEqual(detectKind('旅費.DOC', OLE2), { kind: 'word', legacy: true });
  });

  await t.test('OLE2 の印のある .xls は excel の古い形', () => {
    assert.deepEqual(detectKind('旅費.xls', OLE2), { kind: 'excel', legacy: true });
    assert.deepEqual(detectKind('旅費.XLS', OLE2), { kind: 'excel', legacy: true });
  });

  await t.test('印のない .doc・.xls も古い形として扱う', () => {
    assert.deepEqual(detectKind('旅費.doc', PLAIN), { kind: 'word', legacy: true });
    assert.deepEqual(detectKind('旅費.xls', PLAIN), { kind: 'excel', legacy: true });
    assert.deepEqual(detectKind('旅費.doc', null), { kind: 'word', legacy: true });
  });

  await t.test('OLE2 の印があっても、拡張子が .doc・.xls でなければ other（.ppt など）', () => {
    for (const name of ['発表.ppt', '発表.docx', '旅費.xlsx', '資料.pdf', '資料', '図.png']) {
      assert.deepEqual(detectKind(name, OLE2), { kind: 'other', legacy: false }, name);
    }
  });

  await t.test('8 バイトに足りない先頭は OLE2 の印とみなさない', () => {
    assert.deepEqual(detectKind('発表.ppt', OLE2.subarray(0, 7)), { kind: 'other', legacy: false });
  });
});

test('material-kind.js — pdf', async (t) => {
  await t.test('拡張子 .pdf（大文字も）は pdf', () => {
    assert.deepEqual(detectKind('規程.pdf', PDF), { kind: 'pdf', legacy: false });
    assert.deepEqual(detectKind('規程.PDF', PDF), { kind: 'pdf', legacy: false });
  });

  await t.test('先頭が %PDF なら、拡張子がなくても・違っていても pdf', () => {
    assert.deepEqual(detectKind('規程', PDF), { kind: 'pdf', legacy: false });
    assert.deepEqual(detectKind('規程.bin', PDF), { kind: 'pdf', legacy: false });
    assert.deepEqual(detectKind('', PDF), { kind: 'pdf', legacy: false });
  });
});

test('material-kind.js — BDM の HTML', async (t) => {
  await t.test('__SWIMLANE_STATE__ があれば bdm', () => {
    const buf = html('<script>window.__SWIMLANE_STATE__ = {"nodes":[]};</script>');
    assert.deepEqual(detectKind('出張申請の流れ.html', buf), { kind: 'bdm', legacy: false });
  });

  await t.test('id="swimlane-state" があれば bdm', () => {
    const buf = html('<script type="application/json" id="swimlane-state">{"nodes":[]}</script>');
    assert.deepEqual(detectKind('出張申請の流れ.html', buf), { kind: 'bdm', legacy: false });
  });

  await t.test('__SAVED_STATE__ があれば bdm（.htm・大文字の拡張子も）', () => {
    const buf = html('<script>var __SAVED_STATE__ = {"nodes":[]};</script>');
    assert.deepEqual(detectKind('出張申請の流れ.htm', buf), { kind: 'bdm', legacy: false });
    assert.deepEqual(detectKind('出張申請の流れ.HTML', buf), { kind: 'bdm', legacy: false });
  });

  await t.test('どの印もない HTML は other（アプリの書き出しの HTML などを文字として読ませない）', () => {
    assert.deepEqual(detectKind('お知らせ.html', html('<p>出張申請のお知らせ</p>')), { kind: 'other', legacy: false });
    assert.deepEqual(detectKind('お知らせ.htm', html('')), { kind: 'other', legacy: false });
    assert.deepEqual(detectKind('お知らせ.html', null), { kind: 'other', legacy: false });
  });

  await t.test('印があっても拡張子が html・htm でなければ bdm にしない', () => {
    const buf = html('<script>window.__SWIMLANE_STATE__ = {};</script>');
    assert.deepEqual(detectKind('流れ.txt', buf), { kind: 'text', legacy: false });
    assert.deepEqual(detectKind('流れ.bin', buf), { kind: 'other', legacy: false });
  });

  await t.test('Uint8Array で渡しても同じに見分ける', () => {
    const buf = html('<script>window.__SWIMLANE_STATE__ = {};</script>');
    assert.deepEqual(detectKind('流れ.html', new Uint8Array(buf)), { kind: 'bdm', legacy: false });
    assert.deepEqual(detectKind('a.docx', new Uint8Array(ZIP)), { kind: 'word', legacy: false });
  });
});

test('material-kind.js — storedName（保存するファイルの名前）', async (t) => {
  await t.test('拡張子を小文字にして、資料の id につなぐ', () => {
    assert.equal(storedName('m-abc', '出張申請.XLSX'), 'm-abc.xlsx');
    assert.equal(storedName('m-abc', '出張申請.docx'), 'm-abc.docx');
    assert.equal(storedName('m-abc', 'メモ.Txt'), 'm-abc.txt');
  });

  await t.test('拡張子がない名前は bin', () => {
    assert.equal(storedName('m-abc', '出張申請'), 'm-abc.bin');
    assert.equal(storedName('m-abc', ''), 'm-abc.bin');
    assert.equal(storedName('m-abc', 'a.'), 'm-abc.bin');
    assert.equal(storedName('m-abc', '.xlsx'), 'm-abc.bin');
  });

  await t.test('点が複数ある名前は、いちばん後ろの拡張子', () => {
    assert.equal(storedName('m-abc', 'a.tar.gz'), 'm-abc.gz');
    assert.equal(storedName('m-abc', '出張.v2.final.PDF'), 'm-abc.pdf');
  });

  await t.test('拡張子が 8 字より長い・英数字でない・点のあとに空白があるときは bin', () => {
    assert.equal(storedName('m-abc', 'a.abcdefghi'), 'm-abc.bin');
    assert.equal(storedName('m-abc', 'a.abcdefgh'), 'm-abc.abcdefgh');
    assert.equal(storedName('m-abc', 'a.t-x'), 'm-abc.bin');
    assert.equal(storedName('m-abc', 'a.漢字'), 'm-abc.bin');
    assert.equal(storedName('m-abc', 'a.x y'), 'm-abc.bin');
    assert.equal(storedName('m-abc', 'a.x/y'), 'm-abc.bin');
  });

  await t.test('名前に場所がついていても、最後の名前の拡張子を使う', () => {
    assert.equal(storedName('m-abc', 'C:\\docs\\出張申請.XLSX'), 'm-abc.xlsx');
    assert.equal(storedName('m-abc', 'docs.v2/出張申請'), 'm-abc.bin');
  });

  await t.test('できた名前は「資料の id の形」の正規表現に合う', () => {
    const pattern = /^m-[A-Za-z0-9-]{1,80}\.[a-z0-9]{1,8}$/;
    for (const name of ['出張申請.XLSX', '出張申請', 'a.tar.gz', 'a.漢字', 'a.abcdefghi', '']) {
      assert.match(storedName('m-3f2a-91bc', name), pattern, JSON.stringify(name));
    }
  });
});

test('material-error.js — MaterialError', async (t) => {
  await t.test('code と message を持ち、Error の一種である', () => {
    const err = new MaterialError('too_large', '資料が大きすぎます（50MB まで）');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof MaterialError);
    assert.equal(err.name, 'MaterialError');
    assert.equal(err.code, 'too_large');
    assert.equal(err.message, '資料が大きすぎます（50MB まで）');
    assert.equal(typeof err.stack, 'string');
  });

  await t.test('決めてある 9 つの code をそのまま持てる', () => {
    const codes = ['too_large', 'not_file', 'bad_name', 'old_format', 'unsupported', 'file_missing', 'read_failed', 'bad_cursor', 'unavailable'];
    for (const code of codes) assert.equal(new MaterialError(code, '文').code, code);
  });

  await t.test('throw したものを code で見分けられる', () => {
    assert.throws(
      () => { throw new MaterialError('old_format', '古い形です'); },
      (err) => err instanceof MaterialError && err.code === 'old_format' && err.message === '古い形です',
    );
  });

  await t.test('material-kind.js が同じ MaterialError を出し直している', () => {
    assert.equal(ReExportedError, MaterialError);
  });
});
