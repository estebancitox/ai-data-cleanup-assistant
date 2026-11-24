// @vitest-environment jsdom

// The page with the AI layer, driven as a user drives it. The seam is the real one. `fetch`
// is answered by the real recording and status handlers, so the recording served is the
// committed one; the two routes that call the model are answered by each test.

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRecordingHandler } from '../app/api/ai/recording/handler';
import { GET as statusRoute } from '../app/api/ai/status/route';
import { applyVerdicts, selectCases } from '../core/adjudicate';
import { analyze, groupIssues } from '../core/analyze';
import { verifyContract } from '../core/contract';
import { SAMPLE_ROWS } from '../core/contract/request';
import { parseCsv, serializeCsv } from '../core/csv';
import { nursery, nurseryContract } from '../core/testing';
import type { Analysis, Case, ChangeLog, Contract, Dataset, Issue, IssueGroup, Verdict } from '../core/types';
import type { AnalysisSnapshot } from '../lib/analysis';
import { describeGroup, issueLabel } from '../lib/describe';
import type { LoadedFile } from '../lib/load';
import { FORMATS_KIND } from './AiRules';
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

// The browser download is replaced by a list of what would have been saved.
const saved = vi.hoisted(() => [] as Array<{ name: string; text: string }>);
vi.mock('../lib/download', () => ({
  saveFile: (name: string, text: string) => {
    saved.push({ name, text });
  },
}));

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
  /** Holds the contract's answer back until it settles. */
  contractGate?: Promise<void>;
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
      if (url.startsWith('/api/ai/contract')) {
        await server.contractGate;
        return server.contract?.() ?? Response.json({ error: 'ai_unavailable' }, { status: 502 });
      }
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
  saved.length = 0;
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

// --- SPEC §7.3: an issue the user has decided is never removed or replaced by a later snapshot.

const unsure = (cases: Case[]) =>
  Response.json({
    verdicts: cases.map((item) => ({ issueId: item.issueId, value: 'unsure', reason: 'Not enough to tell.' })),
    model: 'a-test-model',
  });

/** The live run is over: the contract arrived and no step is under way or waiting for a retry. */
const liveRunEnds = () =>
  waitFor(() => {
    const { run } = lastSnapshot();
    expect([run.mode, run.model, run.busy, run.retry]).toEqual(['live', 'a-test-model', undefined, undefined]);
  });

async function openFile(file: Dataset) {
  const user = userEvent.setup();
  render(<Assistant />);
  await user.upload(screen.getByLabelText('Choose a CSV file'), new File([serializeCsv(file)], file.fileName, { type: 'text/csv' }));
  await screen.findByRole('button', { name: 'Download cleaned CSV' });
  return user;
}

/** Both downloads, as the page builds them now. */
async function download(user: ReturnType<typeof userEvent.setup>) {
  saved.length = 0;
  await user.click(button('Download cleaned CSV'));
  await user.click(button('Download change log'));
  const cleaned = parseCsv(saved[0].text, 'cleaned.csv');
  if (!cleaned.ok) throw new Error(cleaned.error);
  return { rows: cleaned.dataset.rows, log: JSON.parse(saved[1].text) as ChangeLog };
}

/** Opens the group of an issue and presses the button of that one issue. */
async function decideOne(user: ReturnType<typeof userEvent.setup>, analysis: Analysis, issue: Issue, word: 'Accept' | 'Reject') {
  const group = groupIssues(analysis.issues).find((candidate) => candidate.issues.some((other) => other.id === issue.id));
  if (!group) throw new Error('the issue is in no group');
  const region = screen.getByRole('group', { name: titleOf(group) });
  await user.click(within(region).getByRole('button', { name: titleOf(group), expanded: false }));
  await user.click(within(region).getByRole('button', { name: `${word} fix: ${issueLabel(issue)}` }));
}

// The nursery, row 38: the genus is a placeholder. The rules empty the cell; the contract brings
// "species decides genus" and takes the cell with a fix that writes the genus of the species.
const plants = nursery();
const plantRules = analyze(plants);
const plantContract = analyze(plants, verifyContract(nurseryContract(), plants));
const onGenus38 = (analysis: Analysis) => analysis.issues.filter((issue) => issue.rowIds[0] === 38 && issue.column === 'genus');
const [emptied] = onGenus38(plantRules);
const [filled] = onGenus38(plantContract);
const genus38 = (rows: Dataset['rows']) => rows.find((row) => row.id === 38)?.cells.genus;

