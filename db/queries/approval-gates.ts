import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { approvalGates } from '@/db/schema';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'modified'
  | 'denied'
  | 'timed_out';

/**
 * Full row shape — exposed because the Server Action and the canUseTool
 * factory both need to read the proposed input back to inspect / re-emit.
 */
export type GateRow = {
  id: string;
  runId: string;
  taskId: string;
  toolName: string;
  proposedInput: unknown;
  status: ApprovalStatus;
  resolutionInput: unknown | null;
  reviewerNote: string | null;
  reviewerId: string | null;
  inngestEventKey: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  timedOutAt: Date | null;
};

/** UI-facing summary — what `<ApprovalBar>` renders without leaking reviewer fields. */
export type GateSummary = Pick<
  GateRow,
  'id' | 'runId' | 'taskId' | 'toolName' | 'proposedInput' | 'status' | 'createdAt'
>;

export type OpenGateArgs = {
  /** Caller-supplied UUID — the same id is embedded in the SSE event so the UI can dedupe. */
  id: string;
  runId: string;
  taskId: string;
  toolName: string;
  proposedInput: unknown;
  /** Phase-12 will populate this with the Inngest event-key for full traceability. */
  inngestEventKey?: string;
};

/**
 * Insert a `pending` gate row. Idempotent on the gate id — a re-entrant
 * `canUseTool` callback after an Inngest function replay must not produce a
 * duplicate row. We use ON CONFLICT (id) DO NOTHING; the second caller sees
 * the existing row when it queries by id.
 */
export async function openGate(args: OpenGateArgs): Promise<void> {
  await db
    .insert(approvalGates)
    .values({
      id: args.id,
      runId: args.runId,
      taskId: args.taskId,
      toolName: args.toolName,
      proposedInput: args.proposedInput as never,
      status: 'pending',
      ...(args.inngestEventKey !== undefined
        ? { inngestEventKey: args.inngestEventKey }
        : {}),
    })
    .onConflictDoNothing({ target: approvalGates.id });
}

export type ResolveGateArgs = {
  id: string;
  status: 'approved' | 'modified' | 'denied';
  reviewerId?: string;
  reviewerNote?: string | null;
  /** Required when status === 'modified'. */
  resolutionInput?: unknown;
};

export type ResolveGateResult =
  | { ok: true; previousStatus: 'pending' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_resolved'; status: ApprovalStatus };

/**
 * Transition a pending gate to a terminal status. Guards against double-resolve
 * — the WHERE clause matches `status = 'pending'` so a concurrent second
 * caller (browser double-click, retry storm) sees `already_resolved` instead
 * of silently overwriting the reviewer's first decision.
 */
export async function resolveGate(args: ResolveGateArgs): Promise<ResolveGateResult> {
  if (args.status === 'modified' && args.resolutionInput === undefined) {
    throw new Error(
      'resolveGate: status=modified requires resolutionInput (caller bug)',
    );
  }

  const updated = await db
    .update(approvalGates)
    .set({
      status: args.status,
      resolutionInput:
        args.status === 'modified'
          ? (args.resolutionInput as never)
          : null,
      reviewerId: args.reviewerId ?? 'local-dev',
      reviewerNote: args.reviewerNote ?? null,
      resolvedAt: new Date(),
    })
    .where(and(eq(approvalGates.id, args.id), eq(approvalGates.status, 'pending')))
    .returning({ id: approvalGates.id });

  if (updated.length === 1) {
    return { ok: true, previousStatus: 'pending' };
  }

  // Differentiate "no such gate" vs "already resolved" so the Server Action
  // can return a useful error to the form.
  const current = await getGateById(args.id);
  if (!current) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'already_resolved', status: current.status };
}

export type ExpireGateResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_resolved'; status?: ApprovalStatus };

/**
 * Flip a pending gate to `timed_out`. Called from the canUseTool callback
 * when `step.waitForEvent` returns null (24h elapsed). Same pending-only
 * guard as resolveGate.
 */
export async function expireGate(id: string): Promise<ExpireGateResult> {
  const updated = await db
    .update(approvalGates)
    .set({
      status: 'timed_out',
      timedOutAt: new Date(),
    })
    .where(and(eq(approvalGates.id, id), eq(approvalGates.status, 'pending')))
    .returning({ id: approvalGates.id });

  if (updated.length === 1) return { ok: true };

  const current = await getGateById(id);
  if (!current) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'already_resolved', status: current.status };
}

export async function getGateById(id: string): Promise<GateRow | null> {
  const [row] = await db
    .select()
    .from(approvalGates)
    .where(eq(approvalGates.id, id))
    .limit(1);
  if (!row) return null;
  return rowToGate(row);
}

/**
 * Pending gates for a task, oldest first. Phase 07 only ever has one gate
 * pending per task at a time (canUseTool is serial), but ORDER BY keeps
 * future-proof ordering for the UI.
 */
export async function listPendingForTask(
  taskId: string,
): Promise<GateSummary[]> {
  const rows = await db
    .select({
      id: approvalGates.id,
      runId: approvalGates.runId,
      taskId: approvalGates.taskId,
      toolName: approvalGates.toolName,
      proposedInput: approvalGates.proposedInput,
      status: approvalGates.status,
      createdAt: approvalGates.createdAt,
    })
    .from(approvalGates)
    .where(
      and(eq(approvalGates.taskId, taskId), eq(approvalGates.status, 'pending')),
    )
    .orderBy(asc(approvalGates.createdAt));

  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    taskId: r.taskId,
    toolName: r.toolName,
    proposedInput: r.proposedInput,
    status: r.status as ApprovalStatus,
    createdAt: r.createdAt,
  }));
}

function rowToGate(row: typeof approvalGates.$inferSelect): GateRow {
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    toolName: row.toolName,
    proposedInput: row.proposedInput,
    status: row.status as ApprovalStatus,
    resolutionInput: row.resolutionInput,
    reviewerNote: row.reviewerNote,
    reviewerId: row.reviewerId,
    inngestEventKey: row.inngestEventKey,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    timedOutAt: row.timedOutAt,
  };
}

/**
 * Phase 07 task-status side-effect helpers. Kept here (not in task-api.ts) so
 * the canUseTool callback has one import surface.
 *
 * These bypass the `tasks.status` enum's other transitions — they only flip
 * between `in_progress` and `awaiting_approval`. A terminal task is left
 * untouched so a finalize race can't resurrect it.
 */
export async function markTaskAwaitingApproval(taskId: string): Promise<void> {
  await db.execute(sql`
    UPDATE tasks
    SET status = 'awaiting_approval', updated_at = NOW()
    WHERE id = ${taskId} AND status = 'in_progress'
  `);
}

export async function markTaskResumed(taskId: string): Promise<void> {
  await db.execute(sql`
    UPDATE tasks
    SET status = 'in_progress', updated_at = NOW()
    WHERE id = ${taskId} AND status = 'awaiting_approval'
  `);
}
