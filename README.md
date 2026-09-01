# Working parts from a Claude Code setup that runs every day

Six kinds of artifact, all pulled out of a setup that ships real work on a schedule. None of
these are examples written for a repo. Each one exists because something went wrong first, and
the file says which thing.

| | What it is | For |
|---|---|---|
| [`hooks/`](hooks/) | Thirteen Claude Code hooks | Stopping a session from shipping the wrong thing |
| [`skills/`](skills/) | Twelve skills, eleven of them real production workflows | Handing a whole job to an agent, with the stop-and-ask points written in |
| [`standards/`](standards/) | The web-interface baseline | Five rules every page you build should carry |
| [`review-prompts/`](review-prompts/) | Independent review prompts | Catching what a model cannot catch about its own work |
| [`pipeline/`](pipeline/) | A release playbook and its config | Letting an agent ship on a schedule without babysitting |
| [`scripts/`](scripts/) | `check-baseline.mjs` | Making the standard fail a build instead of rotting in a doc |

They connect. The standard is a rule, the script is what makes the rule real, the pipeline is
where the script runs, the review prompts are the part of the pipeline a script cannot do, and
one of the hooks is what stops a session finishing without them.
A rule that lives only in a document is invisible to everything except a session that happens
to read it, so every rule here is attached to something that runs.

MIT licensed. Take any piece on its own.

---

## 1. Hooks

Thirteen [Claude Code](https://docs.claude.com/en/docs/claude-code) hooks from a working daily
setup. Not one of them is a demo. The comment at the top of every file tells the story of the
incident that produced it, including the ones a later review found holes in.

**Stopping the wrong thing from shipping**

- **deploy-recheck** stops a "publish this whole folder" command and shows you what is really
  in the folder first, so stale or untracked files cannot ship silently.
- **uncommitted-check** refuses to let a session end while work it wrote is still sitting
  uncommitted on your machine.
- **track-edits** records which repo each edit and shell command touched, so the check above
  only ever asks about work this session actually did.
- **commit-msg-guard** blocks a `git commit -m @'...'@` in the Bash tool, where PowerShell
  here-string syntax silently turns your commit subject into a lone `@` line.

**Making the session prove its work**

- **review-check** refuses to let a session end while code it wrote has not been read by a
  fresh agent, and hands over the prompt to send that agent.
- **tdd-gate** refuses to let a session end when logic changed in a project that already has
  tests and no test file in that same project was touched.
- **ai-tells-check** flags a list of tired words and em/en dashes in prose you are about to
  ship, and hands the finding back for a rewrite.
- **session-close-check** refuses to let a session end after it rewrote a skill, a hook, your
  settings, or CLAUDE.md itself, if nothing in that same session updated a doc to match, or if
  other live docs still name what it changed and it never opened them.

**Telling you what you would not otherwise see**

- **hook-security-scan** scans your always-loaded config (settings, MCP servers, the hook
  scripts themselves) for hardcoded secrets, unrestricted Bash grants, shell-executing MCP
  servers and unpinned `npx -y`. Also runs by hand with `--full`.
- **backup-health** nags at the top of every session when your nightly backup failed or never
  ran, instead of letting a dead backup stay silent until you need it.
- **notify** is a shared helper, not an event hook: a phone push through
  [ntfy.sh](https://ntfy.sh) that reads its topic from one file so rotating it is one edit.
- **buffer-scheduled-notify** pushes to your phone the moment an agent schedules a social post,
  so an unattended run is not a black box.
- **queue-loop-check** makes a producer that builds from a Notion database record what it
  shipped, so the same idea cannot be built twice with nothing to say so.

### What a hook is

Claude Code runs a script you name at defined moments (before a tool runs, after it runs, when
a session ends). The script reads a small JSON payload on stdin and signals back through its
exit code: `0` lets the action proceed, `2` blocks it and feeds the script's stderr back to
Claude. That is the whole contract. All thirteen are plain Node scripts, no dependencies.

### Requirements

- Node 18 or newer (the scripts use only the standard library).
- `git` on your PATH, for the git-aware hooks.
- Windows, for `backup-health` only, which reads Task Scheduler. Everything else is portable.

### Optional configuration

Four hooks do nothing until you point them at something, and every one of them stays completely
silent when unset. That is deliberate: a hook that nags about a resource you never configured is
how a check gets ignored, and a guessed default is not a configuration.

| Variable | Used by | What it is |
|---|---|---|
| `NTFY_TOPIC` or `NTFY_TOPIC_FILE` | `notify`, `buffer-scheduled-notify` | Your ntfy.sh topic, or a file holding it (default `~/.ntfy-topic`). Unset means no push is sent |
| `CONTENT_QUEUE_ID` | `queue-loop-check` | The Notion data source id of your content database. Unset means the hook exits immediately |
| `CONTENT_QUEUE_FILE_HINT` | `queue-loop-check` | Optional. A regex matched against written file paths to decide what counts as "produced" (default `scripts`). An invalid regex makes the hook exit quietly rather than throw |
| `BACKUP_TASK_NAME` | `backup-health` | The exact name of your scheduled backup task. **Required.** Unset means the hook exits immediately and never reports |
| `BACKUP_LOG_HINT` | `backup-health` | Optional. The log path named in the warning text |
| `TDD_GATE_DISABLE` | `tdd-gate` | Set to `1` to turn the check off for a messy session |

### Install

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
          { "type": "command", "command": "node /path/to/hooks/track-edits.mjs" },
          { "type": "command", "command": "node /path/to/hooks/session-close-check.mjs" }
        ] },
      { "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node /path/to/hooks/track-edits.mjs" },
          { "type": "command", "command": "node /path/to/hooks/session-close-check.mjs" }
        ] }
    ],
    "Stop": [
      { "hooks": [
          { "type": "command", "command": "node /path/to/hooks/uncommitted-check.mjs" },
          { "type": "command", "command": "node /path/to/hooks/session-close-check.mjs" },
          { "type": "command", "command": "node /path/to/hooks/review-check.mjs" },
          { "type": "command", "command": "node /path/to/hooks/tdd-gate.mjs" },
          { "type": "command", "command": "node /path/to/hooks/queue-loop-check.mjs" }
        ] }
    ],
    "SessionStart": [
      { "hooks": [
          { "type": "command", "command": "node /path/to/hooks/hook-security-scan.mjs" },
          { "type": "command", "command": "node /path/to/hooks/backup-health.mjs" }
        ] }
    ]
  }
}
```

`commit-msg-guard` goes on the same `PreToolUse` block as `deploy-recheck`. The two
Notion/Buffer-aware hooks go on a `PostToolUse` matcher naming those MCP tools:

```json
{ "matcher": "mcp__.*Buffer__create_post|mcp__.*Notion__notion-(query|fetch|update).*",
  "hooks": [
    { "type": "command", "command": "node /path/to/hooks/queue-loop-check.mjs" },
    { "type": "command", "command": "node /path/to/hooks/buffer-scheduled-notify.mjs" }
  ] }
