// @vitest-environment jsdom

// The page with the AI layer, driven as a user drives it. The seam is the real one. `fetch`
// is answered by the real recording and status handlers, so the recording served is the
// committed one; the two routes that call the model are answered by each test.

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRecordingHandler } from '../app/api/ai/recording/handler';
import { GET as statusRoute } from '../app/api/ai/status/route';
import { applyVerdicts, selectCases } from '../core/adjudicate';
import { analyze, groupIssues } from '../core/analyze';
import { verifyContract } from '../core/contract';
import { parseCsv } from '../core/csv';
import type { Analysis, Case, Contract, Issue, IssueGroup, Verdict } from '../core/types';
import type { AnalysisSnapshot } from '../lib/analysis';
import { describeGroup } from '../lib/describe';
import type { LoadedFile } from '../lib/load';
import { Assistant } from './Assistant';

// The real seam, with a record of what it yielded: the very snapshots the page was given.
const seam = vi.hoisted(() => ({ snapshots: [] as AnalysisSnapshot[] }));
vi.mock('../lib/analysis', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/analysis')>();
  return {
    ...real,
    async *runAnalysis(file: LoadedFile) {
      for await (const snapshot of real.runAnalysis(file)) {
        seam.snapshots.push(snapshot);
        yield snapshot;
      }
    },
  };
});

const SAMPLE_BYTES = readFileSync('fixtures/listings.dirty.csv');
const RECORDING = JSON.parse(readFileSync('fixtures/recorded/listings.json', 'utf8')) as {
  contract: Contract;
  verdicts: Verdict[];
  model: string;
};

const parsed = parseCsv(SAMPLE_BYTES.toString('utf8'), 'listings.dirty.csv');
if (!parsed.ok) throw new Error(parsed.error);
const { dataset } = parsed;
const rules = analyze(dataset);
const withContract = analyze(dataset, verifyContract(RECORDING.contract, dataset));
const recorded = applyVerdicts(withContract, RECORDING.verdicts);

const ids = (analysis: Analysis) => analysis.issues.map((issue) => issue.id);
const dismissedIn = (analysis: Analysis) => analysis.issues.filter((issue) => issue.verdict?.value === 'dismiss');
const shownIn = (analysis: Analysis) => analysis.issues.filter((issue) => issue.verdict?.value !== 'dismiss');
const titleOf = (group: IssueGroup) => describeGroup(group).title;
const button = (name: string) => screen.getByRole('button', { name });
const counts = () => screen.getByRole('status').textContent;
const lastSnapshot = () => seam.snapshots[seam.snapshots.length - 1];
const hasFix = (issue: Issue) => issue.fix !== undefined;

/** How the server of a test answers. The recording and the status come from the real handlers. */
interface Server {
  /** False makes the recording route answer 404, as it does for a file that was never recorded. */
  recording: boolean;
  /** The server has an API key. */
  live: boolean;
  /** The status route fails. */
  statusDown?: boolean;
  /** Holds the recording's answer back until it settles. */
  recordingGate?: Promise<void>;
  contract?: () => Response;
  adjudicate?: (cases: Case[]) => Response;
}

const requests: Array<{ method: string; url: string }> = [];
const aiPosts = () => requests.filter((request) => request.method === 'POST' || /\/api\/ai\/(contract|adjudicate)/.test(request.url));

function serve(server: Server) {
  vi.stubEnv('ANTHROPIC_API_KEY', server.live ? 'a-test-key' : '');
  const recordingRoute = createRecordingHandler();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: init?.method ?? 'GET', url });
      if (url.startsWith('/api/ai/recording')) {
        await server.recordingGate;
        if (!server.recording) return Response.json({ error: 'not_found' }, { status: 404 });
        return recordingRoute(new Request(`http://localhost${url}`));
      }
      if (url.startsWith('/api/ai/status')) return server.statusDown ? new Response('', { status: 500 }) : statusRoute();
      if (url.startsWith('/api/ai/contract')) return server.contract?.() ?? Response.json({ error: 'ai_unavailable' }, { status: 502 });
      if (url.startsWith('/api/ai/adjudicate')) {
        const { cases } = JSON.parse(String(init?.body)) as { cases: Case[] };
        return server.adjudicate?.(cases) ?? Response.json({ error: 'ai_unavailable' }, { status: 502 });
      }
      return new Response(new Uint8Array(SAMPLE_BYTES));
    }),
  );
}

