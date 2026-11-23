# Decisions

Status: 1.0, confirmed by the owner · 2026-11-23

The brief is ambiguous on purpose. This file records how each open point was closed, what was
rejected, and what would make the decision wrong. It was written before any code, together
with `SPEC.md` and the evaluation fixtures.

## 1. Goal

A web app where a non-programmer uploads a CSV, sees what is wrong with it (duplicates,
inconsistent values, missing data, suspicious records), reviews a suggested edit for each
problem with the reason behind it, accepts or rejects, and downloads a cleaned file plus a
record of every change. Success for the one-day build: the full path works on the sample
file, the quality of the suggestions is measured on data with planted errors, and the
measured numbers are published, misses included.

## 2. Non-goals

- Not a data-quality platform: no pipelines, schedules, connectors or stored projects.
- No accounts and no server-side storage of files.
- No automatic cleaning. Nothing is applied without a decision from the user.
- No claim about real-world accuracy. The evaluation uses synthetic data.
- No formats other than CSV.

## 3. Ambiguities in the brief

| # | The brief leaves open | Decision | Why | Rejected | Cost to reverse |
|---|---|---|---|---|---|
| A1 | What "use AI to read through the data" means when the file does not fit in a prompt | The model reads a compressed view of the whole file and proposes rules; code checks the rules and applies them to every row (D1) | Cost and time do not grow with the rows; the result can be verified and replayed | Sending every row to the model | High |
| A2 | How large a file can be | 10 MB, 50,000 rows, 100 columns, stated next to the upload control | Browser memory and a one-day build | No stated limit | Low |
| A3 | What counts as a duplicate | Exact copies (high confidence) and probable same-entity rows (similarity of 0.90 or more, low confidence until the AI confirms). The more complete row is kept. Fields are not merged | A wrong merge destroys data; a wrong flag costs one click | Automatic merging of fields | Medium |
| A4 | What an "inconsistent value" is | The same value written differently (spacing, case, format, abbreviation, misspelling), or a value that contradicts another column under a rule the data supports | Both are fixable with evidence from the file itself | Style opinions with no evidence in the file | Low |
| A5 | Missing data: fill it or flag it | Flag it. Propose a value only when other rows of the same file support it. Placeholder words are normalised to empty | An invented value in a "cleaned" file is worse than a blank | Letting the model guess a plausible value | Low |
| A6 | What "suspicious" means | A statistically unusual number, a value outside a range the data supports, a value that fails its format, or test and junk values. Always with a reason, never with an automatic fix | The right value cannot be known from the file | Proposing corrected numbers | Low |
| A7 | What "review/accept" requires | Decisions per issue and per group; nothing accepted by default; the original is never modified; a change log is exported | The user must be able to defend every change later | Applying fixes and offering undo | Medium |
| A8 | What happens to private data in the file | The file stays in the browser. The model receives column statistics, capped value lists, a 20-row sample and the ambiguous cases. A rules-only mode sends nothing. Nothing is stored | A CSV export often contains personal data | Uploading the file to the server | Medium |
| A9 | How a reviewer runs it without an API key | The sample file ships with a recorded AI analysis; any other file works in rules-only mode | The reviewer should see the real behaviour in one command | Requiring a key to see anything | Low |
| A10 | How anyone knows the suggestions are good | Fixtures with planted errors and a ground truth, thresholds fixed before the code, a second dataset from another domain scored once at the end | "It looks right" is not evidence | Demo-only validation | Low |
| A11 | How to express confidence | Three levels with a stated meaning. No percentages | A percentage from a language model is not calibrated, and there is no time to calibrate one | A numeric score | Low |
| A12 | Which stack | Next.js, TypeScript, Tailwind, Papa Parse, Zod, Vitest, Anthropic SDK; no database | One deployable unit; the hard part of the brief is the review interface | A separate back end | Medium |

## 4. Design decisions

Each one was sketched at least twice. "Counter" is the best option that was rejected and what
it does better.

