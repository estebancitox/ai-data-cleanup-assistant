// SPEC §7.3, one issue: its row, the cell before and after with the difference marked, the
// reason and the evidence, and the two buttons that record the decision.

import type { Decision, Issue, Row } from "../core/types";
import type { Status } from "../lib/decisions";
import { actionWords, issueLabel, statusLabel } from "../lib/describe";
import { diffValues, unchanged } from "../lib/diff";
import { CellValue } from "./CellValue";
import { DuplicatePair } from "./DuplicatePair";

interface IssueRowProps {
  issue: Issue;
  status: Status;
  columns: string[];
  rowsById: Map<number, Row>;
  /** `null` returns the issue to pending. */
  onDecide: (issueId: string, decision: Decision | null) => void;
}

const LABEL = "text-[12px] text-muted";

export function IssueRow({ issue, status, columns, rowsById, onDecide }: IssueRowProps) {
  const words = actionWords(issue);
  const label = issueLabel(issue);
  const { fix } = issue;
  const kept = fix?.kind === "delete-row" ? rowsById.get(fix.keepRowId) : undefined;
  const removed = fix?.kind === "delete-row" ? rowsById.get(fix.rowId) : undefined;

  // Pressing the decision that is in force takes it back.
  const toggle = (decision: Decision) => onDecide(issue.id, status === decision ? null : decision);

  return (
    <li className="border-t border-hairline py-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <p className="w-28 shrink-0 text-[13px]">
          <span className="text-muted">{issue.rowIds.length === 1 ? "Row" : "Rows"}</span>{" "}
          <span className="font-mono">{issue.rowIds.join(", ")}</span>
        </p>

        <div className="min-w-0 flex-1 basis-[420px]">
          {fix?.kind === "set-cell" && <CellChange from={issue.current ?? ""} to={fix.to} />}
          {fix === undefined && issue.column !== undefined && (
            <div>
              <p className={LABEL}>Value, no fix proposed</p>
              <CellValue segments={unchanged(issue.current ?? "")} />
            </div>
          )}
          <p className="mt-2 max-w-[75ch]">{issue.reason}</p>
          {issue.evidence !== undefined && <p className="max-w-[75ch] text-[13px] text-muted">{issue.evidence}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <p className="w-20 text-right text-[13px] font-medium">{statusLabel(issue, status)}</p>
          <button
            type="button"
            className="btn"
            aria-pressed={status === "accepted"}
            aria-label={`${words.accept} ${words.noun}: ${label}`}
            onClick={() => toggle("accepted")}
          >
            {words.accept}
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={status === "rejected"}
            aria-label={`${words.reject} ${words.noun}: ${label}`}
            onClick={() => toggle("rejected")}
          >
            {words.reject}
          </button>
        </div>
      </div>

      {kept && removed && (
        <div className="mt-3 pl-0 md:pl-[8.5rem]">
          <DuplicatePair columns={columns} kept={kept} removed={removed} />
        </div>
      )}
    </li>
  );
}

function CellChange({ from, to }: { from: string; to: string }) {
  const diff = diffValues(from, to);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-3">
      <div>
        <p className={LABEL}>Before</p>
        <CellValue segments={diff.from} side="old" />
      </div>
      <span aria-hidden="true" className="pb-0.5 text-muted">
        →
      </span>
      <div>
        <p className={LABEL}>After</p>
        <CellValue segments={diff.to} side="new" />
      </div>
    </div>
  );
}
