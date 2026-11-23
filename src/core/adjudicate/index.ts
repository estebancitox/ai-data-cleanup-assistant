// Adjudication (S1). SPEC §6.4: the ambiguous issues that are sent to the model for an
// opinion, and what an opinion may change. This is the one place where a model judgment is
// used without a check in code, so a verdict can only change how prominent an issue is.

import { z } from 'zod';
import { scoreCandidatePairs } from '../analyze/similarity';
import { readNumber } from '../profile';
import type { Analysis, Case, Dataset, Issue, Verdict } from '../types';

/** At most this many cases per analysis, strongest first. */
export const MAX_CASES = 60;
/** The cases go in requests of this size, this many requests at a time. */
export const CASES_PER_REQUEST = 10;
export const CONCURRENT_REQUESTS = 3;

const ADJUDICATED = ['near-duplicate', 'outlier', 'range'] as const;
const isAdjudicated = (issue: Issue): issue is Issue & { detector: Case['detector'] } =>
  (ADJUDICATED as readonly string[]).includes(issue.detector);

const summary = z.strictObject({
  count: z.number(),
  min: z.number(),
  p5: z.number(),
  q1: z.number(),
  median: z.number(),
  q3: z.number(),
  p95: z.number(),
  max: z.number(),
});

/** What the adjudication route accepts: at most 10 cases, each with one or two rows. */
export const AdjudicationRequestSchema = z.strictObject({
  cases: z
    .array(
      z.strictObject({
        issueId: z.string(),
        detector: z.enum(ADJUDICATED),
        rows: z.array(z.strictObject({ rowId: z.number().int(), cells: z.record(z.string(), z.string()) })).min(1).max(2),
        column: z.string().optional(),
        current: z.string().optional(),
        numeric: summary.optional(),
        note: z.string(),
      }),
    )
    .min(1)
    .max(CASES_PER_REQUEST),
}) satisfies z.ZodType<{ cases: Case[] }>;

/**
 * The cases to send for an analysis: near-duplicate candidates with both rows in full, and
 * flagged numbers or dates (R8, C4) with their row in full and the column's numeric summary.
 * Strongest first: the candidates from the highest similarity down, then the flagged values
 * from the one farthest from the middle of its column. At most 60.
 */
export function selectCases(dataset: Dataset, analysis: Analysis): Case[] {
  const rowOf = new Map(dataset.rows.map((row) => [row.id, row]));
  const summaryOf = new Map(analysis.profile.columns.map((column) => [column.name, column.numeric]));
  const pairKey = (rowIds: number[]) => [...rowIds].sort((a, b) => a - b).join('+');
  const similarityOf = new Map(
    scoreCandidatePairs(dataset, analysis.profile).map((pair) => [pairKey(pair.rowIds), pair.similarity]),
  );

  /** How far a flagged number is from the middle of its column, in units of the column's spread. */
  const distance = (issue: Issue): number => {
    const numeric = issue.column === undefined ? undefined : summaryOf.get(issue.column);
    const value = readNumber(issue.current ?? '');
    if (!numeric || value === null) return 0;
    return Math.abs(value - numeric.median) / (numeric.q3 - numeric.q1 || 1);
  };

  const candidates = analysis.issues
    .filter(isAdjudicated)
    .map((issue, position) => ({
      issue,
      position,
      duplicate: issue.detector === 'near-duplicate',
      strength: issue.detector === 'near-duplicate' ? (similarityOf.get(pairKey(issue.rowIds)) ?? 0) : distance(issue),
    }))
    .sort((a, b) => Number(b.duplicate) - Number(a.duplicate) || b.strength - a.strength || a.position - b.position);

  return candidates.slice(0, MAX_CASES).map(({ issue }) => {
    const numeric = issue.column === undefined ? undefined : summaryOf.get(issue.column);
    return {
      issueId: issue.id,
      detector: issue.detector,
      rows: issue.rowIds.map((rowId) => ({ rowId, cells: { ...(rowOf.get(rowId)?.cells ?? {}) } })),
      ...(issue.column === undefined ? {} : { column: issue.column }),
      ...(issue.current === undefined ? {} : { current: issue.current }),
      ...(numeric ? { numeric } : {}),
      note: [issue.reason, issue.evidence].filter(Boolean).join(' '),
    };
  });
}

/**
 * The analysis with the model's opinions attached. `confirm` raises a low confidence to
 * medium. `dismiss` and `unsure` only attach the verdict: a dismissed issue stays in the
 * analysis, for the UI to show apart and the user to restore. Issue ids, fixes and every
 * other field stay as they were. A verdict for an issue that was not adjudicated, or for an
 * unknown id, is ignored; of two verdicts for one issue the first counts. The input is not
 * modified.
 */
export function applyVerdicts(analysis: Analysis, verdicts: Verdict[]): Analysis {
  const byIssue = new Map<string, Verdict>();
  for (const verdict of verdicts) if (!byIssue.has(verdict.issueId)) byIssue.set(verdict.issueId, verdict);
  const issues = analysis.issues.map((issue): Issue => {
    const verdict = byIssue.get(issue.id);
    if (!verdict || !isAdjudicated(issue)) return issue;
    const confidence = verdict.value === 'confirm' && issue.confidence === 'low' ? 'medium' : issue.confidence;
    return { ...issue, confidence, verdict: { value: verdict.value, reason: verdict.reason } };
  });
  return { ...analysis, issues };
}
