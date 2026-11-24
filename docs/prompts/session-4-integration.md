# Session 4 of 4: integration

## 1. Context and source of truth

This repository is a one-day build of an AI data cleanup assistant. `SPEC.md` rules over
everything else and `DECISIONS.md` holds the reasons. On `main`, session 1 built the core and
the scorer and session 2 built the AI contract path: `src/core/contract`, the contract-driven
detectors, `src/ai`, the routes under `src/app/api/ai`, the recording of the sample and the
recorded, live and held-out evaluations. On the branch `ui`, session 3 built the page for the
path without AI. Its only connection point is `runAnalysis` in `src/lib/analysis.ts`, a
generator of snapshots.

`SPEC.md` is at version 1.2. Part 1 of this session takes it to 1.3 with decisions the owner
has already made. From the end of Part 1 the SPEC is frozen.

The owner has moved `.env.local` out of the repository for this session. There is no API key,
the server reports that it is not live, and you make no model call. The recorded analysis of
the sample is the AI path you can exercise; the owner checks live mode by hand afterwards.

Verify every premise against the current code before planning. In particular: whether
adjudication exists (session 2 built S1 only if time allowed; look for `src/core/adjudicate`
and an adjudicate route), and the exact names of the seam, the routes and the recording format.

## 2. Scope

One piece of work: one application on `main`, with the page using the AI layer.

Part 0, merge. Run `git merge --no-commit --no-ff ui` and resolve the conflicts in the working
tree. For `package.json` keep both sides, then rebuild `package-lock.json` with `npm install`.

Part 1, `SPEC.md` 1.3, with a "Changes in 1.3" list, one line per change:

- §2: S6 becomes CUT. It needs a fifth input to `applyDecisions` and an exception to invariant 8.
- §4.2 and §4.3: `src/core/analyze` exports the near-duplicate threshold for the eval;
  `src/core/csv` exports the upload limits; the contract module exports what the code exports;
  the routes table gains the recording route as built.
- §4.4, invariant 5, and §5.1: the round trip holds for every dataset `parseCsv` can return. A
  single-column file cannot hold an empty cell, because an empty line and an empty cell cannot
  be told apart there, so that row is skipped.
- §5.4, R5: inner spaces and tabs are removed; a line break inside a cell never is.
- §6.1, §6.3, §6.6 and §8.3: the readings approved at Gate 1 of session 2, as logged in the
  findings of `DECISIONS.md`.
- §7: a flag-only issue has "Confirm" (stored as accepted, changes no cell) and "Dismiss"
  (stored as rejected); bulk buttons act on the pending issues the filters show and carry the
  number; there is no export screen, and the bar warns when the two downloads were built from
  different decisions; a file that is not UTF-8 is refused with a message that says how to fix it.

Part 2, small core changes that 1.3 describes, each with a test:

- `src/core/csv` exports the limits and the page imports them; the page's own copy goes.
- R5 no longer joins a number that is split by a line break.
- The `csv round trip` test pins the single-column behaviour described above.

Part 3, the page uses the AI layer, through the seam:

- The first snapshot is the rule-based analysis, as today.
- Mode is decided as SPEC §6.6 says: the recording for the file's SHA-256 if there is one; a
  live contract if the server is live; otherwise off, with a notice that says how to enable AI.
  The sample offers "Run live" when the server is live.
- A contract, recorded or live, goes through `verifyContract` and `analyze` in the browser and
  arrives as a later snapshot. Decisions already made are kept.
- A failed call (network, 413, 429, 502) leaves the rule-based result on screen with a notice
  and a retry control.
- The page shows the mode at all times, with the model and the date for a recording; progress
  by stage (§7.2); and the "AI rules" panel (§7.3) with the verified rules, the numbers that
  support them, and the rejected rules with their reasons.
- If adjudication exists: cases and verdicts as SPEC §6.4 says, the model's sentence on the
  issue, and the collapsed "Dismissed by AI" section, left out of bulk actions and counts and
  restorable by the user. If it does not exist, nothing about verdicts is built.

Part 4, one measurement: the time of the rule-based analysis on a generated file of 50,000
rows (SPEC §9.2). Report the number. If it is over 15 seconds, log a finding; do not optimise.

Also: append to `DECISIONS.md` the findings of session 3, which were only in its report: group
titles live in the page because `IssueGroup` has none; the upload limits (resolved here); S6;
the byte-order mark is not kept on export; who decodes the bytes; keyboard focus after a
filter hides a row. Add the byte-order mark to the cut list of §8.

After Gate 2 and my OK: S3 (the "What is sent to the AI" panel), then what a serverless
deployment needs (the recordings inside the bundle, a duration limit for the AI routes).

May change: `SPEC.md` (Part 1 only), `DECISIONS.md` (append only, plus the cut list),
`src/lib/**`, `src/components/**`, `src/app/page.tsx`, `src/app/layout.tsx`,
`src/app/globals.css`, `src/core/csv/**`, the profile module of `src/core`, test files,
`next.config.ts`, `vitest.config.mts`, `package.json` and `package-lock.json`.

May not change: `CLAUDE.md`, `fixtures/**` (recordings included), `scripts/**`, `docs/**`,
`evals/**`, `src/ai/**`, `src/app/api/**`, `src/core/contract/**`, `src/core/analyze/**`,
`src/core/apply/**`.

## 3. Constraints and non-goals

- Nothing that changes what is sent to the model or what a detector reports: the recording and
  the committed eval numbers depend on both.
- No new dependency.
- No README, no deployment, no commit. Do not conclude the merge: the owner commits it.
- Time: if Gate 2 is not reachable by 18:15 local time, stop at that time and report what is
  done and what is left.

## 4. When to stop and ask

- A merge conflict outside `package.json`, `package-lock.json` and configuration files.
- The page needs a change in a file this session may not change.
- An eval Overall line changes.
- A decision of Part 1 contradicts the code as built.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` exit 0. The report gives
   the test count.
2. `npm run eval` and `npm run eval:recorded` exit 0 and each prints the same Overall line as
   its last committed run.
3. A test named `sample without a key shows the recorded analysis` passes: with the server not
   live and the real recording served, the page ends in recorded mode with exactly the issues
   that `analyze(dataset, verifyContract(contract, dataset))` returns.
4. A test named `a failed contract call keeps the rule-based result` passes: after a 502 the
   rule-based issues are still shown, with the notice and the retry control.
5. A test named `decisions survive the contract` passes: a decision made on the first snapshot
   is still set after the contract snapshot arrives.
6. A test named `off mode makes no AI request` passes: with no recording and the server not
   live, no request is sent to the contract or adjudicate routes.
7. A browser run of the sample with no key: recorded mode with its model and date, the "AI
   rules" panel showing verified and rejected rules, no console error, and no POST request.
   The report lists the requests made.
8. The report gives the 50,000-row timing and how it was measured.
9. `git status --porcelain -- CLAUDE.md fixtures scripts docs evals src/ai src/app/api src/core/contract src/core/analyze src/core/apply`
   prints nothing.
10. The report lists each SPEC change with its section, and ends with a checklist of at most
    eight steps for the owner to do by hand once the key is back: an uploaded file analysed
    live, "Run live" on the sample, a forced failure, and both downloads.

## 6. Way of working

- Gate 1: after Part 0, with the merged tree passing criterion 1, stop and show which files
  conflicted and how each was resolved, then the plan for Parts 1 to 4 and at most five points
  you would challenge, each with your recommendation. I commit the merge and answer.
- Gate 2: report against the ten criteria, one line each with its evidence, then the findings,
  then what was not done. Stop.
