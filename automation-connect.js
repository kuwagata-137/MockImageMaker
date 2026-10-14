// automation-connect.js — AI のアプリに、このアプリの入口（mcp-server.js）を登録する文（第 7 段階。画像 q49・設計書 12 章）
// 「AI とつなぐ」の窓（ページ）に出す。インストール先の実際の場所を入れる。開発版（npm start）では開発版の文にする。
//  - インストールした版: MockImageMaker.exe を環境変数 ELECTRON_RUN_AS_NODE=1 で Node として動かし、resources\app.asar\mcp-server.js を渡す
//  - 開発版: node で作業フォルダの mcp-server.js を動かす（入口は app.asar の外にいることから開発版だと分かる。automation-client.js）
'use strict';

const path = require('path');

const SERVER_NAME = 'mockimagemaker';

// packaged: インストールした版か。execPath・resourcesPath: Electron の process の値。root: 作業フォルダ（main.js のあるフォルダ）
function mcpServerEntry({ packaged, execPath, resourcesPath, root }) {
  if (packaged) {
    return { name: SERVER_NAME, command: execPath, args: [path.join(resourcesPath, 'app.asar', 'mcp-server.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { name: `${SERVER_NAME}-dev`, command: 'node', args: [path.join(root, 'mcp-server.js')], env: {} };
}

// PowerShell の文字（' で囲み、中の ' は '' にする）
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Claude Code に登録する文（PowerShell）。--env は後ろの値をいくつでも受け取るので、--scope の前に置き、サーバーの名前を
// --env の値と取られないようにする。「--」は使わない（PowerShell では、claude の呼び方によって「--」が消えることがあるため）
function claudeAddCommand(entry) {
  const env = Object.entries(entry.env).map(([k, v]) => `--env ${k}=${v} `).join('');
  const command = entry.command === 'node' ? 'node' : psQuote(entry.command);
  return `claude mcp add ${env}--scope user ${entry.name} ${command} ${entry.args.map(psQuote).join(' ')}`;
}

// ほかの AI のアプリ（MCP に対応したもの）の設定に書く JSON
function mcpConfigJson(entry) {
  const server = { command: entry.command, args: entry.args, ...(Object.keys(entry.env).length ? { env: entry.env } : {}) };
  return JSON.stringify({ mcpServers: { [entry.name]: server } }, null, 2);
}

// 「AI とつなぐ」の窓に渡す中身 { dev, serverName, claudeCommand, json }
function connectInfo(where) {
  const entry = mcpServerEntry(where);
  return { dev: !where.packaged, serverName: entry.name, claudeCommand: claudeAddCommand(entry), json: mcpConfigJson(entry) };
}

module.exports = { connectInfo, mcpServerEntry, claudeAddCommand, mcpConfigJson, SERVER_NAME };
