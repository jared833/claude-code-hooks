#!/usr/bin/env node
// The check for the uncommitted-check.mjs fix. One thing is asserted: the hook blocks on the
// first Stop and stays quiet on the second, with stop_hook_active false BOTH times.
//
// That second call is the whole point. stop_hook_active is true only for the retry inside one
// stop cycle; it is false again on the next user turn, which is how this hook came to fire 47
// times in a single session while its own last line promised "This fires once."
//
// Run:  node uncommitted-check.test.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'uncommitted-check.mjs');
const DIR = join(tmpdir(), 'claude-uncommitted');
const sessionId = 'test-once-' + Date.now();
const listPath = join(DIR, sessionId + '.txt');

let repo;
const cleanup = () => {
  try { rmSync(listPath, { force: true }); } catch {}
  try { if (repo) rmSync(repo, { recursive: true, force: true }); } catch {}
};

function runHook() {
  const payload = JSON.stringify({ session_id: sessionId, stop_hook_active: false });
  const r = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '' };
}

function assert(cond, msg) {
  if (!cond) { cleanup(); console.error('FAIL: ' + msg); process.exit(1); }
  console.log('  ok  ' + msg);
}

// A throwaway repo holding one untracked file, standing in for work this session wrote.
repo = mkdtempSync(join(tmpdir(), 'uc-test-'));
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
writeFileSync(join(repo, 'thing.js'), 'export const x = 1;\n');

mkdirSync(DIR, { recursive: true });
writeFileSync(listPath, repo + '\tthing.js\n');

console.log('uncommitted-check.mjs: blocks once, then lets go');

const first = runHook();
assert(first.code === 2, 'first Stop blocks (exit 2), got ' + first.code);
assert(/thing\.js/.test(first.err), 'the block names the file the session wrote');

const second = runHook();
assert(second.code === 0, 'second Stop bails (exit 0), got ' + second.code);
assert(second.err.trim() === '', 'the second Stop says nothing');
assert(!existsSync(listPath), 'the session list was consumed by the block');

// And new work after the nudge is still caught, which is what keeps the fix from being a
// blanket mute: track-edits.mjs would recreate this file on the next write.
writeFileSync(listPath, repo + '\tthing.js\n');
const third = runHook();
assert(third.code === 2, 'work recorded AFTER the nudge blocks again, got ' + third.code);

cleanup();
console.log('\nPASS');
