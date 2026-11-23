import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { parseCsv } from '../core/csv';
import { UPLOAD_LIMITS, loadBytes, loadFile, sha256Hex } from './load';

const bytesOf = (text: string) => new TextEncoder().encode(text);

it('hashes bytes with SHA-256', async () => {
  // The test vector of FIPS 180-2 for "abc".
  expect(await sha256Hex(bytesOf('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

it('loads a file and keeps the hash of its bytes', async () => {
  const bytes = bytesOf('part_id,name\nP-1,Alloy rotor\nP-2,Steel hub\n');
  const result = await loadBytes(bytes, 'parts.csv');
  if (!result.ok) throw new Error(result.error);
  expect(result.file.dataset.fileName).toBe('parts.csv');
  expect(result.file.dataset.columns).toEqual(['part_id', 'name']);
  expect(result.file.dataset.rows).toHaveLength(2);
  expect(result.file.warnings).toEqual([]);
  expect(result.file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
});

it('hashes the bytes as uploaded, byte-order mark included', async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('name\nRotor\n')]);
  const result = await loadBytes(bytes, 'parts.csv');
  if (!result.ok) throw new Error(result.error);
  expect(result.file.dataset.columns).toEqual(['name']);
  expect(result.file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
});

it('refuses a file that is not UTF-8 and says how to fix it', async () => {
  // "name\nCafé\n" as Windows-1252: the byte E9 is not valid UTF-8.
  const bytes = new Uint8Array([...bytesOf('name\nCaf'), 0xe9, 0x0a]);
  const result = await loadBytes(bytes, 'parts.csv');
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain('Save it as "CSV UTF-8" and upload it again.');
});

it('passes on the reason the parser gives', async () => {
  const text = 'name,name\nRotor,Hub\n';
  const parsed = parseCsv(text, 'parts.csv');
  expect(parsed.ok).toBe(false);
  expect(await loadBytes(bytesOf(text), 'parts.csv')).toEqual(parsed);
});

it('refuses a file over the size limit before reading it', async () => {
  const file = new File([new Uint8Array(UPLOAD_LIMITS.megabytes * 1024 * 1024 + 1)], 'big.csv');
  let read = false;
  file.arrayBuffer = () => {
    read = true;
    return Promise.resolve(new ArrayBuffer(0));
  };
  const result = await loadFile(file);
  expect(result).toEqual({ ok: false, error: 'This file is 10.0 MB. The limit is 10 MB.' });
  expect(read).toBe(false);
});

// The page states the limits and the core enforces them. Until the core exports its numbers,
// this test fails when the two stop agreeing.
it("the stated limits are the core's limits", () => {
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
