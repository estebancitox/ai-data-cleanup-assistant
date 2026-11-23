// Helpers for the tests of the core. The data is a made-up bicycle parts inventory.

import { parseCsv } from './csv';
import type { ChangeLogMeta, Dataset } from './types';

/** Builds a Dataset from a header and rows of cells; row ids are 1, 2, 3... */
export function table(columns: string[], data: string[][], fileName = 'test.csv'): Dataset {
  return {
    fileName,
    columns,
    rows: data.map((cells, index) => ({
      id: index + 1,
      cells: Object.fromEntries(columns.map((name, position) => [name, cells[position] ?? ''])),
    })),
  };
}

export function load(csv: string, fileName = 'test.csv'): Dataset {
  const parsed = parseCsv(csv, fileName);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.dataset;
}

export const META: ChangeLogMeta = {
  generatedAt: '2000-01-01T00:00:00.000Z',
  sha256: 'test-hash',
  ai: { mode: 'off', model: null },
};

const MATERIALS = ['Alloy', 'Carbon', 'Steel', 'Titanium', 'Ceramic', 'Rubber'];
const PARTS = ['rotor', 'hub', 'chain', 'rail'];
const CATEGORIES = ['Brakes', 'Wheels', 'Drivetrain', 'Saddles'];
const SUPPLIERS = ['Northwind Cycles', 'Peak Components', 'Rolling Stock Ltd'];

/**
 * An inventory of 24 clean rows followed by rows with one planted problem each: an exact
 * copy, near copies, spelling and spacing variants, a formatted number, placeholders, an
 * empty cell, an outlier, a date in another format and an id with another shape.
 */
export function inventory(): Dataset {
  const columns = ['part_id', 'name', 'category', 'price', 'stock', 'supplier', 'received', 'notes'];
  const two = (n: number) => String(n).padStart(2, '0');
  const clean = (i: number): string[] => [
    `P-${100 + i}`,
    `${MATERIALS[i % 6]} ${PARTS[Math.floor(i / 6) % 4]}`,
    CATEGORIES[i % 4],
    String(20 + i * 3),
    String(5 + (i % 6)),
    SUPPLIERS[i % 3],
    `2024-${two(1 + (i % 12))}-${two(i + 1)}`,
    `Checked on arrival and shelved in aisle ${i}, bin ${i * 2}; no damage was found.`,
  ];
  const data = Array.from({ length: 24 }, (_, index) => clean(index + 1));
  const withChange = (i: number, position: number, value: string, id: string): string[] => {
    const row = clean(i);
    row[0] = id;
    row[position] = value;
    return row;
  };
  data.push(
    clean(3).map((cell, position) => (position === 5 ? `${cell}  ` : cell)), // 25: copy of row 3
    withChange(5, 7, 'Second delivery of the same part, shelved next to the first one.', 'P-205'), // 26
    withChange(5, 7, 'Third delivery of the same part, kept in the back room for now.', 'P-305'), // 27
    withChange(8, 2, 'BRAKES', 'P-208'), // 28: case variant
    withChange(9, 2, ' Wheels', 'P-209'), // 29: outer whitespace
    withChange(10, 3, ' $1,250.00', 'P-210'), // 30: formatted number
    withChange(11, 3, 'n/a', 'P-211'), // 31: strict placeholder
    withChange(13, 3, '', 'P-213'), // 32: empty
    withChange(14, 4, '500', 'P-214'), // 33: outlier
    withChange(15, 4, 'unknown', 'P-215'), // 34: soft placeholder in a number column
    withChange(16, 1, 'Titanium   rail', 'P-216'), // 35: repeated inner whitespace
    withChange(17, 6, 'Mar 5, 2024', 'P-217'), // 36: date in another format
    withChange(18, 0, 'P218', 'P218'), // 37: id with another shape
  );
  return table(columns, data, 'inventory.csv');
}
