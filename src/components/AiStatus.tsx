// SPEC §7.2: where the analysis stands, stage by stage and with counts, and what the user can
// do about the AI side of it: read why it is off or failed, ask again, or run it live.

import type { AiRun } from "../lib/analysis";
import { plural } from "../lib/describe";

interface AiStatusProps {
  run: AiRun;
  rows: number;
  /** Issues on screen that the rule detectors produced. */
  ruleIssues: number;
}

function stagesOf({ run, rows, ruleIssues }: AiStatusProps): string[] {
  const stages = [`Parsed ${plural(rows, "row")}`, `Rules: ${plural(ruleIssues, "issue")}`];
  if (run.mode === "checking") stages.push("Checking for an AI analysis of this file…");
  if (run.busy === "contract") stages.push("Analysing with AI: asking for the rules of this file…");
  if (run.contract) {
    const { proposed, verified, rejected } = run.contract;
    stages.push(`Contract: ${plural(proposed, "rule")} proposed, ${verified} verified, ${rejected} rejected`);
  }
  if (run.adjudication) {
    const { cases, confirmed, dismissed, unsure } = run.adjudication;
    const answered = confirmed + dismissed + unsure;
    stages.push(
      `AI opinions: ${answered} of ${plural(cases, "ambiguous case")} (${confirmed} confirmed, ${dismissed} dismissed, ${unsure} unsure)`,
    );
  }
  if (run.busy === "adjudication") stages.push("Analysing with AI: asking about the ambiguous cases…");
  return stages;
}

export function AiStatus(props: AiStatusProps) {
  const { run } = props;
  return (
    <section aria-label="Analysis progress" className="mt-5 border-l-2 border-line pl-4 text-[13px]">
      {/* A polite live region, and not a second role="status": the bar's counts keep that role. */}
      <ul aria-live="polite" className="flex flex-wrap gap-x-5 gap-y-1 text-muted">
        {stagesOf(props).map((stage) => (
          <li key={stage}>{stage}</li>
        ))}
      </ul>
      {run.notice !== undefined && (
        // A failed step interrupts; the explanation of "off" does not.
        <p role={run.retry ? "alert" : "note"} className="mt-2 max-w-[85ch]">
          {run.notice}
        </p>
      )}
      {(run.retry || run.runLive) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {run.retry && (
            <button type="button" className="btn" onClick={run.retry}>
              Retry
            </button>
          )}
          {run.runLive && (
            <>
              <button type="button" className="btn" onClick={run.runLive}>
                Run live
              </button>
              <span className="text-muted">Asks the model again and replaces the recorded analysis.</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
