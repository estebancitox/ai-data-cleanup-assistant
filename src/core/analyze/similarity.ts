// SPEC §5.3: row similarity and the candidate pairs R2 compares.

import { comparisonKey, isMissing, readNumber } from '../profile';
import type { Dataset, Profile } from '../types';

const MIN_WEIGHT = 0.05;
const CANDIDATE_MIN_DISTINCT_RATIO = 0.5;
const NEIGHBOURS = 3;

export interface ScoredPair {
  /** Lower row id first. */
  rowIds: [number, number];
  similarity: number;
}

interface Cell {
  missing: boolean;
  key: string;
  number: number | null;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Both cells hold a value. */
function cellSimilarity(a: Cell, b: Cell): number {
  if (a.key === b.key) return 1;
  if (a.number !== null && b.number !== null) {
    const scale = Math.max(Math.abs(a.number), Math.abs(b.number));
    return scale === 0 ? 1 : Math.max(0, 1 - Math.abs(a.number - b.number) / scale);
  }
  return 1 - levenshtein(a.key, b.key) / Math.max(a.key.length, b.key.length);
}

/**
 * Every candidate pair with its similarity, highest first. Candidates come from sorting the
 * rows by each distinctive column and pairing each row with the next few, so the work does
 * not grow with the square of the rows. A column is skipped for a pair when either cell is
 * missing: two blanks are not evidence that two rows are the same record.
 */
export function scoreCandidatePairs(dataset: Dataset, profile: Profile): ScoredPair[] {
  const compared = profile.columns.filter((column) => !column.identifierLike && !column.freeText);
  const weights = compared.map((column) => Math.max(column.distinctRatio, MIN_WEIGHT));
  const cells: Cell[][] = compared.map((column) =>
    dataset.rows.map((row) => {
      const value = row.cells[column.name] ?? '';
      return { missing: isMissing(value, column.kind), key: comparisonKey(value), number: readNumber(value) };
    }),
  );

  const rowCount = dataset.rows.length;
  const candidates = new Set<number>();
  compared.forEach((column, c) => {
    if (column.distinctRatio < CANDIDATE_MIN_DISTINCT_RATIO) return;
    const order = dataset.rows
      .map((_, index) => index)
      .filter((index) => !cells[c][index].missing)
      .sort((i, j) => {
        const a = cells[c][i].key;
        const b = cells[c][j].key;
        return a < b ? -1 : a > b ? 1 : i - j;
      });
    order.forEach((index, position) => {
      for (let step = 1; step <= NEIGHBOURS && position + step < order.length; step += 1) {
        const other = order[position + step];
        candidates.add(Math.min(index, other) * rowCount + Math.max(index, other));
      }
    });
  });

  const scored: ScoredPair[] = [];
  for (const code of candidates) {
    const i = Math.floor(code / rowCount);
    const j = code % rowCount;
    let total = 0;
    let weight = 0;
    compared.forEach((_, c) => {
      const a = cells[c][i];
      const b = cells[c][j];
      if (a.missing || b.missing) return;
      total += weights[c] * cellSimilarity(a, b);
      weight += weights[c];
    });
    if (weight === 0) continue;
    const [low, high] = [dataset.rows[i].id, dataset.rows[j].id].sort((a, b) => a - b);
    scored.push({ rowIds: [low, high], similarity: total / weight });
  }
  return scored.sort(
    (a, b) => b.similarity - a.similarity || a.rowIds[0] - b.rowIds[0] || a.rowIds[1] - b.rowIds[1],
  );
}
