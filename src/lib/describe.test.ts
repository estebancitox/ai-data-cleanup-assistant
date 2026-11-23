import { expect, it } from 'vitest';
import type { Issue, IssueGroup } from '../core/types';
import { actionWords, bulkWord, describeGroup, issueLabel, modeLine, plural, statusLabel } from './describe';

const group = (detector: string, extra: Partial<IssueGroup> = {}): IssueGroup => ({
  id: detector,
  type: 'inconsistent',
  detector,
  source: 'rule',
  column: 'supplier',
  confidence: 'high',
  issues: [],
  ...extra,
});

// The detector ids of SPEC §5.4 (rules) and §5.5 (driven by the contract).
const DETECTORS = [
  'exact-duplicate',
  'near-duplicate',
  'empty',
  'placeholder',
  'whitespace',
  'case-variant',
  'number-format',
  'date-format',
  'shape',
  'outlier',
  'canonical-value',
  'dependency',
  'range',
  'format',
  'flagged-value',
];

it('every detector of the SPEC has a title and a reason of its own', () => {
  const titles = new Set<string>();
  for (const detector of DETECTORS) {
    const text = describeGroup(group(detector, { target: 'Northwind Cycles' }));
    // Not the fallback, which is the detector id followed by the column.
    expect(text.title, detector).not.toBe(`${detector} in supplier`);
    expect(text.title.length, detector).toBeGreaterThan(10);
    expect(text.reason.length, detector).toBeGreaterThan(30);
    titles.add(text.title);
  }
  expect(titles.size).toBe(DETECTORS.length);
});

it('a detector that gives two types has a text for each', () => {
  for (const [detector, other] of [
    ['date-format', 'suspicious'],
    ['dependency', 'missing'],
  ] as const) {
    const usual = describeGroup(group(detector));
    const second = describeGroup(group(detector, { type: other }));
    expect(second.title).not.toBe(usual.title);
    expect(second.reason).not.toBe(usual.reason);
  }
});

it('a placeholder found by a rule and one named by the contract have different titles', () => {
  expect(describeGroup(group('placeholder', { source: 'ai' })).title).not.toBe(
    describeGroup(group('placeholder')).title,
  );
});

it('titles name the column and the value the group writes', () => {
  expect(describeGroup(group('whitespace')).title).toBe('Extra spaces in supplier');
  expect(describeGroup(group('case-variant', { target: 'Northwind Cycles' })).title).toBe(
    '"Northwind Cycles" written differently in supplier',
  );
});

const issue = (extra: Partial<Issue>): Issue => ({
  id: 'an-id',
  type: 'inconsistent',
  detector: 'whitespace',
  source: 'rule',
  rowIds: [29],
  column: 'category',
  current: ' Wheels',
  reason: 'This value has extra spaces around or inside it.',
  confidence: 'high',
  ...extra,
});

it('a detector the table does not know falls back to its id and the reason of its first issue', () => {
  const unknown = group('formula', { issues: [issue({ detector: 'formula', reason: 'A spreadsheet may run this.' })] });
  expect(describeGroup(unknown)).toEqual({ title: 'formula in supplier', reason: 'A spreadsheet may run this.' });
});

it('names an issue by its row and column, or by what its removal does', () => {
  expect(issueLabel(issue({}))).toBe('row 29, category');
  expect(
    issueLabel(
      issue({ rowIds: [3, 25], column: undefined, current: undefined, fix: { kind: 'delete-row', rowId: 25, keepRowId: 3 } }),
    ),
  ).toBe('remove row 25, keep row 3');
  expect(issueLabel(issue({ rowIds: [3, 25], column: undefined }))).toBe('rows 3 and 25');
});

it('a fix is accepted or rejected; a flag is confirmed or dismissed', () => {
  const fix = issue({ fix: { kind: 'set-cell', rowId: 29, column: 'category', to: 'Wheels' } });
  const flag = issue({ detector: 'outlier' });
  expect(actionWords(fix)).toEqual({ accept: 'Accept', reject: 'Reject', noun: 'fix' });
  expect(actionWords(flag)).toEqual({ accept: 'Confirm', reject: 'Dismiss', noun: 'flag' });
  expect([statusLabel(fix, 'pending'), statusLabel(fix, 'accepted'), statusLabel(fix, 'rejected')]).toEqual([
    'Pending',
    'Accepted',
    'Rejected',
  ]);
  expect([statusLabel(flag, 'pending'), statusLabel(flag, 'accepted'), statusLabel(flag, 'rejected')]).toEqual([
    'Pending',
    'Confirmed',
    'Dismissed',
  ]);
});

it('counts in words', () => {
  expect(plural(1, 'issue')).toBe('1 issue');
  expect(plural(0, 'issue')).toBe('0 issues');
  expect(plural(50000, 'row')).toBe('50,000 rows');
});

it('two groups of one column that write different values never share a title', () => {
  for (const type of ['inconsistent', 'missing'] as const) {
    const titles = ['Leeds', 'York'].map((target) => describeGroup(group('dependency', { type, source: 'ai', target })).title);
    expect(titles[0]).toContain('"Leeds"');
    expect(titles[0]).not.toBe(titles[1]);
  }
});

it('a bulk action on flags is reported in the words of its buttons', () => {
  expect(bulkWord('accepted', true)).toBe('confirmed');
  expect(bulkWord('rejected', true)).toBe('dismissed');
  expect(bulkWord('accepted', false)).toBe('accepted');
  expect(bulkWord('rejected', false)).toBe('rejected');
});

it('the mode line names the model, and the date for a recording', () => {
  expect(modeLine({ mode: 'checking', model: null })).toBe('Checking for AI');
  expect(modeLine({ mode: 'off', model: null })).toBe('AI off');
  expect(modeLine({ mode: 'live', model: 'a-model' })).toBe('AI live · a-model');
  expect(modeLine({ mode: 'recorded', model: 'a-model', recordedAt: '2026-01-02T03:04:05.000Z' })).toBe(
    'Recorded AI analysis · a-model · recorded 2026-01-02 03:04 UTC',
  );
});
