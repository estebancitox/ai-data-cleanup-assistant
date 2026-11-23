# SPEC: AI Data Cleanup Assistant

Version 1.2 · 2026-11-23 · Status: contract for the one-day build

Changes in 1.2. Each one closes a finding of the independent review (`DECISIONS.md` §10):

- §4.3: `groupIssues` groups by type, detector, source, column and target value (F18).
- §5.4, R4: only runs of spaces or tabs are collapsed; a line break inside a cell is never
  changed (F17).
- §8.2: a junk record is not located by a `duplicate` issue (F11).
- §8.3: `npm run eval` exits with a non-zero code when T1 fails (F14).

Changes in 1.1. Each one closes a finding of session 1 (`DECISIONS.md` §10):

- §4.3: `applyDecisions` takes a fourth parameter, `meta`, with what only the caller knows (F1).
- §4.3: `Profile`, `IssueGroup`, `VerifiedContract`, `Analysis` and `ChangeLogMeta` are defined (F2).
- §4.2: `src/core/profile` also exports the value rules that the other modules need (F3).
- §5.2: the profile and the rule detectors never depend on the contract; identifier-like is
  decided by the header alone and soft placeholders apply only in number and date columns (F4).
- §4.3: `groupIssues` leaves the target value out of the group when the fixes reformat each
  cell's own value (F5).
- §8.4: the R2 reference is replaced by the numbers the implementation measures (F6).
- §5.4, R8: a scale is skipped for a column when more than 5% of its numbers fall outside the
  fences (F7).
- §5.4, R6: the digits a date may have, the padding of a fix, and the handling of dates that
  do not exist (F10).

This file is the contract. It is frozen inside a working session. A problem found in it
mid-session is a finding: it is written down in `DECISIONS.md` under "Findings" and fixed
between sessions with a version bump. Code never patches around the SPEC.

The reasons behind each choice, and the options that were rejected, are in `DECISIONS.md`.

## 1. Product

The brief:

> Create an application that you can upload a csv into. With the csv, the application should
> use AI to read through the data and identify duplicates, inconsistent values, missing data,
> or suspicious records. Then the application should suggest edits, and allow the user to
> review/accept these edits.

The user is someone who received a CSV export and has to clean it before loading it somewhere
else. They are not a programmer. They need to trust every change, and they need to be able to
show afterwards what was changed and why.

Design thesis: **AI proposes, code verifies, the human decides.**

- The model never edits data. It proposes rules about the file (a *data contract*) and gives
  opinions on ambiguous cases.
- Code checks every proposed rule against the file before using it, and code computes every
  edit that is suggested.
- Nothing changes until the user accepts it. The original file is never modified.

## 2. Scope

MUST items are the demo path and are built first. SHOULD items are built only after every
MUST item meets its done criteria. CUT items are not built; they are listed in `DECISIONS.md`.

| Id | Tier | Item |
|---|---|---|
| M1 | MUST | Upload a CSV (file picker and drag and drop) or load the bundled sample; parse in the browser within the limits of §5.1 |
| M2 | MUST | Column profile (§5.2) |
| M3 | MUST | Rule detectors R1, R2, R3, R4, R5, R8 (§5.4) |
| M4 | MUST | AI data contract: request, schema, verification, and the detectors it drives, C1 to C4 and C6 (§5.5, §6.1 to §6.3) |
| M5 | MUST | Review UI: summary, groups, before and after, reason, confidence, source; accept or reject per issue and per group (§7) |
| M6 | MUST | Apply decisions; export the cleaned CSV and the change log (§4.3, §7.4) |
| M7 | MUST | Evaluation harness and committed results (§8) |
| M8 | MUST | AI modes live, recorded and off; the app is useful with no API key (§6.6) |
| S1 | SHOULD | AI adjudication of duplicate candidates and statistical flags (§6.4) |
| S2 | SHOULD | Bulk action "accept all high-confidence fixes" |
| S3 | SHOULD | "What is sent to the AI" panel, shown before the request is made |
| S4 | SHOULD | Public deployment with the limits of §6.7 |
| S5 | SHOULD | Detectors R6 (date format), R7 (shape), C5 (format validators) |
| S6 | SHOULD | Edit the proposed value by hand; remove a flagged row by hand |
| S7 | SHOULD | Flag cells that a spreadsheet would run as a formula (§9.3) |

## 3. Vocabulary

- **Dataset**: the parsed file. Every value is a string exactly as it appeared in the file.
- **Row id**: the 1-based position of a data row in the uploaded file. The header is not
  counted. Row ids never change and are never reused.
