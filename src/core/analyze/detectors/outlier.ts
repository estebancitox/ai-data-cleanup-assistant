// R8: unusual numbers in number columns that are not identifier-like.

import { isMissing, quantile, readNumber } from '../../profile';
import type { Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

const MIN_NUMBERS = 20;
const FENCE_K = 3;
const MOSTLY_POSITIVE_SHARE = 0.95;

/** Tukey fences, or null when the scale has no spread (IQR of 0). */
function fences(values: number[]): { low: number; high: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr === 0) return null;
  return { low: q1 - FENCE_K * iqr, high: q3 + FENCE_K * iqr };
}

const outside = (value: number, range: { low: number; high: number } | null) =>
  range !== null && (value < range.low || value > range.high);

export function detectOutliers(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    if (column.kind !== 'number' || column.identifierLike) continue;
    const cells: Array<{ rowId: number; current: string; value: number }> = [];
    for (const row of dataset.rows) {
      const current = row.cells[column.name] ?? '';
      if (isMissing(current, column.kind)) continue;
      const value = readNumber(current);
      if (value !== null) cells.push({ rowId: row.id, current, value });
    }
    if (cells.length < MIN_NUMBERS) continue;

    const positives = cells.filter((cell) => cell.value > 0).map((cell) => cell.value);
    const rawFences = fences(cells.map((cell) => cell.value));
    const logFences = fences(positives.map((value) => Math.log10(value)));
    const mostlyPositive = positives.length / cells.length >= MOSTLY_POSITIVE_SHARE;
    const typical = column.numeric
      ? `Half of the numbers in this column are between ${column.numeric.q1} and ${column.numeric.q3}.`
      : undefined;

    for (const { rowId, current, value } of cells) {
      const farOut = outside(value, rawFences) || (value > 0 && outside(Math.log10(value), logFences));
      const wrongSign = value <= 0 && mostlyPositive;
      if (!farOut && !wrongSign) continue;
      found.push({
        type: 'suspicious',
        detector: 'outlier',
        source: 'rule',
        rowIds: [rowId],
        column: column.name,
        current,
        reason: farOut
          ? 'This number is far from the other values in this column.'
          : 'This number is zero or negative, and almost every other value in this column is positive.',
        evidence: farOut ? typical : `${positives.length} of ${cells.length} numbers are positive.`,
        confidence: 'low',
      });
    }
  }
  return found;
}
