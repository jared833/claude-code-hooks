# bank

A methods library built out of podcast and video transcripts, so an agent follows something
that worked instead of inventing something plausible.

Three layers. `breakdowns/*.md` holds one full breakdown per episode, every usable method with
an evidence label (Measured, Reported, Opinion) instead of a filter. `situations.md` files every
play under the decision it helps with, so an agent facing "pricing an offer" finds every play on
it in one place. `raw/*.txt` holds the full transcripts, roughly 25K tokens each, and nothing
reads those directly: a hook refuses it and names a capped search instead. `playbooks/*.md` are
topic views over the same plays. `SKILL.md` is the workflow that turns a queue of links into all
of it without stopping to ask.

Until 2026-10-20 the bank kept only plays with a named number behind them and threw the rest of
each episode away. The operator's verdict: "a dollar sign isn't our filter. we're missing out on
a ton of really good stuff." So evidence became a label on every play, and nothing is dropped.

## What is in here

| | |
|---|---|
| `SKILL.md` | The workflow. The real file out of a working setup: ids and paths swapped, one note added, nothing else |
| `cb.py` | The script it drives: `add`, `search`, `feed`, `transcript`, `stale` |
| `test_cb.py` | 19 tests. `python test_cb.py` |
| `file_situations.py` | Rebuilds `situations.md` from every breakdown, Measured first, keeping hand-written `Conflict:` lines. `--check` first |
| `file_playbooks.py` | Appends each breakdown play not yet in a playbook to a subtopic file, split at 32KB, append-only so a `**Tried:**` line survives |
| `test_file_situations.py`, `test_file_playbooks.py` | Self-checks against a throwaway bank. `python test_file_situations.py` |
| `situations.md` | The tag list, one line per decision an agent faces. No plays |
| `INDEX.md` | The one file an agent reads first, and the play format |
| `playbooks/attention.md` | The shape of a playbook, with one example play. Not content |
| `../../hooks/bank-raw-guard.mjs` | The hook that stops a transcript reaching a context window |

The playbooks and breakdowns themselves are not published. They are one operator's reading of other people's
numbers, distilled from third-party transcripts, and they would be worth nothing to you as
content. The format is the part worth copying.

## Running it

```
python cb.py add <url> [--show NAME] [--speaker NAME]   # captions if they exist, whisper if not
python cb.py search "<exact phrase>"                    # capped at 12 hits of 240 characters
python cb.py feed "Show=url" ...                        # new episodes from a channel. Lists only
python cb.py stale                                      # every playbook's age against its own ttl
python cb.py transcript <slug>                          # one whole transcript, for one caller
```

Needs `yt-dlp` on your PATH. Only sources with no captions at all need `faster-whisper` and
`ffmpeg`; that path is slow, 20 to 40 minutes for a 90 minute episode on CPU, and it is the
exception rather than the normal case.

Install the guard hook at the same time or the guarantee behind the whole design does not hold.
It is `hooks/bank-raw-guard.mjs`, on a `PreToolUse` matcher of `Read|Grep|Bash|PowerShell`, and
it already knows about `skills/bank/raw`, which is where `cb.py` writes when it runs from here.
Guarded directory names are one constant at the top of that file.

## Reading SKILL.md

It is the real workflow and it keeps its specifics, which is the point of this repo. Two things
in it are not yours and will not resolve:

- The Notion queue. `collection://YOUR-CONTEXT-SOURCES-DATA-SOURCE-ID` is a placeholder for a
  table with `Kind` (Episode or Show), `Status` (Queued, Ingested, Skip), `Domain`, `Speaker`
  and `Last swept`. Any list you can read works; the table is not load bearing.
- `<HOME>/projects/context-bank/cb.py` is where the original lives. Here the script sits next to
  the skill, so the command is `python <path to this directory>/cb.py`.

It also names `vid-batch/agents/research-*.md`, which are not published: two research agents that
rebuild the two 7-day playbooks from live web search each week. The rule that matters without
them is the one in `SKILL.md`, that a file rebuilt on a schedule must never be hand-written into.

## Why the caps are hard

An unbounded show sweep is how this becomes a bill, so a run takes twenty episodes (six until
2026-10-05) and the overflow goes back in the queue. Each breakdown runs in its own subagent, so
the transcript never sits in the main session. A playbook is capped at 32KB (8KB until
2026-10-10) and a file that grows past it splits by subtopic; since 2026-10-20 it never drops a
play to make room. The failure all of this guards against is a pile of raw text nobody ever
broke down.
