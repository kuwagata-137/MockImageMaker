#!/usr/bin/env node
// PreToolUse(Bash) ガード: main ブランチへの直接 push のみをブロックする。
// 運用ルール（CLAUDE.md「運用」/ メモリ git-workflow-pr-per-version）:
//   直接 main へ push しない。feature ブランチ→PR→マージで取り込む。
//
// 誤爆対策の方針:
//   - コマンドを区切り(&& || ; | 改行)でセグメント分割し、各セグメントの「先頭トークンが git」かつ
//     「git のサブコマンドが push」のものだけを“本物の push”とみなす。
//   - したがって `echo "git push origin main"` / `git commit -m "push main"` / `git log | grep push`
//     のように push が文字列・別サブコマンドとして現れるだけのものはブロックしない。
//   - main を明示する push、または現在ブランチが main での無印 push のみブロック。
//   - --tags / --delete のみの push（ブランチ更新を伴わない）は誤爆回避のため許可。
//   - feature ブランチへの push、判定不能時は常に許可（安全側＝通すのは push 先 main のときだけ止める）。
const fs = require('fs');
const cp = require('child_process');

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (e) {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch (e) { allow(); }

const cmd = (data.tool_input && data.tool_input.command) || '';
const cwd = data.cwd || process.cwd();

// 高速パス: git も push も含まないコマンドは即許可
if (!/\bgit\b/.test(cmd) || !/\bpush\b/.test(cmd)) allow();

const REASON = '【運用ルール】直接 main へ push しません。feature ブランチを切り、PR → マージでバージョン単位の履歴を残します（CLAUDE.md「運用（Git ワークフロー）」/ メモリ git-workflow-pr-per-version）。feature ブランチへの push は許可されています。main を更新したい場合はユーザーに確認してください。';

const GLOBAL_FLAGS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const PUSH_FLAGS_WITH_VALUE = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);

function isMainRef(r) {
  return /(^|:|\/|\+)main$/.test(r) || /^\+?main:/.test(r) || /:main$/.test(r);
}

// 区切りでセグメント化（クォート内も割れるが、先頭トークン=git 判定で実害は出にくい）
const segments = cmd.split(/&&|\|\||[;|\n]/);

for (const seg of segments) {
  const toks = seg.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) continue;

  // 先頭の環境変数代入(VAR=...)を読み飛ばす
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  if (toks[i] !== 'git') continue;   // git で始まらないセグメントは対象外
  i++;

  // git のサブコマンドを特定（グローバルフラグを読み飛ばす）
  let sub = null;
  while (i < toks.length) {
    const t = toks[i];
    if (t.startsWith('-')) {
      if (GLOBAL_FLAGS_WITH_VALUE.has(t)) i++;   // 値トークンも飛ばす
      i++;
      continue;
    }
    sub = t; break;
  }
  if (sub !== 'push') continue;      // push 以外（log/commit/...）は対象外

  // push 以降の引数から remote / refspec を抽出
  const rest = toks.slice(i + 1);
  const nonFlag = [];
  let tagsOrDelete = false;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith('-')) {
      if (t === '--tags' || t === '--delete' || t === '-d') tagsOrDelete = true;
      if (PUSH_FLAGS_WITH_VALUE.has(t)) j++;   // 値トークンを飛ばす
      continue;
    }
    nonFlag.push(t);
  }
  const refspecs = nonFlag.slice(1);   // [0]=remote, 以降=refspec

  if (refspecs.some(isMainRef)) deny(REASON);             // main を明示する push
  if (refspecs.length === 0 && !tagsOrDelete) {           // ブランチ未指定＝現在ブランチを push
    let br = '';
    try { br = cp.execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim(); } catch (e) {}
    if (br === 'main') deny(REASON);
  }
  // この push は main 宛てではない → 他セグメントの確認を続行
}

allow();
