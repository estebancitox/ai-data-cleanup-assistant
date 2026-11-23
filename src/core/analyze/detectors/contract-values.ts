// The detectors that look for one verified value in one column. SPEC §5.5.
// C1 canonical-value, C2 placeholder, C6 flagged-value, C4 range.

import { rangePosition } from '../../contract';
import { comparisonKey, isMissing } from '../../profile';
import type { ColumnProfile, Dataset, Profile, VerifiedContract } from '../../types';
import type { Candidate } from '../precedence';

interface Cell {
  rowId: number;
  current: string;
  key: string;
}

/** The non-missing cells of a column, or none when the contract names a column the file lacks. */
function cellsOf(dataset: Dataset, profile: Profile, name: string): { column: ColumnProfile; cells: Cell[] } | null {
  const column = profile.columns.find((candidate) => candidate.name === name);
  if (!column) return null;
  const cells: Cell[] = [];
  for (const row of dataset.rows) {
    const current = row.cells[name] ?? '';
    if (!isMissing(current, column.kind)) cells.push({ rowId: row.id, current, key: comparisonKey(current) });
  }
  return { column, cells };
}

const cellIssue = (name: string, cell: Cell) => ({
  source: 'ai' as const,
  rowIds: [cell.rowId],
  column: name,
  current: cell.current,
  confidence: 'medium' as const,
});

/** C1: cells holding a variant of a verified group; the fix is the group's canonical value. */
export function detectCanonicalValue(dataset: Dataset, profile: Profile, contract: VerifiedContract): Candidate[] {
  const found: Candidate[] = [];
  for (const group of contract.canonicalGroups) {
    const variants = new Set(group.variants.map(comparisonKey));
    for (const cell of cellsOf(dataset, profile, group.column)?.cells ?? []) {
      if (!variants.has(cell.key)) continue;
      found.push({
        ...cellIssue(group.column, cell),
        type: 'inconsistent',
        detector: 'canonical-value',
        fix: { kind: 'set-cell', rowId: cell.rowId, column: group.column, to: group.canonical },
        reason: `This looks like another way of writing "${group.canonical}".`,
        evidence: `In this column ${group.support}.`,
      });
    }
  }
  return found;
}

/** C2: cells holding a verified missing token; the fix is the empty cell. */
export function detectMissingToken(dataset: Dataset, profile: Profile, contract: VerifiedContract): Candidate[] {
  const found: Candidate[] = [];
  for (const entry of contract.missingTokens) {
    const token = comparisonKey(entry.token);
    for (const cell of cellsOf(dataset, profile, entry.column)?.cells ?? []) {
      if (cell.key !== token) continue;
      found.push({
        ...cellIssue(entry.column, cell),
        type: 'missing',
        detector: 'placeholder',
        fix: { kind: 'set-cell', rowId: cell.rowId, column: entry.column, to: '' },
        reason: `"${cell.current.trim()}" stands for "no value" in this column, so the cell can be left empty.`,
        evidence: `${entry.support}.`,
      });
    }
  }
  return found;
}

/** C6: cells holding a value the model flagged as test data, junk or a placeholder. */
export function detectFlaggedValue(dataset: Dataset, profile: Profile, contract: VerifiedContract): Candidate[] {
  const found: Candidate[] = [];
  for (const entry of contract.suspiciousValues) {
    const flagged = comparisonKey(entry.value);
    for (const cell of cellsOf(dataset, profile, entry.column)?.cells ?? []) {
      if (cell.key !== flagged) continue;
      found.push({
        ...cellIssue(entry.column, cell),
        type: 'suspicious',
        detector: 'flagged-value',
        reason: 'This value looks like test data, junk or a placeholder, not like a real value.',
        evidence: `${entry.support}.`,
      });
    }
  }
  return found;
}

/** C4: numbers or dates outside a verified range. A cell that cannot be read is not flagged. */
export function detectRange(dataset: Dataset, profile: Profile, contract: VerifiedContract): Candidate[] {
  const found: Candidate[] = [];
  for (const range of contract.ranges) {
    const column = cellsOf(dataset, profile, range.column);
    if (!column) continue;
    const expected =
      range.min !== '' && range.max !== ''
        ? `between ${range.min} and ${range.max}`
        : range.min !== ''
          ? `${range.min} or more`
          : `${range.max} or less`;
    for (const cell of column.cells) {
      if (rangePosition(cell.current, range, column.column.kind) !== 'outside') continue;
      found.push({
        ...cellIssue(range.column, cell),
        type: 'suspicious',
        detector: 'range',
        reason: `This value is outside what is expected for this column (${expected}).`,
        evidence: `${range.support}.`,
      });
    }
  }
  return found;
}
