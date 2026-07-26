# Release playbook

Template. This is the file a scheduled agent reads and executes top to bottom to ship one
piece of work per run. Replace the bracketed parts with your project's specifics and delete
anything that does not apply. The scheduled routine's own prompt should say little more than
"read `pipeline/pipeline.md` and execute it end to end".

Where this document and the project conventions file disagree, the conventions file wins on
principles (accuracy, tone, compliance) and this document wins on process.

## Invariants (never violate)

- Ship exactly **one** unit of work per run.
- **Never merge with a failing blocking check.** No exceptions, no "close enough".
- **Never push to the main branch directly. Never force-push.** Everything reaches main
  through a squash-merged pull request.
- **Never build anything on the do-not-build list** in `[roadmap file]`.
- Run `npm ci` before any build or test step in a fresh environment.

## Stage 0: resume check

```
gh pr list --label pipeline --state open
gh issue list --label pipeline --state open
```

If an open pipeline pull request exists, **this run's job is to finish that one.** Do not
start new work. Check out its branch, read the blocked comment for what failed, fix it, then
rerun from the checks stage. On success, close any open issue titled `Pipeline blocked: <item>`
with a comment linking the merged pull request.

If there is no open pull request but there IS an open issue titled `Deploy failed: <item>`,
**this run's job is to finish that one instead.** That issue comes from stage 9, which runs
after the merge, so there is no pull request left to find. Re-verify production for that item.
If it now serves correctly, close the issue with a comment saying so. If it still does not,
add a comment with what you observed and stop, because the fault is in the host and not in
the work. Check this before starting anything new.

If neither exists, continue.

## Stage 1: selection

Pick the next item from `[roadmap file]` by the rule written there, skipping anything on the
do-not-build list.

Fetch before you read anything about remote state: `git fetch origin main` as its own command,
then confirm `git rev-parse origin/main` matches `git ls-remote origin main` before branching.
A combined fetch of several refs aborts atomically if any one of them is missing, which
silently leaves your `origin/main` stale, and a branch based on a stale main reverts
everything shipped since when it merges.

If the backlog is empty, extend it rather than halting: research candidates, filter them
against the do-not-build list and the project's compliance rules, append a few to the roadmap
with a one-line rationale each, and build the top one this same run.

```
git checkout -b ship/<YYYY-MM-DD>-<slug> origin/main
```

## Stage 2: spec

Write `docs/specs/<slug>.md` before writing code, modeled on `[your gold-standard spec]`.
Required sections: identity and target; the derivation or approach with assumptions stated;
inputs with ranges, units, and validation; the output contract; **hand-derived reference
scenarios with the arithmetic shown**; documented deviations from any comparable third-party
implementation and why; an explicit out-of-scope list for v1.

The spec is what the independent validator in stage 6 works from. A vague spec makes that
check meaningless, which is the actual reason this stage exists.

## Stage 3: build

Follow the project's file convention. Then complete the registration checklist, which is the
part that gets forgotten:

- [ ] Linked from the index or navigation
- [ ] Added to the footer or sitemap source
- [ ] Roadmap row flipped to shipped
- [ ] Run appended to `docs/pipeline-log.md` (date, item, pull request number, result)

## Stage 4: independent code review (blocking)

Dispatch a **fresh agent with no memory of writing the code**, using
[`../review-prompts/README.md`](../review-prompts/README.md) prompt 1. Its input is the branch
name, the diff against `origin/main`, the conventions file, and the requirement. It must not
receive the build conversation.

Fix every finding, or record in the pull request body why a finding is not one. An
unaddressed finding is a failure. If subagent dispatch is genuinely unavailable, fall back to
an in-session review command and say so in the pull request body; the check still has to
pass, you are only recording that this run had less independence than the process asks for.

Also verify by hand:

- No new entries in `package.json` dependencies or devDependencies without a stated reason.
- No copyrighted source text pasted verbatim.
- Tone and voice match the conventions file.