- **Issue**: one problem that was identified. It points at a cell, a row, or a pair of rows.
- **Fix**: the edit suggested for an issue. An issue with no fix is *flag-only*: the problem
  is real, but the right value cannot be known from the file.
- **Decision**: what the user chose for an issue: accepted or rejected. No decision means pending.
- **Contract**: the set of rules the model proposes for one file (§6.2).
- **Verified contract**: the subset of those rules that the data supports (§6.3).
- **Verdict**: the model's opinion on one ambiguous issue (§6.4).

Issue types are the four categories of the brief: `duplicate`, `inconsistent`, `missing`,
`suspicious`.

## 4. Architecture

### 4.1 Where things run

- Browser: parsing, profiling, detection, review, applying decisions, export.
- Server: only the AI routes. The server keeps nothing: no database, no files, no payload logs.
- The full file is never uploaded. What leaves the browser is defined in §6.1 and §6.4.

### 4.2 Modules

| Module | Interface (what callers must know) | Hides | Depends on |
|---|---|---|---|
| `src/core/csv` | `parseCsv`, `serializeCsv` | CSV dialect, limits, row numbering | papaparse |
| `src/core/profile` | `profileDataset`, and the value rules `comparisonKey`, `isMissing`, `missingReason`, `readNumber`, `plainNumberText`, `readDate`, `isDateText`, `shapeOf`, `quantile` | how each of them is computed: the normalisation behind the key, the placeholder lists, type inference, the quantile method, column heuristics | none |
| `src/core/contract` | `ContractSchema`, `buildContractRequest`, `verifyContract` | what is sent to the model, every support threshold, how the canonical spelling is chosen | profile |
| `src/core/analyze` | `analyze`, `groupIssues` | every detector, their order, precedence, similarity, thresholds, issue ids | profile, contract |
| `src/core/adjudicate` (S1) | `selectCases`, `applyVerdicts` | which issues are sent, the case format, what a verdict changes | analyze |
| `src/core/apply` | `applyDecisions` | order of application, conflict rules, the change-log format | csv |
| `src/ai` (server only) | `inferContract`, `adjudicate`, `aiStatus` | SDK, model id, prompts, retry policy, recordings | contract schema |
| `src/app/api/ai/*` | `POST /api/ai/contract`, `POST /api/ai/adjudicate`, `GET /api/ai/status` | body limits, rate limit, error mapping | `src/ai` |
| `src/app`, `src/components` | the page | UI state: decisions, filters, progress | core |
| `evals` | `npm run eval`, `eval:recorded`, `eval:live`, `eval:heldout` | scoring rules, report format | core, `src/ai` |

Rules for the module map:

- `src/core` is plain TypeScript: no React, Next.js, DOM, file system or network. It runs the
  same in the browser, in tests and in the eval scripts.
- Each constant and threshold in this SPEC lives in exactly one module.
- Shared types live in `src/core/types.ts`.
- The order of the pipeline is written in one place per caller: the page and the eval runner.

### 4.3 Interfaces

