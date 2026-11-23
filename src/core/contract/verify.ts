// SPEC §6.3: what the data must support before a proposed rule is used.

import { comparisonKey, isMissing, profileDataset } from '../profile';
import type { ColumnProfile, Contract, Dataset, VerifiedContract } from '../types';
import { comparable, dependencyGroups, observedValues, rangePosition, type ObservedValue } from './rules';

const FORMAT_MIN_SHARE = 0.9;
const GROUP_COMMON_SHARE = 0.1;
const SUSPICIOUS_MAX_SHARE = 0.05;
const RANGE_MIN_INSIDE = 0.95;
const DEPENDENCY_MIN_ROWS = 20;
const DEPENDENCY_ROWS_IN_GROUPS_OF = 3;
const DEPENDENCY_AGREEMENT_IN_GROUPS_OF = 2;
const DEPENDENCY_MIN_AGREEMENT = 0.95;

const VALIDATORS: Record<'email' | 'url', (value: string) => boolean> = {
  // One @, no spaces, a dot in the domain.
  email: (value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value),
  // http or https, then a host.
  url: (value) => /^https?:\/\/[^\s/?#]+\S*$/i.test(value),
};

const UNKNOWN_COLUMN = 'unknown column';
const NOT_IN_DATA = 'not in the data';
const NAMED_TWICE = 'named twice; the first one is kept';

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
const quoted = (values: string[]) => values.map((value) => `"${value}"`).join(', ');

/**
 * Checks a contract proposed by the model against the data. A rule the data does not support
 * is rejected with the reason; rejected rules are returned so the UI can show them. Never
 * throws: unknown columns and unknown values lead to rejected rules, not to errors.
 *
 * Values are compared by comparison key, and "observed" means held by a cell that is not
 * missing: a token the built-in rules already treat as missing is rejected, so that those
 * cells stay with the rule that is certain about them.
 */
export function verifyContract(proposed: Contract, dataset: Dataset): VerifiedContract {
  const profile = profileDataset(dataset);
  const columnOf = new Map(profile.columns.map((column) => [column.name, column]));
  const observedCache = new Map<string, Map<string, ObservedValue>>();
  const observedIn = (column: ColumnProfile) => {
    const cached = observedCache.get(column.name) ?? observedValues(dataset, column);
    observedCache.set(column.name, cached);
    return cached;
  };
  const presentCells = (column: ColumnProfile) =>
    dataset.rows.map((row) => row.cells[column.name] ?? '').filter((value) => !isMissing(value, column.kind));

  const verified: VerifiedContract = {
    columns: [],
    missingTokens: [],
    canonicalGroups: [],
    suspiciousValues: [],
    ranges: [],
    dependencies: [],
    rejected: [],
  };
  const reject = (rule: string, summary: string, reason: string) => {
    verified.rejected.push({ rule, summary, reason });
  };

  for (const entry of proposed.columns) {
    const column = columnOf.get(entry.name);
    if (!column) {
      reject('column', entry.name, UNKNOWN_COLUMN);
      continue;
    }
    if (verified.columns.some((accepted) => accepted.name === entry.name)) {
      reject('column', entry.name, NAMED_TWICE);
      continue;
    }
    let format = entry.format;
    if (format !== 'none') {
      const passes = VALIDATORS[format];
      const values = presentCells(column);
      const share = values.length === 0 ? 0 : values.filter((value) => passes(value.trim())).length / values.length;
      if (share < FORMAT_MIN_SHARE) {
        reject('format', `${entry.name}: ${format}`, `${percent(share)} of the values pass the check; ${percent(FORMAT_MIN_SHARE)} are needed`);
        format = 'none';
      }
    }
    verified.columns.push({ ...entry, format });
  }

  for (const { column: name, token } of proposed.missingTokens) {
    const summary = `${name}: "${token}"`;
    const column = columnOf.get(name);
    if (!column) {
      reject('missingToken', summary, UNKNOWN_COLUMN);
      continue;
    }
    if (isMissing(token, column.kind)) {
      reject('missingToken', summary, 'already handled by a built-in rule');
      continue;
    }
    const key = comparisonKey(token);
    const seen = observedIn(column).get(key);
    if (!seen) {
      reject('missingToken', summary, NOT_IN_DATA);
      continue;
    }
    if (verified.missingTokens.some((accepted) => accepted.column === name && comparisonKey(accepted.token) === key)) {
      reject('missingToken', summary, NAMED_TWICE);
      continue;
    }
    verified.missingTokens.push({ column: name, token: seen.spelling, support: `${seen.cells} of ${column.rows} cells hold this token` });
  }

  const grouped = new Map<string, Set<string>>();
  for (const group of proposed.canonicalGroups) {
    const summary = `${group.column}: ${quoted(group.values)}`;
    const column = columnOf.get(group.column);
    if (!column) {
      reject('canonicalGroup', summary, UNKNOWN_COLUMN);
      continue;
    }
    const observed = observedIn(column);
    const named = new Set(group.values.map(comparisonKey));
    // In the order the file first shows them, so that a tie goes to the value seen first.
    const members = [...observed.keys()].filter((key) => named.has(key));
    if (members.length < 2) {
      reject('canonicalGroup', summary, `${NOT_IN_DATA}: fewer than two different values of the group are in this column`);
      continue;
    }
    const taken = grouped.get(group.column) ?? new Set<string>();
    if (members.some((key) => taken.has(key))) {
      reject('canonicalGroup', summary, 'shares a value with another group of this column');
      continue;
    }
    const cellsOf = (key: string) => observed.get(key)?.cells ?? 0;
    const spellingOf = (key: string) => observed.get(key)?.spelling ?? '';
    const nonMissing = column.rows - column.missing;
    const common = members.filter((key) => cellsOf(key) / nonMissing >= GROUP_COMMON_SHARE);
    if (common.length > 1) {
      reject('canonicalGroup', summary, `would merge two common values: ${quoted(common.map(spellingOf))}`);
      continue;
    }
    let canonical = members[0];
    for (const key of members) if (cellsOf(key) > cellsOf(canonical)) canonical = key;
    const variants = members.filter((key) => key !== canonical);
    for (const key of members) taken.add(key);
    grouped.set(group.column, taken);
    verified.canonicalGroups.push({
      column: group.column,
      canonical: spellingOf(canonical),
      variants: variants.map(spellingOf),
      reason: group.reason,
      support: `"${spellingOf(canonical)}" fills ${cellsOf(canonical)} cells; the other spellings fill ${variants.reduce((sum, key) => sum + cellsOf(key), 0)}`,
    });
  }

  for (const { column: name, value, reason } of proposed.suspiciousValues) {
    const summary = `${name}: "${value}"`;
    const column = columnOf.get(name);
    if (!column) {
      reject('suspiciousValue', summary, UNKNOWN_COLUMN);
      continue;
    }
    const key = comparisonKey(value);
    const seen = observedIn(column).get(key);
    if (!seen) {
      reject('suspiciousValue', summary, NOT_IN_DATA);
      continue;
    }
    const share = seen.cells / column.rows;
    if (share > SUSPICIOUS_MAX_SHARE) {
      reject('suspiciousValue', summary, `too common to be an anomaly: ${percent(share)} of the rows hold it`);
      continue;
    }
    if (verified.suspiciousValues.some((accepted) => accepted.column === name && comparisonKey(accepted.value) === key)) {
      reject('suspiciousValue', summary, NAMED_TWICE);
      continue;
    }
    verified.suspiciousValues.push({ column: name, value: seen.spelling, reason, support: `${seen.cells} of ${column.rows} rows hold this value` });
  }

  for (const proposal of proposed.ranges) {
    const range = { min: proposal.min.trim(), max: proposal.max.trim() };
    const summary = `${proposal.column}: ${range.min || 'no lower bound'} to ${range.max || 'no upper bound'}`;
    const column = columnOf.get(proposal.column);
    if (!column) {
      reject('range', summary, UNKNOWN_COLUMN);
      continue;
    }
    if (column.kind === 'text') {
      reject('range', summary, 'not a number or date column');
      continue;
    }
    const low = range.min === '' ? null : comparable(range.min, column.kind);
    const high = range.max === '' ? null : comparable(range.max, column.kind);
    if ((range.min !== '' && low === null) || (range.max !== '' && high === null)) {
      reject('range', summary, `a bound cannot be read as a ${column.kind}`);
      continue;
    }
    if (low === null && high === null) {
      reject('range', summary, 'no bound was given');
      continue;
    }
    if (low !== null && high !== null && low > high) {
      reject('range', summary, 'the lower bound is above the upper bound');
      continue;
    }
    const positions = presentCells(column)
      .map((value) => rangePosition(value, range, column.kind))
      .filter((position) => position !== 'unreadable');
    const inside = positions.filter((position) => position === 'inside').length;
    const share = positions.length === 0 ? 0 : inside / positions.length;
    if (share < RANGE_MIN_INSIDE) {
      reject('range', summary, `${percent(1 - share)} of the values are outside; at most ${percent(1 - RANGE_MIN_INSIDE)} may be`);
      continue;
    }
    verified.ranges.push({ column: proposal.column, ...range, reason: proposal.reason, support: `${inside} of ${positions.length} values are inside` });
  }

  for (const rule of proposed.dependencies) {
    const summary = `${rule.determinant} -> ${rule.dependent}`;
    const determinant = columnOf.get(rule.determinant);
    if (!determinant || !columnOf.has(rule.dependent)) {
      reject('dependency', summary, UNKNOWN_COLUMN);
      continue;
    }
    if (rule.determinant === rule.dependent) {
      reject('dependency', summary, 'the two columns are the same');
      continue;
    }
    if (determinant.freeText) {
      reject('dependency', summary, 'the determinant is free text');
      continue;
    }
    if (verified.dependencies.some((accepted) => accepted.determinant === rule.determinant && accepted.dependent === rule.dependent)) {
      reject('dependency', summary, NAMED_TWICE);
      continue;
    }
    let rowsInGroups = 0;
    let compared = 0;
    let agreeing = 0;
    for (const group of dependencyGroups(dataset, profile, rule, verified)) {
      if (group.present >= DEPENDENCY_ROWS_IN_GROUPS_OF) rowsInGroups += group.present;
      if (group.present >= DEPENDENCY_AGREEMENT_IN_GROUPS_OF) {
        compared += group.present;
        agreeing += group.majorityCount;
      }
    }
    if (rowsInGroups < DEPENDENCY_MIN_ROWS) {
      reject('dependency', summary, `${rowsInGroups} rows are in groups of ${DEPENDENCY_ROWS_IN_GROUPS_OF} or more; ${DEPENDENCY_MIN_ROWS} are needed`);
      continue;
    }
    const agreement = compared === 0 ? 0 : agreeing / compared;
    if (agreement < DEPENDENCY_MIN_AGREEMENT) {
      reject('dependency', summary, `${percent(agreement)} of the rows agree with their group; ${percent(DEPENDENCY_MIN_AGREEMENT)} are needed`);
      continue;
    }
    verified.dependencies.push({
      determinant: rule.determinant,
      dependent: rule.dependent,
      reason: rule.reason,
      support: `${agreeing} of ${compared} rows (${percent(agreement)}) have the most common ${rule.dependent} for their ${rule.determinant}; ${rowsInGroups} rows are in groups of ${DEPENDENCY_ROWS_IN_GROUPS_OF} or more`,
    });
  }

  return verified;
}
