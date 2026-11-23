import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { scoreCandidatePairs } from '../analyze/similarity';
import { verifyContract } from '../contract';
import { inventory, nursery, nurseryContract, table } from '../testing';
import type { Analysis, Issue, Verdict } from '../types';
import { AdjudicationRequestSchema, applyVerdicts, CASES_PER_REQUEST, CONCURRENT_REQUESTS, MAX_CASES, selectCases } from './index';

const stock = () => {
  const dataset = inventory();
  return { dataset, analysis: analyze(dataset) };
};
const issueOf = (analysis: Analysis, detector: string) => {
  const issue = analysis.issues.find((candidate) => candidate.detector === detector);
  if (!issue) throw new Error(`no ${detector} issue`);
  return issue;
};

describe('selectCases (SPEC 6.4)', () => {
  it('sends near-duplicate candidates with both rows in full, strongest first', () => {
    const { dataset, analysis } = stock();
    const cases = selectCases(dataset, analysis);
    const duplicates = cases.filter((entry) => entry.detector === 'near-duplicate');
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
    // Before any flagged value, and from the highest similarity down.
    expect(cases.slice(0, duplicates.length)).toEqual(duplicates);
    const similarity = new Map(scoreCandidatePairs(dataset, analysis.profile).map((pair) => [pair.rowIds.join('+'), pair.similarity]));
    const strengths = duplicates.map((entry) => similarity.get(entry.rows.map((row) => row.rowId).join('+')) ?? 0);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
    expect(strengths.every((value) => value >= 0.9)).toBe(true);

    const [first] = duplicates;
    const issue = analysis.issues.find((candidate) => candidate.id === first.issueId);
    expect(first.rows.map((row) => row.rowId)).toEqual(issue?.rowIds);
    for (const row of first.rows) expect(row.cells).toEqual(dataset.rows[row.rowId - 1].cells);
    expect(first.note).toContain('Similarity');
    expect(first.column).toBeUndefined();
  });

  it('sends a flagged number with its row in full and the numeric summary of its column', () => {
    const { dataset, analysis } = stock();
    const flagged = selectCases(dataset, analysis).filter((entry) => entry.detector === 'outlier');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ issueId: 'outlier:33:stock:flag', column: 'stock', current: '500' });
    expect(flagged[0].rows).toEqual([{ rowId: 33, cells: dataset.rows[32].cells }]);
    expect(flagged[0].numeric).toEqual(analysis.profile.columns.find((column) => column.name === 'stock')?.numeric);
  });

  it('sends the values a verified range flags, and nothing else the contract drives', () => {
    const dataset = nursery();
    const analysis = analyze(dataset, verifyContract(nurseryContract(), dataset));
    expect(selectCases(dataset, analysis).map((entry) => [entry.detector, entry.rows[0].rowId, entry.current])).toEqual([['range', 36, '4000']]);
  });

  it('orders flagged values from the one farthest from the middle of its column', () => {
    // Four digits everywhere, so that the two far values are outliers and not another shape.
    const values = [...Array.from({ length: 60 }, (_, i) => String(1000 + i)), '5000', '9000'];
    const dataset = table(['weight'], values.map((value) => [value]));
    const analysis = analyze(dataset);
    expect(analysis.issues.filter((issue) => issue.detector === 'outlier').map((issue) => issue.current)).toEqual(['5000', '9000']);
    // (A file of one numeric column also yields near-duplicate candidates, finding F8; they come first.)
    const flagged = selectCases(dataset, analysis).filter((entry) => entry.detector === 'outlier');
    expect(flagged.map((entry) => entry.current)).toEqual(['9000', '5000']);
  });

  it('sends at most 60 cases and hands out copies of the rows', () => {
    const rows = Array.from({ length: 70 }, (_, i) => [String(1000 + i)]);
    const dataset = table(['weight'], rows);
    const issues: Issue[] = rows.map((_, i) => ({
      id: `outlier:${i + 1}:weight:flag`, type: 'suspicious', detector: 'outlier', source: 'rule', rowIds: [i + 1], column: 'weight',
      current: String(1000 + i), reason: 'Far from the rest.', confidence: 'low',
    }));
    const analysis: Analysis = { issues, profile: analyze(dataset).profile };
    const cases = selectCases(dataset, analysis);
    expect(cases).toHaveLength(MAX_CASES);
    expect([MAX_CASES, CASES_PER_REQUEST, CONCURRENT_REQUESTS]).toEqual([60, 10, 3]);
    cases[0].rows[0].cells.weight = 'changed';
    expect(dataset.rows.some((row) => row.cells.weight === 'changed')).toBe(false);
  });

  it('builds requests the route accepts, ten cases at most', () => {
    const { dataset, analysis } = stock();
    const cases = selectCases(dataset, analysis);
    expect(AdjudicationRequestSchema.safeParse({ cases }).success).toBe(true);
    const eleven = Array.from({ length: 11 }, () => cases[0]);
    expect(AdjudicationRequestSchema.safeParse({ cases: eleven }).success).toBe(false);
    expect(AdjudicationRequestSchema.safeParse({ cases: [] }).success).toBe(false);
    expect(AdjudicationRequestSchema.safeParse({ cases, prompt: 'Do something else.' }).success).toBe(false);
    expect(AdjudicationRequestSchema.safeParse({ cases: [{ ...cases[0], detector: 'whitespace' }] }).success).toBe(false);
  });
});

