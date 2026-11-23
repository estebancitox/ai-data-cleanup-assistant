import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/core/types';
import { score, type Truth } from './score';

const truth: Truth = {
  dataset: 'test',
  errors: [
    { id: 'E1', rows: [1, 9], type: 'duplicate', kind: 'exact-duplicate', columns: [], fix: null },
    { id: 'E2', rows: [2], type: 'inconsistent', kind: 'case-whitespace', columns: ['wood'], fix: { column: 'wood', accept: ['Oak'] } },
    { id: 'E3', rows: [3], type: 'missing', kind: 'blank', columns: ['finish'], fix: null },
    { id: 'E4', rows: [4], type: 'suspicious', kind: 'junk-record', columns: [], fix: null },
    { id: 'E5', rows: [5], type: 'inconsistent', kind: 'cross-field', columns: ['wood', 'finish'], fix: { column: 'wood', accept: ['Pine'] } },
  ],
  traps: [
    { id: 'T1', rows: [6], kind: 'legit-outlier' },
    { id: 'T2', rows: [7, 8], kind: 'similar-not-duplicate' },
  ],
};

let next = 0;
function cell(rowId: number, column: string, to?: string, extra: Partial<Issue> = {}): Issue {
  next += 1;
  return {
    id: `i${next}`, type: 'inconsistent', detector: 'd', source: 'rule', rowIds: [rowId], column, reason: '', confidence: 'high',
    ...(to === undefined ? {} : { fix: { kind: 'set-cell', rowId, column, to } }),
    ...extra,
  };
}
function pair(a: number, b: number, extra: Partial<Issue> = {}): Issue {
  next += 1;
  return {
    id: `i${next}`, type: 'duplicate', detector: 'dup', source: 'rule', rowIds: [a, b], reason: '', confidence: 'low',
    fix: { kind: 'delete-row', rowId: b, keepRowId: a },
    ...extra,
  };
}

describe('score', () => {
  it('locates a duplicate only by a duplicate issue on the same two rows', () => {
    expect(score([pair(1, 9)], truth)).toMatchObject({ truePositives: 1, falsePositives: 0 });
    expect(score([pair(1, 2)], truth)).toMatchObject({ truePositives: 0, falsePositives: 1 });
    expect(score([cell(9, 'wood')], truth)).toMatchObject({ truePositives: 0, falsePositives: 1 });
  });

  it('never locates a junk record with a duplicate issue', () => {
    // Row 4 is a junk record. "These two rows are the same entity" is another claim.
    expect(score([pair(4, 10)], truth)).toMatchObject({ truePositives: 0, falsePositives: 1 });
    expect(score([pair(4, 10)], truth).located).toEqual([]);
  });

  it('locates a cell error by row and column, and a junk record by any issue on its row', () => {
    expect(score([cell(2, 'wood')], truth).located).toHaveLength(1);
    expect(score([cell(2, 'finish')], truth)).toMatchObject({ truePositives: 0, falsePositives: 1 });
    expect(score([cell(4, 'anything')], truth).located[0].errorId).toBe('E4');
  });

  it('matches one to one and counts a second issue on a located error as extra', () => {
    const result = score([cell(5, 'wood'), cell(5, 'finish')], truth);
    expect(result).toMatchObject({ truePositives: 1, extra: 1, falsePositives: 0, falseNegatives: 4 });
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(0.2);
    expect(result.recallByKind['cross-field']).toEqual({ located: 1, total: 1 });
    expect(result.byDetector.d).toEqual({ truePositives: 1, falsePositives: 0, extra: 1 });
  });

  it('measures fix accuracy only where the truth has a fix and the issue proposes one', () => {
    const result = score([cell(2, 'wood', 'Oak'), cell(5, 'finish', 'gloss'), cell(3, 'finish')], truth);
    expect(result.fixAccuracy).toEqual({ correct: 1, scored: 2 });
    expect(result.fabricatedFixes).toEqual([]);
  });

  it('counts a proposed value on an error with no known fix as fabricated', () => {
    expect(score([cell(3, 'finish', 'matte')], truth).fabricatedFixes).toEqual(['E3']);
  });

  it('reports false positives, fixes on clean data and traps hit', () => {
    const outlier = cell(6, 'price', undefined, { type: 'suspicious' });
    const trapPair = pair(7, 8);
    const cleanFix = cell(10, 'wood', 'Oak');
    const result = score([outlier, trapPair, cleanFix], truth);
    expect(result.falsePositives).toBe(3);
    expect(result.fixesOnCleanData).toEqual([trapPair.id, cleanFix.id]);
    expect(result.trapsHit.map((hit) => hit.trap)).toEqual(['T1', 'T2']);
    expect(result.confusion).toEqual({});
  });

  it('records the confusion between error type and issue type', () => {
    expect(score([cell(3, 'finish')], truth).confusion).toEqual({ missing: { inconsistent: 1 } });
  });

  it('leaves dismissed issues out and counts the wrongly dismissed ones', () => {
    const dismissed = { verdict: { value: 'dismiss' as const, reason: '' } };
    const wrong = pair(1, 9, dismissed);
    const result = score([wrong, pair(7, 8, dismissed)], truth);
    expect(result).toMatchObject({ issues: 0, dismissed: 2, truePositives: 0, falsePositives: 0 });
    expect(result.wronglyDismissed).toEqual([wrong.id]);
  });
});
