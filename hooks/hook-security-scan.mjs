#!/usr/bin/env node
// SessionStart hook: nag when the always-loaded Claude Code config (settings.json,
// settings.local.json, ~/.claude.json's MCP servers, the hook scripts themselves) has a
// concrete, pattern-matchable security problem. `node hook-security-scan.mjs --full [dir]`
// runs the same checks by hand, prints everything including low-severity notes, and can
// also scan one project's .mcp.json.
//
// Why: looked at github.com/affaan-m/ECC's AgentShield (github.com/affaan-m/agentshield) for
// ideas on 2026-08-08. Its actual detection is plain regex/pattern matching over config text,
// not an LLM call -- genuinely portable without installing the rest of that framework. This
// is the same idea at a size that fits one operator's setup: a fixed, short rule list against
// files that already exist here, no rule database, no policy packs, no SARIF reports.
//
// Scope: the SessionStart nag only covers global config, because that is what every session
// inherits regardless of which project it opens, so it is the highest blast radius per finding.
// Per-project .mcp.json files are numerous and low-blast-radius individually; `--full <dir>`
// covers one on demand instead of re-scanning every project on every session start.
//
// Same shape as backup-health.mjs: fail open on any read error, exit 2 with a stderr notice
// that persists across sessions until fixed (SessionStart cannot block), exit 0 silent when
// clean. Only CRITICAL/HIGH/MEDIUM findings nag; INFO-level notes (e.g. a hook making an
// outbound network call at all) only show under --full, because plenty of these hooks are
// SUPPOSED to call ntfy or Buffer and flagging that every session would get it tuned out.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');