describe('applyVerdicts (SPEC 6.4)', () => {
  const verdict = (issue: Issue, value: Verdict['value'], reason = 'The rows differ only in a note.'): Verdict => ({ issueId: issue.id, value, reason });

  it('confirm raises a low confidence to medium and keeps the sentence of the model', () => {
    const { analysis } = stock();
    const duplicate = issueOf(analysis, 'near-duplicate');
    expect(duplicate.confidence).toBe('low');
    const judged = applyVerdicts(analysis, [verdict(duplicate, 'confirm')]);
    expect(judged.issues.find((issue) => issue.id === duplicate.id)).toEqual({
      ...duplicate,
      confidence: 'medium',
      verdict: { value: 'confirm', reason: 'The rows differ only in a note.' },
    });
  });

  it('does not raise a confidence that is already medium', () => {
    const dataset = nursery();
    const analysis = analyze(dataset, verifyContract(nurseryContract(), dataset));
    const flagged = issueOf(analysis, 'range');
    const judged = applyVerdicts(analysis, [verdict(flagged, 'confirm')]);
    expect(judged.issues.find((issue) => issue.id === flagged.id)?.confidence).toBe('medium');
  });

  it('dismiss and unsure attach the verdict and change nothing else', () => {
    const { analysis } = stock();
    const duplicate = issueOf(analysis, 'near-duplicate');
    const outlier = issueOf(analysis, 'outlier');
    const judged = applyVerdicts(analysis, [verdict(duplicate, 'dismiss', 'Two parts.'), verdict(outlier, 'unsure', 'Not enough to tell.')]);
    expect(judged.issues.find((issue) => issue.id === duplicate.id)).toEqual({ ...duplicate, verdict: { value: 'dismiss', reason: 'Two parts.' } });
    expect(judged.issues.find((issue) => issue.id === outlier.id)).toEqual({ ...outlier, verdict: { value: 'unsure', reason: 'Not enough to tell.' } });
  });

  it('never creates a fix, never changes one, and keeps every issue and id', () => {
    const { analysis } = stock();
    const before = structuredClone(analysis);
    const adjudicated = analysis.issues.filter((issue) => ['near-duplicate', 'outlier'].includes(issue.detector));
    const judged = applyVerdicts(analysis, adjudicated.map((issue, i) => verdict(issue, (['confirm', 'dismiss', 'unsure'] as const)[i % 3])));
    expect(judged.issues.map((issue) => issue.id)).toEqual(analysis.issues.map((issue) => issue.id));
    expect(judged.issues.map((issue) => issue.fix)).toEqual(analysis.issues.map((issue) => issue.fix));
    expect(judged.issues.filter((issue) => issue.verdict).length).toBe(adjudicated.length);
    // The input is not modified.
    expect(analysis).toEqual(before);
  });

  it('ignores a verdict for an issue that was not adjudicated, for an unknown id, and a second verdict', () => {
    const { analysis } = stock();
    const whitespace = issueOf(analysis, 'whitespace');
    const duplicate = issueOf(analysis, 'near-duplicate');
    const judged = applyVerdicts(analysis, [
      verdict(whitespace, 'dismiss'),
      { issueId: 'no-such-issue', value: 'dismiss', reason: '' },
      verdict(duplicate, 'unsure', 'first'),
      verdict(duplicate, 'dismiss', 'second'),
    ]);
    expect(judged.issues.find((issue) => issue.id === whitespace.id)).toEqual(whitespace);
    expect(judged.issues.find((issue) => issue.id === duplicate.id)?.verdict).toEqual({ value: 'unsure', reason: 'first' });
    expect(judged.issues).toHaveLength(analysis.issues.length);
  });
});
