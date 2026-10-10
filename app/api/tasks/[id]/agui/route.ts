import { verifySseToken } from '@/lib/auth/sse-token';
import { AGUI_RESPONSE_HEADERS, aguiContentType, streamTaskAsAgui } from '@/lib/agui/stream';
import { taskEventsDeps } from '@/lib/agui/db-deps';

export const dynamic = 'force-dynamic';

/**
 * Phase 13 — watch an existing task as an AG-UI event stream.
 *
 * Same auth as `/api/tasks/[id]/stream`: a 60-second HMAC token in `?token=`
 * minted by `/api/tasks/[id]/stream-token` (session-gated), because
 * EventSource cannot send headers. The stream starts at the first event of
 * the run, so a client that connects late still gets the full AG-UI history.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: taskId } = await params;
  const url = new URL(req.url);
  if (!verifySseToken(url.searchParams.get('token'), { taskId })) {
    return new Response('unauthorized', { status: 401 });
  }

  const accept = req.headers.get('accept');
  const body = streamTaskAsAgui({ taskId, signal: req.signal, accept, deps: taskEventsDeps() });
  return new Response(body, {
    headers: { 'Content-Type': aguiContentType(accept), ...AGUI_RESPONSE_HEADERS },
  });
}
