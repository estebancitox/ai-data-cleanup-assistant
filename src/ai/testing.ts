// A fake model client for tests. No test calls the API.

import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { ModelClient } from './infer';

/** What the fake answers to one call: an answer, or an error to throw. */
export interface FakeAnswer {
  parsed?: unknown;
  stopReason?: string;
  model?: string;
  throws?: unknown;
}

export interface FakeModel {
  client: ModelClient;
  /** Every call the client received, in order. */
  requests: Array<{ body: MessageCreateParamsNonStreaming; options: { timeout?: number; maxRetries?: number } | undefined }>;
}

/** A client that gives the answers in order and repeats the last one. */
export function fakeModel(...answers: FakeAnswer[]): FakeModel {
  const requests: FakeModel['requests'] = [];
  const parse = async (body: MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }) => {
    requests.push({ body, options });
    const answer = answers[Math.min(requests.length, answers.length) - 1] ?? {};
    if (answer.throws !== undefined) throw answer.throws;
    return {
      model: answer.model ?? 'fake-model',
      stop_reason: answer.stopReason ?? 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 340 },
      parsed_output: answer.parsed ?? null,
      content: [],
    };
  };
  return { client: { messages: { parse } } as unknown as ModelClient, requests };
}
