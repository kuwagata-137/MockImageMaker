#!/usr/bin/env node
// 会話の圧縮の段取りのフック（2026-10-13 ユーザー指示。CLAUDE.md の「コンテキストの圧縮の段取り」）。
//   node compact-plan.js pre  … PreCompact（圧縮の前）: いちばん新しいプランファイル（~/.claude/plans/*.md）の場所・行数・大きさ・ハッシュと、
//                               Git の状態（ブランチ・最後のコミット・まだコミットしていないファイル）を控える。圧縮は止めない
//   node compact-plan.js post … SessionStart の compact（圧縮の後）: 控えと今のプランを比べた結果と、プランを読み直して再開する手順を出す。
//                               SessionStart の stdout はモデルの文脈に入る（https://code.claude.com/docs/en/hooks#sessionstart）
// どちらも、うまくいかなくても圧縮と作業を止めないように、いつも終了コード 0 で終わる。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans');
const STATE_FILE = path.join(PLANS_DIR, '.compact-state.json');
const STALE_MIN = 30; // プランがこれより前から書き換えられていなければ、知らせる

function latestPlan() {
  try {
    return fs.readdirSync(PLANS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(PLANS_DIR, f))
      .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0].f;
  } catch (_) {
    return null;
  }
}

function planInfo(file) {
  try {
    const buf = fs.readFileSync(file);
    return {
      file,
      bytes: buf.length,
      lines: buf.toString('utf8').split('\n').length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      mtime: fs.statSync(file).mtime.toISOString(),
    };
  } catch (_) {
    return null;
  }
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (_) {
    return '';
  }
}

function gitState() {
  const changed = git(['status', '--short']).split('\n').map((l) => l.trim()).filter(Boolean);
  return { branch: git(['branch', '--show-current']), last: git(['log', '-1', '--format=%h %s']), changed };
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch (_) {
    return {};
  }
}

function pre() {
  const input = readStdin();
  const file = latestPlan();
  const state = { time: new Date().toISOString(), trigger: input.trigger || '', plan: file ? planInfo(file) : null, git: gitState() };
  fs.mkdirSync(PLANS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function post() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) { /* 控えがない（圧縮の前のフックが動かなかった） */ }
  const file = (saved && saved.plan && saved.plan.file) || latestPlan();
  const now = file ? planInfo(file) : null;
  const out = ['【圧縮の後の段取り（自動のフック）】会話が圧縮されました。開発を続ける前に、次のとおりにしてください（CLAUDE.md の「コンテキストの圧縮の段取り」）。'];
  if (!now) {
    out.push('1. プランファイルが見つかりません。CLAUDE.md・開発ロードマップ.txt・Git の記録（git log）から今の状態を確かめ、ユーザーに知らせてから続けてください。');
  } else {
    let check;
    if (saved && saved.plan) {
      const same = saved.plan.sha256 === now.sha256;
      check = same
        ? `圧縮の前に控えたもの（${saved.plan.lines} 行・${saved.plan.bytes} バイト）と同じ中身です（ハッシュが一致）`
        : `圧縮の前に控えたもの（${saved.plan.lines} 行・${saved.plan.bytes} バイト）と違います（今は ${now.lines} 行・${now.bytes} バイト）。圧縮の後に書き換えたのでなければ、ユーザーに知らせてください`;
    } else {
      check = `圧縮の前の控えがありません（今は ${now.lines} 行・${now.bytes} バイト）`;
    }
    out.push(`1. プランファイル ${now.file} を Read で全部読み、圧縮されていない（全文が残っている）ことを確かめる。ファイルの確かめ: ${check}。`);
    out.push('2. プランの「開発の進み具合」「次にやること」と Git の記録から、どこまで済んだかを確かめる（要約にある、プランに書いていない直近の作業も合わせる）。');
    out.push('3. プランの「進め方の約束」に従い、プランのとおりに開発を再開する（作業の説明は日本語で書く）。');
    const age = (Date.now() - Date.parse(now.mtime)) / 60000;
    if (age > STALE_MIN) out.push(`（このプランは約 ${Math.round(age)} 分前から書き換えられていません。最後に書いた後の作業は、要約と Git の記録で補ってください。）`);
  }
  const g = (saved && saved.git) || gitState();
  if (g.branch || g.last) {
    const changed = g.changed.length ? `まだコミットしていないファイル ${g.changed.length} つ（${g.changed.slice(0, 8).join('、')}${g.changed.length > 8 ? '、…' : ''}）` : 'まだコミットしていないファイルはなし';
    out.push(`圧縮の前の Git: ブランチ ${g.branch || '（不明）'}・最後のコミット ${g.last || '（不明）'}・${changed}。`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

try {
  if (process.argv[2] === 'pre') pre();
  else if (process.argv[2] === 'post') post();
} catch (e) {
  process.stderr.write('compact-plan.js: ' + ((e && e.message) || e) + '\n');
}
process.exit(0);
