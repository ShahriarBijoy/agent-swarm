import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { db } from '@/db/client';
import { taskEvents, tasks } from '@/db/schema';
import type { TaskStatus } from '@/db/queries/task-runtime';

export type TaskRow = {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdBy: string | null;
  maxBudgetUsd: string | null;
  maxTurns: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
};

export type TaskEventRow = {
  id: bigint;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type TaskSummary = Pick<
  TaskRow,
  'id' | 'prompt' | 'status' | 'createdAt' | 'completedAt' | 'createdBy'
>;

export type CreateQueuedTaskArgs = {
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
};

export async function createQueuedTask(
  args: CreateQueuedTaskArgs,
): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(tasks)
    .values({
      prompt: args.prompt,
      status: 'queued',
      createdBy: args.createdBy ?? 'http',
      ...(args.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: args.maxBudgetUsd.toFixed(4) }
        : {}),
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    })
    .returning({ id: tasks.id, createdAt: tasks.createdAt });
  if (!row) throw new Error('createQueuedTask: insert returned no row');
  return { id: row.id, createdAt: row.createdAt };
}

/**
 * Idempotent queued → in_progress transition.
 *
 * Safe to call multiple times — the WHERE clause matches only `queued`, so a
 * task already in `in_progress` (or terminal) is untouched. Callers don't need
 * to know the prior state.
 */
export async function markTaskInProgress(taskId: string): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'queued')));
}

export async function getTaskById(taskId: string): Promise<TaskRow | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
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

export type GetEventsSinceArgs = {
  taskId: string;
  afterId: bigint;
  limit?: number;
};

/**
 * Returns task_events rows with `id > afterId` for a given task, ordered by
 * id ASC. Because `id` is a monotonically-increasing bigserial, this is the
 * cheapest correct cursor for the SSE poll loop — no JOIN, no seq math, no
 * across-run coordination (events from any attempt for this task are
 * surfaced, which is what a timeline viewer wants).
 */
export async function getEventsSince(
  args: GetEventsSinceArgs,
): Promise<TaskEventRow[]> {
  const rows = await db
    .select({
      id: taskEvents.id,
      seq: taskEvents.seq,
      type: taskEvents.type,
      payload: taskEvents.payload,
      createdAt: taskEvents.createdAt,
    })
    .from(taskEvents)
    .where(
      and(eq(taskEvents.taskId, args.taskId), gt(taskEvents.id, args.afterId)),
    )
    .orderBy(asc(taskEvents.id))
    .limit(args.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    type: r.type,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
  }));
}

export async function listRecentTasks(limit: number = 10): Promise<TaskSummary[]> {
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
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status as TaskStatus,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    createdBy: r.createdBy,
  }));
}