```ts
// src/core/types.ts
export type IssueType = 'duplicate' | 'inconsistent' | 'missing' | 'suspicious';
export type Confidence = 'high' | 'medium' | 'low';

export interface Row { id: number; cells: Record<string, string> }
export interface Dataset { fileName: string; columns: string[]; rows: Row[] }

export type Fix =
  | { kind: 'set-cell'; rowId: number; column: string; to: string }
  | { kind: 'delete-row'; rowId: number; keepRowId: number };

export interface Issue {
  id: string;                    // stable for the same detector, rows, column and fix
  type: IssueType;
  detector: string;              // one of the ids in §5.4 and §5.5
  source: 'rule' | 'ai';         // 'ai' = produced by a verified contract rule
  rowIds: number[];              // one row for cell issues, two for duplicates
  column?: string;               // absent for row-level issues
  current?: string;              // the cell value now (cell issues)
  fix?: Fix;                     // absent = flag-only
  reason: string;                // one sentence a non-programmer can read
  evidence?: string;             // the counts behind the reason
  confidence: Confidence;
  verdict?: { value: 'confirm' | 'dismiss' | 'unsure'; reason: string };  // S1
}

export type Decision = 'accepted' | 'rejected';
export type Decisions = Record<string, Decision>;   // by issue id; absent = pending

export type ColumnKind = 'number' | 'date' | 'text';

export interface NumericSummary {
  count: number; min: number; p5: number; q1: number; median: number;
  q3: number; p95: number; max: number;
}

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  rows: number;
  missing: number;
  distinct: number;              // distinct comparison keys among the non-missing cells
  distinctRatio: number;         // distinct / non-missing cells; 0 when the column has no value
  categorical: boolean;
  freeText: boolean;
  identifierLike: boolean;
  topValues: Array<{ value: string; count: number }>;   // up to 50, as written
  topShapes: Array<{ shape: string; count: number }>;   // up to 5
  numeric?: NumericSummary;      // number columns that hold at least one number
}

export interface Profile { rowCount: number; columns: ColumnProfile[] }   // in column order

export interface IssueGroup {
  id: string;
  type: IssueType;
  detector: string;
  source: 'rule' | 'ai';
  column?: string;
  target?: string;               // the value every fix of the group writes; absent when they differ
  confidence: Confidence;        // the lowest in the group
  issues: Issue[];               // in row order
}

// Provisional: `verifyContract` owns this shape and may extend it. `Contract` is in §6.2.
export interface VerifiedContract {
  columns: Contract['columns'];  // `format` is already 'none' where the data did not support it
  missingTokens: Array<{ column: string; token: string; support: string }>;
  canonicalGroups: Array<{ column: string; canonical: string; variants: string[];
                           reason: string; support: string }>;
  suspiciousValues: Array<{ column: string; value: string; reason: string; support: string }>;
  ranges: Array<{ column: string; min: string; max: string; reason: string; support: string }>;
  dependencies: Array<{ determinant: string; dependent: string; reason: string; support: string }>;
  rejected: Array<{ rule: string; summary: string; reason: string }>;
}

export interface Analysis { issues: Issue[]; profile: Profile; contract?: VerifiedContract }

export type AiMode = 'live' | 'recorded' | 'off';

// What the caller knows and the core cannot compute: the clock, the file hash, the AI mode.
export interface ChangeLogMeta {
  generatedAt: string;           // ISO 8601
  sha256: string;                // SHA-256 of the uploaded file, hex
  ai: { mode: AiMode; model: string | null };
}
```

```ts
/**
 * Reads CSV text into a Dataset. Values are kept exactly as written: no trimming and no type
 * conversion. Never throws: a file that cannot be used returns ok: false with a message for
 * the user. Warnings describe rows that were loaded but look damaged.
 */
export function parseCsv(text: string, fileName: string):
  | { ok: true; dataset: Dataset; warnings: string[] }
  | { ok: false; error: string };

/** Writes a Dataset as CSV text that parseCsv reads back to the same Dataset. */
export function serializeCsv(dataset: Dataset): string;

/**
 * Describes every column: kind, counts, most common values, value shapes and numeric spread.
 * Pure and deterministic. Calling it again for the same Dataset object returns the cached result.
 */
export function profileDataset(dataset: Dataset): Profile;

/**
 * Builds the only description of the file that is sent to the model. It contains column
 * statistics, a capped list of values per column and a small sample of rows, never the whole
 * file. The UI shows this object to the user before sending it.
 */
export function buildContractRequest(dataset: Dataset): ContractRequest;

/**
 * Checks a contract proposed by the model against the data. A rule the data does not support
 * is rejected with the reason; rejected rules are returned so the UI can show them. Never
 * throws: unknown columns and unknown values lead to rejected rules, not to errors.
 */
export function verifyContract(proposed: Contract, dataset: Dataset): VerifiedContract;

/**
 * Finds every issue in the dataset. Without a contract it runs the rule detectors only. With
 * a verified contract it also runs the detectors that the contract drives. Pure and
 * deterministic: the same inputs give the same issues with the same ids, so decisions made
 * on a rules-only result stay valid after the contract arrives.
 */
export function analyze(dataset: Dataset, contract?: VerifiedContract): Analysis;

/**
 * Groups issues for review and bulk decisions: same type, detector, source and column, and
 * the same target value when the fix writes a value the group shares. Fixes that reformat
 * each cell's own value (`whitespace`, `number-format`, `date-format`) are grouped without
 * the target. The source is part of the group because a rule and a contract rule can share a
 * detector id (`placeholder` is both R3 and C2).
 */
export function groupIssues(issues: Issue[]): IssueGroup[];

/**
 * Produces the cleaned dataset and the change log from the user's decisions. Only accepted
 * fixes are applied. The input dataset is not modified. The change log lists every issue with
 * its decision, including the ones that changed nothing. `meta` carries what only the caller
 * knows: the time, the hash of the uploaded file and the AI mode.
 */
export function applyDecisions(
  dataset: Dataset, analysis: Analysis, decisions: Decisions, meta: ChangeLogMeta,
): { cleaned: Dataset; changeLog: ChangeLog };
```

HTTP routes (JSON in, JSON out):

