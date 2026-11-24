// The rows of an issue with every column, as the file has them. Rendered only when the user
// asks for it. A sheet wider than the page scrolls sideways, with the mouse or the keyboard.

import type { Row } from "../core/types";
import { unchanged } from "../lib/diff";
import { CellValue } from "./CellValue";

interface WholeRowsProps {
  id: string;
  columns: string[];
  rows: Row[];
  /** The columns the issue is about: their cells carry a heavy edge. */
  marked: ReadonlySet<string>;
}

export function WholeRows({ id, columns, rows, marked }: WholeRowsProps) {
  const ids = rows.map((row) => row.id).join(" and ");
  return (
    <div
      id={id}
      role="region"
      aria-label={`${rows.length === 1 ? "Row" : "Rows"} ${ids}, every column`}
      tabIndex={0}
      className="mt-2 overflow-x-auto"
    >
      <table className="sheet sheet-wide">
        <thead>
          <tr>
            <td className="gutter" />
            {columns.map((name) => (
              <th key={name} scope="col" className="file">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="gutter">
                <span className="sr-only">Row </span>
                {row.id}
              </th>
              {columns.map((name) => (
                <td key={name} className={marked.has(name) ? "cell-marked" : undefined}>
                  <CellValue segments={unchanged(row.cells[name] ?? "")} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
