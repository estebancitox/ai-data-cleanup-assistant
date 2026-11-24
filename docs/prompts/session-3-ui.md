# Session 3 of 4: the review interface (path without AI)

## 1. Context and source of truth

This is the branch `ui`, in its own worktree, of a one-day build of an AI data cleanup
assistant. `SPEC.md` version 1.1 is the contract; §7 and §9.1 define this session's work.
Session 1 built and committed the core in `src/core` (`parseCsv`, `analyze`, `groupIssues`,
`applyDecisions`, `serializeCsv`), with its types in `src/core/types.ts`.

Another session is building the AI layer in parallel on `main`. It owns `src/core/**`,
`src/ai/**`, `src/app/api/**` and `evals/**`. A later session connects the two.

Verify every premise against the current code before planning.

## 2. Scope

One piece of work: the page of SPEC §7 for the path that needs no AI: upload, rule-based
analysis, review and export.

- Upload (§7.1): file picker, drag and drop and "Use sample data"; the limits, parse errors
  and warnings in plain language. The sample is `fixtures/listings.dirty.csv`, served
  byte-identical from that single source, with no hand-made copy in the repository.
- Review (§7.3) without the "AI rules" panel: summary cards, filters, groups, issue rows with
  the before and after, duplicates side by side, flag-only issues, accept and reject per issue
  and per group, and the persistent bar.
- Export (§7.4): the cleaned CSV and the change log, from `applyDecisions` and `serializeCsv`.
- The analysis comes from one function in the page layer that today returns
  `analyze(dataset)`. The AI mode reads "AI off". That function is the only place the later
  session will change.
- Tests for the page logic (the decisions state and the export) and for the requirements of
  §9.1 that can be checked by role and name.
- After Gate 2 and my OK: S2 (accept all high-confidence fixes), then S6.

May change: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`,
`src/components/**`, files for page logic under `src/app/` or `src/lib/`, their tests, and
`package.json` and the build configuration as far as the sample file and the test libraries
need.

May not change: `SPEC.md`, `CLAUDE.md`, `DECISIONS.md`, `fixtures/**`,
`scripts/generate-fixtures.mjs`, `docs/**`, `src/core/**`, `src/ai/**`, `src/app/api/**`,
`evals/**`.

## 3. Constraints and non-goals

- No request to `/api`, no "AI rules" panel, no progress for AI stages, no recorded mode.
- No state library, component library, animation library or icon set. New dependencies, for
  tests only: `@testing-library/react`, `@testing-library/user-event` and `jsdom`.
- Visual direction, the owner's: restraint executed with precision. Light theme only. Neutral
  greys and one accent, `#b03d00`, used for actions and for the changed part of a value. IBM
  Plex Mono for cell values and numbers, a system sans-serif for the rest. No gradients, no
  decorative shadows, and no motion beyond focus and state changes.
- Decisions live in the page's state as the `Decisions` type of SPEC §4.3. Issues are never
  copied into another shape or mutated.
- A finding about `src/core` or the SPEC goes in the report, not in a file: `DECISIONS.md` is
  being edited on the other branch.

## 4. When to stop and ask

- The page needs something `src/core` does not export, or a core function behaves differently
  from SPEC §4.3.
- Serving the sample from its single source needs a change outside the files this session may
  change.
- A requirement of §7 cannot be met without AI data.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` exit 0. The report
   gives the test count.
2. A test named `export equals applyDecisions` passes: on the sample, after accepting every
   issue of one group and rejecting one issue, the downloaded CSV and change log equal
   `serializeCsv(cleaned)` and the `changeLog` that `applyDecisions` returns for the same
   decisions.
3. A test named `decisions do not touch the analysis` passes: accepting and rejecting leaves
   the `Analysis` object deeply equal to a copy taken before.
4. A test named `controls have roles and names` passes: every accept, reject, filter and
   export control is found by its role and accessible name.
5. `shasum -a 256 fixtures/listings.dirty.csv` and the SHA-256 of the file the page loads for
   "Use sample data" are equal. The report shows both.
6. `git status --porcelain -- SPEC.md CLAUDE.md DECISIONS.md fixtures scripts/generate-fixtures.mjs docs src/core src/ai src/app/api evals`
   prints nothing.
7. The report ends with a checklist of at most eight steps for the owner to do by hand in the
   browser: upload, drag and drop, the sample, a parse error, accepting a group, rejecting one
   issue, accepting with the keyboard only, and both downloads.

## 6. Way of working

- Gate 1: before writing any file, show the plan: the list of components with one line each,
  the shape of the state, the tests, how the sample is served, and at most five points of SPEC
  §7 you would challenge, each with your recommendation. Stop for my OK.
- Gate 2: when criteria 1 to 7 pass, stop and report against them, one line each with its
  evidence, then the findings, then what was not done.
