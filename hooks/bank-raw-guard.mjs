#!/usr/bin/env node
// PreToolUse hook (Read|Grep|Bash|PowerShell): stop anything from pulling a whole context-bank
// raw transcript into a context window.
//
// Why: projects/context-bank/raw/ holds podcast and video transcripts. One 90-minute episode
// is 60-100KB, roughly 25K tokens. The bank is only affordable because agents read the
// distilled playbooks and reach the raw layer through `cb.py search`, which caps itself at 12
// hits of 240 characters. A single `cat` of one transcript costs more than every playbook
// combined, and nothing else would ever notice it happened.
//
// Shape, after three reviews each walked around the version before it:
//   - Structured tools (Read, Grep) are checked on their path field. Grep with output_mode
//     "content" is the harness's own search tool and returns hundreds of transcript lines.
//     A content search from an ANCESTOR directory is handled outside this hook, by the
//     `.ignore` file in the bank: ripgrep skips raw/, git still tracks it.
//   - Shell commands are checked with a DENY-list of reading verbs, matched as the COMMAND
//     WORD of each pipeline stage. An allow-list on the first word cleared `ls raw/ && cat
//     raw/ep.txt` on the strength of the `ls`; a substring match on the whole segment
//     refused a printf whose message contained the word "Grep".
//   - Relative paths are resolved against a cwd carried across segments, because
//     `cd projects/context-bank && cat raw/*.txt` never spells the prefix and is exactly
//     what a session working in the repo types next.
//   - A path in an earlier pipeline stage counts only when the reader takes filenames off
//     stdin. `find raw/ | xargs cat` reads the files; `ls -la raw/ | head` reads the listing
//     and must not be refused with a message saying listing is allowed.
//
// Writes, deletes, moves, and `git add`/`status`/`diff --stat` are untouched: none of them
// puts file content anywhere. COPYING is blocked, because copying a transcript out and
// reading it elsewhere costs the same 25K tokens. The .meta.json sidecars are 294 bytes and
// hold the only copy of url/show/speaker/method, so they stay readable.
//
// String matching on shell text can never win against a determined bypass
// (`D=path; cat $D/raw/x`); the point is to stop the accidents, which are the whole risk.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bail = () => process.exit(0); // any doubt, stay out of the way

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

const tool = String(input.tool_name || '');
const ti = input.tool_input || {};
const cwd = String(input.cwd || process.cwd());

const norm = (p) => String(p).replace(/\\/g, '/');
// The guarded directories, by name. Add yours here rather than anywhere else in this file:
// everything below asks this one question. `skills/bank/raw` is where cb.py puts
// transcripts when the bank is installed from the public repo instead of its own project.
const GUARDED = /(^|\/)(context-bank|skills\/bank)\/raw(\/|$)/i;
const inRaw = (p) => GUARDED.test(norm(p));

