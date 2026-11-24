"use client";

// The page of SPEC §7: upload, analysing, review with its export bar. This component owns
// the file, the analysis and the user's decisions; everything else is derived from them.

import { useRef, useState } from "react";
import type { Analysis, Decisions } from "../core/types";
import { runAnalysis, type AnalysisSnapshot } from "../lib/analysis";
import { carryDecided } from "../lib/carry";
import { plural } from "../lib/describe";
import { loadFile, type LoadedFile, type LoadResult } from "../lib/load";
import { loadSample } from "../lib/sample";
import { ModeLine } from "./ModeLine";
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
  // The same decisions, for the loop of `start`: it outlives the render that began it.
  const decided = useRef<Decisions>({});
  const decide = (next: Decisions) => {
    decided.current = next;
    setDecisions(next);
  };
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
    decide({});
    setPhase({ name: "analysing", file });
    // The browser paints "analysing" before the detectors take the main thread.
    await new Promise((resolve) => setTimeout(resolve, 0));

    let shown: Analysis | undefined;
    try {
      // Each snapshot replaces the analysis on screen, except for the issues the user has
      // decided: those stay, with their decisions (SPEC §7.3).
      for await (const snapshot of runAnalysis(file)) {
        if (run.current !== token) return;
        const analysis = shown ? carryDecided(shown, snapshot.analysis, decided.current) : snapshot.analysis;
        shown = analysis;
        setPhase({ name: "review", file, snapshot: analysis === snapshot.analysis ? snapshot : { ...snapshot, analysis } });
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
    decide({});
    setPhase({ name: "upload", reading: false });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-grid bg-sheet">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3">
          <h1 className="text-title font-bold">Data cleanup assistant</h1>
          <ModeLine run={phase.name === "review" ? phase.snapshot.run : undefined} />
        </div>
      </header>

      {phase.name === "upload" && (
        <main className="mx-auto w-full max-w-page flex-1 px-6">
          <Upload
            reading={phase.reading}
            error={phase.error}
            onFile={(file) => start(() => loadFile(file))}
            onSample={() => start(loadSample)}
          />
        </main>
      )}

      {phase.name === "analysing" && (
        <main className="mx-auto w-full max-w-page flex-1 px-6 py-16">
          <p className="file text-note text-muted">{phase.file.dataset.fileName}</p>
          <p role="status" className="mt-2 text-display font-semibold">
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
          onDecisions={decide}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}
