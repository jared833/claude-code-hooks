# Claude Code hooks that actually run

Four [Claude Code](https://docs.claude.com/en/docs/claude-code) hooks from a working daily
setup. Each one exists because something went wrong once, and the comment at the top of every
file tells that story. They are not toy examples. They run on every session.

- **deploy-recheck** stops a "publish this whole folder" command and shows you what is really
  in the folder first, so stale or untracked files cannot ship silently.
- **uncommitted-check** refuses to let a session end while work it wrote is still sitting
  uncommitted on your machine.
- **track-edits** records which repo each edit and shell command touched, so the check above
  only ever asks about work this session actually did.
- **ai-tells-check** flags a list of tired words and em/en dashes in prose you are about to
  ship, and hands the finding back for a rewrite.

## What a hook is

Claude Code runs a script you name at defined moments (before a tool runs, after it runs, when
a session ends). The script reads a small JSON payload on stdin and signals back through its
exit code: `0` lets the action proceed, `2` blocks it and feeds the script's stderr back to
Claude. That is the whole contract. These four are plain Node scripts, no dependencies.

## Requirements

- Node 18 or newer (the scripts use only the standard library).
- `git` on your PATH, for the two git-aware hooks.

## Install

Copy the files from `hooks/` anywhere you like. Then wire them into your Claude Code settings
(`~/.claude/settings.json` for every project, or `.claude/settings.json` inside one repo) by
mapping each event to the script. This is the full set:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node /path/to/hooks/deploy-recheck.mjs" }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node /path/to/hooks/ai-tells-check.mjs" },
          { "type": "command", "command": "node /path/to/hooks/track-edits.mjs" }
        ] },
      { "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node /path/to/hooks/track-edits.mjs" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node /path/to/hooks/uncommitted-check.mjs" }] }
    ]
  }
}
```

Use the ones you want. Each block is independent, so you can install a single hook and skip the
rest. On Windows, if `node` is not on your PATH you may need its full path in the `command`
string.

## The four hooks

### deploy-recheck (PreToolUse)

Before a command that publishes a directory (`wrangler pages deploy`, `netlify deploy`,
`vercel deploy`, `firebase deploy`, `aws s3 sync`, `rsync`, `gh release upload`, and more), it
reads the target folder right then and blocks once, listing everything inside, with untracked
files called out. Re-run the identical command and it proceeds, as long as the folder has not
changed since you were shown the list. The point is that you approve a real, current file list
at the moment of publishing, not a picture of the folder you formed earlier.

Verify it, with `git` and Node installed:

```
node hooks/deploy-recheck.test.mjs
```

### uncommitted-check (Stop)

When a session tries to end, this blocks once if work the session wrote is uncommitted (or
committed but never pushed), listing the files and the exact commands to save them. It blocks a
single time and then always lets the session finish, so it can nudge but never trap you. It
reads the list that `track-edits` builds, so it only reports what this session touched, not
whatever else happens to be dirty in the repo.

### track-edits (PostToolUse)

After an edit or a shell command, this records the repo the file or command lived in, into a
per-session list in your temp directory. It never blocks and never fails loudly. On its own it
does nothing you would notice; it is the memory that makes `uncommitted-check` specific instead
of nagging about every dirty file in the repo.

### ai-tells-check (PostToolUse)

After a write to a prose or markup file, this scans for a list of overused words and for em and
en dashes, and exits `2` with the findings so Claude rewrites them. It never edits your file. The
word list is one writer's taste; open the file and make it yours. It scans only what was just
written, so it is fast and never touches the rest of the file.

## A note on behavior

Two of these can interrupt you on purpose: `deploy-recheck` blocks a publish until you confirm,
and `uncommitted-check` blocks the end of a session once. Both are designed to fail open, so any
unexpected input, a missing tool, or an error makes them step aside rather than stand in your
way. Read each file's header before you install it; the comment explains exactly what it does
and the one incident it came from.

## License

MIT. See [LICENSE](LICENSE).
