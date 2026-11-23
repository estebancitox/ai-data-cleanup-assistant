// Where the analysis of a file comes from: the rule detectors first, then what the AI layer
// adds. This is the one place of the page that knows the order of the pipeline (SPEC §4.2);
// the page only consumes the snapshots it yields.

import { applyVerdicts, CASES_PER_REQUEST, CONCURRENT_REQUESTS, selectCases } from '../core/adjudicate';
import { analyze } from '../core/analyze';
import { buildContractRequest, verifyContract } from '../core/contract';
import type { AiMode, Analysis, Case, ChangeLogMeta, Contract, Verdict, VerifiedContract } from '../core/types';
import { failureText, fetchRecording, fetchStatus, requestContract, requestVerdicts } from './ai';
import type { LoadedFile } from './load';

/** What the page shows about the AI side of an analysis. SPEC §6.6 and §7.2. */
export interface AiRun {
  /** The mode chosen for this file; 'checking' until it is known. */
  mode: AiMode | 'checking';
  model: string | null;
  /** For a recording: when it was made, ISO 8601. */
  recordedAt?: string;
  /** The step that is under way now. */
  busy?: 'contract' | 'adjudication';
  /** Rules of the contract: every proposed rule is either verified or rejected. */
  contract?: { proposed: number; verified: number; rejected: number };
  /** Cases sent for an opinion, and the opinions that came back. */
  adjudication?: { cases: number; confirmed: number; dismissed: number; unsure: number };
  /** A sentence for the user: how to enable AI, or why a step failed. */
  notice?: string;
  /** Present after a failed step: asks for that step again. */
  retry?: () => void;
  /** Present for a recording when the server is live: replaces the recording with a live run. */
  runLive?: () => void;
}

/** The analysis as it stands now, the AI that produced it, and the state of the AI run. */
export interface AnalysisSnapshot {
  analysis: Analysis;
  /** What produced `analysis`; it goes into the change log. */
  ai: ChangeLogMeta['ai'];
  run: AiRun;
}

export const AI_OFF: AnalysisSnapshot['ai'] = { mode: 'off', model: null };

const OFF_NOTICE =
  'AI is off: the server has no API key and this file has no recorded analysis. The rule-based analysis is complete without it. To enable AI, set ANTHROPIC_API_KEY in .env.local and restart the server. The sample data has a recorded AI analysis that needs no key.';

// The server did not say whether it is live, so nothing is claimed about its key.
const UNKNOWN_NOTICE =
  'AI is off: the server did not answer when asked whether AI is available, and this file has no recorded analysis. The rule-based analysis is complete without it. Load the file again to ask once more.';

