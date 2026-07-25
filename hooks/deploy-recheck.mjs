#!/usr/bin/env node
// PreToolUse hook (Bash|PowerShell): before any command that publishes a DIRECTORY,
// force the agent to look at what is actually in that directory right now.
//
// Why: a session once ran `wrangler pages deploy .` off a stale, half-hour-old mental
// picture of the folder. Another session had since dropped untracked files and a vendor/
// directory in there, and all of it went live. Root cause: publishing an implicit,
// mutable set of files from a stale listing.
//
// Mechanism: deny once with the fresh listing, then allow the identical retry as long
// as the directory has not changed since the listing was shown. The allow token is keyed
// on a fingerprint of the directory contents, so the agent cannot pre-arm it and cannot
// sail past a directory that moved under it. Worst case for a pipeline is one extra turn,
// never a permanent block.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';

// Commands that publish a directory. Add here to extend.
// `aws s3 cp` only counts when it is recursive; a single-file cp is an explicit set already.
const PUBLISH_PATTERNS = [
  /^wrangler\s+(pages\s+)?deploy\b/,
  /^netlify\s+deploy\b/,
  /^vercel\s+deploy\b/,
  /^firebase\s+deploy\b/,
  /^aws\s+s3\s+sync\b/,
  /^aws\s+s3\s+cp\b(?=.*--recursive)/,
  /^rsync\b/,
  /^scp\s+-\w*r\b/,
  /^gh\s+release\s+upload\b/
];

// Runner prefixes to strip before matching, so `npx wrangler ...` still hits.
const RUNNER = /^(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx|sudo|command)\s+(?:--\S+\s+)*/;

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_LISTED = 200;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_DIR = join(tmpdir(), 'claude-deploy-recheck');

const bail = () => process.exit(0); // any doubt, stay out of the way

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { bail(); }

const command = (input.tool_input || {}).command || '';
if (!command.trim()) bail();

const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();

// Split on shell/PowerShell separators so `echo wrangler pages deploy` or a grep for
// "rsync" does not trip the match. Only the head of a segment counts as a command.
// Separators inside quotes do not split: a deploy string passed as an argument to some
// other command (a heredoc, a test runner, `echo "a && wrangler pages deploy ."`) is text,
// not a command, and must not trip this hook.
function segments(cmd) {
  const out = [];
  let buf = '', quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote && cmd[i - 1] !== '\\') quote = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === ';' || c === '\n') { out.push(buf); buf = ''; continue; }
    if (c === '&' && cmd[i + 1] === '&') { out.push(buf); buf = ''; i++; continue; }
    if (c === '|') { if (cmd[i + 1] === '|') i++; out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// Strip everything a shell puts in front of the real command before the PUBLISH
// patterns (all ^-anchored) get to see it, so `FOO=bar wrangler ...`,
// `./node_modules/.bin/wrangler ...`, `(wrangler ...)` and `{ wrangler ...; }`
// cannot slip a directory publish past the head-of-segment match.
function normalize(seg) {
  let s = seg.replace(RUNNER, '').trim();
  s = s.replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, ''); // inline VAR=val env assignments
  s = s.replace(/^[({]\s*/, '').replace(/[)}\s;]+$/, '');             // subshell/group wrappers
  s = s.replace(/^(\S*[\\/])([^\\/\s]+)/, '$2');                      // path-prefixed binary -> basename
  return s.trim();
}

function matchedSegment(cmd) {
  for (const seg of segments(cmd)) {
    const bare = normalize(seg);
    for (const re of PUBLISH_PATTERNS) if (re.test(bare)) return bare;
  }
  return null;
}

const seg = matchedSegment(command);
if (!seg) bail();

