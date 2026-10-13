// preload.js — メインプロセスとページ（mock_v*.html）の橋渡し（CheckListMaker の preload.js から写した）。
// contextIsolation:true・nodeIntegration:false のもとで、決めた窓口だけをページに出す。
// ブラウザで HTML を開いたときは、どの窓口も undefined になる（保存先は localStorage。PDF・PNG は書き出せない）。
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storageAPI', {
  available: true,
  // 画面設計の一覧全体を読む。戻り値は { ok, json: 文字列か null, notice: 帯に出す知らせか null } か { ok: false, error }
  load: () => ipcRenderer.invoke('storage:load'),
  // 画面設計の一覧全体（JSON の文字列）を書く。戻り値は { ok } か { ok: false, error }
  save: (json) => ipcRenderer.invoke('storage:save', json),
});

// 書き出しと取り込み（export.js）。どれも戻り値は { ok, path } か { ok: false, canceled: true } か { ok: false, error }
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

contextBridge.exposeInMainWorld('menuAPI', {
  // アプリのメニューが押されたときの命令（'undo'・'zoomIn' など）を受け取る
  onCommand: (cb) => {
    ipcRenderer.removeAllListeners('menu:command');
    ipcRenderer.on('menu:command', (_e, command) => cb(command));
  },
});
