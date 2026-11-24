// SPEC §7.3, one issue, drawn as a strip of the sheet: the row number in the gutter, the column
// name as a header cell, the value in its cell and the decision as the last cell. Under the
// strip: the reason and the evidence, what the model said, and the rest of the row on request.

import { useId, useState } from "react";
import type { Decision, Issue, Row, VerifiedContract } from "../core/types";
import type { Status } from "../lib/decisions";
import { VERDICT_LABEL, actionWords, issueLabel, statusLabel } from "../lib/describe";
import { diffValues, unchanged } from "../lib/diff";
import { CellValue } from "./CellValue";
import { DuplicatePair } from "./DuplicatePair";
import { WholeRows } from "./WholeRows";

interface IssueRowProps {
  issue: Issue;
  status: Status;
  columns: string[];
  rowsById: Map<number, Row>;
  /** The rows that accepted duplicate fixes remove, each with the row kept in its place. */
  removedRows: Map<number, number>;
  /** The verified rules "one column decides another" of this file, where there is a contract. */
  dependencies?: VerifiedContract["dependencies"];
  /** `null` returns the issue to pending. */
  onDecide: (issueId: string, decision: Decision | null) => void;
  /** Given for an issue in "Dismissed by AI": the row offers "Restore" in place of a decision. */
  onRestore?: () => void;
}

/**
 * The column that is the evidence for an issue of the dependency detector (SPEC §5.5, C3): the
 * one that decides the issue's column. An issue has no field that names the rule behind it, so
 * the column comes from the verified contract, and it is shown only when exactly one verified
 * rule decides this column and the issue's own reason or evidence names that column. The text
 * is a guard, not the source: an issue carried over from an earlier analysis (SPEC §7.3) can
 * sit next to a contract whose rule did not produce it. Any other issue on the same column
 * has no such column.
 */
function decidingColumn(issue: Issue, dependencies: VerifiedContract["dependencies"] | undefined): string | undefined {
  if (issue.detector !== "dependency" || dependencies === undefined) return undefined;
  const rules = dependencies.filter((rule) => rule.dependent === issue.column);
  if (rules.length !== 1) return undefined;
  const { determinant } = rules[0];
  const named = issue.reason.includes(determinant) || (issue.evidence ?? "").includes(determinant);
  return named ? determinant : undefined;
}

/** The text under a strip starts where the text of its cells starts. */
const UNDER_STRIP = "pl-[calc(var(--spacing-gutter)+0.625rem)]";

export function IssueRow({
  issue,
  status,
  columns,
  rowsById,
  removedRows,
  dependencies,
  onDecide,
  onRestore,
}: IssueRowProps) {
  const words = actionWords(issue);
  const label = issueLabel(issue);
  const { fix } = issue;
  const kept = fix?.kind === "delete-row" ? rowsById.get(fix.keepRowId) : undefined;
  const removed = fix?.kind === "delete-row" ? rowsById.get(fix.rowId) : undefined;
  // SPEC §5.6: an issue about a cell of a row that an accepted duplicate fix removes is
  // dropped when the decisions are applied. The row says so while that fix stays accepted.
  const keptInstead = fix?.kind === "delete-row" ? undefined : removedRows.get(issue.rowIds[0]);

  // Pressing the decision that is in force takes it back.
  const toggle = (decision: Decision) => onDecide(issue.id, status === decision ? null : decision);

  // Display only: the other columns of the row are rendered when the user asks for them.
  const [whole, setWhole] = useState(false);
  const wholeId = useId();
  const setAside = onRestore !== undefined;
  const state = setAside ? "aside" : status;
  const decision = setAside ? "Set aside by AI" : statusLabel(issue, status);
  const rows = kept && removed ? [kept, removed] : issue.rowIds.flatMap((id) => rowsById.get(id) ?? []);
  const marked =
    kept && removed
      ? columns.filter((name) => kept.cells[name] !== removed.cells[name])
      : issue.column === undefined
        ? []
        : [issue.column];
  const showWords = rows.length > 1 ? "Show whole rows" : "Show whole row";

  return (
    <li className="border-t border-grid py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[26rem]">
          {kept && removed ? (
            <DuplicatePair columns={columns} kept={kept} removed={removed} state={state} decision={decision} />
          ) : (
            <CellStrip
              issue={issue}
              row={rows[0]}
              state={state}
              decision={decision}
              decidedBy={decidingColumn(issue, dependencies)}
              rowRemoved={keptInstead !== undefined}
            />
          )}
        </div>

        {onRestore !== undefined && (
          <button type="button" className="btn shrink-0" aria-label={`Restore: ${label}`} onClick={onRestore}>
            Restore
          </button>
        )}
        {onRestore === undefined && (
          <div className="flex shrink-0 items-center gap-2">
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
        )}
      </div>

      <div className={`mt-2 max-w-[80ch] space-y-1 ${UNDER_STRIP}`}>
        <p>{issue.reason}</p>
        {issue.evidence !== undefined && <p className="text-note text-muted">{issue.evidence}</p>}
        {issue.verdict !== undefined && (
          <p className="note-model text-note">
            <span className="font-bold">{VERDICT_LABEL[issue.verdict.value]}</span> {issue.verdict.reason}
          </p>
        )}
        {keptInstead !== undefined && (
          <p className="border-l-[3px] border-removal pl-2.5 text-note">
            Row {issue.rowIds[0]} is removed by a duplicate fix you accepted (row {keptInstead} is kept), so this issue
            does not reach the cleaned file.
          </p>
        )}
        {rows.length > 0 && (
          <button
            type="button"
            aria-expanded={whole}
            aria-controls={whole ? wholeId : undefined}
            aria-label={`${showWords}: ${label}`}
            onClick={() => setWhole(!whole)}
            className="cursor-pointer rounded-control text-note font-semibold underline underline-offset-[3px] hover:no-underline"
          >
            {showWords}
          </button>
        )}
      </div>

      {whole && <WholeRows id={wholeId} columns={columns} rows={rows} marked={new Set(marked)} />}
    </li>
  );
}

