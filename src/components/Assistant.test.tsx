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
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(SAMPLE_BYTES))));
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
  expect(seam.snapshots).toHaveLength(1);
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
  expect(seam.snapshots).toHaveLength(1);
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
  expect(screen.getByText('AI off')).toBeTruthy();
});

it('a dropped file is analysed', async () => {
  render(<Assistant />);
  const file = csvFile(serializeCsv(inventory()), 'dropped.csv');
  fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file] } });
  expect(await screen.findByRole('heading', { name: 'dropped.csv' })).toBeTruthy();
});

it('the sample is fetched from the URL of the fixture and analysed', async () => {
  await openSample();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/listings\.dirty.*\.csv$/);
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
