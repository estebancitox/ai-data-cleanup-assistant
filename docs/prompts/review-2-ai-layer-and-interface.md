# Review: AI layer, interface and integration (range e88fb79..HEAD)

Run with `claude --agent diff-reviewer` at commit 6d8bf55. Result: FIX BEFORE FREEZE, 1 MUST FIX and 7 notes.

## 1. Context and source of truth
Repository: ~/ai-data-cleanup-assistant, branch main. A one-day take-home: a browser tool that finds problems in a CSV, proposes fixes, lets the user accept or reject each one, and exports a cleaned CSV plus a change log.
The contract is SPEC.md at HEAD (version 1.3). Reasons and findings are in DECISIONS.md. Where code and SPEC disagree, SPEC rules and the disagreement is a finding.
The core up to commit e88fb79 was already reviewed. This review covers everything after it.
You get no summary of the change on purpose. Verify every premise against the current code before judging.

## 2. Scope
Read the real diff of the range: `git diff e88fb79..HEAD -- src`. Read the contract with `git show HEAD:SPEC.md`.
Areas, highest risk first:
1. Secrets and privacy: src/ai and src/app/api/ai. The API key, request payloads and file content must not reach a log, an error response or the client bundle.
2. The invariants of SPEC §4.4, in src/core/contract, src/core/adjudicate, src/core/analyze and src/core/apply. In particular: a fix never invents a value, a verdict never creates or changes a fix, the original dataset is never mutated.
3. Exports: the cleaned CSV and the change log must match the accepted decisions exactly.
4. Review state in src/lib and src/components: decisions made before the AI contract arrives must survive it; bulk accept and undo must not touch issues the user did not select.
5. Failure paths: a failed or slow AI call must leave the rule-based result usable and the page not stuck.
Out of scope: package-lock.json, fixtures/, evals/runs/, docs/, styling, naming, test style.

## 3. Constraints and non-goals
Do not edit, create, delete or commit files. Do not run code. Do not open .env files or anything under fixtures/heldout/. No refactor proposals and no praise: only discrepancies you can show.

## 4. When to stop and ask
- The range e88fb79..HEAD does not exist, or HEAD is not the integration commit: stop and say so.
- A file you need cannot be read: list it under "Not verified" and continue.

## 5. Done criteria (fixed before the run)
Severity:
- MUST FIX: (a) the API key or file content can reach a log, a response or the client bundle; (b) a SPEC §4.4 invariant can be broken; (c) the cleaned CSV or the change log can be wrong for the accepted decisions; (d) a decision can be lost, or a change applied that the user did not accept; (e) a failed AI call can lose the rule-based result or leave the page stuck.
- NOTE: anything else.
Each finding has: file:line, the exact line quoted, a concrete input or sequence of actions that triggers it, and the smallest fix in one sentence. A finding you cannot trigger on paper goes under "Not verified".
At most 8 findings, MUST FIX first. "None found" is an acceptable result.
Verdict on the first line: FIX BEFORE FREEZE if there is at least one MUST FIX, otherwise OK TO FREEZE.

## 6. Way of working
One report, no intermediate questions. Format: verdict; findings table (severity, file:line, quoted line, trigger, fix); Not verified; one paragraph on what you did not read.
