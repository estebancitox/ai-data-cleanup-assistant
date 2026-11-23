// What the AI routes that call the model have in common. SPEC §4.3 and §6.7: the body limit,
// the rate limit and the error mapping. A body is never logged.

import type { z } from 'zod';
import { AiUnavailableError, type ModelClient } from '../../../ai';

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

/** Says whether one more AI request from this address is allowed now, and counts it if so. */
export type RateLimiter = (client: string) => boolean;

/** 20 AI requests per 10 minutes per address, kept in memory, per server process. */
export function createRateLimiter(now: () => number = () => Date.now()): RateLimiter {
  const recent = new Map<string, number[]>();
  return (client) => {
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
}

/** The limiter the routes of this server share: a contract request and an adjudication request count alike. */
export const sharedRateLimiter = createRateLimiter();

/**
 * Builds a POST handler for a route that calls the model. It answers, in this order: 413 when
 * the body is over 256 KB, 400 when it does not follow `schema`, 429 after 20 valid requests
 * in 10 minutes from one address, 502 `ai_unavailable` when the server has no key or the model
 * call failed twice, and otherwise 200 with what `run` returns.
 */
export function createAiHandler<Schema extends z.ZodType>(options: {
  schema: Schema;
  run: (input: z.infer<Schema>, client: ModelClient) => Promise<unknown>;
  getClient: () => ModelClient | null;
  limiter: RateLimiter;
}) {
  return async function POST(request: Request): Promise<Response> {
    const text = await readBody(request);
    if (text === null) return answer(413, { error: 'too_large' });

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return answer(400, { error: 'invalid_request' });
    }
    const parsed = options.schema.safeParse(body);
    if (!parsed.success) return answer(400, { error: 'invalid_request' });

    if (!options.limiter(clientOf(request))) {
      return answer(429, { error: 'rate_limited' }, { 'Retry-After': String(RATE_WINDOW_MS / 1000) });
    }

    const client = options.getClient();
    if (!client) return answer(502, { error: 'ai_unavailable' });
    try {
      return answer(200, await options.run(parsed.data, client));
    } catch (error) {
      if (error instanceof AiUnavailableError) return answer(502, { error: 'ai_unavailable' });
      throw error;
    }
  };
}
