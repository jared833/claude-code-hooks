#!/usr/bin/env node
// Stop hook: logic code does not ship into a project that already has tests without adding
// any this session.
//
// Why: the honest version of "did TDD happen" cannot be answered by reading the model's own
// account of it, for the same reason review-check.mjs does not trust self-review. A model
// that skipped tests can also write a paragraph saying it followed RED -> GREEN -> REFACTOR,
// and nothing downstream can tell the difference. The pattern shows up in more than one
// agent-harness framework: a TDD skill where the agent authors its own "evidence report"
// markdown file that no hook ever reads, which is the model grading its own homework.
//
// The fix here is smaller and machine-checkable instead: for each project a source file was
// edited in this session, was a test file in that SAME project also touched this session. Not
// "does the test pass", not "was it written before the code" -- just "did the session touch
// the test suite at all when one exists". That is a fact about tool calls, not a claim in prose.
//
// Scope is deliberately narrow. A project with zero test files anywhere is left alone: nothing
// here knows whether tests apply to it (a static site, a one-off script, a data file), and
// firing there is exactly how a check gets tuned out (review-check.mjs carries the same
// reasoning for excluding prose). Once a project has ANY test file on disk, that project has
// already decided tests apply to it, and this holds it to its own standard.
//
// Known ceilings, all failing quiet, surfaced by the independent review this shipped with:
//   - Touching a test file is not the same as writing a real assertion into it. This proves a
//     session opened the test suite, not that it tested the right thing. Same shape of ceiling
//     as review-check.mjs accepting any Agent dispatch as a review. Any test file anywhere in
//     the project root clears it, not just one related to the change.
//   - It sees Write, Edit and NotebookEdit. A file written by a shell command is invisible here.
//   - projectRoot() stops at the nearest ancestor with a marker file. In a monorepo where only
//     the repo root carries one and individual packages don't, editing a never-tested package
//     scopes to the whole monorepo: it inherits a sibling package's tests as its own convention,
//     and touching any test anywhere in the monorepo satisfies it. Not fixed here because the
//     setup this came from is one standalone project per repo, and a heuristic for a shape of
//     repo you do not have is exactly the speculative code this house style argues against.
//     Revisit if your layout is a monorepo.
//   - hasTestFiles() stops after 6000 visited entries. A repo with a very large non-code payload
//     ahead of a deep tests/ directory in scan order could exhaust that budget first and read as
//     test-free. DIRS_TO_SKIP now excludes the common built-output folders that would cause this
//     (public, dist, .astro, etc); a repo that still hits the cap fails toward not blocking.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';

const DIR = join(tmpdir(), 'claude-tdd-gate');

const bail = () => process.exit(0);

// Kill switch. Stolen from ECC's ECC_HOOK_PROFILE / ECC_DISABLED_HOOKS pattern: one env var to
// turn a hook off for a messy session instead of editing settings.json.
if (process.env.TDD_GATE_DISABLE) bail();

// Languages this checks. Markup, config and notebooks are excluded on purpose -- same
// tuned-out-check risk as review-check.mjs's CODE set, narrowed further because "should this
// have a test" is a much easier false-positive to hit than "should this be reviewed".
const TESTABLE = new Set([
  'js', 'mjs', 'cjs', 'mts', 'cts', 'jsx', 'ts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'dart',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1',
]);

const DIRS_TO_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'vendor',
  '__pycache__', 'venv', '.venv', 'target', '.cache', 'coverage',
  'public', '_site', '.astro', '.output', '.svelte-kit',
]);

const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'];

