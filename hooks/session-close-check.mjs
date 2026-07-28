#!/usr/bin/env node
// PostToolUse recorder + Stop check: a session that changes how the system behaves does not
// end without updating what describes it, and does not end with its follow-ups only in chat.
//
// Why: 2026-07-26. A session rewired a database that drove a recurring content pipeline,
// changed its schema, rewrote three skills, added a hook, and called it done. The next day a
// documentation sweep found EIGHT live files still describing the old model, including
// ~/CLAUDE.md, which loads into every session on this machine. So every future session was
// being told the wrong thing by the very files meant to keep it right. Two of the stale lines
// were not merely old, they were wrong numbers a session would have planned against.
//
// Nothing was careless. Each session documented the thing it was looking at. What no session
// did was ask "what ELSE describes what I just changed", because nothing ever asked.
//
// What this can and cannot do, stated plainly so nobody mistakes it for a verifier:
//   CAN see  - files written through Write/Edit/NotebookEdit, and markdown paths named in a
//              Bash or PowerShell command (a heredoc into a vault file is a real doc write and
//              missing it would make this fire on a session that DID document its work).
//   CAN see  - SCREAMING_SNAKE identifiers in what the session wrote, and every live doc that
//              names one of them without the session ever opening it. Added 2026-07-28: see
//              the MAX_IDS comment for the case where writing SOME docs let a session finish
//              with four other files still asserting the state it had just changed.
//   CANNOT   - see a shell write whose path it cannot spot in the command text.
//   CANNOT   - know whether a candidate file is actually stale. A dated log entry describing
//              what WAS true is correct and must stay. Only a reader can tell those apart.
//   CANNOT   - notice a change with no identifier attached: a renamed skill, a changed number,
//              a reworked behaviour. The sweep is a floor, never a ceiling.
//
// So it is a checklist at the right moment, not an assertion. It reports exactly what it
// observed and always allows the session to say "nothing else describes this" and finish.
//
// FIRES AT MOST ONCE PER SESSION, and that is load bearing. Stop runs at the end of every
// assistant turn, not at session close. An earlier version cleared its record and relied on
// `stop_hook_active`, which suppresses only the immediate retry: a six turn session editing a
// skill blocked six times, verified. Worse, its trigger ("touched a skill, wrote no docs")
// stays true across a whole iterative build, unlike uncommitted-check's, which you can resolve
// by committing. So this writes a `.fired` marker and never blocks that session again. It also
// keeps its record across quiet Stops, since deleting it on every turn reset the file count and
// made the threshold mean "in one turn" rather than "this session".
//
// One file, two roles, keyed off hook_event_name.

import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'claude-session-close');
const TTL_MS = 24 * 60 * 60 * 1000;

// A session that only nudged a few files did not reshape anything. Ten is a guess at "this was
// a real piece of work", deliberately high: a reminder that fires on everything gets tuned out,
// and then it protects nothing. Writing a skill or a hook trips it on its own regardless.
const WORK_THRESHOLD = 10;

// The stale-doc sweep, added 2026-07-28 after this hook stayed quiet through exactly the
// failure it exists to catch. A session fixed a misconfigured API key env var on two hosting
// projects and DID write documentation, so the `seen.doc.size > 0` trust below let it finish.
// Four other live files still asserted the old broken state, including a memory file that
// loads into future sessions. Writing some docs is not the same as writing the right ones, and
// the original comment said so honestly rather than fixing it.
//
// The fix needs no judgement, which is the only reason it belongs in a hook: SCREAMING_SNAKE
// identifiers are near-zero-noise. If a session wrote `SERVICE_API_KEY` and some doc it never
// opened also says `SERVICE_API_KEY`, that doc is worth a look. It is a grep, and it still
// cannot know whether the file is actually stale, so it reports candidates and lets the
// session say "read them, they are fine".
const MAX_IDS = 8;          // most-repeated identifiers only; keeps the scan cheap and the list short
const MAX_SCAN_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;
const HOME = homedir().split('\\').join('/');

