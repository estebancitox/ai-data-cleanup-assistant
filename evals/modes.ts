// The AI evaluation modes of SPEC §8.3: recorded (no API call) and live (one fresh contract).
// The model client, the recordings directory and the clock are passed in, so that tests run
// both flows with a fake client and a temporary directory.

import { createHash } from 'node:crypto';
import {
  adjudicateAll,
  AiUnavailableError,
  CALL_SETTINGS,
  findRecording,
  inferContract,
  writeRecording,
  type ModelCall,
  type ModelClient,
} from '../src/ai';
import { selectCases } from '../src/core/adjudicate';
import { analyze } from '../src/core/analyze';
import { buildContractRequest, verifyContract } from '../src/core/contract';
import { parseCsv } from '../src/core/csv';
import type { Verdict } from '../src/core/types';
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
      /** Absent for a recording made before adjudication existed. */
      verdicts?: Verdict[];
    };

/** One line per model call: the model, the latency, the token usage and whether it was used. */
export function describeCalls(calls: ModelCall[], label = 'Model call'): string[] {
  return calls.map(
    (call) =>
      `${label} ${call.attempt}: ${call.model ?? 'no answer'}, ${(call.latencyMs / 1000).toFixed(1)} s, ` +
      `${call.inputTokens ?? 'n/a'} input tokens, ${call.outputTokens ?? 'n/a'} output tokens, ` +
      (call.ok ? 'used' : `not used: ${call.failure}`),
  );
}

/** Rules, the recorded contract and the recorded verdicts. Calls nothing. Without a recording it says a live run is needed. */
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
    evaluation: evaluate(input.csvText, input.truth, `${input.dataset}.dirty.csv`, recording.contract, recording.verdicts),
    model: recording.model,
    recordedAt: recording.recordedAt,
    calls: recording.calls,
    ...(recording.verdicts ? { verdicts: recording.verdicts } : {}),
  };
}

/**
 * Rules, a fresh contract from the model and its verdicts on the ambiguous cases. With
 * `record` it writes the recording that `runRecorded` replays; the held-out run passes false
 * (SPEC §6.6: only `eval:live` writes recordings). If any model call fails twice the run
 * stops and nothing is written.
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

  const failed = (calls: ModelCall[], described: string[], what: string): AiRun => ({
    ok: false,
    calls,
    lines: [
      ...described,
      calls.filter((call) => !call.ok).every((call) => call.failure === 'timeout')
        ? `${what} reached the ${CALL_SETTINGS.timeoutMs / 1000} s timeout on both attempts. No recording was written.`
        : `${what} failed twice. No recording was written.`,
    ],
  });

  let inference;
  try {
    inference = await inferContract(buildContractRequest(parsed.dataset), { client: input.client });
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    return failed(error.calls, describeCalls(error.calls, 'Contract call'), 'The contract call');
  }
  const lines = describeCalls(inference.calls, 'Contract call');

  // The cases come from the analysis with the verified contract, as they do in the app.
  const cases = selectCases(parsed.dataset, analyze(parsed.dataset, verifyContract(inference.contract, parsed.dataset)));
  let adjudication;
  try {
    adjudication = await adjudicateAll(cases, { client: input.client });
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    return failed([...inference.calls, ...error.calls], [...lines, ...describeCalls(error.calls, 'Adjudication call')], 'An adjudication request');
  }
  adjudication.requests.forEach((calls, index) => lines.push(...describeCalls(calls, `Adjudication request ${index + 1}, call`)));
  lines.push(`Live AI analysis: model ${inference.model}, ${cases.length} cases adjudicated in ${adjudication.requests.length} requests.`);

  const recordedAt = (input.now ?? (() => new Date()))().toISOString();
  const calls = [...inference.calls, ...adjudication.calls];
  if (input.record) {
    const file = writeRecording(
      {
        format: 2,
        dataset: input.dataset,
        sha256: sha256Of(input.csvText),
        recordedAt,
        model: inference.model,
        settings: { ...CALL_SETTINGS },
        calls,
        contract: inference.contract,
        verdicts: adjudication.verdicts,
      },
      input.recordingsDirectory,
    );
    lines.push(`Recording written to ${file}`);
  }
  return {
    ok: true,
    lines,
    evaluation: evaluate(input.csvText, input.truth, fileName, inference.contract, adjudication.verdicts),
    model: inference.model,
    recordedAt,
    calls,
    verdicts: adjudication.verdicts,
  };
}
