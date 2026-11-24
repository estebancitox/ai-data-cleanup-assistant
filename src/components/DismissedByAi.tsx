// SPEC §6.4: the issues the model judged not to be problems. Collapsed, out of the groups, the
// bulk actions and the counts. The user can restore any of them and decide it by hand.

import { useId, useState } from "react";
import type { Issue, Row } from "../core/types";
import { IssueRow } from "./IssueRow";

interface DismissedByAiProps {
  issues: Issue[];
  columns: string[];
  rowsById: Map<number, Row>;
  onRestore: (issueId: string) => void;
}

const NO_REMOVED_ROWS = new Map<number, number>();

export function DismissedByAi({ issues, columns, rowsById, onRestore }: DismissedByAiProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    // The model's own section: its edge is the second pen.
    <section aria-labelledby={`${id}-title`} className="mt-8 border border-grid border-l-[3px] border-l-model bg-sheet">
      <div className="px-4 py-3">
        <h2 id={`${id}-title`} className="text-title font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? `${id}-issues` : undefined}
            onClick={() => setOpen(!open)}
            className="-mx-1 inline-flex cursor-pointer items-baseline gap-2.5 rounded-control px-1 text-left hover:underline"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-4 shrink-0 items-center justify-center self-center border border-edge bg-sheet text-note leading-none font-bold"
            >
              {open ? "−" : "+"}
            </span>
            Dismissed by AI <span className="font-normal">({issues.length})</span>
          </button>
        </h2>
        <p className="mt-1 max-w-[80ch] pl-[1.625rem] text-muted">
          The rules reported these, and the AI judged that they are not problems. They are left out of the counts and
          of the bulk actions, and they change nothing in the cleaned file. Restore one to decide it yourself.
        </p>
      </div>
      {open && (
        <ul id={`${id}-issues`} className="border-t border-grid bg-canvas px-4 pb-3">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              status="pending"
              columns={columns}
              rowsById={rowsById}
              removedRows={NO_REMOVED_ROWS}
              onDecide={() => {}}
              onRestore={() => onRestore(issue.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
