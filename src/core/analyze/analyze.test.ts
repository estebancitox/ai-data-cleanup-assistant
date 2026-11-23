import { describe, expect, it } from 'vitest';
import { profileDataset } from '../profile';
import { inventory, table } from '../testing';
import type { Dataset, Issue } from '../types';
import { detectOutliers } from './detectors/outlier';
import { analyze, groupIssues } from './index';
import { onePerCell, type Candidate } from './precedence';

const issuesOf = (dataset: Dataset, detector: string): Issue[] =>
  analyze(dataset).issues.filter((issue) => issue.detector === detector);
const cellIssuesOf = (dataset: Dataset): Issue[] => analyze(dataset).issues.filter((issue) => issue.column !== undefined);
const single = (name: string, values: string[]) => table([name], values.map((value) => [value]));
const steady = (count: number) => Array.from({ length: count }, (_, i) => String(100 + i * 5));
const proposed = (issue: Issue) => (issue.fix?.kind === 'set-cell' ? issue.fix.to : null);

const MEMBERS = [
  ['1', 'Ada Lovelace', 'ada@lib.example', 'Leeds'],
  ['2', 'Grace Hopper', 'grace@lib.example', 'York'],
  ['3', 'Alan Turing', 'alan@lib.example', 'Bath'],
  ['4', 'Edsger Dijkstra', 'edsger@lib.example', 'Hull'],
];
const members = (...extra: string[][]) => table(['member_id', 'full_name', 'email', 'town'], [...MEMBERS, ...extra]);

describe('R1 exact-duplicate', () => {
  it('pairs every later copy with the first row, comparing trimmed values', () => {
    const dataset = table(['name', 'price'], [['hub', '5'], ['rail', '7'], ['hub ', ' 5'], ['hub', '5']]);
    const issues = issuesOf(dataset, 'exact-duplicate');
    expect(issues.map((issue) => issue.rowIds)).toEqual([[1, 3], [1, 4]]);
    expect(issues[0]).toMatchObject({
      type: 'duplicate',
      confidence: 'high',
      fix: { kind: 'delete-row', rowId: 3, keepRowId: 1 },
    });
  });
});

describe('R2 near-duplicate', () => {
  it('reports a pair at or above the threshold and keeps the lower row id on a tie', () => {
    const issues = issuesOf(members(['5', 'Ada Lovelace', 'ada@lib.example', 'Leedz']), 'near-duplicate');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'duplicate',
      rowIds: [1, 5],
      confidence: 'low',
      fix: { kind: 'delete-row', rowId: 5, keepRowId: 1 },
    });
  });

  it('keeps the more complete row', () => {
    const dataset = members(['5', 'Ada Lovelace', 'ada@lib.example', 'Leeds']);
    dataset.rows[0].cells.town = '';
    const [issue] = issuesOf(dataset, 'near-duplicate');
    expect(issue.fix).toEqual({ kind: 'delete-row', rowId: 1, keepRowId: 5 });
  });

  it('does not report rows that differ clearly', () => {
    expect(issuesOf(members(['5', 'Ada Byron', 'byron@club.example', 'Derby']), 'near-duplicate')).toEqual([]);
  });

  it('leaves exact duplicates to R1', () => {
    const dataset = members(['1', 'Ada Lovelace', 'ada@lib.example', 'Leeds']);
    expect(issuesOf(dataset, 'near-duplicate')).toEqual([]);
    expect(issuesOf(dataset, 'exact-duplicate')).toHaveLength(1);
  });

  it('skips a pair that would delete a kept row', () => {
    const copy = (id: string) => [id, 'Ada Lovelace', 'ada@lib.example', 'Leeds'];
    const issues = issuesOf(members(copy('5'), copy('6')), 'near-duplicate');
    expect(issues.map((issue) => issue.fix)).toEqual([
      { kind: 'delete-row', rowId: 5, keepRowId: 1 },
      { kind: 'delete-row', rowId: 6, keepRowId: 1 },
    ]);
  });
});

