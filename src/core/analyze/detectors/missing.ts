// R3: empty cells and placeholder cells.

import { missingReason } from '../../profile';
import type { Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

export function detectMissing(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    for (const row of dataset.rows) {
      const current = row.cells[column.name] ?? '';
      const reason = missingReason(current, column.kind);
      if (reason === null) continue;
      const base = {
        type: 'missing' as const,
        source: 'rule' as const,
        rowIds: [row.id],
        column: column.name,
        current,
        confidence: 'high' as const,
      };
      if (reason === 'empty') {
        found.push({ ...base, detector: 'empty', reason: 'This cell is empty.' });
      } else {
        found.push({
          ...base,
          detector: 'placeholder',
          fix: { kind: 'set-cell', rowId: row.id, column: column.name, to: '' },
          reason: `"${current.trim()}" stands for "no value", so the cell can be left empty.`,
        });
      }
    }
  }
  return found;
}