| Route | Request | Response | Errors |
|---|---|---|---|
| `GET /api/ai/status` | none | `{ live: boolean, model: string \| null }` | none |
| `POST /api/ai/contract` | `ContractRequest` | `{ contract: Contract, model: string }` | 400 invalid body, 413 too large, 429 rate limit, 502 `ai_unavailable` |
| `POST /api/ai/adjudicate` (S1) | `{ cases: Case[] }`, at most 10 | `{ verdicts: Verdict[], model: string }` | same |

Prompts and the model id stay on the server. The routes do not accept prompt text.

### 4.4 Invariants (each one has a test with this name)

1. `original dataset is never mutated`: `applyDecisions` and `analyze` leave their input
   deeply equal to a copy taken before the call.
2. `no decisions means no changes`: with no accepted decision, `cleaned` equals the input.
3. `at most one issue per cell`: no two issues share the same row id and column (§5.6).
4. `a kept row is never deleted`: no `keepRowId` is also the `rowId` of a `delete-row` fix,
   and no row is deleted by two issues.
5. `csv round trip`: `parseCsv(serializeCsv(d))` gives back `d`, including values with commas,
   quotes, line breaks and leading or trailing spaces.
6. `issue ids are stable`: every issue from `analyze(d)` appears with the same id in
   `analyze(d, contract)` unless a contract-driven issue took over its cell (§5.6).
7. `analysis is deterministic`: two calls with the same inputs return deeply equal results.
8. `fixes never invent values`: every `set-cell` fix writes either the empty string, a value
   that already exists in the same column, or a reformatting of the cell's own value
   (whitespace, case, number format, date format).

### 4.5 Stack and scripts

Next.js (App Router) with TypeScript in strict mode, Tailwind CSS, Papa Parse, Zod, Vitest and
the official Anthropic TypeScript SDK. No database and no state library. The interface and
all texts are in English. Exact versions are recorded in `DECISIONS.md` when the project is
scaffolded.

`package.json` scripts: `dev`, `build`, `test`, `typecheck`, `lint`, `eval`, `eval:recorded`,
`eval:live`, `eval:heldout`.

## 5. Pipeline and detectors

### 5.1 Parsing and limits

- UTF-8 text; a byte-order mark is removed. The delimiter is detected. The first row is the header.
- Limits: 10 MB, 50,000 data rows, 100 columns. Over a limit: `ok: false` with a message that
  states the limit.
- Empty lines are skipped. An empty header name becomes `column_N`. Duplicate header names:
  `ok: false`.
- A row with fewer fields than the header is padded with empty strings and reported in
  `warnings`. A row with more fields than the header: `ok: false`, naming the first such row,
  because dropping the extra values would lose data silently.

### 5.2 Profile

- **Comparison key** of a value: Unicode NFKC, trim, collapse runs of whitespace to one space,
  lower case. Two values are "the same value written differently" when their keys are equal.
- **Strict placeholders** (always mean "no value", compared by key): `n/a`, `#n/a`, `null`,
  `nil`, `nan`, `undefined`, `-`, `--`, `?`, `tbd`.
- **Soft placeholders** (mean "no value" only in a number or date column): `na`, `none`,
  `unknown`, `missing`, `not available`, `pending`. They are not treated as placeholders in
  text columns, because there they can be real values (`NA` is a country code; `none` is a
  valid answer).
- A cell is **missing** when it is empty or holds a placeholder that applies to its column.
- **Kind** of a column: `number` when at least 90% of its non-missing values are numbers after
  the normalisation of R5; `date` when at least 90% parse as one of the formats of R6;
  otherwise `text`.
- **Categorical**: kind `text`, and 50 or fewer distinct keys or a distinct ratio of 0.1 or less.
- **Free text**: average length above 40 characters and distinct ratio above 0.5.
- **Identifier-like**: the header matches `/(^|_)(id|uuid|key)$/i`. The header alone decides.
- **Shape** of a value: every letter becomes `A`, every digit becomes `9`, other characters stay.
- **Quartiles and percentiles**: sorted values, position `p * (n - 1)`, linear interpolation.
- Per column the profile holds: counts (rows, missing, distinct), distinct ratio, kind, flags,
  up to 50 most common values with counts, up to 5 most common shapes with counts, and for
  number columns min, p5, q1, median, q3, p95, max.

The profile and the rule detectors never depend on the contract. A contract can name further
missing tokens for a column; they produce C2 issues and do not change the profile, the kind of
a column or the row similarity.

### 5.3 Row similarity (used by R2)

- Compared columns: all columns except identifier-like and free-text ones.
- Weight of a column: its distinct ratio, with a floor of 0.05. Agreement on a rare value is
  stronger evidence than agreement on a common one.
