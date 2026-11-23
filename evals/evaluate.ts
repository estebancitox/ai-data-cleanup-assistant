// The evaluation of one dataset: analysis, score, thresholds and the printed tables. With a
// proposed contract it is the AI evaluation (T2 and T3); without one it is the rules
// evaluation (T1). No files and no fixture names here, so that tests can run it on small
// inline data.

import { applyVerdicts, selectCases } from '../src/core/adjudicate';
import { analyze, NEAR_DUPLICATE_MIN_SIMILARITY } from '../src/core/analyze';
import { scoreCandidatePairs, type ScoredPair } from '../src/core/analyze/similarity';
import { verifyContract } from '../src/core/contract';
import { parseCsv } from '../src/core/csv';
import type { Contract, Verdict, VerifiedContract } from '../src/core/types';
import { score, type Recall, type Score, type Tally, type Truth } from './score';

// T1 of SPEC §8.4.
const T1_FULL_RECALL: Array<{ label: string; kinds: string[] }> = [
  { label: 'exact-duplicate', kinds: ['exact-duplicate'] },
  { label: 'blank + blank-derivable', kinds: ['blank', 'blank-derivable'] },
  { label: 'case-whitespace', kinds: ['case-whitespace'] },
  { label: 'number-format', kinds: ['number-format'] },
];
const T1_NO_FALSE_POSITIVE = ['exact-duplicate', 'empty', 'whitespace', 'case-variant', 'number-format'];

// T2 and T3 of SPEC §8.4.
const T2_MIN_PRECISION = 0.9;
const T2_MIN_RECALL = 0.8;
const T3_MAX_FABRICATED_FIXES = 0;
const T3_MIN_FIX_ACCURACY = 0.95;
const T3_MAX_FIXES_ON_CLEAN_DATA = 2;

export interface ThresholdCheck {
  id: 'T2' | 'T3';
  check: string;
  measured: string;
  threshold: string;
  pass: boolean;
}

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
  /** Only with a contract: what the model proposed and what the data supported. */
  contract?: { proposed: Contract; verified: VerifiedContract };
  /** Only with a contract: T2 and T3, as measured. */
  thresholds?: ThresholdCheck[];
  /** Only with verdicts: how many cases there were and what the model answered. */
  adjudication?: { cases: number; confirm: number; dismiss: number; unsure: number; unanswered: number };
  /** The tables, as printed. The same inputs give the same text. */
  report: string;
  /**
   * What the command exits with. Rules: 1 when T1 fails. With a contract: 0, because a missed
   * T2 or T3 is reported and classified (SPEC §8.5), not treated as a failed command.
   */
  exitCode: number;
}

