// Drives bank-raw-guard against the cases that decide whether the guardrail is real.
// Exit 2 = blocked, exit 0 = allowed through.
//
// Most of these came out of an independent review that walked around version 1 six different
// ways. The first suite passed 16/16 while `cd projects/context-bank && cat raw/*.txt` sailed
// straight through, because every case it tested spelled the full path prefix.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const norm = (p) => p.split('\\').join('/');
const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'bank-raw-guard.mjs');

// A real directory on disk, because the hook calls existsSync on any candidate path that is
// not a .txt or a glob: `find raw/`, `cp raw/`, `ls raw/` and `git log -p raw/` all name the
// DIRECTORY. Pointing this at a hardcoded home meant the suite only passed on one machine.
const HOME = norm(mkdtempSync(join(tmpdir(), 'bank-guard-')));
const BANK = `${HOME}/projects/context-bank`;
const RAW = `${BANK}/raw`;
mkdirSync(RAW, { recursive: true });
writeFileSync(`${RAW}/ep.txt`, 'transcript');
writeFileSync(`${RAW}/ep.meta.json`, '{}');
process.on('exit', () => { try { rmSync(HOME, { recursive: true, force: true }); } catch {} });

const run = (p) => spawnSync(NODE, [HOOK], { input: JSON.stringify(p), encoding: 'utf8' });

let failures = 0;
const check = (label, payload, wantBlocked) => {
  const r = run(payload);
  const blocked = r.status === 2;
  if (blocked !== wantBlocked) {
    failures++;
    console.log(`FAIL  ${label}: expected ${wantBlocked ? 'blocked' : 'allowed'}, got exit ${r.status}`);
  } else {
    console.log(`ok    ${label}`);
  }
};

const read = (file_path, cwd = HOME) => ({ tool_name: 'Read', tool_input: { file_path }, cwd });
const grep = (input, cwd = HOME) => ({ tool_name: 'Grep', tool_input: input, cwd });
const bash = (command, cwd = HOME) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const pwsh = (command, cwd = HOME) => ({ tool_name: 'PowerShell', tool_input: { command }, cwd });

// --- the thing this exists to stop -------------------------------------------------
check('Read on a raw transcript', read(`${RAW}/2026-08-26-ep.txt`), true);
check('Read with backslashes', read('C:\\Users\\dev\\projects\\context-bank\\raw\\ep.txt'), true);
check('cat, full path', bash(`cat ${RAW}/ep.txt`), true);
check('head', bash(`head -200 "${RAW}/ep.txt"`), true);
check('sed -n range', bash(`sed -n "1,400p" ${RAW}/ep.txt`), true);
check('Get-Content', pwsh('Get-Content C:\\Users\\dev\\projects\\context-bank\\raw\\ep.txt'), true);
check('python -c open()', bash(`python -c "print(open('${RAW}/ep.txt').read())"`), true);
check('cp out of the bank then read elsewhere', bash(`cp ${RAW}/ep.txt /tmp/x.txt`), true);

// --- what version 1 let through (review findings 2, 3, 5) --------------------------
check('cd into the bank, relative raw/', bash('cat raw/*.txt', BANK), true);
check('cd into raw, bare glob', bash('cat *.txt', RAW), true);
check('relative from home is NOT the bank', bash('cat raw/ep.txt', HOME), false);
check('dot-slash relative', bash('cat ./raw/ep.txt', BANK), true);
check('ls shields cat behind &&', bash(`ls ${RAW}/ && cat ${RAW}/ep.txt`), true);
check('wc shields head', bash(`wc -l ${RAW}/ep.txt && head -500 ${RAW}/ep.txt`), true);
check('find -exec cat', bash(`find ${RAW} -name "*.txt" -exec cat {} +`), true);
check('find | xargs cat', bash(`find ${RAW}/ -name "*.txt" | xargs cat`), true);
check('semicolon after stat', bash(`stat ${RAW}/ep.txt; cat ${RAW}/ep.txt`), true);
check('cb.py mentioned in a comment', bash(`cat ${RAW}/ep.txt # cb.py`), true);
check('cb.py echoed first', bash(`echo cb.py; cat ${RAW}/ep.txt`), true);
check('script and transcript together', bash(`cat ${BANK}/cb.py ${RAW}/ep.txt`), true);

