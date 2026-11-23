// `npm run eval`: rules only, development dataset. SPEC §8.2 to §8.4.
// Pass --no-write to print the report without adding a file under evals/runs/.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyze } from '../src/core/analyze';
import { scoreCandidatePairs } from '../src/core/analyze/similarity';
import { parseCsv } from '../src/core/csv';
import { score, type Recall, type Tally, type Truth } from './score';

const MODE = 'rules';
const DATASET = 'listings';
const NEAR_DUPLICATE_THRESHOLD = 0.9;

// T1 of SPEC §8.4.
const T1_FULL_RECALL: Array<{ label: string; kinds: string[] }> = [
  { label: 'exact-duplicate', kinds: ['exact-duplicate'] },
  { label: 'blank + blank-derivable', kinds: ['blank', 'blank-derivable'] },
  { label: 'case-whitespace', kinds: ['case-whitespace'] },
  { label: 'number-format', kinds: ['number-format'] },
];
const T1_NO_FALSE_POSITIVE = ['exact-duplicate', 'empty', 'whitespace', 'case-variant', 'number-format'];

const fixturePath = (name: string) => path.join(process.cwd(), 'fixtures', name);
const fixed = (value: number | null, digits = 3) => (value === null ? 'n/a' : value.toFixed(digits));

