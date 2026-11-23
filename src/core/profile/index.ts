// Column profile of SPEC §5.2.

import type { ColumnKind, ColumnProfile, Dataset, NumericSummary, Profile } from '../types';
import { comparisonKey, isDateText, isMissing, quantile, readNumber, shapeOf } from './values';

export { comparisonKey, isDateText, isMissing, missingReason, plainNumberText, quantile, readDate, readNumber, shapeOf } from './values';
export type { DateLayout, DateReading } from './values';

const KIND_MIN_SHARE = 0.9;
const CATEGORICAL_MAX_DISTINCT = 50;
const CATEGORICAL_MAX_RATIO = 0.1;
const FREE_TEXT_MIN_AVERAGE_LENGTH = 40;
const FREE_TEXT_MIN_RATIO = 0.5;
const IDENTIFIER_HEADER = /(^|_)(id|uuid|key)$/i;
const TOP_VALUES = 50;
const TOP_SHAPES = 5;

const cache = new WeakMap<Dataset, Profile>();

/**
 * Describes every column: kind, counts, most common values, value shapes and numeric spread.
 * Pure and deterministic. Calling it again for the same Dataset object returns the cached result.
 */
export function profileDataset(dataset: Dataset): Profile {
  const cached = cache.get(dataset);
  if (cached) return cached;
  const profile: Profile = {
    rowCount: dataset.rows.length,
    columns: dataset.columns.map((name) =>
      profileColumn(name, dataset.rows.map((row) => row.cells[name] ?? '')),
    ),
  };
  cache.set(dataset, profile);
  return profile;
}

/**
 * The kind is decided over the values that are not empty and not a placeholder of either
 * list. Soft placeholders then count as missing only if the kind is number or date.
 */
function inferKind(values: string[]): ColumnKind {
  const candidates = values.filter((value) => !isMissing(value, 'number'));
  if (candidates.length === 0) return 'text';
  const share = (test: (value: string) => boolean) => candidates.filter(test).length / candidates.length;
  if (share((value) => readNumber(value) !== null) >= KIND_MIN_SHARE) return 'number';
  if (share(isDateText) >= KIND_MIN_SHARE) return 'date';
  return 'text';
}

/** The most common entries first; ties keep the order of first appearance. */
function mostCommon(items: string[], limit: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function summarise(numbers: number[]): NumericSummary {
  const sorted = [...numbers].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p5: quantile(sorted, 0.05),
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function profileColumn(name: string, values: string[]): ColumnProfile {
  const kind = inferKind(values);
  const present = values.filter((value) => !isMissing(value, kind));
  const distinct = new Set(present.map(comparisonKey)).size;
  const distinctRatio = present.length === 0 ? 0 : distinct / present.length;
  const averageLength =
    present.length === 0 ? 0 : present.reduce((sum, value) => sum + value.length, 0) / present.length;

  const column: ColumnProfile = {
    name,
    kind,
    rows: values.length,
    missing: values.length - present.length,
    distinct,
    distinctRatio,
    categorical:
      kind === 'text' && (distinct <= CATEGORICAL_MAX_DISTINCT || distinctRatio <= CATEGORICAL_MAX_RATIO),
    freeText: averageLength > FREE_TEXT_MIN_AVERAGE_LENGTH && distinctRatio > FREE_TEXT_MIN_RATIO,
    identifierLike: IDENTIFIER_HEADER.test(name),
    topValues: mostCommon(present, TOP_VALUES).map(([value, count]) => ({ value, count })),
    topShapes: mostCommon(present.map(shapeOf), TOP_SHAPES).map(([shape, count]) => ({ shape, count })),
  };

  if (kind === 'number') {
    const numbers = present.map(readNumber).filter((n): n is number => n !== null);
    if (numbers.length > 0) column.numeric = summarise(numbers);
  }
  return column;
}