**D1. Where the model sits.**
Recommend: the model reads a profile of the file and returns a contract (rules). Code checks
each rule against the data, then applies the surviving rules to every row. The model also
gives an opinion on the ambiguous cases that code surfaces.
Because: cost and latency do not grow with the number of rows; the only non-deterministic
step produces one JSON document that can be validated, shown, saved and replayed; a wrong
rule is stopped by a support check before it touches data; text planted in a cell cannot
cause an edit.
Counter: send every row to the model in batches and ask for the issues directly. It does
better on problems no rule describes (a nonsense name, a sentence in the wrong column) and
it follows the brief's wording most literally. Rejected as the base design because cost grows
with the file, two runs give different results, and every single edit would need its own
check. It is the first item of the cut list, as a complement.
Evidence: not measured. The cost of a full row scan was not tested.
Reversal cost: High. The contract schema is the API between server and client and the format
of the recordings.

**D2. Who chooses the spelling to keep.**
Recommend: the model only says which values mean the same thing. Code keeps the member that
appears most often in the file.
Because: a model preference could rewrite hundreds of correct cells to a spelling the file
barely uses. Frequency is evidence from the file.
Counter: let the model choose. Better when the most common spelling is the wrong one. Covered
by editing the proposed value by hand (S6).
Reversal cost: Low.

**D3. Issues and decisions are separate.**
Recommend: `analyze` returns issues with stable ids. The user's decisions live in a separate
map held by the interface.
Because: issues are recomputed when the contract arrives, and decisions already made must
survive that. `analyze` stays a pure function.
Counter: a status field on each issue. One object to render, but recomputing the analysis
would either lose the decisions or push merge logic into the interface.
Reversal cost: Medium. The change-log format depends on it.

**D4. Two AI routes with fixed purposes.**
Recommend: `/api/ai/contract` and `/api/ai/adjudicate`. Prompts and the model id stay on the
server.
Because: a public deployment with a key behind a "send any prompt" route is an open proxy.
Fixed request shapes can be validated and capped.
Counter: one generic route. Less code, and prompts could be edited from the client.
Reversal cost: Medium.

**D5. A failed AI call is not an error state.**
Recommend: the rules-only analysis is computed first and always exists. The contract only
adds to it. If the AI call fails after one retry, the rules-only result stays on screen with
a notice.
Because: there is no path where the user is left with nothing.
Counter: wait for the AI and show one complete result. A simpler screen with no changing
counts, but a slow or failed call blocks everything.
Reversal cost: Low.

**D6. One model judgment is used without a check.**
Verdicts on ambiguous cases (confirm, dismiss) cannot be verified by code. This departs from
the rule that every model output is checked before it is used.
Recommend: verdicts may only change how prominent an issue is. A dismissed issue stays
visible in its own section and can be restored. A verdict never creates or changes a fix.
Because: the alternative for telling a luxury home from a price typo, or unit 4A from unit
4B, is a growing pile of special rules.
Counter: no adjudication. Every candidate is shown with low confidence and the user decides.
Nothing unverified, more noise. This is what ships if S1 is cut.
Evidence: on the development data the similarity rule scores the planted duplicate pairs and
the trap pairs in the same range (SPEC §8.4). A rule alone does not separate them.
Reversal cost: Low.

**D7. Duplicate matching uses a fixed rule.**
Recommend: similarity over all columns that are not identifiers or free text, weighted by
how distinctive each column is, with a threshold of 0.90 chosen once on the development data.
Because: a threshold only means something for the definition it was calibrated on. If the
model chose the columns per file, 0.90 would mean something different each time.
Counter: let the model name the columns that identify an entity. Better on files where two
or three columns carry the identity; needs calibration per file. Cut list.
Reversal cost: Low.

**D8. Model.**
Recommend: `claude-sonnet-5-5` by default, set through an environment variable.
Because: inferring the contract is a judgment task, and a wrong grouping costs the user's
trust. The documentation positions this model as the balance of speed and intelligence.
Counter: `claude-haiku-5-5`. Faster and cheaper; documented for classification and extraction.
Evidence: positioning and prices as published on 2026-11-23. Not measured here. If time
allows, `eval:live` is run with both and the faster model is kept only if it meets T2 and T3.
Reversal cost: Low. One variable.

## 5. Time plan and cut conditions

Times are America/Bogota on Monday 2026-11-23. The durations are estimates. The cut
conditions were fixed before starting, so that scope is cut by rule and not by mood.

