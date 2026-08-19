// Drives commit-msg-guard.mjs against the mistake it exists to catch: a PowerShell here-string
// used as a commit message inside the Bash tool. Blocks (exit 2) only on that exact shape, and
// must stay out of the way of every ordinary commit and of the PowerShell tool.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'commit-msg-guard.mjs');

let fails = 0;
function ck(label, ok) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${label}`);
}

const fire = (command, tool = 'Bash') => {
  const r = spawnSync(NODE, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stderr || '' };
};

console.log('\nBLOCKS the here-string forms (want exit 2):');
for (const [label, cmd] of [
  ["-m @'", "git commit -m @'\nSubject\n'@"],
  ['-m @"', 'git commit -m @"\nSubject\n"@'],
  ["--message=@'", "git commit --message=@'\nSubject\n'@"],
  ["-F @'", "git commit -F @'\nSubject\n'@"],
  ["-C @'", "git commit -C @'\nSubject\n'@"],
  ['chained after another command', "cd repo && git commit -m @'\nSubject\n'@"],
  ['flags between git and commit', "git -C /repo commit -m @'\nSubject\n'@"],
]) {
  const r = fire(cmd);
  ck(`(exit ${r.code})  ${label}`, r.code === 2);
}

console.log('\nSTAYS OUT OF THE WAY (want exit 0):');
for (const [label, cmd, tool] of [
  ['an ordinary quoted message', 'git commit -m "Fix the thing"'],
  ['a real heredoc', "git commit -F - <<'MSG'\nSubject\nMSG"],
  ['ANSI-C quoting', "git commit -m $'line one\\nline two'"],
  ['an @ inside a normal message', 'git commit -m "@ me about this"'],
  ['an email trailer in a message', 'git commit -m "Thanks to a@b.com"'],
  ['not a commit at all', 'git log --format=%H'],
  ['no git in the command', "echo @'not a commit'@"],
  ['git add, not commit', 'git add -A'],
  ['the SAME here-string in the PowerShell tool, where it is correct',
    "git commit -m @'\nSubject\n'@", 'PowerShell'],
]) {
  const r = fire(cmd, tool);
  ck(`(exit ${r.code})  ${label}`, r.code === 0);
}

console.log('\nTHE MESSAGE IS ACTIONABLE:');
{
  const r = fire("git commit -m @'\nSubject\n'@");
  ck('hands back the heredoc form', /git commit -F - <<'MSG'/.test(r.out));
  ck('says the closing word goes at column 0', /column 0/.test(r.out));
  ck('says it is not a permission prompt', /not a permission prompt/.test(r.out));
}

console.log('\nNEVER HARD-ERRORS (want exit 0, no stack trace):');
for (const [label, body] of [
  ['malformed stdin', 'not json'],
  ['empty payload', '{}'],
  ['literal null payload', 'null'],
  ['tool_input missing', '{"tool_name":"Bash"}'],
  ['command is not a string', '{"tool_name":"Bash","tool_input":{"command":42}}'],
]) {
  const r = spawnSync(NODE, [HOOK], { input: body, encoding: 'utf8' });
  const clean = r.status === 0 && !/TypeError|SyntaxError/.test(r.stderr || '');
  if (!clean) fails++;
  console.log(`  ${clean ? 'PASS' : '**FAIL**'} (exit ${r.status})  ${label}`);
}

console.log(fails === 0 ? '\nALL PASS.' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
