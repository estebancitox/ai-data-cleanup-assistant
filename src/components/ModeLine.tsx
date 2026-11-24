// SPEC §6.6 and §7.2: which AI produced what is on screen, visible at all times. Three facts,
// each in its own piece: the mode as a tag, the model, and for a recording its date.
//
// The words and the date format are those of `modeLine` in src/lib/describe.ts, which joins
// the same three facts into one string. This component does not call it: the two must agree,
// and the tests of the page pin the full text of this line.

import type { AiRun } from "../lib/analysis";
import { AI_MODE_LABEL } from "../lib/describe";

export function ModeLine({ run }: { run?: Pick<AiRun, "mode" | "model" | "recordedAt"> }) {
  // SPEC §6.6: the mode belongs to a file, so there is none before a file is analysed.
  if (run === undefined) return <p className="text-note text-muted">AI mode: chosen when a file is loaded</p>;

  const answered = run.mode === "live" || run.mode === "recorded";
  const label = run.mode === "checking" ? "Checking for AI" : AI_MODE_LABEL[run.mode];
  const model = answered ? (run.model ?? "model not reported") : undefined;
  let when: string | undefined;
  if (run.mode === "recorded") {
    const date = new Date(run.recordedAt ?? "");
    when = Number.isNaN(date.getTime()) ? "date not recorded" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  return (
    <p className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-note">
      {/* The model's colour only when a model answered. */}
      <span className={answered ? "tag tag-model" : "tag"}>{label}</span>
      {model !== undefined && (
        <>
          {" "}
          <span className="font-semibold text-model">{model}</span>
        </>
      )}
      {when !== undefined && (
        <>
          {" "}
          <span className="text-muted">recorded {when}</span>
        </>
      )}
    </p>
  );
}
