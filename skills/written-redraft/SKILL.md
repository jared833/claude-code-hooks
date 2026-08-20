---
name: written-redraft
description: Rewrite newsletter/blog drafts Jared sent back with feedback on Engage's /written page - reads each status:redraft file's note, rewrites the body to match it, and puts it back as a draft to re-approve. Use when Jared says /written-redraft, "process redrafts", "handle my written feedback", or when the /written page's Process redrafts button opens a terminal for it.
---

# Redraft queue for newsletter/blog

Engage's `/written` page lets Jared leave a note instead of editing text himself. That note gets
written straight to buildlog as `status: redraft` and a `note` field, queued rather than acted on
instantly (his call, 2026-08-19: a real rewrite happening the moment he clicks submit needs an
LLM call inside that request, the same per-use API cost as buildlog's disabled Regenerate
button, which he already declined once). This skill is that queue's processor: a real Claude Code
session, run off his existing subscription, not a metered API call.

## What this does NOT cover

Drafting the week's content from scratch is `/post-week`'s job. This skill only rewrites entries
already sitting at `status: redraft`. If nothing is at that status, say so and stop; do not go
looking for other work to do.

## Steps

1. **Fetch buildlog's origin first.** `git -C <HOME>\projects\buildlog fetch origin && git -C <HOME>\projects\buildlog checkout main && git -C <HOME>\projects\buildlog pull --rebase`. A stale checkout means rewriting a version of the file that already changed underneath it.

2. **Find every `status: redraft` file** in `buildlog/src/content/newsletters/` and
   `buildlog/src/content/posts/`. If there are none, report that and stop, nothing to do.

3. **Read the standards before rewriting anything**, same as `/post-week` does at drafting time:
   - `buildlog/scripts/voice.mjs` - the sales voice (short declarative sentences, concrete
     numbers, problem then mechanism then result, no em/en dashes).
   - `buildlog/docs/content-pillars.md` - the seven pillars and the product honesty guardrails.
     It names which products may be mentioned in a draft, at what price, and which are
     shelved and must never be named, priced or teased. Keep that list in your own repo.
   - Newsletters additionally follow the four-section format (Shipped, Broke, Steal this, Worth
     knowing) documented in `content-pillars.md`'s "Newsletter format" section.

4. **For each redraft file, rewrite it to the note, literally.** The note is the whole
   instruction, the same rule `/post-week` follows for a session-live redraft: read it literally
   and rewrite to it, not a soft version of it. If the note would change how every piece like
   this one should read (not just this one), say so in the scoreboard, but only apply it to the
   piece in front of you here.
   - Keep the frontmatter fields that aren't about status/note untouched (subject, weekOf, slot,
     title, format, cta, ...). Only `status` and `note` change.
   - Set `status: draft` and remove the `note` field entirely (delete the key, don't set it to
     empty string). It already lived in this commit's history if it needs to be found again, and
     leaving it would read as still-open feedback the next time this file is reviewed.
   - Write the file, matching the existing frontmatter style (`|-` block scalars where already
     used, canonical YAML).

5. **Commit and push once for the whole batch**, not once per file.
   `git -C <HOME>\projects\buildlog add -A && git commit -m "written-redraft: rewrite N items per feedback" && git push`.
   Fetch and `--rebase` if the push rejects, since `buildlog-publisher`'s own Actions push to
   this same remote on their own schedule. Never force. Then verify the push landed:
   `git -C <HOME>\projects\buildlog log origin/main -1`.

6. **Report a scoreboard**, one line per file: what the note asked for and what changed. Tell
   Jared they're back at `/written` waiting for another look, same page, no other step needed.

## Safety rails

- Never set `status: approved` here. A redraft rewrite goes back to `draft`, always, even if the
  note reads like enthusiastic agreement. Only Jared approves, on `/written`.
- Never fabricate a fact, a number, or a detail the note didn't supply and the file didn't
  already have, same rule `/post-week` follows when drafting.
- If a note is ambiguous or asks for something that contradicts `content-pillars.md` (pricing,
  a shelved product, a revenue claim), do not guess. Leave that one file at `status: redraft` and
  say why in the scoreboard rather than writing something wrong back as a draft.
