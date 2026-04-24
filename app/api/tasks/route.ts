import { createQueuedTask } from '@/db/queries/task-api';
import { startTask } from '@/lib/runner/start-task';
import { createTaskBodySchema } from '@/lib/validation/task-body';

export const dynamic = 'force-dynamic';

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await safeJson(req);
  const parsed = createTaskBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { id, createdAt } = await createQueuedTask({
      prompt: parsed.data.prompt,
      ...(parsed.data.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: parsed.data.maxBudgetUsd }
        : {}),
      ...(parsed.data.maxTurns !== undefined
        ? { maxTurns: parsed.data.maxTurns }
        : {}),
      createdBy: 'http',
    });

    // Fire-and-forget the runner. Errors are captured inside startTask and
    // persisted to the task row as status='failed'.
    startTask({
      taskId: id,
      prompt: parsed.data.prompt,
      ...(parsed.data.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: parsed.data.maxBudgetUsd }
        : {}),
      ...(parsed.data.maxTurns !== undefined
        ? { maxTurns: parsed.data.maxTurns }
        : {}),
    });

    return Response.json(
      {
        taskId: id,
        status: 'queued' as const,
        createdAt: createdAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/tasks] createQueuedTask failed:', message);
    return Response.json(
      { error: 'internal', message },
      { status: 500 },
    );
  }
}