| Checkpoint | By | If it is not met |
|---|---|---|
| Contract committed: SPEC, decisions, fixtures | 12:00 | Start anyway; contract errors become findings |
| Session 1: core, rule detectors, T1 | 14:30 | Drop the SHOULD detectors R6 and R7 |
| Session 2: a live contract verified end to end on the development data | 16:45 | Drop adjudication (S1) |
| Contract tests still failing | 17:30 | Reduce the contract to canonical groups, missing tokens and flagged values |
| Session 3: review interface and export | 19:15 | Hide what is unfinished |
| Feature freeze: held-out run, numbers recorded | 19:30 | No new features after this point |
| README and the answer to "another day" | 20:45 | Skip deployment if it is not live within 20 minutes |
| Video recorded | 22:00, or Tuesday 08:00 | |
| Submission | Tuesday 09:00 | One hour of margin before the assumed deadline |

Sessions 2 and 3 depend only on the types produced by session 1, so they can run in parallel.

## 6. Evidence and assumptions

Facts, with source:

- The brief: one application in one day, any stack, AI tools allowed, deliverables are a
  public repository with a README, a 5-minute video and a form (challenge document, received
  2026-11-23).
- Model ids and positioning: `claude-sonnet-5-5`, `claude-haiku-5-5`
  (https://platform.claude.com/docs/en/models/overview, read 2026-11-23).
- Structured outputs are a stable API feature, used through `output_config.format`; the
  TypeScript SDK offers `zodOutputFormat` in `@anthropic-ai/sdk/helpers/zod`; numeric and
  length constraints are not supported in the schema
  (https://platform.claude.com/docs/en/build-with-claude/structured-outputs, read 2026-11-23).
- Fixture checks, run on 2026-11-23 with a throwaway script: in both datasets the dirty file
  differs from the clean file exactly in the declared cells, with 0 undeclared differences;
  the generator gives byte-identical files on a second run; the reference numbers for R2 in
  SPEC §8.4.

Assumptions:

- The deadline is 24 hours after the brief was received: Tuesday 2026-11-24 at 10:00.
- Reviewers read the README and watch the video before running the code, and may not have
  an API key.
- Planted errors are close enough to real ones for the numbers to be informative.

## 7. Open questions

| Question | Who answers | When |
|---|---|---|
| The exact deadline | The owner, with the company | Before 12:00 |
| Sonnet or Haiku for the contract | The owner, from `eval:live` | After session 2, only if there is time |

## 8. Cut list

What is deliberately not built today, in the order it would be built with another day. The
order is revised at feature freeze using the evaluation results.

1. An AI pass over the rows themselves, for problems no rule describes.
2. Field-level merge for duplicates: keep the best value of each column.
3. Saved contracts per data source: approve the rules once, reuse them on the next export of
   the same feed.
4. Large files: parsing and analysis in a Web Worker, a virtualised table.
5. Specialised normalisers for phones, addresses and names.
6. Confidence calibrated from the decisions users actually make.
7. Undo history and sessions that survive a reload.
8. Repair of rows with the wrong number of fields.
9. Row similarity for files whose compared columns are few and all numeric, where unrelated
   rows pair up as near duplicates (finding F8).

## 9. Stack versions

Filled in when the project is scaffolded.

Scaffolded on 2026-11-23 with Node v22.23.2 and npm 12.2.0. Installed versions, from
`npm ls --depth=0`:

| Package | Version | Package | Version |
|---|---|---|---|
| next | 16.4.6 | papaparse | 5.7.1 |
| react, react-dom | 19.3.0 | @types/papaparse | 5.5.2 |
| typescript | 5.9.3 | zod | 4.6.7 |
| tailwindcss, @tailwindcss/turbopack | 4.3.3 | vitest | 5.1.1 |
| eslint | 9.39.5 | tsx | 4.23.15 |
| eslint-config-next | 16.4.6 | @types/node | 22.20.5 |
| @types/react, @types/react-dom | 19.3.0 | | |

How it was scaffolded:

- `create-next-app@16.4.6` refuses a directory that holds files outside its allow-list
  (`helpers/is-folder-empty.ts`), and this repository already held the contract. The scaffold
  was generated in an empty temporary directory and copied in with
  `rsync -a --ignore-existing`; no file name collided. Its `README.md` was not copied.
- Flags: `--ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
  --skip-install --disable-git --no-react-compiler --no-cache-components --no-agents-md
  --no-agent-feedback --yes`.
- `@types/node` was raised from the scaffold's `^20` to `^22`: vitest 5.1.1 declares the peer
  range `^22.0.0 || >=24.0.0` and npm refused to install it otherwise.
- `typecheck` is `next typegen && tsc --noEmit`: the scaffold's `layout.tsx` uses the global
  type `LayoutProps`, which only exists after the route types are generated.
- `.gitignore` adds `.claude/settings.local.json` and keeps `.env.example` trackable.
- The Vitest config is `vitest.config.mts` with the node environment and no plugins. The
  packages of the Next.js Vitest guide (jsdom, React plugin, tsconfig-paths) are for component
  tests and were not installed.
- npm reported that eslint 9.39.5 is no longer supported (it is the version the scaffold
  pins) and that it blocked the install scripts of esbuild and fsevents. Tests and the eval
  run without them.

## 10. Findings

Problems found in the SPEC or in the fixtures during the build, appended here. Each entry:
date and time, what was found, where, and what was decided between sessions.

### Session 1 (2026-11-23, 13:52 to 14:12 -05)

Each entry: what was found, where, what the code does now, and what is still to decide.

**F1. `applyDecisions` cannot build the change log with its three parameters (SPEC §4.3, §7.4).**
The `ChangeLog` needs `generatedAt`, `file.sha256` and `ai.mode/model`, and the core may not
use a clock. Approved at gate 1: a fourth parameter `meta: ChangeLogMeta` supplied by the
caller. To do between sessions: update the signature in §4.3.

Resolution: accepted. SPEC 1.1 §4.3 gives `applyDecisions` the `meta: ChangeLogMeta` parameter as
implemented.

**F2. `Profile`, `IssueGroup` and `VerifiedContract` are named but never defined (SPEC §4.3,
§5.2, §6.3).** Their shapes are now in `src/core/types.ts`, as approved at gate 1.
`VerifiedContract` is provisional: session 2 owns it and may extend it.

Resolution: accepted. SPEC 1.1 §4.3 defines the shapes as implemented. `VerifiedContract` stays
provisional and owned by session 2.

**F3. `profile` cannot hide the comparison key (SPEC §4.2).** `analyze` (R2, R4, R5), contract
verification (§6.3) and C3 need the key, the missing test and the number reading.
`src/core/profile` exports `comparisonKey`, `isMissing`, `missingReason`, `readNumber`,
`plainNumberText`, `isDateText` and `quantile` next to `profileDataset`. The constants still
live only in that module.

Resolution: accepted. SPEC 1.1 §4.2 lists the value rules in the interface of `src/core/profile`.

**F4. Definitions left open in §5.2 and §5.3.** Readings applied:
- The kind of a column is decided over the values that are neither empty nor a placeholder of
  either list; soft placeholders then count as missing only when the kind is number or date.
  As written, kind depends on "non-missing" and "missing" depends on kind.
- Distinct ratio = distinct keys / non-missing cells. A cell of only whitespace is empty.
- Cell similarity: a column is skipped when either cell is missing, checked before "keys are
  equal". "Both are numbers" is decided per value, not per column kind.
- Candidate sort: rows missing the sort column are left out; ties break by row position.
- Thousands separators must sit in groups of three: `1,5` is not read as a number.
- Not built this session: the contract-dependent clauses of §5.2 (soft placeholders "when the
  contract says so", the role `identifier`). They change the compared columns of R2, so they
  conflict with invariant 6 as written. To decide before session 2.

Resolution: the profile and the rule detectors never depend on the contract; the contract only
drives the C detectors. The 0.90 threshold of R2 was calibrated for one definition of row
similarity (D7), and invariant 6 stays as written; the proposal to rewrite it is rejected.
SPEC 1.1 §5.2: identifier-like is decided by the header alone, soft placeholders apply only in
number and date columns, and the missing tokens of a contract only produce C2 issues.

**F5. `groupIssues` (SPEC §4.3).** Grouping by "same target value" gives one group per cell
for fixes that reformat each cell's own value. Approved at gate 1: the target is part of the
group only when the fix writes a shared value; `whitespace`, `number-format` and
`date-format` group by type, detector and column.

Resolution: accepted. SPEC 1.1 §4.3 describes `groupIssues` as implemented.

**F6. R2 differs from the reference of §8.4 by one trap pair.** Measured with `npm run eval`:
14 of 14 planted pairs (6 exact at 1.000, 8 near from 0.9315 to 0.9683), 3 of 4 trap pairs.
Trap T07 (rows 314 and 350) scores 0.89990 and falls 0.0001 under the threshold; the next
pair scores 0.859 against the reference's 0.860. Most likely cause, from a throwaway script
that recomputed the three scores under seven readings: the reference counted placeholder
cells as values when it computed the distinct ratios that weight the columns. That reading
gives 0.90021, 0.9317, 0.9684 and 0.8596, which round to the four reference numbers; §5.2
says a placeholder cell is missing, and the code follows §5.2. Nothing was tuned. The
reference script is not in the repository, so this is the best explanation, not a proof.

Resolution: the SPEC text rules. The author of the reference script confirmed that it counted
placeholder cells as values when weighting columns. SPEC 1.1 §8.4 takes the numbers measured
by the implementation.

**F7. R8 flags valid postal codes (SPEC §5.2, §5.4). To decide before session 2.** `zip` is
a number column by §5.2 and its header is not identifier-like, so R8 runs on it: 36 of the 40
false positives of `outlier` are valid values of `zip` (the other 4 are the two legit-outlier
trap rows). Rules-only precision with R6 and R7 in place is 0.709 overall and 0.23 for
`outlier` (0.667 and 0.27 before them); T1 is not affected, T2 (precision 0.90 or more) is
at risk unless the contract or the adjudication removes them. Classification proposed: rule definition. Options: R8 skips number columns
whose values are codes (same digit count, whole numbers); or R8 runs only on columns the
contract marks as `measure`; or leave it to S1. Not changed in code.

Resolution: classified as a rule-definition finding (SPEC §8.5). R8 gets one more condition
(SPEC 1.1 §5.4): on a given scale, raw or log10, if more than 5% of the column's numbers fall
outside the fences, that scale is skipped for that column, because such a column does not
have the single-cluster shape the fences assume. The 5% was fixed before the re-run and is
not adjusted afterwards. The proposal to run R8 only on `measure` columns is rejected: it
leaves rules-only mode unchanged and makes a rule depend on the contract. Measured after the
change (`evals/runs/20261123T193333Z-rules-listings.json`): 112 issues, 105 true positives,
7 false positives, precision 0.9375, recall 0.808; `outlier` has 12 true positives and 4
false positives, none of them on `zip`. These are the numbers projected before the run.

**F8. R2 on files with few, numeric columns (SPEC §5.3).** Two numbers 5% apart have a
similarity of 0.95, so in a table whose compared columns are all numeric, unrelated rows
pair up as near duplicates. Seen in a unit test with one numeric column (12 pairs among 24
evenly spaced values), not in the fixtures. Not changed in code.

Resolution: known limitation. No code change. Added to the cut list (§8, item 9).

**F9. R7 takes cells from R8 (SPEC §5.6).** R7 runs before R8, so a number with a different
digit count from the rest of its column is reported as `shape`, type `inconsistent`, and
not as `outlier`, type `suspicious`. In the sample, 5 planted `suspicious` errors are
located by an `inconsistent` issue for this reason (the confusion table of the eval). The
code follows §5.6. To decide: whether the order should be R8 before R7, or R7 should skip
number columns.

Resolution: known limitation. No code change.

**F10. R6 details the SPEC does not state.** ISO layouts need two-digit months and days;
slash dates accept one or two digits. Fixes are written zero-padded in numeric layouts and
unpadded in the two month-name layouts. A date that does not exist is flagged with high
confidence. With R6 and R7 the rules-only run gives recall 0.808 and precision 0.709
(0.662 and 0.667 before them); `date-format` locates 12 of 12 with 12 correct fixes and
`shape` locates 10 with no false positive.

Resolution: accepted. SPEC 1.1 §5.4 states the details of R6 as implemented.
