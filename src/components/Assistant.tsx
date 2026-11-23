"use client";

// The page of SPEC §7: upload, analysing, review with its export bar. This component owns
// the file, the analysis and the user's decisions; everything else is derived from them.

import { useRef, useState } from "react";
import type { Decisions } from "../core/types";
import { runAnalysis, type AnalysisSnapshot } from "../lib/analysis";
import { modeLine, plural } from "../lib/describe";
import { loadFile, type LoadedFile, type LoadResult } from "../lib/load";
import { loadSample } from "../lib/sample";
import { Review } from "./Review";
import { Upload } from "./Upload";

type Phase =
  | { name: "upload"; reading: boolean; error?: string }
  | { name: "analysing"; file: LoadedFile }
  | { name: "review"; file: LoadedFile; snapshot: AnalysisSnapshot };

export function Assistant() {
  const [phase, setPhase] = useState<Phase>({ name: "upload", reading: false });
  // SPEC §4.3: by issue id; an absent id means pending.
  const [decisions, setDecisions] = useState<Decisions>({});
  // Each load gets a number; a result that belongs to an older load is dropped.
  const run = useRef(0);

  async function start(load: () => Promise<LoadResult>) {
    run.current += 1;
    const token = run.current;
    setPhase({ name: "upload", reading: true });

    const result = await load();
    if (run.current !== token) return;
    if (!result.ok) {
      setPhase({ name: "upload", reading: false, error: result.error });
      return;
    }

    const { file } = result;
    setDecisions({});
    setPhase({ name: "analysing", file });
    // The browser paints "analysing" before the detectors take the main thread.
    await new Promise((resolve) => setTimeout(resolve, 0));

    let shown = false;
    try {
      // Each snapshot replaces the analysis on screen. The decisions are kept.
      for await (const snapshot of runAnalysis(file)) {
        if (run.current !== token) return;
        setPhase({ name: "review", file, snapshot });
        shown = true;
      }
    } catch {
      // With a result on screen, a later failure leaves that result where it is.
      if (run.current === token && !shown) {
        setPhase({
          name: "upload",
          reading: false,
          error: "The file was read, but it could not be analysed. Try to upload it again.",
        });
      }
    }
  }

  function startOver() {
    run.current += 1;
    setDecisions({});
    setPhase({ name: "upload", reading: false });
  }

  // SPEC §6.6: the mode belongs to a file, so there is none before a file is analysed.
  const mode = phase.name === "review" ? modeLine(phase.snapshot.run) : "AI mode: chosen when a file is loaded";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1120px] items-baseline justify-between gap-4 px-6 py-3.5">
          <h1 className="text-[15px] font-semibold tracking-tight">Data cleanup assistant</h1>
          <p className="font-mono text-[12px] text-muted">{mode}</p>
        </div>
      </header>

      {phase.name === "upload" && (
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-6">
          <Upload
            reading={phase.reading}
            error={phase.error}
            onFile={(file) => start(() => loadFile(file))}
            onSample={() => start(loadSample)}
          />
        </main>
      )}

      {phase.name === "analysing" && (
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-6 py-16">
          <p className="font-mono text-[13px] text-muted">{phase.file.dataset.fileName}</p>
          <p role="status" className="mt-2 text-xl font-semibold tracking-tight">
            Parsed {plural(phase.file.dataset.rows.length, "row")} and{" "}
            {plural(phase.file.dataset.columns.length, "column")}. Looking for issues…
          </p>
        </main>
      )}

      {phase.name === "review" && (
        <Review
          file={phase.file}
          snapshot={phase.snapshot}
          decisions={decisions}
          onDecisions={setDecisions}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}
