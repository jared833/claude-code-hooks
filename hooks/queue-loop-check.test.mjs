// Drives queue-loop-check.mjs against the failure it exists to catch: a producer run that
// drafts from a Notion content database and never marks the rows it used.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'queue-loop-check.mjs');
// Must match the hook's own directory.
const DIR = join(tmpdir(), 'claude-queue-loop');
// A fixture id, not a real data source. The hook reads this from CONTENT_QUEUE_ID.
const QUEUE = '00000000-1111-2222-3333-444444444444';

let n = 0, fails = 0;
const newSession = () => `qlc-test-${process.pid}-${++n}`;

function fire(payload, env = {}) {
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CONTENT_QUEUE_ID: QUEUE, ...env },
  });
  return { code: r.status, out: r.stderr || '' };
}

const readQueue = s => fire({
  hook_event_name: 'PostToolUse', session_id: s,
  tool_name: 'mcp__claude_ai_Notion__notion-query-data-sources',
  tool_input: { data: { data_source_urls: [`collection://${QUEUE}`], query: `SELECT * FROM "collection://${QUEUE}"` } },
});
const markRow = s => fire({
  hook_event_name: 'PostToolUse', session_id: s,
  tool_name: 'mcp__claude_ai_Notion__notion-update-page',
  tool_input: { page_id: 'abc', command: 'update_properties', properties: { 'Made on': ['LinkedIn'] } },
});
const queueToBuffer = s => fire({
  hook_event_name: 'PostToolUse', session_id: s,
  tool_name: 'mcp__claude_ai_Buffer__create_post', tool_input: { text: 'a post' },
});
const writeScripts = s => fire({
  hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Write',
  tool_input: { file_path: '/home/you/content/scripts/2026-07-27.md', content: 'x' },
});
const stop = (s, active) => fire({ hook_event_name: 'Stop', session_id: s, stop_hook_active: !!active });

function t(label, steps, want) {
  const s = newSession();
  for (const step of steps) step(s);
  const { code } = stop(s);
  const ok = code === want;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} (exit ${code}, want ${want})  ${label}`);
  rmSync(join(DIR, s + '.txt'), { force: true });
  return s;
}

rmSync(DIR, { recursive: true, force: true });

console.log('FIRES when the write-back is missing (want exit 2):');
t('posting producer: read the database, queued to Buffer, marked nothing', [readQueue, queueToBuffer], 2);
t('scripting producer: read the database, wrote the scripts file, marked nothing', [readQueue, writeScripts], 2);

console.log('STAYS QUIET otherwise (want exit 0):');
t('the loop closed properly: read, produced, marked', [readQueue, queueToBuffer, markRow], 0);
t('a mark that lands after the produce still closes the loop', [readQueue, queueToBuffer, markRow], 0);
t('vetting pass: read the database, wrote page bodies only, produced nothing', [readQueue], 0);
t('produced without ever reading the database', [queueToBuffer], 0);
t('a session that touched none of it', [], 0);
t('a Notion query against some OTHER data source', [
  s => fire({
    hook_event_name: 'PostToolUse', session_id: s,
    tool_name: 'mcp__claude_ai_Notion__notion-query-data-sources',
    tool_input: { data: { data_source_urls: ['collection://deadbeef-0000-0000-0000-000000000000'], query: 'SELECT 1' } },
  }),
  queueToBuffer,
], 0);
t('a Write somewhere unrelated is not a produce', [readQueue, s => fire({
  hook_event_name: 'PostToolUse', session_id: s, tool_name: 'Write',
  tool_input: { file_path: '/home/you/notes.md', content: 'x' },
})], 0);

// The env guard. An unset CONTENT_QUEUE_ID must make the hook a total no-op. Without the
// explicit check, `blob.includes('')` is true for every payload, so an unconfigured install
// would record a 'read' on every Notion call and fire on unrelated work.
console.log('UNCONFIGURED IS A NO-OP (want exit 0):');
{
  const s = newSession();
  const off = { CONTENT_QUEUE_ID: '' };
  fire({
    hook_event_name: 'PostToolUse', session_id: s,
    tool_name: 'mcp__claude_ai_Notion__notion-query-data-sources',
    tool_input: { data: { data_source_urls: ['collection://anything'], query: 'SELECT 1' } },
  }, off);
  fire({
    hook_event_name: 'PostToolUse', session_id: s,
    tool_name: 'mcp__claude_ai_Buffer__create_post', tool_input: { text: 'a post' },
  }, off);
  const r = fire({ hook_event_name: 'Stop', session_id: s }, off);
  const ok = r.code === 0;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} (exit ${r.code}, want 0)  no CONTENT_QUEUE_ID set, read+produce+stop stays silent`);
  rmSync(join(DIR, s + '.txt'), { force: true });
}

