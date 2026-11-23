// The words the page uses for what the core reports: a title and a reason for each group of
// issues (the core gives a group neither), and the names of the controls of an issue.

import type { AiMode, Confidence, Decision, Issue, IssueGroup, IssueType } from '../core/types';
import type { AiRun } from './analysis';
import type { Status } from './decisions';

export const TYPE_LABEL: Record<IssueType, string> = {
  duplicate: 'Duplicates',
  inconsistent: 'Inconsistent values',
  missing: 'Missing data',
  suspicious: 'Suspicious records',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export const SOURCE_LABEL: Record<Issue['source'], string> = { rule: 'Rule', ai: 'AI' };

export const AI_MODE_LABEL: Record<AiMode, string> = {
  off: 'AI off',
  live: 'AI live',
  recorded: 'Recorded AI analysis',
};

/** Which AI produced what is on screen: the mode, and the model and date where there is one. */
export function modeLine(run: Pick<AiRun, 'mode' | 'model' | 'recordedAt'>): string {
  if (run.mode === 'checking') return 'Checking for AI';
  if (run.mode === 'off') return AI_MODE_LABEL.off;
  const model = run.model ?? 'model not reported';
  if (run.mode === 'live') return `${AI_MODE_LABEL.live} · ${model}`;
  const date = new Date(run.recordedAt ?? '');
  const when = Number.isNaN(date.getTime()) ? 'date not recorded' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `${AI_MODE_LABEL.recorded} · ${model} · recorded ${when}`;
}

/** What the model answered about an ambiguous issue (SPEC §6.4), before its sentence. */
export const VERDICT_LABEL: Record<NonNullable<Issue['verdict']>['value'], string> = {
  confirm: 'AI opinion: this looks like a real problem.',
  dismiss: 'AI opinion: this is probably not a problem.',
  unsure: 'AI opinion: not sure.',
};

export interface GroupText {
  title: string;
  reason: string;
}

const NOTHING_PROPOSED = 'The right value cannot be known from the file, so nothing is proposed.';

/** One entry per detector id of SPEC §5.4 and §5.5. */
const BY_DETECTOR: Record<string, (group: IssueGroup) => GroupText> = {
  'exact-duplicate': () => ({
    title: 'Exact copies of another row',
    reason: 'Each of these rows repeats an earlier row in every column. The fix removes the copy and keeps the first row.',
  }),
  'near-duplicate': () => ({
    title: 'Rows that look like the same record entered twice',
    reason:
      'Each pair of rows agrees in almost every column. The fix removes one row and keeps the more complete one. Compare them before you accept.',
  }),
  empty: ({ column }) => ({
    title: `Empty cells in ${column}`,
    reason: `These cells have no value. ${NOTHING_PROPOSED}`,
  }),
  placeholder: ({ column, source }) =>
    source === 'ai'
      ? {
          title: `Values that mean "no value" in ${column}`,
          reason: 'In this column these values stand for "no value". The fix leaves the cell empty.',
        }
      : {
          title: `Placeholder text in ${column}`,
          reason: 'These cells hold a word or a symbol that stands for "no value". The fix leaves the cell empty.',
        },
  whitespace: ({ column }) => ({
    title: `Extra spaces in ${column}`,
    reason:
      'These values have spaces before them, after them or repeated inside them. The fix removes the extra spaces and changes nothing else.',
  }),
  'case-variant': ({ column, target }) => ({
    title: `"${target ?? ''}" written differently in ${column}`,
    reason:
      'These cells hold the same value as other cells of the column, written with different capital letters or spacing. The fix writes the spelling the column uses most.',
  }),
  'number-format': ({ column }) => ({
    title: `Numbers written with symbols in ${column}`,
    reason:
      'These numbers carry currency symbols, thousands separators or spaces. The fix writes the plain number; the amount does not change.',
  }),
  'date-format': ({ column, type }) =>
    type === 'suspicious'
      ? {
          title: `Dates that do not exist in ${column}`,
          reason: `These values are written as dates, but the calendar has no such day. ${NOTHING_PROPOSED}`,
        }
      : {
          title: `Dates in another format in ${column}`,
          reason:
            'These dates are written differently from most of the column. The fix writes the same date in the usual format of the column. Where the day and the month cannot be told apart, nothing is proposed.',
        },
  shape: ({ column }) => ({
    title: `Values that break the pattern of ${column}`,
    reason: `Almost every value of this column has the same pattern of letters and digits, and these do not. ${NOTHING_PROPOSED}`,
  }),
  outlier: ({ column }) => ({
    title: `Unusual numbers in ${column}`,
    reason: `These numbers are far from the rest of the column, or have a sign the column almost never has. They may be right. ${NOTHING_PROPOSED}`,
  }),
  'canonical-value': ({ column, target }) => ({
    title: `Other ways of writing "${target ?? ''}" in ${column}`,
    reason:
      'These cells hold a value that means the same as another one, written another way. The fix writes the spelling the file uses most.',
  }),
  // One group per value written, so the title names the value: two groups never share a title.
  dependency: ({ column, type, target }) =>
    type === 'missing'
      ? {
          title:
            target === undefined
              ? `Empty cells in ${column} that other rows can fill`
              : `Empty cells in ${column} that other rows fill with "${target}"`,
          reason:
            'These cells are empty, and other rows of the file that share a related value agree on what belongs here. The fix writes that value.',
        }
      : {
          title:
            target === undefined
              ? `Values in ${column} that contradict other rows`
              : `Values in ${column} where other rows say "${target}"`,
          reason:
            'In this file another column decides this one, and these cells disagree with what the other rows say. The fix writes the value the other rows share.',
        },
  range: ({ column }) => ({
    title: `Values outside the usual range of ${column}`,
    reason: `These values fall outside the range that almost all of the column stays within. ${NOTHING_PROPOSED}`,
  }),
  format: ({ column }) => ({
    title: `Values in ${column} with a broken format`,
    reason: `This column holds email or web addresses, and these values are not valid ones. ${NOTHING_PROPOSED}`,
  }),
  'flagged-value': ({ column }) => ({
    title: `Test or junk values in ${column}`,
    reason: `These values look like test data, junk or a stand-in for a real value. ${NOTHING_PROPOSED}`,
  }),
};

/** The title and the reason of a group, in plain words. */
export function describeGroup(group: IssueGroup): GroupText {
  const describe = BY_DETECTOR[group.detector];
  if (describe) return describe(group);
  // A detector this table does not know: its id and the reason of its first issue.
  return {
    title: group.column === undefined ? group.detector : `${group.detector} in ${group.column}`,
    reason: group.issues[0]?.reason ?? '',
  };
}

/** Names an issue inside the name of a control: its row and column, or what a removal does. */
export function issueLabel(issue: Issue): string {
  if (issue.fix?.kind === 'delete-row') {
    return `remove row ${issue.fix.rowId}, keep row ${issue.fix.keepRowId}`;
  }
  const rows = issue.rowIds.length === 1 ? `row ${issue.rowIds[0]}` : `rows ${issue.rowIds.join(' and ')}`;
  return issue.column === undefined ? rows : `${rows}, ${issue.column}`;
}

export interface ActionWords {
  /** What the two buttons say. */
  accept: string;
  reject: string;
  /** What the buttons act on: a fix or a flag. */
  noun: 'fix' | 'flag';
}

const FIX_WORDS: ActionWords = { accept: 'Accept', reject: 'Reject', noun: 'fix' };
const FLAG_WORDS: ActionWords = { accept: 'Confirm', reject: 'Dismiss', noun: 'flag' };

/**
 * A fix is accepted or rejected. A flag proposes nothing, so it is confirmed (stored as
 * accepted; no cell changes) or dismissed (stored as rejected).
 */
export function actionWords(issue: Issue): ActionWords {
  return issue.fix === undefined ? FLAG_WORDS : FIX_WORDS;
}

export function statusLabel(issue: Issue, status: Status): string {
  if (status === 'pending') return 'Pending';
  if (issue.fix === undefined) return status === 'accepted' ? 'Confirmed' : 'Dismissed';
  return status === 'accepted' ? 'Accepted' : 'Rejected';
}

/** What a bulk action did, in the words of its buttons: flags are confirmed or dismissed. */
export function bulkWord(decision: Decision, onFlags: boolean): string {
  if (onFlags) return decision === 'accepted' ? 'confirmed' : 'dismissed';
  return decision;
}

/** "1 issue", "3 issues". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}