/** The nursery on the page, with the rule-based analysis on screen and the contract request pending. */
async function openNurseryBeforeTheContract() {
  let release = () => {};
  serve({
    recording: false,
    live: true,
    contractGate: new Promise<void>((resolve) => {
      release = resolve;
    }),
    contract: () => Response.json({ contract: nurseryContract(), model: 'a-test-model' }),
    adjudicate: unsure,
  });
  const user = await openFile(plants);
  expect(lastSnapshot().analysis).toEqual(plantRules);
  // Guard: the case is the one of the finding.
  expect([emptied.detector, emptied.current, emptied.fix]).toEqual(['placeholder', 'n/a', { kind: 'set-cell', rowId: 38, column: 'genus', to: '' }]);
  expect([filled.detector, filled.confidence, filled.fix]).toEqual(['dependency', 'high', { kind: 'set-cell', rowId: 38, column: 'genus', to: 'Quercus' }]);
  return { user, release };
}

it('an accepted fix survives a contract that takes its cell', async () => {
  const { user, release } = await openNurseryBeforeTheContract();
  await decideOne(user, plantRules, emptied, 'Accept');
  expect(counts()).toBe(`1 accepted, 0 rejected, ${plantRules.issues.length - 1} pending`);

  release();
  await liveRunEnds();
  // The contract did take the cell: the analysis the seam yielded holds its issue, not the rule's.
  expect(onGenus38(lastSnapshot().analysis).map((issue) => issue.id)).toEqual([filled.id]);

  // The accepted count is unchanged, and the page still holds one issue per cell.
  expect(counts()).toBe(`1 accepted, 0 rejected, ${plantContract.issues.length - 1} pending`);
  const { rows, log } = await download(user);
  // The accepted value is in the cell: the fix of the rule empties it.
  expect(genus38(rows)).toBe('');
  // The change log has the entry, and nothing else for that cell: no pending fix exists for it.
  expect(log.changes.filter((change) => change.rowIds[0] === 38 && change.column === 'genus')).toEqual([
    expect.objectContaining({ issueId: emptied.id, decision: 'accepted', from: 'n/a', to: '' }),
  ]);
  expect(log.summary).toMatchObject({ accepted: 1, issues: plantContract.issues.length, cellsChanged: 1 });
});

it('a rejected cell stays as it is after the contract', async () => {
  const { user, release } = await openNurseryBeforeTheContract();
  await decideOne(user, plantRules, emptied, 'Reject');

  release();
  await liveRunEnds();
  await user.click(screen.getByRole('button', { name: /^Accept all high-confidence fixes/ }));

  // The bulk action did accept fixes, and the cell the user chose to leave is as it was.
  const { rows, log } = await download(user);
  expect(log.summary.accepted).toBeGreaterThan(0);
  expect(log.summary.rejected).toBe(1);
  expect(genus38(rows)).toBe('n/a');
  expect(log.changes.filter((change) => change.rowIds[0] === 38 && change.column === 'genus')).toEqual([
    expect.objectContaining({ issueId: emptied.id, decision: 'rejected' }),
  ]);
});

it('Run live keeps decisions already made', async () => {
  // A rule of the recorded contract whose fixes are one group on the page, and the same
  // contract without that rule: what the live model answers in this test.
  const pick = RECORDING.contract.canonicalGroups
    .map((rule) => {
      const contract: Contract = { ...RECORDING.contract, canonicalGroups: RECORDING.contract.canonicalGroups.filter((other) => other !== rule) };
      const proposed = new Set(ids(analyze(dataset, verifyContract(contract, dataset))));
      const group = groupIssues(shownIn(recorded)).find((candidate) =>
        candidate.issues.every((issue) => issue.source === 'ai' && issue.fix?.kind === 'set-cell' && !proposed.has(issue.id)),
      );
      return { contract, group };
    })
    .find((candidate) => candidate.group !== undefined);
  if (!pick?.group) throw new Error('no rule of the recording has a group of its own');
  const { contract, group } = pick;

  serve({ recording: true, live: true, contract: () => Response.json({ contract, model: 'a-test-model' }), adjudicate: unsure });
  const user = await openSample();
  await screen.findByText(/^Recorded AI analysis/);
  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));
  expect(counts()).toBe(`${group.issues.length} accepted, 0 rejected, ${shownIn(recorded).length - group.issues.length} pending`);

  await user.click(button('Run live'));
  await liveRunEnds();
  // The live contract does not propose these fixes.
  const live = new Set(ids(lastSnapshot().analysis));
  expect(group.issues.filter((issue) => live.has(issue.id))).toEqual([]);

  // They are still accepted, and they are applied.
  expect(counts()).toMatch(new RegExp(`^${group.issues.length} accepted, 0 rejected, `));
  const { rows, log } = await download(user);
  for (const issue of group.issues) {
    if (issue.fix?.kind !== 'set-cell') throw new Error('not a cell fix');
    const { rowId, column, to } = issue.fix;
    expect(rows.find((row) => row.id === rowId)?.cells[column]).toBe(to);
    expect(log.changes.filter((change) => change.rowIds[0] === rowId && change.column === column)).toEqual([
      expect.objectContaining({ issueId: issue.id, decision: 'accepted', to }),
    ]);
  }
  expect(log.ai).toEqual({ mode: 'live', model: 'a-test-model' });
});

