# Session 1, second follow-up: fixes from the independent review

## 1. Context and source of truth

The SPEC 1.1 work is committed. An independent reviewer read the session 1 commit and found no
blocker and several smaller problems. The owner has decided which ones are fixed now.
`SPEC.md` rules; this task takes it to version 1.2 where stated below. Verify every premise
against the current code before planning: the file and line references come from the review
and may have moved.

Review items and the decision for each:

- S1, `evals/score.ts` near lines 70 to 77: a `duplicate` issue can locate a junk record.
  Decision: a `duplicate` issue only ever locates a duplicate error. Reason: "these two rows
  are the same entity" is a different claim from "this row is junk", and the strict reading
  can only lower the reported numbers.
- S2, `src/core/csv/index.ts` near line 41: a single-column dataset with an empty cell may not
  survive the round trip. Decision: add the case to the `csv round trip` test; if it fails,
  fix it in `serializeCsv` only. Parsing keeps the rule of SPEC §5.1 that empty lines are skipped.
- S4, `evals/run.ts` near line 14 and the near-duplicate detector: the 0.90 threshold is
  declared twice. Decision: one declaration, exported by `src/core/analyze` and imported by
  the eval.
- S5, `evals/run.ts` near line 144: a T1 failure still exits 0. Decision: `npm run eval` exits
  with a non-zero code when T1 fails.
- `evals/run.ts` near line 68: the T1 check passes when a detector id it reads does not exist
  in the results. Decision: it fails in that case.
- The R2 table of the eval still prints a "reference" column with the numbers of SPEC 1.0.
  Decision: remove the column; §8.4 already holds the measured numbers.
- `spelling.ts` near line 10: a CRLF line break inside a cell counts as repeated whitespace and
  gets a high-confidence fix that joins the lines. Decision: R4 collapses runs of spaces and
  tabs only, and never changes a line break inside a cell.
- `src/core/analyze/index.ts` near line 59: the group key omits `source`, and the detector id
  `placeholder` is shared by R3 and C2. Decision: `source` is part of the group key.
- Logged as findings, with no code change: S3 (R6 does not flag an unambiguous slash date
  written in the minority order, and such a date removes the column's evidence of order); the
  fix of an `extra` issue is never checked for fabrication.

## 2. Scope

- The code changes above, each with a test that fails before the change and passes after it.
- `SPEC.md` becomes version 1.2, with a "Changes in 1.2" list:
  - §4.3: `groupIssues` groups by type, detector, source, column and target value;
  - §5.4, R4: "repeated inner spaces or tabs outside free text; a line break inside a cell is
    never changed";
  - §8.2: "An error with no columns (a junk record) is located by any issue on its row that is
    not a `duplicate` issue.";
  - §8.3: "`npm run eval` exits with a non-zero code when T1 fails."
- `DECISIONS.md`: append the review items as findings F11 onwards, each with its "Resolution:"
  line.

May change: `SPEC.md`, `DECISIONS.md`, `evals/**`, `src/core/csv/**`, `src/core/analyze/**`
and their tests.

May not change: `CLAUDE.md`, `fixtures/**`, `scripts/**`, `docs/**`, the profile and apply
modules of `src/core`, `src/app/**`.

## 3. Constraints and non-goals

- No change to what any detector reports on the development dataset: the Overall line of the
  eval stays as it is.
- Nothing from session 2, and no refactor beyond the items listed.

## 4. When to stop and ask

- The Overall line of `npm run eval` changes.
- S2 cannot be fixed in `serializeCsv` alone.
- An item cannot be reproduced in the current code. Report it as not reproduced and change no
  code for it.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck`, `npm run lint` and `npm test` exit 0. The report gives the test count
   and names the new tests.
2. `npm run eval` exits 0, T1 passes, and the Overall line reads 112 issues, 105 true
   positives, 7 false positives, 25 false negatives.
3. A test shows that a failing T1 leads to a non-zero exit code, without editing any fixture.
4. The report shows the single declaration of the near-duplicate threshold and its import in
   the eval, with file and line.
5. `git status --porcelain -- CLAUDE.md fixtures scripts docs src/app` prints nothing.
6. The report lists each item above as fixed, not reproduced or logged, with file and line.

## 6. Way of working

One gate, at the end: stop with the report. There is no plan gate, because the decisions are
made above.
