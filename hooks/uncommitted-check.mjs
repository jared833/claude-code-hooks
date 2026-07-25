#!/usr/bin/env node
// Stop hook: a session does not end with its own work uncommitted.
//
// Why: an audit once found finished, deployed work living only on one machine. One repo
// tracked a handful of files while the live site had far more: whole pages, a form and the
// function behind it, and the vendor libs the site needs to run had all been built,
// deployed, and never committed. Several other repos were in the same state. A dead drive
// that week would have taken back weeks of finished work.
//
// Root cause was not carelessness in any one session. Nothing in any instruction file
// ever said to commit, sessions run from the home directory rather than from a repo, so
// no single repo feels like "the" repo, and the only existing git rule (deploy-recheck)
// frames untracked files as a publishing hazard to route around rather than as work to
// save. Every session did its job and left the work on the floor.
//
// Mechanism: uses the repo list that track-edits.mjs recorded for this session, so it
// only ever asks about repos this session actually wrote to. Blocks once, with the file
// list and the exact commands. Never blocks twice, so a session can always finish.

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const DIR = join(tmpdir(), 'claude-uncommitted');

const bail = () => process.exit(0);

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads
// below would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

// Already nudged once this stop cycle. One reminder is a reminder, two is a trap: a repo
// can be dirty for reasons the agent cannot resolve (a gitignored artifact, a conflict,
// a file a human is editing), and a hook that never lets go would strand the session.
if (input.stop_hook_active) bail();

const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '');
if (!sessionId) bail();

const listPath = join(DIR, sessionId + '.txt');
if (!existsSync(listPath)) bail();

// repo root -> the set of paths this session wrote inside it.
const touched = new Map();
try {
  for (const line of readFileSync(listPath, 'utf8').split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const root = line.slice(0, tab);
    if (!touched.has(root)) touched.set(root, new Set());
    touched.get(root).add(line.slice(tab + 1));
  }
} catch { bail(); }
if (!touched.size) bail();

function git(root, args) {
  // core.quotePath=false: non-ASCII names come back unescaped so they match the stored
  // paths in the isMine filter (default C-quoting like "\303\251tude.txt" never matches).
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    maxBuffer: 64 * 1024 * 1024  // 1 MB default silently drops repos with large untracked trees
  });
}

const findings = [];

for (const [root, mine] of touched) {
  if (!existsSync(root)) continue;

  let dirty = [];
  try {
    dirty = git(root, ['status', '--porcelain', '--untracked-files=all'])
      .split('\n').filter(Boolean)
      .map(l => ({ code: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
  } catch { continue; }

  // Report only the files this session actually wrote. A repo is dirty for all kinds of
  // reasons that are none of this session's business: a human editing, a pipeline, another
  // session running right now. Nagging about those trains the agent to commit work it did
  // not write and does not understand, and to tune the whole check out as noise.
  //
  // Untracked directories are the one case needing care: git reports `foo/` as a single
  // entry, so a file written at foo/bar/baz.txt has to match by prefix.
  // A '*' sentinel (recorded by a shell command, which has no single file path) means
  // "report every dirty file in this repo", since we cannot know which files the shell touched.
  const reportAll = mine.has('*');
  const isMine = d => reportAll || mine.has(d.path)
    || (d.path.endsWith('/') && [...mine].some(m => m.startsWith(d.path)));
  dirty = dirty.filter(isMine);

  // Unpushed commits stay repo-level: a commit is not attributable to a file list, and a
  // commit this session made is exactly the thing most likely to be forgotten.
  //
  // No fetch. This runs at the end of every session and has to stay fast and work offline.
  // The tradeoff is that a stale remote-tracking ref can over-report commits that were in
  // fact already pushed. That direction is harmless: it prompts a push that turns into a
  // no-op. Under-reporting would be the dangerous direction and this cannot do it.
  let unpushed = 0;
  let branch = '';
  let noUpstream = false;
  try {
    branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch { /* not on a branch. Dirty files still count. */ }
  if (branch && branch !== 'HEAD') {
    try {
      unpushed = parseInt(git(root, ['rev-list', '--count', '@{u}..HEAD']).trim(), 10) || 0;
    } catch {
      // No upstream configured, so a commit here still leaves the work on this machine.
      // Worth saying, but only as a note attached to work that is already being flagged.
      // On its own it would fire on every session forever with nothing to act on, and
      // some repos are deliberately left with no upstream (a deliberate choice, not a miss).
      noUpstream = true;
    }
  }

  if (dirty.length || unpushed) {
    findings.push({ root, dirty, unpushed, branch, noUpstream });
  }
}

if (!findings.length) {
  try { rmSync(listPath, { force: true }); } catch { /* fine */ }
  bail();
}

const lines = [];
lines.push('Uncommitted work check. Files THIS session wrote that are not saved anywhere but here.');
lines.push('Other dirty files in these repos are filtered out, so everything below is yours.');
lines.push('');

for (const f of findings) {
  const name = basename(f.root);
  lines.push(`${name}  (${f.root})`);
  if (f.unpushed) lines.push(`  ${f.unpushed} commit${f.unpushed === 1 ? '' : 's'} on ${f.branch} not pushed`);
  if (f.noUpstream) lines.push(`  No upstream on ${f.branch}. Committing here still leaves it on this machine only.`);
  const untracked = f.dirty.filter(d => d.code === '??');
  const modified = f.dirty.filter(d => d.code !== '??');
  if (modified.length) {
    lines.push(`  Modified (${modified.length}):`);
    for (const d of modified.slice(0, 25)) lines.push(`    ${d.code} ${d.path}`);
    if (modified.length > 25) lines.push(`    ... and ${modified.length - 25} more`);
  }
  if (untracked.length) {
    lines.push(`  Untracked (${untracked.length}), these exist ONLY on this machine:`);
    for (const d of untracked.slice(0, 25)) lines.push(`    ?? ${d.path}`);
    if (untracked.length > 25) lines.push(`    ... and ${untracked.length - 25} more`);
  }
  lines.push('');
}

lines.push('Decide per repo, then finish:');
lines.push('  - Work you did this session, finished or not? Commit and push it.');
lines.push('      git -C <repo> add -A && git -C <repo> commit -m "..." && git -C <repo> push');
lines.push('    A push may reject because a pipeline pushed to that remote first.');
lines.push('    Pull with --rebase and push again. Do not force.');
lines.push('  - Generated output or a local artifact? Add it to .gitignore, then commit that.');
lines.push('  - Not yours, and you cannot account for it? Say so in your reply and leave it.');
lines.push('    Do not commit changes you did not make and do not understand.');
lines.push('');
lines.push('Scan the diff for secrets before you commit. Never commit a token or a key.');
lines.push('');
lines.push('This fires once. Finishing without acting is allowed, but then say in your reply');
lines.push('what you left uncommitted and why, so it is a decision on the record.');

process.stderr.write(lines.join('\n') + '\n');
process.exit(2);
