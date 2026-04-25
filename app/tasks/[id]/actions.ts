'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getGateById,
  resolveGate,
  type ApprovalStatus,
} from '@/db/queries/approval-gates';
import { appendTaskEventAuto } from '@/db/queries/task-runtime';
import { inngest } from '@/lib/inngest/client';
import { APPROVAL_DECIDED } from '@/lib/inngest/events';

const decisionEnum = z.enum(['approve', 'modify', 'deny']);

const decisionSchema = z.object({
  gateId: z.string().uuid(),
  decision: decisionEnum,
  reason: z
    .string()
    .max(1000)
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v)),
  modifiedInput: z.record(z.string(), z.unknown()).optional(),
});

export type ResolveApprovalResult =
  | { ok: true; gateId: string; status: Exclude<ApprovalStatus, 'pending'> }
  | { ok: false; error: 'invalid_body'; issues: z.ZodIssue[] }
  | { ok: false; error: 'gate_not_found' }
  | {
      ok: false;
      error: 'gate_already_resolved';
      status: ApprovalStatus;
    }
  | { ok: false; error: 'invalid_modified_input'; message: string };

/**
 * Phase-07 approval Server Action.
 *
 * Called by the `<ApprovalCard>` form on `/tasks/[id]`. Three submit
 * buttons share this single action via `<button name="decision" value=…>`:
 *  - Approve: status -> 'approved', SDK gets `{behavior:'allow'}`.
 *  - Modify:  status -> 'modified', SDK gets `{behavior:'allow', updatedInput}`.
 *           Caller must pass `modifiedInput` as a JSON-encoded form field.
 *  - Deny:    status -> 'denied', SDK gets `{behavior:'deny', message:reason}`.
 *
 * Sequence (no transactions; neon-http batches don't support read-then-
 * branch, so we do best-effort atomicity):
 *   1. resolveGate (pending-only WHERE guard) — first writer wins on a
 *      double-click.
 *   2. appendTaskEventAuto — persists `approval_request:resolved` for the
 *      timeline. Failure here logs but does not unwind step 1; the
 *      reviewer's decision is the source of truth.
 *   3. inngest.send — releases the paused canUseTool callback. Failure
 *      here logs; the SDK side will eventually time out (24h) and the
 *      reviewer's intent is still recorded in the gate row.
 */
export async function resolveApproval(
  form: FormData,
): Promise<ResolveApprovalResult> {
  const rawModified = form.get('modifiedInput');
  let parsedModified: Record<string, unknown> | undefined;
  if (typeof rawModified === 'string' && rawModified.trim() !== '') {
    try {
      const candidate = JSON.parse(rawModified);
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        Array.isArray(candidate)
      ) {
        return {
          ok: false,
          error: 'invalid_modified_input',
          message: 'modifiedInput must be a JSON object',
        };
      }
      parsedModified = candidate as Record<string, unknown>;
    } catch (err) {
      return {
        ok: false,
        error: 'invalid_modified_input',
        message: err instanceof Error ? err.message : 'invalid JSON',
      };
    }
  }

  const candidate = {
    gateId: form.get('gateId') ?? undefined,
    decision: form.get('decision') ?? undefined,
    reason: form.get('reason') ?? undefined,
    ...(parsedModified ? { modifiedInput: parsedModified } : {}),
  };

  const parsed = decisionSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_body',
      issues: parsed.error.issues,
    };
  }

  const { gateId, decision, reason, modifiedInput } = parsed.data;

  if (decision === 'modify' && modifiedInput === undefined) {
    return {
      ok: false,
      error: 'invalid_modified_input',
      message: 'modify decision requires a modifiedInput JSON object',
    };
  }

  const gate = await getGateById(gateId);
  if (!gate) return { ok: false, error: 'gate_not_found' };
  if (gate.status !== 'pending') {
    return {
      ok: false,
      error: 'gate_already_resolved',
      status: gate.status,
    };
  }

  const newStatus: Exclude<ApprovalStatus, 'pending'> =
    decision === 'approve'
      ? 'approved'
      : decision === 'modify'
        ? 'modified'
        : 'denied';

  const writeResult = await resolveGate({
    id: gateId,
    status: newStatus,
    reviewerId: 'local-dev',
    ...(reason !== undefined ? { reviewerNote: reason } : {}),
    ...(decision === 'modify'
      ? { resolutionInput: modifiedInput as Record<string, unknown> }
      : {}),
  });

  if (!writeResult.ok) {
    if (writeResult.reason === 'not_found') {
      return { ok: false, error: 'gate_not_found' };
    }
    return {
      ok: false,
      error: 'gate_already_resolved',
      status: writeResult.status,
    };
  }

  // Best-effort timeline event. If this fails the reviewer's decision is
  // still the source of truth in the gate row; the SDK side will see the
  // resolved gate via Inngest and proceed.
  try {
    await appendTaskEventAuto({
      runId: gate.runId,
      taskId: gate.taskId,
      type: 'approval_request',
      payload: {
        subtype: 'resolved',
        gate_id: gateId,
        decision: newStatus,
        reason: reason ?? null,
        modified_input: decision === 'modify' ? modifiedInput : null,
      },
    });
  } catch (err) {
    console.error(
      `[resolveApproval] appendTaskEventAuto failed for gate ${gateId}:`,
      err,
    );
  }

  // Best-effort wake the SDK. If the broker is down we log but still
  // return ok — the gate row is the durable record.
  try {
    await inngest.send({
      name: APPROVAL_DECIDED,
      data: {
        gateId,
        approved: decision !== 'deny',
        reason: reason ?? null,
        modifiedInput:
          decision === 'modify'
            ? (modifiedInput as Record<string, unknown>)
            : null,
      },
    });
  } catch (err) {
    console.error(
      `[resolveApproval] inngest.send failed for gate ${gateId}:`,
      err,
    );
  }

  revalidatePath(`/tasks/${gate.taskId}`);
  return { ok: true, gateId, status: newStatus };
}
