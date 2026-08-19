#!/usr/bin/env node
// PostToolUse recorder + Stop check: a producer that builds from a Notion content database
// has to record what it made, or the same idea gets made twice with nothing to say so.
//
// Why: 2026-07-26, the database held 12 captured ideas and nothing downstream read it. The
// weekly producers harvested git activity, banked footage and an evergreen story bank
// instead. Ideas went in and never came out. The fix was to point the producers at it. That
// fix has one moving part that can silently rot: the write-back.
//
// The database is a MENU, not a queue. It never drains, an unused idea is never rejected, and
// several versions of one idea are deliberate. So the only thing worth recording is `Made on`:
// which platforms an idea has actually shipped to.
//
// Fires only on the exact shape of the failure: this session READ the database, it PRODUCED
// something (queued a post to Buffer, or wrote a script file), and it recorded no `Made on`.
// A vetting pass that reads the same rows and writes only Stage and page bodies produces
// nothing by this definition and is never flagged.
//
// One file, two roles, keyed off hook_event_name. Blocks once, never twice.
//
// Configure with CONTENT_QUEUE_ID, the Notion data source id of your content database.
// Unset means this hook does nothing at all, which is the safe direction.

import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'claude-queue-loop');
const TTL_MS = 24 * 60 * 60 * 1000;

// If the database is ever rebuilt this id changes and the hook goes quiet rather than firing
// wrongly, which is the safe direction: the producer skills name the same id, so they break
// loudly first.
const QUEUE_ID = (process.env.CONTENT_QUEUE_ID || '').trim();

const bail = () => process.exit(0);

// Nothing configured, nothing to check. Without this guard an empty id would make
// `blob.includes('')` true on every payload and the hook would fire on unrelated work.
if (!QUEUE_ID) bail();

// The file path fragment a producer writes when it ships a script rather than a post.
// Built AFTER the guard above and wrapped, both deliberate: an invalid regex in the env var
// throws, and an uncaught throw here would dump a stack trace into the transcript on every
// matching tool call. Above the guard it did that even for users who never configured this
// hook at all, which made the header's "unset means this does nothing" claim false.
let PRODUCED_FILE_RE;
try {
  PRODUCED_FILE_RE = new RegExp(process.env.CONTENT_QUEUE_FILE_HINT || 'scripts', 'i');
} catch { bail(); }

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads below
// would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '');
if (!sessionId) bail();
const listPath = join(DIR, sessionId + '.txt');

const event = String(input.hook_event_name || '');
// Treat anything that is not an explicit Stop as a recording pass. A missing event name on
// a PostToolUse payload would otherwise silently record nothing and the check never fires.
if (event === 'Stop' || event === 'SubagentStop') check(); else record();

function record() {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  let blob = '';
  try { blob = JSON.stringify(ti); } catch { blob = ''; }

  const marks = [];

  // Read: a query or fetch naming the content collection.
  if (/notion.*(query|fetch)/i.test(tool) && blob.includes(QUEUE_ID)) marks.push('read');

  // Write-back: a page update that appends to `Made on`.
  //
  // `notion-update-page` carries only a page_id, so nothing in the payload says which database
  // the page belongs to. An earlier version keyed on the property name `Status`, which a Tasks
  // database also has, and the house rules tell every session that touches task state to write
  // a task Status before it finishes. That routine write would have silenced this check on the
  // ordinary path.
  //
  // `Made on` exists on the content database and nowhere else in the workspace, so the
  // property name is now unambiguous on its own and no value matching is needed. Check that
  // this holds in your workspace before trusting it.
  if (/notion.*update.page/i.test(tool) && /"Made on"/.test(blob)) marks.push('marked');

  // Produced: the two things a producer does at the end of a run. Buffer is the posting
  // producer's exit, the scripts file is the scripting producer's.
  if (/Buffer__create_post/i.test(tool)) marks.push('produced');
  const fp = String(ti.file_path || ti.notebook_path || '');
  if (fp && PRODUCED_FILE_RE.test(fp)) marks.push('produced');

  if (!marks.length) bail();

  try {
    mkdirSync(DIR, { recursive: true });
    // Sweep stale session files. Cheap, and nothing else ever cleans this directory.
    const now = Date.now();
    for (const f of readdirSync(DIR)) {
      const p = join(DIR, f);
      try { if (now - statSync(p).mtimeMs > TTL_MS) rmSync(p, { force: true }); } catch { /* fine */ }
    }
    appendFileSync(listPath, marks.join('\n') + '\n');
  } catch { /* a tracking miss costs a warning, never a tool call */ }
  bail();
}

function check() {
  // Already nudged once this stop cycle. One reminder is a reminder, two is a trap.
  if (input.stop_hook_active) bail();
  if (!existsSync(listPath)) bail();

  let marks;
  try { marks = new Set(readFileSync(listPath, 'utf8').split('\n').filter(Boolean)); } catch { bail(); }

  if (!marks.has('read') || !marks.has('produced') || marks.has('marked')) {
    // Nothing to say. Clear the file so a later session id collision cannot inherit it.
    try { rmSync(listPath, { force: true }); } catch { /* fine */ }
    bail();
  }

  // Clear the file before blocking. Without this, a session that keeps working after the
  // nudge and stops again with stop_hook_active false gets the identical block a second
  // time, which the last line of this message promises will not happen.
  try { rmSync(listPath, { force: true }); } catch { /* fine */ }

  process.stderr.write([
    'Content database write-back missing.',
    '',
    'Built from none of the entries this session? Say so in your reply and finish.',
    'Reading the database and then building the batch out of something else is a legal run,',
    'and this hook cannot tell the two apart.',
    '',
    'Otherwise: this session read the content database and produced content, but recorded',
    'nothing on any row. Nothing then knows that idea has been made on that platform, so a',
    'later run can make it again without either of you noticing.',
    '',
    'For every row this session built a post from AND that actually reached Buffer or',
    'the scripts file, append the platform to that row\'s "Made on".',
    '',
    'mcp__claude_ai_Notion__notion-update-page, command update_properties,',
    'page_id from the row url, properties {"Made on": ["LinkedIn", ...]}.',
    '',
    'It is a multi select: READ the current value and append to it. Overwriting erases the',
    'record of a video or newsletter made from the same idea.',
    '',
    'Write nothing for a row that was skipped on the review page. The database does not drain',
    'and an idea that went unused is not rejected.',
    '',
    'This fires once.',
  ].join('\n') + '\n');
  process.exit(2);
}