- Similarity of two cells: 1 if their keys are equal; the column is skipped for the pair if
  either cell is missing; if both are numbers, `1 - |a - b| / max(|a|, |b|)` with a floor of 0;
  otherwise `1 - levenshtein(keyA, keyB) / max(length)`.
- Similarity of two rows: weighted mean of the cell similarities over the columns not skipped.
- Candidate pairs (so that the comparison does not grow with the square of the rows): for each
  compared column with a distinct ratio of 0.5 or more, sort the rows by key and compare each
  row with the next 3.

### 5.4 Rule detectors (no AI)

| Id | Detector | Tier | Finds | Type | Fix | Confidence |
|---|---|---|---|---|---|---|
| R1 | `exact-duplicate` | MUST | Rows equal in every column after trimming | duplicate | delete the later row, keep the first | high |
| R2 | `near-duplicate` | MUST | Candidate pairs with similarity of 0.90 or more that are not exact duplicates | duplicate | delete one row, keep the more complete one (fewer missing cells; tie: lower row id) | low |
| R3 | `empty`, `placeholder` | MUST | Empty cells; placeholder cells | missing | empty: none. placeholder: set to empty | high |
| R4 | `whitespace`, `case-variant` | MUST | Leading or trailing whitespace in any column; repeated inner spaces or tabs outside free text; a line break inside a cell is never changed; in categorical columns, values with the same key written differently | inconsistent | trimmed value; the most frequent spelling of that key (tie: first seen) | high |
| R5 | `number-format` | MUST | In number columns, values that are numbers once currency symbols, thousands separators and inner spaces are removed | inconsistent | the plain number | high |
| R6 | `date-format` | SHOULD | In date columns, values not in the column's dominant format | inconsistent | the same date in the dominant format (see below) | high or medium |
| R7 | `shape` | SHOULD | In columns where one shape covers 90% or more of non-missing values, values with another shape | inconsistent | none | low |
| R8 | `outlier` | MUST | Unusual numbers in number columns that are not identifier-like (see below) | suspicious | none | low |

R2: when a row belongs to several pairs, pairs are taken from the highest similarity down and
a pair is skipped if it would break invariant 4.

