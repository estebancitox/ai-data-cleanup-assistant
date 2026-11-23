# Session 1 of 3: deterministic core, rule detectors, evaluation harness

## 1. Context and source of truth

This repository is a one-day build of an AI data cleanup assistant. A user uploads a CSV; the
app identifies duplicates, inconsistent values, missing data and suspicious records, suggests
edits, and the user reviews and accepts them.

The contract was written before any code and is already in the repository:

- `SPEC.md`, version 1.0. It rules over everything else.
- `DECISIONS.md`: the reasons and the rejected options.
- `fixtures/`: `listings.dirty.csv`, `listings.clean.csv`, `listings.truth.json` and `README.md`.
- `scripts/generate-fixtures.mjs`: the fixture generator.

There is no application code yet. Verify every premise against the current code before planning.

Check library facts (create-next-app options, Tailwind setup, Papa Parse, Vitest) against
their current official documentation, not from memory, and record the installed versions
under "Stack versions" in `DECISIONS.md`.

## 2. Scope

One piece of work: the part of the app that runs without AI and without a user interface.

- Scaffold the project (SPEC §4.5) without overwriting the files already in the repository.
- `src/core/types.ts`, `src/core/csv`, `src/core/profile`, `src/core/analyze` and
  `src/core/apply`, as defined in SPEC §4.2 to §4.4, §5.1 to §5.4, §5.6 and §5.7, with the
  rule detectors R1, R2, R3, R4, R5 and R8.
- `analyze(dataset, contract?)` keeps the signature of SPEC §4.3. In this session it is only
  called without a contract. Declare the `Contract` and `VerifiedContract` types of SPEC §6.2
  and §6.3 so the signature compiles.
- `evals/`: the scorer of SPEC §8.2 and `npm run eval` (rules only, development dataset),
  writing its report as SPEC §8.3 says.
- Tests: the invariants of SPEC §4.4 that apply without a contract (1, 2, 3, 4, 5, 7 and 8),
  each under the name given there, and tests for each detector.
- After every done criterion below is met, and only then: detectors R6 and R7.

May change: `package.json` and the configuration files the scaffold creates, `src/core/**`,
`evals/**`, test files, and `DECISIONS.md` only by appending under "Stack versions" and
"Findings".

May not change: `SPEC.md`, `CLAUDE.md`, `fixtures/**`, `scripts/**`, `docs/**`.

## 3. Constraints and non-goals

- Not in this session: `src/ai`, API routes, the contract request, contract verification,
  detectors C1 to C6, adjudication, and any interface work beyond leaving the scaffold's
  default page in place.
- Dependencies: next, react, typescript, tailwindcss, papaparse, zod, vitest, tsx, their type
  packages, and whatever the scaffold itself installs. Nothing else.
- `src/core` uses no clock and no randomness: the caller passes `generatedAt` for the change log.
- Tests assert behaviour on small inline datasets. Only the eval reads `fixtures/`.

## 4. When to stop and ask

- The scaffold tool refuses to run in a non-empty directory or would overwrite an existing file.
- `SPEC.md` is ambiguous or contradicts itself in a way that changes an interface of §4.3, an
  invariant of §4.4 or a constant of §5.
- A done criterion cannot be met without changing a SPEC constant.
- T1 fails and the cause looks like the fixture or the SPEC, not the code.
- R2 finds fewer than 14 of the 14 planted duplicate pairs.
- You need a dependency that is not listed.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck` exits 0, with TypeScript strict mode on.
2. `npm run lint` exits 0.
3. `npm test` exits 0. The report gives the number of tests and lists the seven invariant
   tests by name.
4. `npm run eval` exits 0, prints the table of SPEC §8.2 and writes a file under `evals/runs/`.
   The report pastes the table as printed.
5. T1 of SPEC §8.4 holds in that run: recall 1.00 for `exact-duplicate` (6 of 6), `blank` and
   `blank-derivable` (20 of 20), `case-whitespace` (18 of 18) and `number-format` (8 of 8),
   and no false positive from R1, R3 `empty`, R4 or R5.
6. The report states the R2 result on the development dataset next to the reference of SPEC
   §8.4 (14 of 14 planted pairs and the 4 trap pairs at 0.90) and explains any difference.
7. `git status --porcelain -- SPEC.md CLAUDE.md fixtures scripts docs` prints nothing.
8. `grep -rn "fixtures" src/core` prints nothing.
9. The report lists every finding appended to `DECISIONS.md` and anything in scope that was
   not done.

## 6. Way of working

- Gate 1: before writing any file, show the plan: the files to create, the tests you will
  write, the order, and at most five points of `SPEC.md` you would challenge, each with your
  recommendation. Stop for my OK.
- Gate 2: when the done criteria are met, or when you are blocked, stop and report against the
  nine criteria, one line each with its evidence, then the findings, then what was not done.
- R6 and R7 start only after criteria 1 to 9 pass. Run the criteria again afterwards and
  report both runs.
