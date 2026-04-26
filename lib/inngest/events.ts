import { z } from 'zod';

/**
 * Schemas for the two events the phase-07 HITL flow exchanges between the
 * task API, the orchestrator, and the approval Server Action.
 *
 * Inngest's `EventSchemas.fromZod` consumes these and gives the typed
 * `inngest.send()` and `step.waitForEvent()` calls in lib/inngest/client.ts
 * accurate inference.
 */

export const TASK_STARTED = 'auto-ride/task.started' as const;
export const APPROVAL_DECIDED = 'auto-ride/approval.decided' as const;

export const taskStartedSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().min(1),
  maxBudgetUsd: z.number().min(0).optional(),
  maxTurns: z.number().int().positive().optional(),
});

export const approvalDecidedSchema = z.object({
  gateId: z.string().uuid(),
  approved: z.boolean(),
  reason: z.string().nullable().optional(),
  modifiedInput: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type TaskStartedData = z.infer<typeof taskStartedSchema>;
export type ApprovalDecidedData = z.infer<typeof approvalDecidedSchema>;

export const CLEANUP_REQUESTED = 'auto-ride/cleanup.requested' as const;

export const cleanupRequestedSchema = z.object({
  /** Optional human-readable reason for audit; default "manual". */
  reason: z.string().default('manual'),
});

export type CleanupRequestedData = z.infer<typeof cleanupRequestedSchema>;
