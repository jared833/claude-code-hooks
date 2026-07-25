// Drives the deploy-recheck hook against the incident scenario.
// Deploy strings live here, never in the outer Bash command, so if you run this while the
// hook itself is active in your own session, writing this file cannot trip it.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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
// A POSIX path from a Bash shell is not a Windows path. An earlier version of this hook
// resolved /tmp/deploy against the current drive root, found nothing, silently fell back to
// cwd, and printed that listing as though it were the deploy contents. On POSIX hosts these
// same cases exercise the ordinary path, which is the point: the behavior should not differ.
console.log('POSIX PATHS AND UNRESOLVABLE ARGUMENTS:');
rmSync(TOKENS, { recursive: true, force: true });
const posixDir = join(tmpdir(), 'drt-posix-target');
rmSync(posixDir, { recursive: true, force: true });
mkdirSync(posixDir, { recursive: true });
writeFileSync(join(posixDir, 'only-here.html'), 'x');
const posix = fire(join(S, 'repo'), `npx wrangler pages ${D} /tmp/drt-posix-target --project-name=x`);
const foundIt = posix.out.includes('only-here.html') && !posix.out.includes('stale-1.html');
console.log(`  ${foundIt ? 'PASS' : '**FAIL**'} a /tmp path is resolved and its real contents listed`);
if (!foundIt) fails++;
rmSync(posixDir, { recursive: true, force: true });

rmSync(TOKENS, { recursive: true, force: true });
const bogus = fire(join(S, 'repo'), `npx wrangler pages ${D} /tmp/drt-does-not-exist --project-name=x`);
const admits = bogus.out.includes('WARNING') && bogus.out.includes('is NOT what');
console.log(`  ${admits ? 'PASS' : '**FAIL**'} an unresolvable path argument is admitted, not hidden behind cwd`);
if (!admits) fails++;

// An argument naming a real FILE is not missing. Calling it missing would be this hook
// asserting something untrue in the one place it has to be trusted.
rmSync(TOKENS, { recursive: true, force: true });
writeFileSync(join(S, 'repo/assets/app.zip'), 'zip');
const fileArg = fire(join(S, 'repo'), 'gh release upload v1 assets/app.zip');
const quietOnFile = !fileArg.out.includes('WARNING');
console.log(`  ${quietOnFile ? 'PASS' : '**FAIL**'} an existing file argument is not called missing`);
if (!quietOnFile) fails++;

// Bare /tmp is mapped to nothing on purpose, so it warns rather than walking a whole temp
// tree whose churn would change the fingerprint on every attempt and never allow the retry.
rmSync(TOKENS, { recursive: true, force: true });
const bare1 = fire(join(S, 'repo'), `npx wrangler pages ${D} /tmp --project-name=x`);
const bare2 = fire(join(S, 'repo'), `npx wrangler pages ${D} /tmp --project-name=x`);
const bareOk = bare1.code === 2 && bare2.code === 0 && bare1.out.includes('WARNING');
console.log(`  ${bareOk ? 'PASS' : '**FAIL**'} bare /tmp warns and still allows the retry (${bare1.code}, ${bare2.code})`);
if (!bareOk) fails++;

// Windows only: the mapped candidate must be tried BEFORE resolve(cwd, token), or a stray
// C:\tmp\x shadows the real target and the wrong folder gets listed all over again. This was
// a real bug in the first version of the fix, caught in review.
if (process.platform === 'win32') {
  rmSync(TOKENS, { recursive: true, force: true });
  const cTmpExisted = existsSync('C:/tmp');
  const decoy = 'C:/tmp/drt-collide';
  const real = join(tmpdir(), 'drt-collide');
  rmSync(decoy, { recursive: true, force: true });
  rmSync(real, { recursive: true, force: true });
  mkdirSync(decoy, { recursive: true });
  mkdirSync(real, { recursive: true });
  writeFileSync(join(decoy, 'DECOY-wrong-dir.txt'), 'x');
  writeFileSync(join(real, 'REAL-payload.html'), 'x');
  const collide = fire(join(S, 'repo'), `npx wrangler pages ${D} /tmp/drt-collide --project-name=x`);
  const rightOne = collide.out.includes('REAL-payload.html') && !collide.out.includes('DECOY-wrong-dir.txt');
  console.log(`  ${rightOne ? 'PASS' : '**FAIL**'} a decoy C:\\tmp\\x does not shadow the real /tmp/x`);
  if (!rightOne) fails++;
  rmSync(decoy, { recursive: true, force: true });
  rmSync(real, { recursive: true, force: true });
  // Leave no C:\tmp behind if this test created it: a stray one changes what the bare /tmp
  // case above resolves to, which is how this suite first went green on one machine only.
  if (!cTmpExisted) rmSync('C:/tmp', { recursive: true, force: true });
}


rmSync(S, { recursive: true, force: true });
rmSync(TOKENS, { recursive: true, force: true });
console.log(fails === 0 ? '\nALL PASS. scratch cleaned.' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