function table(title: string, header: string[], rows: string[][]): string {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  return [`\n${title}`, line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

const recallRows = (recalls: Record<string, Recall>) =>
  Object.keys(recalls)
    .sort()
    .map((key) => [key, `${recalls[key].located} of ${recalls[key].total}`, fixed(recalls[key].located / recalls[key].total, 2)]);

const tallyRows = (tallies: Record<string, Tally>) =>
  Object.keys(tallies)
    .sort()
    .map((key) => {
      const { truePositives, falsePositives, extra } = tallies[key];
      const scored = truePositives + falsePositives;
      return [key, String(truePositives), String(falsePositives), String(extra), fixed(scored === 0 ? null : truePositives / scored, 2)];
    });

function main(): void {
  const csvText = readFileSync(fixturePath(`${DATASET}.dirty.csv`), 'utf8');
  const truth = JSON.parse(readFileSync(fixturePath(`${DATASET}.truth.json`), 'utf8')) as Truth;
  const sha256 = createHash('sha256').update(csvText).digest('hex');

  const parsed = parseCsv(csvText, `${DATASET}.dirty.csv`);
  if (!parsed.ok) throw new Error(`The fixture could not be parsed: ${parsed.error}`);

  const started = performance.now();
  const analysis = analyze(parsed.dataset);
  const analysisMs = Math.round(performance.now() - started);
  const result = score(analysis.issues, truth);

  // T1
  const recallChecks = T1_FULL_RECALL.map(({ label, kinds }) => {
    const located = kinds.reduce((sum, kind) => sum + (result.recallByKind[kind]?.located ?? 0), 0);
    const total = kinds.reduce((sum, kind) => sum + (result.recallByKind[kind]?.total ?? 0), 0);
    return { label, located, total, pass: total > 0 && located === total };
  });
  const falsePositiveChecks = T1_NO_FALSE_POSITIVE.map((detector) => {
    const falsePositives = result.byDetector[detector]?.falsePositives ?? 0;
    return { detector, falsePositives, pass: falsePositives === 0 };
  });
  const t1Pass = recallChecks.every((check) => check.pass) && falsePositiveChecks.every((check) => check.pass);

  // R2 against the reference of SPEC §8.4.
  const pairs = scoreCandidatePairs(parsed.dataset, analysis.profile);
  const pairKey = (rows: number[]) => [...rows].sort((a, b) => a - b).join('+');
  const similarityOf = new Map(pairs.map((pair) => [pairKey(pair.rowIds), pair.similarity]));
  const reported = new Set(
    analysis.issues.filter((issue) => issue.type === 'duplicate').map((issue) => pairKey(issue.rowIds)),
  );
  const describe = (id: string, kind: string, rows: number[]) => ({
    id,
    kind,
    rows,
    similarity: similarityOf.get(pairKey(rows)) ?? null,
    reported: reported.has(pairKey(rows)),
  });
  const planted = truth.errors
    .filter((error) => error.type === 'duplicate')
    .map((error) => describe(error.id, error.kind, error.rows));
  const trapPairs = truth.traps.filter((trap) => trap.rows.length === 2).map((trap) => describe(trap.id, trap.kind, trap.rows));
  const known = new Set([...planted, ...trapPairs].map((pair) => pairKey(pair.rows)));
  const otherAbove = pairs.filter(
    (pair) => pair.similarity >= NEAR_DUPLICATE_THRESHOLD && !known.has(pairKey(pair.rowIds)),
  );
  const nextBelow = pairs.find((pair) => pair.similarity < NEAR_DUPLICATE_THRESHOLD) ?? null;
  const nextOtherBelow =
    pairs.find((pair) => pair.similarity < NEAR_DUPLICATE_THRESHOLD && !known.has(pairKey(pair.rowIds))) ?? null;
  const range = (items: Array<{ similarity: number | null }>) => {
    const values = items.map((item) => item.similarity).filter((value): value is number => value !== null);
    return values.length === 0 ? 'n/a' : `${fixed(Math.min(...values), 4)} to ${fixed(Math.max(...values), 4)}`;
  };
  const exactPlanted = planted.filter((pair) => pair.kind === 'exact-duplicate');
  const nearPlanted = planted.filter((pair) => pair.kind !== 'exact-duplicate');

  const out: string[] = [];
  out.push(`Evaluation: mode ${MODE}, dataset ${DATASET}, ${parsed.dataset.rows.length} rows, sha256 ${sha256.slice(0, 12)}`);
  out.push(`Rule analysis took ${analysisMs} ms.`);
  out.push(
    table('Overall', ['issues', 'TP', 'FP', 'extra', 'FN', 'precision', 'recall'], [[
      String(result.issues), String(result.truePositives), String(result.falsePositives), String(result.extra),
      String(result.falseNegatives), fixed(result.precision), fixed(result.recall),
    ]]),
  );
  out.push(table('Recall per error type', ['type', 'located', 'recall'], recallRows(result.recallByType)));
  out.push(table('Recall per error kind', ['kind', 'located', 'recall'], recallRows(result.recallByKind)));
  out.push(table('Precision per issue type', ['type', 'TP', 'FP', 'extra', 'precision'], tallyRows(result.byIssueType)));
  out.push(table('Precision per detector', ['detector', 'TP', 'FP', 'extra', 'precision'], tallyRows(result.byDetector)));
  out.push(
    table(
      'Confusion (error type -> issue type)',
      ['error type', 'issue type', 'count'],
      Object.keys(result.confusion).sort().flatMap((errorType) =>
        Object.keys(result.confusion[errorType]).sort().map((issueType) => [errorType, issueType, String(result.confusion[errorType][issueType])]),
      ),
    ),
  );
  out.push(
    table('Fixes', ['measure', 'value'], [
      ['fix accuracy', `${result.fixAccuracy.correct} of ${result.fixAccuracy.scored} (${fixed(result.fixAccuracy.scored === 0 ? null : result.fixAccuracy.correct / result.fixAccuracy.scored, 2)})`],
      ['fabricated fixes', String(result.fabricatedFixes.length)],
      ['fixes on clean data', String(result.fixesOnCleanData.length)],
      ['wrongly dismissed', String(result.wronglyDismissed.length)],
    ]),
  );
  out.push(
    table('Traps hit', ['trap', 'kind', 'detector', 'issue'],
      result.trapsHit.length === 0 ? [['none', '', '', '']] : result.trapsHit.map((hit) => [hit.trap, hit.kind, hit.detector, hit.issueId]),
    ),
  );
  out.push(
    table('T1 (SPEC 8.4)', ['check', 'measured', 'result'], [
      ...recallChecks.map((check) => [`recall ${check.label}`, `${check.located} of ${check.total}`, check.pass ? 'PASS' : 'FAIL']),
      ...falsePositiveChecks.map((check) => [`false positives ${check.detector}`, String(check.falsePositives), check.pass ? 'PASS' : 'FAIL']),
      ['T1', '', t1Pass ? 'PASS' : 'FAIL'],
    ]),
  );
  out.push(
    table('R2 against the reference of SPEC 8.4', ['measure', 'this run', 'reference'], [
      ['planted pairs reported', `${planted.filter((pair) => pair.reported).length} of ${planted.length}`, '14 of 14'],
      ['exact pairs, similarity', range(exactPlanted), '1.000'],
      ['near pairs, similarity', range(nearPlanted), '0.932 to 0.968'],
      ['trap pairs at 0.90 or more', `${trapPairs.filter((pair) => (pair.similarity ?? 0) >= NEAR_DUPLICATE_THRESHOLD).length} of ${trapPairs.length}`, '4 of 4'],
      ['trap pairs, similarity', range(trapPairs), '0.900 to 0.963'],
      ['trap pairs reported', `${trapPairs.filter((pair) => pair.reported).length} of ${trapPairs.length}`, ''],
      ['other pairs at 0.90 or more', String(otherAbove.length), '0'],
      ['highest pair under 0.90', nextBelow ? fixed(nextBelow.similarity, 4) : 'n/a', ''],
      ['highest pair under 0.90, not a trap', nextOtherBelow ? fixed(nextOtherBelow.similarity, 4) : 'n/a', '0.860'],
    ]),
  );
  console.log(out.join('\n'));

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
        rows: parsed.dataset.rows.length,
        analysisMs,
        score: result,
        t1: { pass: t1Pass, recall: recallChecks, falsePositives: falsePositiveChecks },
        r2: { threshold: NEAR_DUPLICATE_THRESHOLD, planted, trapPairs, otherAbove, nextBelow, nextOtherBelow },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nRun written to ${path.relative(process.cwd(), runPath)}`);
}

main();
