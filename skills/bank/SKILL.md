---
name: bank
description: Drain the Notion Context Sources queue into the context bank - ingest every queued link, write a full breakdown of each episode, file every play by the situation it helps with, sweep approved shows for new episodes, and write status back to Notion. Use when Jared says /bank, "run the bank", "ingest the queue", or on a schedule.
---

# Drain the intake queue

Jared adds a row to Notion and nothing else. This turns that row into a full breakdown an agent
can search by the decision in front of it. Nothing here waits on him: he said so on 2026-09-01,
*"that's not really a judgment call, that's synthesizing information and can run without me. If
something is pulled from the bank and I don't like the idea, I can always say no."* And on
2026-10-20: *"I don't want to have to review each and every podcast dissection, that is the
opposite direction of where I want to go."*

So **a play entering the bank is not an endorsement.** It is a recorded claim, labeled with how
strong its evidence is. Taste happens later, at point of use.

**What changed on 2026-10-20.** The bank used to keep only plays with a named result, and threw
the rest of every episode away. Jared: *"We need to adjust the skill so that a dollar sign isn't
our filter. we're missing out on a ton of really good stuff."* Now every episode gets a full
breakdown. Evidence is a label on each play, never a reason to drop one.

Run everything with the full path, since sessions launch from a home directory, not the bank:
`python <HOME>/projects/context-bank/cb.py ...`

(Reading this out of the public repo: `cb.py`, `file_situations.py` and `file_playbooks.py` sit
next to this file, so that path is `python <path to this directory>/<script>`. [`README.md`](README.md)
covers the rest.)

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

Query that data source. Take two sets: rows with `Status: Queued` and `Kind: Episode`, and rows
with `Kind: Show` whose `Last swept` is missing or older than 7 days.

## 2. Sweep the approved shows

One call, all of them at once:

```
python <HOME>/projects/context-bank/cb.py feed "Name=URL" "Name=URL" ... --days 14
```

It lists and never ingests. Treat each listed episode as a queued row: he already approved the
show, so a new episode from it needs no second approval.

- **Undated rows are not filtered.** `feed` warns how many rows carried no date. Open those
  episode pages and check the date before adding one.
- **A show line reading `FAILED`** did not sweep. Do not stamp `Last swept` on it (step 7).

## 3. Build the run list, then cut it to twenty

Queued rows first, then swept episodes, oldest first inside each group. **Twenty episodes total
per run** (Jared, 2026-10-05). Everything past the twentieth is filed back to Notion as a
`Queued` `Episode` row, and your output says how many you deferred.

`add` skips a URL already in the bank. Do not pass `--force` unless re-transcribing on purpose.

## 4. Ingest

```
python <HOME>/projects/context-bank/cb.py add <url> --show "NAME" --speaker "NAME"
```

Captions take seconds; the whisper fallback takes 20 to 40 minutes and `add` is synchronous, so
**run it with `run_in_background`**. If one times out, the row stays `Queued` and you say so.
`add` refuses a truncated transcript, so a failure is real: report it, never retry blind. A row
that has failed on three separate runs stops being retried: leave it `Queued` and name it.

The bank cannot pull audio from Spotify or Apple. For a podcast link, find the same episode's
YouTube upload and ingest that; say which URL you used.

## 5. Break it down, in this same run

A transcript nobody broke down is dead weight. **One subagent per episode, in parallel.** Each
writes one file, `breakdowns/<slug>.md`, where `<slug>` is the transcript's file name without
`.txt`. The dispatch prompt carries everything in this step, plus:

- this command as the ONLY way to read the transcript:
  `python <HOME>/projects/context-bank/cb.py transcript <slug>`. Everything under `raw/`
  is blocked by a hook, and that holds inside subagents. The `.meta.json` sidecar is readable.
- **do not spawn subagents; do this work yourself**
- verify before reporting: every `Source:` phrase must really be in the transcript. Check it with
  `cb.py search "<phrase>"` before writing it down.

### What goes in: everything a practitioner would use

Cover the **whole episode**, every speaker. Keep every key point, workflow, process, best
practice, sales tactic, content and social media strategy, pricing and offer idea, hiring and
operations method, tool, number, script and exact wording worth reusing. Keep the host's own
analysis too, in its own section and labeled as the host's. The ONLY things left out are ad
reads, sponsor segments, small talk and biography with no lesson in it. Say in one line at the
end what you left out.

A method with no number behind it **stays**. It gets an evidence label instead:

| Label | Means |
|---|---|
| **Measured** | a named result with a number: revenue, a test, a before and after, a count |
| **Reported** | the speaker says it worked for them or their clients, with no number |
| **Opinion** | advice, a belief or a rule of thumb, with nothing behind it |

Every number is the speaker's own claim. Write "she says" or "he reports", never state it as
fact. Name anything you could not confirm (a misheard name in the captions, a date).

### The breakdown's shape

