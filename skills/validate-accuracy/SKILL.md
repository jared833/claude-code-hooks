---
name: validate-accuracy
description: Independently validate a calculator's NEC math before it ships. Re-derives expected values from the NEC tables/formula by hand, compares against actual calculator output, spot-checks source data, and cross-checks one scenario against an independent tool. A blocking check in the release pipeline; also usable interactively as /validate-accuracy <tool-slug>.
---

# validate-accuracy

Validate `site/src/lib/calculators/<slug>.js` against the NEC source it claims to
implement. This is the accuracy check: a tool that fails here does not merge.

**Core principle: do not trust the test file.** The same model that wrote the calculator
wrote its tests, so a shared misunderstanding passes tests while being wrong. Derivations
here must come from the NEC data and formula directly.

## Procedure

### 1. Fresh derivation (before reading the test file)

Open `docs/specs/<slug>-spec.md` and every `site/src/data/nec-tables/*.json` the calculator
imports. Choose **at least 3 scenarios, covering every code path/branch** of the calculator
(each conditional rule, for example NEC 240.4(B) round-up versus 240.4(D) small-conductor
caps, gets at least one scenario). For each, re-derive the expected outputs **by hand from
the table values and the formula**, writing out the arithmetic. Do NOT read
`<slug>.test.js` expectations until your derivations are committed to the worksheet.

### 2. Compare against actual output

Run the real calculator on each scenario, with a scratch `node` invocation:

```
cd site && node -e "import('./src/lib/calculators/<slug>.js').then(m => console.log(JSON.stringify(m.calculate({...}))))"
```

Any mismatch between derived and actual = **FAIL**. (Rounding: match the precision the
tool displays; a discrepancy beyond display precision is a mismatch.)

### 3. Source-data spot check

For each NEC data JSON the tool uses, verify **at least 3 entries** against the published
NEC values cited in the file's header comment (edition, table number). This catches
transcription errors, the most likely failure mode for table-driven tools. A file whose
header lacks the edition + table citation also fails.

### 4. External cross-check

Cross-check **at least 1 scenario** against a named independent third-party calculator
(WebFetch). Name the specific tool and paste its URL in the worksheet; if the first one is
unreachable, use a different named tool rather than skipping the step.

- Exact numeric match is NOT the bar. Documented methodology deltas (for example our unity
  power factor against a third-party tool's 0.9 PF) are acceptable **only if the deviation
  is already explained in the spec or the page's methodology content**.
- An unexplained delta = **FAIL**.
- No reachable independent source at all = **FAIL** (do not ship unverified NEC math).

### 5. Worksheet

Produce a validation worksheet and paste it into the PR body. Its absence is itself a
failure of this check. Format:

```
## Accuracy validation: <tool> (<date>)

| # | Scenario | NEC source | Hand derivation | Expected | Actual | Pass |
|---|----------|-----------|-----------------|----------|--------|------|

### Source-data spot check
<table file>: <entry> = <value> vs NEC <edition> Table <n>: <value> = OK/FAIL (x3+)

### External cross-check
<source + URL>: scenario #N -> theirs <x>, ours <y>, delta <z>, explained by <documented
assumption> / FAIL

### Verdict: PASS / FAIL (<failed step>)
```

---

## Notes for adapting this outside electrical code

Redaction note: the original names the specific third-party calculators used for step 4. Pick
your own and name them in the worksheet; the method needs a *named* independent source, not a
particular vendor.

The steps above map onto any domain with a published source of truth:

1. **Re-derive before you read the tests.** The ordering is the whole trick. Once you have read
   what the code expects, you cannot un-read it, and your "independent" derivation will land on
   the same answer for the same wrong reason.
2. **Run the real thing.** Not a summary of it, not a description of what it should do.
3. **Spot-check the copied data.** Any time a human or a model transcribes a table into JSON,
   assume some rows are wrong until three of them are checked. This is where errors actually live.
4. **Find one outside opinion and explain every difference.** A difference you can explain is
   fine. A difference you cannot explain means one of you is wrong and you do not yet know which.

The worksheet is not paperwork. It is the artifact that makes step 1 checkable after the fact,
and it is what a reviewer reads instead of taking your word.
