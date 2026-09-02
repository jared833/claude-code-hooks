# bank

A methods library built out of podcast and video transcripts, so an agent follows something
that worked instead of inventing something plausible.

Two layers. `playbooks/*.md` holds short plays and is what agents read. `raw/*.txt` holds the
full transcripts, roughly 25K tokens each, and nothing reads those directly: a hook refuses it
and names a capped search instead. `SKILL.md` is the workflow that turns a queue of links into
plays without stopping to ask.

## What is in here

| | |
|---|---|
| `SKILL.md` | The workflow. This is the real file out of a working setup, unedited except for the ids |
| `cb.py` | The script it drives: `add`, `search`, `feed`, `transcript`, `stale` |
| `test_cb.py` | 19 tests. `python test_cb.py` |
| `INDEX.md` | The one file an agent reads first, and the play format |
| `playbooks/attention.md` | The shape of a playbook, with one example play. Not content |
| `../../hooks/bank-raw-guard.mjs` | The hook that stops a transcript reaching a context window |

The playbooks themselves are not published. They are one operator's reading of other people's
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

A transcript plus its distillation is roughly 110K tokens, so an unbounded show sweep is how
this becomes a bill: six episodes a run, and the overflow goes back in the queue. A playbook is
capped at 8KB so the only way to add a play is to sharpen what is already there, which is the
mechanism against the real failure, a pile of raw text nobody ever distilled.
