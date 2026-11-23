// The contract call and its rules. SPEC §6.5.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ContractSchema } from '../core/contract';
import type { Contract, ContractRequest } from '../core/types';
import { SYSTEM_PROMPT, userPrompt } from './prompts';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** One call and one retry. */
const ATTEMPTS = 2;

/**
 * The settings of the call, each with its reason.
 * - maxTokens: a hard cap on thinking plus the answer (§6.7). 16000 stays under the size from
 *   which the SDK asks for streaming, and leaves room to think before a contract of a few
 *   thousand tokens.
 * - timeoutMs: 60 s per attempt (§6.5). The SDK's own retries are switched off, so that
 *   "retry once" means two attempts and not six.
 * - thinking: left at the model's default, adaptive. Deciding which values mean the same
 *   thing is a judgment, and this model does not accept thinking switched off.
 * - effort: medium, the documented starting level for latency-sensitive work. The call sits
 *   in an interactive flow with a 60 s limit.
 */
export const CALL_SETTINGS = {
  maxTokens: 16000,
  timeoutMs: 60_000,
  thinking: 'adaptive (model default)',
  effort: 'medium',
  attempts: ATTEMPTS,
} as const;

const OUTPUT_FORMAT = zodOutputFormat(ContractSchema);

/** The part of the SDK client this module uses. Tests pass a fake with the same method. */
export type ModelClient = { messages: Pick<Anthropic['messages'], 'parse'> };

/** One attempt, for the latency and usage report of `eval:live`. No payload is kept. */
export interface ModelCall {
  attempt: number;
  ok: boolean;
  latencyMs: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  /** Why the attempt was not used, in a word: timeout, refusal, truncated... */
  failure: string | null;
}

export interface ContractInference {
  contract: Contract;
  /** The model that answered. */
  model: string;
  calls: ModelCall[];
}

/** Both attempts failed. The route answers 502 `ai_unavailable`. */
export class AiUnavailableError extends Error {
  constructor(readonly calls: ModelCall[]) {
    super('ai_unavailable');
    this.name = 'AiUnavailableError';
  }
}

/** The model id: `ANTHROPIC_MODEL`, or the default. */
export function modelId(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/** The client for live mode, or null when the server has no API key. */
export function createClient(): ModelClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey, timeout: CALL_SETTINGS.timeoutMs, maxRetries: 0 }) : null;
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'connection error';
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? 'unknown'}`;
  if (error instanceof Anthropic.AnthropicError) return 'answer does not follow the schema';
  return 'unexpected error';
}

/**
 * Asks the model for the contract of one file. On an API error, a timeout, a refusal, a
 * truncated answer or an answer that fails the schema it tries once more, then throws
 * `AiUnavailableError`. A partial or invalid contract is never returned.
 */
export async function inferContract(
  request: ContractRequest,
  options: { client: ModelClient; now?: () => number },
): Promise<ContractInference> {
  const now = options.now ?? (() => performance.now());
  const calls: ModelCall[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const started = now();
    const call: ModelCall = {
      attempt,
      ok: false,
      latencyMs: 0,
      model: null,
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
      failure: null,
    };
    calls.push(call);
    try {
      const message = await options.client.messages.parse(
        {
          model: modelId(),
          max_tokens: CALL_SETTINGS.maxTokens,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt(request) }],
          output_config: { effort: CALL_SETTINGS.effort, format: OUTPUT_FORMAT },
        },
        { timeout: CALL_SETTINGS.timeoutMs, maxRetries: 0 },
      );
      call.latencyMs = Math.round(now() - started);
      call.model = message.model;
      call.inputTokens = message.usage.input_tokens;
      call.outputTokens = message.usage.output_tokens;
      call.stopReason = message.stop_reason;
      if (message.stop_reason === 'refusal') {
        call.failure = 'refusal';
        continue;
      }
      if (message.stop_reason === 'max_tokens') {
        call.failure = 'truncated';
        continue;
      }
      // Checked here as well as by the SDK helper: this is the last gate before the answer is used.
      const contract = ContractSchema.safeParse(message.parsed_output);
      if (!contract.success) {
        call.failure = 'answer does not follow the schema';
        continue;
      }
      call.ok = true;
      return { contract: contract.data, model: message.model, calls };
    } catch (error) {
      call.latencyMs = Math.round(now() - started);
      call.failure = describeError(error);
    }
  }
  throw new AiUnavailableError(calls);
}
