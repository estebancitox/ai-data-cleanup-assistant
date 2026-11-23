// R1: exact duplicates. R2: near duplicates.

import { isMissing } from '../../profile';
import type { Dataset, Profile, Row } from '../../types';
import type { Candidate } from '../precedence';
import { scoreCandidatePairs } from '../similarity';

/** The similarity from which two rows are reported as near duplicates. The one declaration. */
export const NEAR_DUPLICATE_MIN_SIMILARITY = 0.9;

export function detectDuplicates(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  // Invariant 4: a kept row is never deleted, and no row is deleted twice.
  const kept = new Set<number>();
  const deleted = new Set<number>();

  const contentOf = (row: Row) => dataset.columns.map((name) => (row.cells[name] ?? '').trim()).join('\u0000');
  const content = new Map<number, string>();
  const firstWith = new Map<string, Row>();
  for (const row of dataset.rows) {
    const text = contentOf(row);
    content.set(row.id, text);
    const first = firstWith.get(text);
    if (!first) {
      firstWith.set(text, row);
      continue;
    }
    kept.add(first.id);
    deleted.add(row.id);
    found.push({
      type: 'duplicate',
      detector: 'exact-duplicate',
      source: 'rule',
      rowIds: [first.id, row.id],
      fix: { kind: 'delete-row', rowId: row.id, keepRowId: first.id },
      reason: `Row ${row.id} is an exact copy of row ${first.id}.`,
      confidence: 'high',
    });
  }

  const rowById = new Map(dataset.rows.map((row) => [row.id, row]));
  const missingCells = (row: Row) =>
    profile.columns.filter((column) => isMissing(row.cells[column.name] ?? '', column.kind)).length;

  // Highest similarity first, so a row in several pairs keeps its strongest one.
  for (const pair of scoreCandidatePairs(dataset, profile)) {
    if (pair.similarity < NEAR_DUPLICATE_MIN_SIMILARITY) break;
    const [lowId, highId] = pair.rowIds;
    if (content.get(lowId) === content.get(highId)) continue;
    const low = rowById.get(lowId);
    const high = rowById.get(highId);
    if (!low || !high) continue;
    // Keep the more complete row; a tie goes to the lower row id.
    const keep = missingCells(high) < missingCells(low) ? high : low;
    const remove = keep === low ? high : low;
    if (kept.has(remove.id) || deleted.has(remove.id) || deleted.has(keep.id)) continue;
    kept.add(keep.id);
    deleted.add(remove.id);
    found.push({
      type: 'duplicate',
      detector: 'near-duplicate',
      source: 'rule',
      rowIds: [lowId, highId],
      fix: { kind: 'delete-row', rowId: remove.id, keepRowId: keep.id },
      reason: `Rows ${lowId} and ${highId} look like the same record entered twice.`,
      evidence: `Similarity ${pair.similarity.toFixed(3)} on a scale from 0 to 1.`,
      confidence: 'low',
    });
  }
  return found;
}
