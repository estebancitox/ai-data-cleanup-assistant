// Scoring rules of SPEC §8.2. A pure function of the issues and the truth file.

import type { Issue, IssueType } from '../src/core/types';

export interface TruthError {
  id: string;
  rows: number[];
  type: IssueType;
  kind: string;
  columns: string[];
  fix: { column: string; accept: string[] } | null;
}
export interface TruthTrap {
  id: string;
  rows: number[];
  kind: string;
  columns?: string[];
  note?: string;
}
export interface Truth {
  dataset: string;
  errors: TruthError[];
  traps: TruthTrap[];
}

export interface Tally {
  truePositives: number;
  falsePositives: number;
  extra: number;
}
export interface Recall {
  located: number;
  total: number;
}
export interface Score {
  issues: number;
  dismissed: number;
  truePositives: number;
  falsePositives: number;
  extra: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  recallByType: Record<string, Recall>;
  recallByKind: Record<string, Recall>;
  byIssueType: Record<string, Tally>;
  byDetector: Record<string, Tally>;
  /** Error type, then issue type, over the located errors. */
  confusion: Record<string, Record<string, number>>;
  fixAccuracy: { correct: number; scored: number };
  /** Error ids. */
  fabricatedFixes: string[];
  /** Issue ids. */
  fixesOnCleanData: string[];
  trapsHit: Array<{ trap: string; kind: string; issueId: string; detector: string }>;
  /** Issue ids. */
  wronglyDismissed: string[];
  located: Array<{ errorId: string; issueId: string }>;
  /** Error ids. */
  missed: string[];
  falsePositiveIssues: Array<{ issueId: string; detector: string; rowIds: number[]; column: string | null }>;
}

const sameRows = (a: number[], b: number[]) => a.length === b.length && a.every((row) => b.includes(row));

/** The error an issue points at, whether or not another issue already located it. */
function errorLocatedBy(issue: Issue, errors: TruthError[]): TruthError | undefined {
  if (issue.type === 'duplicate') {
    const duplicate = errors.find((error) => error.type === 'duplicate' && sameRows(error.rows, issue.rowIds));
    if (duplicate) return duplicate;
  }
  return errors.find(
    (error) =>
      error.type !== 'duplicate' &&
      error.rows.some((row) => issue.rowIds.includes(row)) &&
      // No columns: a junk record, wrong as a whole row.
      (error.columns.length === 0 || (issue.column !== undefined && error.columns.includes(issue.column))),
  );
}

function trapsHitBy(issue: Issue, traps: TruthTrap[]): TruthTrap[] {
  return traps.filter((trap) =>
    trap.rows.length > 1
      ? issue.type === 'duplicate' && sameRows(trap.rows, issue.rowIds)
      : issue.column !== undefined &&
        trap.rows.includes(issue.rowIds[0]) &&
        (trap.columns === undefined || trap.columns.includes(issue.column)),
  );
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function score(issues: Issue[], truth: Truth): Score {
  const tally = (): Tally => ({ truePositives: 0, falsePositives: 0, extra: 0 });
  const bump = (table: Record<string, Tally>, key: string, field: keyof Tally) => {
    table[key] ??= tally();
    table[key][field] += 1;
  };

  const result: Score = {
    issues: 0,
    dismissed: 0,
    truePositives: 0,
    falsePositives: 0,
    extra: 0,
    falseNegatives: 0,
    precision: null,
    recall: null,
    recallByType: {},
    recallByKind: {},
    byIssueType: {},
    byDetector: {},
    confusion: {},
    fixAccuracy: { correct: 0, scored: 0 },
    fabricatedFixes: [],
    fixesOnCleanData: [],
    trapsHit: [],
    wronglyDismissed: [],
    located: [],
    missed: [],
    falsePositiveIssues: [],
  };

  const locatedBy = new Map<string, Issue>();
  for (const issue of issues) {
    const error = errorLocatedBy(issue, truth.errors);
    if (issue.verdict?.value === 'dismiss') {
      result.dismissed += 1;
      if (error) result.wronglyDismissed.push(issue.id);
      continue;
    }
    result.issues += 1;
    if (!error) {
      result.falsePositives += 1;
      bump(result.byIssueType, issue.type, 'falsePositives');
      bump(result.byDetector, issue.detector, 'falsePositives');
      result.falsePositiveIssues.push({
        issueId: issue.id,
        detector: issue.detector,
        rowIds: issue.rowIds,
        column: issue.column ?? null,
      });
      if (issue.fix) result.fixesOnCleanData.push(issue.id);
      for (const trap of trapsHitBy(issue, truth.traps)) {
        result.trapsHit.push({ trap: trap.id, kind: trap.kind, issueId: issue.id, detector: issue.detector });
      }
      continue;
    }
    if (locatedBy.has(error.id)) {
      result.extra += 1;
      bump(result.byIssueType, issue.type, 'extra');
      bump(result.byDetector, issue.detector, 'extra');
      continue;
    }
    locatedBy.set(error.id, issue);
    result.truePositives += 1;
    bump(result.byIssueType, issue.type, 'truePositives');
    bump(result.byDetector, issue.detector, 'truePositives');
    result.located.push({ errorId: error.id, issueId: issue.id });
    result.confusion[error.type] ??= {};
    result.confusion[error.type][issue.type] = (result.confusion[error.type][issue.type] ?? 0) + 1;

    const proposed = issue.fix?.kind === 'set-cell' ? issue.fix : undefined;
    if (proposed && error.fix) {
      result.fixAccuracy.scored += 1;
      if (proposed.column === error.fix.column && error.fix.accept.includes(proposed.to)) {
        result.fixAccuracy.correct += 1;
      }
    }
    if (proposed && error.fix === null) result.fabricatedFixes.push(error.id);
  }

  for (const error of truth.errors) {
    const found = locatedBy.has(error.id);
    if (!found) result.missed.push(error.id);
    for (const [table, key] of [
      [result.recallByType, error.type],
      [result.recallByKind, error.kind],
    ] as const) {
      table[key] ??= { located: 0, total: 0 };
      table[key].total += 1;
      if (found) table[key].located += 1;
    }
  }

  result.falseNegatives = result.missed.length;
  result.precision = ratio(result.truePositives, result.truePositives + result.falsePositives);
  result.recall = ratio(result.truePositives, truth.errors.length);
  return result;
}
