#!/usr/bin/env node
// SessionStart hook: surface a failed or stale nightly backup in the terminal, where you
// already look. A scheduled task snapshots the databases overnight and verifies itself, but
// a nonzero result, or a run that never happened because the laptop was asleep at 2:30am,
// was silent until now.
//
// SessionStart exit 2 shows stderr to the USER as a hook notice and cannot block the
// session, so an unhealthy backup nags at the top of every session until it is fixed. That
// persistence is deliberate: a broken backup stays a problem until resolved, unlike a Stop
// hook which nudges once. Healthy backup means exit 0, no output, no notice.
//
// Fail open: any failure querying Task Scheduler (PowerShell missing, timeout) exits 0
// silently. A bug in this check must never nag on its own account. The one non-error signal
// it will report is the task being MISSING entirely, since that is exactly the silent-failure
// mode the backup work exists to prevent.
//
// Windows only, since it reads Task Scheduler. Configure with:
//   BACKUP_TASK_NAME  name of the scheduled task   (default "Database Backup")
//   BACKUP_LOG_HINT   path mentioned in the warning text

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TASK = process.env.BACKUP_TASK_NAME || 'Database Backup';
const LOG_HINT = process.env.BACKUP_LOG_HINT || 'your backup log';

// ponytail: 26h staleness threshold. Runs are 24h apart at 2:30am, so 26h flags a
// single missed night by mid-morning while still staying quiet for an evening or
// late-night session before that night's run. Widen if travel or timezone shifts ever
// cause false alarms.
const STALE_MS = 26 * 60 * 60 * 1000;

// Decide health from already-fetched task info. Pure, so it is unit-tested without
// Windows. `info` is { found, result, lastRun } where result is an integer exit
// code and lastRun is epoch-ms or null. Returns a warning string, or null if fine.
export function assess(info, now = Date.now()) {
  if (!info.found) return `nightly backup task "${TASK}" is MISSING from Task Scheduler`;
  // Garbled query (partial PowerShell stdout while it still exited 0) means result is
  // NaN. Fail open rather than nag: NaN !== 0 would otherwise report a false FAILED.
  if (!Number.isFinite(info.result)) return null;
  if (info.result !== 0) {
    return `last nightly backup FAILED (task result 0x${(info.result >>> 0).toString(16).toUpperCase()}); see ${LOG_HINT}`;
  }
  if (info.lastRun == null) return `nightly backup has no recorded run time`;
  if (now - info.lastRun > STALE_MS) {
    const ageH = Math.round((now - info.lastRun) / 3.6e6);
    return `nightly backup has not run in ~${ageH}h (expected nightly at 2:30am); the machine may have been asleep`;
  }
  return null;
}

// Query Task Scheduler for the backup task. Handles "task not found" inside
// PowerShell with a MISSING sentinel so Node never parses localized error text.
// Throws only on a genuine query failure (PowerShell unavailable), which main
// treats as fail-open.
function queryTask() {
  const ps = [
    "$ErrorActionPreference='Stop';",
    `$t = Get-ScheduledTask -TaskName '${TASK.replace(/'/g, "''")}' -ErrorAction SilentlyContinue;`,
    "if (-not $t) { Write-Output 'MISSING'; exit 0 }",
    "$i = $t | Get-ScheduledTaskInfo;",
    "Write-Output ('R=' + [int]$i.LastTaskResult);",
    "if ($i.LastRunTime) { Write-Output ('T=' + $i.LastRunTime.ToUniversalTime().ToString('o')) } else { Write-Output 'T=' }"
  ].join(' ');
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }
  );
  if (/(^|\s)MISSING(\s|$)/.test(out)) return { found: false };
  const r = /R=(-?\d+)/.exec(out);
  const t = /T=(\S+)/.exec(out);
  const lastRun = t ? Date.parse(t[1]) : NaN;
  return {
    found: true,
    result: r ? parseInt(r[1], 10) : NaN,
    lastRun: Number.isFinite(lastRun) ? lastRun : null
  };
}

// Run main only when invoked directly, so the test can import assess() without
// shelling out to PowerShell or exiting.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // Silent unless you have actually pointed this at a task. Without this, anyone who installs
  // the hook and has no scheduled task literally named "Database Backup" gets a MISSING notice
  // at the top of every session forever, which is the tuned-out failure mode this repo keeps
  // warning about. A guessed default is not a configuration.
  if (!process.env.BACKUP_TASK_NAME) process.exit(0);

  let info;
  try {
    info = queryTask();
  } catch {
    process.exit(0); // fail open
  }
  const warn = assess(info);
  if (!warn) process.exit(0);
  process.stderr.write(`Backup health: ${warn}\n`);
  process.exit(2);
}
