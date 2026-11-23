import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { fakeModel, verdictOnAll } from '../src/ai/testing';
import { serializeCsv } from '../src/core/csv';
import { nursery, nurseryContract } from '../src/core/testing';
import { evaluate } from './evaluate';
import { describeCalls, runLive, runRecorded, sha256Of } from './modes';
import type { Truth } from './score';

// The made-up plant nursery of the core tests, with the truth of its eight planted problems.
const csvText = serializeCsv(nursery());
const truth: Truth = {
  dataset: 'nursery',
  errors: [
    { id: 'E1', rows: [31], type: 'inconsistent', kind: 'cross-field', columns: ['species', 'genus'], fix: { column: 'genus', accept: ['Acer'] } },
    { id: 'E2', rows: [32], type: 'missing', kind: 'blank-derivable', columns: ['genus'], fix: { column: 'genus', accept: ['Quercus'] } },
    { id: 'E3', rows: [33], type: 'inconsistent', kind: 'semantic-variant', columns: ['size'], fix: { column: 'size', accept: ['Large'] } },
    { id: 'E4', rows: [34], type: 'inconsistent', kind: 'case-whitespace', columns: ['size'], fix: { column: 'size', accept: ['Large'] } },
    { id: 'E5', rows: [35], type: 'missing', kind: 'placeholder', columns: ['light'], fix: { column: 'light', accept: [''] } },
    { id: 'E6', rows: [36], type: 'suspicious', kind: 'impossible-value', columns: ['height_cm'], fix: null },
    { id: 'E7', rows: [37], type: 'suspicious', kind: 'junk-record', columns: [], fix: null },
    { id: 'E8', rows: [38], type: 'missing', kind: 'placeholder-derivable', columns: ['genus'], fix: { column: 'genus', accept: ['Quercus', ''] } },
  ],
  traps: [],
};
const input = (recordingsDirectory: string) => ({ dataset: 'nursery', csvText, truth, recordingsDirectory });
const temporary = () => mkdtempSync(path.join(os.tmpdir(), 'eval-modes-'));
const timeout = { throws: new Anthropic.APIConnectionTimeoutError() };

describe('evaluate with a contract', () => {
  it('locates what the rules alone miss, and reports T2 and T3 next to their thresholds', () => {
    const rules = evaluate(csvText, truth, 'nursery.csv');
    expect(rules.score.missed).toEqual(['E1', 'E3', 'E5', 'E7']);
    expect(rules.thresholds).toBeUndefined();

    const both = evaluate(csvText, truth, 'nursery.csv', nurseryContract());
    expect(both.score).toMatchObject({ truePositives: 8, falsePositives: 0, falseNegatives: 0, fabricatedFixes: [] });
    expect(both.score.fixAccuracy).toEqual({ correct: 6, scored: 6 });
    expect(both.thresholds?.map((check) => [check.id, check.check, check.pass])).toEqual([
      ['T2', 'overall precision', true],
      ['T2', 'overall recall', true],
      ['T3', 'fabricated fixes', true],
      ['T3', 'fix accuracy', true],
      ['T3', 'fixes on clean data', true],
    ]);
    expect(both.report).toContain('T2 and T3 (SPEC 8.4)');
    expect(both.report).toContain('Contract (SPEC 6.3)');
    expect(both.report).not.toContain('T1 (SPEC 8.4)');
    expect(both.exitCode).toBe(0);
  });

  it('prints each rejected rule with its reason', () => {
    const contract = { ...nurseryContract(), dependencies: [...nurseryContract().dependencies, { determinant: 'size', dependent: 'genus', reason: '' }] };
    const { report, contract: result } = evaluate(csvText, truth, 'nursery.csv', contract);
    expect(result?.verified.rejected).toHaveLength(1);
    const line = report.split('\n').find((text) => text.includes('size -> genus'));
    expect(line).toMatch(/^dependency\s+size -> genus\s+37\.1% of the rows agree with their group; 95\.0% are needed$/);
  });

  it('reports a missed threshold without failing the command', () => {
    // The truth knows only one of the problems, so every other issue is a false positive.
    const narrow: Truth = { ...truth, errors: truth.errors.slice(0, 1) };
    const evaluation = evaluate(csvText, narrow, 'nursery.csv', nurseryContract());
    const failed = evaluation.thresholds?.filter((check) => !check.pass).map((check) => check.check);
    expect(failed).toEqual(['overall precision', 'fixes on clean data']);
    expect(evaluation.report).toContain('FAIL');
    expect(evaluation.report).toMatch(/False positives\n[\s\S]*canonical-value\s+ai\s+33\s+size/);
    expect(evaluation.exitCode).toBe(0);
  });

  it('prints the same tables for the same inputs', () => {
    expect(evaluate(csvText, truth, 'nursery.csv', nurseryContract()).report).toBe(
      evaluate(csvText, truth, 'nursery.csv', nurseryContract()).report,
    );
  });
});

