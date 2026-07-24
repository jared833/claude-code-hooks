#!/usr/bin/env node
// PostToolUse hook (Write|Edit): remember which git repos this session has written to.
//
// Paired with uncommitted-check.mjs, which reads the list at Stop time and refuses to
// let the session end with that work sitting uncommitted on the machine.
//
// Why a list at all, rather than scanning every repo at Stop: most repos are dirty for
// reasons that have nothing to do with this session (a human mid-edit, another session,
// a pipeline). Blocking on those would train the agent to commit work it did not write
// and does not understand. Only what this session touched is its business.
//
// Never blocks, never fails loudly. A tracking miss costs a warning, not a tool call.

import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { relative } from 'node:path';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const DIR = join(tmpdir(), 'claude-uncommitted');
const TTL_MS = 24 * 60 * 60 * 1000;

const bail = () => process.exit(0);

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads
// below would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '');
if (!sessionId) bail();

const toolInput = input.tool_input || {};
// NotebookEdit reuses the Write|Edit matcher but carries notebook_path, not file_path.
const filePath = toolInput.file_path || toolInput.notebook_path;
// A shell command (Bash|PowerShell) has no file_path; fall back to its cwd so files it
// creates (cp, codegen, unzip, redirected output) still get recorded.
const shellCwd = (typeof filePath !== 'string' || !filePath) ? input.cwd : null;
if (!filePath && !shellCwd) bail();

// Walk up for the repo root. A worktree has .git as a file, not a directory, so test
// for existence rather than for a directory.
function repoRoot(start) {
  let dir = resolve(start);
  // file_path points at a file that may not exist yet on a Write; start from its parent.
  if (!existsSync(dir) || !statSync(dir).isDirectory()) dir = dirname(dir);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

let root;
try { root = repoRoot(shellCwd || filePath); } catch { bail(); }
// If cwd (or the file) is not inside a repo, record nothing. This keeps home-dir shell
// commands from over-recording every repo you happen to have anywhere.
if (!root) bail();

const listPath = join(DIR, sessionId + '.txt');

// One line per write: repo root, then the path relative to it. The Stop hook dedupes,
// so this appends unconditionally rather than reading the file back first. That also
// keeps the file's mtime moving, which the sweep below depends on to tell a long-running
// session apart from an abandoned one.
//
// ponytail: parallel same-session appends can interleave into one corrupted line
// (O_APPEND cross-process atomicity is not guaranteed on Windows). The Stop hook skips
// tab-less fragments, so a corrupt line silently drops one write. Known corner, left as
// is; a lock or per-write temp file would fix it if it ever bites.
try {
  mkdirSync(DIR, { recursive: true });
  // A shell command has no single file path, so it records a '*' sentinel meaning "report
  // every dirty file in this repo". Deliberately noisier than path-matching for shell-
  // touched repos, in exchange for never silently missing shell-built work.
  const rel = shellCwd ? '*' : relative(root, resolve(filePath)).split('\\').join('/');
  appendFileSync(listPath, root + '\t' + rel + '\n');
} catch { /* tracking is best effort */ }

// Sweep stale session lists so temp does not grow without bound.
// ponytail: sweeps by mtime, so a session idle longer than TTL_MS whose next write lands
// after another session's sweep gets its earlier entries deleted and the list rebuilt with
// only the late entry. Ceiling: lost early entries for very-long-idle sessions. Upgrade
// path: skip the current session's own file in the sweep, or retain by first-seen age.
try {
  const now = Date.now();
  for (const f of readdirSync(DIR)) {
    const p = join(DIR, f);
    if (now - statSync(p).mtimeMs > TTL_MS) rmSync(p, { force: true });
  }
} catch { /* sweep is optional */ }

process.exit(0);