describe('R3 empty and placeholder', () => {
  it('flags an empty cell without a fix', () => {
    const [issue] = issuesOf(single('name', ['hub', '', 'rail']), 'empty');
    expect(issue).toMatchObject({ type: 'missing', rowIds: [2], column: 'name', confidence: 'high' });
    expect(issue.fix).toBeUndefined();
  });

  it('treats a cell of only whitespace as empty', () => {
    expect(issuesOf(single('name', ['hub', '   ']), 'empty').map((issue) => issue.rowIds)).toEqual([[2]]);
  });

  it('proposes to clear a strict placeholder in any column', () => {
    const [issue] = issuesOf(single('name', ['hub', 'N/A']), 'placeholder');
    expect(issue).toMatchObject({ type: 'missing', current: 'N/A', confidence: 'high' });
    expect(issue.fix).toEqual({ kind: 'set-cell', rowId: 2, column: 'name', to: '' });
  });

  it('treats a soft placeholder as missing in a number column only', () => {
    const numbers = single('stock', [...steady(10), 'unknown']);
    expect(issuesOf(numbers, 'placeholder').map((issue) => issue.rowIds)).toEqual([[11]]);
    expect(issuesOf(single('finish', ['matte', 'gloss', 'unknown']), 'placeholder')).toEqual([]);
  });
});

