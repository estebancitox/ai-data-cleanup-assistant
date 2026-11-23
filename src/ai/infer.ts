// The contract call. SPEC §6.1 to §6.5.

import { ContractSchema } from '../core/contract';
import type { Contract, ContractRequest } from '../core/types';
import { structuredCall, type ModelCall, type ModelClient } from './call';
import { SYSTEM_PROMPT, userPrompt } from './prompts';

export interface ContractInference {
  contract: Contract;
  /** The model that answered. */
  model: string;
  calls: ModelCall[];
}

/**
 * Asks the model for the contract of one file. It retries once and then throws
 * `AiUnavailableError`; a partial or invalid contract is never returned.
 */
export async function inferContract(
  request: ContractRequest,
  options: { client: ModelClient; now?: () => number },
): Promise<ContractInference> {
  const { value, model, calls } = await structuredCall({
    client: options.client,
    system: SYSTEM_PROMPT,
    user: userPrompt(request),
    schema: ContractSchema,
    now: options.now,
  });
  return { contract: value, model, calls };
}
