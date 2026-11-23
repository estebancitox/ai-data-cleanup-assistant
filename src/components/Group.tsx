// SPEC §7.3, one group of issues: collapsed by default, with a title and a reason in plain
// words, its counts, source and confidence, and the bulk actions.

import { useId, useState } from "react";
import type { Decision, Decisions, IssueGroup, Row } from "../core/types";
import { pendingTargets, statusOf } from "../lib/decisions";
import { CONFIDENCE_LABEL, SOURCE_LABEL, TYPE_LABEL, describeGroup } from "../lib/describe";
import { IssueRow } from "./IssueRow";

/** A group shows this many issues, and this many more with each "Show more". */
const PAGE_SIZE = 50;

interface GroupProps {
  group: IssueGroup;
  /** The issues of the group that the filters let through, in the group's order. */
  shown: IssueGroup["issues"];
  decisions: Decisions;
  columns: string[];
  rowsById: Map<number, Row>;
  /** The rows that accepted duplicate fixes remove, each with the row kept in its place. */
  removedRows: Map<number, number>;
  onDecide: (issueId: string, decision: Decision | null) => void;
  onDecideMany: (issueIds: string[], decision: Decision) => void;
}

export function Group({
  group,
  shown,
  decisions,
  columns,
  rowsById,
  removedRows,
  onDecide,
  onDecideMany,
}: GroupProps) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const id = useId();

  const text = describeGroup(group);
  // Bulk actions reach only what is pending and on screen; a decision already made stays.
  const targets = pendingTargets(shown, decisions);
  const hasFixes = shown.some((issue) => issue.fix !== undefined);
  const hasFlags = shown.some((issue) => issue.fix === undefined);
  const pending = targets.fixes.length + targets.flags.length;
  const hidden = shown.length - Math.min(limit, shown.length);

  const bulk = (words: string, issues: IssueGroup["issues"], decision: Decision) => (
    <button
      type="button"
      className="btn"
      disabled={issues.length === 0}
      aria-label={`${words} (${issues.length}): ${text.title}`}
      onClick={() => onDecideMany(issues.map((issue) => issue.id), decision)}
    >
      {words} <span className="font-mono">({issues.length})</span>
    </button>
  );

  return (
    <section role="group" aria-labelledby={`${id}-title`} className="border-t border-line">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-4">
        <div className="min-w-0 flex-1 basis-[420px]">
          <h3 id={`${id}-title`} className="text-[15px] font-semibold leading-snug">
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
              {text.title}
            </button>
          </h3>
          <p className="mt-1 max-w-[75ch] pl-5 text-muted">{text.reason}</p>
          <p className="mt-2 pl-5 text-[13px]">
            <span>{TYPE_LABEL[group.type]}</span>
            <Dot />
            {shown.length !== group.issues.length && (
              <>
                <span className="font-mono">{shown.length}</span> of{" "}
              </>
            )}
            <span className="font-mono">{group.issues.length}</span> {group.issues.length === 1 ? "issue" : "issues"}
            <Dot />
            <span className="font-mono">{pending}</span> pending
            <Dot />
            <span>Source: {SOURCE_LABEL[group.source]}</span>
            <Dot />
            <span>{CONFIDENCE_LABEL[group.confidence]}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5">
          {hasFixes && bulk("Accept all", targets.fixes, "accepted")}
          {hasFixes && bulk("Reject all", targets.fixes, "rejected")}
          {hasFlags && bulk("Confirm all", targets.flags, "accepted")}
          {hasFlags && bulk("Dismiss all", targets.flags, "rejected")}
        </div>
      </div>

      {open && (
        <div id={`${id}-issues`} className="pb-4 pl-5">
          <ul>
            {shown.slice(0, limit).map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                status={statusOf(decisions, issue)}
                columns={columns}
                rowsById={rowsById}
                removedRows={removedRows}
                onDecide={onDecide}
              />
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" className="btn mt-2" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Show more <span className="font-mono">({hidden} hidden)</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="px-2 text-muted">
      ·
    </span>
  );
}
