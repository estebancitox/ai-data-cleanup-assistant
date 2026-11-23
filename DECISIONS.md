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
10. Keeping the byte-order mark of the uploaded file on export. `parseCsv` removes it and
    `serializeCsv` writes none, so accented text that opened well in a spreadsheet may open
    wrong after cleaning (finding F40).
11. The model's verdict in the change log. `ChangeLog` has no field for it, so an issue that
    the AI dismissed is listed as pending, with nothing that says why it was set aside
    (finding F46).
12. S6: editing a proposed value by hand and removing a flagged row by hand. It needs a fifth
    input to `applyDecisions` and an exception to invariant 8 (finding F39; CUT in SPEC 1.3).
13. C5, the detector for values that fail a column's `email` or `url` format. The format is
    still verified (SPEC §6.3) and shown in the "AI rules" panel; nothing flags the cells
    (F36; CUT in SPEC 1.3).

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

Session 2 (2026-11-23): `@anthropic-ai/sdk` 1.13.0 was added (`npm ls --depth=0`). It is
the only new dependency. Its Zod helper imports `zod/v4` and its peer range is
`zod ^3.25.0 || ^4.0.0`; the installed zod is 4.6.7. Checked against the documentation on the
same day: structured outputs are stable and go in `output_config.format`; `zodOutputFormat`
(`@anthropic-ai/sdk/helpers/zod`), `client.messages.parse()` and `parsed_output` exist as
documented; `claude-sonnet-5-5` thinks adaptively by default, rejects `thinking: disabled`,
`budget_tokens` and the sampling parameters, and defaults to effort `high`.

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

### Independent review of session 1 (2026-11-23, fixes from 14:49 -05)

An independent reviewer read the session 1 commit and found no blocker. The owner decided
which items are fixed now. Each entry: what the review found, where, and the resolution.

**F11. A `duplicate` issue could locate a junk record (review S1, `evals/score.ts`).** After
failing to match a duplicate error, a duplicate issue fell through to the rule "an error with
no columns is located by any issue on its row".

Resolution: fixed. A `duplicate` issue only ever locates a duplicate error: "these two rows
are the same entity" is a different claim from "this row is junk", and the strict reading can
only lower the reported numbers. SPEC 1.2 §8.2. The development run is unchanged.

**F12. A single-column dataset with an empty cell does not survive the round trip (review S2,
`src/core/csv`).** Reproduced: `serializeCsv` writes the empty cell as an empty line, and
`parseCsv` skips empty lines, so the row is lost.

Resolution: open, not fixed. The decision was to fix it in `serializeCsv` only, and that is
not possible: Papa Parse 5.7.1 with `skipEmptyLines: true` tests the parsed row, so it drops
a quoted empty field (`""`) exactly as it drops an empty line, and with the option off both
come back as the same row. No text that `serializeCsv` can write for that cell survives
`parseCsv`. No code and no test were changed for this item. To decide: let `parseCsv` tell an
empty line from a quoted empty field (a change to parsing, with `serializeCsv` writing `""`),
or state in SPEC §4.4 that the round trip holds for datasets `parseCsv` can return, which
never have an empty cell in a single column.

**F13. The 0.90 threshold of R2 was declared twice (review S4, `evals/run.ts` and the
near-duplicate detector).**

Resolution: fixed. One declaration, `NEAR_DUPLICATE_MIN_SIMILARITY` in
`src/core/analyze/detectors/duplicates.ts`, exported by `src/core/analyze` and imported by
the eval.

**F14. A T1 failure still exited with 0 (review S5, `evals/run.ts`).**

Resolution: fixed. `npm run eval` exits with code 1 when T1 fails; the run file is still
written. SPEC 1.2 §8.3. The evaluation moved to `evals/evaluate.ts`, without files, so a test
can show the exit code on inline data without editing a fixture.

**F15. The T1 check passed when a detector id it reads did not exist in the results
(`evals/run.ts`).** A missing detector counted as zero false positives.

