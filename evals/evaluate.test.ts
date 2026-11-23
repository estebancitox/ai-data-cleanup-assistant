import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import type { Truth, TruthError } from './score';

// A made-up price list of boards. Rows 9 to 13 each carry one planted error.
const rows = [
  ['A-1', 'Oak', 'matte', '120'],
  ['A-2', 'Pine', 'gloss', '135'],
  ['A-3', 'Oak', 'satin', '150'],
  ['A-4', 'Pine', 'matte', '165'],
  ['A-5', 'Oak', 'gloss', '180'],
  ['A-6', 'Pine', 'satin', '195'],
  ['A-7', 'Oak', 'matte', '210'],
  ['A-8', 'Pine', 'gloss', '225'],
  ['A-9', 'OAK', 'satin', '240'],
  ['A-10', ' Pine', 'matte', '255'],
  ['A-11', 'Oak', 'gloss', '"$1,270"'],
  ['A-12', 'Pine', '', '285'],
  ['A-3', 'Oak', 'satin', '150'],
];
const csv = (data: string[][]) => ['sku,wood,finish,price', ...data.map((row) => row.join(','))].join('\n');

const errors: TruthError[] = [
  { id: 'E1', rows: [3, 13], type: 'duplicate', kind: 'exact-duplicate', columns: [], fix: null },
  { id: 'E2', rows: [9], type: 'inconsistent', kind: 'case-whitespace', columns: ['wood'], fix: { column: 'wood', accept: ['Oak'] } },
  { id: 'E3', rows: [10], type: 'inconsistent', kind: 'case-whitespace', columns: ['wood'], fix: { column: 'wood', accept: ['Pine'] } },
  { id: 'E4', rows: [11], type: 'inconsistent', kind: 'number-format', columns: ['price'], fix: { column: 'price', accept: ['1270'] } },
  { id: 'E5', rows: [12], type: 'missing', kind: 'blank', columns: ['finish'], fix: null },
];
const truth = (list: TruthError[]): Truth => ({ dataset: 'boards', errors: list, traps: [] });

describe('evaluate', () => {
  it('passes T1 and exits with 0 when every T1 check holds', () => {
    const evaluation = evaluate(csv(rows), truth(errors), 'boards.csv');
    expect(evaluation.t1.recall.map((check) => [check.located, check.total])).toEqual([[1, 1], [1, 1], [2, 2], [1, 1]]);
    expect(evaluation.t1.falsePositives.map((check) => check.falsePositives)).toEqual([0, 0, 0, 0, 0]);
    expect(evaluation.t1.pass).toBe(true);
    expect(evaluation.exitCode).toBe(0);
  });

  it('exits with a non-zero code when T1 fails', () => {
    // The truth declares one more exact duplicate, which the data does not contain.
    const missed: TruthError = { id: 'E6', rows: [1, 2], type: 'duplicate', kind: 'exact-duplicate', columns: [], fix: null };
    const evaluation = evaluate(csv(rows), truth([...errors, missed]), 'boards.csv');
    expect(evaluation.t1.recall[0]).toMatchObject({ located: 1, total: 2, pass: false });
    expect(evaluation.t1.pass).toBe(false);
    expect(evaluation.exitCode).not.toBe(0);
    expect(evaluation.report).toContain('FAIL');
  });

  it('fails T1 when a detector it checks produced no issue at all', () => {
    // Without the row with the leading space, no issue comes from the detector `whitespace`.
    const data = rows.map((row) => (row[0] === 'A-10' ? ['A-10', 'Pine', 'matte', '255'] : row));
    const evaluation = evaluate(csv(data), truth(errors.filter((error) => error.id !== 'E3')), 'boards.csv');
    const whitespace = evaluation.t1.falsePositives.find((check) => check.detector === 'whitespace');
    expect(whitespace).toEqual({ detector: 'whitespace', falsePositives: null, pass: false });
    expect(evaluation.t1.recall.every((check) => check.pass)).toBe(true);
    expect(evaluation.exitCode).toBe(1);
    expect(evaluation.report).toContain('no issue from this detector');
  });

  it('prints the R2 table without a reference column', () => {
    const { report } = evaluate(csv(rows), truth(errors), 'boards.csv');
    const header = report.split('\n')[report.split('\n').indexOf('R2 near-duplicate pairs (SPEC 8.4)') + 1];
    expect(header.trim().split(/\s{2,}/)).toEqual(['measure', 'value']);
    expect(report).not.toContain('reference');
    expect(report).toContain('planted pairs reported');
  });
});