it('a dismissed issue under a header with a line break is listed once', async () => {
  // The nursery with a header that holds a line break: the id of every issue of that column
  // holds it too. The AI dismisses every case it is asked about.
  const header = 'height\ncm';
  const rename = (name: string) => (name === 'height_cm' ? header : name);
  const file: Dataset = {
    fileName: plants.fileName,
    columns: plants.columns.map(rename),
    rows: plants.rows.map((row) => ({
      id: row.id,
      cells: Object.fromEntries(Object.entries(row.cells).map(([name, value]) => [rename(name), value])),
    })),
  };
  const contract: Contract = { ...nurseryContract(), columns: [], ranges: [] };
  const analysis = analyze(file, verifyContract(contract, file));
  const cases = selectCases(file, analysis);
  expect(cases.filter((item) => item.issueId.includes('\n')).length).toBeGreaterThan(0);

  serve({
    recording: false,
    live: true,
    contract: () => Response.json({ contract, model: 'a-test-model' }),
    adjudicate: (asked) =>
      Response.json({
        verdicts: asked.map((item) => ({ issueId: item.issueId, value: 'dismiss', reason: 'Plausible for this file.' })),
        model: 'a-test-model',
      }),
  });
  const user = await openFile(file);
  await liveRunEnds();

  // Listed under "Dismissed by AI", and nowhere else: not in the counts and not in a group.
  const dismissed = new Set(cases.map((item) => item.issueId));
  const active = analysis.issues.filter((issue) => !dismissed.has(issue.id));
  await user.click(await screen.findByRole('button', { name: `Dismissed by AI (${cases.length})` }));
  expect(screen.getAllByRole('button', { name: /^Restore: / })).toHaveLength(cases.length);
  expect(counts()).toBe(`0 accepted, 0 rejected, ${active.length} pending`);
  expect(screen.getAllByRole('group')).toHaveLength(groupIssues(active).length);
});

it('the upload screen says what is sent', () => {
  render(<Assistant />);
  const sentence = screen.getByText(/^What leaves the browser:/).textContent ?? '';
  // With a key: what the contract request and the cases hold. The number is the core's.
  expect(sentence).toContain('when the server has an API key');
  expect(sentence).toContain(`up to ${SAMPLE_ROWS} sample rows`);
  expect(sentence).toContain('the full rows of the ambiguous cases go to the AI model');
  // Without a key: the question about a recording, which carries the hash of the file.
  expect(sentence).toContain('without a key, only the SHA-256 of the file is sent to this server');
});

it('format rules are labelled as not used', async () => {
  serve({ recording: true, live: false });
  const user = await openSample();
  await screen.findByText(/^Recorded AI analysis/);
  await user.click(button('AI rules'));

  // The recording has a format that passed its check. It is a verified rule and it is counted as one.
  const verified = verifyContract(RECORDING.contract, dataset);
  const formats = verified.columns.filter((column) => column.format !== 'none');
  expect(formats.length).toBeGreaterThan(0);
  const others = verified.missingTokens.length + verified.canonicalGroups.length + verified.suspiciousValues.length + verified.ranges.length + verified.dependencies.length;
  expect(screen.getByRole('heading', { name: `Verified rules (${others + formats.length})` })).toBeTruthy();

  // Its heading says what this version does with it, and the introduction does not say it is used.
  const heading = screen.getByRole('heading', { name: FORMATS_KIND });
  expect(FORMATS_KIND).toContain('checked against the file, not used to find issues in this version');
  const section = heading.parentElement;
  if (!section) throw new Error('the heading has no section');
  expect(within(section).getAllByRole('listitem').map((item) => item.textContent)).toEqual(formats.map((column) => `${column.name}: ${column.format}`));
  expect(screen.getByText(/^The AI proposed these rules about the file\./).textContent).toContain('except a format: this version checks formats and does not use them');
});

