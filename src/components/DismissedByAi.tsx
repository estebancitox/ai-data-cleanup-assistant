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
    <section aria-labelledby={`${id}-title`} className="mt-10 border-t border-line pt-4">
      <h2 id={`${id}-title`} className="text-[15px] font-semibold leading-snug">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? `${id}-issues` : undefined}
          onClick={() => setOpen(!open)}
          className="-mx-1 inline-flex cursor-pointer items-baseline gap-2 rounded-[3px] px-1 text-left hover:underline"
        >
          <span aria-hidden="true" className="w-3 shrink-0 font-mono text-[12px] text-muted">
            {open ? "▾" : "▸"}
          </span>
          Dismissed by AI <span className="font-mono font-normal">({issues.length})</span>
        </button>
      </h2>
      <p className="mt-1 max-w-[75ch] pl-5 text-muted">
        The rules reported these, and the AI judged that they are not problems. They are left out of the counts and of
        the bulk actions, and they change nothing in the cleaned file. Restore one to decide it yourself.
      </p>
      {open && (
        <ul id={`${id}-issues`} className="mt-3 pl-5">
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
