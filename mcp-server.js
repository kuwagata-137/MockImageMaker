// mcp-server.js — AI の入口（MCP サーバー・stdio）（第 7 段階）
// AI のアプリ（Claude Code など）が起動する。道具の頼みを名前付きパイプでモックイメージメーカーへ渡し、返事を MCP の形に直して返す。
// 道具の中身は持たない（ページの「AI の窓口」にある）。手引き（read_guide・resources）だけは、アプリが動いていなくても返す。
// 起動のしかた:
//  - インストールした版: MockImageMaker.exe を環境変数 ELECTRON_RUN_AS_NODE=1 で起動し、resources\app.asar\mcp-server.js を渡す（設計書 12 章）
//  - 開発版: node mcp-server.js --dev（保存先は npm start と同じ .devdata/userData。MIM_USER_DATA で変えられる）
// 標準出力は MCP のやりとりだけに使う（console.log は標準エラーへ回す）。設計は AI設計基盤_設計書.md の 7・9 章。
'use strict';

console.log = (...a) => console.error(...a); // ほかの部品が console.log を使っても、やりとりを壊さないように

const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { TOOLS } = require('./mcp-tools');
const { INSTRUCTIONS, GUIDES } = require('./mcp-guide');
const { appTarget, createAppLink } = require('./automation-client');
const { version } = require('./package.json');

const errorResult = (code, message, candidates) => ({
  isError: true,
  content: [{ type: 'text', text: `${message}\n${JSON.stringify({ code, ...(candidates ? { candidates } : {}) })}` }],
});

// アプリの返事 { ok, result?, image?, error? } を、MCP の道具の返事にする（画像は PNG の image、ほかは JSON の文字）
function toToolResult(res) {
  if (!res || res.ok !== true) {
    const e = (res && res.error) || {};
    return errorResult(e.code || 'internal', e.message || 'アプリからの返事の形が正しくありません。', e.candidates);
  }
  const content = [];
  if (typeof res.image === 'string' && res.image) content.push({ type: 'image', data: res.image, mimeType: 'image/png' });
  content.push({ type: 'text', text: JSON.stringify(res.result === undefined ? null : res.result) });
  return { content };
}

function createServer({ link }) {
  const server = new McpServer({ name: 'mockimagemaker', version }, { instructions: INSTRUCTIONS });
  for (const t of TOOLS) {
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { title: t.title, readOnlyHint: t.readOnly, openWorldHint: false },
    }, async (args) => {
      if (t.local) return { content: [{ type: 'text', text: GUIDES[args.topic].text }] };
      try {
        return toToolResult(await link.call(t.name, args, { slow: !!t.slow, write: !t.readOnly }));
      } catch (err) {
        return errorResult(err.code || 'internal', err.message || String(err));
      }
    });
  }
  for (const [topic, g] of Object.entries(GUIDES)) {
    const uri = `mim://guide/${topic}`;
    server.registerResource(`guide-${topic}`, uri, { title: g.title, description: `手引き: ${g.title}（read_guide の "${topic}" と同じ）`, mimeType: 'text/markdown' },
      async () => ({ contents: [{ uri, mimeType: 'text/markdown', text: g.text }] }));
  }
  return server;
}

async function main() {
  const session = crypto.randomUUID(); // 「AI が直す前の状態」の行を残す単位（設計書 8-3）
  let server = null;
  const link = createAppLink({
    target: appTarget(),
    session,
    clientName: () => (server && server.server.getClientVersion() || {}).name || '',
    launchWaitMs: Number(process.env.MIM_TIMEOUT_MS) > 0 ? Number(process.env.MIM_TIMEOUT_MS) : undefined,
  });
  server = createServer({ link });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    link.close();
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  server.server.onclose = shutdown;
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[mcp-server] 始められませんでした:', err);
    process.exit(1);
  });
}

module.exports = { createServer, toToolResult };
