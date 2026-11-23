import { expect, it } from 'vitest';
import { analyze } from '../core/analyze';
import { applyDecisions } from '../core/apply';
import { serializeCsv } from '../core/csv';
import { inventory } from '../core/testing';
import type { ChangeLog, Decisions } from '../core/types';
import { AI_OFF } from './analysis';
import { baseName, buildExport } from './export';

it('the export name is the file name without a final .csv', () => {
  expect(baseName('inventory.csv')).toBe('inventory');
  expect(baseName('INVENTORY.CSV')).toBe('INVENTORY');
  expect(baseName('parts.2024.csv')).toBe('parts.2024');
  expect(baseName('parts.txt')).toBe('parts.txt');
  expect(baseName('csv')).toBe('csv');
});

it('the two files are what applyDecisions and serializeCsv give', () => {
  const dataset = inventory();
  const analysis = analyze(dataset);
  const fixes = analysis.issues.filter((issue) => issue.fix !== undefined);
  const decisions: Decisions = { [fixes[0].id]: 'accepted', [fixes[1].id]: 'accepted', [fixes[2].id]: 'rejected' };
  const generatedAt = '2001-02-03T04:05:06.000Z';
  const file = { dataset, warnings: [], sha256: 'a-hash' };

  const built = buildExport(file, { analysis, ai: AI_OFF }, decisions, generatedAt);
  const expected = applyDecisions(dataset, analysis, decisions, { generatedAt, sha256: 'a-hash', ai: AI_OFF });

  expect(built.cleanedCsv.name).toBe('inventory.cleaned.csv');
  expect(built.cleanedCsv.text).toBe(serializeCsv(expected.cleaned));
  expect(built.changeLog.name).toBe('inventory.changes.json');
  expect(JSON.parse(built.changeLog.text) as ChangeLog).toEqual(expected.changeLog);
  expect(built.summary).toEqual(expected.changeLog.summary);
  expect(built.summary.accepted).toBe(2);
});
