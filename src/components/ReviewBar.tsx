// SPEC §7.3 and §7.4: the bar that stays on screen, with the counts and the two downloads.

import type { ChangeLog } from "../core/types";
import type { Counts } from "../lib/decisions";
import { plural } from "../lib/describe";

interface ReviewBarProps {
  counts: Counts;
  /** The last file downloaded, and what the export behind it did. */
  last?: { name: string; summary: ChangeLog["summary"] };
  /** A file downloaded earlier was built from decisions that have changed since. */
  stale: boolean;
  onDownloadCsv: () => void;
  onDownloadLog: () => void;
}

export function ReviewBar({ counts, last, stale, onDownloadCsv, onDownloadLog }: ReviewBarProps) {
  return (
    <div className="sticky bottom-0 border-t border-line bg-paper">
      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <div className="min-w-0 flex-1 basis-[360px]">
          {/* A live region: a screen reader hears the counts after each decision. */}
          <p role="status" className="text-[13px]">
            <span className="font-mono font-medium">{counts.accepted}</span> accepted,{" "}
            <span className="font-mono font-medium">{counts.rejected}</span> rejected,{" "}
            <span className="font-mono font-medium">{counts.pending}</span> pending
          </p>
          {stale ? (
            <p role="alert" className="text-[13px] font-medium text-accent">
              Decisions changed after a download. The files downloaded so far no longer match each other. Download
              both again.
            </p>
          ) : last ? (
            <p className="text-[13px] text-muted">
              Downloaded <span className="font-mono">{last.name}</span>: {plural(last.summary.cellsChanged, "cell")}{" "}
              changed, {plural(last.summary.rowsRemoved, "row")} removed, {plural(last.summary.pending, "issue")} left
              pending.
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              Only accepted fixes are applied. Pending and rejected issues leave the file as it is.
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