const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key header', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    // `["']?` between the key name and the colon: this runs against both JS source
    // (unquoted keys) and JSON text (quoted keys, e.g. an MCP server's "env" block), and a
    // literal fixture string is exactly how the test for this rule caught it missing JSON.
    name: 'inline secret assignment',
    re: /\b(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
  },
];

const NETWORK_CALL = /\bfetch\(|(?:^|\s)curl\s|Invoke-WebRequest|Invoke-RestMethod|axios\./;
const SHELL_COMMANDS = new Set(['sh', 'bash', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// findings: { severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'INFO', where, what }
function scanTextForSecrets(where, text, findings) {
  if (!text) return;
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) findings.push({ severity: 'CRITICAL', where, what: `looks like a hardcoded ${name}` });
  }
}

function scanPermissions(where, settings, findings) {
  if (!settings) return;
  const allow = settings.permissions?.allow;
  if (Array.isArray(allow) && allow.some(a => /^Bash(\(\*?\))?$/.test(String(a)))) {
    findings.push({ severity: 'CRITICAL', where, what: 'permissions.allow grants unrestricted Bash' });
  }
  if (settings.dangerouslySkipPermissions === true) {
    findings.push({ severity: 'CRITICAL', where, what: 'dangerouslySkipPermissions is set true as a default' });
  }
}

// Independent review caught the first version of this matching only bare "bash"/"cmd" etc,
// which a full path (`/bin/bash`, `C:\Windows\System32\cmd.exe`) or `powershell.exe` sails
// straight past -- exactly the shape of the config this check exists to catch. Compare on the
// basename with the extension stripped instead of the raw string. `.cmd`/`.bat` matter too:
// npm installs `npx` as `npx.cmd` on Windows, and a SECOND review caught the pin check below
// still comparing against the bare string and missing that shim.
function shellBasename(cmd) {
  const base = String(cmd).split(/[\\/]/).pop() || '';
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

// A secret passed as a CLI arg pair (`--api-key`, `sk-...`) or `--api-key=sk-...` never sits
// next to a `:`/`=` the way `scanTextForSecrets`'s key:value regex expects once the pair is
// JSON-stringified into an array (`"--api-key","sk-..."`, comma-separated, not colon/equals-
// adjacent) -- a SECOND review caught that the first fix (scanning the whole config, not just
// `env`) was a no-op for exactly the case it was written to close, because it still ran the
// same regex. This checks the args array directly instead of stringifying it.
// A THIRD review caught two more gaps here: `--api-key-file`/`--client-secret-path` name
// where a key LIVES, not the key itself, and a filename value (`openai-key-2026.txt`) matched
// the old opaque-value class -- excluded below. And base64 secrets use `+/=`, which the old
// character class didn't include, so a base64 secret next to `--client-secret` went unflagged
// -- the class now only rules out whitespace/quotes/commas instead of allow-listing an alphabet.
const SECRET_FLAG = /^--?[\w-]*(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret|password)[\w-]*$/i;
// A fourth review found "-file"/"-path"/"-dir" wasn't the whole list of "names a POINTER to
// the secret, not the secret" suffixes: "-ref" (an ARN), "-url"/"-uri" (an OAuth endpoint),
// "-id" all name where to go look, not something to flag.
const SECRET_FLAG_PATH = /-(file|path|dir|ref|arn|url|uri|id)$/i;
const OPAQUE_VALUE = /^[^\s"',]{16,}$/;
// The same review found the first filename guard (anything ending in a short dotted suffix)
// silently cleared a real secret ending in a version tag ("...xyz123.v2") or a connection
// string ("postgres://user:PASSWORD@host.com" -- ends in ".com", read as a filename). A value
// is only treated as a filename if it's NOT URL/credential-shaped (no "://", no "@") AND
// either carries a path separator or ends in an actual non-secret file extension.
const URL_OR_CREDENTIAL_SHAPED = /:\/\/|@/;
const KNOWN_FILE_EXT = /\.(txt|json|ya?ml|pem|key|crt|cert|pfx|p12|env|cfg|conf|ini|log|md)$/i;
function looksLikeFilename(value) {
  if (URL_OR_CREDENTIAL_SHAPED.test(value)) return false;
  // Backslash only, not forward slash: base64 legitimately contains "/" (confirmed by the
  // fourth review's own base64 test fixture briefly failing against this exact check), and a
  // genuine Unix path to a key file will still be caught below by its file extension anyway.
  return /\\/.test(value) || KNOWN_FILE_EXT.test(value);
}
function scanArgsForSecrets(where, name, args, findings) {
  for (let i = 0; i < args.length; i++) {
    const [flag, inlineValue] = args[i].split('=');
    if (!SECRET_FLAG.test(flag) || SECRET_FLAG_PATH.test(flag)) continue;
    const value = inlineValue ?? args[i + 1];
    if (typeof value === 'string' && looksLikeFilename(value)) continue;
    if (typeof value === 'string' && OPAQUE_VALUE.test(value)) {
      findings.push({ severity: 'CRITICAL', where, what: `MCP server "${name}" passes what looks like a secret as a CLI arg (${flag})` });
    }
  }
}

// `checkSecrets` is false for ~/.claude.json: that file's mcpServers hold the live auth
// headers/tokens an already-authorized connector NEEDS to function (e.g. a bearer header) --
// necessary local state, not a leak, and nothing about it can be "fixed". Nagging on it every
// session with no available action is the tuned-out failure mode review-check.mjs and this
// file's own header both warn against. A project's committed .mcp.json is the real leak
// surface (it can be pushed to a public repo), so --full's projectDir scan keeps it on.
function scanMcpServers(where, servers, findings, { checkSecrets = true } = {}) {
  if (!servers || typeof servers !== 'object') return;
  for (const [name, cfg] of Object.entries(servers)) {
    const cmd = String(cfg?.command || '');
    const args = Array.isArray(cfg?.args) ? cfg.args.map(String) : [];
    if (SHELL_COMMANDS.has(shellBasename(cmd)) && args.some(a => /^[-/]c$/i.test(a))) {
      findings.push({ severity: 'HIGH', where, what: `MCP server "${name}" runs an inline shell command directly` });
    }
    if (shellBasename(cmd) === 'npx' && args.includes('-y') && !args.some(a => /@\d/.test(a))) {
      findings.push({ severity: 'MEDIUM', where, what: `MCP server "${name}" runs "npx -y" with no version pin (resolves latest every launch)` });
    }
    if (checkSecrets) {
      // The whole config, not just `env`, for a plain key:value/key=value secret (a JS/JSON
      // object literal, not an args array).
      scanTextForSecrets(where, JSON.stringify(cfg || {}), findings);
      scanArgsForSecrets(where, name, args, findings);
    }
  }
}

function scanHookFile(path, findings, { full }) {
  const text = readText(path);
  if (!text) return;
  scanTextForSecrets(path, text, findings);
  if (full && NETWORK_CALL.test(text)) {
    findings.push({ severity: 'INFO', where: path, what: 'makes an outbound network call -- confirm it is supposed to' });
  }
}

function scan({ full = false, projectDir = null } = {}) {
  const findings = [];

  const settingsPath = join(HOME, '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  scanPermissions(settingsPath, settings, findings);
  scanTextForSecrets(settingsPath, readText(settingsPath), findings);

  const localPath = join(HOME, '.claude', 'settings.local.json');
  if (existsSync(localPath)) {
    const local = readJson(localPath);
    scanPermissions(localPath, local, findings);
    scanTextForSecrets(localPath, readText(localPath), findings);
  }

  const userConfigPath = join(HOME, '.claude.json');
  const userConfig = readJson(userConfigPath);
  if (userConfig) {
    scanMcpServers(userConfigPath, userConfig.mcpServers, findings, { checkSecrets: false });
    // Project-scoped servers, same file, keyed by project path on this machine.
    for (const proj of Object.values(userConfig.projects || {})) {
      scanMcpServers(userConfigPath, proj?.mcpServers, findings, { checkSecrets: false });
    }
  }

  let hookFiles = [];
  try {
    // Exclude *.test.mjs: those are fixtures full of intentionally fake secrets and sample
    // commands for exercising these exact rules, not hooks that ever run in a real session.
    hookFiles = readdirSync(HOOKS_DIR).filter(f => (f.endsWith('.mjs') || f.endsWith('.js')) && !f.endsWith('.test.mjs'));
  } catch { /* fine */ }
  for (const f of hookFiles) scanHookFile(join(HOOKS_DIR, f), findings, { full });

  if (projectDir) {
    const mcpPath = join(projectDir, '.mcp.json');
    const mcp = readJson(mcpPath);
    if (mcp) scanMcpServers(mcpPath, mcp.mcpServers, findings);
  }

  return findings;
}

function main() {
  const full = process.argv.includes('--full');
  const projectDir = full ? process.argv.slice(2).find(a => a !== '--full' && existsSync(a)) : null;

  let findings;
  try { findings = scan({ full, projectDir }); } catch { process.exit(0); } // fail open

  if (full) {
    if (!findings.length) { console.log('Nothing found.'); process.exit(0); }
    for (const f of findings) console.log(`[${f.severity}] ${f.where}: ${f.what}`);
    process.exit(0);
  }

  const actionable = findings.filter(f => f.severity !== 'INFO');
  if (!actionable.length) process.exit(0);

  const lines = ['Hook/config security scan:', ''];
  for (const f of actionable) lines.push(`[${f.severity}] ${f.where}: ${f.what}`);
  lines.push('', 'Run `node ~/.claude/hooks/hook-security-scan.mjs --full` for the full report.');
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

export { scan };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
