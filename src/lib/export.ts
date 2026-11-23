// The two files of SPEC §7.4, built from the decisions as they are at the moment of the call.

import { applyDecisions } from '../core/apply';
import { serializeCsv } from '../core/csv';
import type { ChangeLog, Decisions } from '../core/types';
import type { AnalysisSnapshot } from './analysis';
import type { LoadedFile } from './load';

export interface ExportFile {
  name: string;
  text: string;
  mime: string;
}

/** `<name>` of SPEC §7.4: the file name without a final `.csv`. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '');
}

/** `generatedAt` is the time of the export, ISO 8601; the caller owns the clock. */
export function buildExport(
  file: LoadedFile,
  snapshot: AnalysisSnapshot,
  decisions: Decisions,
  generatedAt: string,
): { cleanedCsv: ExportFile; changeLog: ExportFile; summary: ChangeLog['summary'] } {
  const { cleaned, changeLog } = applyDecisions(file.dataset, snapshot.analysis, decisions, {
    generatedAt,
    sha256: file.sha256,
    ai: snapshot.ai,
  });
  const name = baseName(file.dataset.fileName);
  return {
    cleanedCsv: { name: `${name}.cleaned.csv`, text: serializeCsv(cleaned), mime: 'text/csv;charset=utf-8' },
    changeLog: {
      name: `${name}.changes.json`,
      text: `${JSON.stringify(changeLog, null, 2)}\n`,
      mime: 'application/json',
    },
    summary: changeLog.summary,
  };
}
