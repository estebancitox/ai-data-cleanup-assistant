// SPEC §7.3: the two rows of a duplicate side by side, one line per column, with the cells
// that differ marked in words.

import type { Row } from "../core/types";
import { diffValues } from "../lib/diff";
import { CellValue } from "./CellValue";

interface DuplicatePairProps {
  columns: string[];
  /** The row that stays. */
  kept: Row;
  /** The row the fix removes. */
  removed: Row;
}

export function DuplicatePair({ columns, kept, removed }: DuplicatePairProps) {
  const differing = columns.filter((name) => kept.cells[name] !== removed.cells[name]);

  const table = (
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">
        Rows {kept.id} and {removed.id} side by side
      </caption>
      <thead>
        <tr className="border-b border-line text-[12px] text-muted">
          <th scope="col" className="w-[22%] py-1.5 pr-3 font-medium">
            Column
          </th>
          <th scope="col" className="w-[39%] py-1.5 pr-3 font-medium">
            Row <span className="font-mono">{kept.id}</span>, kept
          </th>
          <th scope="col" className="w-[39%] py-1.5 font-medium">
            Row <span className="font-mono">{removed.id}</span>, removed by the fix
          </th>
        </tr>
      </thead>
      <tbody>
        {columns.map((name) => {
          // Only the part of the two values that differs is marked.
          const diff = diffValues(kept.cells[name] ?? "", removed.cells[name] ?? "");
          const differs = kept.cells[name] !== removed.cells[name];
          return (
            <tr key={name} className="border-b border-hairline align-top">
              <th scope="row" className="py-1.5 pr-3 font-normal">
                <span className={differs ? "font-semibold" : "text-muted"}>{name}</span>
                {differs && <span className="ml-2 text-[12px] font-semibold text-accent">differs</span>}
              </th>
              <td className="py-1.5 pr-3">
                <CellValue segments={diff.from} />
              </td>
              <td className="py-1.5">
                <CellValue segments={diff.to} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Two rows that are the same in every column have nothing to compare: the table is one
  // click away. Any difference puts it on screen.
  if (differing.length === 0) {
    return (
      <details>
        <summary className="cursor-pointer text-[13px] text-muted">
          The two rows are the same in all {columns.length} columns. Show both rows
        </summary>
        <div className="mt-2">{table}</div>
      </details>
    );
  }
  return (
    <div>
      <p className="pb-2 text-[13px] text-muted">
        The two rows differ in {differing.length} of {columns.length} columns.
      </p>
      {table}
    </div>
  );
}