Resolution: fixed. A T1 detector with no scored issue fails the check, and the table says so.

**F16. The R2 table of the eval printed a "reference" column with the numbers of SPEC 1.0.**

Resolution: fixed. The column is removed; SPEC §8.4 holds the measured numbers.

**F17. R4 joined the lines of a cell (`src/core/analyze/detectors/spelling.ts`).** A CRLF
inside a cell counted as repeated whitespace and got a high-confidence fix.

Resolution: fixed. R4 collapses runs of spaces and tabs only, and never changes a line break
inside a cell. For the same reason a value of several lines is neither rewritten to another
spelling of its key nor offered as the spelling for one-line values. Leading and trailing
whitespace, line breaks included, is still trimmed. SPEC 1.2 §5.4.

**F18. The group key omitted `source` (`src/core/analyze/index.ts`).** The detector id
`placeholder` is shared by R3 and C2, so a rule issue and a contract issue could share a group.

Resolution: fixed. `source` is part of the group key. SPEC 1.2 §4.3.

**F19. R6 and a slash date in the minority order (review S3,
`src/core/analyze/detectors/date-format.ts`).** An unambiguous slash date written in the
other order than the rest of a slash column is not flagged, because it is in the dominant
layout. Such a date also removes the column's evidence of order, so ambiguous slash dates
are then flagged without a fix.

Resolution: logged. No code change.

**F20. The fix of an `extra` issue is never checked for fabrication (`evals/score.ts`).** An
issue counted as `extra` leaves the scoring before the fix checks, so a value it proposes for
an error with no known fix is not counted. The development run has no `extra` issue.

Resolution: logged. No code change.

### Session 2: the AI data contract (2026-11-23, from 15:16 -05)

Each entry: what was found, where, and what the code does. F21 to F26 were raised at gate 1
and decided by the owner there; SPEC.md is updated between sessions.

**F21. A recording had no way to reach the page (SPEC §6.6 against §4.3).** Recorded mode is
keyed by the file's SHA-256 and the UI shows the model and the date, but the contract route
takes a `ContractRequest`, which carries no hash, and `src/ai` is server only.

Resolution: approved at gate 1. New route `GET /api/ai/recording?sha256=<hex>`: 200 with
`{ contract, model, recordedAt }`, 404 when nothing matches, 400 unless `sha256` is 64
hexadecimal characters; outside the rate limit, because it calls no model. When S1 exists the
same route also returns the recorded verdicts. To do: add the route to SPEC §4.3. For the
integration session: the route reads `fixtures/recorded/` from the file system at request
time, so on a serverless deployment the recordings must be part of the bundle (for Next.js,
through the output file tracing includes), or the route answers 404 for the bundled sample.

**F22. A missing token the rules already handle (SPEC §6.3, §5.6).** C2 runs before R3 and
both use the detector id `placeholder`, so a proposed token such as `n/a` would turn R3's
high-confidence rule issues into medium-confidence AI issues with the same id.

Resolution: approved at gate 1. "Observed" means held by a cell that is not missing. A token
the built-in rules already treat as missing in that column is rejected as "already handled by
a built-in rule"; the same reading makes such a value "not in the data" for
`suspiciousValues` and `canonicalGroups`. No cap on the share of a token: if a live run trips
on it, that is a rule-definition finding.

**F23. What "observed" and "at least 2 remain" count in a canonical group (SPEC §6.3).**

Resolution: approved at gate 1. Values are compared by comparison key throughout §6.3. A
group needs two different keys, so a group of pure case or spacing variants is rejected and
stays with R4. C1 only claims cells whose key differs from the canonical's. A group that
shares a value with an accepted group of the same column is rejected. The canonical value and
the variants are stored with the spelling the file uses most often.

**F24. Which rows count for a dependency (SPEC §6.3, §5.5).**