function isTestPath(path) {
  const norm = path.split('\\').join('/');
  const base = norm.split('/').pop();
  if (/\.(test|spec)\.[^./]+$/i.test(base)) return true;
  if (/^test_.+\.py$/i.test(base)) return true;
  if (/_test\.(go|py|rb)$/i.test(base)) return true;
  if (/(^|\/)(__tests__|tests|spec)\//i.test(norm)) return true;
  return false;
}

// Nearest ancestor carrying a project marker. Falls back to the file's own directory (a
// single-folder scope) rather than climbing to something like the home directory, which would
// turn "does this project have tests" into "does anything on the machine have tests".
function projectRoot(filePath) {
  let dir = dirname(filePath.split('\\').join('/'));
  for (let i = 0; i < 15; i++) {
    for (const m of MARKERS) {
      if (existsSync(join(dir, m))) return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirname(filePath.split('\\').join('/'));
}

// Bounded breadth-first walk, short-circuits on the first test file found. Capped by node
// count, not a timer, so the result is deterministic run to run.
function hasTestFiles(root) {
  const queue = [root];
  let visited = 0;
  while (queue.length && visited < 6000) {
    const dir = queue.shift();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      visited++;
      if (visited >= 6000) break;
      if (e.isDirectory()) {
        if (!DIRS_TO_SKIP.has(e.name)) queue.push(join(dir, e.name));
        continue;
      }
      if (isTestPath(e.name)) return true;
    }
  }
  return false;
}

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

if (input.stop_hook_active) bail();

const transcript = input.transcript_path;
if (typeof transcript !== 'string' || !transcript) bail();

const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '')
  || createHash('sha1').update(transcript).digest('hex').slice(0, 16);
const firedPath = join(DIR, sessionId + '.fired');
if (existsSync(firedPath)) bail();

let lines;
try { lines = readFileSync(transcript, 'utf8').split('\n'); } catch { bail(); }

// project root -> { source: Set<path>, testTouched: bool }
const projects = new Map();

for (const line of lines) {
  if (!line) continue;
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  if (!entry || entry.isSidechain) continue;

  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) continue;

  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue;
    if (block.name !== 'Write' && block.name !== 'Edit' && block.name !== 'NotebookEdit') continue;
    const inp = block.input || {};
    const path = inp.file_path || inp.notebook_path;
    if (typeof path !== 'string' || !path) continue;

    const ext = path.split('.').pop().toLowerCase();
    const test = isTestPath(path);
    if (!test && !TESTABLE.has(ext)) continue;

    const root = projectRoot(path);
    let p = projects.get(root);
    if (!p) { p = { source: new Set(), testTouched: false }; projects.set(root, p); }
    if (test) p.testTouched = true;
    else p.source.add(path.split('\\').join('/'));
  }
}

// Only projects with source edits, no test touched this session, AND tests already exist on
// disk (proving the project has decided tests apply to it) are worth flagging.
const flagged = [];
for (const [root, p] of projects) {
  if (!p.source.size || p.testTouched) continue;
  if (!hasTestFiles(root)) continue;
  flagged.push({ root, files: [...p.source] });
}

if (!flagged.length) bail();

try {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(firedPath, String(Date.now()));
} catch { bail(); }

try {
  const now = Date.now();
  for (const f of readdirSync(DIR)) {
    const p = join(DIR, f);
    if (now - statSync(p).mtimeMs > 7 * 24 * 60 * 60 * 1000) rmSync(p, { force: true });
  }
} catch { /* sweep is optional */ }

const out = [];
out.push('TDD gate. This project already has tests. Logic code changed here this session and');
out.push('no test file in the same project was touched.');
out.push('');
for (const { root, files } of flagged) {
  out.push(`${root}`);
  for (const f of files.slice(0, 15)) out.push(`  ${f}`);
  if (files.length > 15) out.push(`  ... and ${files.length - 15} more`);
}
out.push('');
out.push('Write or update the test for this change before finishing. If the change has no');
out.push('behavior to test (a comment, a rename, a config value), say so in the reply instead');
out.push('of touching a test file just to clear this.');
out.push('');
out.push('Set TDD_GATE_DISABLE=1 for a session where none of this applies.');
out.push('');
out.push('This fires once. Finishing without a test is allowed, but then say in your reply');
out.push('that the change shipped untested, so it is a decision on the record.');

process.stderr.write(out.join('\n') + '\n');
process.exit(2);
