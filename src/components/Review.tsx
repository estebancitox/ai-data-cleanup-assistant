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
  doubtedAcceptedFixes,
  isSetAside,
  matchesFilters,
  pendingHighConfidenceFixes,
  removedRows,
  sameDecisions,
} from "../lib/decisions";
import { describeGroup, plural } from "../lib/describe";
import { saveFile } from "../lib/download";
import { buildExport } from "../lib/export";
import type { LoadedFile } from "../lib/load";
import { AiRules } from "./AiRules";
import { AiStatus } from "./AiStatus";
import { DismissedByAi } from "./DismissedByAi";
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
  last?: { name: string; summary: ReturnType<typeof buildExport>["summary"]; setAside: number };
}

/** The last bulk action, and the decisions it replaced. */
interface LastBulk {
  before: Decisions;
  count: number;
  decision: Decision;
  /** Every issue of the action was a flag, so it was confirmed or dismissed. */
  onFlags: boolean;
}

/** Groups by issue type, in the order of the brief; inside a type, in the core's order. */
function byType(groups: IssueGroup[]): IssueGroup[] {
  return ISSUE_TYPES.flatMap((type) => groups.filter((group) => group.type === type));
}

export function Review({ file, snapshot, decisions, onDecisions, onStartOver }: ReviewProps) {
  const { analysis, run } = snapshot;
  const { dataset } = file;
  const [filters, setFilters] = useState(NO_FILTERS);
  const [downloads, setDownloads] = useState<Downloads>({});
  // SPEC §6.4: the issues the user took back out of "Dismissed by AI".
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());

  // What the AI dismissed is set aside; everything below counts and groups the rest.
  const { setAside, issues } = useMemo(() => {
    const setAside = analysis.issues.filter((issue) => isSetAside(issue, decisions, restored));
    if (setAside.length === 0) return { setAside, issues: analysis.issues };
    const ids = new Set(setAside.map((issue) => issue.id));
    return { setAside, issues: analysis.issues.filter((issue) => !ids.has(issue.id)) };
  }, [analysis, decisions, restored]);

  const groups = useMemo(() => byType(groupIssues(issues)), [issues]);
  const rowsById = useMemo(() => new Map(dataset.rows.map((row) => [row.id, row])), [dataset]);

  const totals = countStatuses(issues, decisions);
  const visible = groups
    .map((group) => ({ group, shown: group.issues.filter((issue) => matchesFilters(issue, filters, decisions)) }))
    .filter((entry) => entry.shown.length > 0);
  const shownIssues = visible.reduce((sum, entry) => sum + entry.shown.length, 0);
  // SPEC S2. Like every bulk action it reaches only what is pending and on screen.
  const sureFixes = pendingHighConfidenceFixes(visible.flatMap((entry) => entry.shown), decisions);
  const removed = removedRows(issues, decisions);
  // SPEC §7.3: an opinion can arrive after the user accepted the fix; the bar says so.
  const doubted = doubtedAcceptedFixes(issues, decisions);
  const doubtedIds = new Set(doubted.map((issue) => issue.id));
  const doubtedGroups = groups
    .filter((group) => group.issues.some((issue) => doubtedIds.has(issue.id)))
    .map((group) => describeGroup(group).title);

  // One step of undo, for bulk actions only: the decisions as they were before the last one.
  // Any other decision ends it. There is no history beyond this step.
  const [lastBulk, setLastBulk] = useState<LastBulk | null>(null);

  const onDecide = (issueId: string, decision: Decision | null) => {
    setLastBulk(null);
    onDecisions(decide(decisions, issueId, decision));
  };
  const onDecideMany = (issueIds: string[], decision: Decision) => {
    const ids = new Set(issueIds);
    const onFlags = issues.filter((issue) => ids.has(issue.id)).every((issue) => issue.fix === undefined);
    setLastBulk({ before: decisions, count: issueIds.length, decision, onFlags });
    onDecisions(decideMany(decisions, issueIds, decision));
  };
  const undoLastBulk = () => {
    if (lastBulk === null) return;
    onDecisions(lastBulk.before);
    setLastBulk(null);
  };

  // Each download is built from the decisions as they are at the click, and from the whole
  // analysis: an issue set aside is in the change log as pending (SPEC §6.4).
  function download(kind: "csv" | "log") {
    const built = buildExport(file, snapshot, decisions, new Date().toISOString());
    const out = kind === "csv" ? built.cleanedCsv : built.changeLog;
    saveFile(out.name, out.text, out.mime);
    setDownloads({
      ...downloads,
      [kind]: { analysis, decisions },
      last: { name: out.name, summary: built.summary, setAside: setAside.length },
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
      <main className="mx-auto w-full max-w-page flex-1 px-6 pb-16">
        <FileHeader
          fileName={dataset.fileName}
          rows={dataset.rows.length}
          columns={dataset.columns.length}
          issues={issues.length}
          warnings={file.warnings}
          decided={totals.accepted + totals.rejected}
          onStartOver={onStartOver}
        />

        <AiStatus
          run={run}
          rows={dataset.rows.length}
          ruleIssues={analysis.issues.filter((issue) => issue.source === "rule").length}
        />

        <div className="mt-6">
          <Summary byType={countByType(issues, decisions)} />
        </div>

        {analysis.contract && <AiRules contract={analysis.contract} />}

        <section aria-labelledby="issues-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-4">
            <div>
              <h2 id="issues-title" className="text-display font-semibold">
                Issues
              </h2>
              <p className="text-note text-muted">
                {shownIssues === issues.length
                  ? `${plural(issues.length, "issue")} in ${plural(groups.length, "group")}`
                  : `${shownIssues} of ${plural(issues.length, "issue")} match the filters`}
              </p>
            </div>
            <Filters filters={filters} onChange={setFilters} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border border-grid bg-sheet px-4 py-3">
            <p className="max-w-[70ch] text-note text-muted">
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
              Accept all high-confidence fixes <span>({sureFixes.length})</span>
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
              dependencies={analysis.contract?.dependencies}
              onDecide={onDecide}
              onDecideMany={onDecideMany}
            />
          ))}

          {visible.length === 0 && (
            <p className="mt-3 border border-grid bg-sheet px-4 py-8 text-muted">
              {issues.length === 0 ? "No issues were found in this file." : "No issue matches these filters."}
            </p>
          )}

          {setAside.length > 0 && (
            <DismissedByAi
              issues={setAside}
              columns={dataset.columns}
              rowsById={rowsById}
              onRestore={(issueId) => setRestored(new Set([...restored, issueId]))}
            />
          )}
        </section>
      </main>

      <ReviewBar
        counts={totals}
        removedRows={removed.size}
        doubted={doubted.length > 0 ? { count: doubted.length, groups: doubtedGroups } : undefined}
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
