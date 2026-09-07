#!/usr/bin/env node
// track-edits.mjs must not arm the Stop nudge for a shell command that cannot write.
// The allowlist is deliberately conservative, so the important half of this test is the
// NEGATIVE cases: anything unrecognised, redirecting, or substituting still records.

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'track-edits.mjs');
const DIR = join(tmpdir(), 'claude-uncommitted');

const repo = mkdtempSync(join(tmpdir(), 'te-test-'));
execFileSync('git', ['init', '-q'], { cwd: repo });

let n = 0, bad = 0;
function run(command) {
  const sessionId = 'test-te-' + Date.now() + '-' + (n++);
  const listPath = join(DIR, sessionId + '.txt');
  try { rmSync(listPath, { force: true }); } catch {}
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: sessionId, cwd: repo, tool_input: { command } }),
    encoding: 'utf8',
  });
  const recorded = existsSync(listPath) && readFileSync(listPath, 'utf8').includes(repo);
  try { rmSync(listPath, { force: true }); } catch {}
  return recorded;
}

function check(command, shouldRecord) {
  const got = run(command);
  const ok = got === shouldRecord;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${shouldRecord ? 'records' : 'skips  '}  ${command}`);
}

console.log('track-edits.mjs: read-only shell commands do not arm the nudge');

// Skipped. These are exactly what re-armed the nudge on 2026-09-07.
check('git status -sb', false);
check('git -C . diff', false);
check('git fetch --quiet', false);
check('cd /tmp && grep -n foo bar.js', false);
check('cat a.js | head -20', false);
check('ls -la; pwd', false);

// Recorded. A miss here is lost work, which is the failure that matters.
check('npm run build', true);
check('git commit -m x', true);
check('git config user.name x', true);
check('cp a b', true);
check('echo hi > out.txt', true);          // redirection
check('cat `sh -c "touch x"`', true);      // backtick substitution
check('ls $(python evil.py)', true);       // $( ) substitution
check('git status && npm ci', true);       // one writer in the chain
check('sed -i s/a/b/ f.js', true);         // writes with no redirect
check('python build.py', true);

// The six holes a cold review found in the first version of the allowlist, all of which
// returned "read-only" for a command that writes. Each one silently dropped real work.
check(['ls', 'npm run build'].join(String.fromCharCode(10)), true); // newline was not a separator
check('ls & npm run build', true);           // bare & was not a separator
check('find . -name "*.tmp" -delete', true); // find writes
check('sort -o out.txt in.txt', true);       // sort -o overwrites
check('uniq in.txt out.txt', true);          // uniq overwrites its 2nd positional
check('diff <(sh -c "touch x") b', true);    // process substitution
check('git diff --output=leak.txt', true);   // the one git global that escapes .git

// A real file write still records, allowlist or not.
const sid = 'test-te-file-' + Date.now();
const lp = join(DIR, sid + '.txt');
spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ session_id: sid, tool_input: { file_path: join(repo, 'x.js') } }),
  encoding: 'utf8',
});
const fileOk = existsSync(lp) && readFileSync(lp, 'utf8').includes('x.js');
if (!fileOk) bad++;
console.log(`  ${fileOk ? 'ok  ' : 'FAIL'} a Write still records its path`);
try { rmSync(lp, { force: true }); } catch {}

rmSync(repo, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nPASS');
process.exit(bad ? 1 : 0);
