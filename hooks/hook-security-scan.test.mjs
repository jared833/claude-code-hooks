// Unit-level: drives the pure rule functions inside hook-security-scan.mjs against synthetic
// config, not the live machine's real settings.json (those findings, if any, belong to a real
// --full run, not a test assertion that would break the moment the live config changes).
import { scan } from './hook-security-scan.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let fails = 0;
function ck(label, ok) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${label}`);
}

// scan() reads from HOME-relative paths baked in at import time, so driving it against a
// fabricated HOME is not possible without a bigger refactor. Instead this exercises the same
// regex/logic paths via scan({projectDir}) against a real temp .mcp.json, which IS
// parameterized, plus checks the live global scan at least runs clean-or-reports without
// throwing.
console.log('\nLIVE GLOBAL SCAN, must never throw:');
try {
  const findings = scan({ full: true });
  ck('scan({full:true}) returns an array without throwing', Array.isArray(findings));
} catch (e) {
  ck(`scan threw: ${e.message}`, false);
}

console.log('\nPROJECT .mcp.json:');
{
  const dir = mkdtempSync(join(tmpdir(), 'hss-test-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
    mcpServers: {
      shelly: { command: 'bash', args: ['-c', 'echo hi'] },
      // A second review named these three as the exact shapes the first fix claimed to
      // close but nothing pinned: a full path, an .exe, and uppercase /C.
      fullpath: { command: '/bin/bash', args: ['-c', 'echo hi'] },
      psexe: { command: 'powershell.exe', args: ['/C', 'echo hi'] },
      upperc: { command: 'cmd.exe', args: ['/C', 'echo hi'] },
      pinned: { command: 'npx', args: ['-y', 'some-pkg@1.2.3'] },
      unpinned: { command: 'npx', args: ['-y', 'some-pkg'] },
      // npm installs npx as npx.cmd on Windows -- the pin check has to see through the shim.
      unpinnedShim: { command: 'npx.cmd', args: ['-y', 'some-pkg'] },
      fine: { command: 'node', args: ['server.js'] },
      leaky: { command: 'node', args: ['server.js'], env: { API_KEY: 'NOTAREALKEY0123456789abcdefgh' } },
      // The gap a second review found: a secret passed as a CLI arg, which the first fix
      // (stringify the whole config) claimed to catch but the key:value regex cannot match
      // once the pair is comma-separated array elements instead of colon/equals-adjacent.
      leakyArgsPair: { command: 'node', args: ['server.js', '--api-key', 'NOTAREALKEY0123456789abcdefgh'] },
      leakyArgsEq: { command: 'node', args: ['server.js', '--api-key=NOTAREALKEY0123456789abcdefgh'] },
      // A base64 secret uses +/=, which a third review found the old character class excluded
      // -- the exact case scanArgsForSecrets exists to catch, silently missed.
      leakyArgsBase64: { command: 'node', args: ['server.js', '--client-secret', 'AbCd12+/==ZzYyXx99Ww88Vv77Uu66Tt'] },
      // A third review also found these two false positives: naming WHERE a key lives, and a
      // value that looks like a filename, must not be flagged as the key itself.
      keyFileArg: { command: 'node', args: ['server.js', '--api-key-file', 'openai-key-2026.txt'] },
      keyFilenameValue: { command: 'node', args: ['server.js', '--api-key', 'openai-key-2026.txt'] },
      // A fourth review found the filename guard above went too far and cleared a REAL secret
      // that merely ends in a short suffix: a versioned key and a connection string with an
      // embedded password. Both must still be flagged despite ending in ".v2"/".com".
      keyVersionSuffix: { command: 'node', args: ['server.js', '--api-key', 'NOTAREALKEY-AbCdEfGhIjKlMnOpQr123.v2'] },
      connStringSecret: { command: 'node', args: ['server.js', '--client-secret', 'postgres://svc_user:Sup3rSecretPW9x@prod-db.internal.example.com'] },
      // A fourth review also found "-ref"/"-arn"/"-url"/"-uri"/"-id" were missing from the
      // pointer-not-the-secret suffix list.
      secretRefArg: { command: 'node', args: ['server.js', '--client-secret-ref', 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/foo-AbCdEf'] },
      authTokenUrlArg: { command: 'node', args: ['server.js', '--auth-token-url', 'https://sso.example.com/oauth/token'] },
      // A long-ish arg that is NOT preceded by a secret-shaped flag must not be flagged.
      benignLongArg: { command: 'node', args: ['server.js', '--project', 'my-long-project-name-here'] },
    },
  }));
  const findings = scan({ projectDir: dir });
  const has = (sev, sub) => findings.some(f => f.severity === sev && f.what.includes(sub));
  ck('flags inline shell command as HIGH', has('HIGH', 'shelly'));
  ck('flags a full-path shell command', has('HIGH', 'fullpath'));
  ck('flags powershell.exe with uppercase /C', has('HIGH', 'psexe'));
  ck('flags cmd.exe with uppercase /C', has('HIGH', 'upperc'));
  ck('flags unpinned npx -y as MEDIUM', findings.some(f => f.what.includes('"unpinned"')));
  ck('flags unpinned npx.cmd shim as MEDIUM', findings.some(f => f.what.includes('unpinnedShim')));
  ck('does not flag a pinned npx -y', !findings.some(f => f.severity === 'MEDIUM' && f.where === join(dir, '.mcp.json') && f.what.includes('"pinned"')));
  ck('does not flag a plain node command', !findings.some(f => f.what.includes('"fine"')));
  // scanTextForSecrets's findings don't carry the server name, only the pattern name --
  // "hardcoded" is what distinguishes this path from scanArgsForSecrets's CLI-arg findings.
  ck('flags an inline secret in server env', findings.some(f => f.severity === 'CRITICAL' && f.what.includes('hardcoded')));
  ck('flags a secret passed as a CLI arg pair (--flag value)', has('CRITICAL', 'leakyArgsPair'));
  ck('flags a secret passed as a CLI arg (--flag=value)', has('CRITICAL', 'leakyArgsEq'));
  ck('flags a base64 secret (+/= chars) passed as a CLI arg', has('CRITICAL', 'leakyArgsBase64'));
  ck('does not flag a flag naming WHERE a key lives (--api-key-file)', !findings.some(f => f.what.includes('keyFileArg')));
  ck('does not flag a filename-shaped value even under a secret-shaped flag', !findings.some(f => f.what.includes('keyFilenameValue')));
  ck('still flags a real secret that ends in a version suffix (.v2)', has('CRITICAL', 'keyVersionSuffix'));
  ck('still flags a connection string with an embedded password (ends in .com)', has('CRITICAL', 'connStringSecret'));
  ck('does not flag an ARN naming where a secret lives (--client-secret-ref)', !findings.some(f => f.what.includes('secretRefArg')));
  ck('does not flag an OAuth endpoint (--auth-token-url)', !findings.some(f => f.what.includes('authTokenUrlArg')));
  ck('does not flag a long but benign arg with no secret-shaped flag', !findings.some(f => f.what.includes('benignLongArg')));
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails === 0 ? 'ALL PASS.' : `${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