describe('R4 whitespace and case-variant', () => {
  it('trims outer whitespace in any column, numbers included', () => {
    const dataset = table(['name', 'stock'], [['hub', '4'], [' rail', '7 '], ['chain', '9']]);
    const issues = issuesOf(dataset, 'whitespace');
    expect(issues.map((issue) => [issue.column, issue.fix])).toEqual([
      ['name', { kind: 'set-cell', rowId: 2, column: 'name', to: 'rail' }],
      ['stock', { kind: 'set-cell', rowId: 2, column: 'stock', to: '7' }],
    ]);
    expect(issues[0]).toMatchObject({ type: 'inconsistent', confidence: 'high' });
  });

  it('collapses repeated inner whitespace outside free text', () => {
    const [issue] = issuesOf(single('name', ['Alloy  hub', 'Steel rail']), 'whitespace');
    expect(issue.fix).toMatchObject({ to: 'Alloy hub' });
  });

  it('leaves inner whitespace alone in free text but still trims it', () => {
    const notes = Array.from({ length: 6 }, (_, i) => `Shelved in aisle ${i} after a full  inspection of the box.`);
    notes[2] = ` ${notes[2]}`;
    const issues = issuesOf(single('notes', notes), 'whitespace');
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toMatchObject({ rowId: 3, to: notes[2].trim() });
  });

  it('proposes the most frequent spelling of a categorical value in one composed fix', () => {
    const dataset = single('wood', ['Oak', 'Oak', 'OAK', 'oak ', 'Pine']);
    expect(issuesOf(dataset, 'case-variant').map((issue) => [issue.rowIds[0], proposed(issue)])).toEqual([
      [3, 'Oak'],
      [4, 'Oak'],
    ]);
    expect(cellIssuesOf(dataset)).toHaveLength(2);
  });

  it('keeps the spelling seen first on a tie', () => {
    const [issue] = issuesOf(single('colour', ['red', 'Red', 'blue', 'blue']), 'case-variant');
    expect(issue.fix).toMatchObject({ rowId: 2, to: 'red' });
  });

  it('does not compare spellings in a column that is not categorical', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Part ${i}`);
    expect(issuesOf(single('name', [...names, 'PART 7']), 'case-variant')).toEqual([]);
  });
});

describe('R5 number-format', () => {
  it('proposes the plain number, cut from the cell text', () => {
    const dataset = single('price', [...steady(12), '$1,250.00', '1 300', '€12.50', '007']);
    const issues = issuesOf(dataset, 'number-format');
    expect(issues.map(proposed)).toEqual(['1250.00', '1300', '12.50']);
    expect(issues[0]).toMatchObject({ type: 'inconsistent', confidence: 'high', current: '$1,250.00' });
  });

  it('does not touch text columns or values that are not numbers', () => {
    expect(issuesOf(single('label', ['$5', 'five', 'six']), 'number-format')).toEqual([]);
    expect(issuesOf(single('price', [...steady(12), '1,5']), 'number-format')).toEqual([]);
  });
});

describe('R6 date-format', () => {
  const iso = Array.from({ length: 16 }, (_, i) => `2024-01-${String(i + 10).padStart(2, '0')}`);
  const dates = (...others: string[]) => single('received', [...iso, ...others]);
  const found = (dataset: Dataset) =>
    issuesOf(dataset, 'date-format').map((issue) => [issue.rowIds[0], issue.type, proposed(issue), issue.confidence]);

  it('rewrites other formats into the dominant one', () => {
    expect(found(dates('Mar 5, 2024', '5 mar 2024', '2024/03/05', '03/25/2024'))).toEqual([
      [17, 'inconsistent', '2024-03-05', 'high'],
      [18, 'inconsistent', '2024-03-05', 'high'],
      [19, 'inconsistent', '2024-03-05', 'high'],
      [20, 'inconsistent', '2024-03-25', 'high'],
    ]);
  });

  it('writes into whichever format is dominant', () => {
    const slash = Array.from({ length: 16 }, (_, i) => `${i + 13}/01/2024`);
    expect(found(single('received', [...slash, '2024-03-05', 'Mar 6, 2024']))).toEqual([
      [17, 'inconsistent', '05/03/2024', 'high'],
      [18, 'inconsistent', '06/03/2024', 'high'],
    ]);
  });

  it('reads an ambiguous slash date in the order of the unambiguous ones, at medium confidence', () => {
    expect(found(dates('03/05/2024', '03/25/2024'))).toEqual([
      [17, 'inconsistent', '2024-03-05', 'medium'],
      [18, 'inconsistent', '2024-03-25', 'high'],
    ]);
    expect(found(dates('03/05/2024', '25/03/2024'))[0]).toEqual([17, 'inconsistent', '2024-05-03', 'medium']);
  });

  it('flags an ambiguous slash date without a fix when the column gives no single order', () => {
    expect(found(dates('03/05/2024'))).toEqual([[17, 'inconsistent', null, 'medium']]);
    expect(found(dates('03/05/2024', '03/25/2024', '25/03/2024'))).toEqual([
      [17, 'inconsistent', null, 'medium'],
      [18, 'inconsistent', '2024-03-25', 'high'],
      [19, 'inconsistent', '2024-03-25', 'high'],
    ]);
  });

  it('flags a date that does not exist as suspicious, without a fix', () => {
    expect(found(dates('2024-02-30', '31/31/2024', '2023-02-29', '2024-02-29'))).toEqual([
      [17, 'suspicious', null, 'high'],
      [18, 'suspicious', null, 'high'],
      [19, 'suspicious', null, 'high'],
    ]);
  });

  it('proposes nothing when no format covers 80% of the dates', () => {
    expect(found(single('received', ['2024-01-10', '2024-01-11', '01/15/2024', 'Jan 5, 2024', '5 Jan 2024']))).toEqual([]);
  });
});

describe('R7 shape', () => {
  const codes = Array.from({ length: 18 }, (_, i) => `AB-${10 + i}`);

  it('flags values with another shape when one shape covers 90% of the column', () => {
    const issues = issuesOf(single('code', [...codes, 'AB12', 'ab-123']), 'shape');
    expect(issues.map((issue) => issue.rowIds[0])).toEqual([19, 20]);
    expect(issues[0]).toMatchObject({ type: 'inconsistent', confidence: 'low', current: 'AB12' });
    expect(issues[0].fix).toBeUndefined();
  });

  it('does nothing when no shape reaches 90%', () => {
    expect(issuesOf(single('code', [...codes, 'AB12', 'ab-123', 'x']), 'shape')).toEqual([]);
  });
});

describe('R8 outlier', () => {
  const outliers = (values: string[], name = 'weight') => {
    const dataset = single(name, values);
    return detectOutliers(dataset, profileDataset(dataset));
  };
  const flagged = (values: string[], name?: string) => outliers(values, name).map((issue) => issue.current);

  it('needs at least 20 numbers', () => {
    expect(flagged([...steady(18), '99999'])).toEqual([]);
    expect(flagged([...steady(19), '99999'])).toEqual(['99999']);
  });

  it('flags values outside the fences on the raw scale, without a fix', () => {
    const [issue] = outliers([...steady(24), '99999']);
    expect(issue).toMatchObject({ type: 'suspicious', detector: 'outlier', confidence: 'low', rowIds: [25] });
    expect(issue.fix).toBeUndefined();
  });

  it('flags a positive value outside the fences on the log scale', () => {
    expect(flagged([...steady(24), '0.5'])).toEqual(['0.5']);
  });

  it('flags zero or negative values only where 95% of the numbers are positive', () => {
    expect(flagged([...steady(24), '0'])).toEqual(['0']);
    expect(flagged([...steady(24), '0', '-3', '-4'])).toEqual([]);
  });

  it('skips a scale on which more than 5% of the numbers are outside the fences', () => {
    // 400 and 450 are outside the raw fences and inside the log fences; 0.5 is the reverse.
    // Two of 27 numbers is more than 5%, so the raw scale is skipped and only 0.5 is flagged.
    expect(flagged([...steady(24), '400', '450', '0.5'])).toEqual(['0.5']);
    // Two groups of values, far apart on both scales: neither group is an anomaly.
    expect(flagged([...steady(24), '5000', '5005', '5010'])).toEqual([]);
  });

  it('still flags a single extreme value', () => {
    expect(flagged([...steady(24), '400'])).toEqual(['400']);
    // One of 20 numbers is exactly 5%, which is not more than 5%.
    expect(flagged([...steady(19), '400'])).toEqual(['400']);
  });

  it('skips a scale with no spread and identifier-like columns', () => {
    expect(flagged([...Array.from({ length: 24 }, () => '10'), '500'])).toEqual([]);
    expect(flagged([...steady(24), '99999'], 'order_id')).toEqual([]);
  });
});

describe('precedence', () => {
  it('gives a cell to the first detector in the order R3, R5, R6, R4, R7, R8', () => {
    // 60 steady prices, so that the three extreme values stay under 5% of the column (R8).
    const prices = single('price', [...steady(60), ' $99,999 ', ' n/a ', ' 150', '99999', '999']);
    expect(cellIssuesOf(prices).map((issue) => [issue.rowIds[0], issue.detector, proposed(issue)])).toEqual([
      [61, 'number-format', '99999'],
      [62, 'placeholder', ''],
      [63, 'whitespace', '150'],
      [64, 'shape', null],
      [65, 'outlier', null],
    ]);

    const iso = Array.from({ length: 18 }, (_, i) => `2024-01-${String(i + 10).padStart(2, '0')}`);
    const dates = single('received', [...iso, ' Mar 5, 2024 ', ' 2024-01-05']);
    expect(cellIssuesOf(dates).map((issue) => [issue.rowIds[0], issue.detector, proposed(issue)])).toEqual([
      [19, 'date-format', '2024-03-05'],
      [20, 'whitespace', '2024-01-05'],
    ]);
  });

  it('lets an issue with a fix replace a flag-only issue on the same cell', () => {
    const cell: Omit<Candidate, 'detector'> = { type: 'suspicious', source: 'rule', rowIds: [1], column: 'a', reason: '', confidence: 'low' };
    const flag: Candidate = { ...cell, detector: 'first' };
    const fix: Candidate = { ...cell, detector: 'second', fix: { kind: 'set-cell', rowId: 1, column: 'a', to: 'x' } };
    const laterFlag: Candidate = { ...cell, detector: 'third' };
    expect(onePerCell([[flag], [fix], [laterFlag]]).map((issue) => issue.detector)).toEqual(['second']);
    expect(onePerCell([[flag], [laterFlag]]).map((issue) => issue.detector)).toEqual(['first']);
  });
});

describe('issue ids', () => {
  it('are unique within an analysis', () => {
    const ids = analyze(inventory()).issues.map((issue) => issue.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stay the same for the same fix and change when the fix changes', () => {
    const variant = (values: string[]) =>
      issuesOf(single('wood', values), 'case-variant').find((issue) => issue.rowIds[0] === 3);
    const toOak = variant(['Oak', 'Oak', 'oak', 'Pine']);
    const toOakAgain = variant(['Oak', 'Oak', 'oak', 'Pine', 'Oak']);
    const toUpper = variant(['OAK', 'OAK', 'oak', 'Pine']);
    expect(toOak?.fix).toMatchObject({ to: 'Oak' });
    expect(toOakAgain?.id).toBe(toOak?.id);
    expect(toUpper?.fix).toMatchObject({ to: 'OAK' });
    expect(toUpper?.id).not.toBe(toOak?.id);
  });
});

describe('groupIssues', () => {
  it('groups shared-value fixes by target and per-cell reformatting by column', () => {
    const dataset = table(
      ['wood', 'price'],
      [
        ...Array.from({ length: 12 }, (_, i) => [i % 2 ? 'Oak' : 'Pine', String(100 + i)]),
        ['OAK', '$1,100'],
        ['oak', '$1,200'],
        ['PINE', '120'],
      ],
    );
    const groups = groupIssues(cellIssuesOf(dataset));
    expect(groups.map((group) => [group.detector, group.column, group.target, group.issues.length])).toEqual([
      ['case-variant', 'wood', 'Oak', 2],
      ['number-format', 'price', undefined, 2],
      ['case-variant', 'wood', 'Pine', 1],
    ]);
  });

  it('reports the lowest confidence of the group', () => {
    const issue = (id: string, confidence: Issue['confidence']): Issue => ({
      id, type: 'suspicious', detector: 'outlier', source: 'rule', rowIds: [1], column: 'a', reason: '', confidence,
    });
    expect(groupIssues([issue('1', 'high'), issue('2', 'low')])[0].confidence).toBe('low');
  });
});
