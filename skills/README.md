# Skills

Twelve [Claude Code skills](https://code.claude.com/docs/en/skills) out of a working setup. Eleven
of them are the real production workflows, running unedited except where a private id or a business
specific had to come out. The twelfth is a template.

None of these will run as-is against your accounts. They name a Notion database you do not have,
a local review app that is not published, a Buffer channel that is not yours. That is on purpose
and it is the point: what is worth copying is the **shape**, and the shape only makes sense with
the real decisions left in. A sanitized example with every specific removed teaches nothing,
which is why these keep their arguments, their reversals and the dates they were made on.

Read them for the parts that are hard to invent: where a workflow stops and asks a human, what it
refuses to do, and the note explaining why a previous version was wrong.

| | What it does |
|---|---|
| [`seat-template/`](seat-template/) | The pattern for a "seat": a named role in a one-person company that Claude answers as. Start here |
| [`busy-work/`](busy-work/) | An autonomous backlog-clearing session. Orchestrator plus a bounded number of workers, runs until told to stop |
| [`freebie/`](freebie/) | Ships a free tool on a static site end to end: pick it, build it to a written standard, verify, deploy, record |
| [`post-week/`](post-week/) | Drafts, reviews and queues a week of written content in one sitting |
| [`idea-vet/`](idea-vet/) | Turns raw captured ideas into a shootable menu, with a full script per item |
| [`vid-batch/`](vid-batch/) | Cuts a shoot into finished captioned vertical videos, registers them for review, pushes the approved ones |
| [`written-redraft/`](written-redraft/) | Rewrites drafts that came back with feedback, then puts them back for re-approval |
| [`x-engage/`](x-engage/) | A social engagement session that drafts in the owner's voice and hands off. Review happens in a local app that is not published here |
| [`linkedin-engage/`](linkedin-engage/) | The same, for a second network |
| [`coloring-book/`](coloring-book/) | Builds a print-ready book page by page, with correct trim and bleed |
| [`build-tool/`](build-tool/) | The spec-first checklist for building one calculator on a technical reference site. Four files, in a fixed order |
| [`validate-accuracy/`](validate-accuracy/) | Re-derives a calculator's math from the source it claims to implement, without trusting anything its builder wrote |

## The seat pattern is the reusable idea

Seven of the skills in the original setup are seats: analytics, chief of staff, content, email,
support and fulfillment, backup and continuity, engineering. Those are not published here,
because their content is one specific business's pricing, roadmap and refund policy, which is
worth nothing to you. The pattern behind them is worth a lot, so that is what
[`seat-template/`](seat-template/) carries.

A seat is a role, not a subagent. The load-bearing part is two lists: **what the seat decides
alone** and **what it must escalate**. Written down, they turn "help me with this" into
delegation with a boundary. Left unwritten, every question comes back to you, which is the thing
you were trying to stop.

Six seats that match the jobs your business actually has beat forty-five that describe an org
chart you do not have.

## Three things worth stealing even if you never run any of these

**A queue that never drains.** `idea-vet` and the producers treat the idea database as a menu,
not a backlog. Nothing consumes an entry, an unused idea is never "rejected", and several
versions of one idea are deliberate. Most content systems fail by treating ideas as tickets.

**Stop-and-ask points written into the workflow.** `vid-batch` renders and registers, then stops.
It does not publish. The human approval step is a line in the file, not a habit, which is why it
survives a run at 2am.

**Reversals kept in the file, with dates.** Several of these carry a note saying a previous
version of the rule was wrong and why, including one where a counter-signal was found, then its
confound was found the same day. Keeping the argument is what stops the next session
rediscovering a dead idea and reading it as new.

## Installing one

Copy the directory into `~/.claude/skills/` (personal) or `.claude/skills/` in a repo (project).
Claude reads the frontmatter `description` to decide when to load it, so rewrite that line first:
it is the only part that determines whether the skill ever fires.

Then work through the file and replace every placeholder. The ones that were scrubbed are
obvious: `YOUR-CONTENT-BANK-DATA-SOURCE-ID`, `YOUR-TASKS-DATA-SOURCE-ID`,
`YOUR-BACKLOG-DATA-SOURCE-ID`, `YOUR-BUFFER-ORG-ID`, `<CANVA-DESIGN-ID>`, `<HOME>`, and any
other `<angle-bracket>` value.

MIT, same as the rest of the repo.
