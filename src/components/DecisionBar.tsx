// Accepted, rejected and pending as one bar, in the fills of the sheet: green is what the
// cleaned file will hold, no fill stays as it is, yellow waits. A drawing only: wherever the
// bar is shown, the three counts are next to it in words.

import type { Counts } from "../lib/decisions";

export function DecisionBar({ counts, className = "" }: { counts: Counts; className?: string }) {
  const segment = (count: number, fill: string) =>
    count > 0 && <span className={`border-l border-edge first:border-l-0 ${fill}`} style={{ flex: `${count} 1 0%` }} />;

  return (
    <span aria-hidden="true" className={`inline-flex h-3 border border-edge bg-sheet ${className}`}>
      {segment(counts.accepted, "bg-accepted")}
      {segment(counts.rejected, "bg-sheet")}
      {segment(counts.pending, "bg-pending")}
    </span>
  );
}
