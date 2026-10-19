// tools/ の確かめの道具が使う、見本の資料を用意して置く部品（shoot-app-materials.js・check-electron-materials.js・check-mcp-materials.js と、
// .devdata/claude-e2e/run.js の場面 9〜11）。
// 役割:
//  - 見本の資料のファイル（make-material-samples.js が作る。.devdata/material-samples/）がなければ、また、作り方（make-material-samples.js・BDM の図の見本）が
//    見本より新しければ作る
//  - 見本のシステム 1 つ（役割・スイムレーンつき）と資料の行を、保存先の data/designs.json と data/files/<システムの id>/ に置く（アプリの起動の前に使う）
//  - フォルダを中身ごと消す（日本語の名前のファイルは fs.rmSync に渡さない。Windows の Node v24.12.0 が落ちるため。消せるのは .devdata/ の中だけ）
//  - データの形の版 SCHEMA_VERSION を mock_v*.html から読む（写さない。上がったときに自動で追いつく）
// 中身は架空の出張申請だけ。パソコンの中のファイルの場所は、確かめの道具の側だけで使い、アプリの返事には入れない。
'use strict';

const fs = require('fs');
const path = require('path');
const { detectKind, storedName } = require('../material-kind');
const { makeMaterialSamples, SAMPLE_FILES, DEFAULT_OUT } = require('./make-material-samples');

const ROOT = path.resolve(__dirname, '..');
const DEVDATA = path.join(ROOT, '.devdata');
// 見本の作り方が入っているファイル。どれかが見本より新しければ、見本を作り直す
const SAMPLE_SOURCES = [path.join(__dirname, 'make-material-samples.js'), path.join(ROOT, 'test', 'fixtures', 'materials', 'bdm-trip-state.json')];

// アプリの HTML（package.json の build.files の mock_v*.html）から、データの形の版を読む
function readSchemaVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, pkg.build.files.find((f) => /^mock_v.*\.html$/.test(f))), 'utf8');
  const m = /^const SCHEMA_VERSION = (\d+);/m.exec(html);
  if (!m) throw new Error('mock_v*.html から SCHEMA_VERSION を読めません');
  return Number(m[1]);
}
const SCHEMA_VERSION = readSchemaVersion();

// 消してよい場所は .devdata/ の中だけ（.devdata そのものと、その外は例外にする）
function assertInsideDevdata(dir) {
  const rel = path.relative(DEVDATA, path.resolve(dir));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`.devdata/ の外のフォルダは消せません: ${path.basename(dir)}`);
}

// フォルダを中身ごと消す。unlinkSync と rmdirSync だけを使う
function removeTree(dir) {
  assertInsideDevdata(dir);
  const remove = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const child = path.join(folder, entry.name);
      if (entry.isDirectory()) remove(child);
      else if (fs.existsSync(child)) fs.unlinkSync(child);
    }
    fs.rmdirSync(folder);
  };
  remove(dir);
}

// 見本がそろっていて、どれも作り方のファイルより新しいか
function samplesAreFresh() {
  const files = Object.values(SAMPLE_FILES).map((name) => path.join(DEFAULT_OUT, name));
  if (!files.every((f) => fs.existsSync(f))) return false;
  const newestSource = Math.max(...SAMPLE_SOURCES.map((f) => fs.statSync(f).mtimeMs));
  return files.every((f) => fs.statSync(f).mtimeMs >= newestSource);
}

// 見本の資料のファイルがそろっていない・古いときは作る（約 7 秒）。戻り値は見本のフォルダ
async function ensureSamples() {
  if (!samplesAreFresh()) await makeMaterialSamples(DEFAULT_OUT);
  return DEFAULT_OUT;
}

// 見本のファイル 1 つの { name, kind, size, legacy, bytes }（資料の行の種類と大きさに使う）
function sampleInfo(name) {
  const bytes = fs.readFileSync(path.join(DEFAULT_OUT, name));
  const { kind, legacy } = detectKind(name, bytes);
  return { name, kind, size: bytes.length, legacy, bytes };
}

// 資料のファイルを <dataDir>/files/<システムの id>/ に置き、資料の行 { id, name, kind, size, addedAt, memo, file } の並びを返す。id は <idPrefix><番号>
function placeMaterialFiles(dataDir, systemId, names, idPrefix) {
  const folder = path.join(dataDir, 'files', systemId);
  fs.mkdirSync(folder, { recursive: true });
  const addedAt = new Date().toISOString();
  return names.map((name, i) => {
    const info = sampleInfo(name);
    const id = `${idPrefix}${i + 1}`;
    const file = storedName(id, name);
    fs.writeFileSync(path.join(folder, file), info.bytes);
    return { id, name, kind: info.kind, size: info.size, addedAt, memo: '', file };
  });
}

// 役割 2 つ（申請者・上長）・作業 2 つ・矢印 1 本。withFlow が偽なら、役割も作業も空（システムの下書きを AI に作らせる場面用）
function sampleFlow(withFlow) {
  if (!withFlow) return { roles: [], swimlane: { steps: [], edges: [] } };
  const step = (id, roleId, col, kind, text) => ({ id, roleId, col, kind, text, memo: '', ref: { designId: null, screenId: null, stateId: null }, src: null });
  return {
    roles: [{ id: 'l-sample-1', name: '申請者', memo: '' }, { id: 'l-sample-2', name: '上長', memo: '' }],
    swimlane: { steps: [step('w-sample-1', 'l-sample-1', 0, 'start', '出張が決まる'), step('w-sample-2', 'l-sample-2', 1, 'task', '承認する')], edges: [{ id: 'e-sample-1', from: 'w-sample-1', to: 'w-sample-2', label: '' }] },
  };
}

// 前の確かめの data/files と designs.json(.bak) を消し、見本のシステム 1 つと資料のファイルを置く。戻り値は { systemId, materials }。
// withFlow（既定は真）: 役割 2 つ・作業 2 つ・矢印 1 本を入れる。description: システムの説明
async function placeSampleSystem({ userData, systemId, systemName, names, idPrefix = 'm-sample-', withFlow = true, description = '出張の事前申請と上長の承認をまとめる。' }) {
  await ensureSamples();
  const dataDir = path.join(userData, 'data');
  removeTree(path.join(dataDir, 'files'));
  fs.mkdirSync(dataDir, { recursive: true });
  for (const file of ['designs.json', 'designs.json.bak']) if (fs.existsSync(path.join(dataDir, file))) fs.unlinkSync(path.join(dataDir, file));
  const now = new Date().toISOString();
  const system = {
    id: systemId, name: systemName, description, createdAt: now, updatedAt: now, trashedAt: null, designIds: [], ...sampleFlow(withFlow),
    materials: placeMaterialFiles(dataDir, systemId, names, idPrefix), notes: {}, revisions: [],
  };
  fs.writeFileSync(path.join(dataDir, 'designs.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION, settings: { customTargets: [], mapPos: {} }, systems: [system], designs: [] }, null, 2));
  return { systemId, materials: system.materials };
}

module.exports = { removeTree, ensureSamples, sampleInfo, placeSampleSystem, SAMPLE_FILES, SAMPLES_DIR: DEFAULT_OUT, SCHEMA_VERSION };
