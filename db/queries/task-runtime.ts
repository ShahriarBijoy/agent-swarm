import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { taskEvents, taskRuns, tasks } from '@/db/schema';

export type TaskStatus =
  | 'queued'
  | 'in_progress'
  | 'awaiting_approval'
  | 'done'
  | 'failed'
  | 'cancelled';

export type CreateTaskArgs = {
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
};

export async function createTask(args: CreateTaskArgs): Promise<{ id: string }> {
  const [row] = await db
    .insert(tasks)
    .values({
      prompt: args.prompt,
      status: 'in_progress',
      ...(args.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: args.maxBudgetUsd.toFixed(4) }
        : {}),
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
      ...(args.createdBy !== undefined ? { createdBy: args.createdBy } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error('createTask: insert returned no row');
  return { id: row.id };
}

export async function createTaskRun(args: {
  taskId: string;
  attempt?: number;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(taskRuns)
    .values({
      taskId: args.taskId,
      attempt: args.attempt ?? 1,
      status: 'in_progress',
    })
    .returning({ id: taskRuns.id });
  if (!row) throw new Error('createTaskRun: insert returned no row');
  return { id: row.id };
}

export async function appendTaskEvent(args: {
  runId: string;
  taskId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.insert(taskEvents).values({
    runId: args.runId,
    taskId: args.taskId,
    seq: args.seq,
    type: args.type,
    payload: args.payload,
  });
}

export async function updateTaskRunSession(args: {
  runId: string;
  sessionId: string;
}): Promise<void> {
  await db
    .update(taskRuns)
    .set({ sessionId: args.sessionId })
    .where(eq(taskRuns.id, args.runId));
}

export async function finalizeRun(args: {
  runId: string;
  status: 'done' | 'failed';
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error?: string | null;
}): Promise<void> {
  await db
    .update(taskRuns)
    .set({
      status: args.status,
      endedAt: new Date(),
      totalCostUsd: args.totalCostUsd.toFixed(4),
      totalInputTokens: args.totalInputTokens,
      totalOutputTokens: args.totalOutputTokens,
      error: args.error ?? null,
    })
    .where(eq(taskRuns.id, args.runId));
}

export async function finalizeTask(args: {
  taskId: string;
  status: 'done' | 'failed';
  completedAt?: Date;
}): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: args.status,
      completedAt: args.completedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, args.taskId));
}
