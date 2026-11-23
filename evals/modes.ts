// The AI evaluation modes of SPEC §8.3: recorded (no API call) and live (one fresh contract).
// The model client, the recordings directory and the clock are passed in, so that tests run
// both flows with a fake client and a temporary directory.

import { createHash } from 'node:crypto';
import {
  AiUnavailableError,
  CALL_SETTINGS,
  findRecording,
  inferContract,
  writeRecording,
  type ModelCall,
  type ModelClient,
} from '../src/ai';
import { buildContractRequest } from '../src/core/contract';
import { parseCsv } from '../src/core/csv';
import { evaluate, type Evaluation } from './evaluate';
import type { Truth } from './score';

export const sha256Of = (text: string) => createHash('sha256').update(text).digest('hex');

export interface AiRunInput {
  /** The name of the dataset: its files are `<dataset>.dirty.csv` and `<dataset>.truth.json`. */
  dataset: string;
  csvText: string;
  truth: Truth;
  /** Where recordings live. The default is `fixtures/recorded/`. */
  recordingsDirectory?: string;
}

export type AiRun =
  | { ok: false; lines: string[]; calls: ModelCall[] }
  | {
      ok: true;
      /** What the command prints before the tables. */
      lines: string[];
      evaluation: Evaluation;
      model: string;
      recordedAt: string;
      calls: ModelCall[];
    };

/** One line per model call: the model, the latency, the token usage and whether it was used. */
export function describeCalls(calls: ModelCall[]): string[] {
  return calls.map(
    (call) =>
      `Model call ${call.attempt}: ${call.model ?? 'no answer'}, ${(call.latencyMs / 1000).toFixed(1)} s, ` +
      `${call.inputTokens ?? 'n/a'} input tokens, ${call.outputTokens ?? 'n/a'} output tokens, ` +
      (call.ok ? 'used' : `not used: ${call.failure}`),
  );
}

/** Rules and the recorded contract. Calls nothing. Without a recording it says a live run is needed. */
export function runRecorded(input: AiRunInput): AiRun {
  const sha256 = sha256Of(input.csvText);
  const recording = findRecording(sha256, input.recordingsDirectory);
  if (!recording) {
    return {
      ok: false,
      calls: [],
      lines: [
        `No recording for the dataset ${input.dataset} (sha256 ${sha256.slice(0, 12)}) under fixtures/recorded/.`,
        'A live run is needed first: npm run eval:live. It calls the API and needs ANTHROPIC_API_KEY in .env.local.',
      ],
    };
  }
  return {
    ok: true,
    lines: [`Recorded AI analysis: model ${recording.model}, recorded at ${recording.recordedAt}.`],
    evaluation: evaluate(input.csvText, input.truth, `${input.dataset}.dirty.csv`, recording.contract),
    model: recording.model,
    recordedAt: recording.recordedAt,
    calls: recording.calls,
  };
}

/**
 * Rules and a fresh contract from the model. With `record` it writes the recording that
 * `runRecorded` replays; the held-out run passes false (SPEC §6.6: only `eval:live` writes
 * recordings).
 */
export async function runLive(
  input: AiRunInput & { client: ModelClient | null; record: boolean; now?: () => Date },
): Promise<AiRun> {
  if (!input.client) {
    return {
      ok: false,
      calls: [],
      lines: ['ANTHROPIC_API_KEY is not set, so no live run is possible. Put it in .env.local and run the command again.'],
    };
  }
  const fileName = `${input.dataset}.dirty.csv`;
  const parsed = parseCsv(input.csvText, fileName);
  if (!parsed.ok) throw new Error(`${fileName} could not be parsed: ${parsed.error}`);

  let inference;
  try {
    inference = await inferContract(buildContractRequest(parsed.dataset), { client: input.client });
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    const onlyTimeouts = error.calls.every((call) => call.failure === 'timeout');
    return {
      ok: false,
      calls: error.calls,
      lines: [
        ...describeCalls(error.calls),
        onlyTimeouts
          ? `Both attempts reached the ${CALL_SETTINGS.timeoutMs / 1000} s timeout. No recording was written.`
          : 'The model call failed twice. No recording was written.',
      ],
    };
  }

  const recordedAt = (input.now ?? (() => new Date()))().toISOString();
  const lines = [...describeCalls(inference.calls), `Live AI analysis: model ${inference.model}.`];
  if (input.record) {
    const file = writeRecording(
      {
        format: 1,
        dataset: input.dataset,
        sha256: sha256Of(input.csvText),
        recordedAt,
        model: inference.model,
        settings: { ...CALL_SETTINGS },
        calls: inference.calls,
        contract: inference.contract,
      },
      input.recordingsDirectory,
    );
    lines.push(`Recording written to ${file}`);
  }
  return {
    ok: true,
    lines,
    evaluation: evaluate(input.csvText, input.truth, fileName, inference.contract),
    model: inference.model,
    recordedAt,
    calls: inference.calls,
  };
}
