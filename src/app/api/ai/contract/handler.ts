// POST /api/ai/contract. SPEC §4.3 and §6.7: body limit, rate limit and error mapping.
// The body is never logged.

import { AiUnavailableError, inferContract, type ModelClient } from '../../../../ai';
import { ContractRequestSchema } from '../../../../core/contract';

const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const answer = (status: number, body: unknown, headers?: Record<string, string>) => Response.json(body, { status, headers });

/** The body as text, or null when it is larger than the limit. It stops reading at the limit. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The caller's address as the proxy reports it. Best effort: one shared bucket when unknown. */
function clientOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Builds the handler. It answers, in this order: 413 when the body is over 256 KB, 400 when
 * it is not a contract request, 429 after 20 valid requests in 10 minutes from one address,
 * 502 `ai_unavailable` when the server has no key or the model call failed twice, and
 * otherwise 200 with `{ contract, model }`. The limit is kept in memory, per server process.
 */
export function createContractHandler(dependencies: { getClient: () => ModelClient | null; now?: () => number }) {
  const now = dependencies.now ?? (() => Date.now());
  const recent = new Map<string, number[]>();

  const allowed = (client: string): boolean => {
    const time = now();
    for (const [key, times] of recent) {
      const kept = times.filter((earlier) => time - earlier < RATE_WINDOW_MS);
      if (kept.length === 0) recent.delete(key);
      else recent.set(key, kept);
    }
    const times = recent.get(client) ?? [];
    if (times.length >= RATE_LIMIT) return false;
    recent.set(client, [...times, time]);
    return true;
  };

  return async function POST(request: Request): Promise<Response> {
    const text = await readBody(request);
    if (text === null) return answer(413, { error: 'too_large' });

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return answer(400, { error: 'invalid_request' });
    }
    const parsed = ContractRequestSchema.safeParse(body);
    if (!parsed.success) return answer(400, { error: 'invalid_request' });

    if (!allowed(clientOf(request))) {
      return answer(429, { error: 'rate_limited' }, { 'Retry-After': String(RATE_WINDOW_MS / 1000) });
    }

    const client = dependencies.getClient();
    if (!client) return answer(502, { error: 'ai_unavailable' });
    try {
      const { contract, model } = await inferContract(parsed.data, { client });
      return answer(200, { contract, model });
    } catch (error) {
      if (error instanceof AiUnavailableError) return answer(502, { error: 'ai_unavailable' });
      throw error;
    }
  };
}
