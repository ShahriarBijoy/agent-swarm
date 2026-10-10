import { authenticateA2A, handleA2AJsonRpc, publicBaseUrl } from '@/lib/a2a/http';
import { isA2AExposedAgent } from '@/lib/a2a/exposed';
import { getA2ARequestHandler } from '@/lib/a2a/registry';

export const dynamic = 'force-dynamic';

/**
 * Phase 13 — A2A JSON-RPC endpoint for one exposed worker
 * (SendMessage, SendStreamingMessage, GetTask, CancelTask, ...).
 * Bearer-authenticated with A2A_API_KEY; see lib/a2a/http.ts.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ agent: string }> },
): Promise<Response> {
  const { agent } = await params;
  if (!isA2AExposedAgent(agent)) {
    return Response.json({ error: 'unknown_agent' }, { status: 404 });
  }
  const auth = authenticateA2A(req);
  if (!auth.ok) return auth.response;
  return handleA2AJsonRpc(req, getA2ARequestHandler(agent, publicBaseUrl(req)), auth.user);
}