it('the bar says when the AI doubts a fix already accepted', async () => {
  let release = () => {};
  serve({
    recording: false,
    live: true,
    contractGate: new Promise<void>((resolve) => {
      release = resolve;
    }),
    contract: () => Response.json({ contract: RECORDING.contract, model: 'a-test-model' }),
    adjudicate: (cases) =>
      Response.json({
        verdicts: RECORDING.verdicts.filter((verdict) => cases.some((item) => item.issueId === verdict.issueId)),
        model: 'a-test-model',
      }),
  });
  const user = await openSample();

  // Before any opinion exists: accept a group of fixes, some of which the AI will dismiss.
  const willDoubt = new Set(dismissedIn(recorded).filter(hasFix).map((issue) => issue.id));
  const group = groupIssues(rules.issues).find((candidate) => candidate.issues.some((issue) => willDoubt.has(issue.id)));
  if (!group) throw new Error('the recording dismisses no fix');
  const doubted = group.issues.filter((issue) => willDoubt.has(issue.id));
  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));
  expect(screen.queryByText(/^The AI doubts/)).toBeNull();

  // The opinions arrive. The notice names the number and the group, and no decision changes.
  release();
  await liveRunEnds();
  const notice = (await screen.findByText(/^The AI doubts/)).textContent ?? '';
  expect(notice).toContain(`The AI doubts ${doubted.length === 1 ? '1 fix' : `${doubted.length} fixes`} you accepted`);
  expect(notice).toContain(`Where: ${titleOf(group)}.`);
  expect(counts()).toMatch(new RegExp(`^${group.issues.length} accepted, 0 rejected, `));

  // It goes away when none of those fixes is left accepted.
  await user.click(button('Undo'));
  expect(counts()).toMatch(/^0 accepted, 0 rejected, /);
  expect(screen.queryByText(/^The AI doubts/)).toBeNull();
});

it('a failed Run live leaves the recorded mode in the header', async () => {
  // The contract route answers 502.
  serve({ recording: true, live: true });
  const user = await openSample();
  const recordedLine = `Recorded AI analysis · ${RECORDING.model} · recorded 2026-11-23 21:26 UTC`;
  await screen.findByText(recordedLine);
  await user.click(button('Run live'));

  expect((await screen.findByRole('alert')).textContent).toBe(
    'The AI service did not return a usable answer. The recorded analysis stays on screen as it is.',
  );
  // The analysis on screen is the recorded one, and the header still says so.
  expect(screen.getByText(recordedLine)).toBeTruthy();
  expect(screen.queryByText(/^AI live/)).toBeNull();
  expect(lastSnapshot().analysis).toEqual(recorded);
  expect(lastSnapshot().ai).toEqual({ mode: 'recorded', model: RECORDING.model });
  expect(button('Retry')).toBeTruthy();
});

it('a rejected dependency is worded like a verified one', async () => {
  // The nursery contract, and one more dependency that names a column the file does not have.
  const contract: Contract = {
    ...nurseryContract(),
    dependencies: [...nurseryContract().dependencies, { determinant: 'species', dependent: 'no_such_column', reason: 'Made up.' }],
  };
  const verified = verifyContract(contract, plants);
  expect(verified.rejected.map((rule) => [rule.rule, rule.summary])).toEqual([['dependency', 'species -> no_such_column']]);
  expect(verified.dependencies.map((rule) => [rule.determinant, rule.dependent])).toEqual([['species', 'genus']]);

  serve({ recording: false, live: true, contract: () => Response.json({ contract, model: 'a-test-model' }), adjudicate: unsure });
  const user = await openFile(plants);
  await liveRunEnds();
  await user.click(button('AI rules'));

  expect(screen.getByText('species decides genus')).toBeTruthy();
  expect(screen.getByText('species decides no_such_column')).toBeTruthy();
  expect(screen.queryByText('species -> no_such_column')).toBeNull();
});
