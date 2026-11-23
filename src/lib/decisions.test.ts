import { expect, it } from 'vitest';
import { analyze } from '../core/analyze';
import { inventory } from '../core/testing';
import type { Decisions } from '../core/types';
import {
  NO_FILTERS,
  countByType,
  countStatuses,
  decide,
  decideMany,
  matchesFilters,
  pendingHighConfidenceFixes,
  pendingTargets,
  removedRows,
  sameDecisions,
  statusOf,
} from './decisions';

const { issues } = analyze(inventory());
const withFix = issues.filter((issue) => issue.fix !== undefined);
const flags = issues.filter((issue) => issue.fix === undefined);

it('the test data has fixes and flags', () => {
  expect(withFix.length).toBeGreaterThan(2);
  expect(flags.length).toBeGreaterThan(1);
});

it('a decision returns a new object and leaves the old one as it was', () => {
  const before: Decisions = {};
  const after = decide(before, issues[0].id, 'accepted');
  expect(before).toEqual({});
  expect(after).toEqual({ [issues[0].id]: 'accepted' });
  expect(statusOf(after, issues[0])).toBe('accepted');
});

it('a decision can be taken back to pending', () => {
  const accepted = decide({}, issues[0].id, 'accepted');
  const back = decide(accepted, issues[0].id, null);
  expect(back).toEqual({});
  expect(accepted).toEqual({ [issues[0].id]: 'accepted' });
  expect(statusOf(back, issues[0])).toBe('pending');
});

it('one decision for many issues keeps the decisions of the others', () => {
  const first = decide({}, issues[0].id, 'rejected');
  const ids = [issues[1].id, issues[2].id];
  expect(decideMany(first, ids, 'accepted')).toEqual({
    [issues[0].id]: 'rejected',
    [issues[1].id]: 'accepted',
    [issues[2].id]: 'accepted',
  });
  expect(first).toEqual({ [issues[0].id]: 'rejected' });
});

it('counts run over the issues, not over the decisions', () => {
  const decisions: Decisions = {
    [issues[0].id]: 'accepted',
    [issues[1].id]: 'rejected',
    'an-issue-that-no-longer-exists': 'accepted',
  };
  expect(countStatuses(issues, decisions)).toEqual({ accepted: 1, rejected: 1, pending: issues.length - 2 });
});

it('the counts by type add up to the total', () => {
  const decisions = decideMany({}, withFix.map((issue) => issue.id), 'accepted');
  const byType = Object.values(countByType(issues, decisions));
  const sum = (key: 'pending' | 'accepted' | 'rejected') => byType.reduce((total, counts) => total + counts[key], 0);
  expect(sum('accepted')).toBe(withFix.length);
  expect(sum('rejected')).toBe(0);
  expect(sum('pending')).toBe(issues.length - withFix.length);
});

it('each filter narrows the issues by its own field', () => {
  const [issue] = withFix;
  expect(matchesFilters(issue, NO_FILTERS, {})).toBe(true);
  expect(matchesFilters(issue, { ...NO_FILTERS, type: issue.type }, {})).toBe(true);
  expect(issues.filter((each) => matchesFilters(each, { ...NO_FILTERS, type: 'duplicate' }, {}))).toEqual(
    issues.filter((each) => each.type === 'duplicate'),
  );
  expect(issues.filter((each) => matchesFilters(each, { ...NO_FILTERS, confidence: 'low' }, {}))).toEqual(
    issues.filter((each) => each.confidence === 'low'),
  );
  expect(issues.filter((each) => matchesFilters(each, { ...NO_FILTERS, source: 'ai' }, {}))).toEqual([]);

  const decisions = decide({}, issue.id, 'accepted');
  expect(issues.filter((each) => matchesFilters(each, { ...NO_FILTERS, status: 'accepted' }, decisions))).toEqual([
    issue,
  ]);
  expect(matchesFilters(issue, { ...NO_FILTERS, status: 'pending' }, decisions)).toBe(false);
});

it('a bulk action reaches pending issues only, and keeps fixes and flags apart', () => {
  const all = pendingTargets(issues, {});
  expect(all.fixes).toEqual(withFix);
  expect(all.flags).toEqual(flags);

  const decisions: Decisions = { [withFix[0].id]: 'rejected', [flags[0].id]: 'accepted' };
  const rest = pendingTargets(issues, decisions);
  expect(rest.fixes).toEqual(withFix.slice(1));
  expect(rest.flags).toEqual(flags.slice(1));
});

it('accept all high-confidence fixes reaches pending fixes of high confidence, and no flag', () => {
  const sure = withFix.filter((issue) => issue.confidence === 'high');
  expect(sure.length).toBeGreaterThan(1);
  expect(sure.length).toBeLessThan(withFix.length);
  expect(flags.some((issue) => issue.confidence === 'high')).toBe(true);
  expect(pendingHighConfidenceFixes(issues, {})).toEqual(sure);

  // A decision made by hand, either way, takes the issue out of the bulk action.
  const decisions: Decisions = { [sure[0].id]: 'rejected', [sure[1].id]: 'accepted' };
  expect(pendingHighConfidenceFixes(issues, decisions)).toEqual(sure.slice(2));
  // Only the issues given: the page passes the ones the filters show.
  expect(pendingHighConfidenceFixes(sure.slice(0, 1), {})).toEqual(sure.slice(0, 1));
});

it('lists the rows that accepted duplicate fixes remove, with the row kept instead', () => {
  const duplicates = issues.filter((issue) => issue.fix?.kind === 'delete-row');
  expect(duplicates.length).toBeGreaterThan(1);
  expect(removedRows(issues, {})).toEqual(new Map());
  expect(removedRows(issues, { [duplicates[0].id]: 'rejected' })).toEqual(new Map());

  const [first, second] = duplicates.map((issue) => {
    if (issue.fix?.kind !== 'delete-row') throw new Error('not a duplicate');
    return issue.fix;
  });
  expect(removedRows(issues, { [duplicates[0].id]: 'accepted' })).toEqual(new Map([[first.rowId, first.keepRowId]]));
  expect(removedRows(issues, { [duplicates[0].id]: 'accepted', [duplicates[1].id]: 'accepted' })).toEqual(
    new Map([
      [first.rowId, first.keepRowId],
      [second.rowId, second.keepRowId],
    ]),
  );
});

it('two sets of decisions are the same when every issue has the same status', () => {
  const a = decide({}, issues[0].id, 'accepted');
  expect(sameDecisions(a, { ...a }, issues)).toBe(true);
  expect(sameDecisions(a, {}, issues)).toBe(false);
  expect(sameDecisions(a, decide(a, issues[1].id, 'rejected'), issues)).toBe(false);
  // Taking a decision back gives the same result as never having made it.
  expect(sameDecisions({}, decide(a, issues[0].id, null), issues)).toBe(true);
});
