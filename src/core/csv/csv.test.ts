import { describe, expect, it } from 'vitest';
import { table } from '../testing';
import { parseCsv, serializeCsv, UPLOAD_LIMITS } from './index';

function ok(text: string) {
  const parsed = parseCsv(text, 'parts.csv');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}
function failure(text: string): string {
  const parsed = parseCsv(text, 'parts.csv');
  if (parsed.ok) throw new Error('expected the file to be rejected');
  return parsed.error;
}

describe('parseCsv', () => {
  it('numbers data rows from 1 and keeps values exactly as written', () => {
    const { dataset, warnings } = ok('name,price\n Alloy hub ,007\n"Chain, 9 speed","1,200"\n');
    expect(dataset.fileName).toBe('parts.csv');
    expect(dataset.columns).toEqual(['name', 'price']);
    expect(dataset.rows).toEqual([
      { id: 1, cells: { name: ' Alloy hub ', price: '007' } },
      { id: 2, cells: { name: 'Chain, 9 speed', price: '1,200' } },
    ]);
    expect(warnings).toEqual([]);
  });

  it('removes a byte-order mark', () => {
    expect(ok('﻿name,price\nhub,5\n').dataset.columns).toEqual(['name', 'price']);
  });

  it('detects the delimiter', () => {
    expect(ok('name;price\nhub;5\nrail;7\n').dataset.rows[1].cells).toEqual({ name: 'rail', price: '7' });
    expect(ok('name\tprice\nhub\t5\nrail\t7\n').dataset.columns).toEqual(['name', 'price']);
  });

  it('skips empty lines without counting them', () => {
    const { dataset } = ok('name,price\nhub,5\n\nrail,7\n');
    expect(dataset.rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it('names an empty header column_N', () => {
    expect(ok('name,,price\nhub,x,5\n').dataset.columns).toEqual(['name', 'column_2', 'price']);
  });

  it('rejects duplicate header names', () => {
    expect(failure('name,price,name\nhub,5,x\n')).toContain('"name"');
  });

  it('pads a short row and reports it', () => {
    const { dataset, warnings } = ok('name,price,stock\nhub,5\nrail,7,2\n');
    expect(dataset.rows[0].cells).toEqual({ name: 'hub', price: '5', stock: '' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Row 1');
  });

  it('rejects a row with more values than the header, naming the row', () => {
    expect(failure('name,price\nhub,5\nrail,7,extra\n')).toContain('Row 2');
  });

  it('states the limit when the file has too many columns, rows or bytes', () => {
    const wideHeader = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    expect(failure(`${wideHeader}\n`)).toContain('100');
    expect(failure(`n\n${'1\n'.repeat(50_001)}`)).toContain('50,000');
    expect(failure(`n\n${'a'.repeat(10 * 1024 * 1024)}\n`)).toContain('10 MB');
  });

  it('enforces exactly the limits it exports', () => {
    const accepts = (text: string) => parseCsv(text, 'limits.csv').ok;

    const header = (columns: number) => Array.from({ length: columns }, (_, index) => `c${index}`).join(',');
    expect(accepts(`${header(UPLOAD_LIMITS.columns)}\n`)).toBe(true);
    expect(accepts(`${header(UPLOAD_LIMITS.columns + 1)}\n`)).toBe(false);

    const rows = (count: number) => `n\n${'1\n'.repeat(count)}`;
    expect(accepts(rows(UPLOAD_LIMITS.rows))).toBe(true);
    expect(accepts(rows(UPLOAD_LIMITS.rows + 1))).toBe(false);

    const ofBytes = (count: number) => `n\n${'x'.repeat(count - 2)}`;
    const maxBytes = UPLOAD_LIMITS.megabytes * 1024 * 1024;
    expect(accepts(ofBytes(maxBytes))).toBe(true);
    expect(accepts(ofBytes(maxBytes + 1))).toBe(false);
  });

  it('returns an error instead of throwing for a file with no content', () => {
    expect(failure('')).toBe('The file is empty.');
  });
});

describe('serializeCsv', () => {
  it('writes a header and one line per row, quoting only where needed', () => {
    const dataset = table(['name', 'price'], [['Alloy hub', '5'], ['Chain, 9 speed', '7']]);
    expect(serializeCsv(dataset)).toBe('name,price\r\nAlloy hub,5\r\n"Chain, 9 speed",7');
  });
});
