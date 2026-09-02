# Context bank

Tested methods from practitioners, so agents follow something that worked instead of
inventing something plausible. Read this file, then the ONE playbook that matches your job.

| Playbook | Covers |
|---|---|
| `playbooks/attention.md` | getting seen: distribution habits, posting cadence, what earns a watch |
| `playbooks/story.md` | narrative shape: openings, structure, what makes a piece hold |
| `playbooks/offers.md` | offer construction, pricing, value framing, the ask |
| `playbooks/hooks.md` | spoken hooks, burned-in banners, post captions |
| `playbooks/editing.md` | cut rhythm, pacing, retention, captions on screen |

(In the published copy only `attention.md` ships, as a shape rather than as content. See
[`README.md`](README.md).)

Freshness lives in the files, not here, so the two cannot drift: line 2 of every playbook is
`checked: YYYY-MM-DD   ttl: <7d|90d|180d|timeless>`. Past its ttl, the playbook gets rebuilt
before it gets used. Overwrite, never append, and the rebuild says what it contradicts in the
version it replaced.

## Rules for reading it

- One playbook per job. Loading three is a sign the job is not scoped.
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
sweeps the approved shows for new episodes, distils each transcript into plays in the same
run, and writes `Status: Ingested` back. Run it by hand; nothing watches the table on its own.

```
python cb.py add <url> [--show NAME] [--speaker NAME] [--force]
python cb.py feed "Show=url" ...  # new episodes from an approved show. Lists only.
python cb.py transcript <slug>    # prints one transcript WHOLE. See below before using it.
```

`add` skips a URL already in the bank, so an overlapping sweep costs nothing. `--force`
re-transcribes and pays the full cost again.

`transcript` is the one sanctioned way to read raw text, and it exists for a single caller: the
agent whose whole job is distilling that one episode. It prints 25K tokens. If you are not that
agent, you want `search`.

**The intake list is the Notion Context Sources table, under Ops Command Center.** Jared
adds a row there and nothing else. A row with `Kind: Episode` and `Status: Queued` is a link
to run `add` on; a row with `Kind: Show` is a channel to pass to `feed`. Set `Status` to
`Ingested` when the transcript lands, and stamp `Last swept` on a show after a sweep.

`add` uses published captions when they exist and falls back to whisper when they do not.
Distil the transcript into a playbook in the same session. A transcript nobody distilled is
dead weight, and that is the way this folder fails.

## What a play looks like

```markdown
## Reply to thirty in-niche posts before writing one of your own

**Do:** Ten saved searches, three replies each, two minutes a reply, daily.
**When it works:** Below a few thousand followers, where a reply borrows somebody's reach.
**When it fails:** Thin niches. The seven-day tester ran out of accounts inside a week.
**Evidence:** Jessica M. Castle, 30 days, 127 organic followers, 37 minutes a day.
**Source:** raw/2026-07-25-example-show-ep12.txt "ten saved searches, three replies each"
```

No named result behind it, no play. Cap 8KB per playbook, and the cap never rises: the only
way to add is to sharpen what is there.

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
