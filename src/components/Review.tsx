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

  const onDecide = (issueId: string, decision: Decision | null) => onDecisions(decide(decisions, issueId, decision));
  const onDecideMany = (issueIds: string[], decision: Decision) =>
    onDecisions(decideMany(decisions, issueIds, decision));

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

          {visible.map(({ group, shown }) => (
            <Group
              key={group.id}
              group={group}
              shown={shown}
              decisions={decisions}
              columns={dataset.columns}
              rowsById={rowsById}
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
        last={downloads.last}
        stale={stale}
        onDownloadCsv={() => download("csv")}
        onDownloadLog={() => download("log")}
      />
    </>
  );
}