interface CellStripProps {
  issue: Issue;
  /** The row of the issue, as the file has it. */
  row: Row | undefined;
  /** What the user decided; `aside` for an issue in "Dismissed by AI". */
  state: Status | "aside";
  /** The word of the decision cell. */
  decision: string;
  /** The column that decides this one, shown beside it. */
  decidedBy?: string;
  /** An accepted duplicate fix removes this row, so a fix on its cell does not reach the cleaned file. */
  rowRemoved: boolean;
}

/** One row of the sheet, cut down to the cell of the issue and the cell that explains it. */
function CellStrip({ issue, row, state, decision, decidedBy, rowRemoved }: CellStripProps) {
  const { fix } = issue;
  const rowId = issue.rowIds[0];
  const current = issue.current ?? "";

  return (
    <table className="sheet table-fixed">
      <caption className="sr-only">
        Row {rowId}
        {issue.column !== undefined && `, ${issue.column}`}
      </caption>
      <thead>
        <tr>
          <td className="gutter" />
          {decidedBy !== undefined && (
            <th scope="col" className="file w-[24%] [overflow-wrap:anywhere]">
              {decidedBy}
            </th>
          )}
          {issue.column !== undefined && (
            <th scope="col" colSpan={fix?.kind === "set-cell" ? 2 : 1} className="file [overflow-wrap:anywhere]">
              {issue.column}
            </th>
          )}
          <th scope="col" className="w-[7.5rem]">
            Decision
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="gutter">
            <span className="sr-only">Row </span>
            {rowId}
          </th>
          {decidedBy !== undefined && (
            <td>
              <CellValue segments={unchanged(row?.cells[decidedBy] ?? "")} />
            </td>
          )}
          {fix?.kind === "set-cell" && <FixCells from={current} to={fix.to} state={state} rowRemoved={rowRemoved} />}
          {fix === undefined && issue.column !== undefined && (
            // A flag proposes nothing: the cell waits for a decision, and then stays as it is.
            <td className={state === "pending" ? "cell-pending" : undefined}>
              <CellValue segments={unchanged(current)} />
            </td>
          )}
          <td className={state === "aside" ? "font-semibold text-model" : "font-semibold"}>{decision}</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * The value in the file and the value proposed, always in that order, with the part that
 * differs marked in every state. Pending: both cells wait on the pending fill, the old value
 * struck. Accepted: the old value is struck with no fill, and the new one is what the cleaned
 * file will hold, unless an accepted duplicate fix removes the row (SPEC §5.6): then the fix
 * is not applied, and the new value has no accepted fill. Rejected or set aside: the file
 * stays as it is, so the old value is not struck; a rejected proposal is crossed out.
 */
function FixCells({
  from,
  to,
  state,
  rowRemoved,
}: {
  from: string;
  to: string;
  state: Status | "aside";
  rowRemoved: boolean;
}) {
  const diff = diffValues(from, to);
  if (state === "rejected" || state === "aside") {
    return (
      <>
        <td>
          <span className="sr-only">In the file: </span>
          <CellValue segments={diff.from} />
        </td>
        <td className={state === "rejected" ? "cell-dropped" : undefined}>
          <span className="sr-only">Proposed: </span>
          <CellValue segments={diff.to} />
        </td>
      </>
    );
  }
  return (
    <>
      <td className={state === "pending" ? "cell-gone bg-pending" : "cell-gone"}>
        <span className="sr-only">In the file: </span>
        <CellValue segments={diff.from} side="old" />
      </td>
      <td className={state === "pending" ? "cell-pending" : rowRemoved ? undefined : "cell-accepted"}>
        <span className="sr-only">Proposed: </span>
        <CellValue segments={diff.to} side="new" />
      </td>
    </>
  );
}
