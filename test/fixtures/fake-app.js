'use strict';
// テスト用の身代わりのアプリ（test/mcp.test.js）。入口（mcp-server.js）が MIM_APP_CMD で --background を付けて起動する。
// MIM_USER_DATA に automation.json を書いて待ち受け、頼みが来たら、届いた中身（tool・args・session・client）と、
// 起動の引数・環境変数 ELECTRON_RUN_AS_NODE・pid をそのまま返す。20 秒で自分で終わる（テストが止め損ねても残らないように）。

const { createAutomationServer } = require('../../automation');

const server = createAutomationServer({
  dir: process.env.MIM_USER_DATA,
  appVersion: 'fake',
  onRequest: async (r) => ({
    ok: true,
    result: { ...r, argv: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE === undefined ? null : process.env.ELECTRON_RUN_AS_NODE, pid: process.pid },
  }),
});
const quit = () => server.stop().finally(() => process.exit(0));
server.start().catch(() => process.exit(1));
setTimeout(quit, 20000);
process.on('SIGTERM', quit);