## Stage 5: local checks

```
npm run lint            # blocking
npm test -- --run       # blocking
npm run build           # blocking
npm run check:baseline  # blocking, runs on dist/
[project-specific checks]
npm run typecheck       # advisory
```

Every line is labeled blocking or advisory. An unlabeled check will be treated as advisory by
a run that wants to finish.

Run the output checks against the **built tree**, not source. A source-only scan misses
anything a build step, a component library, or a copied vendor file puts back after your
source is clean.

## Stage 6: independent validation (blocking)

For anything whose output has a right answer defined outside your code, run
[`../review-prompts/README.md`](../review-prompts/README.md) prompt 2. Derive expected values
by hand from the source before reading the test file, compare against actual output,
spot-check the source data, cross-check one scenario against a named independent
implementation. Paste the worksheet into the pull request body. A missing worksheet is itself
a failure.

Skip this stage only when the change has no external correct answer to check against, and say
so in the pull request.

## Stage 7: pull request and preview QA (blocking)

1. Push the branch and open a pull request with a structured body: what shipped, the spec
   link, the stage 6 worksheet, and a checklist of every blocking check with its result. Add
   the `pipeline` label.
2. `gh pr checks <num> --watch`. CI must pass.
3. Fetch the deploy preview URL and assert the real thing: HTTP 200, the heading, any required
   legal or disclaimer text, the component markup. Fetch the index and assert the new item
   appears.

If the session's network policy blocks the preview host (a proxy refusing the connection, not
a 404 or 500 from the site), do not route around it. Satisfy this check instead with the
conjunction of the hosting provider reporting a successful deploy for the exact commit under
review, and the stage 5 local check of that same commit asserting the same items the live
fetch would have. Record the substitution in the pull request body.

## Stage 8: merge

Only when every blocking check is green:

```
gh pr merge <num> --squash --delete-branch
```

Any failure sends you to the failure protocol. Do not merge.

## Stage 9: production verification

Poll every 60 seconds for up to 15 minutes: the production URL returns 200 with the expected
content, and the sitemap includes it. If production never serves it, do **not** roll back the
merge. The work passed every check before merging, so a rollback would throw away good work to
cover a host problem. Open a GitHub issue titled `Deploy failed: <item>` with the `pipeline`
label, describing what you polled and what you saw, so a human investigates the host. The next
run's stage 0 looks for exactly that issue and picks it up.

## Definition of done

A run is DONE when every line is true. A run that merges without all of them is a process
failure even if nothing breaks. **Merged is not done.** Done is the state after stage 9.

1. The file convention is complete and a spec exists.
2. The registration checklist is complete: navigation, footer or sitemap, roadmap row,
   pipeline log row.
3. Every blocking check passed and the evidence is in the pull request.
4. An independent reviewer signed off and findings are fixed or dispositioned in writing.
5. The validation worksheet is in the pull request body, or the stage is documented as not
   applicable.
6. Preview QA passed, or the blocked-network substitution was satisfied and recorded.
7. The pull request was squash-merged and production serves it.
8. Docs match live behavior. Anything this run changed about process or structure is
   reflected in the same pull request, not left for later.
9. The run summary states what shipped and any substitutions used. If any blocking check
   could not be brought green: no merge, and the failure protocol below was followed instead.
   That is the only other acceptable end state.

## Failure protocol

On any blocking failure, stop before merging:

1. Push the branch as-is and keep the pull request open.
2. Add the `pipeline-blocked` label.
3. Comment on the pull request: which check failed, the evidence (test output, mismatch
   table, URL and status code), and a suggested next step.
4. Open a GitHub issue titled `Pipeline blocked: <item>` describing the failure and linking
   the pull request, or comment on it if it already exists.
5. End the run.

The next run's stage 0 resumes this pull request, so a failure never forks the backlog and
never quietly disappears.
