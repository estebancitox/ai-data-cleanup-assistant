// Recorded AI responses. SPEC §6.6: a file whose SHA-256 matches a recording can be analysed
// with no API key. Recordings are written only by `npm run eval:live`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ContractSchema } from '../core/contract';
import type { Contract, Verdict } from '../core/types';
import type { ModelCall } from './call';

/**
 * One recording: the contract exactly as the model returned it, with what is needed to say
 * where it came from. `format` changes when the shape does: 2 added the verdicts of the
 * adjudication (S1). A recording of format 1 is still read, as one with no verdicts.
 */
export interface Recording {
  format: 1 | 2;
  /** The name of the dataset, also the name of the file: `<dataset>.json`. */
  dataset: string;
  /** SHA-256 of the CSV text the contract was inferred from, hex. */
  sha256: string;
  /** ISO 8601. */
  recordedAt: string;
  model: string;
  settings: Record<string, string | number>;
  /** The calls of the contract request, then those of every adjudication request. */
  calls: ModelCall[];
  contract: Contract;
  /** The verdicts as the model returned them, mapped to issue ids. Absent before S1. */
  verdicts?: Verdict[];
}

const RecordingSchema = z.object({
  format: z.union([z.literal(1), z.literal(2)]),
  dataset: z.string(),
  sha256: z.string(),
  recordedAt: z.string(),
  model: z.string(),
  settings: z.record(z.string(), z.union([z.string(), z.number()])),
  calls: z.array(
    z.object({
      attempt: z.number(),
      ok: z.boolean(),
      latencyMs: z.number(),
      model: z.string().nullable(),
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      stopReason: z.string().nullable(),
      failure: z.string().nullable(),
    }),
  ),
  contract: ContractSchema,
  verdicts: z
    .array(z.object({ issueId: z.string(), value: z.enum(['confirm', 'dismiss', 'unsure']), reason: z.string() }))
    .optional(),
});

const defaultDirectory = () => path.join(process.cwd(), 'fixtures', 'recorded');

/** A SHA-256 written as 64 hexadecimal characters. */
export function isSha256(text: string): boolean {
  return /^[0-9a-f]{64}$/i.test(text);
}

/**
 * The recording made from the file with this SHA-256, or null. A file in the directory that
 * is not a valid recording is skipped, never returned.
 */
export function findRecording(sha256: string, directory: string = defaultDirectory()): Recording | null {
  if (!isSha256(sha256) || !existsSync(directory)) return null;
  const wanted = sha256.toLowerCase();
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = RecordingSchema.safeParse(JSON.parse(readFileSync(path.join(directory, name), 'utf8')));
      if (parsed.success && parsed.data.sha256.toLowerCase() === wanted) return parsed.data;
    } catch {
      // Not JSON: not a recording.
    }
  }
  return null;
}

/** Writes a recording as `<dataset>.json` and returns its path. Called only by `eval:live`. */
export function writeRecording(recording: Recording, directory: string = defaultDirectory()): string {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${recording.dataset}.json`);
  writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
  return file;
}
