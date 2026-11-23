// SPEC §6.1: the description of the file that is sent to the model.

import { isMissing, profileDataset } from '../profile';
import type { ColumnProfile, ContractRequest, Dataset } from '../types';

/** A column lists every distinct value when it has this many or fewer. */
export const VALUE_CAP = 200;
const VALUE_CAP_FLOOR = 20;
const MOST_COMMON = 20;
const SEEDED_VALUES = 10;
export const VALUE_MAX_LENGTH = 80;
const FIRST_ROWS = 5;
const SEEDED_ROWS = 15;
export const SAMPLE_ROWS = FIRST_ROWS + SEEDED_ROWS;
export const TOP_SHAPES = 5;
/** SPEC §5.1: the most columns a dataset can have. */
export const MAX_COLUMNS = 100;
const MAX_REQUEST_BYTES = 200 * 1024;
const SEED = 20261123;

/** mulberry32: a small generator that gives the same sequence for the same seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` positions out of `length`, picked with the seed and returned in ascending order. */
function pick(length: number, count: number, seed: number): number[] {
  const random = generator(seed);
  const positions = Array.from({ length }, (_, index) => index);
  const taken = Math.min(count, length);
  for (let i = 0; i < taken; i += 1) {
    const j = i + Math.floor(random() * (length - i));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, taken).sort((a, b) => a - b);
}

const cut = (value: string) => (value.length > VALUE_MAX_LENGTH ? value.slice(0, VALUE_MAX_LENGTH) : value);

/**
 * The values of a column with their counts, most common first (tie: first seen). Every
 * distinct value when there are `cap` or fewer; otherwise the 20 most common and 10 more
 * picked with a fixed seed.
 */
function listValues(dataset: Dataset, column: ColumnProfile, position: number, cap: number) {
  const counts = new Map<string, number>();
  for (const row of dataset.rows) {
    const value = row.cells[column.name] ?? '';
    if (!isMissing(value, column.kind)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const allValues = ranked.length <= cap;
  const chosen = allValues
    ? ranked
    : [
        ...ranked.slice(0, MOST_COMMON),
        ...pick(ranked.length - MOST_COMMON, SEEDED_VALUES, SEED + position).map((index) => ranked[MOST_COMMON + index]),
      ];
  return {
    allValues,
    values: chosen.map(([value, count]) => ({ value: cut(value), count, cut: value.length > VALUE_MAX_LENGTH })),
  };
}

function build(dataset: Dataset, cap: number): ContractRequest {
  const profile = profileDataset(dataset);
  const rows = dataset.rows;
  const sampled = [
    ...rows.slice(0, FIRST_ROWS),
    ...pick(Math.max(0, rows.length - FIRST_ROWS), SEEDED_ROWS, SEED).map((index) => rows[FIRST_ROWS + index]),
  ];
  return {
    rowCount: profile.rowCount,
    columns: profile.columns.map((column, position) => ({
      name: column.name,
      kind: column.kind,
      rows: column.rows,
      missing: column.missing,
      distinct: column.distinct,
      categorical: column.categorical,
      freeText: column.freeText,
      identifierLike: column.identifierLike,
      ...(column.numeric ? { numeric: column.numeric } : {}),
      shapes: column.topShapes.slice(0, TOP_SHAPES),
      ...listValues(dataset, column, position, cap),
    })),
    sampleRows: sampled.map((row) => dataset.columns.map((name) => cut(row.cells[name] ?? ''))),
  };
}

const byteLength = (request: ContractRequest) => new TextEncoder().encode(JSON.stringify(request)).length;

/**
 * Builds the only description of the file that is sent to the model. It contains column
 * statistics, a capped list of values per column and a small sample of rows, never the whole
 * file. The UI shows this object to the user before sending it.
 *
 * If the description is larger than 200 KB, the number of distinct values a column may list
 * in full is halved until it fits, down to 20. A file that still does not fit is returned as
 * it is; the route refuses it.
 */
export function buildContractRequest(dataset: Dataset): ContractRequest {
  let cap = VALUE_CAP;
  let request = build(dataset, cap);
  while (byteLength(request) > MAX_REQUEST_BYTES && cap > VALUE_CAP_FLOOR) {
    cap = Math.max(VALUE_CAP_FLOOR, Math.floor(cap / 2));
    request = build(dataset, cap);
  }
  return request;
}