// Skipped wholesale. `backups` and anything named archive are the big one: the sweep that
// motivated this returned more hits from frozen snapshots than from live files, and a check
// whose output is mostly noise gets scrolled past, which is the same as not existing.
//
// These live up here with the other constants and not next to `walk`, where they read better,
// because the dispatch line below calls check() during module evaluation. A `const` declared
// after that point is in its temporal dead zone when the sweep runs, and the first version of
// this threw ReferenceError on every Stop that reached the sweep. Function declarations hoist
// and lulled it through review. Anything the sweep touches must be declared before dispatch.
const SKIP_DIR = /^(\.git|node_modules|backups|backup|dist|build|\.wrangler|coverage)$/i;
const SKIP_FILE = /archive|-old\.|\.bak$/i;

const bail = () => process.exit(0);

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads below
// would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

const sessionId = String(input.session_id || '').replace(/[^\w-]/g, '');
if (!sessionId) bail();
const listPath = join(DIR, sessionId + '.txt');
const firedPath = join(DIR, sessionId + '.fired');

const event = String(input.hook_event_name || '');
// Treat anything that is not an explicit Stop as a recording pass. A missing event name on a
// PostToolUse payload would otherwise silently record nothing and the check never fires.
// SubagentStop is not registered today; handling it costs nothing and stops a future
// registration from silently doing the wrong thing.
if (event === 'Stop' || event === 'SubagentStop') check(); else record();

// Which of the three buckets a written file falls in, or null to ignore it entirely.
//
// `doc` is a NAMED list, not "any markdown". An earlier version counted any .md outside
// ~/.claude as documentation, which meant a scratchpad plan.md, a blog post draft or a
// manuscript chapter silenced the check completely. A book chapter is not a
// description of a skill change.
//
// A SKILL.md is markdown but it is NOT documentation of this change: it IS the change. If
// editing a skill counted as documenting it, the exact failure this hook exists to catch would
// silence it. CLAUDE.md is deliberately both, because rewriting the rules is a system change
// AND is the main place system behaviour is written down for future sessions.
function classify(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) return null;
  const p = rawPath.split('\\').join('/').toLowerCase();

  // Scratch work is not work. Subagent probe scripts and temp files were landing on the
  // parent session's tally, and the independent-review rule means several subagents run per
  // change, so this was the dominant false positive.
  if (/\/(scratchpad|\.git|node_modules)\//.test(p) || /\/temp\/claude\//.test(p)) return null;

  const isClaudeMd = /(^|\/)claude\.md$/.test(p);
  const isSurface = /\.claude\/(skills|hooks|agents|plugins|commands)\//.test(p)
    || /\.claude\/settings(\.local)?\.json$/.test(p);

  // The documentation surfaces on this machine, by name. Diagrams count wherever they live:
  // a diagram of a flow you changed is now wrong.
  const isDoc = isClaudeMd
    || /(^|\/)readme\.md$/.test(p)
    || /\.(mmd|mermaid)$/.test(p)
    // `(^|\/)` and not a bare `\/`: a shell command usually names its target RELATIVE to a
    // `cd`, so `cat >> memory/projects/thing.md` has no leading slash and was silently
    // classified as work. The session that added the sweep below hit exactly that and then got
    // its own vault append reported back as an unopened stale file.
    || (/(^|\/)(memory|docs?|documentation)\//.test(p) && !isSurface);
  // If you keep project notes in a separate vault/notes repo outside .claude, add a
  // pattern for it here, e.g. `|| (/\/your-notes-repo\//.test(p) && /\.md$/.test(p))`.

  const sys = isSurface || isClaudeMd;
  if (sys && isDoc) return 'both';   // a real answer, not a tie to break. CLAUDE.md.
  if (sys) return 'sys';
  if (isDoc) return 'doc';
  return 'work';
}

function record() {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const marks = [];

  const add = (kind, path) => {
    if (kind === 'both') marks.push('sys\t' + path, 'doc\t' + path);
    else if (kind) marks.push(kind + '\t' + path);
  };

  // The matcher already restricts this, but a payload is not a promise.
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const fp = ti.file_path ?? ti.notebook_path;
    const kind = classify(fp);
    if (kind) add(kind, String(fp).split('\\').join('/'));
  }

  // Identifiers this session actually touched, for the stale-doc sweep at Stop. `old_string` is
  // read too, not just the new content: an identifier a session DELETED is the strongest
  // possible signal that other docs naming it are stale, and it would be invisible otherwise.
  // Requiring an underscore is what keeps this quiet. Bare words like SELECT, POST and README
  // match everything and would bury the real signal on the first noisy session.
  const text = [ti.content, ti.new_string, ti.old_string, ti.command]
    .filter(v => typeof v === 'string').join('\n');
  for (const id of new Set(text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || [])) {
    marks.push('id\t' + id);
  }

  // A shell command that writes a doc is a doc write. Tonight's own vault updates went in
  // through `cat >> .../memory/projects/some-project.md`, and missing those would make this
  // fire on a session that did exactly the right thing. Only paths it can actually see are counted,
  // and only as `doc`: a shell command is too vague to charge as system or work.
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const cmd = String(ti.command || '');
    // A command has to actually WRITE. Naming a doc path is not documenting it, and `cat
    // docs/design.md` used to buy the same silence as appending to it. That was harmless while
    // only absolute paths matched; widening the `doc` test to relative paths above made it easy
    // to hit, since a command after a `cd` names its target relatively almost every time.
    const writes = /(>>?|\btee\b|\bcp\b|\bmv\b|Out-File|Set-Content|Add-Content)/i.test(cmd);
    if (writes) for (const m of cmd.match(/[\w./\\:~-]+\.(?:md|mdx|mmd|mermaid)\b/gi) || []) {
      if (classify(m) === 'doc' || classify(m) === 'both') add('doc', m.split('\\').join('/'));
    }
  }

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
  } catch { /* a tracking miss costs a reminder, never a tool call */ }
  bail();
}

