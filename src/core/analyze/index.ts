// Finds every issue in a dataset. SPEC §5.4 to §5.6.

import { profileDataset } from '../profile';
import type { Analysis, Confidence, Dataset, Issue, IssueGroup, Profile, VerifiedContract } from '../types';
import { detectCanonicalValue, detectFlaggedValue, detectMissingToken, detectRange } from './detectors/contract-values';
import { detectDateFormat } from './detectors/date-format';
import { detectDependency } from './detectors/dependency';
import { detectDuplicates } from './detectors/duplicates';
import { detectMissing } from './detectors/missing';
import { detectNumberFormat } from './detectors/number-format';
import { detectOutliers } from './detectors/outlier';
import { detectShape } from './detectors/shape';
import { detectSpelling } from './detectors/spelling';
import { issueId, onePerCell, type Candidate } from './precedence';

export { NEAR_DUPLICATE_MIN_SIMILARITY } from './detectors/duplicates';

/**
 * Finds every issue in the dataset. Without a contract it runs the rule detectors only. With
 * a verified contract it also runs the detectors that the contract drives. Pure and
 * deterministic: the same inputs give the same issues with the same ids, so decisions made
 * on a rules-only result stay valid after the contract arrives.
 */
export function analyze(dataset: Dataset, contract?: VerifiedContract): Analysis {
  const profile = profileDataset(dataset);
  // The detectors a verified contract drives; without a contract they find nothing.
  const driven = (detect: (dataset: Dataset, profile: Profile, contract: VerifiedContract) => Candidate[]) =>
    contract ? detect(dataset, profile, contract) : [];
  // Cell detectors in the precedence order of §5.6: C3, C1, C2, R3, R5, R6, R4, C5, C6, C4,
  // R7, R8. C5 is not built; its place is between R4 and C6.
  const cellIssues = onePerCell([
    driven(detectDependency),
    driven(detectCanonicalValue),
    driven(detectMissingToken),
    detectMissing(dataset, profile),
    detectNumberFormat(dataset, profile),
    detectDateFormat(dataset, profile),
    detectSpelling(dataset, profile),
    driven(detectFlaggedValue),
    driven(detectRange),
    detectShape(dataset, profile),
    detectOutliers(dataset, profile),
  ]);
  const rowIssues = detectDuplicates(dataset, profile);

  const columnPosition = new Map(dataset.columns.map((name, index) => [name, index]));
  const position = (issue: Issue) => (issue.column === undefined ? -1 : (columnPosition.get(issue.column) ?? 0));
  const issues: Issue[] = [...rowIssues, ...cellIssues]
    .map((candidate) => ({ id: issueId(candidate), ...candidate }))
    .sort(
      (a, b) =>
        Math.min(...a.rowIds) - Math.min(...b.rowIds) ||
        position(a) - position(b) ||
        Math.max(...a.rowIds) - Math.max(...b.rowIds),
    );

  return contract ? { issues, profile, contract } : { issues, profile };
}

// Detectors whose fix rewrites each cell's own value: their targets differ cell by cell, so
// the target is not part of the group.
const REFORMATTING_DETECTORS = new Set(['whitespace', 'number-format', 'date-format']);
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Groups issues for review and bulk decisions: same type, detector, source and column, and
 * the same target value when the fix writes a value the group shares. Fixes that reformat
 * each cell's own value are grouped without the target. The source is part of the group
 * because a rule and a contract rule can share a detector id.
 */
export function groupIssues(issues: Issue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const target =
      issue.fix?.kind === 'set-cell' && !REFORMATTING_DETECTORS.has(issue.detector) ? issue.fix.to : undefined;
    const id = [issue.type, issue.detector, issue.source, issue.column ?? '', target === undefined ? '' : `=${target}`].join('|');
    const group = groups.get(id);
    if (!group) {
      groups.set(id, {
        id,
        type: issue.type,
        detector: issue.detector,
        source: issue.source,
        ...(issue.column === undefined ? {} : { column: issue.column }),
        ...(target === undefined ? {} : { target }),
        confidence: issue.confidence,
        issues: [issue],
      });
      continue;
    }
    group.issues.push(issue);
    if (CONFIDENCE_RANK[issue.confidence] < CONFIDENCE_RANK[group.confidence]) {
      group.confidence = issue.confidence;
    }
  }
  return [...groups.values()];
}