// --- the harness's own search tool (review finding 4) ------------------------------
check('Grep content mode in raw', grep({ pattern: 'agent', path: RAW, output_mode: 'content' }), true);
check('Grep content mode at bank root', grep({ pattern: 'agent', path: BANK, output_mode: 'content' }), true);
check('Grep listing filenames is fine', grep({ pattern: 'agent', path: RAW }), false);
check('Grep content elsewhere', grep({ pattern: 'agent', path: `${HOME}/projects/engage`, output_mode: 'content' }), false);

// --- must NOT fire: the false positives that would strand a session (finding 6) -----
check('git add the raw dir', bash(`git add ${RAW}/`), false);
check('git status', bash(`git status ${RAW}/`), false);
check('git diff', bash(`git diff -- ${RAW}/ep.txt`), false);
check('rm a transcript', bash(`rm ${RAW}/ep.txt`), false);
check('mv a transcript', bash(`mv ${RAW}/a.txt ${RAW}/b.txt`), false);
check('echo mentioning the path', bash(`echo "do not read ${RAW}/ep.txt"`), false);
check('meta.json via Read', read(`${RAW}/ep.meta.json`), false);
check('meta.json via cat', bash(`cat ${RAW}/ep.meta.json`), false);
check('head on meta.json', bash(`head -3 ${RAW}/ep.meta.json`), false);
check('meta.json AND a transcript is still blocked', bash(`cat ${RAW}/ep.meta.json ${RAW}/ep.txt`), true);
check('ls alone', bash(`ls ${RAW}/`), false);
check('wc alone', bash(`wc -l ${RAW}/ep.txt`), false);
check('cb.py search', bash(`python ${BANK}/cb.py search "agents guess"`), false);
check('cb.py add', bash(`python ${BANK}/cb.py add https://example.com/x`), false);
check('a playbook is not raw', read(`${BANK}/playbooks/attention.md`), false);
check('some other raw dir', bash(`cat ${HOME}/projects/other/raw/thing.txt`), false);
check('cat in an unrelated repo', bash('cat src/index.js', `${HOME}/projects/engage`), false);
check('malformed input', { tool_name: 'Read' }, false);
check('no tool_input at all', { tool_name: 'Bash' }, false);

// --- a heredoc body is prose, not a command (v2 blocked its own commit message) ---
const HD = (body, tail = '') => `git commit -F - <<'MSG'\n${body}\nMSG${tail}`;
check('heredoc quoting the example',
  bash(HD('it passed while `cd projects/context-bank && cat raw/*.txt` sailed through'), BANK), false);
check('heredoc does not shield a real read after it',
  bash(HD('notes', `\ncat ${RAW}/ep.txt`)), true);

// --- what version 2 let through (second review) ------------------------------------
// v2 resolved every segment against the SESSION cwd, so a `cd` in an earlier segment was
// invisible. Its own header quoted this exact command as the thing it had fixed.
check('cd then read, from home', bash('cd projects/context-bank && cat raw/*.txt'), true);
check('cd one level, from projects', bash('cd context-bank && head -50 raw/x.txt', `${HOME}/projects`), true);
check('cd into raw then read', bash('cd projects/context-bank/raw && cat *.txt'), true);
check('cd somewhere else entirely', bash('cd projects/engage && cat src/index.js'), false);

// Search verbs. An agent told to "search the bank" reaches for grep long before cb.py.
check('grep with huge context', bash(`grep -A999 agents ${RAW}/ep.txt`), true);
check('ripgrep', bash(`rg . ${RAW}/ep.txt`), true);
check('Select-String', pwsh('Select-String -Path raw/ep.txt -Context 999', BANK), true);
check('sort a transcript', bash(`sort ${RAW}/ep.txt`), true);

// git commands that print file contents, as opposed to the ones that print status.
check('git show', bash(`git show HEAD:raw/ep.txt`, BANK), true);
check('git log -p', bash(`git log -p -- ${RAW}/`), true);
check('git blame', bash(`git blame ${RAW}/ep.txt`), true);
check('git diff --stat still fine', bash(`git diff --stat -- ${RAW}/`), false);