```markdown
# <Episode title>
show: <show>   speaker: <guest or main speaker>   host: <host>   date: <published>
url: <url>   length: <h:mm>   transcript: raw/<slug>.txt
situations: <comma list of the situation tags this episode feeds, from situations.md>

## In one minute
Five to eight lines: what this episode is really about and its strongest ideas.

## <Topic section> (<start>-<end>)
One section per real topic in the episode, in episode order, as many as the episode has.
Prose plus whatever makes it usable: numbered steps for a workflow, a table for a schedule or a
price ladder, the exact script or wording in quotes when the wording is the point.
Every play in the section follows its prose, in the play format below.

## The host's take (<start>-<end>)
Their principles and examples, labeled as theirs, with plays where they give one.

## Adopt, test or be careful
| Idea | Verdict | Why |
One row per major idea. Adopt = strong and general. Test = worth trying, depends on the case.
Careful = specific to the speaker's scale or audience, or contradicted elsewhere in the bank.

## For Jared's two lines
**Role Build** (done-for-you AI that takes an office seat's work off small firms, sold through
cold outreach and scoping calls): what transfers, what does not, and why.
**The Back Office** ($79 a month Skool community for small business owners and operators setting
up AI): what transfers, what does not, and why.
Say "nothing here" when nothing does. Do not force it.

## Timestamps
| Time | Topic |

Left out: <one line>
```

### The play format

```markdown
### <Imperative title: what to do>
**Situation:** <tag>, <tag>
**Do:** the method, concrete enough to act on.
**When it works:** the conditions.
**When it fails:** the conditions, or "not stated".
**Evidence:** Measured | Reported | Opinion. Then what was actually said, with numbers.
**Source:** raw/<slug>.txt "<exact phrase from the transcript>"
```

The `Source:` anchor is an exact phrase, never a line number or timestamp alone, because
re-transcribing moves every line. A breakdown is not capped; an episode gets as many plays as it
really holds.

## 6. File it so an agent can find it

The point, in Jared's words: *"I want the full breakdowns managed in such a way that an agent
can quickly identify a play that may be applicable to a current scenario or decision."*

**`situations.md`** is the one lookup. It is organised by the decision an agent is facing, not
by topic or speaker. After each breakdown lands, add one line per play under every situation the
play carries:

```markdown
## pricing-an-offer
Setting or changing a price, a price ladder, discounts.
- Price low ticket at $27-97, skip $197-997 (Maria Wendt, Measured) breakdowns/<slug>.md#price-low-ticket-at-27-to-97
```

- Do not hand-write the play lines. Run `python <HOME>/projects/context-bank/file_situations.py --check`,
  fix what it lists, then `python <HOME>/projects/context-bank/file_situations.py`, which
  rebuilds every tag section from the breakdowns and keeps the one-line `Conflict:` entries.
- Use an existing situation tag when one fits. Make a new one only when none does, and give it a
  one-line description. The file opens with a list of every tag and its description; keep it
  current.
- Under each tag, Measured plays first, then Reported, then Opinion.
- When two plays under one tag contradict each other, add a line `Conflict:` naming both. That
  is what Dolores and the other agents need to see, never something to resolve by deleting one.

**Playbooks** in `playbooks/` stay, as topic views for the agents that already read them. Add each
new play to the playbook its topic belongs in, in the same play format, with a
`**Breakdown:** breakdowns/<slug>.md#<anchor>` line. Never remove a play or a `**Tried:**` line
already there. A playbook over 32KB splits by subtopic (and gets its row in `INDEX.md`); it never
silently drops a play. Do not touch line 2 (`checked:`) when appending.

- Do not hand-copy plays. Link any play already in a hand-kept playbook with a `**Breakdown:**`
  line first, then run `python <HOME>/projects/context-bank/file_playbooks.py --check` and
  the plain run. It appends the rest to subtopic files (`playbooks/<playbook>-<tag>.md`, split at
  32KB) and prints any new file, which gets a row in the subtopic table in `INDEX.md`.

- `hooks.md` and `editing.md` are **off limits**. They are rebuilt weekly from live web research
  and anything written there is destroyed. Plays about hooks or editing go in the breakdown and
  in `situations.md` only.

## 7. Write back

- `Status: Ingested` only on a row whose transcript landed **and** whose breakdown was written
  and filed in `situations.md`. Otherwise it keeps `Queued`.
- `Last swept` today on every show that swept successfully. Never on one that printed `FAILED`.
- A failed row keeps `Queued` and gets one line in its page body saying why.
- **Read every row back after writing.** A Notion write that reports success and stores nothing
  has happened here before.
- Commit and push the context-bank repo.

## 8. Report

What went in, how many plays each breakdown holds and how many are Measured, which situation
tags are new, any `Conflict:` lines added, what failed and why, what you deferred, and any row on
its third failure.

## A play that got tried and did not work

His words: *"at least we have the strategy and make notes about why it didn't work in that use
case."* Plays are never deleted for failing. Add a line, and only when Jared actually said it:

```markdown
**Tried:** 2026-09-14, on the ETB newsletter. Flat. His list is 200 people who came for a
calculator, and the play assumes an audience that already knows the writer.
```

## Do not

- Do not drop a play because it has no number. Label it.
- Do not mark a row `Skip`. That is his word for no.
- Do not raise the 20-episode run cap without Jared.
- Do not write to `hooks.md` or `editing.md`.
- Do not ingest a paid course, a leak, or anything not public and free.
- Do not report a transcript as landed without checking the file exists.
