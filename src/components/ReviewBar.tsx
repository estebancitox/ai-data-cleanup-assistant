// SPEC §7.3 and §7.4: the bar that stays on screen, with the counts, what the download will
// do with them, and the two downloads.

import type { ChangeLog, Decision } from "../core/types";
import type { Counts } from "../lib/decisions";
import { bulkWord, plural } from "../lib/describe";
import { DecisionBar } from "./DecisionBar";

interface ReviewBarProps {
  counts: Counts;
  /** Rows that the duplicate fixes accepted so far remove. */
  removedRows: number;
  /** Accepted fixes that the AI judged "probably not a problem", and the titles of their groups. */
  doubted?: { count: number; groups: string[] };
  /** The last bulk action, while it can still be undone. */
  lastBulk?: { count: number; decision: Decision; onFlags: boolean };
  onUndo: () => void;
  /** The last file downloaded, and what the export behind it did. */
  last?: { name: string; summary: ChangeLog["summary"]; setAside: number };
  /** A file downloaded earlier was built from decisions that have changed since. */
  stale: boolean;
  onDownloadCsv: () => void;
  onDownloadLog: () => void;
}

export function ReviewBar({
  counts,
  removedRows,
  doubted,
  lastBulk,
  onUndo,
  last,
  stale,
  onDownloadCsv,
  onDownloadLog,
}: ReviewBarProps) {
  return (
    <div className="bar sticky bottom-0 z-10">
      <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <div className="min-w-0 flex-1 basis-[360px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DecisionBar counts={counts} className="w-44" />
            {/* A live region: a screen reader hears the counts after each decision. */}
            <p role="status" className="text-note">
              <b>{counts.accepted}</b> accepted, <b>{counts.rejected}</b> rejected, <b>{counts.pending}</b> pending
            </p>
          </div>
          {/* The element is always in the page, so that a screen reader hears the notice when it
              appears. The notice changes no decision. It is about what the model said. */}
          <p aria-live="polite" className={doubted ? "note-model my-1 text-note font-semibold" : undefined}>
            {doubted &&
              `The AI doubts ${plural(doubted.count, "fix", "fixes")} you accepted: its opinion is "probably not a problem". Nothing was changed, and ${
                doubted.count === 1 ? "the fix stays" : "the fixes stay"
              } accepted until you decide otherwise. Where: ${doubted.groups.join("; ")}.`}
          </p>
          {/* One step back, for the last bulk action only; it is in the bar so that it is in reach
              wherever the page is scrolled. */}
          {lastBulk && (
            <p className="my-1 flex flex-wrap items-center gap-2 text-note">
              <span>
                Last bulk action: <span>{lastBulk.count}</span> {lastBulk.count === 1 ? "issue" : "issues"}{" "}
                {bulkWord(lastBulk.decision, lastBulk.onFlags)}.
              </span>
              <button type="button" className="btn" onClick={onUndo}>
                Undo
              </button>
            </p>
          )}
          {stale ? (
            <p role="alert" className="text-note font-semibold text-removal">
              Decisions changed after a download. The files downloaded so far no longer match each other. Download
              both again.
            </p>
          ) : last ? (
            <p className="text-note text-muted">
              Downloaded <span className="file">{last.name}</span>: {plural(last.summary.cellsChanged, "cell")}{" "}
              changed, {plural(last.summary.rowsRemoved, "row")} removed,{" "}
              {plural(last.summary.pending - last.setAside, "issue")} left pending
              {last.setAside > 0 && `, ${plural(last.setAside, "issue")} dismissed by AI`}.
            </p>
          ) : (
            // Only what the four numbers mean. The accepted count includes confirmed flags, which
            // change no cell, and an accepted fix on a removed row is not applied (SPEC §5.6): so
            // no number of cells is claimed, and not that every accepted fix is applied.
            <p className="text-note text-muted">
              Only accepted fixes are applied, and {plural(removedRows, "row")} {removedRows === 1 ? "is" : "are"}{" "}
              removed. {counts.pending.toLocaleString("en-US")} pending and{" "}
              {counts.rejected.toLocaleString("en-US")} rejected leave the file as it is.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={onDownloadCsv}>
            Download cleaned CSV
          </button>
          <button type="button" className="btn" onClick={onDownloadLog}>
            Download change log
          </button>
        </div>
      </div>
    </div>
  );
}
