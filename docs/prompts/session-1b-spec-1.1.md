# Session 1, follow-up: SPEC 1.1 and the R8 fix

## 1. Context and source of truth

Your Gate 2 report is accepted and the session 1 work is committed. The owner has decided the
open findings. These decisions rule over `SPEC.md` 1.0 where they differ; this task brings
`SPEC.md` and the code in line with them. Verify every premise against the current code
before planning.

Decisions:

- F4: the profile and the rule detectors never depend on the contract. The contract only
  drives the C detectors. Reason: the 0.90 threshold of R2 was calibrated for one definition
  of row similarity (`DECISIONS.md` D7), and invariant 6 stays as written. The proposal to
  rewrite invariant 6 is rejected.
- F7: classified as a rule-definition finding (SPEC §8.5). R8 gets one more condition: on a
  given scale (raw or log10), if more than 5% of the column's numbers fall outside the fences,
  that scale is skipped for that column, because such a column does not have the
  single-cluster shape the fences assume. The 5% is fixed now, before the re-run, and is not
  adjusted afterwards. The proposal to run R8 only on `measure` columns is rejected: it leaves
  rules-only mode unchanged and makes a rule depend on the contract.
- F6: the SPEC text rules. The author of the throwaway reference script confirmed that it
  counted placeholder cells as values when weighting columns. §8.4 takes the numbers measured
  by the implementation.
- F8 and F9: known limitations. No code change.
- F1, F2, F3, F5, F10: the SPEC is updated to match what was approved at Gate 1 and implemented.

## 2. Scope

- `SPEC.md` becomes version 1.1:
  - a "Changes in 1.1" list under the status line, one line per change, each naming its finding;
  - §4.2 and §4.3: `applyDecisions` with its `meta` parameter as implemented, and the changes
    of F2, F3 and F5;
  - §5.2: "Identifier-like" is decided by the header alone; soft placeholders apply only in
    number and date columns; add: "The profile and the rule detectors never depend on the
    contract. A contract can name further missing tokens for a column; they produce C2 issues
    and do not change the profile, the kind of a column or the row similarity.";
  - §5.4, R6: the details of F10 as implemented;
  - §5.4, R8: the 5% condition with its reason;
  - §8.4: replace the R2 reference paragraph with the numbers measured by the implementation
    and one sentence on why the earlier reference differed.
- `src/core/analyze`: the R8 condition, with two tests: a column where more than 5% of the
  numbers are outside the fences produces no outlier issue on that scale; a column with a
  single extreme value still produces one.
- `DECISIONS.md`: under each finding F1 to F10, append a line "Resolution:" with the decision
  above; add F8 to the cut list of §8.

May change: `SPEC.md`, `DECISIONS.md`, `src/core/analyze/**` and its tests, and a new run file
under `evals/runs/`.

May not change: `CLAUDE.md`, `fixtures/**`, `scripts/**`, `docs/**`, and any other file under
`src/` or `evals/`.

## 3. Constraints and non-goals

- No other change of behaviour, and no constant other than the new 5%.
- Nothing from session 2.

## 4. When to stop and ask

- A `zip` value is still reported by `outlier` after the change.
- A true positive of the committed run is lost.
- T1 no longer holds.
- Bringing the SPEC in line with the code would change an interface beyond what Gate 1 approved.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck`, `npm run lint` and `npm test` exit 0. The report gives the test count.
2. `npm run eval` exits 0 and T1 passes. The report pastes the Overall table, the `outlier`
   row of "Precision per detector" and the R2 table.
3. Projection made before this run, to be checked against it: 112 issues, 105 true positives,
   7 false positives, precision 0.9375, recall 0.808; `outlier` with 12 true positives and 4
   false positives. The report puts the measured numbers next to these and explains any
   difference.
4. The report shows `git diff --stat -- SPEC.md`, and
   `git status --porcelain -- CLAUDE.md fixtures scripts docs` prints nothing.
5. The report lists each SPEC change with its section.

## 6. Way of working

One gate, at the end: stop with the report so the owner can read the SPEC diff. There is no
plan gate, because the decisions are already made above.
