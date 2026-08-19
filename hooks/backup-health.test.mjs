#!/usr/bin/env node
// Unit test for backup-health.mjs assess(). Runs the pure decision logic across
// every branch without touching Windows Task Scheduler. Run: node backup-health.test.mjs
import { strict as assert } from 'node:assert';
import { assess } from './backup-health.mjs';

const now = Date.parse('2026-07-24T12:00:00Z');
const h = n => now - n * 3.6e6;

// Healthy: result 0, ran recently -> no warning.
assert.equal(assess({ found: true, result: 0, lastRun: h(10) }, now), null);
assert.equal(assess({ found: true, result: 0, lastRun: h(25.9) }, now), null); // just under threshold

// Failed run: nonzero result -> warns, and renders the code as hex.
{
  const w = assess({ found: true, result: 1, lastRun: h(10) }, now);
  assert.ok(w && w.includes('FAILED') && w.includes('0x1'), w);
}

// Stale: ran too long ago -> warns with an age.
{
  const w = assess({ found: true, result: 0, lastRun: h(30) }, now);
  assert.ok(w && w.includes('not run') && w.includes('~30h'), w);
}

// Garbled query: non-finite result -> fail open, no nag (never nag on our own bug).
assert.equal(assess({ found: true, result: NaN, lastRun: h(10) }, now), null);

// Missing task entirely -> warns.
assert.ok(assess({ found: false }, now).includes('MISSING'));

// No recorded run time -> warns.
assert.ok(assess({ found: true, result: 0, lastRun: null }, now));

// Large/unsigned result code renders without a negative sign. Assert on the rendered code
// itself rather than on the whole message: the message interpolates BACKUP_LOG_HINT, so a
// blanket "no hyphen anywhere" check fails spuriously for anyone whose log path has one.
{
  const w = assess({ found: true, result: 267009, lastRun: h(10) }, now);
  assert.ok(w && w.includes('FAILED') && w.includes('0x41301') && !/0x-/.test(w), w);
}

console.log('ALL PASS');
