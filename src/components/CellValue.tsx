// A cell value as it is in the file, in the mono face. The pieces a fix changes are marked
// with a line, through or under; changed whitespace is drawn as boxed dots, so that a space
// that goes away can be seen.

import { showWhitespace, type Segment } from "../lib/diff";

interface CellValueProps {
  /** The value in pieces; a piece that the other side of the fix does not have is marked. */
  segments: Segment[];
  /** Which side of the fix this is: `old` text is struck through, `new` text is underlined. */
  side?: "old" | "new";
}

export function CellValue({ segments, side = "new" }: CellValueProps) {
  if (segments.every((segment) => segment.text === "")) {
    // Its own box: the strike of a cell that goes away does not cross a label.
    return <span className="inline-block text-note text-muted">(empty)</span>;
  }
  const textClass = side === "old" ? "changed-old" : "changed-new";
  return (
    <span className="value">
      {segments.map((segment, index) =>
        segment.changed ? (
          // Whitespace and text take turns: /(\s+)/ keeps the whitespace runs in the list.
          segment.text.split(/(\s+)/).map((run, position, runs) =>
            run === "" ? null : isHiddenWhitespace(run, position, runs) ? (
              <span key={`${index}-${position}`} className="changed-space">
                {showWhitespace(run)}
              </span>
            ) : (
              <span key={`${index}-${position}`} className={textClass}>
                {run}
              </span>
            ),
          )
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Whitespace the eye would miss: at the start or the end of a changed piece, more than one
 * space in a row, a tab or a line break. One space between two changed words is plain text.
 */
function isHiddenWhitespace(run: string, position: number, runs: string[]): boolean {
  if (!/^\s+$/.test(run)) return false;
  const atStart = runs.slice(0, position).every((each) => each === "");
  const atEnd = runs.slice(position + 1).every((each) => each === "");
  return atStart || atEnd || run !== " ";
}
