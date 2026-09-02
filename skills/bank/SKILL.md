---
name: bank
description: Drain the Notion Context Sources queue into the context bank - ingest every queued link, distil each transcript into playbook plays, sweep approved shows for new episodes, and write status back to Notion. Use when Jared says /bank, "run the bank", "ingest the queue", or on a schedule.
---

# Drain the intake queue

Jared adds a row to Notion and nothing else. This turns that row into plays an agent can
follow. Nothing here waits on him: he said so on 2026-09-01, *"that's not really a judgment
call, that's synthesizing information and can run without me. If something is pulled from the
bank and I don't like the idea, I can always say no."*

So **a play entering the bank is not an endorsement.** It is a recorded claim with a named
result behind it. The filter is evidence, not taste, and taste happens later at point of use.

Run everything with the full path, since sessions launch from a home directory, not the bank:
`python <HOME>/projects/context-bank/cb.py ...`

(Reading this out of the public repo: `cb.py` sits next to this file, so that path is
`python <path to this directory>/cb.py`. [`README.md`](README.md) covers the rest.)

## The table

**Context Sources**, under Ops Command Center.
Data source `collection://YOUR-CONTEXT-SOURCES-DATA-SOURCE-ID`.

| Property | Values | Who writes it |
|---|---|---|
| Name | title | Jared, or this skill on a swept episode |
| URL | url | Jared |
| Kind | Episode, Show | Jared |
| Status | Queued, Ingested, Skip | Jared queues, this skill flips to Ingested |
| Domain | attention, story, offers, ai, business, editing | either |
| Speaker | text | either |
| Why trusted | text | Jared |
| Last swept | date | this skill |

`Skip` means do not touch it, ever. It is how he says no.

## 1. Read the queue

`notion-query-data-sources` on that data source. Take two sets: rows with `Status: Queued`,
and rows with `Kind: Show` whose `Last swept` is missing or older than 7 days.

## 2. Sweep the approved shows

One call, all of them at once:

```
python <HOME>/projects/context-bank/cb.py feed "Name=URL" "Name=URL" ... --days 14
```

It lists and never ingests. Treat each listed episode as a queued row: he already approved the
show, so a new episode from it needs no second approval.

Two things the output tells you and you must act on:

- **Undated rows are not filtered.** `feed` warns how many rows carried no date, because a flat
  playlist without timestamps slips past `--days`. Open those episode pages and check the date
  before adding one. Do not take them on trust.
- **A show line reading `FAILED`** did not sweep. Do not stamp `Last swept` on it (step 6).

## 3. Build the run list, then cut it to six

Queued rows first, then swept episodes, oldest first inside each group.

**Six episodes total across both groups, per run.** Not six per show, and not six on top of the
queued rows. A transcript plus its distillation is roughly 110K tokens, so a 26-episode run is
close to 3M and that is how this becomes a bill. Everything past the sixth is filed back to
Notion as a `Queued` `Episode` row with `notion-create-pages`, and your output says how many
you deferred.

`add` skips a URL already in the bank on its own, so a sweep re-listing last week's episodes
costs nothing. Do not pass `--force`; that is for a deliberate re-transcribe and it pays the
full cost again.

## 4. Ingest

```
python <HOME>/projects/context-bank/cb.py add <url> --show "NAME" --speaker "NAME"
```

The captions path takes seconds. The whisper fallback takes 20 to 40 minutes and `add` is
synchronous, so **run it with `run_in_background`**, or a default Bash call times out at 600
seconds mid-transcription and you will not know whether it landed. If one times out anyway, the
row stays `Queued` and you say so. Never guess.

`add` refuses a truncated transcript rather than writing half of one, so a failure here is
real. Report it, never retry blind. A row that has failed on three separate runs stops being
retried: leave it `Queued` and name it in your output as needing his eyes.

## 5. Distil, in this same run

A transcript nobody distilled is dead weight and that is the way this folder fails. One
subagent per episode, in parallel.

**Pick the target playbook first.** Live files are `attention.md`, `story.md`, `offers.md`,
`hooks.md`, `editing.md`.

- `hooks.md` and `editing.md` are **off limits.** They are rebuilt weekly from live web research
  by `vid-batch/agents/research-*.md` and carry `ttl: 7d`, so anything written there is
  destroyed on schedule. An episode that is only about hooks or editing gets ingested and
  reported, not distilled into those files.
- Domain `ai` and Domain `business` have no playbook yet. Create `playbooks/ai.md` or
  `playbooks/business.md` with `checked:` today and `ttl: 90d` for ai, `timeless` for business,
  and add its row to `INDEX.md` in the same run. An index that does not list a playbook means
  nothing reads it.

**Three of the five playbooks sit within about a line of the 8KB cap.** The cap never rises.
Over it, the weakest play comes out or the file splits by subtopic, and whichever you did gets
named in your output. Silently dropping the new play is the one wrong answer.

The dispatch prompt carries, in words:

- the show, the speaker, the target playbook, and this command as the ONLY way to read the
  transcript: `python <HOME>/projects/context-bank/cb.py transcript <slug>`. Everything
  under `raw/` is blocked by a hook, `cat`, `sed` and Grep included, and that block holds inside
  subagents. The `.meta.json` sidecar is readable.
- the play format from `INDEX.md`, and the rule that a play with no named result behind it does
  not get written
- **the `Source:` anchor is an exact phrase from the transcript, never a line number and never a
  section number.** The `inspo-` example in `INDEX.md` is a legacy form for a non-transcript
  source; do not copy it. Write `raw/<file>.txt "<exact phrase>"` and confirm the phrase really
  is in the file before writing the play.
- the 8KB cap and the eviction rule above
- **do not spawn subagents; do this work yourself**
- verify before reporting: a claim you did not check is wrong

**Do not touch the `checked:` line on line 2 when appending plays.** It governs the whole file
and `cb.py stale` reads it, so stamping today on a file last rebuilt in March reports a stale
playbook as fresh. It moves only on a full rebuild. A brand new playbook gets today's date
because the whole file is new.

## 6. Write back

- `Status: Ingested` only on a row whose transcript landed **and** whose plays were written. A
  transcript with no plays keeps `Queued`, because otherwise the queue holds zero signal that
  undistilled text exists.
- `Last swept` today on every show that swept successfully. Never on one that printed `FAILED`,
  or it goes dark for a week and re-fails silently every run.
- A failed row keeps `Queued` and gets one line in its page body saying why.
- **Read every row back after writing.** A Notion write that reports success and stores nothing
  has happened here before.

## 7. Report

What went in, which playbooks grew and what came out to make room, what failed and why, what
you deferred, and any row now on its third failure.

## A play that got tried and did not work

His words: *"at least we have the strategy and make notes about why it didn't work in that use
case."* A play that failed for him is worth more than a missing one, because the next agent
would otherwise propose it again.

Plays are never deleted for failing. Add a line:

```markdown
**Tried:** 2026-09-14, on the ETB newsletter. Flat. His list is 200 people who came for a
calculator, and the play assumes an audience that already knows the writer.
```

That is Jared's verdict, so write it only when he actually said it. A play carrying a `Tried:`
line still gets proposed when the case differs; name the prior failure when you propose it.

## Do not

- Do not mark a row `Skip`. That is his word for no.
- Do not raise the 8KB playbook cap or the 6-episode run cap.
- Do not write to `hooks.md` or `editing.md`.
- Do not ingest a paid course, a leak, or anything not public and free.
- Do not report a transcript as landed without checking the file exists.