// A path as written in a command, resolved the way the shell would resolve it.
const asPath = (p) => norm(resolve(cwd, String(p).replace(/^["']|["']$/g, '')));

let offender = '';

if (tool === 'Read') {
  const p = asPath(ti.file_path || '');
  if (inRaw(p) && !/\.meta\.json$/i.test(p)) offender = String(ti.file_path);
} else if (tool === 'Grep') {
  // files_with_matches (the default) returns names only and is harmless. content mode is not:
  // head_limit defaults to 250 lines of up to 241 chars, which is most of a transcript.
  // Only raw/ and the bank root. Content-grepping an 8KB playbook is CHEAPER than the Read
  // this hook would otherwise push the agent toward, and blocking it strands a session with
  // a refusal message that describes something it did not do.
  const p = asPath(ti.path || '.');
  if (String(ti.output_mode || '') === 'content' && (inRaw(p) || /(context-bank|skills\/bank)\/?$/i.test(norm(p))))
    offender = `Grep in ${ti.path || cwd}`;
} else if (tool === 'Bash' || tool === 'PowerShell') {
  // A heredoc or here-string body is text, not a command. Commit messages, docs and this
  // hook's own README quote the blocked example, and v2 blocked the commit that described it.
  // ~/CLAUDE.md names PowerShell's @'...'@ as the way to pass a multi-line commit message, so
  // both forms have to be stripped or the bug just moves to the other shell.
  const cmd = String(ti.command || '')
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, '<<HEREDOC')
    .replace(/@(['"])[\s\S]*?^\1@/gm, '@HERESTRING@');

  // Anything that puts file CONTENT somewhere, matched as a COMMAND WORD and never as prose.
  // The v3 substring match blocked a printf whose text happened to contain the word "Grep".
  // Search verbs matter most: an agent told to "search the bank" reaches for grep before it
  // reaches for cb.py, and `grep -A999` returns the file. cp is here because copying a
  // transcript out and reading it elsewhere is the same cost; the refusal message says so.
  const READERS = new Set(('cat head tail sed awk more less strings nl od bat type gc tac cut ' +
    'diff base64 xxd fold expand paste iconv tr sort uniq grep egrep fgrep rg ag ack cp copy ' +
    'get-content import-csv select-string copy-item sls zcat tee pr rev column hexdump shuf ' +
    'comm view').split(' '));
  const LISTERS = new Set(['ls', 'll', 'dir', 'find', 'gci', 'get-childitem']);
  // Wrappers that stand in front of the real verb. `xargs -I{} sh -c "cat {}"` is three deep.
  // `ForEach-Object` and its `%` alias are how PowerShell writes a read that needs $_, and
  // PowerShell is the primary shell here. `LC_ALL=C cat raw/x` puts an assignment out front.
  const WRAP = /^(sudo|command|nohup|time|env|xargs|sh|bash|zsh|pwsh|powershell|then|do|in|foreach-object|%.*|foreach\(.*|-.*|[{(].*|\w+=.*)$/i;

  const words = (s) => (s.match(/"[^"]*"|'[^']*'|[^\s|]+/g) || [])
    .map((t) => t.replace(/^["'()]+|["')]+$/g, ''));  // (cat raw/x.txt) is a subshell

  // Splitting on `;` `&&` `||` and newlines, but NOT on `|`: the stages of one pipeline share
  // data. cwd is carried ACROSS segments, because `cd projects/context-bank && cat raw/*.txt`
  // is exactly what a session working in the bank types.
  //
  // A shell loop hands the path to the reader through a variable, so `for f in raw/*.txt; do
  // cat "$f"; done` names no path in the segment that does the reading. Only paths named in
  // the segment that OPENS the loop carry: widening to the whole command refused
  // `ls raw/ ; for f in playbooks/*.md; do cat $f; done`, which reads playbooks.
  const LOOP = /(^|[\s;])(for|while|foreach)\s*[({\w]/i;
  let here = norm(cwd);
  const loopSeen = [];   // paths named in a segment that opens a loop, and only those

  for (const seg of cmd.split(/&&|\|\||;|\n/)) {
    const cd = seg.match(/^\s*(?:cd|chdir|Set-Location|sl|pushd)\s+(?:-\w+\s+)*["']?([^"'\s]+)/i);
    if (cd) { here = norm(resolve(here, cd[1])); continue; }

    // Command substitutions run as their own commands. `echo $(cat raw/x.txt)` has a harmless
    // first word and reads the file anyway.
    const subs = (seg.match(/\$\(([^)]*)\)|`([^`]*)`/g) || []).map((s) => s.replace(/^[$`(]+|[)`]+$/g, ''));
    const pipeSeen = [];

    // `{` and `}` are stage boundaries too: PowerShell's `gci raw | %{ gc $_ }` and
    // `foreach($f in gci raw){ gc $f }` put the reader inside a script block.
    for (const stage of [...seg.split(/[|{}]/), ...subs]) {
      const w = words(stage);
      let i = 0;
      while (i < w.length && WRAP.test(w[i])) i++;
      // `sh -c "cat raw/x.txt"` puts the real verb inside a quoted argument.
      const verb = (w[i] || '').trim().split(/\s+/)[0].replace(/^.*[/\\]/, '').toLowerCase();
      const fedByXargs = /(^|\s)xargs(\s|$)/i.test(stage);

      // Every path-looking token in this stage, resolved against the running cwd. A bare `raw`
      // only counts as an argument to a listing verb, so `grep -n raw INDEX.md` is not a read
      // of raw/; that catches `Get-ChildItem raw | Get-Content`, which names a directory with
      // no slash and no extension.
      const bare = LISTERS.has(verb) ? '|(?<![\\w/\\\\.-])raw(?![\\w.-])' : '';
      // Any search verb, not just grep: `rg -l` and `ag -l` print names too.
      const searcher = /grep|^rg$|^ag$|^ack$|select-string|^sls$/i.test(verb);
      // Only the bash family: PowerShell's -Path takes the file as a flag VALUE, so
      // dropping the first non-flag argument there would drop the path being read.
      const bareSearcher = /grep|^rg$|^ag$|^ack$/i.test(verb);
      // A search verb's first non-flag argument is the PATTERN, not a path. `grep -rn
      // 'projects/context-bank/raw' hooks/` was refused, because that pattern resolves to a
      // directory that really exists.
      const pattern = bareSearcher ? w.slice(i + 1).find((t) => !t.startsWith('-')) : null;
      const scan = pattern ? stage.replace(pattern, ' ') : stage;
      const tokens = scan.match(new RegExp(`[^\\s"'\`|]*[/\\\\][^\\s"'\`|]*|[\\w.*-]+\\.(?:txt|json)\\b${bare}`, 'g')) || [];
      // `git show HEAD:raw/ep.txt` carries a revision prefix. Two or more characters before the
      // colon, so a Windows drive letter (C:) is left alone.
      const paths = tokens
        .map((t) => norm(resolve(here, t.replace(/^["'(]+|["')]+$/g, '').replace(/^[\w.@^~-]{2,}:/, ''))))
        .filter(inRaw)
        .filter((p) => !/\.meta\.json$/i.test(p))   // the sidecars are 294 bytes and always fine
        // A transcript is always a .txt. Anything else has to be a glob or a file that
        // exists: `sed -n '/x/,/out = RAW/p' cb.py` looked like a path under raw/ to a pure
        // string match, and a grep for the STRING 'context-bank/raw' looked like one too.
        .filter((p) => /\.txt$|[*?]/i.test(p) || existsSync(p));
      pipeSeen.push(...paths);
      if (LOOP.test(seg)) loopSeen.push(...paths);

      // grep printing names or counts is a listing, not a read. --include of the sidecars too.
      const namesOnly = /(^|\s)-[a-z]*[lLc](\s|$)/.test(stage) && !/-[ABC]\s*\d|--context/.test(stage);
      const sidecarOnly = /--include=\S*\.meta\.json/i.test(stage);
      const reads = (READERS.has(verb) && !(searcher && namesOnly) && !sidecarOnly)
        // An interpreter naming a raw path is a read whatever the flags say: `perl -pe 1 x`,
        // `python -m json.tool x`, `node script.js x`.
        || (/^(python[0-9.]*|py|node|deno|ruby|perl|pwsh)$/i.test(verb) && paths.length > 0)
        || (fedByXargs && /\s-a\s/.test(stage))   // xargs -a takes its file list from a file
        || /\[(System\.)?IO\.File\]::Read/i.test(stage)
        // `find raw/ -name "*.txt" -exec cat {} +` reads inside a listing command.
        || READERS.has((stage.match(/-execdir\s+(\S+)|-exec\s+(\S+)/i) || []).slice(1).find(Boolean)?.toLowerCase())
        // git add/status/diff --stat are fine and must stay fine. These print file contents.
        || (verb === 'git' && w.slice(i + 1, i + 4).some((t) => /^(show|cat-file|blame)$/i.test(t)))
        || (verb === 'git' && /\blog\b[\s\S]*\s-p\b/i.test(stage));
      if (!reads) continue;

      // A path in THIS stage always counts. One from an earlier stage of the same pipeline
      // counts only when the reader takes filenames off stdin: `find raw/ | xargs cat` reads
      // the files, `ls raw/ | head` reads the listing. PowerShell pipes objects, so there it
      // always counts.
      const fed = fedByXargs || tool === 'PowerShell';
      let hits = paths.length ? paths : (fed ? pipeSeen : loopSeen);
      // Bare filenames while sitting inside raw/ ("cd raw && cat *.txt") resolve there too.
      if (!hits.length && inRaw(here) && /\*|\.txt\b/i.test(stage)) hits = [here];
      if (hits.length) { offender = seg.trim(); break; }
    }
    if (offender) break;
  }
}

if (!offender) bail();

process.stderr.write(
  [
    'Blocked: that reads a raw context-bank transcript directly.',
    '',
    `  ${offender.slice(0, 200)}`,
    '',
    'One transcript is roughly 25K tokens. The raw layer is an audit trail, not a',
    'reading surface. Use the two hops instead:',
    '',
    '  1. projects/context-bank/INDEX.md, then the one playbook that matches.',
    '     The distilled play is normally the whole answer.',
    '  2. Only if it is not:',
    '       python projects/context-bank/cb.py search "<exact phrase>"',
    '     Capped at 12 hits of 240 characters, and the cap cannot be raised from',
    '     the command line. Take the phrase from the play\'s Source anchor, because',
    '     the search matches words and not meaning.',
    '',
    'Not blocked: listing, moving, deleting, writing, git add/status/diff, reading',
    'a playbook, and the .meta.json sidecars, which hold the url, show, speaker and',
    'transcription method. Copying a transcript IS blocked: it costs the same tokens',
    'one step later.'
  ].join('\n') + '\n'
);
process.exit(2);