R6: known formats are `YYYY-MM-DD`, `YYYY/MM/DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `Mon D, YYYY`
and `D Mon YYYY`. The dominant format is the one that 80% or more of the parseable values
use. A slash date whose two first parts are both 12 or less is ambiguous: if every unambiguous
slash date in the column is month-first (or every one is day-first), that order is used and
the confidence is medium; with no such evidence the issue is flag-only. A value that parses
to a date that does not exist is `suspicious`, flag-only.

R6 in detail:

- A value is read as a date from its text alone. The two year-first formats need a two-digit
  month and day; slash dates accept one or two digits; month names are the three-letter
  English abbreviations, in any case. Whether the date exists is checked afterwards.
- The two slash formats are one layout in the text, so they are counted together when the
  dominant format is looked for, and the order of that layout is the one every unambiguous
  slash date of the column agrees on. When slash is dominant and has no such order, values in
  other formats are flagged without a fix.
- A fix is written zero-padded in the numeric formats (`2024-03-05`, `03/05/2024`) and
  unpadded in the two formats with a month name (`Mar 5, 2024`, `5 Mar 2024`).
- A date that does not exist is flagged with high confidence in any format, the dominant one
  included, and also in a column with no dominant format. An ambiguous slash date with no
  evidence for its order is flagged with medium confidence.

R8 needs at least 20 numbers in the column. A value is flagged when any of these holds:

- it is outside the Tukey fences with k = 3 on the raw values (`q1 - 3*IQR`, `q3 + 3*IQR`);
- it is positive and outside the same fences computed on `log10` of the positive values;
- it is zero or negative in a column where 95% or more of the numbers are positive.

A scale whose IQR is 0 is skipped. A scale (raw or log10) is also skipped for a column when
more than 5% of the column's numbers fall outside its fences: such a column does not have the
single-cluster shape the fences assume, so the values outside are a second group of valid
values and not anomalies. The third condition uses no fences and is not affected. Numbers are
read after the normalisation of R5.

### 5.5 Detectors driven by the verified contract

| Id | Detector | Tier | Finds | Type | Fix | Confidence |
|---|---|---|---|---|---|---|
| C1 | `canonical-value` | MUST | Cells holding a variant of a verified group | inconsistent | the group's canonical value | medium |
| C2 | `placeholder` | MUST | Cells holding a verified missing token | missing | set to empty | medium |
| C3 | `dependency` | MUST | For a verified rule "A determines B": a B that disagrees with the clear majority for its A; a missing B where that majority exists | inconsistent; missing | the majority value | high or medium |
| C4 | `range` | MUST | Numbers or dates outside a verified range | suspicious | none | medium |
| C5 | `format` | SHOULD | In columns the contract marks as `email` or `url`, values that fail the validator | suspicious | none | medium |
| C6 | `flagged-value` | MUST | Cells holding a value the model flagged as test data, junk or a placeholder | suspicious | none | medium |

C3 in detail. Rows are grouped by the key of A (rows with A missing are left out). B is
compared by key, after applying the C1 groups. A group has a *clear majority* when its most
common B value appears in at least 3 rows and in at least 80% of the group's rows with B
present. Then:

- a row whose B differs from the majority gets an `inconsistent` issue on column B;
- a row whose B is missing gets a `missing` issue on column B with the majority as the fix;
- confidence is high when the majority has at least 5 rows and at least 90%; otherwise medium;
- `evidence` states the counts, for example "7 of 7 other rows with this zip have this city".

### 5.6 Precedence: one issue per cell

Detectors run in this order and the first issue for a cell wins: C3, C1, C2, R3, R5, R6, R4,
C5, C6, C4, R7, R8. An issue with a fix always replaces a flag-only issue on the same cell.
Row-level issues (R1, R2) are independent of cell issues. Cell issues on a row that an
accepted `delete-row` removes are dropped when decisions are applied.

Fixes compose inside one issue when they are pure reformatting of the same value: a value
with extra spaces and the wrong case gets one fix with the final value.

### 5.7 Applying decisions

Accepted `set-cell` fixes are applied first, then accepted `delete-row` fixes. Row order and
column order are kept. Row ids in the change log are the original ones.

## 6. AI layer

### 6.1 Contract request (what is sent)

`buildContractRequest` returns, and the UI can show (S3):

- per column: name, kind, counts, flags, numeric summary, the 5 most common shapes;
- per column, values with their counts: every distinct value when there are 200 or fewer;
  otherwise the 20 most common and 10 picked with a fixed seed. Values are cut at 80 characters;
- 20 sample rows: the first 5 and 15 picked with a fixed seed;
- nothing else. If the request is larger than 200 KB, the per-column value cap is halved until
  it fits, with a floor of 20.

### 6.2 Contract schema

The response is constrained by the API's structured outputs to this shape. The Zod schema in
`src/core/contract` is the single definition; it must stay inside the subset of JSON Schema
that structured outputs accept.

```ts
export interface Contract {
  columns: Array<{
    name: string;                 // a header, exactly as written
    meaning: string;              // short label for the UI, for example "postal code"
    role: 'identifier' | 'category' | 'measure' | 'date' | 'free-text' | 'other';
    format: 'email' | 'url' | 'none';
  }>;
  missingTokens: Array<{ column: string; token: string }>;
  canonicalGroups: Array<{ column: string; values: string[]; reason: string }>;
  suspiciousValues: Array<{ column: string; value: string; reason: string }>;
  ranges: Array<{ column: string; min: string; max: string; reason: string }>;  // "" = no bound
  dependencies: Array<{ determinant: string; dependent: string; reason: string }>;
}
```

A canonical group only says "these values mean the same thing". The model does not choose
the spelling to keep; code does (§6.3).

### 6.3 Verification (what the data must support)

| Rule | Accepted when | Otherwise |
|---|---|---|
| any | every column it names is a header | rejected: unknown column |
| column `format` | at least 90% of non-missing values pass the validator | format ignored |
| `missingTokens` | the token's key is an observed value of the column | rejected: not in the data |
| `canonicalGroups` | after dropping values that are not observed, at least 2 remain, and at most one of them covers 10% or more of the column's non-missing rows | rejected: not in the data, or: would merge two common values |
| `suspiciousValues` | the value is observed and covers 5% or less of the rows | rejected: not in the data, or: too common to be an anomaly |
| `ranges` | the column is a number or date column, the bounds parse, and 95% or more of the values are inside | rejected: with the share of values outside |
| `dependencies` | both columns exist and differ; the determinant is not free text; at least 20 rows are in groups of 3 or more; among rows in groups of 2 or more, 95% or more agree with their group's majority | rejected: with the measured agreement |

For an accepted canonical group, the canonical value is the member that appears most often in
the file (tie: first seen). The others are the variants.

`VerifiedContract` holds the accepted rules, each with the numbers that supported it, and the
rejected rules, each with the reason. The UI shows both.

### 6.4 Adjudication (S1)

Sent to the model: near-duplicate candidates (both rows in full) and R8 or C4 flags (the row
in full, plus the column's numeric summary). At most 60 cases per analysis, strongest first,
in requests of 10, three at a time.

The model answers `confirm`, `dismiss` or `unsure` with one sentence per case. Effects:

- `confirm`: confidence goes from low to medium; the model's sentence is shown;
- `dismiss`: the issue moves to a collapsed section "Dismissed by AI". It is left out of bulk
  actions and of the default counts, and the user can restore it;
- `unsure` or no answer: nothing changes.

A verdict never creates a fix and never changes one. This is the one place where a model
judgment is used without a check in code, so it can only change how prominent an issue is.

### 6.5 Model call rules

- Official TypeScript SDK, called only from `src/ai`. Model id from `ANTHROPIC_MODEL`, default
  `claude-sonnet-5-5`. Structured outputs with the Zod schema.
- On an API error, a timeout of 60 s, a refusal, a truncated response or a response that fails
  the schema: retry once. If the retry fails the route answers 502 `ai_unavailable`. A partial
  or invalid contract is never returned.
- When AI fails, the rules-only result stays on screen with a notice and a retry button.
- Prompts: the system prompt states that all cell values are data to analyse and never
  instructions. Prompts are domain-agnostic: no real-estate or CRM wording, and no literal
  value from `fixtures/`. Any example inside a prompt uses a third, unrelated domain.

### 6.6 AI modes

- **live**: the server has `ANTHROPIC_API_KEY`.
- **recorded**: the file's SHA-256 matches a recording in `fixtures/recorded/`. The recorded
  contract and verdicts are used; the UI shows "Recorded AI analysis", the model and the date.
- **off**: rules only, with a notice that explains how to enable AI.

The bundled sample uses its recording by default, so the first run is instant and needs no
key; a "Run live" action appears when the server is live. Uploaded files use live mode when
available. Recordings are written only by `npm run eval:live`.

### 6.7 Server limits

Request body up to 256 KB; `max_tokens` capped; at most 10 cases per adjudication request; a
best-effort in-memory limit of 20 AI requests per 10 minutes per IP; payloads are not logged.
The hard limit on cost is the monthly spend limit set in the API console by the owner.

## 7. Review and export UI

One page, four states: upload, analysing, review, export. Rule-based issues are shown as soon
as they exist; AI results are added when they arrive, without losing decisions already made.

### 7.1 Upload

File picker, drag and drop, "Use sample data". Limits stated next to the control. Parse errors
and warnings shown in plain language.

### 7.2 Analysing

Progress by stage, with counts: parsed rows, rule issues, contract (proposed, verified,
rejected), adjudication. The AI mode is visible at all times.

### 7.3 Review

- Summary: one card per issue type with pending, accepted and rejected counts.
- Filters: type, status, confidence, source.
- Groups (from `groupIssues`), collapsed by default: title in plain words, number of issues,
  source (Rule or AI), confidence, reason, "Accept all" and "Reject all".
- Inside a group, per issue: row id, the cell before and after with the difference visible,
  reason and evidence, accept and reject. Duplicates show both rows side by side with the
  differing cells marked. Flag-only issues show the cell and the reason, and can be dismissed.
- A group shows its first 50 issues and a "show more" control.
- "AI rules" panel: the verified contract and the rejected rules with their reasons.
- A persistent bar: counts of accepted, rejected and pending, and the export actions.

### 7.4 Export

- `<name>.cleaned.csv`: the result of `applyDecisions`.
- `<name>.changes.json`: the change log.

```ts
export interface ChangeLog {
  tool: 'ai-data-cleanup-assistant';
  version: '1.0';
  file: { name: string; rows: number; columns: number; sha256: string };
  generatedAt: string;                         // ISO 8601, set by the caller
  ai: { mode: 'live' | 'recorded' | 'off'; model: string | null };
  summary: { issues: number; accepted: number; rejected: number; pending: number;
             cellsChanged: number; rowsRemoved: number };
  changes: Array<{
    issueId: string; type: IssueType; detector: string; source: 'rule' | 'ai';
    confidence: Confidence; rowIds: number[]; column: string | null;
    from: string | null; to: string | null; reason: string;
    decision: Decision | 'pending';
  }>;
}
```

## 8. Evaluation

### 8.1 Fixtures

`fixtures/` holds a development dataset (`listings`) and `fixtures/heldout/` holds a second
dataset from another domain (`contacts`). Each has a clean file, a dirty file and a truth
file. `fixtures/README.md` describes the truth format. They are generated by
`scripts/generate-fixtures.mjs` and were committed before any detector existed.

The held-out dataset exists to catch tuning to the development data. Its files are not opened
while building. It is scored once, at feature freeze, by `npm run eval:heldout`.

### 8.2 Scoring

An issue with the verdict `dismiss` is not scored as an issue; it is counted separately.

- A **duplicate** error is located by a `duplicate` issue whose two row ids are the error's rows.
- Any other error is located by an issue on one of the error's rows whose column is one of the
  error's `columns`. An error with no columns (a junk record) is located by any issue on its row
  that is not a `duplicate` issue.
- Matching is one to one. A second issue on an error that is already located is counted as
  `extra`, neither right nor wrong.
- **True positive**: an issue that locates an error. **False positive**: any other issue.
  **False negative**: an error that no issue locates.
- Reported: precision and recall overall; recall per error type and per error kind; precision
  per issue type and per detector; the confusion between the error's type and the issue's type.
- **Fix accuracy**: among located errors whose truth has a `fix` and whose issue proposes one,
  the share where the proposed value is one of `fix.accept`.
- **Fabricated fixes**: located errors whose truth has `fix: null` but whose issue proposes a value.
- **Fixes on clean data**: false positives that carry a fix. These are the harmful ones.
- **Traps hit**: false positives on trap rows, listed one by one.
- **Wrongly dismissed**: issues with the verdict `dismiss` that located a real error.

### 8.3 Modes and commands

| Command | Uses | Calls the API | Run by |
|---|---|---|---|
| `npm run eval` | rules only, development dataset | no | anyone, CI |
| `npm run eval:recorded` | rules and the recorded contract and verdicts, development dataset | no | anyone, CI |
| `npm run eval:live` | rules and a fresh contract and verdicts, development dataset; writes the recording | yes | the owner |
| `npm run eval:heldout` | the same on the held-out dataset | yes | the owner, once |

Each run prints a table and writes `evals/runs/<UTC timestamp>-<mode>-<dataset>.json`, which
is committed. A run records the model id and the SHA-256 of the dataset. `npm run eval` exits
with a non-zero code when T1 fails.

### 8.4 Thresholds, fixed before any detector was written

| Id | Run | Threshold |
|---|---|---|
| T1 | `npm run eval` | Recall 1.00 for the kinds `exact-duplicate` (6 of 6), `blank` and `blank-derivable` (20 of 20), `case-whitespace` (18 of 18), `number-format` (8 of 8). Detectors R1, R3 `empty`, R4 and R5 produce no false positive. |
| T2 | `eval:recorded` and `eval:live`, development dataset | Overall precision 0.90 or more and overall recall 0.80 or more |
| T3 | same | Fabricated fixes: 0. Fix accuracy 0.95 or more. Fixes on clean data: 2 or fewer |
| T4 | `eval:heldout` | No threshold. Reported as measured, next to the development numbers |

Reference for R2, measured by the implementation with `npm run eval`: on the development
dataset, at 0.90, all 14 planted duplicate pairs are found (6 exact at 1.000, 8 near between
0.9315 and 0.9683) together with 3 of the 4 trap pairs (0.9022 to 0.9634). The fourth trap
pair scores 0.8999, just under the threshold, and the next highest pair scores 0.8593. The
rule alone cannot tell the planted pairs from the traps; that is the job of S1. The reference
of version 1.0 (4 trap pairs from 0.900, next pair at 0.860) came from a throwaway script that
counted placeholder cells as values when it weighted the columns; §5.2 counts them as missing,
and the text of this SPEC rules.

### 8.5 When a threshold is missed

1. Each failure is classified as one of: prompt, rule implementation, rule definition (a SPEC
   finding), fixture (a finding).
2. Nothing changes until the owner approves the classification.
3. One round of fixes on the development dataset is allowed. Then the run is repeated.
4. If the threshold is still missed, the README reports the measured number. The claim moves,
   not the code. Truth files are never edited to make a run pass, and no constant of this SPEC
   is tuned to raise a number.

The harness measures performance on planted errors in synthetic data. It does not measure
performance on real files; the README says so.

## 9. Other requirements

### 9.1 Accessibility

Real buttons and labels, visible focus, full keyboard operation of accept and reject, counts
announced through a live region, WCAG AA contrast, and no information carried by colour alone.

### 9.2 Performance

The 414-row sample is analysed by rules in under 1 second. Analysis of a 50,000-row file must
not take more than 15 seconds on the owner's laptop; the measured time is recorded in the README.

### 9.3 Security and privacy

- The API key exists only on the server. `.env*` files are not committed.
- The server stores nothing and does not log payloads.
- Cell values can contain text written to manipulate a model. Defence: values are passed as
  data, and no model output is used without the checks of §6.3, with the single bounded
  exception of §6.4.
- S7: a text cell that starts with `=`, `+` or `@` is flagged as `suspicious` (flag-only, low),
  because a spreadsheet may run it as a formula. Export does not alter such cells.
