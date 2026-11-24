# Session 6: one visual identity for the review interface (presentation only)

## 1. Context and source of truth

Folder: ~/ai-data-cleanup-assistant-design, a git worktree of the repository on the new branch
`design`, created from `main`. The app is a one-day build that answers this brief, verbatim:

"Project 4. AI data cleanup assistant
Create an application that you can upload a csv into. With the csv, the application should
use AI to read through the data and identify duplicates, inconsistent values, missing
data, or suspicious records. Then the application should suggest edits, and allow the
user to review/accept these edit"

`SPEC.md` (version 1.4) is the contract; §7 (interface) and §9.1 (accessibility) rule this
session. `DECISIONS.md` holds the reasons and the findings. The interface lives in
`src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` and `src/components/**`; the
analysis reaches the page through `runAnalysis` in `src/lib/analysis.ts`.

State of the project. The code was frozen at the tag `freeze`, and a held-out dataset was
scored once on it. That score has to remain the score of the shipped code, so nothing that
produced it changes. The commits after `freeze` hold documents only. A review at the freeze
left four findings open on purpose, F75 to F78 in `DECISIONS.md`; F75 and F76 describe logic
inside `src/components/Assistant.tsx` and `src/components/Review.tsx`. The submission is due
tomorrow morning. Its video and its README screenshot show the top of the review, the "AI
rules" panel, one group of fixes, and "Dismissed by AI" with a duplicate pair open.

The interface was built to this direction: neutral greys, one accent `#b03d00`, IBM Plex Mono
for values and numbers, a system sans-serif. It works but reads as a generic generated
interface: a burnt-orange accent on white, hairline rules with no radius anywhere, monospace
for interface labels and counts, and meta lines joined with middle dots ("414 rows · 16
columns · 137 issues found"). This session replaces that direction with one made for this
product.

Claims from the owner's screenshots of the sample in recorded mode, which may be older than
the last fix session: 414 rows, 16 columns, 137 issues in 57 groups; Duplicates 14,
Inconsistent values 68, Missing data 32, Suspicious records 23; "Accept all high-confidence
fixes (67)"; AI rules 25 verified, 0 rejected; AI opinions 28 of 28 (21 confirmed, 7
dismissed, 0 unsure); "Dismissed by AI (7)".

Verify every premise against the current code before planning.

## 2. Scope 🔑

One piece of work: restyle and restructure the presentation of the two existing screens
(upload, review) into the direction of section 3. Same data, same behaviour, same decisions,
same exports.

Order of operations: first map which files are presentation only and which mix presentation
with logic (decision state, the snapshot loop, filtering, export, the analysis seam). That map
decides how far down the list below this session goes. If a part cannot be reached without
changing logic, the answer at Gate 1 is a smaller target, not a wider scope.

The parts, in priority order. Gate 1 draws the line that fits before the stop time of section
4, and nothing below the line is started.
1. A token layer (colour, type, spacing, radius) in `src/app/globals.css`, used by every
   component, and the two typefaces loaded in `src/app/layout.tsx`.
2. The row strip (section 3) for every issue: fix, flag, duplicate pair, and the rows under
   "Dismissed by AI".
3. The summary by type and the persistent bar: progress per type (pending, accepted,
   rejected) as a bar instead of three rows of numbers; the bar says what the download will
   contain.
4. The analysis trail and the mode line: what the rules found, what the model proposed, what
   the code verified, what the second opinion changed, and whether the analysis is recorded or
   live, readable at a glance instead of a grey paragraph.
5. The upload screen: a real suggestion from the bundled sample shown as a row strip; the drop
   target as the obvious action; "what leaves the browser" as a two-row comparison (with a
   key, without).

