# Working parts from a Claude Code setup that runs every day

Five kinds of artifact, all pulled out of a setup that ships real work on a schedule. None of
these are examples written for a repo. Each one exists because something went wrong first, and
the file says which thing.

| | What it is | For |
|---|---|---|
| [`hooks/`](hooks/) | Five Claude Code hooks | Stopping a session from shipping the wrong thing |
| [`standards/`](standards/) | The web-interface baseline | Five rules every page you build should carry |
| [`review-prompts/`](review-prompts/) | Independent review prompts | Catching what a model cannot catch about its own work |
| [`pipeline/`](pipeline/) | A release playbook and its config | Letting an agent ship on a schedule without babysitting |
| [`scripts/`](scripts/) | `check-baseline.mjs` | Making the standard fail a build instead of rotting in a doc |

They connect. The standard is a rule, the script is what makes the rule real, the pipeline is
where the script runs, and the review prompts are the part of the pipeline a script cannot do.
A rule that lives only in a document is invisible to everything except a session that happens
to read it, so every rule here is attached to something that runs.

MIT licensed. Take any piece on its own.

---

## 1. Hooks

Five [Claude Code](https://docs.claude.com/en/docs/claude-code) hooks from a working daily
setup. The comment at the top of every file tells the story of the incident that produced it.

- **deploy-recheck** stops a "publish this whole folder" command and shows you what is really
  in the folder first, so stale or untracked files cannot ship silently.
- **uncommitted-check** refuses to let a session end while work it wrote is still sitting
  uncommitted on your machine.
- **track-edits** records which repo each edit and shell command touched, so the check above
  only ever asks about work this session actually did.
- **ai-tells-check** flags a list of tired words and em/en dashes in prose you are about to
  ship, and hands the finding back for a rewrite.
- **session-close-check** refuses to let a session end after it rewrote a skill, a hook, your
  settings, or CLAUDE.md itself, if nothing in that same session updated a doc to match, or if
  other live docs still name what it changed and it never opened them.

### What a hook is

Claude Code runs a script you name at defined moments (before a tool runs, after it runs, when
a session ends). The script reads a small JSON payload on stdin and signals back through its
exit code: `0` lets the action proceed, `2` blocks it and feeds the script's stderr back to
Claude. That is the whole contract. These five are plain Node scripts, no dependencies.

### Requirements

- Node 18 or newer (the scripts use only the standard library).
- `git` on your PATH, for the two git-aware hooks.

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
          { "type": "command", "command": "node /path/to/hooks/session-close-check.mjs" }
        ] }
    ]
  }
}
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

### A note on behavior

Three of these can interrupt you on purpose: `deploy-recheck` blocks a publish until you
confirm, `uncommitted-check` blocks the end of a session once, and `session-close-check` blocks
the end of a session once if it reshaped the system and either documented none of it or left
live docs naming what it changed unopened. All three are
designed to fail open, so any unexpected input, a missing tool, or an error makes them step
aside rather than stand in your way. Read each file's header before you install it.

---

## 2. Standards

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

## 3. Review prompts

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

---

## 4. Pipeline config

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

## 5. Audit script

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

## License

MIT. See [LICENSE](LICENSE). The five rules in the web-interface baseline are adopted from
[Vercel Labs' Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines),
which is also MIT licensed. The prose, the CSS as written here, and the checker are this repo's
own work.
