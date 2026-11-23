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

## 9. Stack versions

Filled in when the project is scaffolded.

## 10. Findings

Problems found in the SPEC or in the fixtures during the build, appended here. Each entry:
date and time, what was found, where, and what was decided between sessions.