May change: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`,
`src/components/**` and their tests (see "Fixed points"). After my OK at Gate 1, and only for
sentences the new interface makes false: `SPEC.md` §7 and §9.1, as version 1.5 with a "Changes
in 1.5" list, and one new entry in `DECISIONS.md` after F78.

May not change: `src/core/**`, `src/ai/**`, `src/app/api/**`, `src/lib/**`, `evals/**`,
`fixtures/**`, `scripts/**`, `docs/**`, `CLAUDE.md`, `README.md`, `package.json` and
`package-lock.json`. The README is maintained outside this session: report what goes stale.

## 3. Constraints and non-goals

Design direction: a marked-up sheet. The interface borrows the way an analyst already marks a
spreadsheet by hand, and uses nothing that does not come from that.

- Colour answers one question: what will happen to this cell in the download? Yellow fill:
  waiting for a decision. Green fill: accepted, this is what the cleaned file will hold.
  Struck through: the value or row that goes away. No fill: the file stays as it is (rejected,
  confirmed, dismissed). A second colour, cobalt, marks everything the model said: the rules
  it proposed, its second opinions, the "AI" source tag, the mode line and "Run live". Nothing
  else is coloured. Issue type and confidence are told by words and shape, and every state
  also has a text label.
- Starting tokens, to adjust until criterion 6 passes: canvas `#F2F5F7`, sheet `#FFFFFF`,
  gridline `#D5DCE2`, ink `#0F2233` (text and primary actions), pending `#FFDD4A`, accepted
  `#18794E` on `#DDF3E4`, removal and errors `#B4231A`, model `#2D4BE0`.
- Type: Atkinson Hyperlegible Next for the interface and Atkinson Hyperlegible Mono for what
  comes from the file (cell values, column names, the file name), both through
  `next/font/google`. The reason is the product: the face keeps look-alike characters apart
  (0 and O, 1 and l and I), which is what reviewing a suspicious value needs. Monospace means
  "this is from your file" and nothing else; counts and labels use the interface face with
  tabular figures. If the installed Next does not offer these families, use IBM Plex Sans with
  the IBM Plex Mono already in the project and say so at Gate 1.
- Shape: data is square, controls are round. Cells and strips have no radius and share
  gridlines like a sheet; buttons, selects and tags have a small radius. Shadow only on the
  one element that floats, the persistent bar.
- The row strip is the one bold element; everything around it stays quiet. A strip is a slice
  of the real table: the row number in a gutter, the column name as a header cell, the value
  in its cell. A fix shows the old value struck and the proposed value on the pending fill;
  the old value and the new value keep the same order in every state. A duplicate shows both
  rows stacked with the differing cells marked. When the components already receive the column
  that justifies an issue (as `zip` does for `city`), show that cell beside the affected one;
  do not parse it out of the reason text. "Show whole row" reveals the rest, rendered only
  when opened.
- Remove what makes the page read as generated: middle-dot chains (use structure: a tag, a
  count, a label), monospace interface labels, capitals for labels, arrows inside button
  text, and any entrance animation. Motion only answers an action, lasts under 200 ms and is
  off under `prefers-reduced-motion`.
- Before Gate 1, test the plan against this question: would the same tokens and layout have
  come out for any other review tool? Where the answer is yes, change it and say what changed.

Fixed points:
- Logic stays as it is. State, effects, handlers, the loop in `Assistant.tsx` that receives
  snapshots and calls `carryDecided`, and the comparison in `Review.tsx` that decides whether
  a download is out of date are moved without change or not touched. F75 to F78 are not fixed
  here: a fix needs its own session and its own review.
- Every accessible name stays as it is: "Accept", "Reject", "Confirm", "Dismiss", "Restore",
  "Undo", "Run live", "Accept all high-confidence fixes", "Download cleaned CSV", "Download
  change log", "Use sample data", "Start over", and the section names "AI rules" and
  "Dismissed by AI". Tests, the README and a recorded walkthrough use them.
- Every number on screen comes from the same source as today. The bar's "what the download
  will contain" reads existing state.
- No test is deleted and no assertion is weakened.
- The statements about limits and about what leaves the browser keep every fact they state
  today. Check them against the code first.
- No new dependency; no component, icon or animation library; no dark theme.
- Nothing may be worse than today at 779 px and 1023 px, the widths tested by hand.
- The owner may be running the frozen app on port 3000. Start any server of yours on port
  3100 (`npx next start -p 3100`).

## 4. When to stop and ask

- A baseline check fails before your first edit.
- The row strip or the analysis trail needs data the components do not receive today, or any
  change under `src/lib`, `src/core`, `src/ai` or `src/app/api`.
- An accessible name from the fixed list would have to change.
- A sentence on the upload screen does not match what the code sends or enforces.
- A new dependency is the only way to load the typefaces.
- At 22:45 local time: stop wherever you are and report what is done, what is left, and
  whether the tree passes criteria 1 to 5.

## 5. Done criteria (fixed before the run)

1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` exit 0. The report
   gives the test count before (290 expected) and after.
2. `npm run eval -- --no-write` and `npm run eval:recorded -- --no-write` exit 0 and print the
   Overall lines `112 105 7 0 25 0.938 0.808` and `137 130 0 7 0 1.000 1.000`.
3. `git diff --stat freeze -- src/core src/ai src/app/api src/lib fixtures scripts package.json package-lock.json`
   prints nothing, and `git status --porcelain -- README.md CLAUDE.md docs evals` prints
   nothing.
4. Same numbers: every figure of the baseline table of Gate 1, read the same way at the end,
   is identical. The report shows the two readings side by side.
5. Same exports: the test `export equals applyDecisions` passes, and `git diff` shows no
   change in its body.
6. Contrast, computed: every text and background pair of the tokens is at least 4.5:1; every
   control boundary and focus indicator is at least 3:1 against its neighbour. A fill is never
   the only carrier of a state: the report names the label or border that carries each one,
   and prints the contrast table.
7. `git grep -n -i "b03d00" -- src`, `git grep -n "·" -- src/app src/components` and
   `git grep -n -i "uppercase" -- src/app src/components` each print nothing, or the report
   explains every remaining line.
8. The report lists every test that changed, line by line, with the reason.
9. The report lists each SPEC sentence changed (section, before, after), quotes the DECISIONS
   entry, and lists every README sentence and every step of a walkthrough of the review
   screen that no longer matches the interface. The DECISIONS entry says that the restyle was
   made after the freeze, names the paths it changed, quotes the first command of criterion 3,
   and notes that the file and line references of F75 to F77 are those of the tag `freeze`.

## 6. Way of working

- Do not commit, merge, push or tag: I commit after an independent review of the diff.
- Gate 1, before any edit, in at most 40 lines: the baseline (criteria 1 and 2, and a table
  of the figures of section 1 as the app gives them now, with how you read them and any
  difference from the claims); whether you can drive a browser with what is installed (if
  not, I look at the screens by hand on port 3100, and you say what to open); the file map of
  section 2 with your verdict; the line: which parts fit before 22:45; the final tokens with
  their measured contrast; a text wireframe of the row strip in each of its states; the SPEC
  sentences you would change; at most three points of this brief you would challenge, each
  with your recommendation. Stop for my OK.
- Checkpoint: when the tokens, the typefaces and the row strip work on one group, start the
  app on port 3100, tell me what to open and wait for a yes or a correction. No report.
- Gate 2: the nine criteria, one line each with its evidence; then findings; then what was
  not done. Stop.
