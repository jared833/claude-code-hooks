// Drives session-close-check.mjs against the failure it exists to catch: a session that
// reshapes the system (a skill, a hook, settings, CLAUDE.md) and updates nothing that
// describes it. The 2026-07-26 case is the first test below.
//
// The MULTI-TURN and NOT DOCUMENTATION sections exist because an independent review found
// both holes in the first version: Stop runs every assistant turn, so it blocked six times in
// one session, and any stray markdown file switched it off completely.
import { spawnSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'session-close-check.mjs');
// Must match the hook's own directory. LIVE SESSIONS USE THIS TOO: never wipe it wholesale.
// The first version of this file did, and deleted the record of every session running at the
// time. Clean up only ids carrying this prefix.
const DIR = join(tmpdir(), 'claude-session-close');
const PREFIX = `scc-test-${process.pid}-`;

let n = 0, fails = 0;
const newSession = () => PREFIX + ++n;

function fire(payload) {
  const r = spawnSync(NODE, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: r.stderr || '' };
}

const wrote = path => s => fire({
  hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Write',
  tool_input: { file_path: path, content: 'x' },
});
const edited = path => s => fire({
  hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Edit',
  tool_input: { file_path: path, old_string: 'a', new_string: 'b' },
});
const shell = cmd => s => fire({
  hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Bash',
  tool_input: { command: cmd },
});
const stop = (s, active) => fire({ hook_event_name: 'Stop', session_id: s, stop_hook_active: !!active });

function t(label, steps, want) {
  const s = newSession();
  for (const step of steps) step(s);
  const { code, out } = stop(s);
  const ok = code === want;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} (exit ${code}, want ${want})  ${label}`);
  return out;
}
const ck = (label, ok) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : '**FAIL**'} ${label}`); };

// Paths as Claude Code actually passes them on this machine: Windows separators, mixed case.
const SKILL = 'C:\\Users\\dev\\.claude\\skills\\weekly-report\\SKILL.md';
const HOOK_FILE = 'C:\\Users\\dev\\.claude\\hooks\\other-hook.mjs';
const SETTINGS = 'C:\\Users\\dev\\.claude\\settings.json';
const HOME_MD = 'C:\\Users\\dev\\CLAUDE.md';
const REPO_MD = 'C:\\Users\\dev\\projects\\mysite\\CLAUDE.md';
const VAULT_DOC = 'C:\\Users\\dev\\projects\\notes-vault\\memory\\projects\\content.md';
const MEMORY = 'C:\\Users\\dev\\.claude\\projects\\C--Users-dev\\memory\\project-notes.md';
const DIAGRAM = 'C:\\Users\\dev\\projects\\webapp\\docs\\flow.mmd';
const CODE = 'C:\\Users\\dev\\projects\\webapp\\src\\pages\\api\\session.ts';
const SCRATCH = 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\C--Users-dev\\abc\\scratchpad\\probe.mjs';

console.log('FIRES when the system changed and nothing documented it (want exit 2):');
t('the real case: 3 skills + a hook rewritten, zero docs', [
  edited(SKILL),
  edited('C:\\Users\\dev\\.claude\\skills\\script-week\\SKILL.md'),
  wrote('C:\\Users\\dev\\.claude\\skills\\idea-check\\SKILL.md'),
  wrote(HOOK_FILE),
], 2);
t('a single hook edit is enough on its own', [edited(HOOK_FILE)], 2);
t('a settings.json edit is enough on its own', [edited(SETTINGS)], 2);
t('10 code files and no docs crosses the work threshold', [
  ...Array.from({ length: 10 }, (_, i) => wrote(CODE + i)),
], 2);

console.log('STAYS QUIET otherwise (want exit 0):');
t('skill changed AND a vault doc updated', [edited(SKILL), wrote(VAULT_DOC)], 0);
t('skill changed AND a memory written', [edited(SKILL), wrote(MEMORY)], 0);
t('skill changed AND home CLAUDE.md updated', [edited(SKILL), edited(HOME_MD)], 0);
t('skill changed AND a repo CLAUDE.md updated', [edited(SKILL), edited(REPO_MD)], 0);
t('skill changed AND a diagram updated', [edited(SKILL), edited(DIAGRAM)], 0);
t('9 code files is under the threshold, not a reshape', [
  ...Array.from({ length: 9 }, (_, i) => wrote(CODE + i)),
], 0);
t('a session that touched nothing', [], 0);
t('editing the same skill twice is one file, not two', [edited(SKILL), edited(SKILL), wrote(VAULT_DOC)], 0);
t('editing only ~/CLAUDE.md is already documented', [edited(HOME_MD)], 0);