describe('eval:recorded', () => {
  it('says that a live run is needed when there is no recording', () => {
    const run = runRecorded(input(temporary()));
    expect(run.ok).toBe(false);
    expect(run.lines).toEqual([
      `No recording for the dataset nursery (sha256 ${sha256Of(csvText).slice(0, 12)}) under fixtures/recorded/.`,
      'A live run is needed first: npm run eval:live. It calls the API and needs ANTHROPIC_API_KEY in .env.local.',
    ]);
  });
});

describe('eval:live', () => {
  it('writes the recording, prints latency and token usage per call, and eval:recorded prints the same tables', async () => {
    const directory = temporary();
    const model = fakeModel(timeout, { parsed: nurseryContract(), model: 'fake-model' }, { ...verdictOnAll('confirm', 'No plant here is that tall.'), model: 'fake-model' });
    const live = await runLive({ ...input(directory), client: model.client, record: true, now: () => new Date('2000-01-01T00:00:00.000Z') });
    if (!live.ok) throw new Error(live.lines.join('\n'));

    expect(live.lines.slice(0, 4)).toEqual([
      expect.stringMatching(/^Contract call 1: no answer, \d+\.\d s, n\/a input tokens, n\/a output tokens, not used: timeout$/),
      expect.stringMatching(/^Contract call 2: fake-model, \d+\.\d s, 1200 input tokens, 340 output tokens, used$/),
      expect.stringMatching(/^Adjudication request 1, call 1: fake-model, \d+\.\d s, 1200 input tokens, 340 output tokens, used$/),
      'Live AI analysis: model fake-model, 1 cases adjudicated in 1 requests.',
    ]);

    const recording = JSON.parse(readFileSync(path.join(directory, 'nursery.json'), 'utf8'));
    expect(recording).toMatchObject({
      format: 2,
      dataset: 'nursery',
      sha256: sha256Of(csvText),
      recordedAt: '2000-01-01T00:00:00.000Z',
      model: 'fake-model',
      settings: { maxTokens: 16000, timeoutMs: 60000, effort: 'medium' },
    });
    // The contract exactly as the model returned it.
    expect(recording.contract).toEqual(nurseryContract());
    expect(recording.verdicts).toEqual([{ issueId: 'range:36:height_cm:flag', value: 'confirm', reason: 'No plant here is that tall.' }]);
    expect(recording.calls).toHaveLength(3);
    expect(live.evaluation.adjudication).toEqual({ cases: 1, confirm: 1, dismiss: 0, unsure: 0, unanswered: 0 });
    expect(live.evaluation.report).toContain('Adjudication (SPEC 6.4)');

    const recorded = runRecorded(input(directory));
    if (!recorded.ok) throw new Error(recorded.lines.join('\n'));
    expect(recorded.lines).toEqual(['Recorded AI analysis: model fake-model, recorded at 2000-01-01T00:00:00.000Z.']);
    expect(recorded.evaluation.report).toBe(live.evaluation.report);
    expect(recorded.evaluation.score).toEqual(live.evaluation.score);
    expect(recorded.verdicts).toEqual(live.verdicts);
    expect(model.requests).toHaveLength(3);
  });

  it('does not score a dismissed issue, and counts a dismissed real error as wrongly dismissed', async () => {
    const model = fakeModel({ parsed: nurseryContract() }, verdictOnAll('dismiss', 'Tall, but plausible.'));
    const live = await runLive({ ...input(temporary()), client: model.client, record: false });
    if (!live.ok) throw new Error(live.lines.join('\n'));
    const { score, report } = live.evaluation;
    // The height of 4000 is a planted error: dismissing it hides a real problem.
    expect(score).toMatchObject({ dismissed: 1, issues: 7, truePositives: 7, falseNegatives: 1, wronglyDismissed: ['range:36:height_cm:flag'] });
    expect(score.missed).toEqual(['E6']);
    expect(report).toMatch(/Dismissed by AI\n[\s\S]*range:36:height_cm:flag\s+range\s+36\s+height_cm\s+YES: wrongly dismissed\s+Tall, but plausible\./);
  });

  it('stops and writes nothing when an adjudication request fails twice', async () => {
    const directory = temporary();
    const run = await runLive({ ...input(directory), client: fakeModel({ parsed: nurseryContract() }, timeout).client, record: true });
    expect(run.ok).toBe(false);
    expect(run.lines[0]).toMatch(/^Contract call 1: .* used$/);
    expect(run.lines.at(-1)).toBe('An adjudication request reached the 60 s timeout on both attempts. No recording was written.');
    expect(existsSync(path.join(directory, 'nursery.json'))).toBe(false);
  });

  it('replays a recording made before adjudication existed, with the contract alone', () => {
    const directory = temporary();
    const old = { format: 1, dataset: 'nursery', sha256: sha256Of(csvText), recordedAt: '2000-01-01T00:00:00.000Z', model: 'fake-model', settings: {}, calls: [], contract: nurseryContract() };
    writeFileSync(path.join(directory, 'nursery.json'), JSON.stringify(old));
    const recorded = runRecorded(input(directory));
    if (!recorded.ok) throw new Error(recorded.lines.join('\n'));
    expect(recorded.verdicts).toBeUndefined();
    expect(recorded.evaluation.report).not.toContain('Adjudication (SPEC 6.4)');
    expect(recorded.evaluation.report).toBe(evaluate(csvText, truth, 'nursery.dirty.csv', nurseryContract()).report);
  });

  it('reports the latencies and writes nothing when both attempts time out', async () => {
    const directory = temporary();
    const run = await runLive({ ...input(directory), client: fakeModel(timeout).client, record: true });
    expect(run.ok).toBe(false);
    expect(run.lines).toHaveLength(3);
    expect(run.lines[0]).toMatch(/^Contract call 1: no answer, \d+\.\d s, .* not used: timeout$/);
    expect(run.lines[2]).toBe('The contract call reached the 60 s timeout on both attempts. No recording was written.');
    expect(existsSync(path.join(directory, 'nursery.json'))).toBe(false);
  });

  it('stops with a message when there is no API key', async () => {
    const run = await runLive({ ...input(temporary()), client: null, record: true });
    expect(run.ok).toBe(false);
    expect(run.lines.join(' ')).toContain('ANTHROPIC_API_KEY is not set');
  });

  it('writes no recording for the held-out run', async () => {
    const directory = temporary();
    const run = await runLive({ ...input(directory), client: fakeModel({ parsed: nurseryContract() }, verdictOnAll('unsure')).client, record: false });
    expect(run.ok).toBe(true);
    expect(run.lines.some((line) => line.startsWith('Recording written'))).toBe(false);
    expect(existsSync(path.join(directory, 'nursery.json'))).toBe(false);
  });
});

describe('describeCalls', () => {
  it('prints one line per model call', () => {
    expect(
      describeCalls([{ attempt: 1, ok: true, latencyMs: 12_340, model: 'fake-model', inputTokens: 9000, outputTokens: 2100, stopReason: 'end_turn', failure: null }]),
    ).toEqual(['Model call 1: fake-model, 12.3 s, 9000 input tokens, 2100 output tokens, used']);
  });
});
