// Where the analysis of a file comes from. This module is the one place that changes when
// the AI layer is connected: the page only consumes the snapshots it yields.

import { analyze } from '../core/analyze';
import type { Analysis, ChangeLogMeta } from '../core/types';
import type { LoadedFile } from './load';

/** The analysis as it stands now, and the AI mode that produced it. */
export interface AnalysisSnapshot {
  analysis: Analysis;
  ai: ChangeLogMeta['ai'];
}

/** What the page shows about the AI before the first snapshot exists. */
export const AI_OFF: AnalysisSnapshot['ai'] = { mode: 'off', model: null };

/**
 * Yields the analysis of a file, and yields it again each time it gains results. Every
 * snapshot replaces the one before; the page keeps the user's decisions across them, which
 * works because issue ids are stable (SPEC §4.4, invariant 6).
 *
 * Today there is one snapshot: the rule detectors, with the AI off.
 */
export async function* runAnalysis(file: LoadedFile): AsyncGenerator<AnalysisSnapshot> {
  yield { analysis: analyze(file.dataset), ai: AI_OFF };
}
