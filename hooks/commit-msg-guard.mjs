#!/usr/bin/env node
// PreToolUse hook (Bash|PowerShell): stop a git commit whose message is built with
// PowerShell here-string syntax (@'...'@ or @"..."@) inside the Bash tool.
//
// Why: 2026-07-24, two separate agents in one day ran, in the *Bash* tool,
//   git commit -m @'
//   Subject
//   ...
//   '@
// That is PowerShell. In POSIX sh the `@` is a literal character, so the arg to -m
// becomes "@" + newline + body + "@": every such commit subject came out as a lone
// "@" line above the real subject, needing an --amend to clean up. The machine runs
// PowerShell as the primary shell, so the muscle memory is understandable and keeps
// recurring; a doc note nobody loads would not have caught it.
//
// Mechanism: only in the Bash tool, only for a `git commit` whose message flag is
// immediately followed by a here-string opener. Deny with the correct heredoc form.
// The PowerShell tool is left alone because @'...'@ is exactly right there.

import { readFileSync } from 'node:fs';

const bail = () => process.exit(0); // any doubt, stay out of the way

let input;
// `|| {}` matters: JSON.parse succeeds on the literal `null`, and the property reads below
// would then throw a stack trace into the transcript instead of exiting quietly.
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { bail(); }

// This same hook is wired for Bash and PowerShell. The bug only exists in Bash;
// @'...'@ is valid PowerShell, so never second-guess it there.
if (input.tool_name !== 'Bash') bail();

// String(): a non-string `command` (a number, an object) would otherwise reach .includes()
// below and throw a TypeError into the transcript. Every sibling hook coerces the same way.
const command = String((input.tool_input || {}).command || '');
if (!command.includes('git') || !/\bgit\b[\s\S]*\bcommit\b/.test(command)) bail();

// A message/file flag (-m, --message, -F, --file, -C, --reuse-message) whose value
// starts with a PowerShell here-string opener: @' or @". Allowing `=` or whitespace
// between the flag and the value covers -m @'…', --message=@"…", -F @'….
const HERESTRING_MSG = /(?:^|\s)(?:-m|--message|-F|--file|-C|--reuse-message)(?:=|\s+)@['"]/;

if (!HERESTRING_MSG.test(command)) bail();

const msg = [
  'Stray-@ guard: that commit uses PowerShell here-string syntax (@\'...\'@) in the Bash tool.',
  'In POSIX sh the @ is literal, so your commit subject will come out as a lone "@" line',
  'above the real subject and need an --amend to fix. This has bitten two sessions already.',
  '',
  'Use a real heredoc instead (the closing word must be at column 0):',
  '',
  "  git commit -F - <<'MSG'",
  '  Subject line',
  '',
  '  Body paragraph.',
  '',
  '  Co-Authored-By: ...',
  '  MSG',
  '',
  "Or, for a short message, -m $'line one\\nline two' (ANSI-C quoting expands the \\n).",
  '',
  'Re-run with one of those and it will go through. This is not a permission prompt.',
].join('\n');

process.stderr.write(msg + '\n');
process.exit(2);
