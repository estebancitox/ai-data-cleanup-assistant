// SPEC §7.3: the two rows of a duplicate, stacked as they are in the sheet, cut down to the
// columns that differ. The part of each value that differs is marked; the columns that are
// the same are behind "Show whole rows".

import type { Row } from "../core/types";
import type { Status } from "../lib/decisions";
import { diffValues } from "../lib/diff";
import { CellValue } from "./CellValue";

interface DuplicatePairProps {
  columns: string[];
  /** The row that stays. */
  kept: Row;
  /** The row the fix removes. */
  removed: Row;
  /** What the user decided; `aside` for a pair in "Dismissed by AI". */
  state: Status | "aside";
  /** The word of the decision cell. */
  decision: string;
}

export function DuplicatePair({ columns, kept, removed, state, decision }: DuplicatePairProps) {
  const differing = columns.filter((name) => kept.cells[name] !== removed.cells[name]);
  // Pending: the row that would go is struck, on the pending fill. Accepted: it goes, and the
  // row that is kept is what the cleaned file will hold. Rejected or set aside: both stay.
  const going = state === "pending" ? "cell-gone bg-pending" : state === "accepted" ? "cell-gone" : undefined;
  const fate = state === "pending" ? "cell-pending" : undefined;
  const staying = state === "accepted" ? "cell-accepted" : undefined;

  return (
    // A pair that differs in many columns scrolls sideways, with the mouse or the keyboard.
    <div
      role="region"
      aria-label={`Rows ${kept.id} and ${removed.id}, the columns that differ`}
      tabIndex={0}
      className="overflow-x-auto"
    >
      {/* As wide as its values need: a pair that differs in many columns scrolls sideways. */}
      <table className="sheet sheet-wide">
        <caption className="sr-only">
          Rows {kept.id} and {removed.id}:{" "}
          {differing.length === 0
            ? `the same in all ${columns.length} columns`
            : `${differing.length} of ${columns.length} columns differ`}
        </caption>
        <thead>
          <tr>
            <td className="gutter" />
            <th scope="col" className="whitespace-nowrap">
              What the fix does
            </th>
            {differing.length === 0 && <th scope="col">All {columns.length} columns</th>}
            {differing.map((name) => (
              <th key={name} scope="col">
                <span className="file [overflow-wrap:anywhere]">{name}</span>{" "}
                <span className="font-semibold text-ink">differs</span>
              </th>
            ))}
            <th scope="col" className="frozen-end w-[7.5rem] whitespace-nowrap">
              Decision
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="gutter">
              <span className="sr-only">Row </span>
              {kept.id}
            </th>
            <td className={staying ? `${staying} whitespace-nowrap` : "whitespace-nowrap"}>kept</td>
            {differing.length === 0 && (
              <td rowSpan={2}>
                The two rows are the same in all {columns.length} columns.
              </td>
            )}
            {differing.map((name) => (
              <td key={name}>
                {/* Only the part of the two values that differs is marked. */}
                <CellValue segments={diffValues(kept.cells[name] ?? "", removed.cells[name] ?? "").from} />
              </td>
            ))}
            <td rowSpan={2} className={state === "aside" ? "frozen-end font-semibold text-model" : "frozen-end font-semibold"}>
              {decision}
            </td>
          </tr>
          <tr>
            <th scope="row" className="gutter">
              <span className="sr-only">Row </span>
              {removed.id}
            </th>
            {/* A fix that will not be applied removes nothing: rejected, or set aside by the AI. */}
            <td className={fate ? `${fate} whitespace-nowrap` : "whitespace-nowrap"}>
              {state === "rejected" || state === "aside" ? "would be removed" : "removed by the fix"}
            </td>
            {differing.map((name) => (
              <td key={name} className={going}>
                <CellValue segments={diffValues(kept.cells[name] ?? "", removed.cells[name] ?? "").to} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