// Quote-aware tokenizer. Windows paths with spaces are the norm on this machine.
function tokenize(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Resolve the published directory: the LAST token that is an actual directory on disk.
// The deploy dir is conventionally the trailing argument (`wrangler pages deploy ./dist`),
// so taking the last resolving token skips subcommand words (`pages`, `deploy`) that would
// otherwise win if a same-named folder happened to sit in cwd. Covers `.`, `./dist`, quoted
// paths with spaces, and `rsync -av ./site/ host:/x`. Flags and remote targets (s3://,
// user@host:/path) never count as a local dir.
// A POSIX absolute path from Git Bash (`/tmp/deploy`) is not a Windows path. Node resolves
// it against the current drive root (`C:\tmp\deploy`), which does not exist, so the token
// silently fails to resolve and the cwd fallback below takes over. That is the worst
// possible outcome for this hook: it prints an authoritative listing of a directory that
// is not the one being published, and then lets the deploy through. Any recipe that stages an
// enumerated copy into /tmp and publishes that will hit it, which means the check was
// blind to exactly the kind of careful command it rewards you for using.
// `/tmp` is the only one of these worth translating, because it is the one every recipe
// uses and the one MSYS maps to a location Node can name.
function candidates(t) {
  const out = [resolve(cwd, t)];
  const posixTmp = /^\/tmp(\/.*)?$/.exec(t);
  if (posixTmp) out.push(join(tmpdir(), posixTmp[1] || ''));
  return out;
}

function resolveDir(tokens) {
  let found = null;
  let unresolvedPath = null;
  for (const raw of tokens.slice(1)) {
    // `--dir=./dist` and friends carry the path in the flag value.
    const eq = /^--?[\w-]+=(.+)$/.exec(raw);
    const t = eq ? eq[1] : raw;
    if (!eq && raw.startsWith('-')) continue;
    if (/^[a-z0-9]+:\/\//i.test(t)) continue;   // scheme:// remote
    if (/^[^\s/\\]+@[^\s]+:/.test(t)) continue; // user@host:/path remote
    try {
      const cleaned = t.replace(/[\\/]+$/, '') || t;
      let hit = null;
      for (const p of candidates(cleaned)) {
        if (existsSync(p) && statSync(p).isDirectory()) { hit = p; break; }
      }
      if (hit) found = hit;                                  // keep last, not first
      else if (/[\\/]/.test(t)) unresolvedPath = t;           // looked like a path, was not one
    } catch { /* not a path, keep looking */ }
  }
  // No directory argument (e.g. bare `wrangler deploy` reading wrangler.toml).
  // cwd is the honest guess at what is about to be swept up.
  //
  // But if an argument LOOKED like a directory and did not resolve, cwd is a guess dressed
  // up as a fact. Say so instead, so the listing is never mistaken for the deploy contents.
  if (!found && unresolvedPath) return { dir: cwd, unresolved: unresolvedPath };
  return { dir: found || cwd, unresolved: null };
}

let targetDir, unresolvedTarget;
try {
  const r = resolveDir(tokenize(seg));
  targetDir = r.dir;
  unresolvedTarget = r.unresolved;
} catch { bail(); }
if (!targetDir || !existsSync(targetDir)) bail();

// Walk the tree. Skip .git and node_modules only; dist/ and build/ are usually the payload.
function walk(dir, base, acc, depth = 0) {
  if (acc.total > 5000 || depth > 12) return acc;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, acc, depth + 1);
    } else {
      acc.total++;
      let mtime = 0, size = 0;
      try { const st = statSync(full); mtime = st.mtimeMs; size = st.size; } catch { /* raced, ignore */ }
      acc.files.push({ rel: relative(base, full).split(sep).join('/'), mtime, size });
    }
  }
  return acc;
}

const { files, total } = walk(targetDir, targetDir, { files: [], total: 0 });

