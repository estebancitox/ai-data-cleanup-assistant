// The invariants of SPEC §4.4 that involve a contract. The test names are the contract.

import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { applyDecisions } from './apply';
import { verifyContract } from './contract';
import { comparisonKey } from './profile';
import { META, nursery, nurseryContract } from './testing';
import type { Dataset, Decisions, Issue } from './types';

/** The nursery with one more row, an exact copy of row 5, so that the rules report a pair of rows. */
function stock(): Dataset {
  const dataset = nursery();
  dataset.rows.push({ id: dataset.rows.length + 1, cells: { ...dataset.rows[4].cells } });
  return dataset;
}
const verified = () => verifyContract(nurseryContract(), stock());
const cell = (issue: Issue) => `${issue.rowIds[0]}|${issue.column}`;

it('issue ids are stable', () => {
  const dataset = stock();
  const rules = analyze(dataset).issues;
  const both = analyze(dataset, verifyContract(nurseryContract(), dataset)).issues;
  const ids = new Set(both.map((issue) => issue.id));
  const takenByContract = new Set(both.filter((issue) => issue.source === 'ai' && issue.column !== undefined).map(cell));

  const kept = rules.filter((issue) => ids.has(issue.id));
  const replaced = rules.filter((issue) => !ids.has(issue.id));
  // Every rule issue that is gone lost its cell to an issue the contract drives.
  expect(replaced.filter((issue) => issue.column === undefined || !takenByContract.has(cell(issue)))).toEqual([]);
  // Guard: the data must exercise both outcomes, and the contract must add issues of its own.
  expect(replaced.map((issue) => [issue.rowIds[0], issue.detector])).toEqual([[32, 'empty'], [36, 'outlier'], [38, 'placeholder']]);
  expect(kept.map((issue) => [issue.rowIds[0], issue.detector])).toEqual([[5, 'exact-duplicate'], [34, 'case-variant']]);
  expect(both.length).toBeGreaterThan(rules.length);
  // An issue that kept its id is the same issue: decisions made on it stay valid.
  for (const issue of kept) expect(both.find((other) => other.id === issue.id)).toEqual(issue);
});

describe('with a contract', () => {
  it('original dataset is never mutated', () => {
    const dataset = stock();
    const before = structuredClone(dataset);
    const contract = verifyContract(nurseryContract(), dataset);
    const analysis = analyze(dataset, contract);
    expect(dataset).toEqual(before);
    const all: Decisions = Object.fromEntries(analysis.issues.map((issue) => [issue.id, 'accepted']));
    applyDecisions(dataset, analysis, all, META);
    expect(dataset).toEqual(before);
  });

  it('at most one issue per cell', () => {
    const cellIssues = analyze(stock(), verified()).issues.filter((issue) => issue.column !== undefined);
    // Guard: every detector the contract drives took part, next to a rule detector.
    expect(new Set(cellIssues.map((issue) => issue.detector))).toEqual(
      new Set(['dependency', 'canonical-value', 'placeholder', 'flagged-value', 'range', 'case-variant']),
    );
    const cells = cellIssues.map(cell);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('a kept row is never deleted', () => {
    const issues = analyze(stock(), verified()).issues;
    const fixes = issues.flatMap((issue) => (issue.fix?.kind === 'delete-row' ? [issue.fix] : []));
    const deleted = fixes.map((fix) => fix.rowId);
    expect(new Set(deleted).size).toBe(deleted.length);
    expect(fixes.filter((fix) => deleted.includes(fix.keepRowId))).toEqual([]);
    // The contract adds no row-level issue: the pairs are the ones the rules report.
    const pairs = issues.filter((issue) => issue.column === undefined);
    expect(pairs.map((issue) => [issue.detector, issue.rowIds])).toEqual([['exact-duplicate', [5, 39]]]);
    expect(pairs).toEqual(analyze(stock()).issues.filter((issue) => issue.column === undefined));
  });

  it('analysis is deterministic', () => {
    const first = analyze(stock(), verified());
    expect(first.issues.some((issue) => issue.source === 'ai')).toBe(true);
    expect(analyze(stock(), verified())).toEqual(first);
    expect(verified()).toEqual(first.contract);
  });

  it('fixes never invent values', () => {
    const dataset = stock();
    const fixes = analyze(dataset, verifyContract(nurseryContract(), dataset)).issues.flatMap((issue) =>
      issue.fix?.kind === 'set-cell' ? [{ fix: issue.fix, current: issue.current ?? '', source: issue.source }] : [],
    );
    expect(fixes.filter((entry) => entry.source === 'ai').length).toBeGreaterThanOrEqual(5);
    for (const { fix, current } of fixes) {
      const inColumn = dataset.rows.some((row) => row.cells[fix.column] === fix.to);
      const sameText = comparisonKey(fix.to) === comparisonKey(current);
      expect(fix.to === '' || inColumn || sameText, `${fix.column}: "${current}" -> "${fix.to}"`).toBe(true);
    }
  });
});
