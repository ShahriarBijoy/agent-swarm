import { auth } from '@/lib/auth/server';
import { signSseToken } from '@/lib/auth/sse-token';

// Phase 11 — Mint a fresh SSE token for an existing EventSource client.
//
// The page server-component mints the initial token at first render. After
// 60s the token expires and the next EventSource frame fails verification.
// Clients catch the SSE `onerror`, fetch this endpoint with the session
// cookie (regular fetch DOES forward cookies), get a new token, and
// reconstruct the EventSource with the fresh `?token=`.
//
// This route is session-cookie-gated, NOT public — it's intentionally NOT
// in lib/auth/public-paths.ts.

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return new Response('unauthorized', { status: 401 });
  }
  const { id: taskId } = await params;
  const token = signSseToken({ taskId, userId: session.user.id });
  return Response.json({ token, ttlSec: 60 });
}
