// Value-level rules of SPEC §5.2: what "the same value", "missing", "a number" and "a date"
// mean. Every other module asks these functions instead of repeating the rules.

import type { ColumnKind } from '../types';

/** Two values are the same value written differently when their keys are equal. */
export function comparisonKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

const STRICT_PLACEHOLDERS = new Set([
  'n/a', '#n/a', 'null', 'nil', 'nan', 'undefined', '-', '--', '?', 'tbd',
]);
const SOFT_PLACEHOLDERS = new Set([
  'na', 'none', 'unknown', 'missing', 'not available', 'pending',
]);

export type MissingReason = 'empty' | 'placeholder';

/**
 * Why a cell counts as missing in a column of this kind, or null when it holds a value.
 * Soft placeholders only count in number and date columns: in text they can be real values.
 */
export function missingReason(value: string, kind: ColumnKind): MissingReason | null {
  const key = comparisonKey(value);
  if (key === '') return 'empty';
  if (STRICT_PLACEHOLDERS.has(key)) return 'placeholder';
  if (kind !== 'text' && SOFT_PLACEHOLDERS.has(key)) return 'placeholder';
  return null;
}

export function isMissing(value: string, kind: ColumnKind): boolean {
  return missingReason(value, kind) !== null;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * The plain form of a value that is a number once currency symbols, thousands separators and
 * spaces are removed, or null. The result is cut out of the value's own text, never reprinted
 * from a parsed number, so leading zeros and decimals survive.
 */
export function plainNumberText(value: string): string | null {
  const bare = value.replace(/\p{Sc}/gu, '').replace(/\s+/g, '');
  if (PLAIN_NUMBER.test(bare)) return bare;
  if (GROUPED_NUMBER.test(bare)) return bare.replace(/,/g, '');
  return null;
}

/** The number a value holds after the normalisation of R5, or null. */
export function readNumber(value: string): number | null {
  const text = plainNumberText(value);
  return text === null ? null : Number(text);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ISO_DATE = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const MONTH_THEN_DAY = /^([a-z]{3}) (\d{1,2}), (\d{4})$/i;
const DAY_THEN_MONTH = /^(\d{1,2}) ([a-z]{3}) (\d{4})$/i;

/** MM/DD/YYYY and DD/MM/YYYY share the layout 'slash': the text alone does not tell them apart. */
export type DateLayout = 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'slash' | 'Mon D, YYYY' | 'D Mon YYYY';

export interface DateReading {
  layout: DateLayout;
  year: number;
  /** For 'slash', the first and second numbers as written. Otherwise the month and the day. */
  first: number;
  second: number;
}

/**
 * Reads a value written in one of the date formats of R6, or returns null. It only reads the
 * text: whether the date exists, and which slash number is the month, is decided by R6.
 */
export function readDate(value: string): DateReading | null {
  const text = value.trim();
  const iso = ISO_DATE.exec(text);
  if (iso) {
    return { layout: iso[2] === '-' ? 'YYYY-MM-DD' : 'YYYY/MM/DD', year: Number(iso[1]), first: Number(iso[3]), second: Number(iso[4]) };
  }
  const slash = SLASH_DATE.exec(text);
  if (slash) return { layout: 'slash', year: Number(slash[3]), first: Number(slash[1]), second: Number(slash[2]) };
  const monthThenDay = MONTH_THEN_DAY.exec(text);
  if (monthThenDay) {
    const month = MONTHS.indexOf(monthThenDay[1].toLowerCase()) + 1;
    return month === 0 ? null : { layout: 'Mon D, YYYY', year: Number(monthThenDay[3]), first: month, second: Number(monthThenDay[2]) };
  }
  const dayThenMonth = DAY_THEN_MONTH.exec(text);
  if (dayThenMonth) {
    const month = MONTHS.indexOf(dayThenMonth[2].toLowerCase()) + 1;
    return month === 0 ? null : { layout: 'D Mon YYYY', year: Number(dayThenMonth[3]), first: month, second: Number(dayThenMonth[1]) };
  }
  return null;
}

/** True when the value is written in one of the date formats of R6. */
export function isDateText(value: string): boolean {
  return readDate(value) !== null;
}

/** Every letter becomes A, every digit becomes 9, other characters stay. */
export function shapeOf(value: string): string {
  return value.replace(/\p{L}/gu, 'A').replace(/\p{Nd}/gu, '9');
}

/** Quantile of ascending values: position p * (n - 1), linear interpolation. */
export function quantile(sorted: number[], p: number): number {
  const position = p * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
