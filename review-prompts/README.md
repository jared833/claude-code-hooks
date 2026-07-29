# Independent review prompts

Two prompts you paste into a **fresh** agent before a change ships. Both exist to answer one
question that a model cannot answer about its own work.

## The thesis

> Do not trust the test file, because the same model that wrote the code wrote its tests.

That sentence is the whole method. A model that misunderstood the requirement writes code
expressing the misunderstanding, then writes tests asserting the misunderstanding, then runs
them, then reports green. Nothing in that loop can detect the error. The tests are not
evidence of correctness, they are a second copy of the same belief.

The fix is cheap and it is not "write better tests". It is to put the check in a context that
does not contain the belief. So:

- **The reviewer must have no memory of writing the code.** Not a fresh instruction to the
  same session. A separate agent, whose input is the diff and the requirements and nothing
  else. If the build conversation is in its context, this is self-review wearing a costume.
- **The reviewer re-derives from the source of truth, not from the artifact.** For anything
  with a right answer that exists outside your code (a published table, a spec, a standard, a
  rate card, a legal threshold), the reviewer works the answer out from that source by hand
  and then compares. Reading the code to see what it does and agreeing is not review.
- **The derivation happens before the reviewer reads the existing tests.** Order matters.
  Expected values seen first become an anchor, and the reviewer will explain its way to them.

Two prompts follow because these are two different jobs. The first checks the code. The
second checks the answers. Run both when a change has both properties. Neither replaces the
other, and a change that only passes one is not finished.

---

## Prompt 1: independent code review

For correctness, security, and whether the change could be smaller. Dispatch a fresh agent
whose context is only what is below.

```
You are reviewing a change you did not write. You have no context on why it was
built this way, which is the point.

Inputs:
  - Branch: <branch name>
  - Diff: the output of `git diff <base>` (paste it, or give the agent repo access
    and the command)
  - The project's conventions file (CLAUDE.md or equivalent)
  - The requirement this change was supposed to satisfy, in one paragraph

Review for, in this order:

1. CORRECTNESS. Does it do what the requirement says, including at the edges?
   Trace at least one real input all the way through by hand. Name the specific
   input that breaks it, or say you could not find one and what you tried.
   Do NOT read the change's own test file until you have formed your own view
   of what the code should produce. Then read it and ask a separate question:
   would these tests pass if the code were wrong in the way you were worried
   about? A test that would pass either way is not coverage.

2. SECURITY. Untrusted input reaching a sink: injection, path traversal,
   command construction, deserialization, unescaped output. Secrets in the
   diff or in anything the diff logs. Auth or ownership checks that the new
   path skips. State the reachable path, not the theoretical category.

3. SIMPLIFICATION. What in this diff should not exist? Reimplemented standard
   library, an abstraction with exactly one caller, a config value that never
   varies, error handling for a condition that cannot occur, a new dependency
   for something small. Propose the smaller version concretely.

4. CONVENTIONS. Anything the diff violates in the conventions file. New
   dependencies added without a stated reason. Docs that the change made
   wrong and did not update.

Output: a numbered list of findings, each with file:line, severity
(blocking / should fix / note), and a concrete fix. If a section is clean,
say so explicitly and say what you checked. Do not pad the list; a short
honest review beats a long one.
```

One addition worth making to that prompt when the change under review IS a test file:
**make the reviewer break the code on purpose and confirm the test goes red.** Reading a test
and agreeing that it looks right is the same move as reading code and agreeing that it looks
right, and it fails the same way. Copy the module, mutate one behaviour, run the suite. A
mutation the suite survives is a behaviour nobody is testing, whatever the test labels say.

That check found two dead tests in this repo's own review hook on the day it shipped. One
asserted that an unrelated tool result does not count as a review, and the fixture it used was
a matching pair, so it was a byte-for-byte duplicate of the test above it wearing a different
label. Nine mutations, seven caught, two survivors, both of them cases the labels claimed.

Every finding is either fixed or answered in writing before the change ships. An unaddressed
finding blocks the merge. "The reviewer misunderstood" is an acceptable answer, written down
where the next person can read it.

## Prompt 2: independent value validation

For anything whose output has a correct answer defined somewhere outside your code: a
published table, a standard, a formula, a tax or rate schedule, a regulatory threshold. This
is the prompt that catches the transcription error, which is the single most likely failure
mode in table-driven code and the one that unit tests structurally cannot catch.

```
Validate <module or feature> against the source it claims to implement. Your job
is to establish the right answers independently and then see whether the code
agrees. It is not to check that the code is self-consistent.

CORE RULE: do not read the module's test file until step 4. The same author wrote
both, so a shared misunderstanding passes tests while being wrong.

1. FRESH DERIVATION. Read the spec and the source data the module imports. Pick
   at least 3 scenarios that together exercise every branch (each conditional
   rule gets at least one). For each, derive the expected output BY HAND from the
   source values and the formula, and write out the arithmetic step by step.
   Commit these derivations to your worksheet before running anything.

2. COMPARE. Run the real code on each scenario and record actual output. Any
   mismatch is a FAIL. Match the precision the product actually displays; a
   difference beyond display precision is a mismatch, not a rounding artifact.

3. SOURCE-DATA SPOT CHECK. For each data file the module reads, verify at least
   3 entries against the published source cited in that file's header. This
   catches transcription errors. A data file whose header does not cite its
   source (edition, table, URL, date) fails on that alone.

4. EXTERNAL CROSS-CHECK. Check at least 1 scenario against a named independent
   implementation or published worked example. Rules: an exact numeric match is
   not the bar, because other implementations bake in their own assumptions. A
   difference is acceptable ONLY if the assumption behind it is already
   documented in your spec or user-facing methodology. An undocumented
   difference is a FAIL. No reachable independent source at all is a FAIL: do
   not ship unverified math.

5. WORKSHEET. Produce this and attach it to the pull request. Its absence is
   itself a failure.

## Validation: <module> (<date>)

| # | Scenario | Source | Hand derivation | Expected | Actual | Pass |
|---|----------|--------|-----------------|----------|--------|------|

### Source-data spot check
<file>: <entry> = <value> vs <source> <table>: <value>  OK/FAIL   (3 or more)

### External cross-check
<source + URL>: scenario #N, theirs <x>, ours <y>, difference <z>,
explained by <documented assumption> / FAIL

### Verdict: PASS / FAIL (<which step failed>)
```

## Where this fits

Both are blocking checks in [`../pipeline/`](../pipeline/), which is the release playbook
these came out of. The short version: independent code review runs on every nontrivial
change, value validation runs on anything with an external right answer, and neither is
optional because a run is easy and a wrong answer shipped to a user is not.

One practical note. If your session genuinely cannot dispatch a subagent, running a
review command inside the same session is a weaker substitute, and you should say in the
pull request that you substituted it. The check still has to pass. You are just recording
that this run had less independence than the process asks for, so nobody later mistakes it
for the real thing.