// An independent review found this: `doc` was "any markdown outside ~/.claude", so a throwaway
// plan.md switched the whole check off. Documentation is a NAMED list now.
console.log('THESE ARE NOT DOCUMENTATION and must not buy silence (want exit 2):');
for (const [label, path] of [
  ['a scratchpad plan.md', 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\C--Users-dev\\x\\scratchpad\\plan.md'],
  ['an ebook manuscript chapter', 'C:\\Users\\dev\\projects\\ebooks\\some-book\\src\\ch01.md'],
  ['a blog content post', 'C:\\Users\\dev\\projects\\blog\\src\\content\\posts\\2026-07-27.md'],
  ['a file on the Desktop', 'C:\\Users\\dev\\Desktop\\report.md'],
  ['a CHANGELOG', 'C:\\Users\\dev\\projects\\webapp\\CHANGELOG.md'],
  ['another SKILL.md', 'C:\\Users\\dev\\.claude\\skills\\clip-batch\\SKILL.md'],
  ['a hook test file', 'C:\\Users\\dev\\.claude\\hooks\\other-hook.test.mjs'],
]) t(label + ' is not a description of a skill change', [edited(SKILL), wrote(path)], 2);

// Subagent probe scripts were landing on the parent session's tally, and the standing rule
// puts several review agents on every change.
console.log('SCRATCH WORK IS NOT WORK (want exit 0):');
t('10 scratchpad files do not cross the work threshold', [
  ...Array.from({ length: 10 }, (_, i) => wrote(SCRATCH + i)),
], 0);

// Tonight's own vault updates went in through a heredoc. Missing them would fire on a session
// that did exactly the right thing.
console.log('A SHELL WRITE TO A DOC COUNTS (want exit 0):');
t('cat >> into a vault memory file', [edited(SKILL), shell(`cat >> "${VAULT_DOC}" <<'EOF'\nnotes\nEOF`)], 0);
t('a redirect into a repo README', [edited(SKILL), shell('echo hi >> C:/Users/dev/projects/webapp/README.md')], 0);
t('a shell command naming no doc does not count', [edited(SKILL), shell('npm run build')], 2);
t('a shell command naming a scratchpad .md does not count', [
  edited(SKILL), shell('cat > C:/Users/dev/AppData/Local/Temp/claude/x/scratchpad/notes.md'),
], 2);

// THE defect the review caught. Stop runs at the end of every assistant TURN, not at session
// close, so an earlier version blocked six times in one session.
console.log('MULTI-TURN: fires at most once per session:');
{
  const s = newSession();
  const codes = [];
  for (let turn = 0; turn < 6; turn++) {
    edited(SKILL)(s);
    codes.push(stop(s).code);
    if (codes[codes.length - 1] === 2) stop(s, true);  // the retry Claude Code sends
  }
  ck(`six turns editing a skill block exactly once (${codes.join(',')})`,
    codes.filter(c => c === 2).length === 1 && codes[0] === 2);
}
{
  const s = newSession();
  edited(SKILL)(s);
  const first = stop(s).code;
  const again = stop(s).code;          // no stop_hook_active: the trap the old version set
  const retry = stop(s, true).code;
  ck(`a later Stop does not block again (first ${first}, again ${again}, retry ${retry})`,
    first === 2 && again === 0 && retry === 0);
}
{
  // Having fired, it must stay quiet even as the session keeps changing skills.
  const s = newSession();
  edited(SKILL)(s);
  const first = stop(s).code;
  edited(HOOK_FILE)(s); edited(SETTINGS)(s);
  ck(`more system edits after it fired stay quiet (${first} then ${stop(s).code})`, first === 2);
}

// A quiet Stop used to delete the record, so the threshold silently meant "in one turn".
console.log('THE COUNT SURVIVES A QUIET STOP:');
{
  const s = newSession();
  for (let i = 0; i < 9; i++) wrote(CODE + i)(s);
  const quiet = stop(s).code;
  wrote(CODE + 'last')(s);
  ck(`9 files quiet (${quiet}), then the 10th fires (${stop(s).code})`, quiet === 0);
}

console.log('THE MESSAGE CARRIES THE STANDARD:');
{
  const s = newSession();
  edited(SKILL)(s);
  const { out } = stop(s);
  for (const [label, ok] of [
    ['names a task tracker to file into', /task tracker/.test(out)],
    ['requires dependencies in the task body', /DEPENDENCIES/.test(out)],
    ['requires an Effort estimate', /Effort/.test(out)],
    ['says diagrams count', /[Dd]iagram/.test(out)],
    ['tells a mid-build session it can carry on', /too early to write this up/.test(out)],
    ['warns it will not fire again', /not fire again/.test(out)],
    ['offers the escape hatch before the checklist', out.indexOf('no follow-ups') < out.indexOf('1. FIND')],
    ['reports that zero docs were written', /Documentation written: none/.test(out)],
    ['lists the file it saw change', out.includes('SKILL.md')],
  ]) ck(label, ok);
}

console.log('NEVER HARD-ERRORS:');
for (const [label, body] of [
  ['malformed stdin', 'not json'],
  ['empty payload', '{}'],
  ['literal null payload', 'null'],
  ['a Write with no file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e1","tool_name":"Write","tool_input":{}}`],
  ['a numeric file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e2","tool_name":"Write","tool_input":{"file_path":42}}`],
  ['an array file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e3","tool_name":"Write","tool_input":{"file_path":["a.md"]}}`],
  ['tool_input as a string', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e4","tool_name":"Write","tool_input":"x"}`],
  ['a Bash with no command', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e5","tool_name":"Bash","tool_input":{}}`],
  ['a Stop with no session', '{"hook_event_name":"Stop"}'],
]) {
  const r = spawnSync(NODE, [HOOK], { input: body, encoding: 'utf8' });
  const clean = r.status === 0 && !(r.stderr || '').includes('TypeError');
  if (!clean) fails++;
  console.log(`  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.status})  ${label}, no stack trace`);
}

// Only this run's own files. Other sessions are live in here.
let swept = 0;
try {
  for (const f of readdirSync(DIR)) {
    if (f.startsWith(PREFIX)) { rmSync(join(DIR, f), { force: true }); swept++; }
  }
} catch { /* directory may not exist */ }
console.log(`\nswept ${swept} of this run's own files, left every other session alone.`);

console.log(fails === 0 ? 'ALL PASS.' : `${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
