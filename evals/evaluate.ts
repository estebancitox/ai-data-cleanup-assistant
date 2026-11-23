// The evaluation of one dataset in rules mode: analysis, score, T1 and the printed report.
// No files and no fixture names here, so that tests can run it on small inline data.

import { analyze, NEAR_DUPLICATE_MIN_SIMILARITY } from '../src/core/analyze';
import { scoreCandidatePairs, type ScoredPair } from '../src/core/analyze/similarity';
import { parseCsv } from '../src/core/csv';
import { score, type Recall, type Score, type Tally, type Truth } from './score';

// T1 of SPEC §8.4.
const T1_FULL_RECALL: Array<{ label: string; kinds: string[] }> = [
  { label: 'exact-duplicate', kinds: ['exact-duplicate'] },
  { label: 'blank + blank-derivable', kinds: ['blank', 'blank-derivable'] },
  { label: 'case-whitespace', kinds: ['case-whitespace'] },
  { label: 'number-format', kinds: ['number-format'] },
];
const T1_NO_FALSE_POSITIVE = ['exact-duplicate', 'empty', 'whitespace', 'case-variant', 'number-format'];

export interface T1Result {
  pass: boolean;
  recall: Array<{ label: string; located: number; total: number; pass: boolean }>;
  /** `falsePositives` is null when the detector produced no scored issue at all. */
  falsePositives: Array<{ detector: string; falsePositives: number | null; pass: boolean }>;
}

interface PairReport {
  id: string;
  kind: string;
  rows: number[];
  similarity: number | null;
  reported: boolean;
}

export interface Evaluation {
  rows: number;
  analysisMs: number;
  score: Score;
  t1: T1Result;
  r2: {
    threshold: number;
    planted: PairReport[];
    trapPairs: PairReport[];
    otherAbove: ScoredPair[];
    nextBelow: ScoredPair | null;
    nextOtherBelow: ScoredPair | null;
  };
  /** The tables, as printed. */
  report: string;
  /** What the command exits with: 1 when T1 fails. */
  exitCode: number;
}

/**
 * T1 passes when every listed kind is fully located and every listed detector has no false
 * positive. A kind with no error and a detector with no scored issue both fail the check: a
 * name that matches nothing must not pass by default.
 */
export function checkT1(result: Score): T1Result {
  const recall = T1_FULL_RECALL.map(({ label, kinds }) => {
    const located = kinds.reduce((sum, kind) => sum + (result.recallByKind[kind]?.located ?? 0), 0);
    const total = kinds.reduce((sum, kind) => sum + (result.recallByKind[kind]?.total ?? 0), 0);
    return { label, located, total, pass: total > 0 && located === total };
  });
  const falsePositives = T1_NO_FALSE_POSITIVE.map((detector) => {
    const tally = result.byDetector[detector];
    return { detector, falsePositives: tally?.falsePositives ?? null, pass: tally?.falsePositives === 0 };
  });
  return { pass: [...recall, ...falsePositives].every((check) => check.pass), recall, falsePositives };
}

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

/** Runs the rules on the CSV text and scores the result against the truth. */
export function evaluate(csvText: string, truth: Truth, fileName: string): Evaluation {
  const parsed = parseCsv(csvText, fileName);
  if (!parsed.ok) throw new Error(`${fileName} could not be parsed: ${parsed.error}`);

  const started = performance.now();
  const analysis = analyze(parsed.dataset);
  const analysisMs = Math.round(performance.now() - started);
  const result = score(analysis.issues, truth);
  const t1 = checkT1(result);

  // How R2 scores the planted pairs and the trap pairs (SPEC §8.4).
  const threshold = NEAR_DUPLICATE_MIN_SIMILARITY;
  const pairs = scoreCandidatePairs(parsed.dataset, analysis.profile);
  const pairKey = (rows: number[]) => [...rows].sort((a, b) => a - b).join('+');
  const similarityOf = new Map(pairs.map((pair) => [pairKey(pair.rowIds), pair.similarity]));
  const reported = new Set(
    analysis.issues.filter((issue) => issue.type === 'duplicate').map((issue) => pairKey(issue.rowIds)),
  );
  const describe = (id: string, kind: string, rows: number[]): PairReport => ({
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
  const otherAbove = pairs.filter((pair) => pair.similarity >= threshold && !known.has(pairKey(pair.rowIds)));
  const nextBelow = pairs.find((pair) => pair.similarity < threshold) ?? null;
  const nextOtherBelow = pairs.find((pair) => pair.similarity < threshold && !known.has(pairKey(pair.rowIds))) ?? null;
  const range = (items: Array<{ similarity: number | null }>) => {
    const values = items.map((item) => item.similarity).filter((value): value is number => value !== null);
    return values.length === 0 ? 'n/a' : `${fixed(Math.min(...values), 4)} to ${fixed(Math.max(...values), 4)}`;
  };
  const exactPlanted = planted.filter((pair) => pair.kind === 'exact-duplicate');
  const nearPlanted = planted.filter((pair) => pair.kind !== 'exact-duplicate');
  const at = fixed(threshold, 2);

  const out: string[] = [];
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
      ...t1.recall.map((check) => [`recall ${check.label}`, `${check.located} of ${check.total}`, check.pass ? 'PASS' : 'FAIL']),
      ...t1.falsePositives.map((check) => [
        `false positives ${check.detector}`,
        check.falsePositives === null ? 'no issue from this detector' : String(check.falsePositives),
        check.pass ? 'PASS' : 'FAIL',
      ]),
      ['T1', '', t1.pass ? 'PASS' : 'FAIL'],
    ]),
  );
  out.push(
    table('R2 near-duplicate pairs (SPEC 8.4)', ['measure', 'value'], [
      ['planted pairs reported', `${planted.filter((pair) => pair.reported).length} of ${planted.length}`],
      ['exact pairs, similarity', range(exactPlanted)],
      ['near pairs, similarity', range(nearPlanted)],
      [`trap pairs at ${at} or more`, `${trapPairs.filter((pair) => (pair.similarity ?? 0) >= threshold).length} of ${trapPairs.length}`],
      ['trap pairs, similarity', range(trapPairs)],
      ['trap pairs reported', `${trapPairs.filter((pair) => pair.reported).length} of ${trapPairs.length}`],
      [`other pairs at ${at} or more`, String(otherAbove.length)],
      [`highest pair under ${at}`, nextBelow ? fixed(nextBelow.similarity, 4) : 'n/a'],
      [`highest pair under ${at}, not a trap`, nextOtherBelow ? fixed(nextOtherBelow.similarity, 4) : 'n/a'],
    ]),
  );

  return {
    rows: parsed.dataset.rows.length,
    analysisMs,
    score: result,
    t1,
    r2: { threshold, planted, trapPairs, otherAbove, nextBelow, nextOtherBelow },
    report: out.join('\n'),
    exitCode: t1.pass ? 0 : 1,
  };
}
