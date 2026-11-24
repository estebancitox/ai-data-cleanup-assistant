# Review: fixes after the first review (range 6d8bf55..HEAD)

Run with `claude --agent diff-reviewer` at the commit tagged `freeze`. Result: FIX, 1 MUST FIX and 2 notes, recorded as open.

## 1. Context and source of truth
Repository: ~/ai-data-cleanup-assistant, branch main. SPEC.md at HEAD (version 1.4) is the contract; DECISIONS.md holds findings F53 to F69.
A first review of e88fb79..6d8bf55 found one MUST FIX: a decision made before a later snapshot could be lost when another issue took its cell. This range claims to fix it and seven smaller points. You get no summary of how. Verify every premise against the code.

## 2. Scope
Read `git diff 6d8bf55..HEAD -- src`. Read SPEC §7.3 with `git show HEAD:SPEC.md`.
In order:
1. src/lib/carry.ts and the place that calls it: can a decision still be lost, duplicated, or applied to a different change than the one the user saw? Can the merged analysis hold two fixes for one cell, or a fix for a row that an accepted removal deletes, in a way that makes the cleaned CSV or the change log wrong?
2. The notice about accepted fixes the AI doubts, the header after a failed "Run live", and the cancellation of later adjudication rounds: any state where the page says something false, or a decision changes without the user.
3. src/ai/call.ts and src/core/contract/request.ts: confirm these are the only changes outside src/components and src/lib, and that they change no request, prompt or schema.
Out of scope: everything before 6d8bf55, fixtures/, evals/, docs/, styling, naming.

## 3. Constraints and non-goals
Do not edit, create, delete or commit files. Do not run code. Do not open .env files or anything under fixtures/heldout/. Only discrepancies you can show.

## 4. When to stop and ask
- The range does not exist: stop and say so.
- A file you need cannot be read: list it under "Not verified" and continue.

## 5. Done criteria (fixed before the run)
MUST FIX: (a) the API key or file content can reach a log, a response or the client bundle; (b) a SPEC §4.4 invariant can be broken; (c) the cleaned CSV or the change log can be wrong for the accepted decisions; (d) a decision can be lost, or a change applied that the user did not accept; (e) a failed AI call can lose the rule-based result or leave the page stuck. NOTE: anything else.
Each finding: file:line, the exact line quoted, a concrete sequence that triggers it, the smallest fix in one sentence. What you cannot trigger on paper goes under "Not verified". At most 5 findings.
Verdict on the first line: FIX if there is at least one MUST FIX, otherwise OK. "None found" is an acceptable result.

## 6. Way of working
One report, no questions. Format: verdict; findings table; Not verified; what you did not read.
