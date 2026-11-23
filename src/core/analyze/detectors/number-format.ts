// R5: numbers written with currency symbols, thousands separators or inner spaces.

import { isMissing, plainNumberText } from '../../profile';
import type { Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

export function detectNumberFormat(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    if (column.kind !== 'number') continue;
    for (const row of dataset.rows) {
      const current = row.cells[column.name] ?? '';
      if (isMissing(current, column.kind)) continue;
      const plain = plainNumberText(current);
      // Outer whitespace alone is left to R4.
      if (plain === null || plain === current.trim()) continue;
      found.push({
        type: 'inconsistent',
        detector: 'number-format',
        source: 'rule',
        rowIds: [row.id],
        column: column.name,
        current,
        fix: { kind: 'set-cell', rowId: row.id, column: column.name, to: plain },
        reason: 'This number is written with symbols, separators or spaces; the plain number is the same amount.',
        confidence: 'high',
      });
    }
  }
  return found;
}
