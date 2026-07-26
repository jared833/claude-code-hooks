# Pipeline config

A shape for letting an agent ship work on a schedule without you approving each step, and
without it merging something broken. Two files, and the second one is six lines.

- [`pipeline.md`](pipeline.md) is the playbook. The agent reads it and executes it top to
  bottom. It holds the invariants, the stages, the blocking checks, what to do when one
  fails, and the definition of done.
- [`pipeline.json`](pipeline.json) is the runtime switch. It holds the handful of values a
  human changes without editing the playbook.

Both are generalized from two live pipelines that run daily. What follows is the reasoning
behind the shape; the specifics are in the playbook.

## Why the config is separate, and this small

```json
{
  "mode": "manual",
  "timezone": "America/New_York",
  "itemsPerDay": 1,
  "publishHourLocal": 9,
  "reviewUrl": "https://example.com/review"
}
```

`mode` is the one that earns its keep.

- **`manual`** publishes only items a human explicitly marked approved.
- **`auto`** treats an unreviewed draft as approved. The only veto left is rejecting an item
  before its scheduled slot.

That single flag is the difference between a pipeline you babysit and one that runs while you
sleep, and being able to flip it from a dashboard rather than a commit is why it lives in
JSON. Start in `manual`. Move to `auto` per pipeline once you have watched enough runs to
trust it, and move it back the moment you stop trusting it. It is one word.

`timezone` exists because schedules are written in UTC and read by humans in local time, and
every date comparison in the pipeline ("has this item's slot arrived?") has to happen in the
human timezone or items publish a day early for half the year.

Everything else in the file is a value you might change on a Tuesday. Anything you would
never change does not belong here, it belongs in the playbook where it can carry its
reasoning. A config key for a value that never varies is a place for the two to drift apart.

## Why the playbook is a markdown file the agent reads

The alternative is putting the process in the scheduling routine's prompt. That fails for a
plain reason: the prompt is not in the repo, so it is not reviewed, not diffed, and not
visible to the interactive session that has to pick up the pieces when a run fails. Keep the
process in the repo next to the code it releases, and let the routine prompt say little more
than "read `pipeline/pipeline.md` and execute it".

It also means a human can run the same process by hand, stage by stage, which is what you
will be doing the first several times anyway.

## The parts that matter

Read [`pipeline.md`](pipeline.md) for the full shape. The load-bearing pieces:

**Invariants.** A short list of things that are never true regardless of what the run
decides. One item per run. Never merge with a failing check. Never push to the main branch
directly. These are written as absolutes because an agent under pressure to finish will
otherwise find a reasonable-sounding exception.

**A resume check as stage zero.** Before starting anything new, look for an unfinished run
from last time and finish that instead. Without this, a pipeline that fails on Tuesday starts
a second unrelated piece of work on Wednesday, and now you have two half-finished branches
and nobody to blame. This is the single highest-value stage in the document.

**Blocking checks, named and separated from advisory ones.** Every check is explicitly one or
the other. A check whose status is ambiguous will be treated as advisory at 3am by an agent
that wants to merge.

**Independent review as a blocking check, dispatched to an agent with no memory of the
build.** See [`../review-prompts/`](../review-prompts/) for why and for the prompts.

**A failure protocol that does not end in a merge.** On any blocking failure: push the
branch, keep the pull request open, label it, comment with the evidence and a suggested next
step, open or update a tracking issue, end the run. The next run's stage zero picks it up.
The pipeline never merges to unblock itself and never silently drops work.

**A definition of done that is stricter than "merged".** Merged is not done. Done includes
production actually serving the thing and the docs matching what the run changed. Without a
written definition, "done" quietly becomes "the last command exited zero".
