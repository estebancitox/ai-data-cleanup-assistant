import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nursery, nurseryContract, table } from '../testing';
import type { Contract, Dataset } from '../types';
import { buildContractRequest, ContractRequestSchema, ContractSchema, verifyContract } from './index';

const EMPTY: Contract = { columns: [], missingTokens: [], canonicalGroups: [], suspiciousValues: [], ranges: [], dependencies: [] };
const verify = (part: Partial<Contract>, dataset: Dataset = nursery()) => verifyContract({ ...EMPTY, ...part }, dataset);
const rejections = (part: Partial<Contract>, dataset?: Dataset) =>
  verify(part, dataset).rejected.map((entry) => [entry.rule, entry.reason]);

describe('ContractSchema', () => {
  it('stays inside the JSON Schema subset that structured outputs accept', () => {
    const allowed = new Set(['$schema', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum']);
    const used = new Set<string>();
    const walk = (node: unknown, isPropertyMap = false): void => {
      if (Array.isArray(node)) return node.forEach((item) => walk(item));
      if (node === null || typeof node !== 'object') return;
      const entries = Object.entries(node);
      if (!isPropertyMap) {
        for (const [key] of entries) used.add(key);
        const schema = node as { type?: string; properties?: object; required?: string[]; additionalProperties?: unknown };
        if (schema.type === 'object') {
          // Every object is closed and every property is required: no optional parameters.
          expect(schema.additionalProperties).toBe(false);
          expect([...(schema.required ?? [])].sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
        }
      }
      for (const [key, value] of entries) walk(value, !isPropertyMap && key === 'properties');
    };
    walk(z.toJSONSchema(ContractSchema));
    expect([...used].filter((key) => !allowed.has(key))).toEqual([]);
    expect(used.has('enum')).toBe(true);
  });

  it('accepts a full contract and refuses a partial or invalid one', () => {
    expect(ContractSchema.safeParse(nurseryContract()).success).toBe(true);
    const partial: Record<string, unknown> = { ...nurseryContract() };
    delete partial.ranges;
    expect(ContractSchema.safeParse(partial).success).toBe(false);
    const wrongRole = { ...EMPTY, columns: [{ name: 'size', meaning: 'size', role: 'label', format: 'none' }] };
    expect(ContractSchema.safeParse(wrongRole).success).toBe(false);
  });
});

describe('buildContractRequest', () => {
  it('describes every column and sends 20 rows: the first 5 and 15 more', () => {
    const dataset = nursery();
    const request = buildContractRequest(dataset);
    expect(request.rowCount).toBe(38);
    expect(request.columns.map((column) => column.name)).toEqual(dataset.columns);
    const size = request.columns.find((column) => column.name === 'size');
    expect(size).toMatchObject({ kind: 'text', categorical: true, allValues: true, missing: 0 });
    expect(size?.values[0]).toEqual({ value: 'Small', count: 14, cut: false });
    expect(size?.values.map((entry) => entry.value)).toContain('Lrg');
    expect(size?.values.reduce((sum, entry) => sum + entry.count, 0)).toBe(38);
    expect(request.columns.find((column) => column.name === 'height_cm')?.numeric?.max).toBe(4000);
    // Missing cells are not listed as values.
    expect(request.columns.find((column) => column.name === 'genus')?.values.map((entry) => entry.value)).toEqual(['Acer', 'Quercus', 'Betula']);

    expect(request.sampleRows).toHaveLength(20);
    const cellsOf = (id: number) => dataset.columns.map((name) => dataset.rows[id - 1].cells[name]);
    expect(request.sampleRows.slice(0, 5)).toEqual([1, 2, 3, 4, 5].map(cellsOf));
    expect(new Set(request.sampleRows.map((row) => row[0])).size).toBe(20);
    expect(ContractRequestSchema.safeParse(request).success).toBe(true);
  });

  it('gives the same request for the same file', () => {
    expect(buildContractRequest(nursery())).toEqual(buildContractRequest(nursery()));
  });

  it('sends a short file whole and never more than its rows', () => {
    const request = buildContractRequest(table(['a', 'b'], [['1', 'x'], ['2', 'y'], ['3', 'z']]));
    expect(request.sampleRows).toEqual([['1', 'x'], ['2', 'y'], ['3', 'z']]);
  });

  it('lists the 20 most common values and 10 more when a column has over 200, cut at 80 characters', () => {
    const long = (i: number) => `${'entry '.repeat(20)}${i}`;
    const values = [...Array.from({ length: 300 }, (_, i) => long(i)), long(7), long(7), long(250), 'short'];
    const request = buildContractRequest(table(['text'], values.map((value) => [value])));
    const [column] = request.columns;
    expect(column.allValues).toBe(false);
    expect(column.values).toHaveLength(30);
    expect(column.values.slice(0, 2).map((entry) => entry.count)).toEqual([3, 2]);
    expect(column.values.every((entry) => entry.value.length <= 80)).toBe(true);
    expect(column.values[0]).toEqual({ value: long(7).slice(0, 80), count: 3, cut: true });
    expect(request.sampleRows.every((row) => row[0].length <= 80)).toBe(true);
    expect(ContractRequestSchema.safeParse(request).success).toBe(true);
  });

  it('halves the number of values a column may list in full until the request fits in 200 KB', () => {
    const wide = (columns: number) =>
      table(
        Array.from({ length: columns }, (_, c) => `column_${c}`),
        Array.from({ length: 150 }, (_, r) => Array.from({ length: columns }, (_, c) => `${'x'.repeat(70)}-${c}-${r}`)),
      );
    const bytes = (request: unknown) => new TextEncoder().encode(JSON.stringify(request)).length;

    const fits = buildContractRequest(wide(5));
    expect(fits.columns.every((column) => column.allValues && column.values.length === 150)).toBe(true);

    const halved = buildContractRequest(wide(30));
    expect(halved.columns.every((column) => !column.allValues && column.values.length === 30)).toBe(true);
    expect(bytes(halved)).toBeLessThanOrEqual(200 * 1024);
  });
});

describe('ContractRequestSchema', () => {
  it('refuses anything that is not a request built by this module', () => {
    const request = buildContractRequest(nursery());
    expect(ContractRequestSchema.safeParse({ ...request, prompt: 'Do something else.' }).success).toBe(false);
    expect(ContractRequestSchema.safeParse({ ...request, sampleRows: [['x'.repeat(81)]] }).success).toBe(false);
    expect(ContractRequestSchema.safeParse({ ...request, columns: [] }).success).toBe(false);
    expect(ContractRequestSchema.safeParse('text').success).toBe(false);
  });
});

describe('verifyContract (SPEC 6.3)', () => {
  it('accepts every rule of a contract the data supports, with the numbers behind each', () => {
    const verified = verifyContract(nurseryContract(), nursery());
    expect(verified.rejected).toEqual([]);
    expect(verified.columns.map((column) => [column.name, column.format])).toEqual([['supplier_email', 'email'], ['height_cm', 'none']]);
    expect(verified.missingTokens).toEqual([{ column: 'light', token: 'tbc', support: '1 of 38 cells hold this token' }]);
    expect(verified.canonicalGroups).toEqual([
      { column: 'size', canonical: 'Large', variants: ['Lrg'], reason: 'An abbreviation of the same size.', support: '"Large" fills 12 cells; the other spellings fill 1' },
    ]);
    expect(verified.suspiciousValues[0]).toMatchObject({ column: 'notes', support: '1 of 38 rows hold this value' });
    expect(verified.ranges[0]).toMatchObject({ column: 'height_cm', min: '5', max: '1000', support: '37 of 38 values are inside' });
    expect(verified.dependencies[0].support).toBe(
      '35 of 36 rows (97.2%) have the most common genus for their species; 36 rows are in groups of 3 or more',
    );
  });

  it('any rule: rejects a column that is not a header, and never throws', () => {
    const unknown: Contract = {
      columns: [{ name: 'colour', meaning: '', role: 'other', format: 'none' }],
      missingTokens: [{ column: 'colour', token: 'tbc' }],
      canonicalGroups: [{ column: 'colour', values: ['a', 'b'], reason: '' }],
      suspiciousValues: [{ column: 'colour', value: 'a', reason: '' }],
      ranges: [{ column: 'colour', min: '1', max: '2', reason: '' }],
      dependencies: [
        { determinant: 'colour', dependent: 'genus', reason: '' },
        { determinant: 'species', dependent: 'colour', reason: '' },
      ],
    };
    const verified = verifyContract(unknown, nursery());
    expect(verified.rejected.map((entry) => entry.reason)).toEqual(Array.from({ length: 7 }, () => 'unknown column'));
    expect(verified.rejected.map((entry) => entry.rule)).toEqual([
      'column', 'missingToken', 'canonicalGroup', 'suspiciousValue', 'range', 'dependency', 'dependency',
    ]);
    // A header is matched exactly as written.
    expect(rejections({ missingTokens: [{ column: 'Light', token: 'tbc' }] })).toEqual([['missingToken', 'unknown column']]);
  });

  it('column format: kept when 90% of the values pass, ignored otherwise', () => {
    const email = { name: 'supplier_email', meaning: '', role: 'other' as const };
    expect(verify({ columns: [{ ...email, format: 'email' }] }).columns[0].format).toBe('email');
    const asUrl = verify({ columns: [{ ...email, format: 'url' }] });
    expect(asUrl.columns[0].format).toBe('none');
    expect(asUrl.rejected).toEqual([
      { rule: 'format', summary: 'supplier_email: url', reason: '0.0% of the values pass the check; 90.0% are needed' },
    ]);
    // 18 of 20 pass: exactly 90%.
    const sites = table(['site'], [...Array.from({ length: 18 }, (_, i) => [`https://shop${i}.example/a`]), ['shop.example'], ['none yet']]);
    expect(verify({ columns: [{ name: 'site', meaning: '', role: 'other', format: 'url' }] }, sites).columns[0].format).toBe('url');
  });

  it('missingTokens: accepted when the token is a value of the column', () => {
    expect(verify({ missingTokens: [{ column: 'light', token: ' TBC ' }] }).missingTokens).toEqual([
      { column: 'light', token: 'tbc', support: '1 of 38 cells hold this token' },
    ]);
    expect(rejections({ missingTokens: [{ column: 'light', token: 'pending' }] })).toEqual([['missingToken', 'not in the data']]);
  });

  it('missingTokens: a token the built-in rules already treat as missing is rejected', () => {
    expect(rejections({
      missingTokens: [
        { column: 'genus', token: 'N/A' },
        { column: 'genus', token: '' },
        { column: 'height_cm', token: 'unknown' },
      ],
    })).toEqual(Array.from({ length: 3 }, () => ['missingToken', 'already handled by a built-in rule']));
  });

  it('canonicalGroups: accepted when two values remain and at most one is common; code picks the spelling', () => {
    const verified = verify({ canonicalGroups: [{ column: 'size', values: ['lrg', 'Huge', 'LARGE'], reason: 'same size' }] });
    expect(verified.rejected).toEqual([]);
    expect(verified.canonicalGroups[0]).toMatchObject({ canonical: 'Large', variants: ['Lrg'] });
    // A tie goes to the value the file shows first.
    const tie = table(['wood'], [['Oak'], ['Oke'], ['Oke'], ['Oak'], ...Array.from({ length: 40 }, () => ['Pine'])]);
    expect(verify({ canonicalGroups: [{ column: 'wood', values: ['Oke', 'Oak'], reason: '' }] }, tie).canonicalGroups[0]).toMatchObject({
      canonical: 'Oak',
      variants: ['Oke'],
    });
  });

  it('canonicalGroups: rejected when not in the data, or when it would merge two common values', () => {
    const group = (values: string[]) => ({ column: 'size', values, reason: '' });
    expect(rejections({ canonicalGroups: [group(['Lrg', 'Huge'])] })).toEqual([
      ['canonicalGroup', 'not in the data: fewer than two different values of the group are in this column'],
    ]);
    // Spellings of one key are one value: they stay with the rule for case and spacing.
    expect(rejections({ canonicalGroups: [group(['Large', 'LARGE', ' large '])] })[0][1]).toMatch(/^not in the data/);
    expect(rejections({ canonicalGroups: [group(['Small', 'Large'])] })).toEqual([
      ['canonicalGroup', 'would merge two common values: "Small", "Large"'],
    ]);
    const two = verify({ canonicalGroups: [group(['Large', 'Lrg']), group(['Medium', 'Lrg'])] });
    expect(two.canonicalGroups).toHaveLength(1);
    expect(two.rejected.map((entry) => entry.reason)).toEqual(['shares a value with another group of this column']);
  });

  it('suspiciousValues: accepted when observed in 5% of the rows or fewer', () => {
    expect(verify({ suspiciousValues: [{ column: 'notes', value: 'test row DO NOT sell', reason: 'test' }] }).suspiciousValues).toEqual([
      { column: 'notes', value: 'TEST ROW do not sell', reason: 'test', support: '1 of 38 rows hold this value' },
    ]);
    expect(rejections({
      suspiciousValues: [
        { column: 'notes', value: 'lorem ipsum', reason: '' },
        { column: 'size', value: 'Small', reason: '' },
        { column: 'genus', value: 'n/a', reason: '' },
      ],
    })).toEqual([
      ['suspiciousValue', 'not in the data'],
      ['suspiciousValue', 'too common to be an anomaly: 36.8% of the rows hold it'],
      ['suspiciousValue', 'not in the data'],
    ]);
  });

  it('ranges: accepted on a number column when the bounds parse and 95% of the values are inside', () => {
    const range = (min: string, max: string, column = 'height_cm') => ({ ranges: [{ column, min, max, reason: '' }] });
    expect(verify(range(' 5 ', '')).ranges).toEqual([
      { column: 'height_cm', min: '5', max: '', reason: '', support: '38 of 38 values are inside' },
    ]);
    expect(rejections(range('5', '1000', 'size'))).toEqual([['range', 'not a number or date column']]);
    expect(rejections(range('low', '1000'))).toEqual([['range', 'a bound cannot be read as a number']]);
    expect(rejections(range('', ''))).toEqual([['range', 'no bound was given']]);
    expect(rejections(range('100', '50'))).toEqual([['range', 'the lower bound is above the upper bound']]);
    // 10 of the 38 heights are under 100.
    expect(rejections(range('100', ''))).toEqual([['range', '26.3% of the values are outside; at most 5.0% may be']]);
  });

  it('ranges: compares dates as dates, and leaves out a date it cannot read for certain', () => {
    const days = Array.from({ length: 20 }, (_, i) => `2024-03-${String(i + 1).padStart(2, '0')}`);
    const dates = table(['received'], [...days, '25/12/2031', '03/04/2024'].map((value) => [value]));
    const range = (min: string, max: string) => ({ ranges: [{ column: 'received', min, max, reason: '' }] });
    // 03/04/2024 could be March or April: it is neither inside nor outside.
    expect(verify(range('2024-01-01', 'Dec 31, 2024'), dates).ranges[0].support).toBe('20 of 21 values are inside');
    expect(rejections(range('2024-03-10', ''), dates)).toEqual([['range', '42.9% of the values are outside; at most 5.0% may be']]);
    expect(rejections(range('03/04/2024', ''), dates)).toEqual([['range', 'a bound cannot be read as a date']]);
    expect(rejections(range('2024-02-30', ''), dates)).toEqual([['range', 'a bound cannot be read as a date']]);
  });

  it('dependencies: accepted when enough rows are in groups and 95% agree with their group', () => {
    const verified = verify({ dependencies: [{ determinant: 'species', dependent: 'genus', reason: 'taxonomy' }] });
    expect(verified.rejected).toEqual([]);
    expect(verified.dependencies).toHaveLength(1);
  });

  it('dependencies: rejected with the measured numbers', () => {
    const rule = (determinant: string, dependent: string) => ({ dependencies: [{ determinant, dependent, reason: '' }] });
    expect(rejections(rule('genus', 'genus'))).toEqual([['dependency', 'the two columns are the same']]);
    expect(rejections(rule('notes', 'genus'))).toEqual([['dependency', 'the determinant is free text']]);
    expect(rejections(rule('plant_id', 'genus'))).toEqual([['dependency', '0 rows are in groups of 3 or more; 20 are needed']]);
    expect(rejections(rule('size', 'genus'))).toEqual([['dependency', '37.1% of the rows agree with their group; 95.0% are needed']]);
  });

  it('dependencies: compares the dependent column after the verified canonical groups', () => {
    const rows = [
      ...Array.from({ length: 14 }, () => ['a', 'Oak']),
      ['a', 'Ok'],
      ['a', 'Ok'],
      ...Array.from({ length: 14 }, () => ['b', 'Pine']),
    ];
    const dataset = table(['bin', 'wood'], rows);
    const rule = { dependencies: [{ determinant: 'bin', dependent: 'wood', reason: '' }] };
    expect(rejections(rule, dataset)).toEqual([['dependency', '93.3% of the rows agree with their group; 95.0% are needed']]);
    const withGroup = verify({ ...rule, canonicalGroups: [{ column: 'wood', values: ['Oak', 'Ok'], reason: '' }] }, dataset);
    expect(withGroup.rejected).toEqual([]);
    expect(withGroup.dependencies[0].support).toMatch(/^30 of 30 rows \(100\.0%\)/);
  });
});
