// Drives review-check.mjs against the failure it exists to catch: a session that writes
// code and finishes on its own say-so. Each case builds a fake transcript, fires a Stop,
// and asserts blocked (exit 2) or clean (exit 0).
//
// Four of the cases below exist because an independent review proved the suite green
// against a broken hook. Each is marked with the mutation it now catches, because a test
// whose label promises coverage it does not deliver is worse than a missing test: it is
// the same self-confirming loop this hook was written to break.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'review-check.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'review-check-test-'));
// Must match the hook's own directory. LIVE SESSIONS USE THIS TOO: never wipe it wholesale,
// only ids carrying this run's prefix.
const FIRED = join(tmpdir(), 'claude-review-check');
const PREFIX = `rc-test-${process.pid}-`;

let n = 0, fails = 0;
const newSession = () => PREFIX + ++n;

function ck(label, ok) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${label}`);
}

// A payload with no session_id keys its marker on a hash of the transcript path. Anything
// that fires one has to clean up after itself or it litters the shared directory.
function sweepFallback(path) {
  try {
    const h = createHash('sha1').update(path).digest('hex').slice(0, 16);
    rmSync(join(FIRED, h + '.fired'), { force: true });
  } catch { /* fine */ }
}

// Paths as Claude Code actually passes them on this machine: Windows separators, mixed case.
const WIN = 'C:\\Users\\Jared\\projects\\engage\\src\\api.js';

// Transcript entry helpers. Only the fields the hook reads.
const use = (name, input, id) => ({ message: { content: [{ type: 'tool_use', name, input, id }] } });
const wrote = path => use('Write', { file_path: path, content: 'x' });
const edited = path => use('Edit', { file_path: path, old_string: 'a', new_string: 'b' });
const noted = path => use('NotebookEdit', { notebook_path: path, new_source: 'import os' });
// A dispatch on its own is NOT a review. Agents run in the background, so the pair is what
// counts: `dispatched(id)` sends it, `returned(id)` is the reviewer coming back.
const dispatched = (id = 'a1') => use('Agent', { prompt: 'review this' }, id);
const returned = (id = 'a1') => ({ message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
const agent = (id = 'a1') => [dispatched(id), returned(id)];
const said = text => ({ message: { content: [{ type: 'text', text }] } });

function fire(entries, extra = {}) {
  const path = join(DIR, `t${++n}.jsonl`);
  writeFileSync(path, entries.flat().map(e => JSON.stringify(e)).join('\n') + '\n');
  const payload = { hook_event_name: 'Stop', session_id: newSession(), transcript_path: path, ...extra };
  const r = spawnSync(NODE, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: r.stderr || '' };
}

function t(label, entries, want, extra) {
  const r = fire(entries, extra);
  ck(`(exit ${r.code}, wanted ${want})  ${label}`, (want === 'block') === (r.code === 2));
}

console.log('\nBLOCKS:');
t('code written, no agent ever dispatched', [wrote('src/auth.js')], 'block');
t('a Windows path is still code', [wrote(WIN)], 'block');
t('code edited after the only review', [wrote('a.py'), agent(), edited('b.py')], 'block');
t('a review, then more code, then a second review, then more code',
  [wrote('a.go'), agent('a1'), wrote('b.go'), agent('a2'), wrote('c.go')], 'block');
t('a notebook, which is nothing but code', [noted('analysis.ipynb')], 'block');
// Catches: dropping the lowercase fold on the extension. Has to be a BLOCK case. As a
// clean case it passes either way, since a file the hook stops recognising as code is
// exactly what "nothing left to review" looks like.
t('an uppercase extension is still code', [wrote('LEGACY.PY')], 'block');
// The one a background dispatch would slip through: the reviewer was sent but has not
// answered, so nothing has actually been read yet.
t('agent dispatched but never came back', [wrote('a.js'), dispatched()], 'block');
t('a second file written while the reviewer is still out',
  [wrote('a.js'), dispatched(), wrote('b.js'), returned()], 'block');
// Catches: crediting ANY tool_result to an in-flight dispatch instead of matching the id.
// A session that sends a background agent and then reads one file would finish unblocked
// with nothing reviewed. The old version of this case paired a dispatch with its OWN
// result, so it was a duplicate of "code written, then reviewed" wearing another label.
t('a tool_result from some other tool is not the review coming back',
  [wrote('a.js'), dispatched('a1'), returned('read-42')], 'block');

console.log('\nCLEAN:');
t('nothing written at all', [said('hello')], 'clean');
t('code written, then reviewed', [wrote('src/auth.js'), agent()], 'clean');
t('every write reviewed after the fact', [wrote('a.TS'), edited('b.ts'), agent()], 'clean');
t('prose only, no code', [wrote('README.md'), wrote('notes.txt'), wrote('data.json')], 'clean');
t('already blocked once this stop cycle', [wrote('a.js')], 'clean', { stop_hook_active: true });
t('a subagent\'s own edits do not count as the session\'s',
  [{ isSidechain: true, ...wrote('a.js') }], 'clean');

// Stop fires at the end of EVERY assistant turn, and "code written, no review" stays true
// across a whole iterative build. Blocking once is a check, blocking twenty times is a trap.
console.log('\nONCE PER SESSION, not once per turn:');
{
  const path = join(DIR, 'multi.jsonl');
  writeFileSync(path, JSON.stringify(wrote('a.js')) + '\n');
  const s = newSession();
  const turn = () => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: s, transcript_path: path }),
    encoding: 'utf8',
  }).status;
  const codes = [turn(), turn(), turn()];
  ck(`three turns, same session, exits ${codes.join(',')} (want 2,0,0)`,
    codes[0] === 2 && codes[1] === 0 && codes[2] === 0);

  const other = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: newSession(), transcript_path: path }),
    encoding: 'utf8',
  }).status;
  ck(`a DIFFERENT session still blocks (exit ${other})`, other === 2);
}

// Catches: writing the marker BEFORE the "nothing to report" bail. Most turns end with
// nothing written, so a hook that spent its one block on a quiet turn would disarm itself
// for the rest of the session, silently, on the most common turn shape there is.
{
  const path = join(DIR, 'later.jsonl');
  const s = newSession();
  const turn = () => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: s, transcript_path: path }),
    encoding: 'utf8',
  }).status;
  writeFileSync(path, JSON.stringify(said('just talking')) + '\n');
  const quiet = turn();
  writeFileSync(path, JSON.stringify(said('just talking')) + '\n' + JSON.stringify(wrote('a.js')) + '\n');
  const later = turn();
  ck(`a quiet turn does not spend the one block (${quiet} then ${later}, want 0,2)`,
    quiet === 0 && later === 2);
}

console.log('\nOUTPUT:');
{
  const r = fire([wrote('src/auth.js'), edited('src/db.py')]);
  ck('names both files', r.out.includes('src/auth.js') && r.out.includes('src/db.py'));
  ck('says not to self-review', /Do not review it yourself/.test(r.out));
  ck('carries the reviewer prompt', /CORRECTNESS/.test(r.out) && /SECURITY/.test(r.out));
  ck('says it fires once', /fires once/.test(r.out));
}
// Catches: dropping the separator normalisation, which would list one file twice.
{
  const r = fire([wrote(WIN), wrote('C:/Users/Jared/projects/engage/src/api.js')]);
  ck('the same file in both separator styles counts once', /Unreviewed \(1\)/.test(r.out));
}
{
  const many = Array.from({ length: 30 }, (_, i) => wrote(`f${i}.js`));
  const r = fire(many);
  ck('a long list is truncated and says how many it hid', /and 5 more/.test(r.out));
}

console.log('\nMALFORMED INPUT, never a stack trace:');
for (const [label, body] of [
  ['empty stdin', ''],
  ['not JSON', 'nonsense'],
  ['literal null payload', 'null'],
  ['no transcript_path', '{"hook_event_name":"Stop","session_id":"s"}'],
  ['transcript_path that does not exist', '{"hook_event_name":"Stop","transcript_path":"/nope/nope.jsonl"}'],
  ['numeric transcript_path', '{"hook_event_name":"Stop","transcript_path":42}'],
]) {
  const r = spawnSync(NODE, [HOOK], { input: body, encoding: 'utf8' });
  ck(`(exit ${r.status})  ${label}`, r.status === 0 && !(r.stderr || '').includes('TypeError'));
}

// A transcript with junk lines mixed in still finds the real writes.
{
  const path = join(DIR, 'junk.jsonl');
  // A bare `null` line is the one that used to throw: JSON.parse accepts it, and the
  // property read on the result then abandoned the whole scan mid-file.
  writeFileSync(path, ['not json', 'null', JSON.stringify(wrote('a.js')), '', '{"message":null}', '{"message":{"content":"str"}}'].join('\n'));
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: path }), encoding: 'utf8',
  });
  ck(`(exit ${r.status})  junk lines skipped, real write still caught`,
    r.status === 2 && r.stderr.includes('a.js') && !r.stderr.includes('TypeError'));
  sweepFallback(path);
}

// A payload with no session_id still gets the once-per-session promise, keyed off the
// transcript path. Without that fallback no marker was written and it fired every turn.
{
  const path = join(DIR, 'nosession.jsonl');
  writeFileSync(path, JSON.stringify(wrote('a.js')) + '\n');
  const turn = () => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: path }), encoding: 'utf8',
  }).status;
  const codes = [turn(), turn(), turn()];
  ck(`no session_id, three turns, exits ${codes.join(',')} (want 2,0,0)`,
    codes[0] === 2 && codes[1] === 0 && codes[2] === 0);
  sweepFallback(path);
}

rmSync(DIR, { recursive: true, force: true });
// Only this run's own markers. Other sessions are live in here.
let swept = 0;
try {
  for (const f of readdirSync(FIRED)) {
    if (f.startsWith(PREFIX)) { rmSync(join(FIRED, f), { force: true }); swept++; }
  }
} catch { /* directory may not exist */ }
console.log(`\nswept ${swept} of this run's own markers, left every other session alone.`);
console.log(fails === 0 ? 'ALL PASS.' : `${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
