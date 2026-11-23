import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { META, table } from '../testing';
import type { Decisions } from '../types';
import { applyDecisions } from './index';

// Row 3 is an exact copy of row 1 once trimmed; row 2 has a spelling variant.
const dataset = () =>
  table(['wood', 'finish'], [['Oak', 'matte'], ['OAK', 'gloss'], ['Oak ', 'matte'], ['Oak', 'satin'], ['Pine', '']], 'boards.csv');

describe('applyDecisions', () => {
  it('applies accepted cell fixes, then accepted row removals, keeping the order', () => {
    const data = dataset();
    const analysis = analyze(data);
    const decisions: Decisions = Object.fromEntries(analysis.issues.map((issue) => [issue.id, 'accepted']));
    const { cleaned, changeLog } = applyDecisions(data, analysis, decisions, META);

    expect(cleaned.rows).toEqual([
      { id: 1, cells: { wood: 'Oak', finish: 'matte' } },
      { id: 2, cells: { wood: 'Oak', finish: 'gloss' } },
      { id: 4, cells: { wood: 'Oak', finish: 'satin' } },
      { id: 5, cells: { wood: 'Pine', finish: '' } },
    ]);
    // The whitespace fix on row 3 is accepted but the row is removed, so it changes no cell.
    expect(changeLog.summary).toEqual({
      issues: analysis.issues.length,
      accepted: analysis.issues.length,
      rejected: 0,
      pending: 0,
      cellsChanged: 1,
      rowsRemoved: 1,
    });
  });

  it('lists every issue with its decision and leaves rejected and pending ones unapplied', () => {
    const data = dataset();
    const analysis = analyze(data);
    const variant = analysis.issues.find((issue) => issue.detector === 'case-variant');
    const duplicate = analysis.issues.find((issue) => issue.detector === 'exact-duplicate');
    if (!variant || !duplicate) throw new Error('expected both issues');
    const { cleaned, changeLog } = applyDecisions(data, analysis, { [variant.id]: 'accepted', [duplicate.id]: 'rejected' }, META);

    expect(cleaned.rows).toHaveLength(5);
    expect(cleaned.rows[1].cells.wood).toBe('Oak');
    expect(changeLog.changes.map((change) => change.issueId)).toEqual(analysis.issues.map((issue) => issue.id));
    expect(changeLog.changes.find((change) => change.issueId === variant.id)).toMatchObject({
      decision: 'accepted', column: 'wood', from: 'OAK', to: 'Oak', rowIds: [2],
    });
    expect(changeLog.changes.find((change) => change.issueId === duplicate.id)).toMatchObject({
      decision: 'rejected', column: null, from: null, to: null, rowIds: [1, 3],
    });
    expect(changeLog.summary).toMatchObject({ accepted: 1, rejected: 1, pending: analysis.issues.length - 2, cellsChanged: 1, rowsRemoved: 0 });
  });

  it('fills the change log header from the dataset and from the caller', () => {
    const data = dataset();
    const { changeLog } = applyDecisions(data, analyze(data), {}, META);
    expect(changeLog).toMatchObject({
      tool: 'ai-data-cleanup-assistant',
      version: '1.0',
      file: { name: 'boards.csv', rows: 5, columns: 2, sha256: META.sha256 },
      generatedAt: META.generatedAt,
      ai: { mode: 'off', model: null },
    });
  });

  it('ignores an accepted decision on a flag-only issue and on an unknown id', () => {
    const data = dataset();
    const analysis = analyze(data);
    const empty = analysis.issues.find((issue) => issue.detector === 'empty');
    if (!empty) throw new Error('expected an empty-cell issue');
    const { cleaned } = applyDecisions(data, analysis, { [empty.id]: 'accepted', 'no-such-issue': 'accepted' }, META);
    expect(cleaned).toEqual(data);
  });
});
