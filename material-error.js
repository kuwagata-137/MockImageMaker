// material-error.js — 資料（システムに入れるファイル）の失敗の種類
// 役割:
//  - 資料の置き場（material-files.js）・読む部品（material-reader.js）・BDM を読む部品（bdm-*.js）が、
//    失敗を「code で見分けられる Error」として投げるための入れ物
//  - Electron に触らない。node だけでテストできる
// code の種類:
//  too_large（大きすぎる）・not_file（ふつうのファイルでない）・bad_name（id や名前の形が合わない）・
//  old_format（古い Word・Excel の形式）・unsupported（読めない種類）・file_missing（ファイルがない）・
//  read_failed（読めない・中身が壊れている）・bad_cursor（続きの位置が正しくない）・unavailable（まだつないでいない機能）・
//  bad_request（MPD に出力するスイムレーン図の形が正しくない・作業がない。第 11 段階）・write_failed（出力するファイルを書けない。第 11 段階）
// message は日本語の文で、パソコンの中のファイルの場所（パス）を入れない（fs の失敗の文はパスを含むので、そのまま入れない）。
'use strict';

class MaterialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MaterialError';
    this.code = code;
  }
}

module.exports = { MaterialError };
