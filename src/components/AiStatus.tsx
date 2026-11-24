// SPEC §7.2: the trail of the analysis, step by step and with counts: what comes from the rules,
// what the model proposed, what code verified of it, and what the second opinion said. Under
// it, what the user can do about the AI side: read why it is off or failed, ask again, or run
// it live. A step of the model is in the model's colour; a step of code is in ink.

import type { AiRun } from "../lib/analysis";
import { plural } from "../lib/describe";

interface AiStatusProps {
  run: AiRun;
  rows: number;
  /** Issues on screen that the rule detectors produced. */
  ruleIssues: number;
}

interface Step {
  /** Who did the step: code (the rules, the verification) or the model. */
  by: "code" | "model";
  label: string;
  text: string;
}

function stepsOf({ run, rows, ruleIssues }: AiStatusProps): Step[] {
  const steps: Step[] = [
    { by: "code", label: "From the rules", text: `${plural(ruleIssues, "issue")} in ${plural(rows, "parsed row")}` },
  ];
  if (run.mode === "checking") {
    steps.push({ by: "code", label: "AI analysis", text: "Checking for an AI analysis of this file…" });
  }
  if (run.busy === "contract") {
    steps.push({ by: "model", label: "The model", text: "Analysing with AI: asking for the rules of this file…" });
  }
  if (run.contract) {
    const { proposed, verified, rejected } = run.contract;
    steps.push({ by: "model", label: "The model proposed", text: plural(proposed, "rule") });
    steps.push({ by: "code", label: "Code verified", text: `${verified} verified, ${rejected} rejected` });
  }
  if (run.adjudication) {
    const { cases, confirmed, dismissed, unsure } = run.adjudication;
    const answered = confirmed + dismissed + unsure;
    steps.push({
      by: "model",
      label: "The model's second opinion",
      text: `${answered} of ${plural(cases, "ambiguous case")}: ${confirmed} confirmed, ${dismissed} dismissed, ${unsure} unsure`,
    });
  }
  if (run.busy === "adjudication") {
    steps.push({ by: "model", label: "The model", text: "Analysing with AI: asking about the ambiguous cases…" });
  }
  return steps;
}

export function AiStatus(props: AiStatusProps) {
  const { run } = props;
  return (
    <section aria-label="Analysis progress" className="mt-5">
      {/* A polite live region, and not a second role="status": the bar's counts keep that role. */}
      <ol aria-live="polite" className="flex flex-wrap border-l border-t border-grid">
        {stepsOf(props).map((step, index) => (
          <li key={`${step.label} ${step.text}`} className="min-w-44 flex-1 border-b border-r border-grid bg-sheet px-3 py-2">
            <p className={`text-xs font-semibold ${step.by === "model" ? "text-model" : "text-muted"}`}>
              {index + 1}. {step.label}
            </p>
            <p className="text-note">{step.text}</p>
          </li>
        ))}
      </ol>
      {run.notice !== undefined && (
        // A failed step interrupts; the explanation of "off" does not.
        <p
          role={run.retry ? "alert" : "note"}
          className={`mt-2 max-w-[85ch] border-l-[3px] pl-2.5 text-note ${run.retry ? "border-removal" : "border-edge"}`}
        >
          {run.notice}
        </p>
      )}
      {(run.retry || run.runLive) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-note">
          {run.retry && (
            <button type="button" className="btn" onClick={run.retry}>
              Retry
            </button>
          )}
          {run.runLive && (
            <>
              <button type="button" className="btn btn-model" onClick={run.runLive}>
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
