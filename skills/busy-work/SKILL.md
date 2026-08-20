---
name: busy-work
description: Autonomous backlog-clearing session. The main session acts as orchestrator, working zero-involvement items from the shared backlog with at most 2 subagents at a time, runs until Jared says stop, then produces an artifact summarizing the session.
---

# Busy Work

Run an autonomous work session against the shared backlog, which lives in the **Notion
Backlog database** under the Ops Command Center page (data source
`collection://YOUR-BACKLOG-DATA-SOURCE-ID`). You (the main session) are the
orchestrator, do not spawn a separate orchestrator agent.

**Repointed 2026-07-19.** This skill used to read `aide-data/memory/backlog.md` and promote
leftovers into `todo.md`. Both files were demoted to pointers on 2026-07-12 when Notion
became the source of truth for state, so a run against them would have found nothing to do.

## What counts as zero-involvement

Only work items that need nothing from Jared:

- **Fair game:** research and discovery write-ups, recommendations, plans, local code
  changes in `<HOME>\projects\*`, doc edits, reading screenshots referenced in
  backlog items and writing assessments.
- **Off limits:** anything in the "Personal Items" section; anything requiring Jared's
  decision, his accounts/credentials, spending money, sending outward communication
  (emails, texts, posts), or destructive operations. For these, write a short note in
  the session log, create a row in the Notion **Tasks** database (data source
  `collection://YOUR-TASKS-DATA-SOURCE-ID`) so it does not get lost, and move on.
  If the body names steps to take, write them as a bulleted or numbered list, one action
  per bullet, in order; keep context and dependencies as prose.

## Procedure

1. Read the Notion Backlog DB and pick the zero-involvement work items. Read the Notion
   Tasks DB in the same pass so you do not start something already open or already Done.

   **A SQL query returns properties only. It never returns the page body.** Jared writes
   the scope of an item in the body, under a link, so a row whose title and Notes look
   empty or vague is usually fully specified one `notion-fetch` away. On 2026-07-28 a
   triage pass called the Instagram and YouTube rebrand rows too vague to act on, and on
   2026-07-29 this skill repeated it, both times off the title and Notes alone. The body
   of each said which account and what was wrong with it. **Before you skip ANY row as
   vague, unclear or underspecified, `notion-fetch` that page and read its body.** Skipping
   on a title is the one move this procedure has actually got wrong twice.

   The Backlog has **three** states, and blank is one of them: blank = captured but never
   triaged (a raw voice note or manual add, and usually your queue), `Open` = triaged and
   deliberately parked, `Archived` = resolved, promoted to Tasks, or superseded. Blank is
   NULL in the SQL view and NULL never equals or not-equals anything, so
   `WHERE Status != 'Archived'` silently drops every untriaged row, which is exactly the
   set you are hunting for. Use `Status IS NULL OR Status != 'Archived'`.
2. Create a session log at
   `<HOME>\projects\aide-data\memory\busywork-session-YYYY-MM-DD.md` with a header
   listing the selected items and their status (`queued`).
3. Work the queue yourself by dispatching subagents:
   - Run AT MOST 2 subagents at a time. Dispatch up to 2 (`run_in_background: true`),
     wait for both to finish, log results, then dispatch the next pair. Default subagent
     model: sonnet; use opus only if a task is genuinely gnarly or a sonnet attempt
     failed.
   - Match agent type to job: research/synthesis tasks get web-capable general-purpose
     agents; code tasks get general-purpose agents pointed at the right project directory
     (each project has its own CLAUDE.md - subagents must follow it).
   - Zero Jared involvement: never send outward communication, never touch his external
     accounts, never spend money, nothing destructive. If a task turns out to need his
     input, log it as `skipped - needs Jared` with a one-line reason and move on.
   - Code changes: subagents work in the relevant repo, run builds/tests, and get an
     independent review pass (a second agent reviews the diff) before committing. Commit
     and push only after review clears, per Jared's standing rule. No em or en dashes in
     any user-visible copy, including meta tags and JSON-LD.
   - After EACH task finishes, append a dated entry to the session log: task, outcome
     (done / skipped / failed), files touched, commits, and a 2-3 sentence summary. Also
     set that row's Status to `Archived` in the Notion Backlog DB and write what happened
     into its Notes. **Never delete a backlog row** - the reasoning in Notes is the record
     of why something was done or dropped, and older rows saying "safe to delete this row"
     predate the Status field and are obsolete. Append a dated UPDATE section to the
     matching `projects/*.md` file in the vault
     (`<HOME>\projects\aide-data\memory\`) if the task changed project state.
   - Research/discovery tasks produce a markdown write-up saved next to the session log
     as `busywork-YYYY-MM-DD-<slug>.md`, linked from the log entry.
4. Keep working until the queue is empty or Jared says stop. Stay responsive to Jared
   between dispatches.
5. When the queue is done, write a final `## Session complete` section in the log.
6. **When the session ends (queue empty or Jared says stop):** stop any running
   busy-work subagents (TaskStop), read the session log, load the `artifact-design`
   skill, and publish an Artifact summarizing the session: what was completed (with file
   paths / commits), what was skipped and why, what was written into the Notion Tasks DB, and
   anything awaiting review.
