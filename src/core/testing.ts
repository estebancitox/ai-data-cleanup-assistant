// Helpers for the tests of the core. The data is a made-up bicycle parts inventory.

import { parseCsv } from './csv';
import type { ChangeLogMeta, Contract, Dataset } from './types';

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

const SPECIES: Array<[string, string]> = [
  ['Acer palmatum', 'Acer'],
  ['Quercus robur', 'Quercus'],
  ['Betula pendula', 'Betula'],
];
const SIZES = ['Small', 'Medium', 'Large'];
const LIGHT = ['sun', 'shade', 'part shade'];

/**
 * The stock list of a made-up plant nursery, for the tests that need a contract: 30 clean
 * rows, where the species decides the genus, followed by rows with one planted problem each.
 */
export function nursery(): Dataset {
  const columns = ['plant_id', 'species', 'genus', 'size', 'light', 'height_cm', 'supplier_email', 'notes'];
  const clean = (i: number): string[] => [
    `N-${100 + i}`,
    SPECIES[i % 3][0],
    SPECIES[i % 3][1],
    SIZES[Math.floor(i / 3) % 3],
    LIGHT[(i * 2 + Math.floor(i / 3)) % 3],
    String(50 + i * 5),
    `orders@${i % 2 ? 'rootstock' : 'greenleaf'}.example`,
    `Potted in week ${i} and kept in tunnel ${i * 3}; watered twice a week since then.`,
  ];
  const data = Array.from({ length: 30 }, (_, index) => clean(index));
  const withChange = (i: number, position: number, value: string): string[] => {
    const row = clean(i);
    row[position] = value;
    return row;
  };
  data.push(
    withChange(30, 2, 'Quercus'), // 31: an Acer with the genus of another species
    withChange(31, 2, ''), // 32: genus left empty
    withChange(32, 3, 'Lrg'), // 33: abbreviation of a size
    withChange(33, 3, 'LARGE'), // 34: case variant of a size
    withChange(34, 4, 'tbc'), // 35: a word that stands for "no value"
    withChange(35, 5, '4000'), // 36: a height no plant here has
    withChange(36, 7, 'TEST ROW do not sell'), // 37: test data
    withChange(37, 2, 'n/a'), // 38: genus as a placeholder
  );
  return table(columns, data, 'nursery.csv');
}

/** A contract a model could propose for `nursery()`. Every rule of it is supported by the data. */
export function nurseryContract(): Contract {
  return {
    columns: [
      { name: 'supplier_email', meaning: 'supplier contact', role: 'other', format: 'email' },
      { name: 'height_cm', meaning: 'plant height', role: 'measure', format: 'none' },
    ],
    missingTokens: [{ column: 'light', token: 'tbc' }],
    canonicalGroups: [{ column: 'size', values: ['Large', 'Lrg'], reason: 'An abbreviation of the same size.' }],
    suspiciousValues: [{ column: 'notes', value: 'TEST ROW do not sell', reason: 'Looks like test data.' }],
    ranges: [{ column: 'height_cm', min: '5', max: '1000', reason: 'Heights of potted plants in centimetres.' }],
    dependencies: [{ determinant: 'species', dependent: 'genus', reason: 'A species belongs to one genus.' }],
  };
}
