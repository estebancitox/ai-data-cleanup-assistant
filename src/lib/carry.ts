// SPEC §7.3: an issue the user has decided is never removed or replaced by a later snapshot.

import type { Analysis, Decisions, Issue } from '../core/types';

/** What an issue acts on: its cell, the row its fix removes, or its rows. */
function target(issue: Issue): string {
  if (issue.column !== undefined) return JSON.stringify(['cell', issue.rowIds[0], issue.column]);
  if (issue.fix?.kind === 'delete-row') return JSON.stringify(['row', issue.fix.rowId]);
  return JSON.stringify(['rows', ...issue.rowIds]);
}

/**
 * The analysis to show when `next` arrives while `shown` is on screen. A decided issue of
 * `shown` that `next` lacks is carried into the result, and the issue of `next` that took its
 * place is left out: the one on the same target that was not on screen. The result keeps one
 * issue per cell, in the order `analyze` gives. An issue that is pending is not carried, so
 * undoing a decision frees the next snapshot to replace the issue.
 *
 * Returns `next` itself when nothing is carried. Profile and contract are always those of `next`.
 */
export function carryDecided(shown: Analysis, next: Analysis, decisions: Decisions): Analysis {
  const arriving = new Set(next.issues.map((issue) => issue.id));
  const carried = shown.issues.filter((issue) => decisions[issue.id] !== undefined && !arriving.has(issue.id));
  if (carried.length === 0) return next;

  const onScreen = new Set(shown.issues.map((issue) => issue.id));
  const taken = new Set(carried.map(target));
  const kept = next.issues.filter((issue) => onScreen.has(issue.id) || !taken.has(target(issue)));

  // The order of `analyze`: by first row, then by column, then by last row. Row issues come first.
  const columnPosition = new Map(next.profile.columns.map((column, index) => [column.name, index]));
  const position = (issue: Issue) => (issue.column === undefined ? -1 : (columnPosition.get(issue.column) ?? 0));
  const issues = [...kept, ...carried].sort(
    (a, b) =>
      Math.min(...a.rowIds) - Math.min(...b.rowIds) ||
      position(a) - position(b) ||
      Math.max(...a.rowIds) - Math.max(...b.rowIds),
  );
  return { ...next, issues };
}
