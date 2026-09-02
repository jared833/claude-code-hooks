---
domain: attention
sources: []
---
checked: 2026-09-01   ttl: 90d

# Attention

**This file is a starting shape, not content.** The real playbooks are not published: they are
distilled from third-party podcast transcripts, and the plays in them are one operator's
reading of somebody else's numbers. Yours come out of your own queue. Delete the example below
once you have a real play.

Line 2 of the body is the freshness line and `cb.py stale` reads exactly that. `checked:` is the
date the whole file was last rebuilt against live sources, and it moves only on a rebuild, never
when a play is appended. A missing or unknown `ttl` reports "rebuild", never "ok".

Hard cap 8KB. The cap never rises. Over it, the weakest play comes out or the file splits by
subtopic, and whichever you did gets named in the run's output. Silently dropping the new play
is the one wrong answer.

## Reply to thirty in-niche posts before writing one of your own

**Do:** Ten saved searches, three replies each, two minutes a reply, daily.
**When it works:** Below a few thousand followers, where a reply borrows somebody's reach.
**When it fails:** Thin niches. The seven-day tester ran out of accounts inside a week.
**Evidence:** A named person, a named window, a named number. No named result, no play.
**Source:** raw/2026-07-25-example-show-ep12.txt "ten saved searches, three replies each"

`Source:` is a grep anchor: an exact phrase from the transcript, never a line number and never
a section number, because re-transcribing the same episode moves every line.

A play that got tried and did not work is never deleted. It gains a line, in the operator's own
words, because that failure is the thing the next agent cannot re-derive and would otherwise
propose again:

```markdown
**Tried:** 2026-09-14, on the newsletter. Flat. The list is 200 people who came for a
calculator, and the play assumes an audience that already knows the writer.
```
