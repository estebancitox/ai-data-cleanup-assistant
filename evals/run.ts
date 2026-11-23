// The evaluation commands of SPEC §8.3. The mode is the first argument:
//   npm run eval            rules only, development dataset. Exits with 1 when T1 fails.
//   npm run eval:recorded   rules and the recorded contract and verdicts. Calls nothing.
//   npm run eval:live       rules and a fresh contract and verdicts; writes the recording. Calls the API.
//   npm run eval:heldout    the same on the held-out dataset, without a recording. Calls the API.
// The AI modes exit with 1 only when they could not run. The run file is written whenever a
// run completes. Pass --no-write to print the report without adding a file under evals/runs/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '../src/ai';
import { evaluate, type Evaluation } from './evaluate';
import { runLive, runRecorded, sha256Of, type AiRun } from './modes';
import type { Truth } from './score';

const MODES = ['rules', 'recorded', 'live', 'heldout'] as const;
type Mode = (typeof MODES)[number];

const DEVELOPMENT = { dataset: 'listings', directory: path.join(process.cwd(), 'fixtures') };
const HELD_OUT = { dataset: 'contacts', directory: path.join(process.cwd(), 'fixtures', 'heldout') };

function writeRun(mode: Mode, dataset: string, generatedAt: string, content: Record<string, unknown>): void {
  if (process.argv.includes('--no-write')) {
    console.log('\nNo run file written (--no-write).');
    return;
  }
  const stamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runPath = path.join(process.cwd(), 'evals', 'runs', `${stamp}-${mode}-${dataset}.json`);
  mkdirSync(path.dirname(runPath), { recursive: true });
  writeFileSync(runPath, `${JSON.stringify({ tool: 'ai-data-cleanup-assistant', generatedAt, mode, dataset, ...content }, null, 2)}\n`);
  console.log(`\nRun written to ${path.relative(process.cwd(), runPath)}`);
}

const summary = (evaluation: Evaluation) => ({
  rows: evaluation.rows,
  analysisMs: evaluation.analysisMs,
  score: evaluation.score,
});

async function main(): Promise<void> {
  const requested = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'rules';
  if (!MODES.includes(requested as Mode)) {
    console.error(`Unknown mode "${requested}". Use one of: ${MODES.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  const mode = requested as Mode;
  const { dataset, directory } = mode === 'heldout' ? HELD_OUT : DEVELOPMENT;
  const csvText = readFileSync(path.join(directory, `${dataset}.dirty.csv`), 'utf8');
  const truth = JSON.parse(readFileSync(path.join(directory, `${dataset}.truth.json`), 'utf8')) as Truth;
  const sha256 = sha256Of(csvText);
  const generatedAt = new Date().toISOString();

  if (mode === 'rules') {
    const evaluation = evaluate(csvText, truth, `${dataset}.dirty.csv`);
    console.log(`Evaluation: mode ${mode}, dataset ${dataset}, ${evaluation.rows} rows, sha256 ${sha256.slice(0, 12)}`);
    console.log(`Rule analysis took ${evaluation.analysisMs} ms.`);
    console.log(evaluation.report);
    process.exitCode = evaluation.exitCode;
    writeRun(mode, dataset, generatedAt, { model: null, sha256, ...summary(evaluation), t1: evaluation.t1, r2: evaluation.r2 });
    return;
  }

  const input = { dataset, csvText, truth };
  const run: AiRun =
    mode === 'recorded' ? runRecorded(input) : await runLive({ ...input, client: createClient(), record: mode === 'live' });
  if (!run.ok) {
    for (const line of run.lines) console.error(line);
    process.exitCode = 1;
    return;
  }
  const { evaluation } = run;
  console.log(`Evaluation: mode ${mode}, dataset ${dataset}, ${evaluation.rows} rows, sha256 ${sha256.slice(0, 12)}`);
  for (const line of run.lines) console.log(line);
  console.log(`Analysis with the contract took ${evaluation.analysisMs} ms.`);
  console.log(evaluation.report);
  process.exitCode = evaluation.exitCode;
  writeRun(mode, dataset, generatedAt, {
    model: run.model,
    sha256,
    recordedAt: run.recordedAt,
    calls: run.calls,
    ...summary(evaluation),
    thresholds: evaluation.thresholds,
    contract: evaluation.contract,
    adjudication: evaluation.adjudication,
    verdicts: run.verdicts,
    r2: evaluation.r2,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