beforeEach(() => {
  seam.snapshots.length = 0;
  requests.length = 0;
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function openSample() {
  const user = userEvent.setup();
  render(<Assistant />);
  await user.click(button('Use sample data'));
  await screen.findByRole('button', { name: 'Download cleaned CSV' });
  return user;
}

it('sample without a key shows the recorded analysis', async () => {
  serve({ recording: true, live: false });
  await openSample();

  // The mode, with the model and the date of the recording.
  expect(await screen.findByText(`Recorded AI analysis · ${RECORDING.model} · recorded 2026-11-23 21:26 UTC`)).toBeTruthy();

  // Exactly the issues of analyze(dataset, verifyContract(contract, dataset)), with the
  // recorded verdicts attached to them (SPEC §6.6).
  const { analysis, ai, run } = lastSnapshot();
  expect(ids(analysis)).toEqual(ids(withContract));
  expect(analysis).toEqual(recorded);
  expect(ai).toEqual({ mode: 'recorded', model: RECORDING.model });
  expect(run.runLive).toBeUndefined();

  // On the page: every issue the AI did not dismiss is in its group, and the rest are set aside.
  const dismissed = dismissedIn(recorded);
  expect(dismissed.length).toBeGreaterThan(0);
  const groups = groupIssues(shownIn(recorded));
  expect(screen.getAllByRole('group')).toHaveLength(groups.length);
  for (const group of groups) expect(screen.getByRole('group', { name: titleOf(group) })).toBeTruthy();
  expect(counts()).toBe(`0 accepted, 0 rejected, ${shownIn(recorded).length} pending`);
  expect(button(`Dismissed by AI (${dismissed.length})`)).toBeTruthy();

  // The "AI rules" panel, and no request that would call the model.
  expect(screen.getByRole('heading', { name: 'AI rules' })).toBeTruthy();
  expect(aiPosts()).toEqual([]);
});

it('an issue dismissed by AI can be restored, and is then decided like any other', async () => {
  serve({ recording: true, live: false });
  const user = await openSample();
  const dismissed = dismissedIn(recorded);
  await user.click(await screen.findByRole('button', { name: `Dismissed by AI (${dismissed.length})` }));

  const pair = dismissed.find((issue) => issue.fix?.kind === 'delete-row');
  if (pair?.fix?.kind !== 'delete-row' || !pair.verdict) throw new Error('the recording dismisses no duplicate candidate');
  const name = `remove row ${pair.fix.rowId}, keep row ${pair.fix.keepRowId}`;
  expect(screen.getByText(pair.verdict.reason)).toBeTruthy();
  await user.click(button(`Restore: ${name}`));

  expect(button(`Dismissed by AI (${dismissed.length - 1})`)).toBeTruthy();
  expect(counts()).toBe(`0 accepted, 0 rejected, ${shownIn(recorded).length + 1} pending`);
});

it('a failed contract call keeps the rule-based result', async () => {
  let attempts = 0;
  serve({
    recording: false,
    live: true,
    contract: () => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: 'ai_unavailable' }, { status: 502 })
        : Response.json({ contract: RECORDING.contract, model: 'a-test-model' });
    },
    adjudicate: (cases) =>
      Response.json({
        verdicts: RECORDING.verdicts.filter((verdict) => cases.some((item) => item.issueId === verdict.issueId)),
        model: 'a-test-model',
      }),
  });
  const user = await openSample();

  // After the 502: the notice, the retry control, and the rule-based issues as they were.
  expect((await screen.findByRole('alert')).textContent).toContain('The AI service did not return a usable answer.');
  expect(lastSnapshot().analysis).toEqual(rules);
  expect(lastSnapshot().ai).toEqual({ mode: 'off', model: null });
  expect(screen.getAllByRole('group')).toHaveLength(groupIssues(rules.issues).length);
  expect(counts()).toBe(`0 accepted, 0 rejected, ${rules.issues.length} pending`);

  // Retry asks for the same step again, and the analysis with the contract arrives.
  await user.click(button('Retry'));
  await screen.findByRole('button', { name: `Dismissed by AI (${dismissedIn(recorded).length})` });
  expect(screen.getByRole('heading', { name: 'AI rules' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(lastSnapshot().analysis).toEqual(recorded);
  expect(lastSnapshot().ai).toEqual({ mode: 'live', model: 'a-test-model' });
  // 1 failed and 1 answered contract request, then the cases in requests of 10.
  const cases = selectCases(dataset, withContract).length;
  expect(requests.filter((request) => request.url === '/api/ai/contract')).toHaveLength(2);
  expect(requests.filter((request) => request.url === '/api/ai/adjudicate')).toHaveLength(Math.ceil(cases / 10));
});

it('decisions survive the contract', async () => {
  let release = () => {};
  serve({
    recording: true,
    live: false,
    recordingGate: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  const user = await openSample();

  // On the first snapshot, the rule-based one: accept a whole group of fixes and reject one flag.
  expect(lastSnapshot().analysis).toEqual(rules);
  const stays = new Set(ids(recorded));
  const group = groupIssues(rules.issues).find((candidate) => candidate.issues.every((issue) => hasFix(issue) && stays.has(issue.id)));
  if (!group) throw new Error('no rule group of fixes survives the contract');
  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));
  expect(counts()).toBe(`${group.issues.length} accepted, 0 rejected, ${rules.issues.length - group.issues.length} pending`);

  // The contract arrives.
  release();
  await screen.findByText(/^Recorded AI analysis/);
  expect(counts()).toBe(
    `${group.issues.length} accepted, 0 rejected, ${shownIn(recorded).length - group.issues.length} pending`,
  );
  const region = screen.getByRole('group', { name: titleOf(group) });
  await user.click(within(region).getByRole('button', { name: titleOf(group), expanded: false }));
  for (const pressed of within(region).getAllByRole('button', { name: /^Accept fix: / })) {
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  }
});

it('off mode makes no AI request', async () => {
  serve({ recording: false, live: false });
  await openSample();

  expect(await screen.findByText('AI off')).toBeTruthy();
  expect(screen.getByRole('note').textContent).toContain('To enable AI, set ANTHROPIC_API_KEY in .env.local');
  expect(lastSnapshot().analysis).toEqual(rules);
  expect(counts()).toBe(`0 accepted, 0 rejected, ${rules.issues.length} pending`);

  // Only the two questions that call no model were asked.
  expect(aiPosts()).toEqual([]);
  expect(requests.filter((request) => request.url.startsWith('/api/ai/')).map((request) => request.url.split('?')[0]).sort()).toEqual([
    '/api/ai/recording',
    '/api/ai/status',
  ]);
});

it('a server that does not answer about AI is not said to lack a key', async () => {
  serve({ recording: false, live: true, statusDown: true });
  await openSample();

  expect(await screen.findByText('AI off')).toBeTruthy();
  expect(screen.getByRole('note').textContent).toContain('the server did not answer');
  expect(screen.getByRole('note').textContent).not.toContain('API key');
  expect(aiPosts()).toEqual([]);
});

it('run live replaces the recorded analysis when the server is live', async () => {
  serve({
    recording: true,
    live: true,
    contract: () => Response.json({ contract: RECORDING.contract, model: 'a-test-model' }),
    adjudicate: (cases) => Response.json({ verdicts: cases.map((item) => ({ issueId: item.issueId, value: 'unsure', reason: 'Not enough to tell.' })), model: 'a-test-model' }),
  });
  const user = await openSample();

  await screen.findByText(/^Recorded AI analysis/);
  expect(aiPosts()).toEqual([]);
  await user.click(button('Run live'));

  expect(await screen.findByText('AI live · a-test-model')).toBeTruthy();
  const cases = selectCases(dataset, withContract).length;
  await screen.findByText(new RegExp(`${cases} unsure`));
  expect(lastSnapshot().ai).toEqual({ mode: 'live', model: 'a-test-model' });
  expect(ids(lastSnapshot().analysis)).toEqual(ids(withContract));
  expect(dismissedIn(lastSnapshot().analysis)).toEqual([]);
});
