# Session 5: review fixes before the freeze

## 1. Context and source of truth
Repository: ~/ai-data-cleanup-assistant, branch main, HEAD 6d8bf55 ("Session 4: integration, SPEC 1.3"). SPEC.md rules; DECISIONS.md holds reasons and findings.
An independent review of e88fb79..6d8bf55 returned FIX BEFORE FREEZE with one MUST FIX and seven notes. A hand check of live mode by the owner added two more. This session fixes the ones listed in Scope and logs the rest. After it the code is frozen and the held-out dataset is scored once.
The findings are claims. Verify every premise against the current code before planning.

MUST FIX, as the reviewer wrote it:
src/components/Assistant.tsx:50 `setPhase({ name: "review", file, snapshot });`. Decide a rule issue while the live contract request is pending. The contract then takes that cell and the decision disappears without a message. Example: nursery() row 38 has genus `n/a`. The user accepts or rejects R3's fix `placeholder:38:genus:set-…`. The contract brings species -> genus and C3 takes the cell as `dependency:38:genus:set-…` (pinned by invariants.contract.test.ts:32). If the user accepted, the count drops by one, the export keeps `n/a` and the change log has no entry. If the user rejected, the cell returns as a pending high-confidence fix and "Accept all high-confidence fixes" writes `Quercus` into a cell the user chose to leave. "Run live" does the same to an accepted AI fix that the new contract does not propose. The test "decisions survive the contract" picks a group whose ids all survive (Assistant.ai.test.tsx:221).

## 2. Scope
Part A, required. Decisions are never lost (reviewer finding 1).
The rule, approved by the owner: an issue the user has decided is never removed or replaced by a later snapshot. When a snapshot arrives without a decided issue that is on screen, that issue is carried into the new analysis with its decision, and the issue of the new snapshot that took its place (same target, not on screen before) is left out. If the user undoes the decision, the next snapshot is free to replace the issue.
This applies to every snapshot: the contract, each batch of AI opinions, Retry and "Run live".
Build it as a pure function in src/lib with unit tests, and call it where a snapshot replaces the one on screen.

Part B, required, small.
B1 (finding 8). Create the Anthropic client with logging off, so that an environment variable such as ANTHROPIC_LOG=debug cannot put request bodies in the server log. The reviewer suggests `logLevel: 'off'`; check the option against the installed SDK's types.
B2 (finding 2). src/components/Review.tsx:82 `const ids = new Set(setAsideKey.split("\n"));` breaks an issue id that contains a line break (a quoted header with a line break inside). Build the set from the ids themselves.
B3 (finding 7). The preview of the request (S3) was never built. Mark S3 CUT in SPEC §2, and correct §4.3 and the code comment that says the UI shows the object to the user before sending it (find it with `git grep -n "shows this object to the user"`). On the upload screen, add one sentence that says what leaves the browser: when the server has an API key, a description of the columns, up to 20 sample rows and the full rows of the ambiguous cases go to the model; without a key, only the file's SHA-256 is sent to this server.
B4 (hand check). The "AI rules" panel lists a format rule ("agent_email: email") under "Verified rules", and its text says code checked each rule, but format rules are not checked or used (C5 is CUT). Show format rules under their own heading that says they are listed and not checked or used in this version, and count them as "not checked" wherever the page counts verified rules (the panel summary and the progress line).

Part C, optional, in this order, only if Parts A and B pass all their criteria before 19:40 local time.
C1 (hand check). When the AI judges "probably not a problem" an issue the user has already accepted, nothing announces it; the opinion shows only inside the row. Add a notice near the review bar that says how many accepted fixes the AI doubts and names their groups, and that goes away when none is left accepted. It changes no decision.
C2 (finding 3). After "Run live" fails, the header reads "AI live" while the recorded analysis is on screen. Keep the recorded mode, model and date until a live contract arrives.
C3 (finding 6). src/lib/analysis.ts:171: check for cancellation before each round of adjudication requests, so "Start over" stops later rounds.
C4. The rejected rule reads `listing_id -> address`; verified ones read "agent_name decides agent_email". Use the same wording.