/** A promise the page settles by calling `open`: how a retry or "Run live" reaches the generator. */
function gate(): { open: () => void; opened: Promise<void> } {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/** `verifyContract` puts every proposed rule in exactly one place: an accepted list or `rejected`. */
function ruleCounts(verified: VerifiedContract): NonNullable<AiRun['contract']> {
  const accepted =
    verified.missingTokens.length +
    verified.canonicalGroups.length +
    verified.suspiciousValues.length +
    verified.ranges.length +
    verified.dependencies.length +
    verified.columns.filter((column) => column.format !== 'none').length;
  return { proposed: accepted + verified.rejected.length, verified: accepted, rejected: verified.rejected.length };
}

function verdictCounts(analysis: Analysis, cases: number): NonNullable<AiRun['adjudication']> {
  const count = (value: Verdict['value']) => analysis.issues.filter((issue) => issue.verdict?.value === value).length;
  return { cases, confirmed: count('confirm'), dismissed: count('dismiss'), unsure: count('unsure') };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/**
 * Yields the analysis of a file, and yields it again each time it gains results or the state of
 * the AI run changes. Every snapshot replaces the one before; the page keeps the user's
 * decisions across them, which works because issue ids are stable (SPEC §4.4, invariant 6).
 *
 * The first snapshot is the rule-based analysis. Then the mode is decided as SPEC §6.6 says:
 * the recording of the file if there is one, a live contract if the server is live, otherwise
 * off. A contract, recorded or live, is verified and analysed here, in the browser. A failed
 * call leaves the analysis as it was, with a notice and `retry`; the generator then waits, and
 * a retry repeats only the step that failed, because a live contract is not the same twice.
 */
export async function* runAnalysis(file: LoadedFile): AsyncGenerator<AnalysisSnapshot> {
  const { dataset } = file;
  let analysis = analyze(dataset);
  let ai = AI_OFF;
  let run: AiRun = { mode: 'checking', model: null };
  const snapshot = (): AnalysisSnapshot => ({ analysis, ai, run });
  yield snapshot();

  const [recording, status] = await Promise.all([fetchRecording(file.sha256), fetchStatus()]);
  const live = status.ok && status.value.live;
  const liveModel = status.ok ? status.value.model : null;

  if (recording.ok) {
    const { contract, verdicts, model, recordedAt } = recording.value;
    const verified = verifyContract(contract, dataset);
    const withContract = analyze(dataset, verified);
    analysis = applyVerdicts(withContract, verdicts);
    ai = { mode: 'recorded', model };
    const wanted = gate();
    run = {
      mode: 'recorded',
      model,
      recordedAt,
      contract: ruleCounts(verified),
      adjudication: verdictCounts(analysis, selectCases(dataset, withContract).length),
      ...(live ? { runLive: wanted.open } : {}),
    };
    yield snapshot();
    if (!live) return;
    await wanted.opened;
  } else if (!live) {
    run = { mode: 'off', model: null, notice: status.ok ? OFF_NOTICE : UNKNOWN_NOTICE };
    yield snapshot();
    return;
  }

  // Live. The analysis on screen stays until the contract arrives.
  let inferred: { contract: Contract; model: string } | undefined;
  while (!inferred) {
    run = { mode: 'live', model: liveModel, busy: 'contract' };
    yield snapshot();
    const answer = await requestContract(buildContractRequest(dataset));
    if (answer.ok) {
      inferred = answer.value;
      break;
    }
    const again = gate();
    run = {
      mode: 'live',
      model: liveModel,
      notice: `${failureText(answer.status)} The analysis on screen was made without this step and stays as it is.`,
      retry: again.open,
    };
    yield snapshot();
    await again.opened;
  }

  const answeredBy = inferred.model;
  const verified = verifyContract(inferred.contract, dataset);
  const withContract = analyze(dataset, verified);
  const cases = selectCases(dataset, withContract);
  const verdicts: Verdict[] = [];
  analysis = withContract;
  ai = { mode: 'live', model: answeredBy };
  const reached = (): AiRun => ({
    mode: 'live',
    model: answeredBy,
    contract: ruleCounts(verified),
    adjudication: verdictCounts(analysis, cases.length),
  });

  // SPEC §6.4: requests of 10 cases, three at a time. A request that fails is asked again on retry.
  let waiting: Case[][] = chunks(cases, CASES_PER_REQUEST);
  while (waiting.length > 0) {
    run = { ...reached(), busy: 'adjudication' };
    yield snapshot();
    const failed: Case[][] = [];
    let failure = 0;
    for (const round of chunks(waiting, CONCURRENT_REQUESTS)) {
      const answers = await Promise.all(round.map(requestVerdicts));
      answers.forEach((answer, position) => {
        if (answer.ok) verdicts.push(...answer.value.verdicts);
        else {
          failed.push(round[position]);
          failure = answer.status;
        }
      });
    }
    analysis = applyVerdicts(withContract, verdicts);
    waiting = failed;
    if (waiting.length === 0) break;
    const again = gate();
    const unanswered = waiting.reduce((sum, request) => sum + request.length, 0);
    run = {
      ...reached(),
      notice: `${failureText(failure)} The AI gave no opinion on ${unanswered} of ${cases.length} ambiguous cases; they stay as the rules reported them.`,
      retry: again.open,
    };
    yield snapshot();
    await again.opened;
  }

  run = reached();
  yield snapshot();
}