```

Use the ones you want. Each block is independent, so you can install a single hook and skip the
rest. On Windows, if `node` is not on your PATH you may need its full path in the `command`
string.

### deploy-recheck (PreToolUse)

Before a command that publishes a directory (`wrangler pages deploy`, `netlify deploy`,
`vercel deploy`, `firebase deploy`, `aws s3 sync`, `rsync`, `gh release upload`, and more), it
reads the target folder right then and blocks once, listing everything inside, with untracked
files called out. Re-run the identical command and it proceeds, as long as the folder has not
changed since you were shown the list. The point is that you approve a real, current file list
at the moment of publishing, not a picture of the folder you formed earlier.

It picks the target by taking the last argument that is a directory on disk, and falls back to
the current directory when the command names none. When an argument resolves to nothing at all
and looks like a path, the message says so, rather than presenting that fallback listing as the
deploy contents. A listing you cannot trust is worse than no listing. An argument that names a
real file is left alone, since that is not a mystery worth a warning.

One platform note. On Windows, a `/tmp/...` path in a command from a POSIX shell is mapped
through the real temp directory, because that is where the shell means, and the Windows drive
root is not consulted at all: if the mapping finds nothing you get the warning instead of a
quiet listing of whatever `C:\tmp` happens to hold. The same path from PowerShell is left
alone, because there a leading slash really does mean the drive root. On macOS and Linux
nothing is mapped at all, since `/tmp/x` already means `/tmp/x`. In that one mapped case, bare
`/tmp` with no subpath is left unresolved and warns instead: walking a whole temp tree would
change the fingerprint on every attempt, and the retry could then never match.

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

### review-check (Stop)

A model cannot review its own work. The belief that produced the bug also produced the test
asserting the bug is correct, so the code, the test and the green run are three copies of one
misunderstanding. Telling the same session to "check it carefully" changes nothing, because the
belief is still in the context.

When a session tries to end, this reads the transcript, collects every code file written, and
blocks once with that list and the review prompt to paste into a fresh agent. A completed Agent
dispatch clears the files written before it, so a review counts for the work it actually saw and
code written afterwards needs another one. Dispatching is not enough on its own: agents run in
the background, so the hook waits for the result to come back before crediting it.

The hook cannot spawn the reviewer itself, since a hook is a shell command and not a session.
What it can do is refuse to finish until the session spawns one, which lands in the same place.

Two limits worth knowing before you install it. It only sees files written through Write, Edit
and NotebookEdit, so anything a shell command creates (`cat > x.js`, `sed -i`, a codegen step)
is invisible to it. And it cannot tell a review dispatch from any other subagent, so a fan-out
sent to search your codebase will satisfy it. Both fail in the quiet direction, which is the
right one for a check that blocks. The extension list at the top of the file decides what counts
as code; open it and make it yours.

Verify it:

```
node hooks/review-check.test.mjs
```

### session-close-check (PostToolUse + Stop)

One file plays two roles, switched on `hook_event_name`: on every `PostToolUse` it records
whether the file you just touched is a system surface (a skill, a hook, your settings, or
CLAUDE.md) or documentation (a README, CLAUDE.md again, a diagram, or anything under a
`memory/`, `docs/`, or `documentation/` path). It also records the SCREAMING_SNAKE identifiers
that session wrote or deleted. On `Stop`, if the session touched a system surface, or wrote
ten-plus other files, and never wrote to anything on the documentation list, it blocks once with
a checklist: find what else describes the thing you just changed, fix the stale copies, record
it somewhere that gets read again, and file real follow-ups instead of leaving them in chat.

Writing some docs used to end the check there. It no longer does: the hook greps your doc roots
(`~/CLAUDE.md`, `~/.claude/CLAUDE.md`, each `~/.claude/projects/*/memory`, and every repo's
`CLAUDE.md` and `docs/`) for files naming one of those identifiers that the session never
opened, and blocks with that list. Roughly 90ms. It is a grep and not a verdict: a dated entry
describing what WAS true is correct history and should stay, so the list is candidates to read.
It only matches SCREAMING_SNAKE names, so a renamed skill or a changed number is still yours to
find. It never blocks a second time in the same session, and it always lets you say "nothing
else describes this" and move on. Read the file header for the incidents that produced it and
exactly what it can and cannot see.

Verify it:

```
node hooks/session-close-check.test.mjs
```

### tdd-gate (Stop)

"Did TDD happen" cannot be answered by reading the model's own account of it, for the same
reason `review-check` does not trust self-review. A model that skipped tests can also write a
paragraph saying it followed RED, GREEN, REFACTOR, and nothing downstream can tell the
difference. A well-known agent framework ships a TDD skill where the agent authors its own "TDD
Evidence Report" markdown file that no hook ever reads, which is the model grading its own
homework.

This asks a smaller machine-checkable question instead: for each project a source file was
edited in this session, was a test file in that same project also touched. Not whether it
passes, not whether it came first. That is a fact about tool calls, not a claim in prose.

A project with zero test files anywhere is left alone, because nothing here knows whether tests
apply to it and firing there is how a check gets tuned out. Once a project has any test file on
disk, it has already decided tests apply, and this holds it to its own standard. Set
`TDD_GATE_DISABLE=1` to skip a session.

Known ceilings, all failing quiet and all listed in the file header: touching a test is not
writing a real assertion, shell-created files are invisible, and a monorepo where only the root
carries a marker scopes to the whole monorepo.

```
node hooks/tdd-gate.test.mjs
```

### hook-security-scan (SessionStart, or by hand)

Your always-loaded config is the highest blast radius in the setup: every session inherits it
regardless of which project you open. This scans `settings.json`, `settings.local.json`, the MCP
servers in `~/.claude.json`, and the hook scripts themselves for hardcoded secrets (AWS, GitHub,
Slack, private keys, inline key/value assignments), `permissions.allow` granting unrestricted
Bash, `dangerouslySkipPermissions` set as a default, MCP servers running an inline shell
command, and `npx -y` with no version pin.

The detection is plain pattern matching, no model call, which is what makes it fast enough to
run at every session start and portable enough to read in one sitting.

```
node hooks/hook-security-scan.mjs --full [project-dir]
```

Worth reading for the comment trail alone: four successive independent reviews each found a
real hole in the secret-in-a-CLI-arg check, and every one of those fixes and its counter-example
is preserved in the source and pinned by a test.

```
node hooks/hook-security-scan.test.mjs
```

### backup-health (SessionStart)

A backup that fails silently is worse than no backup, because you believe in it. This reads
Windows Task Scheduler for your backup task and warns at the top of every session if the last
run failed, if it has not run in 26 hours, or if the task is missing entirely.

It nags every session rather than once, deliberately: a broken backup stays a problem until it
is fixed. Any failure querying Task Scheduler exits silently, so a bug in the check never nags
on its own account. Windows only.

**Set `BACKUP_TASK_NAME` or this does nothing.** There is no default task name, on purpose. An
earlier version guessed one, which meant anyone who installed the hook without a task by that
exact name got a MISSING notice at the top of every session forever. A check that fires at
people who never configured it is a check they learn to ignore.

```
node hooks/backup-health.test.mjs
```

### commit-msg-guard (PreToolUse)

Narrow and specific. On a machine where PowerShell is the primary shell, muscle memory produces
`git commit -m @'...'@` inside the Bash tool. In POSIX sh the `@` is literal, so every such
commit subject comes out as a lone `@` line above the real subject and needs an amend. This
blocks that one shape and hands back the correct heredoc form. The PowerShell tool is left
alone, because there the syntax is exactly right.

```
node hooks/commit-msg-guard.test.mjs
```

### notify + buffer-scheduled-notify

`notify.mjs` is a helper rather than an event hook: a phone push through ntfy.sh, usable as a
module, a CLI, or from any other script. It reads its topic from `NTFY_TOPIC` or a file, so
rotating the topic is one edit no matter how many things send.

`buffer-scheduled-notify.mjs` uses it to push the moment an agent schedules a social post. If
you let an agent publish on a schedule, this is the difference between trusting it and watching
it. Both no-op silently with no topic configured.

```
node hooks/notify.mjs --self-test
```

### queue-loop-check (PostToolUse + Stop)

For anyone whose content ideas live in a Notion database that agents build from. The failure it
catches is quiet: a producer reads the database, ships something, and never records that it did,
so a later run makes the same thing again and nothing anywhere says so.

It fires only on the exact shape of that failure, and only when `CONTENT_QUEUE_ID` names your
database. The interesting design note is in the file header: an earlier version keyed on a
property named `Status`, which a Tasks database also has, so ordinary task-status writes silenced
the check on the normal path. Property names have to be unique across your workspace for this
kind of inference to hold. Check that before trusting it.

```
node hooks/queue-loop-check.test.mjs
```

### A note on behavior

Seven of these can interrupt you on purpose: `deploy-recheck` blocks a publish until you
confirm, `commit-msg-guard` blocks one malformed commit, and `uncommitted-check`,
`review-check`, `tdd-gate`, `session-close-check` and `queue-loop-check` each block the end of a
session once. Two more, `hook-security-scan` and `backup-health`, show a notice at session start
and cannot block at all. Every one is designed to fail open, so any unexpected input, a missing
tool, or an error makes them step aside rather than stand in your way. Read each file's header
before you install it.

---

## 2. Skills

[`skills/`](skills/)

Eleven production workflows plus one template. These are the real files, not examples written for a
repo: the content pipeline that drafts a week in one sitting, the one that cuts a shoot into
finished vertical video and stops before publishing, the autonomous backlog session, the free-tool
shipper.

They will not run against your accounts, and that is deliberate. What is worth copying is the
shape, and the shape only makes sense with the real decisions left in, including the notes where
a previous version of a rule turned out to be wrong.

The reusable idea is the **seat**: a named role your business actually has, that Claude answers
as. Its load-bearing part is two lists, what the seat decides alone and what it must escalate.
Written down, they turn "help me with this" into delegation with a boundary.
[`skills/seat-template/`](skills/seat-template/) is that pattern with the specifics stripped out.

---

## 3. Standards

[`standards/web-interface-baseline.md`](standards/web-interface-baseline.md)

Five things every page ships: `color-scheme` on `html`, a `theme-color` meta tag in every head,
a `prefers-reduced-motion` block, `touch-action` and `-webkit-tap-highlight-color` on controls,
and a global `:focus-visible` ring with no `transition: all` anywhere.

They came out of an audit of four live sites that were all missing the same five. Each rule
gets the specific defect it fixes (a white scrollbar on a dark page, a 300ms tap delay that
reads as lag, a keyboard user with no visible focus) and the copy-paste CSS. Four of the five
live in a shared stylesheet, so one edit covers every page that inherits it. The fifth cannot,
which is exactly why it is the one that goes missing.

The five rules are adopted from [Vercel Labs' Web Interface
Guidelines](https://github.com/vercel-labs/web-interface-guidelines), which is MIT licensed,
the same as this repo. The write-up and the checker are original.

---

## 4. Review prompts

[`review-prompts/README.md`](review-prompts/README.md)

Two prompts you paste into a fresh agent before a change ships, and the reasoning for why they
have to go to a fresh one. The thesis:

> Do not trust the test file, because the same model that wrote the code wrote its tests.

A model that misunderstood the requirement writes code expressing the misunderstanding, then
writes tests asserting it, then runs them, then reports green. Nothing inside that loop can
detect the error. The fix is to put the check in a context that does not contain the belief.

Prompt 1 is an independent code review: correctness, security, and whether the diff could be
smaller. Prompt 2 is value validation, for anything whose right answer exists outside your code
in a published table or standard. It makes the reviewer derive expected values by hand from the
source **before** reading the existing test file, because values seen first become an anchor.

Prompt 1 is also what `hooks/review-check.mjs` hands back when it blocks, condensed to fit a
terminal, so the rule and the thing that enforces it say the same thing.

---

## 5. Pipeline config

[`pipeline/`](pipeline/)

A shape for letting an agent ship work on a schedule without approving each step, and without
it merging something broken. Two files: a markdown playbook the agent reads and executes top to
bottom, and a six-line JSON file holding the values a human changes without editing the
playbook.

The one that earns its keep is `mode`: `manual` publishes only what a human approved, `auto`
treats an unreviewed draft as approved. That word is the whole difference between a pipeline
you babysit and one that runs while you sleep.

The playbook's load-bearing parts are a resume check as stage zero (finish last run's failure
before starting new work), blocking checks explicitly separated from advisory ones, independent
review as a blocking check, a failure protocol that never ends in a merge, and a definition of
done that is stricter than "merged".

---

## 6. Audit script

[`scripts/check-baseline.mjs`](scripts/check-baseline.mjs)

What makes the standard above real. It walks a built tree and fails the build on any page
missing one of the five rules. Node 18+, no dependencies.

```
node scripts/check-baseline.mjs dist
```

Wire it to something that runs in the same change: a `postbuild` script, a CI step, a line in
the deploy recipe.

```json
"scripts": { "postbuild": "node scripts/check-baseline.mjs dist" }
```

Point it at the **shipped** tree, never at source. That distinction is the finding that started
this: a grep over source said all four sites were clean of `transition: all`, and they were
not, because a build step and a copied vendor file had put it back.

Two design choices worth stealing if you write your own. It judges each page on its own inline
CSS plus exactly the stylesheets that page links, rather than on the site's CSS as a whole,
because judging site-wide let a bare 404 page ship with none of the rules while a sibling's
stylesheet covered for it. And the theme-color check is per page by necessity, since a
stylesheet cannot supply a meta tag.

Verify it:

```
node scripts/check-baseline.test.mjs
```

---

## What this setup runs on

Two outside services show up by name in `skills/`, because the real workflows call them: the
weekly newsletter is sent through MailerLite, and the social queue is pushed to Buffer. Nothing
in this repo depends on either one. Nothing here authenticates to either, no file carries a key
for them, and the skills read as documentation whatever you publish with. The only outbound call
anywhere in this repo is `notify.mjs` posting to ntfy.sh, and that one returns without sending
until you configure a topic of your own.

If you want the same wiring, these are affiliate links and I earn a commission if you sign up
through them:

- [MailerLite](https://jaredhebb.com/go/mailerlite), the newsletter send that
  [`skills/post-week/`](skills/post-week/) hands off to
- [Buffer](https://jaredhebb.com/go/buffer), the queue `skills/vid-batch/` pushes carousels and
  videos to

Both have a free tier. MailerLite's carried this setup for a long time before it was worth
paying for.

---

## License

MIT. See [LICENSE](LICENSE). The five rules in the web-interface baseline are adopted from
[Vercel Labs' Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines),
which is also MIT licensed. The prose, the CSS as written here, and the checker are this repo's
own work.
