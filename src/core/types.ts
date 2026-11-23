// Shared types of the core. SPEC §4.3, §6.2, §6.3 and §7.4.

export type IssueType = 'duplicate' | 'inconsistent' | 'missing' | 'suspicious';
export type Confidence = 'high' | 'medium' | 'low';

export interface Row {
  id: number;
  cells: Record<string, string>;
}
export interface Dataset {
  fileName: string;
  columns: string[];
  rows: Row[];
}

export type Fix =
  | { kind: 'set-cell'; rowId: number; column: string; to: string }
  | { kind: 'delete-row'; rowId: number; keepRowId: number };

export interface Issue {
  /** Stable for the same detector, rows, column and fix. */
  id: string;
  type: IssueType;
  /** One of the detector ids of SPEC §5.4 and §5.5. */
  detector: string;
  /** 'ai' means the issue was produced by a verified contract rule. */
  source: 'rule' | 'ai';
  /** One row for cell issues, two for duplicates. */
  rowIds: number[];
  /** Absent for row-level issues. */
  column?: string;
  /** The cell value now (cell issues). */
  current?: string;
  /** Absent means flag-only. */
  fix?: Fix;
  reason: string;
  evidence?: string;
  confidence: Confidence;
  verdict?: { value: 'confirm' | 'dismiss' | 'unsure'; reason: string };
}

export type Decision = 'accepted' | 'rejected';
/** By issue id. An absent id means pending. */
export type Decisions = Record<string, Decision>;

export type ColumnKind = 'number' | 'date' | 'text';

export interface NumericSummary {
  count: number;
  min: number;
  p5: number;
  q1: number;
  median: number;
  q3: number;
  p95: number;
  max: number;
}

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  rows: number;
  missing: number;
  /** Distinct comparison keys among the non-missing cells. */
  distinct: number;
  /** distinct / non-missing cells; 0 when the column has no value. */
  distinctRatio: number;
  categorical: boolean;
  freeText: boolean;
  identifierLike: boolean;
  /** Up to 50 most common values, as written, with counts. */
  topValues: Array<{ value: string; count: number }>;
  /** Up to 5 most common shapes with counts. */
  topShapes: Array<{ shape: string; count: number }>;
  /** Present for number columns that hold at least one number. */
  numeric?: NumericSummary;
}

export interface Profile {
  rowCount: number;
  /** In dataset column order. */
  columns: ColumnProfile[];
}

export interface IssueGroup {
  id: string;
  type: IssueType;
  detector: string;
  source: 'rule' | 'ai';
  column?: string;
  /** The value every fix of the group writes; absent when the fixes differ per cell. */
  target?: string;
  /** The lowest confidence in the group. */
  confidence: Confidence;
  /** In row order. */
  issues: Issue[];
}

/** SPEC §6.2: the rules the model proposes for one file. */
export interface Contract {
  columns: Array<{
    name: string;
    meaning: string;
    role: 'identifier' | 'category' | 'measure' | 'date' | 'free-text' | 'other';
    format: 'email' | 'url' | 'none';
  }>;
  missingTokens: Array<{ column: string; token: string }>;
  canonicalGroups: Array<{ column: string; values: string[]; reason: string }>;
  suspiciousValues: Array<{ column: string; value: string; reason: string }>;
  ranges: Array<{ column: string; min: string; max: string; reason: string }>;
  dependencies: Array<{ determinant: string; dependent: string; reason: string }>;
}

/**
 * SPEC §6.1: the only description of the file that is sent to the model. Column statistics, a
 * capped list of values per column and a small sample of rows; never the whole file.
 */
export interface ContractRequest {
  rowCount: number;
  columns: Array<{
    name: string;
    kind: ColumnKind;
    rows: number;
    missing: number;
    distinct: number;
    categorical: boolean;
    freeText: boolean;
    identifierLike: boolean;
    numeric?: NumericSummary;
    /** Up to 5 most common shapes. */
    shapes: Array<{ shape: string; count: number }>;
    /** Values of the non-missing cells, as written, most common first. `cut` marks a value shortened to 80 characters. */
    values: Array<{ value: string; count: number; cut: boolean }>;
    /** True when `values` lists every distinct value of the column. */
    allValues: boolean;
  }>;
  /** Up to 20 rows. Each row holds its cells in the order of `columns`, cut at 80 characters. */
  sampleRows: string[][];
}

/**
 * SPEC §6.3: the rules the data supports, each with the numbers behind it, and the rejected
 * rules with the reason. `variants` and `canonical` are spellings found in the file.
 * `rejected[].rule` is one of: column, format, missingToken, canonicalGroup, suspiciousValue,
 * range, dependency.
 */
export interface VerifiedContract {
  /** `format` is already 'none' where the data did not support it. */
  columns: Contract['columns'];
  missingTokens: Array<{ column: string; token: string; support: string }>;
  canonicalGroups: Array<{
    column: string;
    canonical: string;
    variants: string[];
    reason: string;
    support: string;
  }>;
  suspiciousValues: Array<{ column: string; value: string; reason: string; support: string }>;
  ranges: Array<{ column: string; min: string; max: string; reason: string; support: string }>;
  dependencies: Array<{ determinant: string; dependent: string; reason: string; support: string }>;
  rejected: Array<{ rule: string; summary: string; reason: string }>;
}

export interface Analysis {
  issues: Issue[];
  profile: Profile;
  contract?: VerifiedContract;
}

export type AiMode = 'live' | 'recorded' | 'off';

/** What the caller knows and the core cannot compute: the clock, the file hash, the AI mode. */
export interface ChangeLogMeta {
  /** ISO 8601. */
  generatedAt: string;
  /** SHA-256 of the uploaded file, hex. */
  sha256: string;
  ai: { mode: AiMode; model: string | null };
}

/** SPEC §7.4. */
export interface ChangeLog {
  tool: 'ai-data-cleanup-assistant';
  version: '1.0';
  file: { name: string; rows: number; columns: number; sha256: string };
  generatedAt: string;
  ai: { mode: AiMode; model: string | null };
  summary: {
    issues: number;
    accepted: number;
    rejected: number;
    pending: number;
    cellsChanged: number;
    rowsRemoved: number;
  };
  changes: Array<{
    issueId: string;
    type: IssueType;
    detector: string;
    source: 'rule' | 'ai';
    confidence: Confidence;
    rowIds: number[];
    column: string | null;
    from: string | null;
    to: string | null;
    reason: string;
    decision: Decision | 'pending';
  }>;
}
