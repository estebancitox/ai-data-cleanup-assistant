// From the bytes of a file to a dataset: the hash, the text and the parse. SPEC §5.1, §7.1.

import { parseCsv } from '../core/csv';
import type { Dataset } from '../core/types';

/**
 * The limits of SPEC §5.1, for the text next to the upload control and for refusing a file
 * before it is read into memory. The core keeps the same numbers private in `src/core/csv`;
 * `load.test.ts` pins the two together until the core exports them.
 */
export const UPLOAD_LIMITS = { megabytes: 10, rows: 50_000, columns: 100 } as const;

const MAX_BYTES = UPLOAD_LIMITS.megabytes * 1024 * 1024;

/** A file that was read and parsed. `sha256` is the hash of the bytes as they were uploaded. */
export interface LoadedFile {
  dataset: Dataset;
  warnings: string[];
  sha256: string;
}

/** `error` is a sentence for the user. */
export type LoadResult = { ok: true; file: LoadedFile } | { ok: false; error: string };

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const tooLarge = (bytes: number): LoadResult => ({
  ok: false,
  error: `This file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. The limit is ${UPLOAD_LIMITS.megabytes} MB.`,
});

/**
 * Reads the bytes of a CSV file. Never throws. A file that is not UTF-8 is refused: reading
 * it anyway would put replacement characters into the cleaned file.
 */
export async function loadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string): Promise<LoadResult> {
  if (bytes.byteLength > MAX_BYTES) return tooLarge(bytes.byteLength);

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      error:
        'This file is not saved as UTF-8 text, so some of its characters would be read wrong. Save it as "CSV UTF-8" and upload it again.',
    };
  }

  const parsed = parseCsv(text, fileName);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    file: { dataset: parsed.dataset, warnings: parsed.warnings, sha256: await sha256Hex(bytes) },
  };
}

/** Reads a file the user picked or dropped. The size is checked before the file is read. */
export async function loadFile(file: File): Promise<LoadResult> {
  if (file.size > MAX_BYTES) return tooLarge(file.size);
  try {
    return await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch {
    return { ok: false, error: 'The file could not be read. Try to upload it again.' };
  }
}
