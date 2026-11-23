// The invariants of SPEC §4.4 that hold without a contract. The test names are the contract.

import { expect, it } from 'vitest';
import { analyze } from './analyze';
import { applyDecisions } from './apply';
import { parseCsv, serializeCsv } from './csv';
import { comparisonKey, readDate, readNumber } from './profile';
import { inventory, META, table } from './testing';
import type { Decisions } from './types';

const acceptAll = (ids: string[]): Decisions => Object.fromEntries(ids.map((id) => [id, 'accepted']));

it('original dataset is never mutated', () => {
  const dataset = inventory();
  const before = structuredClone(dataset);
  const analysis = analyze(dataset);
  expect(dataset).toEqual(before);
  applyDecisions(dataset, analysis, acceptAll(analysis.issues.map((issue) => issue.id)), META);
  expect(dataset).toEqual(before);
});

it('no decisions means no changes', () => {
  const dataset = inventory();
  const analysis = analyze(dataset);
  expect(applyDecisions(dataset, analysis, {}, META).cleaned).toEqual(dataset);
  const allRejected: Decisions = Object.fromEntries(analysis.issues.map((issue) => [issue.id, 'rejected']));
  expect(applyDecisions(dataset, analysis, allRejected, META).cleaned).toEqual(dataset);
});

it('at most one issue per cell', () => {
  const cellIssues = analyze(inventory()).issues.filter((issue) => issue.column !== undefined);
  const cells = cellIssues.map((issue) => `${issue.rowIds[0]}|${issue.column}`);
  // Guard: the data must exercise every cell detector, or the check proves nothing.
  expect(new Set(cellIssues.map((issue) => issue.detector))).toEqual(
    new Set(['empty', 'placeholder', 'number-format', 'date-format', 'whitespace', 'case-variant', 'shape', 'outlier']),
  );
  expect(new Set(cells).size).toBe(cells.length);
});

it('a kept row is never deleted', () => {
  const fixes = analyze(inventory()).issues.flatMap((issue) => (issue.fix?.kind === 'delete-row' ? [issue.fix] : []));
  const deleted = fixes.map((fix) => fix.rowId);
  // Guard: rows 5, 26 and 27 are three copies of one record, so one pair has to be skipped.
  expect(fixes.length).toBeGreaterThanOrEqual(3);
  expect(new Set(deleted).size).toBe(deleted.length);
  expect(fixes.filter((fix) => deleted.includes(fix.keepRowId))).toEqual([]);
});

it('csv round trip', () => {
  const awkward = table(
    ['name', 'note; with | delimiters', ' padded header '],
    [
      ['Chain, 9 speed', 'He said "tight"', ' leading and trailing '],
      ['two\nlines', 'tab\tinside', ''],
      ['', 'semi;colon and pipe|here', '\ttab first'],
      ['=SUM(A1)', '', "it's"],
    ],
    'awkward.csv',
  );
  for (const dataset of [awkward, inventory()]) {
    const again = parseCsv(serializeCsv(dataset), dataset.fileName);
    expect(again).toEqual({ ok: true, dataset, warnings: [] });
  }
});

it('analysis is deterministic', () => {
  const first = analyze(inventory());
  expect(first.issues.length).toBeGreaterThan(0);
  expect(analyze(inventory())).toEqual(first);
});

it('fixes never invent values', () => {
  const dataset = inventory();
  const fixes = analyze(dataset).issues.flatMap((issue) =>
    issue.fix?.kind === 'set-cell' ? [{ fix: issue.fix, current: issue.current ?? '' }] : [],
  );
  expect(fixes.length).toBeGreaterThanOrEqual(6);
  const day = (value: string) => {
    const date = readDate(value);
    return date && date.layout !== 'slash' ? `${date.year}-${date.first}-${date.second}` : null;
  };
  for (const { fix, current } of fixes) {
    const inColumn = dataset.rows.some((row) => row.cells[fix.column] === fix.to);
    const sameText = comparisonKey(fix.to) === comparisonKey(current);
    const sameNumber = readNumber(current) !== null && readNumber(fix.to) === readNumber(current);
    const sameDate = day(current) !== null && day(fix.to) === day(current);
    expect(fix.to === '' || inColumn || sameText || sameNumber || sameDate, `${fix.column}: "${current}" -> "${fix.to}"`).toBe(true);
  }
});
