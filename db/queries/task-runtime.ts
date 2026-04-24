import { eq, sql } from 'drizzle-orm';
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
  // Phase 07: when no attempt is provided, compute MAX(attempt) + 1 for the
  // task. The Inngest replay path re-enters runOrchestrator on the same
  // taskId; without this each replay would conflict on the
  // (task_id, attempt) unique index.
  const attempt =
    args.attempt ??
    (await nextAttemptForTask(args.taskId));

  const [row] = await db
    .insert(taskRuns)
    .values({
      taskId: args.taskId,
      attempt,
      status: 'in_progress',
    })
    .returning({ id: taskRuns.id });
  if (!row) throw new Error('createTaskRun: insert returned no row');
  return { id: row.id };
}

async function nextAttemptForTask(taskId: string): Promise<number> {
  const result = (await db.execute(sql`
    SELECT COALESCE(MAX(attempt), 0) AS max_attempt
    FROM task_runs WHERE task_id = ${taskId}
  `)) as unknown as { rows?: Array<{ max_attempt: number | string }> } | Array<{ max_attempt: number | string }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const raw = rows[0]?.max_attempt ?? 0;
  return Number(raw) + 1;
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

/**
 * Phase-07 seq-safe append. Computes `seq = MAX(seq) + 1` for the run inside
 * the same INSERT statement, so the SDK runner and the Server Action that
 * resolves an approval never collide on the `(run_id, seq)` unique index.
 *
 * Retries up to 3 times on unique-violation. Returns the assigned seq so the
 * caller's in-memory cursor stays in sync with the DB.
 */
export async function appendTaskEventAuto(args: {
  runId: string;
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<{ id: bigint; seq: number }> {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const result = (await db.execute(sql`
        INSERT INTO task_events (run_id, task_id, seq, type, payload)
        VALUES (
          ${args.runId},
          ${args.taskId},
          COALESCE((SELECT MAX(seq) FROM task_events WHERE run_id = ${args.runId}), -1) + 1,
          ${args.type},
          ${JSON.stringify(args.payload)}::jsonb
        )
        RETURNING id, seq
      `)) as unknown as { rows?: Array<{ id: string | bigint; seq: number }> } | Array<{ id: string | bigint; seq: number }>;

      const rows = Array.isArray(result) ? result : (result.rows ?? []);
      const row = rows[0];
      if (!row) {
        throw new Error('appendTaskEventAuto: insert returned no row');
      }
      return {
        id: typeof row.id === 'bigint' ? row.id : BigInt(row.id),
        seq: Number(row.seq),
      };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error('appendTaskEventAuto: exhausted retries on seq conflict');
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === '23505') return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    /duplicate key value|task_events_run_seq/.test(message)
  );
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
