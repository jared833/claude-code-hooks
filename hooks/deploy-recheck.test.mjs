// Drives the deploy-recheck hook against the incident scenario.
// Deploy strings live here, never in the outer Bash command, so if you run this while the
// hook itself is active in your own session, writing this file cannot trip it.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'deploy-recheck.mjs');
const S = join(tmpdir(), 'deploy-recheck-test');
// Must match the hook's own token directory (os.tmpdir() + 'claude-deploy-recheck').
const TOKENS = join(tmpdir(), 'claude-deploy-recheck');

const D = String.fromCharCode(100, 101, 112, 108, 111, 121); // keep the literal out of greps

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });

// Rebuild the incident: a git repo where another session dropped untracked files + vendor/.
rmSync(S, { recursive: true, force: true });
rmSync(TOKENS, { recursive: true, force: true });
mkdirSync(join(S, 'repo/vendor'), { recursive: true });
mkdirSync(join(S, 'plain/assets'), { recursive: true });
mkdirSync(join(S, 'spaced dir'), { recursive: true });
git(['init', '-q', '.'], join(S, 'repo'));
git(['config', 'user.email', 't@t.t'], join(S, 'repo'));
git(['config', 'user.name', 't'], join(S, 'repo'));
writeFileSync(join(S, 'repo/index.html'), '<h1>real</h1>');
mkdirSync(join(S, 'repo/assets'), { recursive: true });
writeFileSync(join(S, 'repo/assets/site.css'), 'body{}');
git(['add', '-A'], join(S, 'repo'));
git(['commit', '-qm', 'init'], join(S, 'repo'));
for (const f of ['stale-1.html', 'stale-2.html', 'stale-3.html', 'stale-4.js'])
  writeFileSync(join(S, 'repo', f), 'stale');
writeFileSync(join(S, 'repo/vendor/lib.js'), 'vendored');
writeFileSync(join(S, 'repo/assets/site.css'), 'body{}\n/* edited */');
writeFileSync(join(S, 'plain/index.html'), 'hi');
writeFileSync(join(S, 'plain/assets/a.js'), 'x');
writeFileSync(join(S, 'spaced dir/index.html'), 'hi');

function fire(cwd, command, tool = 'Bash') {
  const r = spawnSync(NODE, [HOOK], { input: JSON.stringify({ tool_name: tool, cwd, tool_input: { command } }), encoding: 'utf8' });
  return { code: r.status, out: r.stderr || '' };
}

