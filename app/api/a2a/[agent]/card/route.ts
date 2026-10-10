import { agentCardResponse, publicBaseUrl } from '@/lib/a2a/http';
import { isA2AExposedAgent } from '@/lib/a2a/exposed';
import { getA2ARequestHandler } from '@/lib/a2a/registry';

export const dynamic = 'force-dynamic';

/**
 * Phase 13 — the worker's A2A Agent Card. Public on purpose: discovery must
 * work before a client holds credentials, and the card carries no secrets
 * (it only says "Bearer"). Also served at
 * `/api/a2a/<agent>/.well-known/agent-card.json` and, for the primary
 * worker, `/.well-known/agent-card.json` via rewrites in next.config.mjs.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ agent: string }> },
): Promise<Response> {
  const { agent } = await params;
  if (!isA2AExposedAgent(agent)) {
    return Response.json({ error: 'unknown_agent' }, { status: 404 });
  }
  return agentCardResponse(getA2ARequestHandler(agent, publicBaseUrl(req)));
}
