#!/usr/bin/env node
// PostToolUse hook: a phone push the moment new content lands in the Buffer queue.
//
// Real event, not an invented one: mcp__claude_ai_Buffer__create_post is the one and only
// call site that schedules a post. It already sits on the matcher list in settings.json
// (shared with queue-loop-check.mjs, which reacts to the same tool call for a different
// reason). This hook just adds a second reaction to the same event: telling your phone what
// got queued, so a scheduling agent running unattended is not a black box.
//
// PostToolUse only, never Stop: this never blocks anything, so it always exits 0 and does
// its one job, notify best-effort, then gets out of the way.
//
// Needs notify.mjs alongside it, and a topic configured there.

import { readFileSync } from 'node:fs';
import { notify } from './notify.mjs';

const bail = () => process.exit(0);

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads below
// would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

if (String(input.hook_event_name || '') !== 'PostToolUse') bail();
if (!/Buffer__create_post$/.test(String(input.tool_name || ''))) bail();

const ti = input.tool_input || {};
const mode = ti.mode || 'addToQueue';
const when = ti.dueAt
  ? `scheduled for ${ti.dueAt}`
  : mode === 'shareNow' ? 'posting now'
  : mode === 'shareNext' ? 'next open slot'
  : 'queued';
const text = String(ti.text || '').trim().slice(0, 300);

await notify(
  'New content scheduled in Buffer',
  `${when}${text ? `\n\n${text}` : ''}`,
  { tags: 'calendar' }
).catch(() => {});
