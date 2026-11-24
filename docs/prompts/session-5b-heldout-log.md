# Session 5b: log the held-out run and the third review (documents only)

## 1. Context and source of truth
Repository ~/ai-data-cleanup-assistant, branch main. The held-out dataset was scored once at the commit tagged `freeze`; the run is evals/runs/20261124T002953Z-heldout-contacts.json. A review of 6d8bf55..HEAD returned FIX with one MUST FIX and two notes. The owner records them as open for now and changes no code. Verify what follows against the run file and the code before writing.

## 2. Scope
Only DECISIONS.md changes.
A. A section "Held-out run" with the Overall line (99 86 11 2 13 0.887 0.869), the T2 and T3 lines as printed (precision and fixes on clean data fail, the rest pass; the held-out is report-only), and one classification per failure group under SPEC §8.5. The owner's proposed classification, to confirm or correct with evidence from the run file and fixtures/heldout (you may read the held-out files now):
- near-duplicate 0 of 6 (E013, E014, E024, E026, E048, E087): rule definition. R2 reports pairs at 0.90 or more; these pairs score 0.8203 to 0.8386, and the highest pair that is neither planted nor a trap scores 0.8015.
- the 11 false positives: all on rows 34, 35, 66, 131, 146 and 277, one row of each missed pair. 7 flagged-value issues and 4 canonical-value fixes on names. Prompt and rule definition: the contract prompt allows canonical groups and suspicious values on name and note columns.
- invalid-format 4 of 6 missed (E004, E012, E060, E092): cut feature (C5).
- outlier-typo 2 of 5 missed (E047, E073) and impossible-value 1 of 4 missed (E006): say which detector should have caught each and why it did not. If you cannot tell from the files, say so.
Nothing in code, prompts, thresholds or fixtures changes because of this run.
B. Findings for the third review, each marked open: a MUST FIX (d), a decision clicked while a snapshot is being computed is lost (Assistant.tsx:58-59); the bar can say decisions changed after a download when they did not (carry.ts:39, Review.tsx:141); the doubt notice disappears after "Run live" while the fix is still accepted (decisions.ts:43). Add the reviewer's unverified points about the SDK (the client-less defaultLogger and the OpenTelemetry settings read from the environment) as one more open finding.

## 3. Constraints and non-goals
No change outside DECISIONS.md. Do not run eval:live or eval:heldout. Do not read .env files. Do not commit.

## 4. When to stop and ask
A classification above is contradicted by the files: write what the files show and flag it in the report.

## 5. Done criteria (fixed before the run)
`git status --short` shows DECISIONS.md as the only file you changed. The report quotes the new section and, for E006, E047 and E073, the cell values and the reason each was missed.

## 6. Way of working
No plan gate. One report.
