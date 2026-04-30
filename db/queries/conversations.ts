import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { conversations, tasks } from '@/db/schema';
import type { TaskRow, TaskSummary } from './task-api';
import type { TaskStatus } from './task-runtime';

export type ConversationRow = {
  id: string;
  userId: string;
  customerEmail: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationSummary = ConversationRow & {
  /** Latest task on the conversation. Null only if the row has no tasks (rare — we always create one with the conversation). */
  latestTaskId: string | null;
  latestTaskStatus: TaskStatus | null;
  latestPrompt: string | null;
};

export async function createConversation(args: {
  userId: string;
  customerEmail: string;
  title?: string | null;
}): Promise<ConversationRow> {
  const [row] = await db
    .insert(conversations)
    .values({
      userId: args.userId,
      customerEmail: args.customerEmail,
      title: args.title ?? null,
    })
    .returning();
  if (!row) throw new Error('createConversation: insert returned no row');
  return {
    id: row.id,
    userId: row.userId,
    customerEmail: row.customerEmail,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getConversationById(
  id: string,
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    customerEmail: row.customerEmail,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listConversationsForUser(
  userId: string,
  limit: number = 50,
): Promise<ConversationSummary[]> {
  // One round-trip: pick the latest-task fields per conversation via a
  // correlated lateral subquery. Conversations with zero tasks (shouldn't
  // happen in normal flow, but tolerated) come back with nulls.
  const rows = (await db.execute(sql`
    SELECT
      c.id,
      c.user_id,
      c.customer_email,
      c.title,
      c.created_at,
      c.updated_at,
      lt.id   AS latest_task_id,
      lt.status AS latest_task_status,
      lt.prompt AS latest_prompt
    FROM conversations c
    LEFT JOIN LATERAL (
      SELECT t.id, t.status, t.prompt
      FROM tasks t
      WHERE t.conversation_id = c.id
      ORDER BY t.created_at DESC
      LIMIT 1
    ) lt ON true
    WHERE c.user_id = ${userId}
    ORDER BY c.updated_at DESC
    LIMIT ${limit}
  `)) as unknown as
    | {
        rows?: Array<{
          id: string;
          user_id: string;
          customer_email: string;
          title: string | null;
          created_at: Date | string;
          updated_at: Date | string;
          latest_task_id: string | null;
          latest_task_status: string | null;
          latest_prompt: string | null;
        }>;
      }
    | Array<{
        id: string;
        user_id: string;
        customer_email: string;
        title: string | null;
        created_at: Date | string;
        updated_at: Date | string;
        latest_task_id: string | null;
        latest_task_status: string | null;
        latest_prompt: string | null;
      }>;

  const result = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return result.map((r) => ({
    id: r.id,
    userId: r.user_id,
    customerEmail: r.customer_email,
    title: r.title,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    latestTaskId: r.latest_task_id,
    latestTaskStatus: (r.latest_task_status as TaskStatus | null) ?? null,
    latestPrompt: r.latest_prompt,
  }));
}

export async function listTasksForConversation(
  conversationId: string,
): Promise<TaskSummary[]> {
  const rows = await db
    .select({
      id: tasks.id,
      prompt: tasks.prompt,
      status: tasks.status,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      createdBy: tasks.createdBy,
    })
    .from(tasks)
    .where(eq(tasks.conversationId, conversationId))
    .orderBy(asc(tasks.createdAt));

  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status as TaskStatus,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    createdBy: r.createdBy,
  }));
}

/**
 * Latest task on a conversation. Used to decide whether the composer is
 * disabled (task running) and where the SSE stream should attach.
 */
export async function getLatestTaskInConversation(
  conversationId: string,
): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.conversationId, conversationId))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    createdBy: row.createdBy,
    maxBudgetUsd: row.maxBudgetUsd,
    maxTurns: row.maxTurns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function touchConversation(id: string): Promise<void> {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function setConversationTitle(args: {
  id: string;
  title: string;
}): Promise<void> {
  await db
    .update(conversations)
    .set({ title: args.title, updatedAt: new Date() })
    .where(and(eq(conversations.id, args.id)));
}
