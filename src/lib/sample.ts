// The bundled sample. Its single source is the development fixture: the import below makes
// the bundler serve that file byte for byte, so no copy of it exists in the repository.

import sampleUrl from '../../fixtures/listings.dirty.csv';
import { loadBytes, type LoadResult } from './load';

export const SAMPLE = {
  /** Where the browser fetches the file from. */
  url: sampleUrl,
  /** The name the dataset and the exported files carry. */
  fileName: 'listings.dirty.csv',
} as const;

/** Fetches the sample and reads it through the same path as an uploaded file. */
export async function loadSample(): Promise<LoadResult> {
  try {
    const response = await fetch(SAMPLE.url);
    if (!response.ok) throw new Error(String(response.status));
    return await loadBytes(new Uint8Array(await response.arrayBuffer()), SAMPLE.fileName);
  } catch {
    return { ok: false, error: 'The sample file could not be loaded. Reload the page and try again.' };
  }
}