// A bare directory name has no slash and no extension, so v2's token regex missed it.
check('list the dir, pipe into a reader', pwsh('Get-ChildItem raw | Get-Content', BANK), true);
check('ls piped to xargs cat', bash('ls raw | xargs cat', BANK), true);

// Other interpreters. v2 covered python -c only.
check('node -e', bash(`node -e "console.log(require('fs').readFileSync('${RAW}/ep.txt','utf8'))"`), true);
check('py -c', bash(`py -c "print(open('${RAW}/ep.txt').read())"`), true);
check('Import-Csv', pwsh('Import-Csv raw/ep.txt', BANK), true);
check('[IO.File]::ReadAllText', pwsh('[IO.File]::ReadAllText("raw/ep.txt")', BANK), true);

// Copying is blocked on purpose. The refusal message has to say so, or it strands a session.
check('cp the whole dir out', bash(`cp -r ${RAW}/ /c/backup/`), true);

// PowerShell here-strings are how ~/CLAUDE.md says to pass a multi-line commit message, so
// the same self-blocking-commit bug lived on the other shell.
const HS = (body) => `git commit -F - @'\n${body}\n'@`;
check('PowerShell here-string quoting the example',
  pwsh(HS('v1 passed while `cd projects/context-bank && cat raw/*.txt` sailed through'), BANK), false);

// Reading a playbook is the entire point of the bank. v2 blocked content-grep across the
// whole repo, with a message saying the agent had read a transcript.
check('Grep content on the playbooks', grep({ pattern: 'Do:', path: `${BANK}/playbooks`, output_mode: 'content' }), false);
check('Grep content on one playbook file', grep({ pattern: 'Do:', path: `${BANK}/playbooks/offers.md`, output_mode: 'content' }), false);
check('Grep content at the bank root is still blocked', grep({ pattern: 'x', path: BANK, output_mode: 'content' }), true);
check('Grep content at the published bank root is blocked too',
  grep({ pattern: 'x', path: `${HOME}/.claude/skills/bank`, output_mode: 'content' }), true);
check('a directory merely called bank is not the bank',
  grep({ pattern: 'x', path: `${HOME}/myskills/bank`, output_mode: 'content' }), false);

// --- what version 3 let through, or blocked wrongly (third review) -----------------
// A reading verb only counts as the command WORD of its stage. v3 matched it anywhere in the
// text, and blocked a printf whose message happened to contain the word "Grep".
check('printf writing a doc that mentions grep and raw/',
  bash(`printf 'Grep skips raw/ now' > .ignore`, BANK), false);
check('echo the word cat next to the path', bash(`echo "do not cat ${RAW}/ep.txt"`), false);

// A quote or a paren in front of the verb used to slip past the whitespace anchor.
check('command substitution', bash(`echo $(cat ${RAW}/ep.txt)`), true);
check('backticks', bash('echo `cat raw/ep.txt`', BANK), true);
check('sh -c wrapper', bash(`sh -c "cat ${RAW}/ep.txt"`), true);
check('xargs -I{} sh -c', bash('ls raw | xargs -I{} sh -c "cat raw/{}"', BANK), true);

// A loop hands the path to the reader in a variable, so the reading segment names no path.
check('for loop over the glob', bash('for f in raw/*.txt; do cat "$f"; done', BANK), true);
check('a loop somewhere else is untouched',
  bash('for f in src/*.js; do cat "$f"; done', `${HOME}/projects/engage`), false);

// A pipe is not a boundary, but a later stage only inherits the path when it reads FILES off
// stdin. v3 refused `ls -la raw/ | head` with a message saying listing was allowed.
check('ls piped into head is a listing', bash('ls -la raw/ | head', BANK), false);
check('git ls-files piped into head', bash('git ls-files raw | head', BANK), false);
check('ls piped into sort', bash('ls raw | sort', BANK), false);
check('ls piped into xargs cat still blocked', bash('ls raw | xargs cat', BANK), true);

// More verbs that print content.
for (const v of ['diff', 'cut -c1-200', 'tac', 'base64', 'xxd', 'fold', 'tr a b',
                 'zcat', 'tee', 'pr', 'rev', 'column', 'hexdump', 'shuf', 'comm'])
  check(`${v.split(' ')[0]} on a transcript`, bash(`${v} ${RAW}/ep.txt`), true);

