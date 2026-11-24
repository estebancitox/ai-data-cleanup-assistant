import { expect, it } from 'vitest';
import { analyze } from '../core/analyze';
import { verifyContract } from '../core/contract';
import { nursery, nurseryContract } from '../core/testing';
import type { Analysis, Dataset, Issue } from '../core/types';
import { carryDecided } from './carry';

/** The nursery with one more row, an exact copy of row 5, so that the rules report a pair of rows. */
function stock(): Dataset {
  const dataset = nursery();
  dataset.rows.push({ id: dataset.rows.length + 1, cells: { ...dataset.rows[4].cells } });
  return dataset;
}

const rules = analyze(stock());
const withContract = () => analyze(stock(), verifyContract(nurseryContract(), stock()));
const both = withContract();

const ids = (analysis: Analysis) => analysis.issues.map((issue) => issue.id);
const on = (analysis: Analysis, row: number, column: string): Issue => {
  const found = analysis.issues.filter((issue) => issue.rowIds[0] === row && issue.column === column);
  if (found.length !== 1) throw new Error(`${found.length} issues on row ${row}, ${column}`);
  return found[0];
};
const swapped = (analysis: Analysis, out: Issue, back: Issue) => ids(analysis).map((id) => (id === out.id ? back.id : id));

// Row 38: the rules empty a placeholder; the contract fills the cell from the species instead.
const placeholder = on(rules, 38, 'genus');
const dependency = on(both, 38, 'genus');

it('the fixtures hold the case: the contract takes a cell from a rule issue', () => {
  expect([placeholder.detector, placeholder.fix]).toEqual(['placeholder', { kind: 'set-cell', rowId: 38, column: 'genus', to: '' }]);
  expect([dependency.detector, dependency.source]).toEqual(['dependency', 'ai']);
  expect(ids(both)).not.toContain(placeholder.id);
});

it('returns the next analysis itself when every decided issue is in it', () => {
  const stays = rules.issues.find((issue) => ids(both).includes(issue.id) && issue.column !== undefined);
  if (!stays) throw new Error('no rule issue keeps its id');
  expect(carryDecided(rules, both, { [stays.id]: 'accepted' })).toBe(both);
  expect(carryDecided(rules, both, {})).toBe(both);
});

it('carries a decided issue whose id was replaced on the same cell, and leaves the replacement out', () => {
  for (const decision of ['accepted', 'rejected'] as const) {
    const result = carryDecided(rules, both, { [placeholder.id]: decision });
    expect(on(result, 38, 'genus')).toBe(placeholder);
    // Everything else is the next analysis, in its order, with its profile and contract.
    expect(ids(result)).toEqual(swapped(both, dependency, placeholder));
    expect(result.contract).toBe(both.contract);
    expect(result.profile).toBe(both.profile);
  }
  // The inputs are not touched.
  expect(ids(both)).toContain(dependency.id);
});

it('carries a decided flag the same way', () => {
  const outlier = on(rules, 36, 'height_cm');
  const range = on(both, 36, 'height_cm');
  expect([outlier.fix, range.fix, outlier.id === range.id]).toEqual([undefined, undefined, false]);
  const result = carryDecided(rules, both, { [outlier.id]: 'rejected' });
  expect(ids(result)).toEqual(swapped(both, range, outlier));
});

it('lets the next snapshot replace an issue whose decision was undone', () => {
  const first = carryDecided(rules, both, { [placeholder.id]: 'accepted' });
  const next = withContract();
  // The user returned the issue to pending before the snapshot arrived.
  expect(carryDecided(first, next, {})).toBe(next);
  expect(on(next, 38, 'genus').id).toBe(dependency.id);
});

it('carries the issue again when two snapshots in a row lack it', () => {
  const decisions = { [placeholder.id]: 'accepted' } as const;
  const first = carryDecided(rules, both, decisions);
  const second = carryDecided(first, withContract(), decisions);
  const third = carryDecided(second, withContract(), decisions);
  for (const result of [second, third]) {
    expect(on(result, 38, 'genus')).toBe(placeholder);
    expect(ids(result)).toEqual(ids(first));
  }
});

it('carries a decided row removal, and leaves out a new removal of the same row', () => {
  const pair = rules.issues.find((issue) => issue.fix?.kind === 'delete-row');
  if (pair?.fix?.kind !== 'delete-row') throw new Error('no pair of rows');
  // No snapshot of the pipeline drops a row issue, so the next analysis is built by hand:
  // the same row is removed in favour of another row.
  const other: Issue = { ...pair, id: 'made-up', rowIds: [6, pair.fix.rowId], fix: { ...pair.fix, keepRowId: 6 } };
  const next: Analysis = { ...both, issues: both.issues.map((issue) => (issue.id === pair.id ? other : issue)) };

  const result = carryDecided(rules, next, { [pair.id]: 'accepted' });
  expect(ids(result)).toContain(pair.id);
  expect(ids(result)).not.toContain(other.id);
  expect(result.issues).toHaveLength(next.issues.length);
});

it('puts a carried issue that nothing replaced where the order of the analysis has it', () => {
  // Row 32: the contract fills an empty cell. The next analysis has nothing for that cell.
  const filled = on(both, 32, 'genus');
  const before = on(rules, 32, 'genus');
  const next: Analysis = { ...rules, issues: rules.issues.filter((issue) => issue !== before) };

  const result = carryDecided(both, next, { [filled.id]: 'accepted' });
  expect(ids(result)).toEqual(swapped(rules, before, filled));
});
