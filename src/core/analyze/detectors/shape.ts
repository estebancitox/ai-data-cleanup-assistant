// R7: values that do not follow the shape almost every value of the column has.

import { isMissing, shapeOf } from '../../profile';
import type { Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

const DOMINANT_MIN_SHARE = 0.9;

export function detectShape(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    const cells = dataset.rows
      .map((row) => ({ rowId: row.id, current: row.cells[column.name] ?? '' }))
      .filter((cell) => !isMissing(cell.current, column.kind))
      // Outer whitespace belongs to R4, so it is not part of the shape.
      .map((cell) => ({ ...cell, shape: shapeOf(cell.current.trim()) }));

    const counts = new Map<string, number>();
    for (const cell of cells) counts.set(cell.shape, (counts.get(cell.shape) ?? 0) + 1);
    const dominant = [...counts].find(([, count]) => count / cells.length >= DOMINANT_MIN_SHARE);
    if (!dominant) continue;
    const example = cells.find((cell) => cell.shape === dominant[0])?.current.trim() ?? '';

    for (const { rowId, current, shape } of cells) {
      if (shape === dominant[0]) continue;
      found.push({
        type: 'inconsistent',
        detector: 'shape',
        source: 'rule',
        rowIds: [rowId],
        column: column.name,
        current,
        reason: 'This value does not follow the pattern of the rest of the column.',
        evidence: `${dominant[1]} of ${cells.length} values are written like "${example}".`,
        confidence: 'low',
      });
    }
  }
  return found;
}
