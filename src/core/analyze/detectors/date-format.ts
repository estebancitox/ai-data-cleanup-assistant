// R6: dates not written in the column's dominant format, and dates that do not exist.

import { isMissing, readDate, type DateLayout, type DateReading } from '../../profile';
import type { Dataset, Profile } from '../../types';
import type { Candidate } from '../precedence';

const DOMINANT_MIN_SHARE = 0.8;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type SlashOrder = 'month-first' | 'day-first';
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function exists({ year, month, day }: CalendarDate): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * The date a reading stands for. A slash date whose two first numbers are both 12 or less is
 * ambiguous: it is read with the column's order when there is one, and is null otherwise.
 */
function meaningOf(reading: DateReading, order: SlashOrder | null): { date: CalendarDate; ambiguous: boolean } | null {
  const { year, first, second } = reading;
  if (reading.layout !== 'slash') return { date: { year, month: first, day: second }, ambiguous: false };
  const ambiguous = first <= 12 && second <= 12;
  if (ambiguous && order === null) return null;
  const monthFirst = ambiguous ? order === 'month-first' : first <= 12 || second > 12;
  return { date: monthFirst ? { year, month: first, day: second } : { year, month: second, day: first }, ambiguous };
}

/** The date in a layout, or null for a slash layout with no known order. */
function write(date: CalendarDate, layout: DateLayout, order: SlashOrder | null): string | null {
  const year = String(date.year).padStart(4, '0');
  switch (layout) {
    case 'YYYY-MM-DD':
      return `${year}-${pad(date.month)}-${pad(date.day)}`;
    case 'YYYY/MM/DD':
      return `${year}/${pad(date.month)}/${pad(date.day)}`;
    case 'Mon D, YYYY':
      return `${MONTH_NAMES[date.month - 1]} ${date.day}, ${year}`;
    case 'D Mon YYYY':
      return `${date.day} ${MONTH_NAMES[date.month - 1]} ${year}`;
    case 'slash':
      if (order === null) return null;
      return order === 'month-first'
        ? `${pad(date.month)}/${pad(date.day)}/${year}`
        : `${pad(date.day)}/${pad(date.month)}/${year}`;
  }
}

export function detectDateFormat(dataset: Dataset, profile: Profile): Candidate[] {
  const found: Candidate[] = [];
  for (const column of profile.columns) {
    if (column.kind !== 'date') continue;
    const cells: Array<{ rowId: number; current: string; reading: DateReading }> = [];
    for (const row of dataset.rows) {
      const current = row.cells[column.name] ?? '';
      if (isMissing(current, column.kind)) continue;
      const reading = readDate(current);
      if (reading) cells.push({ rowId: row.id, current, reading });
    }

    // The order of slash dates is known only if every unambiguous one agrees.
    const slash = cells.filter((cell) => cell.reading.layout === 'slash').map((cell) => cell.reading);
    const monthFirst = slash.some((reading) => reading.first <= 12 && reading.second > 12);
    const dayFirst = slash.some((reading) => reading.first > 12 && reading.second <= 12);
    const order: SlashOrder | null = monthFirst === dayFirst ? null : monthFirst ? 'month-first' : 'day-first';

    const counts = new Map<DateLayout, number>();
    for (const cell of cells) counts.set(cell.reading.layout, (counts.get(cell.reading.layout) ?? 0) + 1);
    const dominant = [...counts].find(([, count]) => count / cells.length >= DOMINANT_MIN_SHARE);

    for (const { rowId, current, reading } of cells) {
      const meaning = meaningOf(reading, order);
      const base = { source: 'rule' as const, detector: 'date-format', rowIds: [rowId], column: column.name, current };
      if (meaning && !exists(meaning.date)) {
        found.push({ ...base, type: 'suspicious', reason: 'This date does not exist in the calendar.', confidence: 'high' });
        continue;
      }
      if (!dominant || reading.layout === dominant[0]) continue;
      const evidence = `${dominant[1]} of ${cells.length} dates in this column use another format.`;
      const to = meaning ? write(meaning.date, dominant[0], order) : null;
      if (!meaning || to === null) {
        found.push({
          ...base,
          type: 'inconsistent',
          reason: 'This date is written differently from the rest of the column, and it is not clear which number is the month.',
          evidence,
          confidence: 'medium',
        });
        continue;
      }
      found.push({
        ...base,
        type: 'inconsistent',
        fix: { kind: 'set-cell', rowId, column: column.name, to },
        reason: meaning.ambiguous
          ? `This date is written differently from the rest of the column; it is read ${order === 'month-first' ? 'month first' : 'day first'}, like the other dates with slashes.`
          : 'This date is written differently from the rest of the column.',
        evidence,
        confidence: meaning.ambiguous ? 'medium' : 'high',
      });
    }
  }
  return found;
}
