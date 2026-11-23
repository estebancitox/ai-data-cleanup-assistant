import { describe, expect, it } from 'vitest';
import { verifyContract } from '../contract';
import { nursery, nurseryContract, table } from '../testing';
import type { Contract, Dataset, Issue } from '../types';
import { analyze, groupIssues } from './index';

const EMPTY: Contract = { columns: [], missingTokens: [], canonicalGroups: [], suspiciousValues: [], ranges: [], dependencies: [] };
const cellIssues = (issues: Issue[]) => issues.filter((issue) => issue.column !== undefined);
const rulesOnly = (dataset: Dataset) => cellIssues(analyze(dataset).issues);
const withContract = (dataset: Dataset, contract: Partial<Contract>) => {
  const verified = verifyContract({ ...EMPTY, ...contract }, dataset);
  expect(verified.rejected).toEqual([]);
  return cellIssues(analyze(dataset, verified).issues);
};
const proposed = (issue: Issue) => (issue.fix?.kind === 'set-cell' ? issue.fix.to : null);
const brief = (issue: Issue) => [issue.rowIds[0], issue.column, issue.detector, issue.type, proposed(issue), issue.confidence];

describe('detectors driven by the contract (SPEC 5.5)', () => {
  it('produce one issue for each planted problem of the nursery, marked as coming from the AI', () => {
    const issues = withContract(nursery(), nurseryContract());
    expect(issues.filter((issue) => issue.source === 'ai').map(brief)).toEqual([
      [31, 'genus', 'dependency', 'inconsistent', 'Acer', 'high'],
      [32, 'genus', 'dependency', 'missing', 'Quercus', 'high'],
      [33, 'size', 'canonical-value', 'inconsistent', 'Large', 'medium'],
      [35, 'light', 'placeholder', 'missing', '', 'medium'],
      [36, 'height_cm', 'range', 'suspicious', null, 'medium'],
      [37, 'notes', 'flagged-value', 'suspicious', null, 'medium'],
      [38, 'genus', 'dependency', 'missing', 'Quercus', 'high'],
    ]);
    // The case variant of a size stays with the rule that is certain about it.
    expect(issues.filter((issue) => issue.source === 'rule').map(brief)).toEqual([
      [34, 'size', 'case-variant', 'inconsistent', 'Large', 'high'],
    ]);
  });

  it('find nothing without a contract', () => {
    const issues = analyze(nursery()).issues;
    expect(issues.every((issue) => issue.source === 'rule')).toBe(true);
    expect(cellIssues(issues).map((issue) => [issue.rowIds[0], issue.detector])).toEqual([
      [32, 'empty'],
      [34, 'case-variant'],
      [36, 'outlier'],
      [38, 'placeholder'],
    ]);
  });

  it('C3 states the counts behind the majority', () => {
    const issues = withContract(nursery(), nurseryContract());
    expect(issues.find((issue) => issue.rowIds[0] === 31)?.evidence).toBe('12 of 12 other rows with this species have this genus.');
    expect(issues.find((issue) => issue.rowIds[0] === 32)?.evidence).toBe('11 of 11 other rows with this species have this genus.');
  });

  describe('C3 dependency', () => {
    // 24 rows where the bin decides the wood, then the rows of one more bin.
    const steady = Array.from({ length: 24 }, (_, i) => [i % 2 ? 'b' : 'a', i % 2 ? 'Pine' : 'Oak']);
    const bins = (...extra: string[][]) => table(['bin', 'wood'], [...steady, ...extra]);
    const rule = { dependencies: [{ determinant: 'bin', dependent: 'wood', reason: '' }] };
    const found = (dataset: Dataset, contract: Partial<Contract> = rule) =>
      withContract(dataset, contract).filter((issue) => issue.detector === 'dependency').map(brief);

    it('needs a clear majority: at least 3 rows and 80% of the group', () => {
      // 3 of 4 is 75%: no clear majority.
      expect(found(bins(['c', 'Ash'], ['c', 'Ash'], ['c', 'Ash'], ['c', 'Elm']))).toEqual([]);
      // 2 of 2: not enough rows.
      expect(found(bins(['c', 'Ash'], ['c', 'Ash'], ['c', '']))).toEqual([]);
    });

    it('is medium until the majority has 5 rows and 90%', () => {
      // 4 of 5 is 80%.
      const four = bins(['c', 'Ash'], ['c', 'Ash'], ['c', 'Ash'], ['c', 'Ash'], ['c', 'Elm']);
      expect(found(four)).toEqual([[29, 'wood', 'dependency', 'inconsistent', 'Ash', 'medium']]);
      // 3 of 3 with the value present, and one row to fill.
      expect(found(bins(['c', 'Ash'], ['c', 'Ash'], ['c', 'Ash'], ['c', '']))).toEqual([
        [28, 'wood', 'dependency', 'missing', 'Ash', 'medium'],
      ]);
    });

    it('leaves out the rows whose determinant is missing', () => {
      expect(found(bins(['', 'Elm'], ['n/a', 'Elm']))).toEqual([]);
    });

    it('treats a verified missing token as missing', () => {
      const dataset = bins(['a', 'tbc']);
      expect(found(dataset)).toEqual([[25, 'wood', 'dependency', 'inconsistent', 'Oak', 'high']]);
      expect(found(dataset, { ...rule, missingTokens: [{ column: 'wood', token: 'tbc' }] })).toEqual([
        [25, 'wood', 'dependency', 'missing', 'Oak', 'high'],
      ]);
    });

    it('compares after the canonical groups, and wins the cell from C1 when the value is wrong for its group', () => {
      const dataset = bins(['a', 'Ok'], ['b', 'Ok']);
      const contract = { ...rule, canonicalGroups: [{ column: 'wood', values: ['Oak', 'Ok'], reason: '' }] };
      expect(withContract(dataset, contract).map(brief)).toEqual([
        // "Ok" means Oak, and bin a holds Oak: only the spelling is fixed.
        [25, 'wood', 'canonical-value', 'inconsistent', 'Oak', 'medium'],
        // In bin b the value is wrong whatever its spelling.
        [26, 'wood', 'dependency', 'inconsistent', 'Pine', 'high'],
      ]);
    });
  });

  describe('precedence (SPEC 5.6)', () => {
    const sizes = (...extra: string[]) =>
      table(['size'], [...Array.from({ length: 60 }, (_, i) => [i % 2 ? 'Small' : 'Large']), ...extra.map((value) => [value])]);
    const group = { canonicalGroups: [{ column: 'size', values: ['Large', 'Lrg'], reason: '' }] };

    it('C1 takes a cell before R4', () => {
      // On its own " Lrg" only has spaces to trim; with the group it is rewritten in one fix.
      expect(rulesOnly(sizes(' Lrg')).map(brief)).toEqual([[61, 'size', 'whitespace', 'inconsistent', 'Lrg', 'high']]);
      expect(withContract(sizes(' Lrg'), group).map(brief)).toEqual([[61, 'size', 'canonical-value', 'inconsistent', 'Large', 'medium']]);
    });

    it('C1 takes a cell before C2, and C2 before R4 and C6', () => {
      // The same value is a missing token, a flagged value and, in the first contract, a variant.
      const token = {
        missingTokens: [{ column: 'size', token: 'tbc' }],
        suspiciousValues: [{ column: 'size', value: 'tbc', reason: '' }],
      };
      const variant = { canonicalGroups: [{ column: 'size', values: ['Large', 'tbc'], reason: '' }] };
      expect(withContract(sizes(' tbc '), { ...token, ...variant }).map(brief)).toEqual([
        [61, 'size', 'canonical-value', 'inconsistent', 'Large', 'medium'],
      ]);
      expect(withContract(sizes(' tbc '), token).map(brief)).toEqual([[61, 'size', 'placeholder', 'missing', '', 'medium']]);
    });

    it('R4 keeps a cell from C6, because a fix beats a flag', () => {
      const contract = { suspiciousValues: [{ column: 'size', value: 'asdf', reason: '' }] };
      expect(withContract(sizes('asdf', ' asdf'), contract).map(brief)).toEqual([
        [61, 'size', 'flagged-value', 'suspicious', null, 'medium'],
        [62, 'size', 'whitespace', 'inconsistent', 'asdf', 'high'],
      ]);
    });

    it('C6 comes before C4, and C4 before R7 and R8', () => {
      const weights = table(['weight'], [...Array.from({ length: 40 }, (_, i) => [String(100 + i * 5)]), ['99999'], ['88888']]);
      expect(rulesOnly(weights).map(brief)).toEqual([
        [41, 'weight', 'shape', 'inconsistent', null, 'low'],
        [42, 'weight', 'shape', 'inconsistent', null, 'low'],
      ]);
      const contract = {
        ranges: [{ column: 'weight', min: '0', max: '1000', reason: '' }],
        suspiciousValues: [{ column: 'weight', value: '99999', reason: '' }],
      };
      expect(withContract(weights, contract).map(brief)).toEqual([
        [41, 'weight', 'flagged-value', 'suspicious', null, 'medium'],
        [42, 'weight', 'range', 'suspicious', null, 'medium'],
      ]);
    });
  });

  it('C4 flags dates outside the range and skips a date it cannot read for certain', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2024-03-${String(i + 1).padStart(2, '0')}`);
    const dates = table(['received'], [...days, '2031-12-25', '03/04/2031'].map((value) => [value]));
    const issues = withContract(dates, { ranges: [{ column: 'received', min: '2024-01-01', max: '2024-12-31', reason: '' }] });
    expect(issues.filter((issue) => issue.detector === 'range').map((issue) => [issue.rowIds[0], issue.reason])).toEqual([
      [31, 'This value is outside what is expected for this column (between 2024-01-01 and 2024-12-31).'],
    ]);
  });

  it('keeps rule placeholders and contract placeholders in separate groups', () => {
    const dataset = table(['light'], [...Array.from({ length: 20 }, (_, i) => [i % 2 ? 'sun' : 'shade']), ['n/a'], ['tbc']]);
    const issues = withContract(dataset, { missingTokens: [{ column: 'light', token: 'tbc' }] });
    expect(groupIssues(issues).map((entry) => [entry.detector, entry.source, entry.confidence, entry.issues.length])).toEqual([
      ['placeholder', 'rule', 'high', 1],
      ['placeholder', 'ai', 'medium', 1],
    ]);
  });
});
