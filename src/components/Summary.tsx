// SPEC §7.3: one card per issue type with its pending, accepted and rejected counts.

import type { IssueType } from "../core/types";
import { ISSUE_TYPES, type Counts } from "../lib/decisions";
import { TYPE_LABEL } from "../lib/describe";

export function Summary({ byType }: { byType: Record<IssueType, Counts> }) {
  return (
    <section aria-label="Summary by issue type">
      <ul className="grid grid-cols-2 border-l border-t border-line md:grid-cols-4">
        {ISSUE_TYPES.map((type) => {
          const counts = byType[type];
          return (
            <li key={type} className="border-b border-r border-line px-4 py-3.5">
              <h3 className="text-[13px] font-medium text-muted">{TYPE_LABEL[type]}</h3>
              <p className="mt-1 font-mono text-[26px] leading-none">
                {counts.pending + counts.accepted + counts.rejected}
              </p>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 text-[13px]">
                <dt className="text-muted">Pending</dt>
                <dd className="text-right font-mono">{counts.pending}</dd>
                <dt className="text-muted">Accepted</dt>
                <dd className="text-right font-mono">{counts.accepted}</dd>
                <dt className="text-muted">Rejected</dt>
                <dd className="text-right font-mono">{counts.rejected}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
