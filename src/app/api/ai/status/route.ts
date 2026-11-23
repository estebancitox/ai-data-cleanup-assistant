import { aiStatus } from '../../../../ai';

// The answer depends on the server's environment when the request arrives, so this route is
// rendered for every request and never prerendered at build time.
export const dynamic = 'force-dynamic';

/** GET /api/ai/status: `{ live, model }`. SPEC §4.3. */
export function GET(): Response {
  return Response.json(aiStatus());
}
