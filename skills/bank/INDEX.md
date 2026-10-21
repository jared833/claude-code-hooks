# Context bank

Methods from practitioners, so agents follow something a person actually did instead of
inventing something plausible.

**Start at `situations.md`.** It is organised by the decision you are facing (pricing an offer,
booking the call, choosing a niche). Find your situation, follow its links into the breakdown
sections, and read Measured plays first. That is the one lookup.

- `situations.md`: every play in the bank, filed under each situation it helps with, Measured
  first, with `Conflict:` lines where two plays disagree.
- `breakdowns/<slug>.md`: one full breakdown per episode, every speaker, every usable method,
  each play labeled with its evidence. Open the linked section, not the whole file.
- `playbooks/`: topic views over the same plays, for agents that already read one. Each play
  there links back to its breakdown.

| Playbook | Covers |
|---|---|
| `playbooks/attention.md` | getting seen: distribution habits, posting cadence, what earns a watch |
| `playbooks/story.md` | narrative shape: openings, structure, what makes a piece hold |
| `playbooks/offers.md` | offer construction, pricing, value framing, the ask |
| `playbooks/hooks.md` | spoken hooks, burned-in banners, post captions |
| `playbooks/editing.md` | cut rhythm, pacing, retention, captions on screen |

(In the published copy only `attention.md` ships, as a shape rather than as content, and
`situations.md` ships with its tag list and no plays. See [`README.md`](README.md).)

Freshness lives in the files, not here, so the two cannot drift: line 2 of every playbook is
`checked: YYYY-MM-DD   ttl: <7d|90d|180d|timeless>`. Past its ttl, the playbook gets rebuilt
before it gets used. Overwrite, never append, and the rebuild says what it contradicts in the
version it replaced.

## Rules for reading it

- Start at `situations.md`, then open only the breakdown sections it links. If you use a
  playbook instead, one playbook per job; loading three is a sign the job is not scoped.
- `hooks.md` and `editing.md` are rebuilt weekly from live web research and carry `ttl: 7d`.
  Read them freely; never hand-write into them, because the next rebuild overwrites it.
- `raw/` holds full transcripts and **you never open one**. A single episode is roughly
  25K tokens. `bank-raw-guard.mjs` blocks it and names the alternative. The `.meta.json`
  sidecars beside them are small and always readable; they hold the url, show and speaker.
- When a play is not enough, take the exact phrase from its `Source:` anchor and run
  `python cb.py search "<phrase>"`. Capped at 12 hits of 240 characters, and the cap cannot
  be raised from the command line. It matches words, not meaning, so use the speaker's own
  wording. If no line contains the phrase it falls back to lines containing all the words and
  says so.

## Adding to it

**`/bank` is the thing that runs this.** It reads the queue, ingests every `Queued` row,
sweeps the approved shows for new episodes, writes a full breakdown of each episode in the same
run, files every play in `situations.md` and its playbook, and writes `Status: Ingested` back. Run it by hand; nothing watches the table on its own.

```
python cb.py add <url> [--show NAME] [--speaker NAME] [--force]
python cb.py feed "Show=url" ...  # new episodes from an approved show. Lists only.
python cb.py transcript <slug>    # prints one transcript WHOLE. See below before using it.
```

`add` skips a URL already in the bank, so an overlapping sweep costs nothing. `--force`
re-transcribes and pays the full cost again.

`transcript` is the one sanctioned way to read raw text, and it exists for a single caller: the
agent whose whole job is breaking down that one episode. It prints 25K tokens. If you are not that
agent, you want `search`.

**The intake list is the Notion Context Sources table, under Ops Command Center.** Jared
adds a row there and nothing else. A row with `Kind: Episode` and `Status: Queued` is a link
to run `add` on; a row with `Kind: Show` is a channel to pass to `feed`. Set `Status` to
`Ingested` when the transcript lands, and stamp `Last swept` on a show after a sweep.

`add` uses published captions when they exist and falls back to whisper when they do not.
Break the transcript down in the same session. A transcript with no breakdown is dead
weight, and that is the way this folder fails.

## What a play looks like

Every play, in a breakdown or a playbook, has this shape:

```markdown
### Reply to thirty in-niche posts before writing one of your own
**Situation:** content-cadence, finding-leads
**Do:** Ten saved searches, three replies each, two minutes a reply, daily.
**When it works:** Below a few thousand followers, where a reply borrows somebody's reach.
**When it fails:** Thin niches. The seven-day tester ran out of accounts inside a week.
**Evidence:** Measured. She says 30 days gave 127 organic followers at 37 minutes a day.
**Source:** raw/2026-07-25-example-show-ep12.txt "ten saved searches, three replies each"
```

Evidence is a label, never a filter (Jared, 2026-10-20: "a dollar sign isn't our filter"). A
method with no number stays in the bank and says how strong it is:

| Label | Means |
|---|---|
| **Measured** | a named result with a number: revenue, a test, a before and after, a count |
| **Reported** | the speaker says it worked for them or their clients, with no number |
| **Opinion** | advice, a belief or a rule of thumb, with nothing behind it |

Every number is the speaker's own claim. Plays in a playbook also carry
`**Breakdown:** breakdowns/<slug>.md#<anchor>`. Cap 32KB per playbook (raised from 8KB on
2026-10-10); over it, the file splits by subtopic and the new file gets its row above. A play
is never dropped to make room.

A play in here is a recorded claim, not an endorsement. When one gets tried and does not work,
it stays and gains a line, because otherwise the next agent proposes it again:

```markdown
**Tried:** 2026-09-14, on the ETB newsletter. Flat. His list is 200 people who came for a
calculator, and the play assumes an audience that already knows the writer.
```

Only Jared's own verdict goes on that line. A play carrying one is still worth proposing when
the case differs; say what the prior failure was when you propose it.

`Source:` points at whatever the play actually came from. For a transcript that is
`raw/<file>.txt "<exact phrase>"`, a phrase and not a line number, because re-transcribing
moves every line. `hooks.md` and `editing.md` are the exception: they are rebuilt weekly from
live web research by `vid-batch/agents/research-*.md` and cite their sources inline instead,
so there is nothing to search for in `raw/`.