/** T2 and T3, each as measured next to its threshold. */
export function checkThresholds(result: Score): ThresholdCheck[] {
  const accuracy = result.fixAccuracy.scored === 0 ? null : result.fixAccuracy.correct / result.fixAccuracy.scored;
  return [
    { id: 'T2', check: 'overall precision', measured: fixed(result.precision), threshold: `${fixed(T2_MIN_PRECISION, 2)} or more`, pass: (result.precision ?? 0) >= T2_MIN_PRECISION },
    { id: 'T2', check: 'overall recall', measured: fixed(result.recall), threshold: `${fixed(T2_MIN_RECALL, 2)} or more`, pass: (result.recall ?? 0) >= T2_MIN_RECALL },
    { id: 'T3', check: 'fabricated fixes', measured: String(result.fabricatedFixes.length), threshold: String(T3_MAX_FABRICATED_FIXES), pass: result.fabricatedFixes.length <= T3_MAX_FABRICATED_FIXES },
    {
      id: 'T3',
      check: 'fix accuracy',
      measured: `${fixed(accuracy)} (${result.fixAccuracy.correct} of ${result.fixAccuracy.scored})`,
      threshold: `${fixed(T3_MIN_FIX_ACCURACY, 2)} or more`,
      pass: (accuracy ?? 0) >= T3_MIN_FIX_ACCURACY,
    },
    { id: 'T3', check: 'fixes on clean data', measured: String(result.fixesOnCleanData.length), threshold: `${T3_MAX_FIXES_ON_CLEAN_DATA} or fewer`, pass: result.fixesOnCleanData.length <= T3_MAX_FIXES_ON_CLEAN_DATA },
  ];
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

/** The tables that describe a contract: what was proposed, what the data supported, what was rejected. */
function contractTables(proposed: Contract, verified: VerifiedContract): string[] {
  const rejected = (rule: string) => verified.rejected.filter((entry) => entry.rule === rule).length;
  const formats = (columns: Contract['columns']) => columns.filter((column) => column.format !== 'none').length;
  const counts: Array<[string, number, number, number]> = [
    ['columns', proposed.columns.length, verified.columns.length, rejected('column')],
    ['column formats', formats(proposed.columns), formats(verified.columns), rejected('format')],
    ['missingTokens', proposed.missingTokens.length, verified.missingTokens.length, rejected('missingToken')],
    ['canonicalGroups', proposed.canonicalGroups.length, verified.canonicalGroups.length, rejected('canonicalGroup')],
    ['suspiciousValues', proposed.suspiciousValues.length, verified.suspiciousValues.length, rejected('suspiciousValue')],
    ['ranges', proposed.ranges.length, verified.ranges.length, rejected('range')],
    ['dependencies', proposed.dependencies.length, verified.dependencies.length, rejected('dependency')],
  ];
  const accepted: string[][] = [
    ...verified.columns.filter((column) => column.format !== 'none').map((column) => ['format', `${column.name}: ${column.format}`, '']),
    ...verified.missingTokens.map((entry) => ['missingToken', `${entry.column}: "${entry.token}"`, entry.support]),
    ...verified.canonicalGroups.map((entry) => ['canonicalGroup', `${entry.column}: ${entry.variants.map((value) => `"${value}"`).join(', ')} -> "${entry.canonical}"`, entry.support]),
    ...verified.suspiciousValues.map((entry) => ['suspiciousValue', `${entry.column}: "${entry.value}"`, entry.support]),
    ...verified.ranges.map((entry) => ['range', `${entry.column}: ${entry.min || 'no lower bound'} to ${entry.max || 'no upper bound'}`, entry.support]),
    ...verified.dependencies.map((entry) => ['dependency', `${entry.determinant} -> ${entry.dependent}`, entry.support]),
  ];
  const none = [['none', '', '']];
  return [
    table('Contract (SPEC 6.3)', ['rules', 'proposed', 'verified', 'rejected'], counts.map((row) => row.map(String))),
    table('Verified rules', ['rule', 'what', 'support'], accepted.length === 0 ? none : accepted),
    table('Rejected rules', ['rule', 'what', 'reason'], verified.rejected.length === 0 ? none : verified.rejected.map((entry) => [entry.rule, entry.summary, entry.reason])),
  ];
}

/**
 * Analyses the CSV text and scores the result against the truth. Without a contract it runs
 * the rules alone. With the contract a model proposed, it verifies it against the data first
 * and runs the detectors the verified rules drive as well. With the model's verdicts, a
 * dismissed issue is not scored as an issue; it is counted apart (SPEC §8.2).
 */
export function evaluate(csvText: string, truth: Truth, fileName: string, proposed?: Contract, verdicts?: Verdict[]): Evaluation {
  const parsed = parseCsv(csvText, fileName);
  if (!parsed.ok) throw new Error(`${fileName} could not be parsed: ${parsed.error}`);

  const started = performance.now();
  const verified = proposed ? verifyContract(proposed, parsed.dataset) : undefined;
  const analysis = analyze(parsed.dataset, verified);
  const analysisMs = Math.round(performance.now() - started);
  const judged = verdicts ? applyVerdicts(analysis, verdicts) : analysis;
  const result = score(judged.issues, truth);
  const t1 = checkT1(result);
  const thresholds = proposed ? checkThresholds(result) : undefined;

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

  let adjudication: Evaluation['adjudication'];
  const out: string[] = [];
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
  if (proposed && verified && thresholds) {
    // The AI evaluation: the contract, every false positive and missed error, then T2 and T3.
    const sourceOf = new Map(analysis.issues.map((issue) => [issue.id, issue.source]));
    const missed = new Set(result.missed);
    out.push(...contractTables(proposed, verified));
    if (verdicts) {
      const answered = judged.issues.filter((issue) => issue.verdict !== undefined);
      const count = (value: string) => answered.filter((issue) => issue.verdict?.value === value).length;
      const cases = selectCases(parsed.dataset, analysis).length;
      adjudication = { cases, confirm: count('confirm'), dismiss: count('dismiss'), unsure: count('unsure'), unanswered: cases - answered.length };
      const wrongly = new Set(result.wronglyDismissed);
      const dismissed = answered.filter((issue) => issue.verdict?.value === 'dismiss');
      out.push(
        table('Adjudication (SPEC 6.4)', ['measure', 'value'], [
          ['cases sent', String(adjudication.cases)],
          ['confirm', String(adjudication.confirm)],
          ['dismiss', String(adjudication.dismiss)],
          ['unsure', String(adjudication.unsure)],
          ['no answer', String(adjudication.unanswered)],
        ]),
      );
      out.push(
        table('Dismissed by AI', ['issue', 'detector', 'rows', 'column', 'a real error?', 'the model said'],
          dismissed.length === 0
            ? [['none', '', '', '', '', '']]
            : dismissed.map((issue) => [issue.id, issue.detector, issue.rowIds.join('+'), issue.column ?? '', wrongly.has(issue.id) ? 'YES: wrongly dismissed' : 'no', issue.verdict?.reason ?? '']),
        ),
      );
    }
    out.push(
      table('False positives', ['issue', 'detector', 'source', 'rows', 'column'],
        result.falsePositiveIssues.length === 0
          ? [['none', '', '', '', '']]
          : result.falsePositiveIssues.map((issue) => [issue.issueId, issue.detector, sourceOf.get(issue.issueId) ?? '', issue.rowIds.join('+'), issue.column ?? '']),
      ),
    );
    out.push(
      table('Missed errors', ['error', 'type', 'kind', 'rows', 'columns'],
        missed.size === 0
          ? [['none', '', '', '', '']]
          : truth.errors.filter((error) => missed.has(error.id)).map((error) => [error.id, error.type, error.kind, error.rows.join('+'), error.columns.join(', ')]),
      ),
    );
    out.push(
      table('T2 and T3 (SPEC 8.4)', ['threshold', 'check', 'measured', 'required', 'result'],
        thresholds.map((check) => [check.id, check.check, check.measured, check.threshold, check.pass ? 'PASS' : 'FAIL']),
      ),
    );
  } else {
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
  }
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
    ...(proposed && verified && thresholds ? { contract: { proposed, verified }, thresholds } : {}),
    ...(adjudication ? { adjudication } : {}),
    report: out.join('\n'),
    exitCode: proposed ? 0 : t1.pass ? 0 : 1,
  };
}
