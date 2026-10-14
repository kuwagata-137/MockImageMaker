// automation-tray.js — タスクトレイのアイコン（第 7 段階。CLAUDE.md の「AI の見た目の細かい決めごと」・画像 q48）
//  - AI がつながっている間と、窓を閉じて裏で動いている間だけ出す（人だけで使っているときは出さない）
//  - 紺の四角に白い画面の絵。AI がつながっている間は右下に紫の点。マウスを乗せると状態、押すと窓を出す
//  - 右クリックのメニュー: つながっている AI（押せない）・モックイメージメーカーを開く・AI とつなぐ…・終了
//  - AI がつながっている間に窓の × で隠したときは、起動してから最初の 1 回だけ Windows の通知で知らせる
// アイコンの絵は、画像のファイルを持たずに、ここで PNG を作る（16・24・32 ドット）。確かめの起動（MIM_HEADLESS）では出さない。
'use strict';

const zlib = require('zlib');

const APP_NAME = 'モックイメージメーカー';
// AI のアプリの名前（MCP のつなぎ始めに受け取る名前 → 画面に出す名前）。ページの AI_CLIENT_NAMES と同じ（test/ai-view.test.js で確かめる）
const CLIENT_NAMES = { 'claude-code': 'Claude Code', 'claude-ai': 'Claude' };
const clientLabel = (c) => CLIENT_NAMES[c] || String(c || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'AI';

// アイコンを出すか・紫の点・マウスを乗せたときの文（Windows は 127 字まで）・メニューのいちばん上の行
function trayModel({ clients = [], visible = true } = {}) {
  const labels = clients.map((c) => clientLabel(c && c.client));
  const lines = [APP_NAME, labels.length ? `AI がつながっています（${labels.join('・')}）` : '裏で動いています（AI はつながっていません）'];
  if (!visible) lines.push('窓は閉じています。押すと開きます。');
  return {
    show: labels.length > 0 || !visible,
    dot: labels.length > 0,
    labels,
    tooltip: lines.join('\n').slice(0, 127),
    connected: labels.length ? `つながっている AI：${labels.join('・')}` : 'つながっている AI はありません',
  };
}

// ── アイコンの絵（0〜1 の座標で形を重ねて塗り、4×4 の点で縁をなめらかにする）──
const NAVY = [31, 47, 79]; // 画面の帯と同じ紺（#1f2f4f）
const WHITE = [255, 255, 255];
const SKY = [147, 197, 253];
const GRAY = [148, 163, 184];
const PURPLE = [124, 58, 237]; // AI の色（#7c3aed）
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
function iconShapes(dot) {
  const screen = (x, y) => inRoundRect(x, y, 0.17, 0.23, 0.83, 0.77, 0.06);
  return [
    [NAVY, (x, y) => inRoundRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.2)],
    [WHITE, screen],
    [SKY, (x, y) => screen(x, y) && y < 0.36],
    [GRAY, (x, y) => inRoundRect(x, y, 0.26, 0.45, 0.66, 0.51, 0.02)],
    [GRAY, (x, y) => inRoundRect(x, y, 0.26, 0.57, 0.54, 0.63, 0.02)],
    ...(dot ? [[WHITE, (x, y) => inCircle(x, y, 0.76, 0.76, 0.235)], [PURPLE, (x, y) => inCircle(x, y, 0.76, 0.76, 0.17)]] : []),
  ];
}
// size × size の RGBA（透明度は掛けていない値）
function iconPixels(size, dot) {
  const N = 4;
  const shapes = iconShapes(dot);
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N) / size;
          const y = (py + (sy + 0.5) / N) / size;
          const top = shapes.filter(([, hit]) => hit(x, y)).pop();
          if (!top) continue;
          hits++;
          top[0].forEach((v, i) => { sum[i] += v; });
        }
      }
      const o = (py * size + px) * 4;
      if (hits) sum.forEach((v, i) => { out[o + i] = Math.round(v / hits); });
      out[o + 3] = Math.round((255 * hits) / (N * N));
    }
  }
  return out;
}
// RGBA を PNG にする（色の種類 6＝RGBA・8 ビット。行ごとの前処理はしない）
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const trayIconPng = (size, dot) => encodePng(size, size, iconPixels(size, dot));
const ICON_SIZES = [[16, 1], [24, 1.5], [32, 2]]; // 画面の拡大率 100%・150%・200%

// automation: initAutomation の返す値（clients・windowVisible・onStateChange）。showWindow: 窓を出す。openConnect: 窓を出して「AI とつなぐ」を開く
function initTray({ automation, showWindow, openConnect, quit, headless = false }) {
  if (headless) return { update() {}, noteHiddenByClose() {}, destroy() {} };
  const { Tray, Menu, nativeImage, Notification } = require('electron');
  const image = (dot) => {
    const img = nativeImage.createEmpty();
    ICON_SIZES.forEach(([size, scaleFactor]) => img.addRepresentation({ scaleFactor, buffer: trayIconPng(size, dot) }));
    return img;
  };
  const images = { plain: image(false), dot: image(true) };
  let tray = null;
  let model = trayModel();
  let notified = false;

  function update() {
    model = trayModel({ clients: automation.clients(), visible: automation.windowVisible() });
    if (!model.show) {
      if (tray) tray.destroy();
      tray = null;
      return;
    }
    if (!tray) {
      tray = new Tray(images.plain);
      tray.on('click', () => showWindow());
    }
    tray.setImage(model.dot ? images.dot : images.plain);
    tray.setToolTip(model.tooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: model.connected, enabled: false },
      { type: 'separator' },
      { label: 'モックイメージメーカーを開く', click: () => showWindow() },
      { label: 'AI とつなぐ…', click: () => openConnect() },
      { type: 'separator' },
      { label: '終了', click: () => quit() },
    ]));
  }
  automation.onStateChange(update);
  update();

  return {
    update,
    noteHiddenByClose() {
      if (notified || !model.dot) return;
      notified = true;
      const title = '裏で動き続けています';
      const body = `AI（${model.labels.join('・')}）がつながっているので、窓を閉じてもアプリは終わりません。タスクトレイのアイコンから、また開けます。`;
      if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
      else if (tray) tray.displayBalloon({ title, content: body });
    },
    destroy() {
      if (tray) tray.destroy();
      tray = null;
    },
  };
}

module.exports = { initTray, trayModel, trayIconPng, iconPixels, encodePng, clientLabel, CLIENT_NAMES, ICON_SIZES };
