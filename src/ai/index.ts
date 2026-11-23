// The AI layer. Server only: it reads the API key and the file system. It hides the SDK, the
// model id, the prompts, the retry policy and the recordings. SPEC §4.2, §6.5, §6.6.

export { AiUnavailableError, CALL_SETTINGS, createClient, inferContract, modelId } from './infer';
export type { ContractInference, ModelCall, ModelClient } from './infer';
export { findRecording, isSha256, writeRecording } from './recordings';
export type { Recording } from './recordings';
export { aiStatus } from './status';
export type { AiStatus } from './status';
