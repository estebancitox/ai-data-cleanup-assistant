// What was loaded: the file, its size in rows and columns, what the analysis found, the
// warnings of the parser, and the way back to the upload.

import { useState } from "react";
import { plural } from "../lib/describe";

/** A file can produce one warning per row; the page lists this many. */
const WARNINGS_SHOWN = 20;

interface FileHeaderProps {
  fileName: string;
  rows: number;
  columns: number;
  issues: number;
  warnings: string[];
  /** Decisions made so far; starting over discards them. */
  decided: number;
  onStartOver: () => void;
}

export function FileHeader({ fileName, rows, columns, issues, warnings, decided, onStartOver }: FileHeaderProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="File" className="pt-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="file text-display font-medium [overflow-wrap:anywhere]">{fileName}</h2>
          {/* Three figures, each with its label: a count and a word, side by side. */}
          <p className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-muted">
            <span>
              <b className="text-ink">{rows.toLocaleString("en-US")}</b> {rows === 1 ? "row" : "rows"}
            </span>
            <span>
              <b className="text-ink">{columns}</b> {columns === 1 ? "column" : "columns"}
            </span>
            <span>
              <b className="text-ink">{issues.toLocaleString("en-US")}</b> {issues === 1 ? "issue" : "issues"} found
            </span>
          </p>
        </div>

        {confirming ? (
          <div role="group" aria-label="Start over" className="flex flex-wrap items-center gap-2">
            <p className="text-note">This discards {plural(decided, "decision")}.</p>
            <button type="button" className="btn" onClick={onStartOver}>
              Discard and start over
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep reviewing
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => (decided > 0 ? setConfirming(true) : onStartOver())}>
            Start over
          </button>
        )}
      </div>

      {warnings.length > 0 && (
        <details className="mt-4 border-l-[3px] border-edge pl-4">
          <summary className="cursor-pointer font-semibold">
            {plural(warnings.length, "warning")} while reading the file
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-note">
            {warnings.slice(0, WARNINGS_SHOWN).map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {warnings.length > WARNINGS_SHOWN && (
            <p className="mt-2 text-note text-muted">And {warnings.length - WARNINGS_SHOWN} more of the same kind.</p>
          )}
        </details>
      )}
    </section>
  );
}
