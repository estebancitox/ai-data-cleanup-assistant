import { afterEach, expect, it, vi } from 'vitest';
import { CASES_PER_REQUEST, CONCURRENT_REQUESTS, selectCases } from '../core/adjudicate';
import { analyze } from '../core/analyze';
import { verifyContract } from '../core/contract';
import { parseCsv } from '../core/csv';
import type { Case, Contract } from '../core/types';
import { runAnalysis } from './analysis';

afterEach(() => vi.unstubAllGlobals());

it('a run the page has left sends no later round of adjudication requests', async () => {
  // A file with enough ambiguous cases for more than one round of requests.
  const lines = Array.from({ length: 90 }, (_, index) => `P-${index},${50 + index}`).join('\n');
  const parsed = parseCsv(`id,height\n${lines}\n`, 'many.csv');
  if (!parsed.ok) throw new Error(parsed.error);
  const { dataset } = parsed;
  const contract: Contract = { columns: [], missingTokens: [], canonicalGroups: [], suspiciousValues: [], ranges: [], dependencies: [] };
  const cases = selectCases(dataset, analyze(dataset, verifyContract(contract, dataset)));
  const requestsNeeded = Math.ceil(cases.length / CASES_PER_REQUEST);
  expect(requestsNeeded).toBeGreaterThan(CONCURRENT_REQUESTS);

  let asked = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/ai/recording')) return Response.json({ error: 'not_found' }, { status: 404 });
      if (url.startsWith('/api/ai/status')) return Response.json({ live: true, model: 'a-test-model' });
      if (url.startsWith('/api/ai/contract')) return Response.json({ contract, model: 'a-test-model' });
      asked += 1;
      const body = JSON.parse(String(init?.body)) as { cases: Case[] };
      return Response.json({
        verdicts: body.cases.map((item) => ({ issueId: item.issueId, value: 'unsure', reason: 'Not enough to tell.' })),
        model: 'a-test-model',
      });
    }),
  );

  // The page consumes the snapshots and leaves at the first one after a round: "Start over".
  for await (const snapshot of runAnalysis({ dataset, sha256: 'a'.repeat(64), warnings: [] })) {
    if (snapshot.run.busy === 'adjudication' && asked > 0) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(asked).toBe(CONCURRENT_REQUESTS);
});
