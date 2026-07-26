#!/usr/bin/env node
// Self-check for check-baseline.mjs. Builds a throwaway tree in the OS temp dir,
// runs the real script against it, asserts the exit code and the findings.
//   node scripts/check-baseline.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SCRIPT = fileURLToPath(new URL('./check-baseline.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'check-baseline-'));

const GOOD_CSS = `
html { color-scheme: dark; }
a, button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
:focus-visible { outline: 2px solid #4c8dff; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; }
}
`;

function site(name, files) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
  return dir;
}

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ok  ' + label);
}

// A page that links a compliant sheet by root-relative href passes.
const good = site('good', {
  'site.css': GOOD_CSS,
  'index.html': '<meta name="theme-color" content="#0b0b0f">\n' +
    '<link rel="stylesheet" href="/site.css">\n<h1>ok</h1>',
});
check('compliant page passes', () => {
  const r = run(good);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /clean across 1 page/);
});

// A page with no meta tag and no stylesheet fails all five rules, and the
// `transition: all` in the sheet is reported once for the site.
const bad = site('bad', {
  'site.css': GOOD_CSS + '\n.c { transition: all .2s ease; }',
  'index.html': '<h1>bare</h1>',
});
check('missing baseline fails with one finding per rule', () => {
  const r = run(bad);
  assert.equal(r.code, 1);
  for (const want of [
    'missing <meta name="theme-color">',
    'missing color-scheme declaration',
    'missing prefers-reduced-motion block',
    'missing touch-action on controls',
    'missing -webkit-tap-highlight-color',
    'missing :focus-visible ring',
    'uses "transition: all"',
  ]) assert.ok(r.out.includes(want), `expected finding: ${want}\n${r.out}`);
});

// The per-page scoping that matters: a sibling's compliant stylesheet must not
// cover for a page that does not link it.
const sibling = site('sibling', {
  'site.css': GOOD_CSS,
  'index.html': '<meta name="theme-color" content="#000">\n' +
    '<link rel="stylesheet" href="site.css">\n<h1>linked</h1>',
  '404.html': '<meta name="theme-color" content="#000">\n<h1>not linked</h1>',
});
check('a sibling stylesheet does not cover an unlinked page', () => {
  const r = run(sibling);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('404.html: missing color-scheme declaration'), r.out);
  assert.ok(!r.out.includes('index.html: missing'), 'the linking page should pass\n' + r.out);
});

check('a missing root is a failure, not a crash', () => {
  const r = run(join(root, 'nope'));
  assert.equal(r.code, 1);
  assert.match(r.out, /not found/);
});

check('no arguments exits 2 with usage', () => {
  const r = run();
  assert.equal(r.code, 2);
  assert.match(r.out, /usage:/);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} checks passed.`);
