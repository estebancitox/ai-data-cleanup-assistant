// GET /api/ai/recording?sha256=<64 hex>. SPEC §6.6: the recorded analysis of a file, found
// by the SHA-256 of the file. No model call is made, so the rate limit does not apply.

import { findRecording, isSha256 } from '../../../../ai';

/**
 * Builds the handler. 400 when `sha256` is not 64 hexadecimal characters, 404 when no
 * recording matches, otherwise 200 with `{ contract, model, recordedAt }`.
 */
export function createRecordingHandler(dependencies: { directory?: string } = {}) {
  return function GET(request: Request): Response {
    const sha256 = new URL(request.url).searchParams.get('sha256') ?? '';
    if (!isSha256(sha256)) return Response.json({ error: 'invalid_request' }, { status: 400 });
    const recording = findRecording(sha256, dependencies.directory);
    if (!recording) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ contract: recording.contract, model: recording.model, recordedAt: recording.recordedAt });
  };
}
