// The user's decisions and everything the page derives from them. Pure functions: a
// transition returns a new `Decisions` object and never touches an issue.

import type { Confidence, Decision, Decisions, Issue, IssueType } from '../core/types';

export type Status = 'pending' | Decision;

export function statusOf(decisions: Decisions, issue: Issue): Status {
  return decisions[issue.id] ?? 'pending';
}

/** Sets the decision of one issue; `null` returns it to pending. */
export function decide(decisions: Decisions, issueId: string, decision: Decision | null): Decisions {
  const next = { ...decisions };
  if (decision === null) delete next[issueId];
  else next[issueId] = decision;
  return next;
}

/** Sets the same decision for several issues. */
export function decideMany(decisions: Decisions, issueIds: string[], decision: Decision): Decisions {
  const next = { ...decisions };
  for (const id of issueIds) next[id] = decision;
  return next;
}

/**
 * SPEC §6.4: an issue the model dismissed is set aside, out of the groups, the bulk actions and
 * the counts, while it is pending and the user has not restored it. An issue the user already
 * decided stays in its group.
 */
export function isSetAside(issue: Issue, decisions: Decisions, restored: ReadonlySet<string>): boolean {
  return issue.verdict?.value === 'dismiss' && decisions[issue.id] === undefined && !restored.has(issue.id);
}

/**
 * SPEC §7.3: the accepted fixes that the AI judged "probably not a problem". The opinion can
 * arrive after the decision, and it changes none: the fix stays accepted until the user says
 * otherwise.
 */
export function doubtedAcceptedFixes(issues: Issue[], decisions: Decisions): Issue[] {
  return issues.filter(
    (issue) => issue.fix !== undefined && issue.verdict?.value === 'dismiss' && decisions[issue.id] === 'accepted',
  );
}

export interface Counts {
  pending: number;
  accepted: number;
  rejected: number;
}

/** Counts run over the issues, so a decision whose issue no longer exists is not counted. */
export function countStatuses(issues: Issue[], decisions: Decisions): Counts {
  const counts: Counts = { pending: 0, accepted: 0, rejected: 0 };
  for (const issue of issues) counts[statusOf(decisions, issue)] += 1;
  return counts;
}

export const ISSUE_TYPES: IssueType[] = ['duplicate', 'inconsistent', 'missing', 'suspicious'];

export function countByType(issues: Issue[], decisions: Decisions): Record<IssueType, Counts> {
  const ofType = (type: IssueType) => countStatuses(issues.filter((issue) => issue.type === type), decisions);
  return {
    duplicate: ofType('duplicate'),
    inconsistent: ofType('inconsistent'),
    missing: ofType('missing'),
    suspicious: ofType('suspicious'),
  };
}

export interface Filters {
  type: IssueType | 'all';
  status: Status | 'all';
  confidence: Confidence | 'all';
  source: Issue['source'] | 'all';
}

export const NO_FILTERS: Filters = { type: 'all', status: 'all', confidence: 'all', source: 'all' };

export function matchesFilters(issue: Issue, filters: Filters, decisions: Decisions): boolean {
  return (
    (filters.type === 'all' || issue.type === filters.type) &&
    (filters.status === 'all' || statusOf(decisions, issue) === filters.status) &&
    (filters.confidence === 'all' || issue.confidence === filters.confidence) &&
    (filters.source === 'all' || issue.source === filters.source)
  );
}

/**
 * What a bulk button acts on: among the issues given, the pending ones that propose a fix
 * (`fixes`) or that only flag a problem (`flags`). A decision already made is never part of
 * a bulk action, and a flag is never accepted together with fixes.
 */
export function pendingTargets(issues: Issue[], decisions: Decisions): { fixes: Issue[]; flags: Issue[] } {
  const pending = issues.filter((issue) => statusOf(decisions, issue) === 'pending');
  return {
    fixes: pending.filter((issue) => issue.fix !== undefined),
    flags: pending.filter((issue) => issue.fix === undefined),
  };
}

/**
 * SPEC S2, "accept all high-confidence fixes": among the issues given, the pending ones that
 * propose a fix and whose own confidence is high. Never a flag, never a decision already made.
 */
export function pendingHighConfidenceFixes(issues: Issue[], decisions: Decisions): Issue[] {
  return pendingTargets(issues, decisions).fixes.filter((issue) => issue.confidence === 'high');
}

/**
 * The rows that the accepted fixes remove, each with the row that is kept in its place.
 * SPEC §5.6: a cell issue on such a row is dropped when the decisions are applied.
 */
export function removedRows(issues: Issue[], decisions: Decisions): Map<number, number> {
  const removed = new Map<number, number>();
  for (const issue of issues) {
    if (issue.fix?.kind === 'delete-row' && statusOf(decisions, issue) === 'accepted') {
      removed.set(issue.fix.rowId, issue.fix.keepRowId);
    }
  }
  return removed;
}

/** True when both give every one of these issues the same status. */
export function sameDecisions(a: Decisions, b: Decisions, issues: Issue[]): boolean {
  return issues.every((issue) => statusOf(a, issue) === statusOf(b, issue));
}
