# Session 2 of 4: the AI data contract

## 1. Context and source of truth

This repository is a one-day build of an AI data cleanup assistant. `SPEC.md` version 1.2 is
the contract and rules over everything else; `DECISIONS.md` holds the reasons. Session 1 built
and committed the deterministic core (`src/core`: csv, profile, analyze with the rule
detectors, apply) and the evaluation scorer (`evals/`). An independent review of that work
was done and its fixes are committed.

Two points of SPEC 1.1 and 1.2 that shape this session: the profile and the rule detectors
never depend on the contract (§5.2), so the contract's `role` field is for display only; and
`groupIssues` separates groups by `source`, because R3 and C2 share the detector id
`placeholder`.

Another session is building the user interface in parallel on the branch `ui`. It owns
`src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` and `src/components/**`.

Verify every premise against the current code before planning.

Claims to check against the official documentation before planning, not from memory. Record
the SDK version under "Stack versions" in `DECISIONS.md`.

- Structured outputs, https://platform.claude.com/docs/en/build-with-claude/structured-outputs :
  a stable feature used through `output_config.format`; the TypeScript SDK offers
  `zodOutputFormat` in `@anthropic-ai/sdk/helpers/zod`, `client.messages.parse()` and
  `parsed_output`; some JSON Schema keywords are not supported.
- Models, https://platform.claude.com/docs/en/models/overview : the id `claude-sonnet-5-5`,
  and the thinking and effort settings it accepts with their defaults.

## 2. Scope

One piece of work: the contract path of SPEC §6.1 to §6.3 and §6.5 to §6.7, from the request
to the issues it produces, and its evaluation.

- `src/core/contract`: the Zod schema of §6.2, `buildContractRequest` (§6.1) and
  `verifyContract` (§6.3). The provisional `VerifiedContract` type becomes final.
- `src/core/analyze`: the contract-driven detectors C1, C2, C3, C4 and C6 (§5.5) and the
  precedence of §5.6.
- `src/ai`: `inferContract` and `aiStatus`, with the model call rules of §6.5 and the recorded
  mode of §6.6.
- `src/app/api/ai/status` and `src/app/api/ai/contract`, with the limits of §6.7.
- `evals/`: `eval:recorded`, `eval:live` and `eval:heldout` (§8.3). `eval:live` writes the
  recording under `fixtures/recorded/` and prints the latency and the token usage of each
  model call.
- Tests: invariant 6 under its name; invariants 3, 4, 7 and 8 again with a contract; one
  accepted and one rejected case for every row of the table in §6.3; the route's 400, 413,
  429 and 502 answers and the single retry, with a fake model client.
- After Gate 3, and only with the owner's OK: adjudication (S1, §6.4), then C5.

May change: `src/core/contract/**`, `src/core/analyze/**`, `src/core/types.ts`, `src/ai/**`,
`src/app/api/**`, `evals/**`, test files, `package.json` (the SDK and the three scripts), and
`DECISIONS.md` only by appending under "Stack versions" and "Findings".

May not change: `SPEC.md`, `CLAUDE.md`, `scripts/**`, `docs/**`, the CSV and truth files under
`fixtures/`, the csv, profile and apply modules of `src/core`, the behaviour of R1 to R8, and
the files the interface session owns.

## 3. Constraints and non-goals

- The only new dependency is `@anthropic-ai/sdk`.
- The owner's API key will be in `.env.local` from Gate 2 on. Do not run `npm run dev` or
  `npm run build` in this session, because both load that file. Route handlers are tested by
  calling them directly with a fake model client.
- You make no model call: the fake client covers the tests and the owner makes the live runs.
- The recording format is yours to define. It carries the model id, the date, the SHA-256 of
  the dataset and the contract exactly as the model returned it.
- The report states the token cap, the timeout and the thinking or effort settings of the
  call, each with its reason.
- No interface work.

## 4. When to stop and ask

- The documentation contradicts a claim above, or the schema of §6.2 cannot be expressed in
  the supported subset.
- A rule of §6.3 is ambiguous in a way that changes which rules are accepted.
- A done criterion needs a SPEC constant to change.
- You would need to read `.env.local`, anything under `fixtures/heldout/`, or a file the
  interface session owns.

## 5. Done criteria (fixed before the run)

Before the live run (Gate 2):

1. `npm run typecheck`, `npm run lint` and `npm test` exit 0. The report gives the test count
   and lists the invariant tests by name.
2. `npm run eval` exits 0, T1 passes, and the Overall line equals that of the last committed
   rules run.
3. With no recording present, `npm run eval:recorded` exits with a message saying that a live
   run is needed, not with a stack trace.
4. The report pastes the system prompt and the user prompt template in full.
5. `git status --porcelain -- SPEC.md CLAUDE.md scripts docs fixtures/heldout 'fixtures/listings.*' 'src/core/csv*' 'src/core/profile*' 'src/core/apply*' src/components src/app/page.tsx`
   prints nothing.

After the owner pastes the output of `npm run eval:live` (Gate 3):

6. `npm run eval:recorded` exits 0 and prints the same tables as that live run.
7. The report states T2 and T3 of SPEC §8.4 as measured, next to their thresholds; the
   contract rules proposed, verified and rejected, each rejected one with its reason; and the
   latency and token usage of the call.
8. Every false positive and false negative that involves a contract-driven detector is
   classified as SPEC §8.5 says. Nothing is changed in response until the owner approves the
   classification.

## 6. Way of working

- Gate 1: before writing any file, show the plan: files, tests, order, and at most five points
  of `SPEC.md` you would challenge, each with your recommendation. Stop for my OK.
- Gate 2: when criteria 1 to 5 pass, stop and say so. I create `.env.local`, run
  `npm run eval:live` and paste its full output.
- Gate 3: report against criteria 6 to 8, then the findings, then what was not done. Stop.