// Every markdown file on this machine that a future session might believe. Deliberately a
// NAMED list for the same reason `classify` is one: "all markdown under home" would drag in
// manuscripts, blog posts and node_modules and drown the result.
function docRoots() {
  // Test seam, and the only one in this file. The sweep is worthless if it cannot be proven to
  // catch the case it was written for, and proving that against the real doc roots would make
  // the test depend on whatever happens to be on disk that week.
  if (process.env.SCC_DOC_ROOTS) return process.env.SCC_DOC_ROOTS.split(';').filter(Boolean);
  const roots = [HOME + '/CLAUDE.md', HOME + '/.claude/CLAUDE.md'];
  const dirs = (parent, fn) => {
    try {
      for (const d of readdirSync(parent, { withFileTypes: true })) if (d.isDirectory()) fn(d.name);
    } catch { /* a missing directory is not an error */ }
  };
  // Claude Code memory, one dir per project slug.
  dirs(HOME + '/.claude/projects', n => roots.push(`${HOME}/.claude/projects/${n}/memory`));
  // Every repo's own CLAUDE.md and docs/ dir, without walking the repos themselves.
  dirs(HOME + '/projects', n => roots.push(`${HOME}/projects/${n}/CLAUDE.md`, `${HOME}/projects/${n}/docs`));
  // Keep project notes somewhere else? Add that path here, e.g. `roots.push(HOME + '/notes')`.
  // A whole notes repo is fine: the walk below only reads markdown and skips backups.
  return roots;
}

function walk(path, out) {
  if (out.length >= MAX_SCAN_FILES) return;
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isFile()) {
    if (/\.mdx?$/i.test(path) && !SKIP_FILE.test(path) && st.size <= MAX_FILE_BYTES) out.push(path);
    return;
  }
  if (!st.isDirectory()) return;
  let entries;
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory() && SKIP_DIR.test(e.name)) continue;
    walk(join(path, e.name), out);
  }
}

