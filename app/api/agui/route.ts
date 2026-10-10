import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { auth } from '@/lib/auth/server';
import { createQueuedTask } from '@/db/queries/task-api';
import { finalizeTask } from '@/db/queries/task-runtime';
import { startTask } from '@/lib/runner/start-task';
import { lastUserText } from '@/lib/agui/input';
import { AGUI_RESPONSE_HEADERS, aguiContentType, streamTaskAsAgui } from '@/lib/agui/stream';
import { taskEventsDeps } from '@/lib/agui/db-deps';

export const dynamic = 'force-dynamic';

const MAX_PROMPT_CHARS = 4000;

/**
 * Phase 13 — Auto-Ride as an AG-UI agent endpoint.
 *
 * An AG-UI client (e.g. `new HttpAgent({ url: '/api/agui' })` from
 * `@ag-ui/client`, or CopilotKit) POSTs a standard `RunAgentInput`. We take
 * the latest user message as the prompt, queue a normal swarm task through
 * the same Inngest path as `POST /api/tasks` (so HITL gates, budgets and the
 * operator dashboard all still apply), and answer with the run as an AG-UI
 * event stream. RUN_STARTED / RUN_FINISHED echo the client's threadId and
 * runId, as the protocol expects.
 *
 * Session-gated like `POST /api/tasks`.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = RunAgentInputSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_run_agent_input', issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const prompt = lastUserText(input.messages);
  if (!prompt) {
    return Response.json({ error: 'no_user_message' }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: 'prompt_too_long', limit: MAX_PROMPT_CHARS }, { status: 400 });
  }

  let taskId: string | undefined;
  try {
    const created = await createQueuedTask({ prompt, createdBy: `agui:${session.user.email}` });
    taskId = created.id;
    await startTask({ taskId, prompt });
  } catch (err) {
    console.error('[api/agui] dispatch failed:', err);
    if (taskId) {
      await finalizeTask({ taskId, status: 'failed' }).catch(() => undefined);
    }
    return Response.json({ error: 'dispatch_failed' }, { status: 500 });
  }

  const accept = req.headers.get('accept');
  const body = streamTaskAsAgui({
    taskId,
    threadId: input.threadId,
    runId: input.runId,
    signal: req.signal,
    accept,
    deps: taskEventsDeps(),
  });
  return new Response(body, {
    headers: {
      'Content-Type': aguiContentType(accept),
      'X-Auto-Ride-Task-Id': taskId,
      ...AGUI_RESPONSE_HEADERS,
    },
  });
}
