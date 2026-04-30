import { createQueuedTask } from '@/db/queries/task-api';
import { finalizeTask } from '@/db/queries/task-runtime';
import { startTask } from '@/lib/runner/start-task';
import { createTaskBodySchema } from '@/lib/validation/task-body';
import { db } from '@/db/client';
import { customers } from '@/db/schema/domain';
import { eq } from 'drizzle-orm';

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

  let prefixedPrompt = parsed.data.prompt;
  if (parsed.data.kind === 'scenario') {
    const email = parsed.data.customer_email;
    if (email) {
      const [existing] = await db
        .select()
        .from(customers)
        .where(eq(customers.email, email));
      if (!existing) {
        await db.insert(customers).values({
          name: email.split('@')[0],
          email,
        });
      }
    }
    prefixedPrompt = `[scenario] customer_email=${email ?? 'unknown'}\n\n${parsed.data.prompt}`;
  }

  let id: string | undefined;
  try {
    const created = await createQueuedTask({
      prompt: prefixedPrompt,
      ...(parsed.data.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: parsed.data.maxBudgetUsd }
        : {}),
      ...(parsed.data.maxTurns !== undefined
        ? { maxTurns: parsed.data.maxTurns }
        : {}),
      createdBy: 'http',
    });
    id = created.id;

    // Phase 07: this dispatches an Inngest event instead of fire-and-
    // forgetting in-process. Errors before the event is accepted (network,
    // schema mismatch) are caught below; anything that goes wrong inside
    // the orchestrator now bubbles through Inngest's retry semantics.
    await startTask({
      taskId: created.id,
      prompt: prefixedPrompt,
      ...(parsed.data.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: parsed.data.maxBudgetUsd }
        : {}),
      ...(parsed.data.maxTurns !== undefined
        ? { maxTurns: parsed.data.maxTurns }
        : {}),
    });

    return Response.json(
      {
        taskId: created.id,
        status: 'queued' as const,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('[api/tasks] dispatch failed:', raw);
    // If the task row was created but the Inngest send failed, finalize it
    // to `failed` so the SSE stream terminates instead of polling forever.
    if (id) {
      try {
        await finalizeTask({ taskId: id, status: 'failed' });
      } catch {
        // ignore — original error is what we report
      }
    }
    // Translate the most common dev-time misconfiguration into something the
    // operator can actually act on. The raw "Inngest API Error: 401 Event key
    // not found" only makes sense once you know that pnpm inngest:dev is the
    // local broker and that the SDK falls back to Inngest Cloud without it.
    const isInngestAuth =
      /event key not found/i.test(raw) || /401/.test(raw);
    const message = isInngestAuth
      ? 'Inngest broker not reachable. In dev, start it with `pnpm inngest:dev` in another terminal. In prod, set INNGEST_EVENT_KEY.'
      : raw;
    return Response.json(
      { error: 'internal', message },
      { status: 500 },
    );
  }
}