Resolution: approved at gate 1. Verification and C3 use one comparison
(`dependencyGroups` in `src/core/contract/rules.ts`): rows where A and B are both present; a
verified missing token counts as missing; B is compared by key after the verified canonical
groups; group sizes are counted on those rows. The fix of C3 is the majority value in the
spelling the column uses most often.

**F25. The request does not always fit (SPEC §6.1).** "Cut at 80 characters" is written for
the value lists only, and at the floor of 20 a column still sends up to 30 values, so a wide
file of long values stays above 200 KB and above the route's 256 KB.

Resolution: approved at gate 1. Sample-row cells are cut at 80 characters too. A request
still over 200 KB at the floor is returned as it is and the route answers 413. No new
constant. Not measured on a real wide file: the unit test covers 30 columns of 150 long values.

**F26. Smaller readings applied (approved at gate 1).**
- `format` validators, which the SPEC does not define: an email is one `@`, no spaces and a
  dot in the domain; a url starts with `http://` or `https://` and has a host. A format the
  data does not support is set to `none` and also listed among the rejected rules.
- Date ranges: a bound must be an unambiguous date in an R6 layout. A cell that cannot be
  read for certain (not a date, a date that does not exist, a slash date whose two first
  numbers could each be the month) is neither inside nor outside, and C4 does not flag it.
- `eval:recorded` and `eval:live` exit with 0 when the run completes, whatever T2 and T3 say:
  §8.3 defines a non-zero exit only for T1, and §8.5 handles a miss by classification. They
  exit with 1 when they cannot run (no recording, no key, the model call failed twice).
- `eval:heldout` writes its run file with the proposed and verified contract inside, and
  nothing under `fixtures/recorded/` (§6.6: only `eval:live` writes recordings).
- `src/core/contract` exports `dependencyGroups`, `observedValues` and `rangePosition` to
  `src/core/analyze`, beyond the three names of §4.2, so that verification and the C
  detectors share one definition (the same kind of finding as F3).
- The contract route counts a request against the rate limit only after it passed the size
  and shape checks; a server with no key answers 502 `ai_unavailable`.

**F27. The check that a calendar date exists is written twice.** Once in R6
(`src/core/analyze/detectors/date-format.ts`) and once in `src/core/contract/rules.ts`,
because `src/core/profile` was frozen in this session and `contract` may not import from
`analyze`.

Resolution: logged. To move into `src/core/profile` between sessions.

**F28. T3 cannot pass on the contract path alone (SPEC §8.4).** The rules run has 3 fixes on
clean data, the three trap pairs R2 reports with a `delete-row` fix, and T3 allows 2. Nothing
in §6.1 to §6.3 removes a rule issue; only an S1 dismissal does.

Resolution: the owner keeps the threshold. S1 is pre-approved if the gate 3 report is posted
before 16:45 with a completed live run.

