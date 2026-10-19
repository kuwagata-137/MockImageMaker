// tools/ の確かめの道具が使う、見本の資料を用意して置く部品（shoot-app-materials.js・check-electron-materials.js・check-mcp-materials.js）。
// 役割:
//  - 見本の資料のファイル（make-material-samples.js が作る。.devdata/material-samples/）がなければ作る
//  - 見本のシステム 1 つ（役割・スイムレーンつき）と資料の行を、保存先の data/designs.json と data/files/<システムの id>/ に置く（アプリの起動の前に使う）
//  - フォルダを中身ごと消す（日本語の名前のファイルは fs.rmSync に渡さない。Windows の Node v24.12.0 が落ちるため）
// 中身は架空の出張申請だけ。パソコンの中のファイルの場所は、確かめの道具の側だけで使い、アプリの返事には入れない。
'use strict';

const fs = require('fs');
const path = require('path');
const { detectKind, storedName } = require('../material-kind');
const { makeMaterialSamples, SAMPLE_FILES, DEFAULT_OUT } = require('./make-material-samples');

const SCHEMA_VERSION = 3; // mock_v1.00.html の SCHEMA_VERSION（上げたらここも直す）

// フォルダを中身ごと消す。unlinkSync と rmdirSync だけを使う
function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else if (fs.existsSync(child)) fs.unlinkSync(child);
  }
  fs.rmdirSync(dir);
}

// 見本の資料のファイルがそろっていなければ作る（約 7 秒）。戻り値は見本のフォルダ
async function ensureSamples() {
  if (!Object.values(SAMPLE_FILES).every((name) => fs.existsSync(path.join(DEFAULT_OUT, name)))) await makeMaterialSamples(DEFAULT_OUT);
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

// 前の確かめの data/files と designs.json(.bak) を消し、見本のシステム 1 つ（役割 申請者・上長、作業 2 つ、矢印 1 本）と資料のファイルを置く。
// 戻り値は { systemId, materials }
async function placeSampleSystem({ userData, systemId, systemName, names, idPrefix = 'm-sample-' }) {
  await ensureSamples();
  const dataDir = path.join(userData, 'data');
  removeTree(path.join(dataDir, 'files'));
  fs.mkdirSync(dataDir, { recursive: true });
  for (const file of ['designs.json', 'designs.json.bak']) if (fs.existsSync(path.join(dataDir, file))) fs.unlinkSync(path.join(dataDir, file));
  const now = new Date().toISOString();
  const step = (id, roleId, col, kind, text) => ({ id, roleId, col, kind, text, memo: '', ref: { designId: null, screenId: null, stateId: null }, src: null });
  const system = {
    id: systemId, name: systemName, description: '出張の事前申請と上長の承認をまとめる。', createdAt: now, updatedAt: now, trashedAt: null, designIds: [],
    roles: [{ id: 'l-sample-1', name: '申請者', memo: '' }, { id: 'l-sample-2', name: '上長', memo: '' }],
    swimlane: { steps: [step('w-sample-1', 'l-sample-1', 0, 'start', '出張が決まる'), step('w-sample-2', 'l-sample-2', 1, 'task', '承認する')], edges: [{ id: 'e-sample-1', from: 'w-sample-1', to: 'w-sample-2', label: '' }] },
    materials: placeMaterialFiles(dataDir, systemId, names, idPrefix), notes: {}, revisions: [],
  };
  fs.writeFileSync(path.join(dataDir, 'designs.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION, settings: { customTargets: [], mapPos: {} }, systems: [system], designs: [] }, null, 2));
  return { systemId, materials: system.materials };
}

module.exports = { removeTree, ensureSamples, sampleInfo, placeSampleSystem, SAMPLE_FILES, SAMPLES_DIR: DEFAULT_OUT };