// git status, when there is a git repo. Untracked files are the exact hazard from the incident.
let dirty = [];
let isRepo = false;
try {
  const out = execFileSync('git', ['-C', targetDir, 'status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, maxBuffer: 64 * 1024 * 1024
  });
  isRepo = true;
  dirty = out.split('\n').filter(Boolean).map(l => ({ code: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
} catch { /* not a repo, or no git on PATH. Not an error. */ }

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const fresh = files.filter(f => now - f.mtime < HOUR).sort((a, b) => b.mtime - a.mtime);

// Fingerprint = what the agent is about to be shown. If the directory changes before the
// retry, the fingerprint changes, the token misses, and the agent gets a fresh listing.
// Ceiling: the token is not session-scoped, so within TOKEN_TTL_MS a second concurrent
// session running the identical command against the unchanged dir can consume the token and
// deploy without seeing the listing. Upgrade path if cross-session strictness is ever needed:
// mix a session id from the payload (e.g. input.session_id) into the fingerprint below.
const fingerprint = createHash('sha256')
  .update(targetDir + '\0' + seg + '\0')
  .update(files.map(f => `${f.rel}:${f.size}:${f.mtime}`).sort().join('\n'))
  .digest('hex');
const tokenPath = join(TOKEN_DIR, fingerprint + '.tok');

// Second pass: same command, same directory contents, listing already shown. Let it through.
try {
  if (existsSync(tokenPath) && now - statSync(tokenPath).mtimeMs < TOKEN_TTL_MS) {
    rmSync(tokenPath, { force: true });
    process.exit(0);
  }
} catch { /* token unreadable, fall through to showing the listing */ }

try {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(tokenPath, seg);
} catch {
  // Cannot persist the token, so the retry would deny again and loop. Let it run rather
  // than block a legitimate deploy forever.
  bail();
}

// Best-effort token sweep so temp does not accumulate.
try {
  for (const f of readdirSync(TOKEN_DIR)) {
    const p = join(TOKEN_DIR, f);
    if (now - statSync(p).mtimeMs > TOKEN_TTL_MS) rmSync(p, { force: true });
  }
} catch { /* sweep is optional */ }

const shown = files.slice(0, MAX_LISTED);
const lines = [];

lines.push(`Publish re-check. This command publishes a whole directory, not a list of files you chose:`);
lines.push(`  ${seg}`);
if (unresolvedTarget) {
  lines.push(`WARNING: the command names "${unresolvedTarget}", which this check could not find`);
  lines.push(`on disk. A POSIX path from a Bash shell does not resolve on Windows. So the listing`);
  lines.push(`below is the CURRENT DIRECTORY, not what is about to be published. Read it as`);
  lines.push(`context only, and verify the real target yourself before you re-run.`);
  lines.push('');
}
lines.push(`Target: ${targetDir}${unresolvedTarget ? '  (fallback, see warning above)' : ''}`);
lines.push(`Contents RIGHT NOW: ${total} file${total === 1 ? '' : 's'} (.git and node_modules excluded).`);
lines.push('');

if (isRepo && dirty.length) {
  const untracked = dirty.filter(d => d.code === '??');
  const modified = dirty.filter(d => d.code !== '??');
  if (untracked.length) {
    lines.push(`UNTRACKED, and they WILL be published (${untracked.length}):`);
    for (const d of untracked.slice(0, 60)) lines.push(`  ?? ${d.path}`);
    if (untracked.length > 60) lines.push(`  ... and ${untracked.length - 60} more`);
    lines.push('');
  }
  if (modified.length) {
    lines.push(`Modified vs git (${modified.length}):`);
    for (const d of modified.slice(0, 40)) lines.push(`  ${d.code} ${d.path}`);
    if (modified.length > 40) lines.push(`  ... and ${modified.length - 40} more`);
    lines.push('');
  }
} else if (isRepo) {
  lines.push('Git: clean, nothing untracked or modified.');
  lines.push('');
} else {
  lines.push('Git: not a repo, so nothing here is tracked. Every file below ships.');
  lines.push('');
}

if (fresh.length) {
  lines.push(`Touched in the last hour (another session or a human may be mid-work) (${fresh.length}):`);
  for (const f of fresh.slice(0, 30)) {
    lines.push(`  ${f.rel}  (${Math.round((now - f.mtime) / 60000)}m ago)`);
  }
  if (fresh.length > 30) lines.push(`  ... and ${fresh.length - 30} more`);
  lines.push('');
}

lines.push(`Full listing${total > MAX_LISTED ? ` (first ${MAX_LISTED} of ${total})` : ''}:`);
for (const f of shown) lines.push(`  ${f.rel}`);
if (total > MAX_LISTED) lines.push(`  ... and ${total - MAX_LISTED} more`);
lines.push('');
lines.push('Read the list above and decide:');
lines.push('  - Every file listed is meant to be public? Re-run the same command and it will go through.');
lines.push('  - Anything in there you did not intend to publish? Do NOT deploy this directory.');
lines.push('    Stage the exact files you want into a temp dir and deploy that instead.');
lines.push('  - Not sure whose files those are? Ask before publishing.');
lines.push('');
lines.push('This check is not a permission prompt. The identical command runs on the next attempt,');
lines.push('as long as the directory has not changed since this listing.');

process.stderr.write(lines.join('\n') + '\n');
process.exit(2);