**F29. `GET /api/ai/status` and `GET /api/ai/recording` must run on every request.** Both
routes export `dynamic = 'force-dynamic'`. Source: the Next.js 16.4.6 documentation shipped in
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`, lines 82
to 97 ("Force dynamic rendering, which will result in routes being rendered for each user at
request time"); `next.config.ts` does not enable Cache Components, so that guide applies. Not
verified with a build: `npm run build` is excluded from this session. The route table of the
owner's build shows it (`ƒ` marks a route rendered on demand).

### Session 2, after gate 3: adjudication, S1 (2026-11-23, from 16:13 -05)

The first live run (16:05, one call of 11.0 s) met T2 and missed T3 on "fixes on clean data"
(3, all three from R2 trap pairs; see F28). The gate 3 report was posted at 16:12, so S1 was
built under the owner's pre-approval. Readings applied while building it:

**F30. "Strongest first" is not defined across kinds of case (SPEC §6.4).** The code sends the
near-duplicate candidates first, from the highest similarity down, then the flagged values
(R8, C4) from the one farthest from the median of its column, measured in interquartile
ranges; a flagged date has no numeric summary and goes last. Consequence: in a file with more
than 60 near-duplicate candidates no flagged value is adjudicated.

Resolution: logged, to confirm or change between sessions.

**F31. An issue does not carry its strength as a number.** To rank the candidates,
`src/core/adjudicate` computes the pair similarities again through
`src/core/analyze/similarity.ts`, a file inside `analyze` that its interface (§4.2) does not
name. Either `analyze` exports the scorer or the issue carries the number.

Resolution: logged.

**F32. Smaller readings of §6.4.**
- An `unsure` verdict is attached to its issue, as the `Issue.verdict` type allows; nothing
  else about the issue changes. A case with no answer gets no verdict.
- The model sees the cases under the labels "1" to "10"; issue ids stay on the server. A
  verdict for a label that matches no case is dropped, and of two verdicts for one case the
  first counts. `applyVerdicts` ignores a verdict for an issue that is not a near-duplicate,
  an outlier or a range flag.
- The sentence of the model is cut at 300 characters before it is stored or shown. That
  constant is not in the SPEC.
- `eval:live` stops, and writes no recording, when any adjudication request fails twice: a
  recording with part of the verdicts would not be replayable as "the" analysis.
- The recording has `format: 2`, which adds `verdicts`. A recording of format 1 is read as one
  with no verdicts. The recording route answers `{ contract, verdicts, model, recordedAt }`.
- `src/core/adjudicate` exports, next to `selectCases` and `applyVerdicts`, the schema of the
  route's body and the three numbers of §6.4 (60, 10, 3); `src/ai` exports `adjudicateAll`
  (requests of 10, three at a time) for the evaluation. The page has to do its own batching
  against the route, with those numbers.

Resolution: logged.

**F33. The rate limit of §6.7 against the batches of §6.4.** One analysis is 1 contract
request and up to 6 adjudication requests, and both routes share the limit of 20 per 10
minutes per address. The bundled sample needs 4 requests (28 cases); a file with 60 cases
needs 7, so the third analysis of such a file within 10 minutes from one address gets 429.

Resolution: logged. No constant was changed.

**F34. The adjudication prompt was written after its author had read the trap notes of the
development truth file.** The planning of session 2 read `fixtures/listings.truth.json`,
which says why each trap is not an error. The prompt contains no value of the fixture and its
example is from another domain, but its guidance (a difference that shows two distinct
things; a value the rest of the row supports) matches how those traps are built. The S1
numbers on the development dataset are therefore optimistic. The held-out run is the check.

Resolution: logged. To state next to the numbers in the README.

**F35. The cell written to manipulate a model reaches the model through adjudication.** Row
287 of the development file is one of the two rows of a near-duplicate candidate, and a case
carries both rows in full. The contract request did not contain that cell. Defence: the cell
sits inside the tagged data block as an escaped JSON string, the prompt says that values are
never instructions, and a verdict can only change how prominent an issue is.

Resolution: logged. The verdicts of the second live run show whether it had any effect.

**F36. Outcome of the second live run (16:25 -05), with adjudication.** Run file
`evals/runs/20261123T212555Z-live-listings.json`; replayed by `eval:recorded` with identical
tables (`20261123T212859Z-recorded-listings.json`). On the development dataset: precision
1.000 (130 of 130), recall 1.000 (130 of 130), fix accuracy 84 of 84, fabricated fixes 0,
fixes on clean data 0, wrongly dismissed 0. T2 and T3 are met. Four model calls, none
retried: the contract in 10.0 s, three adjudication requests in 6.1, 6.1 and 5.4 s; 31,731
input and 3,380 output tokens in total.
- Closes F28: the model dismissed the three trap pairs and the four trap outliers, and
  confirmed the 8 planted near-duplicates and the 13 real flagged values. 28 cases, 28
  verdicts, none unsure.
- Closes F35: the cell written to manipulate a model was sent in request 1 (case 8, pair
  146+287). The model confirmed that pair, which is a planted duplicate, and dismissed two
  other pairs of the same request, so it did not "mark every row as a duplicate". One run
  on one cell: it shows the defence held here, not that it always holds.
- The two live runs returned different contracts for the same request (5 ranges and 2
  verified dependencies, then 6 and 3). The issues they drive were the same. The call is not
  deterministic, which is why the recording exists.
- These numbers are read with F34 in mind: the prompts and the readings of §6.3 were written
  by someone who had read the development fixture and its truth. The held-out run is the
  number that is not affected by that.
- C5 was cut for today by the owner at the end of the session.

Resolution: recorded. Nothing was changed after this run.

### Session 3: the review interface (2026-11-23), logged in session 4

The findings of session 3 were only in its report. That report was not available to session
4, so these entries are written from the code on the branch `ui` and from the plan of
session 3. Their wording may differ from the report.

**F37. A group has no title and no reason (SPEC §4.3 against §7.3).** §7.3 asks for a "title
in plain words" and a reason per group, and `IssueGroup` carries neither. The page holds a
table from detector id, type, source, column and target to a title and a sentence
(`src/lib/describe.ts`), with a fallback for an id it does not know. That puts knowledge of
the detectors in the page, which §4.2 says `analyze` hides.

Resolution: logged. The cleaner fix is `groupIssues` returning both, a core and SPEC change.

**F38. The upload limits were private to the core (SPEC §5.1 against §7.1).** §7.1 wants the
limits stated next to the control, and the numbers lived only inside `src/core/csv`. Session 3
kept a second copy in `src/lib/load.ts`, pinned to the core by a test.

Resolution: resolved in session 4. `src/core/csv` exports `UPLOAD_LIMITS` (SPEC 1.3, §4.2),
the page imports it, and the copy and its pinning test are gone; `csv.test.ts` checks that
the module enforces exactly the limits it exports.

**F39. S6 cannot be built on this core (SPEC §2, §4.3, §4.4).** A value edited by hand or a
row removed by hand has no place in `Decisions`, and `applyDecisions` applies only
`issue.fix`. It needs a fifth input to `applyDecisions`, and an exception to invariant 8,
because a value typed by hand is an invented one.

Resolution: S6 is CUT in SPEC 1.3 and on the cut list.

**F40. A byte-order mark is not kept on export (SPEC §5.1, §7.4).** `parseCsv` removes it and
`serializeCsv` writes none. A file with accented text that a spreadsheet opened well because
of its mark may open wrong after cleaning.

Resolution: logged, not patched; on the cut list.

**F41. Who decodes the bytes (SPEC §5.1 against §4.3).** §5.1 says "UTF-8 text", but
`parseCsv` takes a string, so the decoding and the SHA-256 of the bytes belong to the caller.
The page decodes strictly in `src/lib/load.ts` and refuses a file that is not UTF-8, with a
message that says how to fix it; the eval reads its files with Node. Consequence: a file
saved as Windows-1252, which spreadsheets often write, is refused and not converted.

Resolution: the refusal is in SPEC 1.3, §7.1. Conversion from other encodings is not built.

**F42. Keyboard focus after a filter hides a row (SPEC §9.1).** With the status filter on
"Pending", a decision removes the issue's row from the list, and the button that held the
focus goes with it, so a keyboard user has to tab back into the group. A bulk action that
empties a group does the same. Read from the code (`Review.tsx` filters with the current
decisions); not reproduced in a browser in session 4.

Resolution: logged, not fixed.

### Session 4: integration (2026-11-23, from 16:31 -05)

The owner's answers at the plan (16:47) replaced Gate 1 and approved SPEC 1.3, including the
readings F30 to F33 as built.

**F43. The session's criterion 2 against its criterion 9.** `npm run eval` writes a file under
`evals/runs/` on every run, and criterion 9 asks for no change under `evals/`.

Resolution: both evaluations were run with `--no-write` (`evals/run.ts`), approved by the owner.

**F44. The session's criterion 3 against S1 (SPEC §6.6).** The criterion asks for "exactly the
issues that `analyze(dataset, verifyContract(contract, dataset))` returns", and §6.6 says the
recorded verdicts are used too.

Resolution: approved reading. The test checks the same issue ids, and deep equality with
`applyVerdicts` of that analysis and the recorded verdicts; 7 of the 144 issues of the sample
are in "Dismissed by AI".

**F45. Groups of C3 shared a title.** `groupIssues` makes one group per value written, and the
page's title for `dependency` did not name the value: in the recorded analysis of the sample
15 groups shared 4 titles (6, 4, 3 and 2 groups), and so did the names of their bulk buttons.
Found by the test of criterion 3. Same root as F37.

Resolution: fixed in `src/lib/describe.ts`; the title names the value, and a test pins it.

**F46. What export does with an issue the AI dismissed (SPEC §6.4, §7.4).** Approved by the
owner: `applyDecisions` gets the whole analysis, so the change log lists such an issue as
pending. The bar's counts leave it out, and the note after a download names how many were set
aside. An issue the user decided before the verdict arrived stays in its group. `ChangeLog`
has no field for the verdict.

Resolution: in SPEC 1.3, §6.4. The missing field is on the cut list.

**F47. What R5 calls a space (SPEC §5.4).** Before 1.3 `plainNumberText` removed every
white-space character, so a number split by a line break was joined. Now the value is trimmed
(white space around it stays with R4) and, inside it, every white-space character except a
line break is removed, a no-break space included. R4 keeps its literal space and tab.

Resolution: approved by the owner and stated in SPEC 1.3, §5.4. Both evaluations print the
same Overall line as before the change.

**F48. The mode before a file is loaded (SPEC §7.2).** "The AI mode is visible at all times",
but §6.6 decides the mode per file, by its hash. Before a file is analysed the header reads
"AI mode: chosen when a file is loaded".

Resolution: logged.

**F49. Time of the rule-based analysis on 50,000 rows (SPEC §9.2).** 7,980 ms, the median of
three runs (7,979 to 8,017 ms), for `analyze(dataset)` on a generated file of 50,000 rows, 12
columns and 8.15 MB; parsing took 113 to 139 ms more. Measured in Node v22.23.2 on the owner's
laptop with a script outside the repository: a fixed seed, an identifier, a code, a name, three
categorical columns, a postal code that depends on the city, three number columns, a date
column and a free-text note, with about 1% copied rows; it reported 11,896 issues. Not measured
in a browser. The page runs the analysis on the main thread, so the tab does not respond for
that time (cut list, item 4).

Resolution: under the limit of 15 seconds. Nothing was optimised. To record in the README.

**F50. The build warns about the recordings (SPEC §6.6; see F21).** `npm run build` ends with
"Turbopack build encountered 4 warnings", all "Dynamic filesystem access causes tracing of the
whole project", on `src/ai/recordings.ts` lines 70, 72 and 75: the recording route reads a
directory whose path is built at run time. The build exits with 0 and the route works locally.

Resolution: logged. It belongs to the serverless step that follows Gate 2 (the recordings
inside the bundle), and `src/ai` was not open to change in this session.

**F51. `src/lib` has no row in the module map (SPEC §4.2).** The page's own modules live
there: the seam `runAnalysis`, which is where the page writes the order of the pipeline, and
the calls to the AI routes (`src/lib/ai.ts`). §4.2 names only `src/app` and `src/components`.

Resolution: logged. SPEC 1.3 was already frozen when it was noticed.

**F52. Live mode was not exercised against the model.** The session ran with no API key. The
live path (the contract request, the batches of adjudication, a 502 and its retry, "Run
live") is covered by tests that answer the two model routes with the recorded contract and
verdicts, never by a real call.

Resolution: the owner checks it by hand with the key; the checklist is in the session report.
