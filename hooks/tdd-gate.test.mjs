// Drives tdd-gate.mjs against the failure it exists to catch: logic code changes in a project
// that already has tests, with none touched this session. Each case builds a real temp
// directory (the hook walks the filesystem, unlike review-check.mjs which only reads the
// transcript) plus a fake transcript, fires a Stop, and asserts blocked (exit 2) or clean.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'tdd-gate.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'tdd-gate-test-'));
// Must match the hook's own directory. LIVE SESSIONS USE THIS TOO: never wipe it wholesale.
const FIRED = join(tmpdir(), 'claude-tdd-gate');
const PREFIX = `tg-test-${process.pid}-`;

let n = 0, fails = 0;
const newSession = () => PREFIX + ++n;

function ck(label, ok) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${label}`);
}

// A project with a marker file and, optionally, an existing test file already on disk.
function project(name, { hasTests, gitMarker = true } = {}) {
  const root = join(DIR, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  if (gitMarker) mkdirSync(join(root, '.git'), { recursive: true });
  if (hasTests) writeFileSync(join(root, 'src', 'existing.test.js'), '// old test');
  return root;
}

const use = (name, input) => ({ message: { content: [{ type: 'tool_use', name, input }] } });
const wrote = path => use('Write', { file_path: path, content: 'x' });
const edited = path => use('Edit', { file_path: path, old_string: 'a', new_string: 'b' });

function fire(root, entries, extra = {}) {
  const path = join(DIR, `t${++n}.jsonl`);
  writeFileSync(path, entries.flat().map(e => JSON.stringify(e)).join('\n') + '\n');
  const payload = { hook_event_name: 'Stop', session_id: newSession(), transcript_path: path, ...extra };
  const r = spawnSync(NODE, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: r.stderr || '', transcriptPath: path };
}

function t(label, root, entries, want, extra) {
  const r = fire(root, entries, extra);
  ck(`(exit ${r.code}, wanted ${want})  ${label}`, (want === 'block') === (r.code === 2));
  return r;
}

console.log('\nBLOCKS:');
{
  const root = project('has-tests-a', { hasTests: true });
  t('logic file added, project has tests, no test touched this session', root,
    [wrote(join(root, 'src', 'feature.js'))], 'block');
}
{
  const root = project('has-tests-b', { hasTests: true });
  t('edit instead of write still counts', root,
    [edited(join(root, 'src', 'feature.py'))], 'block');
}

console.log('\nCLEAN:');
{
  const root = project('no-tests', { hasTests: false });
  t('project has never had a test file -- not this hook\'s problem', root,
    [wrote(join(root, 'src', 'feature.js'))], 'clean');
}
{
  const root = project('has-tests-c', { hasTests: true });
  t('a test file was touched in the same session', root,
    [wrote(join(root, 'src', 'feature.js')), wrote(join(root, 'src', 'feature.test.js'))], 'clean');
}
{
  const root = project('has-tests-d', { hasTests: true });
  t('python test_ prefix convention recognised as the test touch', root,
    [wrote(join(root, 'src', 'calc.py')), wrote(join(root, 'src', 'test_calc.py'))], 'clean');
}
{
  const root = project('markup-only', { hasTests: true });
  t('only markup/config changed, nothing testable', root,
    [wrote(join(root, 'README.md')), wrote(join(root, 'config.json'))], 'clean');
}
t('nothing written at all', DIR, [{ message: { content: [{ type: 'text', text: 'hello' }] } }], 'clean');
{
  const root = project('already-fired', { hasTests: true });
  t('already blocked once this stop cycle', root,
    [wrote(join(root, 'src', 'feature.js'))], 'clean', { stop_hook_active: true });
}
{
  const root = project('sidechain', { hasTests: true });
  t('a subagent\'s own edits do not count', root,
    [{ isSidechain: true, ...wrote(join(root, 'src', 'feature.js')) }], 'clean');
}

console.log('\nKILL SWITCH:');
{
  const root = project('kill-switch', { hasTests: true });
  const path = join(DIR, `t${++n}.jsonl`);
  writeFileSync(path, JSON.stringify(wrote(join(root, 'src', 'feature.js'))) + '\n');
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: newSession(), transcript_path: path }),
    encoding: 'utf8',
    env: { ...process.env, TDD_GATE_DISABLE: '1' },
  });
  ck(`(exit ${r.status})  TDD_GATE_DISABLE short-circuits before any fs walk`, r.status === 0);
}

console.log('\nONCE PER SESSION, not once per turn:');
{
  const root = project('multi', { hasTests: true });
  const path = join(DIR, 'multi.jsonl');
  writeFileSync(path, JSON.stringify(wrote(join(root, 'src', 'feature.js'))) + '\n');
  const s = newSession();
  const turn = () => spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: s, transcript_path: path }),
    encoding: 'utf8',
  }).status;
  const codes = [turn(), turn(), turn()];
  ck(`three turns, same session, exits ${codes.join(',')} (want 2,0,0)`,
    codes[0] === 2 && codes[1] === 0 && codes[2] === 0);
}

console.log('\nOUTPUT:');
{
  const root = project('output', { hasTests: true });
  const r = fire(root, [wrote(join(root, 'src', 'feature.js'))]);
  ck('names the file', r.out.includes('feature.js'));
  ck('names the project root', r.out.includes(root.split('\\').join('/')) || r.out.includes(root));
  ck('mentions the kill switch', /TDD_GATE_DISABLE/.test(r.out));
  ck('says it fires once', /fires once/.test(r.out));
}

console.log('\nMALFORMED INPUT, never a stack trace:');
for (const [label, body] of [
  ['empty stdin', ''],
  ['not JSON', 'nonsense'],
  ['literal null payload', 'null'],
  ['no transcript_path', '{"hook_event_name":"Stop","session_id":"s"}'],
  ['transcript_path that does not exist', '{"hook_event_name":"Stop","transcript_path":"/nope/nope.jsonl"}'],
]) {
  const r = spawnSync(NODE, [HOOK], { input: body, encoding: 'utf8' });
  ck(`(exit ${r.status})  ${label}`, r.status === 0 && !(r.stderr || '').includes('TypeError'));
}

rmSync(DIR, { recursive: true, force: true });
let swept = 0;
try {
  for (const f of readdirSync(FIRED)) {
    if (f.startsWith(PREFIX)) { rmSync(join(FIRED, f), { force: true }); swept++; }
  }
} catch { /* directory may not exist */ }
console.log(`\nswept ${swept} of this run's own markers, left every other session alone.`);
console.log(fails === 0 ? 'ALL PASS.' : `${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
