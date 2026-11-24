# Review 4: the restyle of session 6 (staged changes on the branch `design`)

Run with `claude --agent diff-reviewer` on the staged changes of session 6, before the merge.
Result: FIX, three sentences on screen that could be false and one note. The session fixed the
four points and the reviewer read the fixes again before the merge.

## 1. Context and source of truth
Folder: ~/ai-data-cleanup-assistant-design, branch `design`, HEAD at `main`. The changes of session 6 are staged and not committed. `SPEC.md` in the working tree (version 1.5) is the contract; §7 and §9.1 rule the interface. `DECISIONS.md` holds the findings; F79 describes this session.
The code was frozen at the tag `freeze` and a held-out dataset was scored once on it. Session 6 claims to have changed presentation only: tokens, typefaces and markup in `src/app` and `src/components`, with the same data, behaviour, decisions and exports. F75 to F78 are open on purpose and are not part of this review.
Claims of the session, to verify and not to trust: no hunk of `Assistant.tsx` falls inside old lines 21 to 78 and none of `Review.tsx` inside old lines 70 to 142; no test was deleted and no assertion weakened; the bar states only the accepted, rejected and pending counts and the number of removed rows; the context cell shows only on issues of the dependency detector.
Verify every premise against the current code before judging.

## 2. Scope
Read the real diff: `git diff --cached HEAD -- src`, then `git diff --cached -U0 HEAD -- src/components/Assistant.tsx src/components/Review.tsx`, then `git diff --cached HEAD -- SPEC.md DECISIONS.md`.
In order:
1. Logic. Did any state, effect, handler, condition or prop that decides behaviour change, move or disappear, in the two mixed files or in any other component? A changed line outside the two ranges that is not markup or styling is a finding.
2. Truth on screen. For every state of a fix, a flag and a duplicate pair (pending, accepted, rejected, confirmed, dismissed, set aside by AI): can the strip show a word, a fill or a struck value that disagrees with the stored decision, or mark the wrong row as kept or removed? Is the sentence of the bar true in every state, including after an undo and with removed rows? Does the context cell ever show for an issue the dependency rule did not produce, or with a value from another row?
3. Reachability. Does every control keep its accessible name and stay reachable by keyboard? The fixed names: "Accept", "Reject", "Confirm", "Dismiss", "Restore", "Undo", "Run live", "Accept all high-confidence fixes", "Download cleaned CSV", "Download change log", "Use sample data", "Start over", "AI rules", "Dismissed by AI".
4. Tests. Compare each changed assertion with the one it replaced: is the new one at least as strict?
5. The mode line no longer calls `modeLine` of `src/lib/describe.ts`: does the component show the same three facts, with the same date and time zone?
Out of scope: taste, naming, F75 to F78, and everything under `src/core`, `src/ai`, `src/app/api`, `src/lib`, `evals`, `fixtures` and `docs`.

## 3. Constraints and non-goals
Do not edit, create, delete, stage or commit files. Do not run the app, the tests or any script; git commands that only read are fine. Do not open .env files. Only discrepancies you can show.

## 4. When to stop and ask
- Nothing is staged: stop and say so.
- `git diff --cached --stat freeze -- src/core src/ai src/app/api src/lib fixtures scripts package.json package-lock.json` prints anything: report it as the first finding and continue.
- A file you need cannot be read: list it under "Not verified" and continue.

## 5. Done criteria (fixed before the run)
MUST FIX: (a) a decision can be shown, counted, applied or exported differently than before the restyle; (b) a statement on screen can be false; (c) a control lost its accessible name or cannot be reached by keyboard; (d) logic changed inside the two ranges, or a frozen path changed; (e) an assertion was weakened or a test deleted. NOTE: anything else.
Each finding: file:line, the exact line quoted, a concrete sequence that triggers it, the smallest fix in one sentence. What you cannot trigger on paper goes under "Not verified". At most 5 findings. "None found" is an acceptable result.
Verdict on the first line: FIX if there is at least one MUST FIX, otherwise OK.

## 6. Way of working
One report, no questions. Format: verdict; findings table; Not verified; what you did not read.
