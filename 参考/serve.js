const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname);
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0].split('#')[0];   // クエリ/ハッシュ除去（?v=... でのキャッシュ回避を許可）
  let rel;
  try { rel = decodeURIComponent(reqPath === '/' ? '/diagram_v8.31.html' : reqPath); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }   // 壊れた %xx でサーバーが落ちないように
  const filePath = path.resolve(dir, '.' + rel);
  // このフォルダの外（..%2f などで上へ出る）は読ませない
  if (!filePath.startsWith(dir + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath);
  const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': types[ext] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0'});
    res.end(data);
  });
});
const port = process.env.PORT || 8765;
// この PC の中からだけつなげる（社内ネットワークのほかの PC には公開しない）
server.listen(port, '127.0.0.1', () => console.log('Server running on http://localhost:' + port));