// An invalid regex in CONTENT_QUEUE_FILE_HINT must not throw. An earlier version built the
// RegExp at module scope above the CONTENT_QUEUE_ID guard, so a bad value dumped a stack trace
// on every matching tool call, and did it even for users who had configured nothing at all.
console.log('A BAD CONTENT_QUEUE_FILE_HINT NEVER THROWS (want exit 0, no stack trace):');
for (const [label, hint] of [
  ['unterminated group', 'scripts('],
  ['dangling quantifier', '*bad'],
  ['unclosed class', '[a-'],
]) {
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse', session_id: newSession(), tool_name: 'Write',
      tool_input: { file_path: '/home/you/content/scripts/x.md', content: 'x' },
    }),
    encoding: 'utf8',
    env: { ...process.env, CONTENT_QUEUE_ID: QUEUE, CONTENT_QUEUE_FILE_HINT: hint },
  });
  const clean = r.status === 0 && !/SyntaxError|Invalid regular expression/.test(r.stderr || '');
  if (!clean) fails++;
  console.log(`  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.status})  ${label}`);
}
// And with nothing configured at all, a bad hint still must not throw.
{
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: newSession(), tool_name: 'Write', tool_input: { file_path: 'x.md' } }),
    encoding: 'utf8',
    env: { ...process.env, CONTENT_QUEUE_ID: '', CONTENT_QUEUE_FILE_HINT: 'scripts(' },
  });
  const clean = r.status === 0 && !/SyntaxError/.test(r.stderr || '');
  if (!clean) fails++;
  console.log(`  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.status})  bad hint AND no queue id configured`);
}

// A session that touches task state typically writes a Tasks row Status before it finishes.
// notion-update-page carries no database id, so an earlier version of this hook keyed on the
// property name "Status" and went silent on the ordinary path. `Made on` existing only on the
// content database is what makes the name safe now. Verify that holds in your own workspace.
console.log('A TASKS DB WRITE MUST NOT SILENCE IT (want exit 2):');
for (const v of ['Done', 'In progress', 'Blocked', 'Todo', 'Recurring', 'Deferred']) {
  t(`session also set a Tasks row Status to "${v}"`, [readQueue, queueToBuffer, s => fire({
    hook_event_name: 'PostToolUse', session_id: s,
    tool_name: 'mcp__claude_ai_Notion__notion-update-page',
    tool_input: { page_id: 'task-row', command: 'update_properties', properties: { Status: v } },
  })], 2);
}
t('setting Stage alone is not a record of what shipped', [readQueue, queueToBuffer, s => fire({
  hook_event_name: 'PostToolUse', session_id: s,
  tool_name: 'mcp__claude_ai_Notion__notion-update-page',
  tool_input: { page_id: 'x', command: 'update_properties', properties: { Stage: 'Worked up' } },
})], 2);
t('appending a second platform to Made on closes the loop', [readQueue, queueToBuffer, s => fire({
  hook_event_name: 'PostToolUse', session_id: s,
  tool_name: 'mcp__claude_ai_Notion__notion-update-page',
  tool_input: { page_id: 'x', command: 'update_properties', properties: { 'Made on': ['LinkedIn', 'TikTok'] } },
})], 0);

console.log('FIRES ONCE:');
{
  const s = newSession();
  readQueue(s); queueToBuffer(s);
  const first = stop(s);
  // No stop_hook_active this time: the session kept working and stopped again. The firing
  // path has to clear its own file or the message's "fires once" promise is a lie.
  const again = stop(s);
  if (again.code !== 0) fails++;
  console.log(`  ${again.code === 0 ? 'PASS' : '**FAIL**'} a later Stop without stop_hook_active does not block again (${again.code})`);
  readQueue(s); queueToBuffer(s);
  const second = stop(s, true);
  const ok = first.code === 2 && second.code === 0;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} first Stop blocks (${first.code}), retry with stop_hook_active is let through (${second.code})`);
  const named = first.out.includes('Made on') && first.out.includes('notion-update-page')
    && first.out.includes('append');
  if (!named) fails++;
  console.log(`  ${named ? 'PASS' : '**FAIL**'} the message names the property, the tool, and that it must append`);
  rmSync(join(DIR, s + '.txt'), { force: true });
}

console.log('NEVER HARD-ERRORS:');
for (const [label, body] of [['malformed stdin', 'not json'], ['empty payload', '{}'], ['literal null payload', 'null']]) {
  const r = spawnSync(NODE, [HOOK], {
    input: body, encoding: 'utf8',
    env: { ...process.env, CONTENT_QUEUE_ID: QUEUE },
  });
  const clean = r.status === 0 && !(r.stderr || '').includes('TypeError');
  if (!clean) fails++;
  console.log(`  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.status})  ${label}, no stack trace`);
}

console.log(fails === 0 ? '\nALL PASS.' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