let fails = 0;
function t(label, cwd, command, want, tool) {
  // Each case is independent: no leftover allow token from a prior case.
  rmSync(TOKENS, { recursive: true, force: true });
  const { code } = fire(cwd, command, tool);
  const ok = code === want;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} (exit ${code}, want ${want})  ${label}`);
}

console.log('FIRES on directory publishes (want exit 2):');
t('the incident command, npx wrangler pages ' + D + ' .', join(S, 'repo'), `npx wrangler pages ${D} .`, 2);
t('same via PowerShell tool', join(S, 'repo'), `wrangler pages ${D} .`, 2, 'PowerShell');
t('aws s3 sync into non-git dir', join(S, 'plain'), 'aws s3 sync . s3://bucket', 2);
t('path with spaces', S, `wrangler pages ${D} "spaced dir"`, 2);
t('no dir arg, bare wrangler ' + D, join(S, 'plain'), `wrangler ${D}`, 2);
t('netlify --dir=./assets', join(S, 'plain'), `netlify ${D} --dir=./assets --prod`, 2);
t('chained after a real build step', join(S, 'repo'), `npm run build && npx wrangler pages ${D} .`, 2);
t('rsync', join(S, 'plain'), 'rsync -av ./assets/ u@h:/srv', 2);
t('gh release upload', join(S, 'plain'), 'gh release upload v1 ./assets', 2);
t('aws s3 cp --recursive', join(S, 'plain'), 'aws s3 cp ./assets s3://b --recursive', 2);
t('inline env var in front (bypass regression)', join(S, 'repo'), `TOKEN=x wrangler pages ${D} .`, 2);
t('path-prefixed binary (bypass regression)', join(S, 'repo'), `./node_modules/.bin/wrangler pages ${D} .`, 2);

console.log('STAYS QUIET on everything else (want exit 0):');
t('ls', join(S, 'repo'), 'ls', 0);
t('git status', join(S, 'repo'), 'git status --porcelain', 0);
t('cat', join(S, 'repo'), 'cat index.html', 0);
t('grep for rsync', join(S, 'repo'), 'grep -rn rsync .', 0);
t('echo of a ' + D + ' command', join(S, 'repo'), `echo wrangler pages ${D} .`, 0);
t(D + ' string inside a quoted arg', join(S, 'repo'), `mytest "npm run build && npx wrangler pages ${D} ." 2 Bash`, 0);
t('single-file s3 cp, no --recursive', join(S, 'plain'), 'aws s3 cp index.html s3://b', 0);
t('npm run build', join(S, 'repo'), 'npm run build', 0);
t('deployment list is not a deploy', join(S, 'repo'), `wrangler pages ${D}ment list`, 0);

console.log('EDGE CASES (must never hard-error):');
{
  const r = spawnSync(NODE, [HOOK], { input: 'not json', encoding: 'utf8' });
  console.log(`  ${r.status === 0 ? 'PASS' : '**FAIL**'} (exit ${r.status})  malformed stdin`);
  if (r.status !== 0) fails++;
}
{
  const r = spawnSync(NODE, [HOOK], { input: '{}', encoding: 'utf8' });
  console.log(`  ${r.status === 0 ? 'PASS' : '**FAIL**'} (exit ${r.status})  empty payload`);
  if (r.status !== 0) fails++;
}

console.log('RETRY SEMANTICS:');
rmSync(TOKENS, { recursive: true, force: true });
const first = fire(join(S, 'repo'), `npx wrangler pages ${D} .`);
console.log(`  ${first.code === 2 ? 'PASS' : '**FAIL**'} first attempt denied with listing`);
if (first.code !== 2) fails++;
const retry = fire(join(S, 'repo'), `npx wrangler pages ${D} .`);
console.log(`  ${retry.code === 0 ? 'PASS' : '**FAIL**'} identical retry allowed (dir unchanged)`);
if (retry.code !== 0) fails++;
fire(join(S, 'repo'), `npx wrangler pages ${D} .`);
writeFileSync(join(S, 'repo/late-arrival.html'), 'another session just wrote this');
const changed = fire(join(S, 'repo'), `npx wrangler pages ${D} .`);
console.log(`  ${changed.code === 2 ? 'PASS' : '**FAIL**'} retry DENIED again after dir changed under it`);
if (changed.code !== 2) fails++;
console.log(`  ${changed.out.includes('late-arrival.html') ? 'PASS' : '**FAIL**'} fresh listing names the new file`);
if (!changed.out.includes('late-arrival.html')) fails++;

console.log('INCIDENT FILES SURFACED IN THE DENY MESSAGE:');
rmSync(TOKENS, { recursive: true, force: true });
const msg = fire(join(S, 'repo'), `npx wrangler pages ${D} .`).out;
for (const f of ['stale-1.html', 'stale-2.html', 'stale-3.html', 'stale-4.js', 'vendor/lib.js']) {
  const seen = msg.includes(f) && msg.includes('UNTRACKED');
  console.log(`  ${seen ? 'PASS' : '**FAIL**'} ${f} flagged as untracked`);
  if (!seen) fails++;
}

rmSync(S, { recursive: true, force: true });
rmSync(TOKENS, { recursive: true, force: true });
console.log(fails === 0 ? '\nALL PASS. scratch cleaned.' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