Part D, required. SPEC 1.4 and DECISIONS.md.
- SPEC: §7 states the rule of Part A; S3 CUT (B3); the format-rule label (B4); whatever Part C changed.
- DECISIONS.md: one finding per reviewer finding and per hand-check item, with what was done. Logged and not fixed in this session: finding 4 (C1 and C3 count spellings before R4's tidying, so a fix can write a trailing space; a SPEC finding), finding 5 (no client timeout on fetch), the 404 that the recording lookup shows in the console for a file with no recording, the reviewer's two unverified points (Assistant.tsx:53 swallowing an exception; the second analyze pass on a 50,000-row file when the contract arrives), and any Part C item not done.

Files you may change: src/components/**, src/lib/**, the client options in src/ai/call.ts, the one comment of B3, SPEC.md, DECISIONS.md.
Files you may not change: everything else under src/core, src/ai and src/app/api; evals/**; fixtures/**; package.json; package-lock.json.

## 3. Constraints and non-goals
- No change to detectors, prompts, schemas, thresholds or the scorer: the held-out run comes right after this session.
- No new dependency.
- Do not read .env files or anything under fixtures/heldout/. Do not run `npm run eval:live`, `npm run eval:heldout` or any deploy command.
- No refactor beyond what a fix needs. Findings 4 and 5 are not fixed here.
- Write any non-ASCII white space in source as an escape.
- Do not commit. The owner commits.

## 4. When to stop and ask
- Part A seems to need a change under src/core.
- The rule of Part A gives a result you think is wrong for row removals, for flags or for "Run live". Say what happens and propose the alternative in the plan.
- A criterion test cannot be written with the existing fixtures.
- An evaluation Overall line changes.
- The SDK has no option that turns logging off.
- 20:00 local time: stop and report what is done, even if B4 or Part C is open.

## 5. Done criteria (fixed before the run)
1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` exit 0. Show the test count (272 before this session).
2. `npm run eval -- --no-write` and `npm run eval:recorded -- --no-write` exit 0 and print the same Overall lines as before: rules `112 105 7 0 25 0.938 0.808`, recorded `137 130 0 7 0 1.000 1.000`.
3. A test named `an accepted fix survives a contract that takes its cell` follows the nursery row 38 sequence: after the contract, the accepted count is unchanged, the cleaned CSV holds the accepted value in that cell, the change log has the entry, and no pending fix exists for that cell.
4. A test named `a rejected cell stays as it is after the contract`: after the contract and "Accept all high-confidence fixes", the cleaned CSV still holds `n/a` in that cell.
5. A test named `Run live keeps decisions already made`: an AI fix accepted on the recorded analysis is still accepted and applied after a live contract that does not propose it.
6. Unit tests of the pure function cover: the same id in both snapshots, an id replaced on the same target, undo before the next snapshot, and two snapshots in a row that both lack the carried issue.
7. A test named `a dismissed issue under a header with a line break is listed once` (B2).
8. B1: quote the line that creates the client, and show with `git grep` that no other place creates one.
9. A test named `the upload screen says what is sent` (B3), with the SPEC and comment changes quoted.
10. A test named `format rules are not counted as verified` (B4).
11. `git diff --stat 6d8bf55 -- src/core src/ai src/app/api evals fixtures package.json package-lock.json` lists only src/ai/call.ts and the file of the B3 comment.
12. SPEC version is 1.4 and DECISIONS.md lists the findings of Part D. For each Part C item: done with its test, or logged as not done.

## 6. Way of working
Gate 1: a plan of at most 30 lines. For Part A: where the function lives, its signature, how it identifies the issue that "took the place" of a carried one for a cell fix, a row removal and a flag, and what happens on "Run live". For Part B: one line each. Anything in the criteria you think is wrong. Then stop and wait for the owner's OK.
Gate 2: one report against the twelve criteria with the evidence each one asks for, the SPEC changes by section, the findings added, and what was not done.

---

## Owner's answer at Gate 1

Plan approved, with these answers.

Point 9 (Run live): keep the decided issue as you propose, and log it as a finding and in the cut list. No "Kept from the earlier analysis" line in this session.

Point 14 (B4): you are right and my premise was wrong: format rules are checked, only not used. So B4 gets smaller:
- Keep every count as it is. A format rule that passed the check is a verified rule.
- Only the label changes: the Formats heading says they are checked against the file and not used to find issues in this version. Make sure the panel's intro sentence stays true for them.
- Criterion 10 becomes a test named `format rules are labelled as not used`.
- In DECISIONS.md, record that the hand-check note said "not checked" and that verify.ts:74-84 shows otherwise.

Points 6, 7, 8 and 15: approved as written. Log point 8 (a decided flag keeps out a later fix for that cell) as a finding.

Point 10 (B1): `logLevel: 'off'` approved, including the loss of the SDK's own warnings. No test; criterion 8 stands as written.

Point 16: agreed. The 20:00 stop stands. With B4 smaller, start C1 only if Parts A, B and D pass before 19:40; otherwise log Part C as not done.

Go ahead. Do not commit; I commit after Gate 2.
