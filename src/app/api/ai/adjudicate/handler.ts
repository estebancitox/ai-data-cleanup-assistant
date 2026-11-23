// POST /api/ai/adjudicate (S1): `{ cases }`, at most 10, in; `{ verdicts, model }` out.
// SPEC §4.3 and §6.4.

import { adjudicate, type ModelClient } from '../../../../ai';
import { AdjudicationRequestSchema } from '../../../../core/adjudicate';
import { createAiHandler, createRateLimiter, type RateLimiter } from '../handler';

export function createAdjudicateHandler(dependencies: { getClient: () => ModelClient | null; limiter?: RateLimiter; now?: () => number }) {
  return createAiHandler({
    schema: AdjudicationRequestSchema,
    getClient: dependencies.getClient,
    limiter: dependencies.limiter ?? createRateLimiter(dependencies.now),
    run: async ({ cases }, client) => {
      const { verdicts, model } = await adjudicate(cases, { client });
      return { verdicts, model };
    },
  });
}
