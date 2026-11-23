# ai-data-cleanup-assistant

One-day build. `SPEC.md` is the contract and is frozen inside a session. `DECISIONS.md` holds
the reasons. `fixtures/*.truth.json` is the ground truth for the evaluation.

## Commands

- `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint`
- `npm run eval` (rules only) · `npm run eval:recorded` (rules and recorded AI responses)

## Rules for this repository

- `src/core` is plain TypeScript: no React, Next.js, DOM, `fs` or network imports.
- No literal value from `fixtures/` appears in `src/`. Detectors and prompts are domain-agnostic.
- Do not open anything under `fixtures/heldout/`. It is scored once, by the owner.
- Do not read `.env*` files. Do not run `npm run eval:live`, `npm run eval:heldout` or any
  deploy command: the owner runs them and pastes the output.
- Every constant and threshold comes from `SPEC.md`. Do not tune one to change an eval number.
- A problem in `SPEC.md` or in a fixture is a finding: append it under "Findings" in
  `DECISIONS.md` and stop if it blocks the task. Do not patch around it.
- Do not commit. The owner commits after an independent review.
