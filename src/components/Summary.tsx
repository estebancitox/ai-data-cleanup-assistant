// SPEC §7.3: one row per issue type with its total, and its pending, accepted and rejected
// issues as a bar with the three counts in words.

import type { IssueType } from "../core/types";
import { ISSUE_TYPES, type Counts } from "../lib/decisions";
import { TYPE_LABEL } from "../lib/describe";
import { DecisionBar } from "./DecisionBar";

export function Summary({ byType }: { byType: Record<IssueType, Counts> }) {
  return (
    <section aria-label="Summary by issue type">
      <table className="sheet">
        <caption className="sr-only">Issues by type</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col" className="w-20 text-right">
              Issues
            </th>
            <th scope="col" className="w-[58%]">
              Decisions
            </th>
          </tr>
        </thead>
        <tbody>
          {ISSUE_TYPES.map((type) => {
            const counts = byType[type];
            return (
              <tr key={type}>
                <th scope="row" className="text-body font-semibold">
                  {TYPE_LABEL[type]}
                </th>
                <td className="text-right text-title font-bold">
                  {counts.pending + counts.accepted + counts.rejected}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <DecisionBar counts={counts} className="min-w-32 flex-1" />
                    <p className="text-note whitespace-nowrap">
                      <b>{counts.pending}</b> pending, <b>{counts.accepted}</b> accepted, <b>{counts.rejected}</b>{" "}
                      rejected
                    </p>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
