// preload.js — メインプロセスとページ（mock_v*.html）の橋渡し（CheckListMaker の preload.js から写した）。
// contextIsolation:true・nodeIntegration:false のもとで、決めた窓口だけをページに出す。
// ブラウザで HTML を開いたときは、どちらの窓口も undefined になる（保存先は localStorage）。
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storageAPI', {
  available: true,
  // 画面設計の一覧全体を読む。戻り値は { ok, json: 文字列か null, notice: 帯に出す知らせか null } か { ok: false, error }
  load: () => ipcRenderer.invoke('storage:load'),
  // 画面設計の一覧全体（JSON の文字列）を書く。戻り値は { ok } か { ok: false, error }
  save: (json) => ipcRenderer.invoke('storage:save', json),
});

contextBridge.exposeInMainWorld('menuAPI', {
  // アプリのメニューが押されたときの命令（'undo'・'zoomIn' など）を受け取る
  onCommand: (cb) => {
    ipcRenderer.removeAllListeners('menu:command');
    ipcRenderer.on('menu:command', (_e, command) => cb(command));
  },
});
