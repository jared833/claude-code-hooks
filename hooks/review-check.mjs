#!/usr/bin/env node
// Stop hook: code does not ship on the say-so of the model that wrote it.
//
// Why: a model that misunderstood the requirement writes code expressing the
// misunderstanding, writes tests asserting the misunderstanding, runs them, and reports
// green. Nothing inside that loop can detect the error, because the belief that produced
// the bug also produced the check. Asking the same session to "review it carefully" is
// self-review wearing a costume: the belief is still in the context.
//
// The fix is to put the check somewhere the belief is not. A fresh agent, whose input is
// the diff and the requirement and nothing else.
//
// Mechanism: reads the session transcript, collects the code files written, and clears
// that list every time an Agent dispatch comes BACK. So a review counts only for the work
// that came before it, and edits made after a review need another one. Blocks once per
// session, with the file list and the prompt to paste, so a session can always end.
//
// It cannot dispatch the reviewer itself. A hook is a shell command, not a session, so it
// has no way to spawn an agent. What it can do is refuse to let the session finish until
// the session spawns one, which lands in the same place.
//
// Two known ceilings, both failing quiet rather than false, which is the right direction
// for a check that can block you:
//   - It sees Write, Edit and NotebookEdit. A file written by a shell command (`cat > x.js`,
//     `sed -i`, a codegen script) produces no tool_use block and is invisible here.
//   - It cannot tell a review dispatch from any other subagent, so a fan-out sent to search
//     a codebase satisfies it. Reading the dispatch prompt for intent would trade a known
//     limit for a guess at wording.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'claude-review-check');

const bail = () => process.exit(0);

// Extensions worth reviewing. Prose, config and data are excluded on purpose: this fires
// at the end of every turn, and blocking on a README edit is how a check gets tuned out.
const CODE = new Set([
  'js', 'mjs', 'cjs', 'mts', 'cts', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro',
  'py', 'ipynb', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'dart', 'lua',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1', 'sql', 'tf',
  'html', 'css', 'scss',
]);

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads
// below would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

// Already blocked this SESSION, not just this stop cycle. stop_hook_active alone is not
// enough: it resets on the next user turn, and "code written, no review since" stays true
// across a whole iterative build, so the check would fire on every turn of it. One block
// is a check, twenty is a trap. The session may have a reason not to review that the hook
// cannot evaluate, and a hook that never lets go strands it.
if (input.stop_hook_active) bail();

const transcript = input.transcript_path;
if (typeof transcript !== 'string' || !transcript) bail();

// The transcript path is per-session, so it stands in when session_id is missing. Without a
// fallback the marker was never written at all and the once-per-session promise quietly
// became once-per-turn, which is the failure this whole guard exists to prevent.
const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '')
  || createHash('sha1').update(transcript).digest('hex').slice(0, 16);
const firedPath = join(DIR, sessionId + '.fired');
if (existsSync(firedPath)) bail();

let lines;
// ponytail: reads the whole transcript at every Stop. Fine at the sizes seen so far (a
// long session is single-digit MB). If it ever drags, seek to the tail and stop at the
// first Agent dispatch instead of parsing from the top.
try { lines = readFileSync(transcript, 'utf8').split('\n'); } catch { bail(); }

// Code files not yet covered by a completed review.
const unreviewed = new Set();
// Agent dispatch id -> the files that were unreviewed at the moment it was sent. Cleared
// from `unreviewed` only when that agent's tool_result comes back. Dispatching is not
// reviewing: agents run in the background by default, so the tool_use block lands in the
// transcript the instant it is sent, and crediting that would let a session fire off a
// reviewer and finish in the same breath with nothing having been read.
const inFlight = new Map();

