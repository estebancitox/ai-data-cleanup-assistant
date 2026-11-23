// R4: extra whitespace, and the same value written differently in a categorical column.

import { comparisonKey, isMissing } from '../../profile';
import type { ColumnProfile, Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

/** Outer whitespace goes everywhere; repeated inner whitespace stays in free text. */
function tidySpacing(value: string, column: ColumnProfile): string {
  const trimmed = value.trim();
  return column.freeText ? trimmed : trimmed.replace(/\s{2,}/g, ' ');
}

/** Per comparison key, how often each spelling is used, in order of first appearance. */
function countSpellings(values: string[], column: ColumnProfile): Map<string, Map<string, number>> {
  const byKey = new Map<string, Map<string, number>>();
  for (const value of values) {
    const key = comparisonKey(value);
    const spelling = tidySpacing(value, column);
    const counts = byKey.get(key) ?? new Map<string, number>();
    counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
    byKey.set(key, counts);
  }
  return byKey;
}

/** The most frequent spelling; a tie goes to the one seen first. */
function usualSpelling(counts: Map<string, number>): string {
  let usual = '';
  let most = 0;
  for (const [spelling, count] of counts) {
    if (count > most) {
      usual = spelling;
      most = count;
    }
  }
  return usual;
}

export function detectSpelling(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    const cells = dataset.rows
      .map((row) => ({ rowId: row.id, current: row.cells[column.name] ?? '' }))
      .filter((cell) => !isMissing(cell.current, column.kind));
    const spellings = column.categorical
      ? countSpellings(cells.map((cell) => cell.current), column)
      : null;

    for (const { rowId, current } of cells) {
      const tidy = tidySpacing(current, column);
      const counts = spellings?.get(comparisonKey(current));
      const target = counts ? usualSpelling(counts) : tidy;
      if (target === current) continue;
      const base = {
        type: 'inconsistent' as const,
        source: 'rule' as const,
        rowIds: [rowId],
        column: column.name,
        current,
        fix: { kind: 'set-cell' as const, rowId, column: column.name, to: target },
        confidence: 'high' as const,
      };
      if (target === tidy) {
        found.push({ ...base, detector: 'whitespace', reason: 'This value has extra spaces around or inside it.' });
      } else {
        found.push({
          ...base,
          detector: 'case-variant',
          reason: `This is "${target}" written differently from the rest of the column.`,
          evidence: `"${target}" is used in ${counts?.get(target) ?? 0} cells; this spelling in ${counts?.get(tidy) ?? 0}.`,
        });
      }
    }
  }
  return found;
}
