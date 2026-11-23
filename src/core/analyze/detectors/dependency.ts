// C3: for a verified rule "A determines B", a B that disagrees with the clear majority for its
// A, and a missing B where that majority exists. SPEC §5.5.

import { dependencyGroups, observedValues } from '../../contract';
import type { Dataset, Profile, VerifiedContract } from '../../types';
import type { Candidate } from '../precedence';

const CLEAR_MIN_ROWS = 3;
const CLEAR_MIN_SHARE = 0.8;
const HIGH_MIN_ROWS = 5;
const HIGH_MIN_SHARE = 0.9;

export function detectDependency(dataset: Dataset, profile: Profile, contract: VerifiedContract): Candidate[] {
  const found: Candidate[] = [];
  for (const rule of contract.dependencies) {
    const column = profile.columns.find((candidate) => candidate.name === rule.dependent);
    if (!column) continue;
    const spellings = observedValues(dataset, column);

    for (const group of dependencyGroups(dataset, profile, rule, contract)) {
      const share = group.present === 0 ? 0 : group.majorityCount / group.present;
      if (group.majorityKey === null || group.majorityCount < CLEAR_MIN_ROWS || share < CLEAR_MIN_SHARE) continue;
      // The majority value as the column writes it most often, so the fix is a value of the file.
      const to = spellings.get(group.majorityKey)?.spelling;
      if (to === undefined) continue;
      const confidence = group.majorityCount >= HIGH_MIN_ROWS && share >= HIGH_MIN_SHARE ? 'high' : 'medium';

      for (const row of group.rows) {
        if (row.key === group.majorityKey) continue;
        const missing = row.key === null;
        const others = group.present - (missing ? 0 : 1);
        found.push({
          type: missing ? 'missing' : 'inconsistent',
          detector: 'dependency',
          source: 'ai',
          rowIds: [row.rowId],
          column: rule.dependent,
          current: row.current,
          fix: { kind: 'set-cell', rowId: row.rowId, column: rule.dependent, to },
          reason: missing
            ? `This cell has no value, and the other rows with the same ${rule.determinant} have "${to}".`
            : `The other rows with the same ${rule.determinant} have "${to}" here.`,
          evidence: `${group.majorityCount} of ${others} other rows with this ${rule.determinant} have this ${rule.dependent}.`,
          confidence,
        });
      }
    }
  }
  return found;
}
