#!/usr/bin/env node
// Phone push via ntfy.sh. The topic is read from one shared file rather than pasted into
// every job that wants to send a push, so rotating it stays a one-edit change no matter how
// many scripts, workflows and hooks are sending.
//
// Usage as a module:  import { notify } from './notify.mjs'; await notify('title', 'body', opts)
// Usage as a CLI:      node notify.mjs "title" "body" [priority] [tags]
// Self-check:          node notify.mjs --self-test   (no network call, no topic required)
//
// Configure with either:
//   NTFY_TOPIC=your-topic-here          (wins if set)
//   NTFY_TOPIC_FILE=/path/to/topic.txt  (defaults to ~/.ntfy-topic)
//
// Silent no-op when no topic is configured. A hook must never fail a session over a missing
// phone-notification setup. ponytail: best-effort only, no retry and no queue; a missed push
// is findable later in the transcript, so this trades reliability for staying out of the way.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOPIC_FILE = process.env.NTFY_TOPIC_FILE || join(homedir(), '.ntfy-topic');

export function resolveTopic(env = process.env) {
  if (env.NTFY_TOPIC) return env.NTFY_TOPIC.trim() || null;
  try {
    const t = readFileSync(TOPIC_FILE, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

export async function notify(title, message, { priority = 'default', tags } = {}) {
  const topic = resolveTopic();
  if (!topic) return { sent: false, reason: 'no topic configured' };
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: String(message ?? '').slice(0, 3800),
      headers: {
        ...(title ? { Title: String(title).slice(0, 200) } : {}),
        ...(tags ? { Tags: String(tags) } : {}),
        Priority: String(priority),
      },
      signal: AbortSignal.timeout(8000),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

// --- CLI + self-test -------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);

  if (args[0] === '--self-test') {
    // Pure logic only, no network: proves topic resolution and precedence without needing a
    // real topic configured or sending a real push on every run.
    const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } };

    assert(resolveTopic({}) === null || typeof resolveTopic({}) === 'string',
      'resolveTopic with empty env must not throw');
    assert(resolveTopic({ NTFY_TOPIC: 'abc' }) === 'abc',
      'env var must win over the topic file');
    assert(resolveTopic({ NTFY_TOPIC: '  ' }) !== '  ',
      'whitespace-only env var must not be treated as a real topic');

    if (process.exitCode !== 1) console.log('notify.mjs self-test: ok');
    process.exit(process.exitCode || 0);
  }

  const [title, message, priority, tags] = args;
  if (!title) {
    console.error('usage: node notify.mjs "title" "message" [priority] [tags]');
    process.exit(1);
  }
  const r = await notify(title, message || '', { priority: priority || 'default', tags });
  console.log(JSON.stringify(r));
  process.exit(r.sent ? 0 : (r.reason === 'no topic configured' ? 0 : 1));
}
