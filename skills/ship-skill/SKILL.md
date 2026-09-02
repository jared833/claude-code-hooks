---
name: ship-skill
description: Publish a finished Claude Code skill or hook everywhere it belongs - sanitize it, add it to the public claude-code-hooks repo with both READMEs updated, back it up, and queue the promotion. Use whenever a skill or hook is finished or substantially changed, when Jared says /ship-skill, "publish the skill", "put it everywhere", or when a session is about to end having written a new skill.
---

# Put a finished skill where it belongs

`~/.claude/skills/` and `~/.claude/hooks/` are **gitignored**. `~/.claude/.gitignore` is `*`
with exceptions only for `.gitignore`, `CLAUDE.md` and `settings.json`, so a skill that lives
only there exists in exactly one place on one machine. That is the reason this runs, and the
backup is the same action as the publish.

A skill is not done when it runs. It is done when it is public, backed up and findable.

## 0. Does it go public at all

Most do. The ones that do not are the seats and anything whose content is one business's
pricing, roadmap, refund policy or private accounts. If a skill is private on purpose, say so
in your output and stop here; do not sanitize it into something meaningless.

The published set already keeps real names, real dates and real business specifics on purpose.
The repo README argues for that: a sanitized example with every specific removed teaches
nothing. So sanitizing is narrow. It removes ids and secrets, nothing else.

## 1. Sanitize, then have a cold agent check it

Replace, and nothing more:

| Real | Placeholder |
|---|---|
| A Notion data source id | `collection://YOUR-<NAME>-DATA-SOURCE-ID` |
| Your real home directory in a path | `<HOME>` |
| A Buffer org id | `YOUR-BUFFER-ORG-ID` |
| A Canva design id | `<CANVA-DESIGN-ID>` |
| Any other account id, topic string or token | an `<angle-bracket>` name |

Then dispatch **one** cold agent, pointed at the exact files, told to scan for secrets, real
home directory paths, personal email addresses, private ids and any file that should never be
in a repo, and to return PASS or FAIL rather than fixing anything. See
[`review-prompts/`](../../review-prompts/) for the two prompts this is the third of. It is the
review anything public gets on top of the two normal ones. Its dispatch prompt carries the no-spawn line and
the verify-before-reporting rule. Do not push before it comes back.

## 2. Into the public repo

Your public repo. Here that is `claude-code-hooks`, MIT.

- `skills/<name>/SKILL.md`, plus any script the skill cannot run without. A skill that ships
  its own script is better than one that does not, so include it when it is yours to give.
- `hooks/<name>.mjs` **and its test.** Not every published hook has one, and every one that
  can be tested should.
- Any placeholder you invented goes on the list in `skills/README.md` under "Installing one".

**Four places carry counts and every one of them drifts.** Update all four in the same commit:

1. `README.md`, the top table row for `hooks/` or `skills/`.
2. `README.md`, the count in the opening line of section 1 or section 2.
3. `README.md`, "All N are plain Node scripts", for a hook.
4. `skills/README.md`, the opening line and its table.

A hook also needs a bullet in the right group in `README.md` section 1, a `### <name> (Event)`
detail section saying what incident produced it, and its matcher in the Install block if that
matcher differs from the ones already shown. A skill needs a row in the `skills/README.md`
table.

Run the tests from their published location before committing, not from where they were
written. A path that resolves at home can break one directory over.

## 3. Record it

- A dated UPDATE in the matching `projects/aide-data/memory/projects/*.md`.
- The Claude Code memory that covers this system, plus its one line in `MEMORY.md`.
- `~/.claude/CLAUDE.md` if the skill changes how any session behaves.

## 4. Promotion, which is a queue and not a post

Do not post anything outward from here. Publishing to his channels is his call and goes
through the normal pipeline. What this does is make sure the thing is queueable:

- File a row in the Notion **Content Bank** (`Draft` naming the skill and what went wrong that
  produced it, `Platform` blank so `/idea-vet` recommends freely). The bank is a menu and never
  drains, so this is an addition, never a schedule.
- If the skill belongs in **The Back Office** classroom on Skool, say so in your output and
  name which room. Do not create a room, post a lesson, or touch Skool without him saying yes:
  it is a paid community and a publish there is outward-facing.

## Do not

- Do not push a public repo before the sanitizer agent has come back clean.
- Do not strip real names, dates or business specifics. That is what makes the file worth
  reading, and the repo says so out loud.
- Do not publish a seat.
- Do not publish a hook without its test.
- Do not post to Skool, a newsletter or a social channel from this skill.
