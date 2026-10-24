// preload.js — メインプロセスとページ（mock_v*.html）の橋渡し（CheckListMaker の preload.js から写した）。
// contextIsolation:true・nodeIntegration:false のもとで、決めた窓口だけをページに出す。
// ブラウザで HTML を開いたときは、どの窓口も undefined になる（保存先は localStorage。PDF・PNG は出力できない）。
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('storageAPI', {
  available: true,
  // 画面設計の一覧全体を読む。戻り値は { ok, json: 文字列か null, notice: 帯に出す知らせか null } か { ok: false, error }
  load: () => ipcRenderer.invoke('storage:load'),
  // 画面設計の一覧全体（JSON の文字列）を書く。戻り値は { ok } か { ok: false, error }
  save: (json) => ipcRenderer.invoke('storage:save', json),
});

// 出力と取り込み（export.js）。どれも戻り値は { ok, path } か { ok: false, canceled: true } か { ok: false, error }
contextBridge.exposeInMainWorld('exportAPI', {
  // HTML の文字を、保存の窓で選んだ所に書く。payload は { name: 最初のファイル名, html }
  saveHtml: (payload) => ipcRenderer.invoke('export:saveHtml', payload),
  // 印刷用の HTML を PDF にする。payload は { name, html, pageSize: { width, height }（インチ）, open: 書いたら開くか }
  savePdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  // 画面ごとの HTML を PNG にする。payload は { files: [{ name, html, width, height }] }。戻り値に count（枚数）と dir（フォルダ）
  savePng: (payload) => ipcRenderer.invoke('export:png', payload),
  // 取り込む HTML を開く窓で選んで読む。戻り値は { ok, text, name } など
  openHtml: () => ipcRenderer.invoke('export:openHtml'),
});

// AI の窓口（第 7 段階。automation-main.js）。AI の頼みをページの aiDispatch に渡し、返事を main へ返す
contextBridge.exposeInMainWorld('aiAPI', {
  // cb({ tool, args, session, client }) は返事 { ok, result?, error? } か、その Promise を返す
  onRequest: (cb) => {
    ipcRenderer.removeAllListeners('ai:request');
    ipcRenderer.on('ai:request', async (_e, { rid, tool, args, session, client }) => {
      let res;
      try {
        res = await cb({ tool, args, session, client });
      } catch (err) {
        res = { ok: false, error: { code: 'internal', message: `アプリの中で失敗しました（${(err && err.message) || err}）。` } };
      }
      ipcRenderer.send('ai:response', { rid, res });
    });
  },
  // 頼みを受けられるようになったことを知らせる（起動の終わりに 1 回）
  ready: () => ipcRenderer.send('ai:ready'),
  // AI のつながりが変わったときの知らせ { clients: [{ session, client }] } を受け取る
  onStatus: (cb) => {
    ipcRenderer.removeAllListeners('ai:status');
    ipcRenderer.on('ai:status', (_e, status) => cb(status));
  },
  // 「AI とつなぐ」の窓の中身 { dev, serverName, claudeCommand, json }（automation-connect.js）
  connectInfo: () => ipcRenderer.invoke('ai:connect-info'),
  // 文をクリップボードに写す。戻り値は true
  copyText: (text) => ipcRenderer.invoke('ai:copy', text),
});

// 資料の置き場（第 9 段階の後半。materials-main.js）。どれも Promise。戻り値は { ok: true, … } か { ok: false, error: { code, message } }
// （pick の取りやめは { ok: false, canceled: true }）。ファイルの場所（パス）はページに渡さず、システムの id と保存したファイルの名前（file）で指す
contextBridge.exposeInMainWorld('materialsAPI', {
  available: true,
  // 開く窓で資料を選んで、システムに入れる。戻り値は { ok, added: [{ id, name, kind, size, file, legacy }], skipped: [{ name, reason }] }
  pick: (systemId) => ipcRenderer.invoke('materials:pick', { systemId }),
  // 窓へ落としたファイル（File の並び）を、システムに入れる。パスは webUtils で取る（File.path は Electron 32 でなくなった）。戻り値は pick と同じ
  addDropped: (systemId, files) => ipcRenderer.invoke('materials:addPaths', { systemId, paths: Array.from(files || []).map((f) => webUtils.getPathForFile(f)).filter(Boolean) }),
  // 資料の中身を読む。req は { systemId, file, kind, name, cursor }。戻り値は { ok, result: { notice, part, text, images: [{ page, width, height, data: PNG の base64 }], nextCursor } }
  read: (req) => ipcRenderer.invoke('materials:read', req),
  // MPD（MultipurposeDiagramMaker で保存した HTML）の資料から、スイムレーン図の案を作る。req は { systemId, file }。戻り値は { ok, plan }
  bdmPlan: (req) => ipcRenderer.invoke('materials:bdmPlan', req),
  // スイムレーン図を、資料の MPD を元にした HTML に出力する（保存の窓を出す。第 11 段階）。req は { systemId, file, plan（渡す形）, name（ファイルの名前の案）}。
  // 戻り値は { ok, path, warnings: [読み直しの食い違いの文], counts: { lanes, steps, edges } }（取りやめは { ok: false, canceled: true }）
  bdmExport: (req) => ipcRenderer.invoke('materials:bdmExport', req),
  // ページの一覧にない資料のファイルを消す。keep は { [システムの id]: [file, …] }。戻り値は { ok, removedFiles, removedDirs }
  sweep: (keep) => ipcRenderer.invoke('materials:sweep', { keep }),
  // システムを完全に削除したあと、そのシステムの資料のフォルダを消す。戻り値は { ok, removed: 消したファイルの数 }
  removeSystem: (systemId) => ipcRenderer.invoke('materials:removeSystem', { systemId }),
});

contextBridge.exposeInMainWorld('menuAPI', {
  // アプリのメニューが押されたときの命令（'undo'・'zoomIn' など）を受け取る
  onCommand: (cb) => {
    ipcRenderer.removeAllListeners('menu:command');
    ipcRenderer.on('menu:command', (_e, command) => cb(command));
  },
  // 使い方（manual/manual.html）の窓を開く。開いていれば前に出す（main.js の manual:open）
  openManual: () => ipcRenderer.invoke('manual:open'),
});