// Files naming something this session changed, that this session never opened.
function staleCandidates(ids, touched) {
  const files = [];
  for (const r of docRoots()) walk(r, files);
  const hits = [];
  // A path seen in a shell command is usually relative to a `cd`, so it can never equal the
  // absolute path the walk produces. Suffix-match those, but only when they carry a directory:
  // a bare `CLAUDE.md` from `git add CLAUDE.md` would otherwise silence every CLAUDE.md on the
  // machine, which is the one file most worth flagging.
  const rel = [...touched].filter(t => t.includes('/')).map(t => '/' + t.replace(/^\/+/, ''));
  for (const f of files) {
    const norm = f.split('\\').join('/');
    const low = norm.toLowerCase();
    if (touched.has(low) || rel.some(t => low.endsWith(t))) continue;
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const matched = ids.filter(id => text.includes(id));
    if (matched.length) hits.push({ path: norm, ids: matched });
    if (hits.length >= 40) break;
  }
  // Most identifiers in common first: that file is the most likely to be describing the thing
  // that just changed, rather than mentioning one shared name in passing.
  return hits.sort((a, b) => b.ids.length - a.ids.length);
}

function check() {
  // Already nudged this session. Not this stop cycle: this session, for good.
  if (existsSync(firedPath)) bail();
  if (input.stop_hook_active) bail();
  if (!existsSync(listPath)) bail();

  const seen = { sys: new Set(), doc: new Set(), work: new Set() };
  const idCounts = new Map();
  try {
    for (const line of readFileSync(listPath, 'utf8').split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const kind = line.slice(0, tab);
      const val = line.slice(tab + 1);
      // Counted, not Set-ed: an identifier a session kept coming back to is the one worth
      // sweeping for, and the ranking is the whole reason MAX_IDS can be as low as 8.
      if (kind === 'id') idCounts.set(val, (idCounts.get(val) || 0) + 1);
      else if (seen[kind]) seen[kind].add(val);
    }
  } catch { bail(); }

  // Stay quiet, but KEEP the record. Stop runs every turn, and deleting here would reset the
  // file count each time, so the threshold would only ever mean "in one turn".
  const substantive = seen.sys.size > 0 || seen.work.size >= WORK_THRESHOLD;
  if (!substantive) bail();

  const touched = new Set([...seen.sys, ...seen.doc, ...seen.work].map(p => p.toLowerCase()));
  const ids = [...idCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_IDS).map(e => e[0]);
  const stale = ids.length ? staleCandidates(ids, touched) : [];

  // It moved documentation. That used to end the check here, on the honest grounds that this
  // hook cannot judge whether the RIGHT docs moved. It still cannot judge, but it can now point
  // at the ones naming what changed, so silence is only correct when there is nothing to point at.
  if (seen.doc.size > 0 && !stale.length) bail();

  // Mark before blocking. Everything after this point must not be able to fire again, even if
  // the session keeps working and stops another twenty times.
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(firedPath, String(Date.now())); }
  catch { /* if the marker cannot be written, better to say nothing than to nag forever */ bail(); }

  const list = (set, n = 8) => [...set].slice(0, n).map(p => '    ' + p)
    .concat(set.size > n ? [`    ... and ${set.size - n} more`] : []);

  const wroteDocs = seen.doc.size > 0;
  const lines = [];
  lines.push(wroteDocs
    ? 'Session close check. You documented this change, but other live docs name what you changed.'
    : 'Session close check. This session changed how the system behaves and wrote no documentation.');
  lines.push('');
  if (seen.sys.size) {
    lines.push(`  Skills, hooks, settings or CLAUDE.md (${seen.sys.size}), these change every future session:`);
    lines.push(...list(seen.sys));
  }
  if (seen.work.size) {
    lines.push(`  Other files written (${seen.work.size}):`);
    lines.push(...list(seen.work, 5));
  }
  lines.push(wroteDocs ? `  Documentation written (${seen.doc.size}):` : '  Documentation written: none.');
  if (wroteDocs) lines.push(...list(seen.doc, 5));
  lines.push('');

  if (stale.length) {
    lines.push(`  NOT opened this session, but they mention what you changed (${stale.length}):`);
    for (const h of stale.slice(0, 10)) {
      lines.push(`    ${h.path.replace(HOME, '~')}`);
      lines.push(`      names: ${h.ids.slice(0, 4).join(', ')}`);
    }
    if (stale.length > 10) lines.push(`    ... and ${stale.length - 10} more`);
    lines.push('');
    lines.push('  This is a grep, not a verdict. Some of those are correct history, and a dated');
    lines.push('  entry describing what WAS true should stay. Open them and decide. What this');
    lines.push('  cannot tell you, and what went wrong on 2026-07-28, is whether anyone looked.');
    lines.push('');
  }
  lines.push('Still mid-build and it is too early to write this up? Say so and carry on. This will');
  lines.push('not fire again for this session, so it is on you to come back to it.');
  lines.push('');
  lines.push('Nothing else describes what you changed, and there are no follow-ups? Say exactly');
  lines.push('that in your reply and finish. That is a legitimate answer and this cannot tell the');
  lines.push('two apart. What it can tell you is that nobody checked.');
  lines.push('');
  lines.push('Otherwise, work these in order. Do not file a ticket for something you can fix now.');
  lines.push('');
  if (stale.length) {
    lines.push('1. OPEN the files listed above. That list is the grep, already run, over ~/CLAUDE.md,');
    lines.push('   ~/.claude/CLAUDE.md, your memory dirs, and each repo CLAUDE.md and docs/. It only');
    lines.push('   sees SCREAMING_SNAKE names, so widen it by hand for a renamed skill, a changed');
    lines.push('   number or a behaviour with no identifier attached.');
  } else {
    lines.push('1. FIND what else describes this, do not recall it. Grep the old name, the old');
    lines.push('   number, the old behaviour across ~/CLAUDE.md, ~/.claude/CLAUDE.md, the skills,');
    lines.push('   ~/.claude/projects/<your-project-slug>/memory/, each repo CLAUDE.md, and wherever');
    lines.push('   else you keep project notes. On 2026-07-26 a sweep like that found eight stale');
    lines.push('   files and two wrong numbers a later session would have planned against.');
  }
  lines.push('');
  lines.push('2. FIX the stale ones in this session. A doc that contradicts live state is worse');
  lines.push('   than no doc, because it gets believed. If a number is wrong, pull the live value');
  lines.push('   and write that, rather than deleting the claim.');
  lines.push('');
  lines.push('3. RECORD it where it will be read again: a dated UPDATE in the matching vault');
  lines.push('   projects/*.md, a Claude Code memory plus its one line in MEMORY.md, and the');
  lines.push('   repo CLAUDE.md if the change is local to one repo. Diagrams count: if a diagram');
  lines.push('   shows the flow you changed, it is now wrong.');
  lines.push('');
  lines.push('4. FILE every follow-up in your task tracker, not in your reply. Chat is not a');
  lines.push('   backlog and it is gone tomorrow. If you use Notion, this is where a');
  lines.push('   notion-create-pages call against your Tasks database id belongs. Each task carries:');
  lines.push('     - Task: the outcome, not the activity. "X does Y", not "look at X".');
  lines.push('     - Effort: Quick win (under 2 hrs) / Half day / Multi-day. Required.');
  lines.push('     - Priority and Project. Status: Todo, or Blocked if something is in the way.');
  lines.push('     - Page body: what and why, the files or systems it touches, and DEPENDENCIES');
  lines.push('       spelled out. What must be true before this can start, what it blocks, and');
  lines.push('       whether it needs you (your hands, your accounts, your money). If your tracker');
  lines.push('       has no dependency field, put it in the body or it does not exist.');
  lines.push('     A task nobody can start without asking you what you meant is not filed.');

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}
