// What a contract rule means for a cell. Verification (SPEC §6.3) and the detectors the
// contract drives (§5.5) both ask these functions, so "observed", "outside the range" and
// "agrees with its group" have one definition each.

import { comparisonKey, isMissing, readDate, readNumber } from '../profile';
import type { ColumnKind, ColumnProfile, Dataset, Profile, VerifiedContract } from '../types';

export interface ObservedValue {
  /** Non-missing cells that hold this key. */
  cells: number;
  /** The most frequent spelling of the key, as written in the file (tie: first seen). */
  spelling: string;
}

/**
 * The values a column holds, by comparison key, in order of first appearance. Missing cells
 * are left out: an empty cell or a built-in placeholder is not an observed value.
 */
export function observedValues(dataset: Dataset, column: Pick<ColumnProfile, 'name' | 'kind'>): Map<string, ObservedValue> {
  const spellings = new Map<string, Map<string, number>>();
  for (const row of dataset.rows) {
    const value = row.cells[column.name] ?? '';
    if (isMissing(value, column.kind)) continue;
    const key = comparisonKey(value);
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    spellings.set(key, counts);
  }
  const observed = new Map<string, ObservedValue>();
  for (const [key, counts] of spellings) {
    let spelling = '';
    let most = 0;
    let cells = 0;
    for (const [text, count] of counts) {
      cells += count;
      if (count > most) {
        spelling = text;
        most = count;
      }
    }
    observed.set(key, { cells, spelling });
  }
  return observed;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * A date as a number that sorts in calendar order, or null when the text does not say which
 * date it is: not a date, a date that does not exist, or a slash date whose two first numbers
 * could each be the month.
 */
function dateNumber(value: string): number | null {
  const reading = readDate(value);
  if (!reading) return null;
  let month = reading.first;
  let day = reading.second;
  if (reading.layout === 'slash' && reading.first !== reading.second) {
    if (reading.first > 12 && reading.second <= 12) {
      month = reading.second;
      day = reading.first;
    } else if (!(reading.first <= 12 && reading.second > 12)) {
      return null;
    }
  }
  const leap = (reading.year % 4 === 0 && reading.year % 100 !== 0) || reading.year % 400 === 0;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1])) return null;
  return reading.year * 10000 + month * 100 + day;
}

/** The value of a number or date cell as a number that can be compared, or null. */
export function comparable(value: string, kind: ColumnKind): number | null {
  if (kind === 'number') return readNumber(value);
  if (kind === 'date') return dateNumber(value);
  return null;
}

/**
 * Where a cell stands against a range whose bounds are written as text ("" = no bound):
 * 'unreadable' when the cell cannot be compared, so it is neither inside nor outside.
 */
export function rangePosition(
  value: string,
  range: { min: string; max: string },
  kind: ColumnKind,
): 'inside' | 'outside' | 'unreadable' {
  const number = comparable(value, kind);
  if (number === null) return 'unreadable';
  const low = range.min === '' ? null : comparable(range.min, kind);
  const high = range.max === '' ? null : comparable(range.max, kind);
  return (low !== null && number < low) || (high !== null && number > high) ? 'outside' : 'inside';
}

export interface DependencyGroup {
  /** Every row of the group. `key` is null when the dependent cell is missing. */
  rows: Array<{ rowId: number; current: string; key: string | null }>;
  /** Rows of the group whose dependent cell holds a value. */
  present: number;
  /** The most common key of the dependent column in the group (tie: first seen). */
  majorityKey: string | null;
  majorityCount: number;
}

/**
 * The rows behind a rule "A determines B", grouped by the key of A. Rows with A missing are
 * left out. A verified missing token counts as missing in both columns, and B is compared by
 * key after the verified canonical groups, so a variant agrees with its canonical value.
 */
export function dependencyGroups(
  dataset: Dataset,
  profile: Profile,
  rule: { determinant: string; dependent: string },
  verified: Pick<VerifiedContract, 'missingTokens' | 'canonicalGroups'>,
): DependencyGroup[] {
  const kindOf = (name: string): ColumnKind => profile.columns.find((column) => column.name === name)?.kind ?? 'text';
  const tokensOf = (name: string) =>
    new Set(verified.missingTokens.filter((entry) => entry.column === name).map((entry) => comparisonKey(entry.token)));
  const keyOf = (value: string, kind: ColumnKind, tokens: Set<string>): string | null => {
    if (isMissing(value, kind)) return null;
    const key = comparisonKey(value);
    return tokens.has(key) ? null : key;
  };

  const canonicalKey = new Map<string, string>();
  for (const group of verified.canonicalGroups) {
    if (group.column !== rule.dependent) continue;
    for (const variant of group.variants) canonicalKey.set(comparisonKey(variant), comparisonKey(group.canonical));
  }

  const determinant = { kind: kindOf(rule.determinant), tokens: tokensOf(rule.determinant) };
  const dependent = { kind: kindOf(rule.dependent), tokens: tokensOf(rule.dependent) };
  const groups = new Map<string, { rows: DependencyGroup['rows']; counts: Map<string, number> }>();
  for (const row of dataset.rows) {
    const groupKey = keyOf(row.cells[rule.determinant] ?? '', determinant.kind, determinant.tokens);
    if (groupKey === null) continue;
    const current = row.cells[rule.dependent] ?? '';
    const own = keyOf(current, dependent.kind, dependent.tokens);
    const key = own === null ? null : (canonicalKey.get(own) ?? own);
    const group = groups.get(groupKey) ?? { rows: [], counts: new Map<string, number>() };
    group.rows.push({ rowId: row.id, current, key });
    if (key !== null) group.counts.set(key, (group.counts.get(key) ?? 0) + 1);
    groups.set(groupKey, group);
  }

  return [...groups.values()].map(({ rows, counts }) => {
    let majorityKey: string | null = null;
    let majorityCount = 0;
    let present = 0;
    for (const [key, count] of counts) {
      present += count;
      if (count > majorityCount) {
        majorityKey = key;
        majorityCount = count;
      }
    }
    return { rows, present, majorityKey, majorityCount };
  });
}
