// SPEC §7.1: file picker, drag and drop, the bundled sample, the limits next to the control,
// and the reason a file was refused, in plain language.

import { useState, type DragEvent } from "react";
import { UPLOAD_LIMITS } from "../core/csv";

interface UploadProps {
  /** A file is being read. */
  reading: boolean;
  /** Why the last file was refused. */
  error?: string;
  onFile: (file: File) => void;
  onSample: () => void;
}

export function Upload({ reading, error, onFile, onSample }: UploadProps) {
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !reading) onFile(file);
  }

  return (
    <section aria-labelledby="upload-title" className="py-16">
      <h2 id="upload-title" className="text-[28px] font-semibold leading-tight tracking-tight">
        Upload a CSV file
      </h2>
      <p className="mt-2 max-w-[60ch] text-muted">
        The assistant looks for duplicates, inconsistent values, missing data and suspicious records, and suggests an
        edit where the file itself supports one. Nothing changes until you accept it.
      </p>

      <div
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-8 border border-dashed px-8 py-12 ${dragging ? "border-accent bg-surface" : "border-line"}`}
      >
        <p className="text-[15px] font-medium">{dragging ? "Drop the file to load it" : "Drop a CSV file here"}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* The input stays in the tab order; its label is what the eye sees. */}
          <label
            htmlFor="csv-file"
            className="btn btn-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
          >
            Choose a CSV file
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={reading}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The same file can be chosen again after an error.
                event.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
          <span className="text-muted">or</span>
          <button type="button" className="btn" disabled={reading} onClick={onSample}>
            Use sample data
          </button>
          {reading && (
            <p role="status" className="text-muted">
              Reading the file…
            </p>
          )}
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Limits: <span className="font-mono text-ink">{UPLOAD_LIMITS.megabytes} MB</span>,{" "}
          <span className="font-mono text-ink">{UPLOAD_LIMITS.rows.toLocaleString("en-US")}</span> rows and{" "}
          <span className="font-mono text-ink">{UPLOAD_LIMITS.columns}</span> columns, saved as UTF-8. The file is
          read in your browser and the original is never modified.
        </p>
      </div>

      {error !== undefined && (
        <div role="alert" className="mt-6 border-l-2 border-accent pl-4">
          <p className="font-semibold">This file was not loaded</p>
          <p className="mt-1 max-w-[70ch]">{error}</p>
        </div>
      )}
    </section>
  );
}
