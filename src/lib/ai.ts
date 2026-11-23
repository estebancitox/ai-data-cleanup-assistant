// The page's calls to the AI routes of SPEC §4.3. A call returns the answer or says why there
// is none; nothing here throws. An answer is checked against its shape before it is used.

import { z } from 'zod';
import { ContractSchema } from '../core/contract';
import type { Case, ContractRequest } from '../core/types';

/** `status` is the HTTP status, or 0 when the server was not reached or its answer was not usable. */
export type CallResult<T> = { ok: true; value: T } | { ok: false; status: number };

const VerdictsSchema = z.array(
  z.object({ issueId: z.string(), value: z.enum(['confirm', 'dismiss', 'unsure']), reason: z.string() }),
);
const StatusAnswer = z.object({ live: z.boolean(), model: z.string().nullable() });
const RecordingAnswer = z.object({
  contract: ContractSchema,
  verdicts: VerdictsSchema,
  model: z.string(),
  recordedAt: z.string(),
});
const ContractAnswer = z.object({ contract: ContractSchema, model: z.string() });
const VerdictsAnswer = z.object({ verdicts: VerdictsSchema, model: z.string() });

/** GET without a body, POST with one. */
async function call<Schema extends z.ZodType>(url: string, schema: Schema, body?: unknown): Promise<CallResult<z.infer<Schema>>> {
  try {
    const response =
      body === undefined
        ? await fetch(url)
        : await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) return { ok: false, status: response.status };
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, status: 0 };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Whether the server can call the model, and with which one. */
export const fetchStatus = () => call('/api/ai/status', StatusAnswer);

/** The recorded analysis of the file with this SHA-256; status 404 when there is none. */
export const fetchRecording = (sha256: string) => call(`/api/ai/recording?sha256=${sha256}`, RecordingAnswer);

/** A fresh contract from the model. */
export const requestContract = (request: ContractRequest) => call('/api/ai/contract', ContractAnswer, request);

/** The model's opinion on up to 10 cases. */
export const requestVerdicts = (cases: Case[]) => call('/api/ai/adjudicate', VerdictsAnswer, { cases });

/** Why an AI call gave no answer, as a sentence for the user. */
export function failureText(status: number): string {
  if (status === 413) return 'The description of this file is larger than an AI request may be.';
  if (status === 429) return 'Too many AI requests came from this address in the last 10 minutes.';
  if (status === 502) return 'The AI service did not return a usable answer.';
  return 'The AI service could not be reached.';
}
