// POST /api/ai/contract: a `ContractRequest` in, `{ contract, model }` out. SPEC §4.3.

import { inferContract, type ModelClient } from '../../../../ai';
import { ContractRequestSchema } from '../../../../core/contract';
import { createAiHandler, createRateLimiter, type RateLimiter } from '../handler';

export function createContractHandler(dependencies: { getClient: () => ModelClient | null; limiter?: RateLimiter; now?: () => number }) {
  return createAiHandler({
    schema: ContractRequestSchema,
    getClient: dependencies.getClient,
    limiter: dependencies.limiter ?? createRateLimiter(dependencies.now),
    run: async (request, client) => {
      const { contract, model } = await inferContract(request, { client });
      return { contract, model };
    },
  });
}
