// @vitest-environment jsdom

// The page, driven as a user drives it. The sample is the development fixture, read from its
// file; what the page should show and export is computed here from the core.

import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analyze, groupIssues } from '../core/analyze';
import { applyDecisions } from '../core/apply';
import { parseCsv, serializeCsv } from '../core/csv';
import { inventory } from '../core/testing';
import type { ChangeLog, Dataset, Decisions, Issue, IssueGroup } from '../core/types';
import type { AnalysisSnapshot } from '../lib/analysis';
import { describeGroup } from '../lib/describe';
import type { LoadedFile } from '../lib/load';
import { Assistant } from './Assistant';

// The seam is the real one. The wrapper keeps what it yields, so that a test can look at the
// very object the page holds, and it can add one later snapshot when a test asks for it.
const seam = vi.hoisted(() => ({
  snapshots: [] as AnalysisSnapshot[],
  later: null as null | { gate: Promise<void>; next: (first: AnalysisSnapshot) => AnalysisSnapshot },
}));

vi.mock('../lib/analysis', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/analysis')>();
  return {
    ...real,
    async *runAnalysis(file: LoadedFile) {
      let last: AnalysisSnapshot | undefined;
      for await (const snapshot of real.runAnalysis(file)) {
        seam.snapshots.push(snapshot);
        last = snapshot;
        yield snapshot;
      }
      if (seam.later && last) {
        await seam.later.gate;
        const next = seam.later.next(last);
        seam.snapshots.push(next);
        yield next;
      }
    },
  };
});

// The browser download is replaced by a list of what would have been saved.
const saved = vi.hoisted(() => [] as Array<{ name: string; text: string; mime: string }>);
vi.mock('../lib/download', () => ({
  saveFile: (name: string, text: string, mime: string) => {
    saved.push({ name, text, mime });
  },
}));

const SAMPLE_BYTES = readFileSync('fixtures/listings.dirty.csv');
const SAMPLE_NAME = 'listings.dirty.csv';

function expectedFor(text: string, fileName: string) {
  const parsed = parseCsv(text, fileName);
  if (!parsed.ok) throw new Error(parsed.error);
  const analysis = analyze(parsed.dataset);
  return { dataset: parsed.dataset, analysis, groups: groupIssues(analysis.issues) };
}
const sample = expectedFor(SAMPLE_BYTES.toString('utf8'), SAMPLE_NAME);

const hasFix = (issue: Issue) => issue.fix !== undefined;
/** What "accept all high-confidence fixes" may reach, written out here and not taken from the page. */
const sureFixes = (issues: Issue[]) => issues.filter((issue) => hasFix(issue) && issue.confidence === 'high');
const fixGroups = (groups: IssueGroup[]) => groups.filter((group) => group.issues.every(hasFix));
const flagGroups = (groups: IssueGroup[]) => groups.filter((group) => !group.issues.some(hasFix));

/** The accessible name of an issue's controls, written out here and not taken from the page. */
function nameOf(issue: Issue): string {
  if (issue.fix?.kind === 'delete-row') return `remove row ${issue.fix.rowId}, keep row ${issue.fix.keepRowId}`;
  return `row ${issue.rowIds[0]}, ${issue.column}`;
}
const acceptName = (issue: Issue) => (hasFix(issue) ? `Accept fix: ${nameOf(issue)}` : `Confirm flag: ${nameOf(issue)}`);
const rejectName = (issue: Issue) => (hasFix(issue) ? `Reject fix: ${nameOf(issue)}` : `Dismiss flag: ${nameOf(issue)}`);

const titleOf = (group: IssueGroup) => describeGroup(group).title;
const groupOf = (group: IssueGroup) => screen.getByRole('group', { name: titleOf(group) });
const button = (name: string) => screen.getByRole('button', { name });
const csvFile = (text: string | Uint8Array<ArrayBuffer>, name: string) => new File([text], name, { type: 'text/csv' });

