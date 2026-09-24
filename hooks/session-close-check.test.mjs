// Drives session-close-check.mjs against the failure it exists to catch: a session that
// reshapes the system (a skill, a hook, settings, CLAUDE.md) and updates nothing that
// describes it. The 2026-07-26 case is the first test below.
//
// The MULTI-TURN and NOT DOCUMENTATION sections exist because an independent review found
// both holes in the first version: Stop runs every assistant turn, so it blocked six times in
// one session, and any stray markdown file switched it off completely.
//
// Sections run concurrently. Every call is a fresh node process (~55ms each, 182 of them), so
// run in sequence this took 11s and all of it was process startup. Each section keeps its own
// log and prints in file order once everything finishes; within a section, steps stay in order.
import { spawn } from 'node:child_process';
import { rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
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

function run(input, env) {
  return new Promise(res => {
    const c = spawn(NODE, [HOOK], { env });
    let err = '';
    c.stderr.setEncoding('utf8').on('data', d => { err += d; });
    c.stdout.resume();
    c.on('error', e => res({ code: null, out: String(e) }));
    c.on('close', code => res({ code, out: err }));
    c.stdin.on('error', () => {});
    c.stdin.end(input);
  });
}

const sections = [];
function section(title, body) {
  const log = [];
  // SCC_DOC_ROOTS points the stale-doc sweep at a fixture dir. Per section, not global: set
  // only in the sweep section, so every other section exercises the real doc roots exactly as
  // a session would, even while the sweep section runs alongside it.
  const ctx = { roots: '' };
  const fire = payload => {
    const env = { ...process.env };
    if (ctx.roots) env.SCC_DOC_ROOTS = ctx.roots; else delete env.SCC_DOC_ROOTS;
    return run(JSON.stringify(payload), env);
  };
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

  async function t(label, steps, want) {
    const s = newSession();
    for (const step of steps) await step(s);
    const { code, out } = await stop(s);
    const ok = code === want;
    if (!ok) fails++;
    log.push(`  ${ok ? 'PASS' : '**FAIL**'} (exit ${code}, want ${want})  ${label}`);
    return out;
  }
  const ck = (label, ok) => { if (!ok) fails++; log.push(`  ${ok ? 'PASS' : '**FAIL**'} ${label}`); };

  const done = Promise.resolve()
    .then(() => body({ ctx, fire, wrote, edited, shell, stop, t, ck, log }))
    .catch(e => { fails++; log.push(`  **FAIL** section threw: ${e && e.stack || e}`); });
  sections.push({ title, log, done });
}

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

section('FIRES when the system changed and nothing documented it (want exit 2):', async ({ t, wrote, edited }) => {
  await t('the real case: 3 skills + a hook rewritten, zero docs', [
    edited(SKILL),
    edited('C:\\Users\\dev\\.claude\\skills\\script-week\\SKILL.md'),
    wrote('C:\\Users\\dev\\.claude\\skills\\idea-check\\SKILL.md'),
    wrote(HOOK_FILE),
  ], 2);
  await t('a single hook edit is enough on its own', [edited(HOOK_FILE)], 2);
  await t('a settings.json edit is enough on its own', [edited(SETTINGS)], 2);
  await t('10 code files and no docs crosses the work threshold', [
    ...Array.from({ length: 10 }, (_, i) => wrote(CODE + i)),
  ], 2);
});

section('STAYS QUIET otherwise (want exit 0):', async ({ t, wrote, edited }) => {
  await t('skill changed AND a vault doc updated', [edited(SKILL), wrote(VAULT_DOC)], 0);
  await t('skill changed AND a memory written', [edited(SKILL), wrote(MEMORY)], 0);
  await t('skill changed AND home CLAUDE.md updated', [edited(SKILL), edited(HOME_MD)], 0);
  await t('skill changed AND a repo CLAUDE.md updated', [edited(SKILL), edited(REPO_MD)], 0);
  await t('skill changed AND a diagram updated', [edited(SKILL), edited(DIAGRAM)], 0);
  await t('9 code files is under the threshold, not a reshape', [
    ...Array.from({ length: 9 }, (_, i) => wrote(CODE + i)),
  ], 0);
  await t('a session that touched nothing', [], 0);
  await t('editing the same skill twice is one file, not two', [edited(SKILL), edited(SKILL), wrote(VAULT_DOC)], 0);
  await t('editing only ~/CLAUDE.md is already documented', [edited(HOME_MD)], 0);
});

// An independent review found this: `doc` was "any markdown outside ~/.claude", so a throwaway
// plan.md switched the whole check off. Documentation is a NAMED list now.
section('THESE ARE NOT DOCUMENTATION and must not buy silence (want exit 2):', async ({ t, wrote, edited }) => {
  for (const [label, path] of [
    ['a scratchpad plan.md', 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\C--Users-dev\\x\\scratchpad\\plan.md'],
    ['an ebook manuscript chapter', 'C:\\Users\\dev\\projects\\ebooks\\some-book\\src\\ch01.md'],
    ['a blog content post', 'C:\\Users\\dev\\projects\\blog\\src\\content\\posts\\2026-07-27.md'],
    ['a file on the Desktop', 'C:\\Users\\dev\\Desktop\\report.md'],
    ['a CHANGELOG', 'C:\\Users\\dev\\projects\\webapp\\CHANGELOG.md'],
    ['another SKILL.md', 'C:\\Users\\dev\\.claude\\skills\\clip-batch\\SKILL.md'],
    ['a hook test file', 'C:\\Users\\dev\\.claude\\hooks\\other-hook.test.mjs'],
  ]) await t(label + ' is not a description of a skill change', [edited(SKILL), wrote(path)], 2);
});

// Subagent probe scripts were landing on the parent session's tally, and the standing rule
// puts several review agents on every change.
section('SCRATCH WORK IS NOT WORK (want exit 0):', async ({ t, wrote }) => {
  await t('10 scratchpad files do not cross the work threshold', [
    ...Array.from({ length: 10 }, (_, i) => wrote(SCRATCH + i)),
  ], 0);
});

// Tonight's own vault updates went in through a heredoc. Missing them would fire on a session
// that did exactly the right thing.
section('A SHELL WRITE TO A DOC COUNTS (want exit 0):', async ({ t, edited, shell }) => {
  await t('cat >> into a vault memory file', [edited(SKILL), shell(`cat >> "${VAULT_DOC}" <<'EOF'\nnotes\nEOF`)], 0);
  await t('a redirect into a repo README', [edited(SKILL), shell('echo hi >> C:/Users/dev/projects/webapp/README.md')], 0);
  await t('a shell command naming no doc does not count', [edited(SKILL), shell('npm run build')], 2);
  // Found by an independent review of the stale-doc sweep. Reading a doc is not writing one, and
  // once relative paths started matching, `cat docs/design.md` silenced the whole check.
  await t('reading a doc is not writing one', [edited(SKILL), shell('cat docs/design.md')], 2);
  await t('grepping a doc is not writing one', [edited(SKILL), shell('grep -n foo docs/architecture.md')], 2);
  await t('a PowerShell Set-Content into a doc does count', [
    edited(SKILL), shell('Set-Content -Path C:/Users/dev/projects/webapp/docs/flow.md -Value x'),
  ], 0);
  await t('a shell command naming a scratchpad .md does not count', [
    edited(SKILL), shell('cat > C:/Users/dev/AppData/Local/Temp/claude/x/scratchpad/notes.md'),
  ], 2);
});

// THE defect the review caught. Stop runs at the end of every assistant TURN, not at session
// close, so an earlier version blocked six times in one session.
section('MULTI-TURN: fires at most once per session:', async ({ edited, stop, ck }) => {
  {
    const s = newSession();
    const codes = [];
    for (let turn = 0; turn < 6; turn++) {
      await edited(SKILL)(s);
      codes.push((await stop(s)).code);
      if (codes[codes.length - 1] === 2) await stop(s, true);  // the retry Claude Code sends
    }
    ck(`six turns editing a skill block exactly once (${codes.join(',')})`,
      codes.filter(c => c === 2).length === 1 && codes[0] === 2);
  }
  {
    const s = newSession();
    await edited(SKILL)(s);
    const first = (await stop(s)).code;
    const again = (await stop(s)).code;          // no stop_hook_active: the trap the old version set
    const retry = (await stop(s, true)).code;
    ck(`a later Stop does not block again (first ${first}, again ${again}, retry ${retry})`,
      first === 2 && again === 0 && retry === 0);
  }
  {
    // Having fired, it must stay quiet even as the session keeps changing skills.
    const s = newSession();
    await edited(SKILL)(s);
    const first = (await stop(s)).code;
    await edited(HOOK_FILE)(s); await edited(SETTINGS)(s);
    const later = (await stop(s)).code;
    ck(`more system edits after it fired stay quiet (${first} then ${later})`, first === 2 && later === 0);
  }
});

// A quiet Stop used to delete the record, so the threshold silently meant "in one turn".
section('THE COUNT SURVIVES A QUIET STOP:', async ({ wrote, stop, ck }) => {
  const s = newSession();
  for (let i = 0; i < 9; i++) await wrote(CODE + i)(s);
  const quiet = (await stop(s)).code;
  await wrote(CODE + 'last')(s);
  const fired = (await stop(s)).code;
  ck(`9 files quiet (${quiet}), then the 10th fires (${fired})`, quiet === 0 && fired === 2);
});

section('THE MESSAGE CARRIES THE STANDARD:', async ({ edited, stop, ck }) => {
  const s = newSession();
  await edited(SKILL)(s);
  const { out } = await stop(s);
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
});

// The 2026-07-28 miss. A session fixed a misconfigured API key env var on two hosting projects
// and DID write documentation, so `seen.doc.size > 0` let it finish. Four other live files still
// asserted the old broken state. Every test in this section fails against the version before
// that date. Sequential inside: it rewrites its fixture files between cases.
section('STALE DOC SWEEP: writing SOME docs is not writing the RIGHT ones:', async ({ ctx, fire, t, ck, wrote, edited, shell }) => {
  // Deliberately NOT inside DIR: the hook sweeps that directory by mtime and the test's own
  // cleanup only unlinks files, so a directory sitting in there would trip both.
  const FIX = join(tmpdir(), PREFIX + 'fixture');
  mkdirSync(join(FIX, 'backups'), { recursive: true });
  mkdirSync(join(FIX, 'memory', 'projects'), { recursive: true });
  writeFileSync(join(FIX, 'stale.md'), 'the site has no SERVICE_API_KEY set, so it 500s.');
  writeFileSync(join(FIX, 'alsostale.md'), 'Set SERVICE_API_KEY and bind RATE_LIMIT_KV.');
  writeFileSync(join(FIX, 'unrelated.md'), 'Notes about the publishing cadence.');
  // Frozen snapshots outnumbered live hits in the real sweep. If these show up the output is noise.
  writeFileSync(join(FIX, 'backups', 'old.md'), 'SERVICE_API_KEY is unset.');
  writeFileSync(join(FIX, 'todo-archive.md'), 'SERVICE_API_KEY was unset back then.');
  ctx.roots = FIX;

  try {
    const withKey = path => s => fire({
      hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Edit',
      tool_input: { file_path: path, old_string: 'x', new_string: 'env.SERVICE_API_KEY check' },
    });

    const out = await t('a hook change naming SERVICE_API_KEY, docs written, other docs still name it',
      [withKey(HOOK_FILE), wrote(VAULT_DOC)], 2);
    ck('lists the stale file', out.includes('stale.md'));
    ck('lists the second stale file', out.includes('alsostale.md'));
    ck('names which identifier matched', out.includes('SERVICE_API_KEY'));
    ck('does not list a file that never mentions it', !out.includes('unrelated.md'));
    ck('skips backups', !out.includes('old.md'));
    ck('skips anything named archive', !out.includes('todo-archive.md'));
    ck('says it is a grep and not a verdict', /not a verdict/.test(out));
    ck('credits the docs that WERE written', /Documentation written \(1\)/.test(out));
    ck('points at the list instead of re-asking for the grep', /1\. OPEN the files listed above/.test(out));

    await t('no identifier in what was written, so nothing to sweep for',
      [edited(HOOK_FILE), wrote(VAULT_DOC)], 0);
    await t('a deleted identifier still sweeps: other docs naming it are the stale ones', [
      s => fire({
        hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Edit',
        tool_input: { file_path: HOOK_FILE, old_string: 'SERVICE_API_KEY', new_string: 'nothing' },
      }),
      wrote(VAULT_DOC),
    ], 2);

    // A lowercase or single-word token would match half the notes and bury the real hits.
    const noisy = word => s => fire({
      hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Edit',
      tool_input: { file_path: HOOK_FILE, old_string: 'x', new_string: word },
    });
    writeFileSync(join(FIX, 'unrelated.md'), 'SELECT and POST and README and publishing cadence.');
    for (const word of ['SELECT', 'POST', 'README', 'publishing'])
      await t(`"${word}" is not an identifier and must not trigger a sweep`, [noisy(word), wrote(VAULT_DOC)], 0);

    // The pre-existing contract must survive: no docs at all still fires, sweep or no sweep.
    await t('no docs written at all still fires, as before', [withKey(HOOK_FILE)], 2);

    // Found by the sweep reporting the session's OWN vault append as unopened. `cat >> memory/...`
    // after a `cd` names the file relatively, so it never matched the absolute path from the walk.
    writeFileSync(join(FIX, 'memory', 'projects', 'content.md'), 'SERVICE_API_KEY notes');
    const relOut = await t('a relative shell path counts as documentation and is not reported back', [
      withKey(HOOK_FILE),
      shell(`cd /c/Users/dev/projects/notes-vault && cat >> memory/projects/content.md <<'EOF'\nx\nEOF`),
    ], 2);
    // Scoped to the stale block on purpose: the file also appears under "Documentation written",
    // which is correct and is what a naive whole-output check mistakes for a failure.
    const staleBlock = o => o.split('NOT opened this session')[1] || '';
    ck('the file the session appended to is not listed as stale', !staleBlock(relOut).includes('content.md'));
    ck('it is still credited as documentation written', relOut.includes('memory/projects/content.md'));
    ck('the genuinely untouched file still is stale', staleBlock(relOut).includes('stale.md'));

    // The other half of that fix: a bare filename must NOT blanket-exclude every file of that name.
    writeFileSync(join(FIX, 'CLAUDE.md'), 'SERVICE_API_KEY lives here too');
    const bareOut = await t('git add CLAUDE.md does not silence every CLAUDE.md on the machine',
      [withKey(HOOK_FILE), shell('git add CLAUDE.md')], 2);
    ck('a same-named file elsewhere is still reported', bareOut.includes('CLAUDE.md'));

    ctx.roots = '';
    await t('a clean session is unaffected when the sweep finds nothing', [edited(SKILL), wrote(VAULT_DOC)], 0);
  } finally {
    try { rmSync(FIX, { recursive: true, force: true }); } catch { /* fine */ }
  }
});

section('NEVER HARD-ERRORS:', async ({ log }) => {
  await Promise.all([
    ['malformed stdin', 'not json'],
    ['empty payload', '{}'],
    ['literal null payload', 'null'],
    ['a Write with no file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e1","tool_name":"Write","tool_input":{}}`],
    ['a numeric file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e2","tool_name":"Write","tool_input":{"file_path":42}}`],
    ['an array file_path', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e3","tool_name":"Write","tool_input":{"file_path":["a.md"]}}`],
    ['tool_input as a string', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e4","tool_name":"Write","tool_input":"x"}`],
    ['a Bash with no command', `{"hook_event_name":"PostToolUse","session_id":"${PREFIX}e5","tool_name":"Bash","tool_input":{}}`],
    ['a Stop with no session', '{"hook_event_name":"Stop"}'],
  ].map(async ([label, body], i) => {
    const r = await run(body, process.env);
    const clean = r.code === 0 && !r.out.includes('TypeError');
    if (!clean) fails++;
    log[i] = `  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.code})  ${label}, no stack trace`;
  }));
});

for (const s of sections) {
  await s.done;
  console.log(s.title);
  for (const line of s.log) console.log(line);
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
