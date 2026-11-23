// `npm run eval`: rules only, development dataset. SPEC §8.2 to §8.4.
// Exits with code 1 when T1 fails. The run file is written either way.
// Pass --no-write to print the report without adding a file under evals/runs/.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluate } from './evaluate';
import type { Truth } from './score';

const MODE = 'rules';
const DATASET = 'listings';

const fixturePath = (name: string) => path.join(process.cwd(), 'fixtures', name);

function main(): void {
  const csvText = readFileSync(fixturePath(`${DATASET}.dirty.csv`), 'utf8');
  const truth = JSON.parse(readFileSync(fixturePath(`${DATASET}.truth.json`), 'utf8')) as Truth;
  const sha256 = createHash('sha256').update(csvText).digest('hex');

  const evaluation = evaluate(csvText, truth, `${DATASET}.dirty.csv`);
  console.log(`Evaluation: mode ${MODE}, dataset ${DATASET}, ${evaluation.rows} rows, sha256 ${sha256.slice(0, 12)}`);
  console.log(evaluation.report);
  process.exitCode = evaluation.exitCode;

  if (process.argv.includes('--no-write')) {
    console.log('\nNo run file written (--no-write).');
    return;
  }
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runPath = path.join(process.cwd(), 'evals', 'runs', `${stamp}-${MODE}-${DATASET}.json`);
  mkdirSync(path.dirname(runPath), { recursive: true });
  writeFileSync(
    runPath,
    `${JSON.stringify(
      {
        tool: 'ai-data-cleanup-assistant',
        generatedAt,
        mode: MODE,
        dataset: DATASET,
        model: null,
        sha256,
        rows: evaluation.rows,
        analysisMs: evaluation.analysisMs,
        score: evaluation.score,
        t1: evaluation.t1,
        r2: evaluation.r2,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nRun written to ${path.relative(process.cwd(), runPath)}`);
}

main();
