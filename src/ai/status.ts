// SPEC §6.6: live mode exists when the server has an API key.

import { modelId } from './infer';

export interface AiStatus {
  live: boolean;
  model: string | null;
}

/** Whether the server can call the model now, and with which model. Read on every call. */
export function aiStatus(): AiStatus {
  const live = Boolean(process.env.ANTHROPIC_API_KEY);
  return { live, model: live ? modelId() : null };
}
