// SPEC §7.3 and §7.4: the review of one file. Summary, filters, the groups of issues, and the
// bar with the downloads. The issues come from the analysis as they are and are never copied
// or changed; the decisions are the `Decisions` map the page holds.

import { useMemo, useState } from "react";
import { groupIssues } from "../core/analyze";
import type { Analysis, Decision, Decisions, IssueGroup } from "../core/types";
import type { AnalysisSnapshot } from "../lib/analysis";
import {
  ISSUE_TYPES,
  NO_FILTERS,
  countByType,
  countStatuses,
  decide,
  decideMany,
  matchesFilters,
  pendingHighConfidenceFixes,
  removedRows,
  sameDecisions,
} from "../lib/decisions";
import { plural } from "../lib/describe";
import { saveFile } from "../lib/download";
import { buildExport } from "../lib/export";
import type { LoadedFile } from "../lib/load";
import { FileHeader } from "./FileHeader";
import { Filters } from "./Filters";
import { Group } from "./Group";
import { ReviewBar } from "./ReviewBar";
import { Summary } from "./Summary";

interface ReviewProps {
  file: LoadedFile;
  snapshot: AnalysisSnapshot;
  decisions: Decisions;
  onDecisions: (decisions: Decisions) => void;
  onStartOver: () => void;
}

/** What a downloaded file was built from. */
interface Stamp {
  analysis: Analysis;
  decisions: Decisions;
}

interface Downloads {
  csv?: Stamp;
  log?: Stamp;
  last?: { name: string; summary: ReturnType<typeof buildExport>["summary"] };
}

/** The last bulk action, and the decisions it replaced. */
interface LastBulk {
  before: Decisions;
  count: number;
  decision: Decision;
}

/** Groups by issue type, in the order of the brief; inside a type, in the core's order. */
function byType(groups: IssueGroup[]): IssueGroup[] {
  return ISSUE_TYPES.flatMap((type) => groups.filter((group) => group.type === type));
}

export function Review({ file, snapshot, decisions, onDecisions, onStartOver }: ReviewProps) {
  const { analysis } = snapshot;
  const { dataset } = file;
  const [filters, setFilters] = useState(NO_FILTERS);
  const [downloads, setDownloads] = useState<Downloads>({});

  const groups = useMemo(() => byType(groupIssues(analysis.issues)), [analysis]);
  const rowsById = useMemo(() => new Map(dataset.rows.map((row) => [row.id, row])), [dataset]);

  const totals = countStatuses(analysis.issues, decisions);
  const visible = groups
    .map((group) => ({ group, shown: group.issues.filter((issue) => matchesFilters(issue, filters, decisions)) }))
    .filter((entry) => entry.shown.length > 0);
  const shownIssues = visible.reduce((sum, entry) => sum + entry.shown.length, 0);
  // SPEC S2. Like every bulk action it reaches only what is pending and on screen.
  const sureFixes = pendingHighConfidenceFixes(visible.flatMap((entry) => entry.shown), decisions);
  const removed = removedRows(analysis.issues, decisions);

  // One step of undo, for bulk actions only: the decisions as they were before the last one.
  // Any other decision ends it. There is no history beyond this step.
  const [lastBulk, setLastBulk] = useState<LastBulk | null>(null);

  const onDecide = (issueId: string, decision: Decision | null) => {
    setLastBulk(null);
    onDecisions(decide(decisions, issueId, decision));
  };
  const onDecideMany = (issueIds: string[], decision: Decision) => {
    setLastBulk({ before: decisions, count: issueIds.length, decision });
    onDecisions(decideMany(decisions, issueIds, decision));
  };
  const undoLastBulk = () => {
    if (lastBulk === null) return;
    onDecisions(lastBulk.before);
    setLastBulk(null);
  };

  // Each download is built from the decisions as they are at the click.
  function download(kind: "csv" | "log") {
    const built = buildExport(file, snapshot, decisions, new Date().toISOString());
    const out = kind === "csv" ? built.cleanedCsv : built.changeLog;
    saveFile(out.name, out.text, out.mime);
    setDownloads({
      ...downloads,
      [kind]: { analysis, decisions },
      last: { name: out.name, summary: built.summary },
    });
  }

  // The two files only belong together when both come from the decisions on screen.
  const stale = [downloads.csv, downloads.log].some(
    (stamp) =>
      stamp !== undefined &&
      (stamp.analysis !== analysis || !sameDecisions(stamp.decisions, decisions, analysis.issues)),
  );

  return (
    <>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-6 pb-16">
        <FileHeader
          fileName={dataset.fileName}
          rows={dataset.rows.length}
          columns={dataset.columns.length}
          issues={analysis.issues.length}
          warnings={file.warnings}
          decided={totals.accepted + totals.rejected}
          onStartOver={onStartOver}
        />

        <div className="mt-6">
          <Summary byType={countByType(analysis.issues, decisions)} />
        </div>

        <section aria-labelledby="issues-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-4">
            <div>
              <h2 id="issues-title" className="text-[20px] font-semibold tracking-tight">
                Issues
              </h2>
              <p className="text-[13px] text-muted">
                {shownIssues === analysis.issues.length
                  ? `${plural(analysis.issues.length, "issue")} in ${plural(groups.length, "group")}`
                  : `${shownIssues} of ${plural(analysis.issues.length, "issue")} match the filters`}
              </p>
            </div>
            <Filters filters={filters} onChange={setFilters} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-3">
            <p className="max-w-[70ch] text-[13px] text-muted">
              {sureFixes.length === 0
                ? "No pending fix with high confidence is on screen."
                : "Accepts every pending fix with high confidence that is on screen. Flags, and fixes with medium or low confidence, stay for you to decide."}
            </p>
            <button
              type="button"
              className="btn"
              disabled={sureFixes.length === 0}
              onClick={() => onDecideMany(sureFixes.map((issue) => issue.id), "accepted")}
            >
              Accept all high-confidence fixes <span className="font-mono">({sureFixes.length})</span>
            </button>
          </div>

          {visible.map(({ group, shown }) => (
            <Group
              key={group.id}
              group={group}
              shown={shown}
              decisions={decisions}
              columns={dataset.columns}
              rowsById={rowsById}
              removedRows={removed}
              onDecide={onDecide}
              onDecideMany={onDecideMany}
            />
          ))}

          {visible.length === 0 && (
            <p className="border-t border-line py-8 text-muted">
              {analysis.issues.length === 0
                ? "No issues were found in this file."
                : "No issue matches these filters."}
            </p>
          )}
        </section>
      </main>

      <ReviewBar
        counts={totals}
        lastBulk={lastBulk ?? undefined}
        onUndo={undoLastBulk}
        last={downloads.last}
        stale={stale}
        onDownloadCsv={() => download("csv")}
        onDownloadLog={() => download("log")}
      />
    </>
  );
}