beforeEach(() => {
  seam.snapshots.length = 0;
  seam.later = null;
  saved.length = 0;
  // jsdom has no SubtleCrypto and no fetch; the sample URL answers with the fixture's bytes.
  // These tests are about the page without AI: no recording, and a server that is not live.
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/ai/recording')) return Response.json({ error: 'not_found' }, { status: 404 });
      if (url.startsWith('/api/ai/status')) return Response.json({ live: false, model: null });
      return new Response(new Uint8Array(SAMPLE_BYTES));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSample() {
  const user = userEvent.setup();
  render(<Assistant />);
  await user.click(button('Use sample data'));
  await screen.findByRole('button', { name: 'Download cleaned CSV' });
  return user;
}

async function openFile(file: File) {
  const user = userEvent.setup();
  render(<Assistant />);
  await user.upload(screen.getByLabelText('Choose a CSV file'), file);
  return user;
}

async function expand(user: ReturnType<typeof userEvent.setup>, group: IssueGroup) {
  const region = groupOf(group);
  await user.click(within(region).getByRole('button', { name: titleOf(group), expanded: false }));
  return region;
}

it('export equals applyDecisions', async () => {
  const user = await openSample();
  const [accepted, other] = fixGroups(sample.groups).filter((group) => group.issues.length >= 2);
  const rejected = other.issues[0];

  // Accept every issue of one group, reject one issue of another, then download both files.
  await user.click(button(`Accept all (${accepted.issues.length}): ${titleOf(accepted)}`));
  const region = await expand(user, other);
  await user.click(within(region).getByRole('button', { name: rejectName(rejected) }));
  await user.click(button('Download cleaned CSV'));
  await user.click(button('Download change log'));

  expect(saved.map((file) => file.name)).toEqual(['listings.dirty.cleaned.csv', 'listings.dirty.changes.json']);
  const downloadedLog = JSON.parse(saved[1].text) as ChangeLog;
  expect(new Date(downloadedLog.generatedAt).toISOString()).toBe(downloadedLog.generatedAt);

  const decisions: Decisions = {
    ...Object.fromEntries(accepted.issues.map((issue) => [issue.id, 'accepted' as const])),
    [rejected.id]: 'rejected',
  };
  const expected = applyDecisions(sample.dataset, sample.analysis, decisions, {
    generatedAt: downloadedLog.generatedAt,
    sha256: createHash('sha256').update(SAMPLE_BYTES).digest('hex'),
    ai: { mode: 'off', model: null },
  });
  expect(saved[0].text).toBe(serializeCsv(expected.cleaned));
  expect(downloadedLog).toEqual(expected.changeLog);

  // The decisions did something: the cleaned file is not the file that was loaded.
  expect(saved[0].text).not.toBe(serializeCsv(sample.dataset));
  expect(downloadedLog.summary.accepted).toBe(accepted.issues.length);
  expect(downloadedLog.summary.rejected).toBe(1);
});

it('decisions do not touch the analysis', async () => {
  const user = await openSample();
  // With AI off, the later snapshot only says so: the analysis is the same object.
  await screen.findByText('AI off');
  expect(new Set(seam.snapshots.map((snapshot) => snapshot.analysis)).size).toBe(1);
  const held = seam.snapshots[0].analysis;
  const before = structuredClone(held);
  expect(held).toEqual(sample.analysis);

  const [first, second] = fixGroups(sample.groups);
  const [flagged] = flagGroups(sample.groups);

  // Bulk and single decisions on fixes and on flags, and one decision taken back.
  await user.click(button(`Accept all (${first.issues.length}): ${titleOf(first)}`));
  await user.click(button(`Dismiss all (${flagged.issues.length}): ${titleOf(flagged)}`));
  const region = await expand(user, second);
  const accept = within(region).getByRole('button', { name: acceptName(second.issues[0]) });
  await user.click(accept);
  expect(accept.getAttribute('aria-pressed')).toBe('true');
  await user.click(within(region).getByRole('button', { name: rejectName(second.issues[0]) }));
  expect(accept.getAttribute('aria-pressed')).toBe('false');
  await user.click(within(region).getByRole('button', { name: rejectName(second.issues[0]) }));
  await user.click(button('Download cleaned CSV'));

  expect(screen.getByRole('status').textContent).toBe(
    `${first.issues.length} accepted, ${flagged.issues.length} rejected, ${
      sample.analysis.issues.length - first.issues.length - flagged.issues.length
    } pending`,
  );
  expect(held).toEqual(before);
  expect(new Set(seam.snapshots.map((snapshot) => snapshot.analysis)).size).toBe(1);
});

it(
  'controls have roles and names',
  async () => {
    const user = await openSample();

    // Filters and export.
    for (const name of ['Type', 'Status', 'Confidence', 'Source']) {
      expect(screen.getByRole('combobox', { name })).toBeTruthy();
    }
    expect(button('Download cleaned CSV')).toBeTruthy();
    expect(button('Download change log')).toBeTruthy();
    expect(button(`Accept all high-confidence fixes (${sureFixes(sample.analysis.issues).length})`)).toBeTruthy();

    // Every group is on screen, collapsed, with its bulk controls.
    expect(screen.getAllByRole('group')).toHaveLength(sample.groups.length);
    let issueControls = 0;
    for (const group of sample.groups) {
      const title = titleOf(group);
      const region = groupOf(group);
      const count = group.issues.length;
      const bulk = group.issues.every(hasFix) ? ['Accept all', 'Reject all'] : ['Confirm all', 'Dismiss all'];
      for (const words of bulk) {
        expect(within(region).getByRole('button', { name: `${words} (${count}): ${title}` })).toBeTruthy();
      }

      // Every issue of the group has its accept and its reject, each with a name of its own.
      await user.click(within(region).getByRole('button', { name: title, expanded: false }));
      for (const issue of group.issues) {
        expect(within(region).getByRole('button', { name: acceptName(issue), pressed: false })).toBeTruthy();
        expect(within(region).getByRole('button', { name: rejectName(issue), pressed: false })).toBeTruthy();
        issueControls += 2;
      }
      // The disclosure, two bulk buttons and two buttons per issue: nothing without a name.
      expect(within(region).getAllByRole('button')).toHaveLength(3 + 2 * count);
    }
    expect(issueControls).toBe(2 * sample.analysis.issues.length);
  },
  60_000,
);

it('a file chosen with the picker is analysed', async () => {
  const text = serializeCsv(inventory());
  const expected = expectedFor(text, 'inventory.csv');
  await openFile(csvFile(text, 'inventory.csv'));

  expect(await screen.findByRole('heading', { name: 'inventory.csv' })).toBeTruthy();
  expect(screen.getAllByRole('group')).toHaveLength(expected.groups.length);
  expect(screen.getByRole('status').textContent).toBe(
    `0 accepted, 0 rejected, ${expected.analysis.issues.length} pending`,
  );
  expect(await screen.findByText('AI off')).toBeTruthy();
});

it('a dropped file is analysed', async () => {
  render(<Assistant />);
  const file = csvFile(serializeCsv(inventory()), 'dropped.csv');
  fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file] } });
  expect(await screen.findByRole('heading', { name: 'dropped.csv' })).toBeTruthy();
});