for (const line of lines) {
  if (!line) continue;
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }

  // `!entry` matters for the same reason the stdin read guards it: JSON.parse succeeds on
  // the literal `null`, and the property read below would throw a stack trace into the
  // session and abandon the rest of the scan, so every later write would go unchecked.
  //
  // Belt and braces. A subagent's own transcript lives in a separate directory, and no
  // live transcript on this machine has ever carried isSidechain true, so this has never
  // been observed to matter. It stays because the reviewer's own edits must never count
  // as the session's reviewed-by-nobody work if that ever changes.
  if (!entry || entry.isSidechain) continue;

  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) continue;

  for (const block of content) {
    if (!block) continue;

    // The review came back. Everything it was dispatched to cover is now covered.
    if (block.type === 'tool_result' && inFlight.has(block.tool_use_id)) {
      for (const f of inFlight.get(block.tool_use_id)) unreviewed.delete(f);
      inFlight.delete(block.tool_use_id);
      continue;
    }

    if (block.type !== 'tool_use') continue;

    // ponytail: any Agent dispatch counts, including one sent to search a codebase. Treating
    // an unrelated fan-out as a review is the known false negative. Reading the dispatch
    // prompt for review intent would close it, and would also start guessing at wording.
    if (block.name === 'Agent') { inFlight.set(block.id, new Set(unreviewed)); continue; }

    if (block.name !== 'Write' && block.name !== 'Edit' && block.name !== 'NotebookEdit') continue;
    const inp = block.input || {};
    const path = inp.file_path || inp.notebook_path;
    if (typeof path !== 'string' || !path) continue;
    const ext = path.split('.').pop().toLowerCase();
    if (CODE.has(ext)) unreviewed.add(path.split('\\').join('/'));
  }
}

if (!unreviewed.size) bail();

// Mark before blocking. Everything past this point must be unable to fire again, however
// many more times the session stops. If the marker cannot be written, say nothing rather
// than risk nagging every turn forever.
try {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(firedPath, String(Date.now()));
} catch { bail(); }

// Sweep old markers so temp does not grow without bound. A week is far longer than any
// session, so this can never un-fire one that still matters.
try {
  const now = Date.now();
  for (const f of readdirSync(DIR)) {
    const p = join(DIR, f);
    if (now - statSync(p).mtimeMs > 7 * 24 * 60 * 60 * 1000) rmSync(p, { force: true });
  }
} catch { /* sweep is optional */ }

const files = [...unreviewed];
const out = [];
out.push('Independent review check. Code was written this session and no fresh agent has looked at it.');
out.push('');
out.push(`Unreviewed (${files.length}):`);
for (const f of files.slice(0, 25)) out.push(`  ${f}`);
if (files.length > 25) out.push(`  ... and ${files.length - 25} more`);
out.push('');
out.push('Do not review it yourself. You wrote it, so you would be checking the code against');
out.push('the same belief that produced it. Dispatch a fresh agent whose context is only this:');
out.push('');
out.push('  You are reviewing a change you did not write. You have no context on why it was');
out.push('  built this way, which is the point. Inputs: the diff, the project conventions');
out.push('  file, and the requirement this change was supposed to satisfy in one paragraph.');
out.push('');
out.push('  1. CORRECTNESS. Trace one real input all the way through by hand. Name the');
out.push('     specific input that breaks it, or say what you tried and could not break.');
out.push('     Do NOT read the change\'s own test file until you have formed your own view');
out.push('     of what the code should produce. Then ask whether those tests would pass if');
out.push('     the code were wrong in the way you were worried about.');
out.push('  2. SECURITY. Untrusted input reaching a sink, secrets in the diff or in what it');
out.push('     logs, auth checks the new path skips. State the reachable path.');
out.push('  3. SIMPLIFICATION. What here should not exist? Reimplemented standard library,');
out.push('     an abstraction with one caller, error handling for an impossible condition.');
out.push('  4. CONVENTIONS. What the diff violates, and docs it made wrong.');
out.push('');
out.push('  Output findings with file:line, severity, and a concrete fix. If a section is');
out.push('  clean, say so and say what you checked.');
out.push('');
out.push('Every finding is fixed or answered in writing before this ships.');
out.push('');
out.push('This fires once. Finishing without a review is allowed, but then say in your reply');
out.push('that the code went out unreviewed, so it is a decision on the record.');

process.stderr.write(out.join('\n') + '\n');
process.exit(2);
