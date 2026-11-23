// SPEC §5.6: one issue per cell, and the issue ids.

import type { Issue } from '../types';

/** An issue before it has an id. */
export type Candidate = Omit<Issue, 'id'>;

/** FNV-1a, 32 bits: short, deterministic, no clock and no randomness. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable for the same detector, rows, column and fix. */
export function issueId(candidate: Candidate): string {
  const { fix } = candidate;
  const fixPart =
    fix === undefined ? 'flag' : fix.kind === 'set-cell' ? `set-${hash(fix.to)}` : `del-${fix.rowId}`;
  return [candidate.detector, candidate.rowIds.join('+'), candidate.column ?? '', fixPart].join(':');
}

/**
 * Keeps one issue per cell. The lists come in precedence order and the first issue for a
 * cell wins, except that an issue with a fix replaces a flag-only one.
 */
export function onePerCell(detectorsInOrder: Candidate[][]): Candidate[] {
  const byCell = new Map<string, Candidate>();
  for (const candidates of detectorsInOrder) {
    for (const candidate of candidates) {
      const cell = `${candidate.rowIds[0]}\u0000${candidate.column ?? ''}`;
      const holder = byCell.get(cell);
      if (!holder || (holder.fix === undefined && candidate.fix !== undefined)) {
        byCell.set(cell, candidate);
      }
    }
  }
  return [...byCell.values()];
}
