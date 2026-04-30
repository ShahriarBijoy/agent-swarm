import { createQueuedTask } from '@/db/queries/task-api';
import { finalizeTask } from '@/db/queries/task-runtime';
import { startTask } from '@/lib/runner/start-task';
import { createTaskBodySchema } from '@/lib/validation/task-body';
import { db } from '@/db/client';
import { customers } from '@/db/schema/domain';
import { eq, and, isNull } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import {
  createConversation,
  getConversationById,
  getLatestTaskInConversation,
  setConversationTitle,
  touchConversation,
} from '@/db/queries/conversations';
import { buildConversationContext } from '@/lib/runner/conversation-context';

export const dynamic = 'force-dynamic';

const ACTIVE_TASK_STATUSES = new Set([
  'queued',
  'in_progress',
  'awaiting_approval',
]);

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  // Phase 11 — gate task creation behind a Better Auth session.
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await safeJson(req);
  const parsed = createTaskBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const email = session.user.email;
  let conversationId: string | undefined = parsed.data.conversationId;
  let isFollowUp = false;

  // Phase 11.5 — chat conversation flow. The chat surface always operates
  // in `kind: 'scenario'` because the dispatcher's customer_email prefix is
  // what makes the rental tools work. CLI / smoke-test callers leave
  // conversationId empty and we keep the legacy single-shot semantics.
  if (parsed.data.kind === 'scenario') {
    if (conversationId) {
      const convo = await getConversationById(conversationId);
      if (!convo) {
        return Response.json(
          { error: 'conversation_not_found' },
          { status: 404 },
        );
      }
      if (convo.userId !== session.user.id) {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }
      // Don't allow stacking turns on top of a still-running one — the SDK
      // would interleave or, worse, the prior task's tail events would show
      // up in the next run's stream window. Reject with a clear status so
      // the UI can show "wait for the current reply to finish".
      const latest = await getLatestTaskInConversation(conversationId);
      if (latest && ACTIVE_TASK_STATUSES.has(latest.status)) {
        return Response.json(
          {
            error: 'conversation_busy',
            message: 'previous turn is still running',
            taskId: latest.id,
          },
          { status: 409 },
        );
      }
      isFollowUp = true;
    } else {
      const created = await createConversation({
        userId: session.user.id,
        customerEmail: email,
        // Title is set after the first prompt is known (below).
      });
      conversationId = created.id;
    }
  }

  let prefixedPrompt = parsed.data.prompt;
  if (parsed.data.kind === 'scenario') {
    // Phase 11 — derive the customer's email from the SESSION, not the body.
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.email, email));
    if (!existing) {
      await db.insert(customers).values({
        name: session.user.name ?? email.split('@')[0] ?? email,
        email,
        userId: session.user.id,
      });
    } else if (!existing.userId) {
      await db
        .update(customers)
        .set({ userId: session.user.id })
        .where(and(eq(customers.id, existing.id), isNull(customers.userId)));
    }

    const priorContext = isFollowUp && conversationId
      ? await buildConversationContext({ conversationId })
      : '';

    prefixedPrompt =
      `[scenario] customer_email=${email}\n` +
      `[conversation_id=${conversationId}]\n\n` +
      priorContext +
      parsed.data.prompt;
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
      ...(conversationId ? { conversationId } : {}),
    });
    id = created.id;

    // Phase 11.5 — set the conversation title from the first user prompt
    // (truncated) and bump updated_at so the sidebar re-orders.
    if (conversationId) {
      if (!isFollowUp) {
        const title = parsed.data.prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
        if (title.length > 0) {
          await setConversationTitle({ id: conversationId, title });
        }
      } else {
        await touchConversation(conversationId);
      }
    }

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
        ...(conversationId ? { conversationId } : {}),
        status: 'queued' as const,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('[api/tasks] dispatch failed:', raw);
    if (id) {
      try {
        await finalizeTask({ taskId: id, status: 'failed' });
      } catch {
        // ignore — original error is what we report
      }
    }
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
