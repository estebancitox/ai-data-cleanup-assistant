import { describe, expect, it } from 'vitest';
import { table } from '../testing';
import { comparisonKey, isDateText, isMissing, plainNumberText, profileDataset, quantile, readDate, readNumber } from './index';

const column = (values: string[], name = 'value') =>
  profileDataset(table([name], values.map((value) => [value]))).columns[0];

describe('value rules', () => {
  it('builds the comparison key: NFKC, trim, single spaces, lower case', () => {
    expect(comparisonKey('  Alloy   HUB ')).toBe('alloy hub');
    expect(comparisonKey('ＡＢ')).toBe('ab');
  });

  it('treats strict placeholders as missing everywhere and soft ones only outside text', () => {
    expect(isMissing('', 'text')).toBe(true);
    expect(isMissing('   ', 'text')).toBe(true);
    expect(isMissing('N/A', 'text')).toBe(true);
    expect(isMissing('none', 'text')).toBe(false);
    expect(isMissing('none', 'number')).toBe(true);
    expect(isMissing('Unknown', 'date')).toBe(true);
  });

  it('reads numbers written with currency symbols, thousands separators and spaces', () => {
    expect(plainNumberText('$1,250.00')).toBe('1250.00');
    expect(plainNumberText('1 250')).toBe('1250');
    expect(plainNumberText('€ 12.5')).toBe('12.5');
    expect(plainNumberText('007')).toBe('007');
    expect(readNumber('-3')).toBe(-3);
    expect(plainNumberText('1,5')).toBeNull();
    expect(plainNumberText('12 mm')).toBeNull();
  });

  it('removes inner spaces and tabs from a number, and never a line break', () => {
    expect(plainNumberText('1\t250')).toBe('1250');
    expect(plainNumberText('1\u00a0250')).toBe('1250');
    // A number split by a line break is not joined.
    expect(plainNumberText('1\n250')).toBeNull();
    expect(plainNumberText('1\r\n250')).toBeNull();
    expect(readNumber('$ 1\n250')).toBeNull();
    // White space around the value, a line break included, is left to R4.
    expect(plainNumberText(' 12\n')).toBe('12');
  });

  it('recognises the date formats of R6', () => {
    for (const text of ['2024-03-05', '2024/03/05', '03/05/2024', '25/12/2024', 'Mar 5, 2024', '5 Mar 2024']) {
      expect(isDateText(text)).toBe(true);
    }
    for (const text of ['2024-3-5', 'Foo 5, 2024', 'March', '20240305']) {
      expect(isDateText(text)).toBe(false);
    }
  });

  it('reads the parts of a date without judging whether it exists', () => {
    expect(readDate(' Mar 5, 2024 ')).toEqual({ layout: 'Mon D, YYYY', year: 2024, first: 3, second: 5 });
    expect(readDate('25/03/2024')).toEqual({ layout: 'slash', year: 2024, first: 25, second: 3 });
    expect(readDate('2024-13-45')).toEqual({ layout: 'YYYY-MM-DD', year: 2024, first: 13, second: 45 });
  });

  it('interpolates quantiles at position p * (n - 1)', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([10, 20], 0.95)).toBe(19.5);
  });
});

describe('profileDataset', () => {
  it('calls a column number when 90% of its values are numbers, and then soft placeholders are missing', () => {
    const values = [...Array.from({ length: 9 }, (_, i) => String(i + 1)), '$1,000', 'unknown', ''];
    const profile = column(values);
    expect(profile.kind).toBe('number');
    expect(profile.missing).toBe(2);
    expect(profile.numeric).toMatchObject({ count: 10, min: 1, max: 1000 });
  });

  it('keeps soft placeholders as values in a text column', () => {
    const profile = column(['none', 'steel', 'alloy', 'N/A']);
    expect(profile.kind).toBe('text');
    expect(profile.missing).toBe(1);
    expect(profile.distinct).toBe(3);
  });

  it('calls a column date when 90% of its values are dates', () => {
    expect(column(['2024-01-02', '01/02/2024', 'Jan 2, 2024', '2 Jan 2024']).kind).toBe('date');
    expect(column(['2024-01-02', 'soon', 'later']).kind).toBe('text');
  });

  it('counts distinct values by key and reports the ratio over non-missing cells', () => {
    const profile = column(['Hub', 'hub ', 'Rail', '']);
    expect(profile).toMatchObject({ rows: 4, missing: 1, distinct: 2 });
    expect(profile.distinctRatio).toBeCloseTo(2 / 3);
  });

  it('flags categorical, free-text and identifier-like columns', () => {
    expect(column(['Brakes', 'Wheels', 'Brakes']).categorical).toBe(true);
    expect(column(['1', '2', '3']).categorical).toBe(false);
    const sentences = Array.from({ length: 60 }, (_, i) => `Shelved in aisle ${i} after a full inspection of the box.`);
    const notes = column(sentences);
    expect(notes.freeText).toBe(true);
    expect(notes.categorical).toBe(false);
    expect(column(['a'], 'part_id').identifierLike).toBe(true);
    expect(column(['a'], 'UUID').identifierLike).toBe(true);
    expect(column(['a'], 'width').identifierLike).toBe(false);
  });

  it('lists the most common values and shapes, most frequent first', () => {
    const profile = column(['AB-12', 'CD-34', 'CD-34', 'x9']);
    expect(profile.topValues[0]).toEqual({ value: 'CD-34', count: 2 });
    expect(profile.topShapes).toEqual([
      { shape: 'AA-99', count: 3 },
      { shape: 'A9', count: 1 },
    ]);
  });

  it('returns the cached profile for the same Dataset object', () => {
    const dataset = table(['name'], [['hub']]);
    expect(profileDataset(dataset)).toBe(profileDataset(dataset));
  });
});