// grep flags that print names or counts are a listing.
check('grep -c counts', bash(`grep -c agents ${RAW}/ep.txt`), false);
check('grep -rl names files', bash(`grep -rl agents ${RAW}/`), false);
check('grep --include of the sidecars', bash(`grep -r x ${RAW} --include=*.meta.json`), false);
check('grep -A5 still reads', bash(`grep -A5 agents ${RAW}/ep.txt`), true);

// The bare `raw` token is a path only as an argument to a listing verb. v3 fired on the word.
check('grep for the word raw in a playbook', bash('grep -n raw INDEX.md', BANK), false);
check('head a doc with raw in a comment', bash('head -5 INDEX.md # about raw', BANK), false);

// A sed script is not a path. `RAW/p` inside a range expression read as one, and refused.
check('sed range expression naming RAW', bash(`sed -n '/same = /,/out = RAW/p' cb.py`, BANK), false);
check('a real .txt is still a path', bash('cat raw/whatever.txt', BANK), true);

// --- what version 4 let through, or blocked wrongly (fourth review) ----------------
// PowerShell is the primary shell here and ForEach-Object is how it writes a read that needs
// $_. Matching the verb as a command word stopped seeing these; the substring match had.
check('ForEach-Object', pwsh('Get-ChildItem raw | ForEach-Object { Get-Content $_ }', BANK), true);
check('the % alias', pwsh('Get-ChildItem raw | %{ Get-Content $_.FullName }', BANK), true);
check('foreach statement', pwsh('foreach($f in Get-ChildItem raw){ Get-Content $f }', BANK), true);
check('fully qualified type name', pwsh('[System.IO.File]::ReadAllText("raw/ep.txt")', BANK), true);

check('env assignment in front', bash(`LC_ALL=C cat ${RAW}/ep.txt`), true);
check('subshell parentheses', bash(`(cat ${RAW}/ep.txt)`), true);
check('git -C', bash(`git -C ${RAW} show HEAD:ep.txt`), true);
check('perl -pe', bash(`perl -pe 1 ${RAW}/ep.txt`), true);
check('python -m', bash(`python -m json.tool ${RAW}/ep.txt`), true);
check('xargs -a', bash(`xargs -a ${RAW}/ep.txt echo`), true);

// Grepping for the STRING context-bank/raw is not reading a transcript. The maintainer of
// this hook hits that on their first search, and v4 refused it.
check('grep for the path as a string', bash(`grep -n 'context-bank/raw' bank-raw-guard.mjs`,
  `${HOME}/.claude/hooks`), false);
check('grep -rn for the path across the hooks dir',
  bash(`grep -rn 'projects/context-bank/raw' ${HOME}/.claude/hooks`), false);
check('rg -l on raw is a listing', bash(`rg -l agents ${RAW}/`), false);
check('ag -l on raw is a listing', bash(`ag -l agents ${RAW}/`), false);
check('a loop that reads playbooks, after an unrelated ls',
  bash('ls raw/ ; for f in playbooks/*.md; do cat $f; done', BANK), false);

// --- the published layout: cb.py copied into a skills/bank/ directory ---------------
// The public repo ships cb.py inside the skill, so its raw/ lands one directory name over.
// Guarding only `context-bank/raw` meant the shipped hook did not guard the shipped script.
const ALT = `${HOME}/.claude/skills/bank/raw`;
mkdirSync(ALT, { recursive: true });
writeFileSync(`${ALT}/ep.txt`, 'transcript');
check('published layout, read', read(`${ALT}/ep.txt`), true);
check('published layout, cat', bash(`cat ${ALT}/ep.txt`), true);
check('published layout, sidecar still readable', read(`${ALT}/ep.meta.json`), false);
check('a bank playbook is not raw', read(`${HOME}/.claude/skills/bank/playbooks/attention.md`), false);

// --- the refusal has to name the replacement, or the agent retries another way ------
const msg = run(read(`${RAW}/ep.txt`)).stderr;
for (const want of ["cb.py search", "INDEX.md", "12 hits", ".meta.json", "Copying"]) {
  if (!msg.includes(want)) { failures++; console.log(`FAIL  message missing ${want}`); }
}
if (!failures) console.log('ok    message names the replacement and the exemptions');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