it('the sample is fetched from the URL of the fixture and analysed', async () => {
  await openSample();
  const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
  expect(urls[0]).toMatch(/listings\.dirty.*\.csv$/);
  // The file itself is fetched once; the other requests ask the AI routes about it.
  expect(urls.filter((url) => !url.startsWith('/api/ai/'))).toHaveLength(1);
  expect(screen.getByRole('heading', { name: SAMPLE_NAME })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(
    `0 accepted, 0 rejected, ${sample.analysis.issues.length} pending`,
  );
});

it('a file that cannot be used shows the reason, and another file can be loaded', async () => {
  const user = await openFile(csvFile('name,name\nRotor,Hub\n', 'twice.csv'));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('The header has two columns named "name". Column names must be unique.');

  // Not UTF-8: "Café" saved as Windows-1252.
  const latin = new Uint8Array([...new TextEncoder().encode('name\nCaf'), 0xe9, 0x0a]);
  await user.upload(screen.getByLabelText('Choose a CSV file'), csvFile(latin, 'latin.csv'));
  await screen.findByText(/Save it as "CSV UTF-8" and upload it again\./);

  await user.upload(screen.getByLabelText('Choose a CSV file'), csvFile(serializeCsv(inventory()), 'good.csv'));
  expect(await screen.findByRole('heading', { name: 'good.csv' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('accept and reject work with the keyboard alone', async () => {
  const user = await openSample();
  const [group] = fixGroups(sample.groups);
  const region = groupOf(group);
  const tabTo = async (target: HTMLElement) => {
    for (let presses = 0; presses < 10 && document.activeElement !== target; presses += 1) await user.tab();
    expect(document.activeElement).toBe(target);
  };

  // Open the group with Enter, reach the first issue with Tab, decide with Space and Enter.
  within(region).getByRole('button', { name: titleOf(group) }).focus();
  await user.keyboard('{Enter}');
  const accept = within(region).getByRole('button', { name: acceptName(group.issues[0]) });
  const reject = within(region).getByRole('button', { name: rejectName(group.issues[0]) });

  await tabTo(accept);
  await user.keyboard(' ');
  expect(accept.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(accept);
  expect(screen.getByRole('status').textContent).toContain('1 accepted, 0 rejected');

  await tabTo(reject);
  await user.keyboard('{Enter}');
  expect(reject.getAttribute('aria-pressed')).toBe('true');
  expect(accept.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('status').textContent).toContain('0 accepted, 1 rejected');
});

it('the filters narrow the groups, and a bulk action reaches only what is shown and pending', async () => {
  const user = await openSample();
  const fixes = fixGroups(sample.groups);
  const [group] = fixes.filter((each) => each.issues.length >= 3);

  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Duplicates');
  expect(screen.getAllByRole('group')).toHaveLength(sample.groups.filter((each) => each.type === 'duplicate').length);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'All types');

  // One issue rejected by hand stays rejected when the rest of its group is accepted.
  const region = await expand(user, group);
  await user.click(within(region).getByRole('button', { name: rejectName(group.issues[0]) }));
  await user.click(button(`Accept all (${group.issues.length - 1}): ${titleOf(group)}`));
  expect(screen.getByRole('status').textContent).toContain(`${group.issues.length - 1} accepted, 1 rejected`);
  expect(button(`Accept all (0): ${titleOf(group)}`).hasAttribute('disabled')).toBe(true);

  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Pending');
  expect(screen.queryByRole('group', { name: titleOf(group) })).toBeNull();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'AI');
  expect(screen.queryAllByRole('group')).toHaveLength(0);
  expect(screen.getByText('No issue matches these filters.')).toBeTruthy();
});

it('a flag is confirmed or dismissed, and never accepted in bulk with fixes', async () => {
  const user = await openSample();
  const [flagged] = flagGroups(sample.groups);
  const region = await expand(user, flagged);
  expect(within(region).queryByRole('button', { name: /^Accept/ })).toBeNull();

  await user.click(within(region).getByRole('button', { name: acceptName(flagged.issues[0]) }));
  expect(within(region).getByText('Confirmed')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('1 accepted, 0 rejected');

  // Confirming a flag changes no cell.
  await user.click(button('Download cleaned CSV'));
  expect(saved[0].text).toBe(serializeCsv(sample.dataset));

  // A bulk action on flags is reported in the words of its buttons.
  const left = flagged.issues.length - 1;
  await user.click(button(`Dismiss all (${left}): ${titleOf(flagged)}`));
  const report = screen.getByText(/^Last bulk action:/);
  expect(report.textContent).toBe(`Last bulk action: ${left} ${left === 1 ? 'issue' : 'issues'} dismissed.`);
  expect(screen.getByRole('status').textContent).toContain(`1 accepted, ${left} rejected`);
});

it('accept all high-confidence fixes accepts those fixes, keeps decisions made by hand, and touches no flag', async () => {
  const user = await openSample();
  const held = seam.snapshots[0].analysis;
  const before = structuredClone(held);
  const sure = sureFixes(sample.analysis.issues);
  const others = sample.analysis.issues.filter((issue) => !sure.includes(issue));
  // The sample has what the rule must leave alone: flags of high confidence, and fixes of lower confidence.
  expect(others.some((issue) => !hasFix(issue) && issue.confidence === 'high')).toBe(true);
  expect(others.some((issue) => hasFix(issue) && issue.confidence !== 'high')).toBe(true);

  // One of them is rejected by hand first; the bulk action must not turn it around.
  const group = sample.groups.find((each) => each.issues.includes(sure[0]));
  if (!group) throw new Error('no group for the first high-confidence fix');
  const region = await expand(user, group);
  await user.click(within(region).getByRole('button', { name: rejectName(sure[0]) }));

  await user.click(button(`Accept all high-confidence fixes (${sure.length - 1})`));
  expect(screen.getByRole('status').textContent).toBe(
    `${sure.length - 1} accepted, 1 rejected, ${sample.analysis.issues.length - sure.length} pending`,
  );
  expect(button('Accept all high-confidence fixes (0)').hasAttribute('disabled')).toBe(true);

  // The export is what applyDecisions gives for exactly those decisions.
  await user.click(button('Download cleaned CSV'));
  await user.click(button('Download change log'));
  const downloadedLog = JSON.parse(saved[1].text) as ChangeLog;
  const decisions: Decisions = {
    ...Object.fromEntries(sure.slice(1).map((issue) => [issue.id, 'accepted' as const])),
    [sure[0].id]: 'rejected',
  };
  const expected = applyDecisions(sample.dataset, sample.analysis, decisions, {
    generatedAt: downloadedLog.generatedAt,
    sha256: createHash('sha256').update(SAMPLE_BYTES).digest('hex'),
    ai: { mode: 'off', model: null },
  });
  expect(saved[0].text).toBe(serializeCsv(expected.cleaned));
  expect(downloadedLog).toEqual(expected.changeLog);
  for (const change of downloadedLog.changes.filter((each) => each.decision === 'accepted')) {
    expect(change.confidence).toBe('high');
    expect(sure.some((issue) => issue.id === change.issueId)).toBe(true);
  }
  expect(held).toEqual(before);
});

it('accept all high-confidence fixes reaches only the issues the filters show', async () => {
  const user = await openSample();
  const sure = sureFixes(sample.analysis.issues);
  const duplicates = sure.filter((issue) => issue.type === 'duplicate');
  expect(duplicates.length).toBeGreaterThan(0);
  expect(duplicates.length).toBeLessThan(sure.length);

  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Duplicates');
  await user.click(button(`Accept all high-confidence fixes (${duplicates.length})`));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'All types');

  expect(screen.getByRole('status').textContent).toContain(`${duplicates.length} accepted, 0 rejected`);
  expect(button(`Accept all high-confidence fixes (${sure.length - duplicates.length})`)).toBeTruthy();
});

it('undo restores the decisions as they were before the last bulk action, one step only', async () => {
  const user = await openSample();
  const sure = sureFixes(sample.analysis.issues);
  const total = sample.analysis.issues.length;
  const undo = () => screen.queryByRole('button', { name: 'Undo' });
  const status = () => screen.getByRole('status').textContent;
  // What the change log says each issue's decision is: the page's decisions, as exported.
  const exported = () => {
    saved.length = 0;
    fireEvent.click(button('Download change log'));
    const log = JSON.parse(saved[0].text) as ChangeLog;
    return Object.fromEntries(log.changes.filter((each) => each.decision !== 'pending').map((each) => [each.issueId, each.decision]));
  };

  // A decision by hand offers no undo.
  const group = sample.groups.find((each) => each.issues.length >= 2 && each.issues.every((issue) => sure.includes(issue)));
  if (!group) throw new Error('the sample needs a group of two or more high-confidence fixes');
  const [one, two] = group.issues;
  const region = await expand(user, group);
  await user.click(within(region).getByRole('button', { name: rejectName(one) }));
  expect(undo()).toBeNull();
  const byHand = { [one.id]: 'rejected' };
  expect(exported()).toEqual(byHand);

  // After "accept all high-confidence fixes", undo puts back exactly what was there.
  await user.click(button(`Accept all high-confidence fixes (${sure.length - 1})`));
  expect(status()).toBe(`${sure.length - 1} accepted, 1 rejected, ${total - sure.length} pending`);
  await user.click(button('Undo'));
  expect(status()).toBe(`0 accepted, 1 rejected, ${total - 1} pending`);
  expect(exported()).toEqual(byHand);
  expect(undo()).toBeNull();

  // After a group's bulk button, any other decision takes the undo away.
  const [flagged] = flagGroups(sample.groups);
  await user.click(button(`Dismiss all (${flagged.issues.length}): ${titleOf(flagged)}`));
  expect(undo()).not.toBeNull();
  await user.click(within(region).getByRole('button', { name: acceptName(two) }));
  expect(undo()).toBeNull();
  const afterGroup = {
    ...byHand,
    ...Object.fromEntries(flagged.issues.map((issue) => [issue.id, 'rejected'])),
    [two.id]: 'accepted',
  };
  expect(exported()).toEqual(afterGroup);

  // Two bulk actions in a row: undo goes back one step, to before the second, and no further.
  const [first, second] = fixGroups(sample.groups).filter((each) => each !== group);
  await user.click(button(`Accept all (${first.issues.length}): ${titleOf(first)}`));
  await user.click(button(`Reject all (${second.issues.length}): ${titleOf(second)}`));
  await user.click(button('Undo'));
  expect(undo()).toBeNull();
  expect(exported()).toEqual({
    ...afterGroup,
    ...Object.fromEntries(first.issues.map((issue) => [issue.id, 'accepted'])),
  });
});

it('an issue on a row that an accepted duplicate fix removes says so', async () => {
  const text = serializeCsv(inventory());
  const expected = expectedFor(text, 'inventory.csv');
  // A cell issue on the very row that a duplicate fix removes.
  const duplicate = expected.analysis.issues.find(
    (issue) =>
      issue.fix?.kind === 'delete-row' &&
      expected.analysis.issues.some((other) => other.fix?.kind === 'set-cell' && other.fix.rowId === issue.fix?.rowId),
  );
  if (duplicate?.fix?.kind !== 'delete-row') throw new Error('the test data needs a fix on a removed row');
  const { rowId, keepRowId } = duplicate.fix;
  const cell = expected.analysis.issues.find((issue) => issue.fix?.kind === 'set-cell' && issue.fix.rowId === rowId);
  if (!cell) throw new Error('the test data needs a fix on a removed row');
  const groupWith = (issue: Issue) => {
    const group = expected.groups.find((each) => each.issues.includes(issue));
    if (!group) throw new Error('no group for the issue');
    return group;
  };
  const note = `Row ${rowId} is removed by a duplicate fix you accepted (row ${keepRowId} is kept), so this issue does not reach the cleaned file.`;

  const user = await openFile(csvFile(text, 'inventory.csv'));
  await screen.findByRole('heading', { name: 'inventory.csv' });
  const cellRegion = await expand(user, groupWith(cell));
  const duplicateRegion = await expand(user, groupWith(duplicate));
  const noteShown = () => cellRegion.textContent?.includes(note) ?? false;
  expect(noteShown()).toBe(false);

  // The note follows the decision on the duplicate, and goes away with it.
  const acceptDuplicate = within(duplicateRegion).getByRole('button', { name: acceptName(duplicate) });
  await user.click(acceptDuplicate);
  expect(noteShown()).toBe(true);
  await user.click(acceptDuplicate);
  expect(noteShown()).toBe(false);

  // With both accepted, the row is gone and the fix on its cell changed nothing.
  await user.click(acceptDuplicate);
  await user.click(within(cellRegion).getByRole('button', { name: acceptName(cell) }));
  await user.click(button('Download change log'));
  const downloadedLog = JSON.parse(saved[0].text) as ChangeLog;
  expect(downloadedLog.summary).toMatchObject({ accepted: 2, cellsChanged: 0, rowsRemoved: 1 });
  // The note only appears on issues of the removed row.
  expect(document.body.textContent?.split(note)).toHaveLength(2);
});

it('groups are collapsed by default and show 50 issues at a time', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => `K-${1000 + index},"Shelf ${index * 37} "`);
  const text = `part_id,location\n${rows.join('\n')}\n`;
  const expected = expectedFor(text, 'shelves.csv');
  const large = expected.groups.find((group) => group.issues.length > 100);
  if (!large) throw new Error('the test data needs a group of more than 100 issues');

  const user = await openFile(csvFile(text, 'shelves.csv'));
  await screen.findByRole('heading', { name: 'shelves.csv' });
  const region = groupOf(large);
  const issueButtons = () => within(region).queryAllByRole('button', { name: /^(Accept fix|Confirm flag): / });

  expect(issueButtons()).toHaveLength(0);
  await user.click(within(region).getByRole('button', { name: titleOf(large), expanded: false }));
  expect(issueButtons()).toHaveLength(50);

  await user.click(within(region).getByRole('button', { name: `Show more (${large.issues.length - 50} hidden)` }));
  expect(issueButtons()).toHaveLength(100);
  await user.click(within(region).getByRole('button', { name: `Show more (${large.issues.length - 100} hidden)` }));
  expect(issueButtons()).toHaveLength(large.issues.length);
  expect(within(region).queryByRole('button', { name: /^Show more/ })).toBeNull();
});

it('a later snapshot keeps the decisions', async () => {
  let release = () => {};
  const extra = (dataset: Dataset): Issue => ({
    id: 'a-later-issue',
    type: 'suspicious',
    detector: 'flagged-value',
    source: 'ai',
    rowIds: [1],
    column: dataset.columns[0],
    current: dataset.rows[0].cells[dataset.columns[0]],
    reason: 'This value looks like test data.',
    confidence: 'medium',
  });
  seam.later = {
    gate: new Promise<void>((resolve) => {
      release = resolve;
    }),
    next: (first) => ({
      analysis: { ...first.analysis, issues: [...first.analysis.issues, extra(sample.dataset)] },
      ai: first.ai,
      run: first.run,
    }),
  };

  const user = await openSample();
  const [group] = fixGroups(sample.groups);
  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));

  release();
  const added = groupIssues([extra(sample.dataset)])[0];
  expect(await screen.findByRole('group', { name: titleOf(added) })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(
    `${group.issues.length} accepted, 0 rejected, ${sample.analysis.issues.length + 1 - group.issues.length} pending`,
  );
});

it('says when the files downloaded no longer match each other', async () => {
  const user = await openSample();
  const [group] = fixGroups(sample.groups);

  await user.click(button('Download cleaned CSV'));
  expect(screen.queryByRole('alert')).toBeNull();

  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));
  expect(screen.getByRole('alert').textContent).toContain(
    'The files downloaded so far no longer match each other. Download both again.',
  );

  // The log alone does not settle it: the CSV on disk is still the old one.
  await user.click(button('Download change log'));
  expect(screen.getByRole('alert')).toBeTruthy();
  await user.click(button('Download cleaned CSV'));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('start over asks before it discards decisions', async () => {
  const user = await openSample();
  const [group] = fixGroups(sample.groups);
  await user.click(button(`Accept all (${group.issues.length}): ${titleOf(group)}`));

  await user.click(button('Start over'));
  expect(screen.getByText(`This discards ${group.issues.length} decisions.`)).toBeTruthy();
  await user.click(button('Keep reviewing'));
  expect(screen.getByRole('status').textContent).toContain(`${group.issues.length} accepted`);

  await user.click(button('Start over'));
  await user.click(button('Discard and start over'));
  expect(screen.getByRole('heading', { name: 'Upload a CSV file' })).toBeTruthy();

  // A new load starts with no decisions.
  await user.click(button('Use sample data'));
  await screen.findByRole('button', { name: 'Download cleaned CSV' });
  expect(screen.getByRole('status').textContent).toContain('0 accepted, 0 rejected');
});
