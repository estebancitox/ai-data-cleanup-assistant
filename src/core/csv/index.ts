// CSV reading and writing. SPEC §5.1.

import Papa from 'papaparse';
import type { Dataset, Row } from '../types';

/** The limits of SPEC §5.1. Exported so that the page can state them next to the upload control. */
export const UPLOAD_LIMITS = { megabytes: 10, rows: 50_000, columns: 100 } as const;

const MAX_BYTES = UPLOAD_LIMITS.megabytes * 1024 * 1024;
const MAX_ROWS = UPLOAD_LIMITS.rows;
const MAX_COLUMNS = UPLOAD_LIMITS.columns;

export type ParseResult =
  | { ok: true; dataset: Dataset; warnings: string[] }
  | { ok: false; error: string };

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Reads CSV text into a Dataset. Values are kept exactly as written: no trimming and no type
 * conversion. Never throws: a file that cannot be used returns ok: false with a message for
 * the user. Warnings describe rows that were loaded but look damaged.
 */
export function parseCsv(text: string, fileName: string): ParseResult {
  try {
    return parse(text, fileName);
  } catch {
    return { ok: false, error: 'The file could not be read as CSV.' };
  }
}

function parse(text: string, fileName: string): ParseResult {
  if (utf8Bytes(text) > MAX_BYTES) {
    return { ok: false, error: `The file is larger than the limit of ${UPLOAD_LIMITS.megabytes} MB.` };
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(body, { header: false, skipEmptyLines: true });
  const [header, ...records] = parsed.data;
  if (!header) return { ok: false, error: 'The file is empty.' };

  if (header.length > MAX_COLUMNS) {
    return { ok: false, error: `The file has ${header.length} columns. The limit is ${MAX_COLUMNS}.` };
  }
  if (records.length > MAX_ROWS) {
    return {
      ok: false,
      error: `The file has ${records.length} data rows. The limit is ${MAX_ROWS.toLocaleString('en-US')}.`,
    };
  }

  const columns = header.map((name, index) => (name.trim() === '' ? `column_${index + 1}` : name));
  const seen = new Set<string>();
  for (const name of columns) {
    if (seen.has(name)) {
      return { ok: false, error: `The header has two columns named "${name}". Column names must be unique.` };
    }
    seen.add(name);
  }

  const warnings: string[] = [];
  const rows: Row[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const fields = records[index];
    const id = index + 1;
    if (fields.length > columns.length) {
      return {
        ok: false,
        error: `Row ${id} has ${fields.length} values but the header has ${columns.length} columns. Nothing was loaded, because dropping the extra values would lose data.`,
      };
    }
    if (fields.length < columns.length) {
      warnings.push(
        `Row ${id} has ${fields.length} values but the header has ${columns.length} columns. The missing cells were left empty.`,
      );
    }
    const cells: Record<string, string> = {};
    columns.forEach((name, position) => {
      cells[name] = fields[position] ?? '';
    });
    rows.push({ id, cells });
  }

  for (const error of parsed.errors) {
    if (error.type === 'Quotes') {
      const where = typeof error.row === 'number' ? ` near line ${error.row + 1}` : '';
      warnings.push(`A quoted value${where} is not closed properly. Check the rows around it.`);
    }
  }

  return { ok: true, dataset: { fileName, columns, rows }, warnings };
}

// A value is quoted when a parser that detects the delimiter could split or trim it.
const NEEDS_QUOTES = /[\t|;\u001e\u001f]|^\s|\s$/;

/** Writes a Dataset as CSV text that parseCsv reads back to the same Dataset. */
export function serializeCsv(dataset: Dataset): string {
  return Papa.unparse(
    {
      fields: dataset.columns,
      data: dataset.rows.map((row) => dataset.columns.map((name) => row.cells[name] ?? '')),
    },
    { quotes: (value: unknown) => typeof value === 'string' && NEEDS_QUOTES.test(value) },
  );
}
