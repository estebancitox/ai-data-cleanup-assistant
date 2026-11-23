// Applies the user's decisions. SPEC §5.7 and §7.4.

import type { Analysis, ChangeLog, ChangeLogMeta, Dataset, Decisions } from '../types';

/**
 * Produces the cleaned dataset and the change log from the user's decisions. Only accepted
 * fixes are applied. The input dataset is not modified. The change log lists every issue with
 * its decision, including the ones that changed nothing. `meta` carries what only the caller
 * knows: the time, the hash of the uploaded file and the AI mode.
 */
export function applyDecisions(
  dataset: Dataset,
  analysis: Analysis,
  decisions: Decisions,
  meta: ChangeLogMeta,
): { cleaned: Dataset; changeLog: ChangeLog } {
  // Accepted cell edits first, then accepted row removals.
  const edits = new Map<number, Map<string, string>>();
  const removed = new Set<number>();
  for (const issue of analysis.issues) {
    if (decisions[issue.id] !== 'accepted' || !issue.fix) continue;
    if (issue.fix.kind === 'set-cell') {
      const rowEdits = edits.get(issue.fix.rowId) ?? new Map<string, string>();
      rowEdits.set(issue.fix.column, issue.fix.to);
      edits.set(issue.fix.rowId, rowEdits);
    } else {
      removed.add(issue.fix.rowId);
    }
  }

  let cellsChanged = 0;
  let rowsRemoved = 0;
  const rows: Dataset['rows'] = [];
  for (const row of dataset.rows) {
    if (removed.has(row.id)) {
      rowsRemoved += 1;
      continue;
    }
    const cells = { ...row.cells };
    for (const [column, to] of edits.get(row.id) ?? []) {
      if (cells[column] !== to) cellsChanged += 1;
      cells[column] = to;
    }
    rows.push({ id: row.id, cells });
  }

  const changes: ChangeLog['changes'] = analysis.issues.map((issue) => ({
    issueId: issue.id,
    type: issue.type,
    detector: issue.detector,
    source: issue.source,
    confidence: issue.confidence,
    rowIds: [...issue.rowIds],
    column: issue.column ?? null,
    from: issue.current ?? null,
    to: issue.fix?.kind === 'set-cell' ? issue.fix.to : null,
    reason: issue.reason,
    decision: decisions[issue.id] ?? 'pending',
  }));
  const count = (decision: string) => changes.filter((change) => change.decision === decision).length;

  return {
    cleaned: { fileName: dataset.fileName, columns: [...dataset.columns], rows },
    changeLog: {
      tool: 'ai-data-cleanup-assistant',
      version: '1.0',
      file: {
        name: dataset.fileName,
        rows: dataset.rows.length,
        columns: dataset.columns.length,
        sha256: meta.sha256,
      },
      generatedAt: meta.generatedAt,
      ai: { mode: meta.ai.mode, model: meta.ai.model },
      summary: {
        issues: changes.length,
        accepted: count('accepted'),
        rejected: count('rejected'),
        pending: count('pending'),
        cellsChanged,
        rowsRemoved,
      },
      changes,
    },
  };
}
