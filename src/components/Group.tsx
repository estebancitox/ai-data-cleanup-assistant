// SPEC §7.3, one group of issues: collapsed by default, with a title and a reason in plain
// words, its counts, source and confidence, and the bulk actions.

import { useId, useState } from "react";
import type { Confidence, Decision, Decisions, IssueGroup, Row, VerifiedContract } from "../core/types";
import { pendingTargets, statusOf } from "../lib/decisions";
import { CONFIDENCE_LABEL, SOURCE_LABEL, TYPE_LABEL, describeGroup } from "../lib/describe";
import { IssueRow } from "./IssueRow";

/** A group shows this many issues, and this many more with each "Show more". */
const PAGE_SIZE = 50;

/** Confidence as a shape, next to its words: one, two or three filled steps. */
const STEPS: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

interface GroupProps {
  group: IssueGroup;
  /** The issues of the group that the filters let through, in the group's order. */
  shown: IssueGroup["issues"];
  decisions: Decisions;
  columns: string[];
  rowsById: Map<number, Row>;
  /** The rows that accepted duplicate fixes remove, each with the row kept in its place. */
  removedRows: Map<number, number>;
  /** The verified rules "one column decides another" of this file, where there is a contract. */
  dependencies?: VerifiedContract["dependencies"];
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
  dependencies,
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
      {words} <span>({issues.length})</span>
    </button>
  );

  return (
    <section role="group" aria-labelledby={`${id}-title`} className="mt-3 border border-grid bg-sheet">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-[26rem]">
          <h3 id={`${id}-title`} className="text-title font-semibold">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? `${id}-issues` : undefined}
              onClick={() => setOpen(!open)}
              className="-mx-1 inline-flex cursor-pointer items-baseline gap-2.5 rounded-control px-1 text-left hover:underline"
            >
              {/* The sheet's own mark for rows that are folded away. */}
              <span
                aria-hidden="true"
                className="inline-flex size-4 shrink-0 items-center justify-center self-center border border-edge bg-sheet text-note leading-none font-bold"
              >
                {open ? "−" : "+"}
              </span>
              {text.title}
            </button>
          </h3>
          <p className="mt-1 max-w-[80ch] pl-[1.625rem] text-muted">{text.reason}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-[1.625rem] text-note">
            <span className="tag">{TYPE_LABEL[group.type]}</span>
            <span>
              {shown.length !== group.issues.length && (
                <>
                  <b>{shown.length}</b> of{" "}
                </>
              )}
              <b>{group.issues.length}</b> {group.issues.length === 1 ? "issue" : "issues"}
            </span>
            <span>
              <b>{pending}</b> pending
            </span>
            <span className={group.source === "ai" ? "tag tag-model" : "tag"}>Source: {SOURCE_LABEL[group.source]}</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex gap-0.5">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-2.5 w-1.5 border border-ink ${step <= STEPS[group.confidence] ? "bg-ink" : "bg-sheet"}`}
                  />
                ))}
              </span>
              {CONFIDENCE_LABEL[group.confidence]}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[1.625rem]">
          {hasFixes && bulk("Accept all", targets.fixes, "accepted")}
          {hasFixes && bulk("Reject all", targets.fixes, "rejected")}
          {hasFlags && bulk("Confirm all", targets.flags, "accepted")}
          {hasFlags && bulk("Dismiss all", targets.flags, "rejected")}
        </div>
      </div>

      {open && (
        <div id={`${id}-issues`} className="border-t border-grid bg-canvas px-4 pb-3">
          <ul>
            {shown.slice(0, limit).map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                status={statusOf(decisions, issue)}
                columns={columns}
                rowsById={rowsById}
                removedRows={removedRows}
                dependencies={dependencies}
                onDecide={onDecide}
              />
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" className="btn mt-2" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Show more <span>({hidden} hidden)</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
