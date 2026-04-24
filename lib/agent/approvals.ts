import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import {
  expireGate as defaultExpireGate,
  markTaskAwaitingApproval as defaultMarkTaskAwaitingApproval,
  markTaskResumed as defaultMarkTaskResumed,
  openGate as defaultOpenGate,
} from '@/db/queries/approval-gates';
import { appendTaskEventAuto as defaultAppendTaskEventAuto } from '@/db/queries/task-runtime';
import { shouldRequireApproval } from '@/lib/agent/approval-policy';

/**
 * Subset of Inngest's `step` API consumed by the canUseTool callback.
 *
 * Defined structurally so this module doesn't import from `inngest` directly
 * — keeps the unit test (`tests/approvals-canusetool.test.ts`) entirely
 * dependency-free and lets the real Inngest `Step` type satisfy this
 * interface by structural compatibility.
 */
export interface DurableStep {
  waitForEvent<TName extends string>(
    id: string,
    opts: {
      event: TName;
      timeout: string;
      if?: string;
    },
  ): Promise<{ name: TName; data: Record<string, unknown> } | null>;
}

/**
 * Decision payload broadcast by the Server Action. The runtime side branches
 * on these three fields. Kept loose (`Record<string, unknown>`) at the wire
 * boundary; refined here.
 */
export type ApprovalDecidedPayload = {
  gateId: string;
  approved: boolean;
  reason?: string | null;
  modifiedInput?: Record<string, unknown> | null;
};

/**
 * Test seam: the small set of side-effects createCanUseTool performs.
 * Production callers pass nothing; tests inject fakes.
 */
export type CanUseToolDeps = {
  openGate?: typeof defaultOpenGate;
  expireGate?: typeof defaultExpireGate;
  markTaskAwaitingApproval?: typeof defaultMarkTaskAwaitingApproval;
  markTaskResumed?: typeof defaultMarkTaskResumed;
  appendTaskEventAuto?: typeof defaultAppendTaskEventAuto;
  generateGateId?: () => string;
};

export type CanUseToolContext = {
  taskId: string;
  runId: string;
  step: DurableStep;
  deps?: CanUseToolDeps;
};

/**
 * Builds the SDK's `canUseTool` callback for one orchestrator run.
 *
 * Lifecycle for one gated tool call:
 *   1. shouldRequireApproval rules out the easy cases (allow immediately).
 *   2. Insert an approval_gates row with status=pending and emit a
 *      `task_events` row of type `approval_request` (subtype: 'opened') so
 *      the SSE timeline lights up.
 *   3. Flip the task to `awaiting_approval`.
 *   4. step.waitForEvent('auto-ride/approval.decided', timeout='24h') — the
 *      Inngest step is durable, so a redeploy mid-wait does not lose the
 *      pause; on replay the function picks up at this exact line.
 *   5. On decision: flip the task back to in_progress and translate the
 *      payload into the SDK's PermissionResult.
 *   6. On timeout (waitForEvent returns null): flip the gate to timed_out,
 *      return deny with a clear message so the orchestrator can react.
 */
export function createCanUseTool(ctx: CanUseToolContext): CanUseTool {
  const deps: Required<CanUseToolDeps> = {
    openGate: ctx.deps?.openGate ?? defaultOpenGate,
    expireGate: ctx.deps?.expireGate ?? defaultExpireGate,
    markTaskAwaitingApproval:
      ctx.deps?.markTaskAwaitingApproval ?? defaultMarkTaskAwaitingApproval,
    markTaskResumed: ctx.deps?.markTaskResumed ?? defaultMarkTaskResumed,
    appendTaskEventAuto:
      ctx.deps?.appendTaskEventAuto ?? defaultAppendTaskEventAuto,
    generateGateId: ctx.deps?.generateGateId ?? (() => crypto.randomUUID()),
  };

  return async (toolName, input, { signal }) => {
    const hint = shouldRequireApproval(toolName, input);
    if (!hint.require) {
      return { behavior: 'allow' } satisfies PermissionResult;
    }

    if (signal.aborted) {
      return {
        behavior: 'deny',
        message: 'Run aborted before approval gate opened.',
      } satisfies PermissionResult;
    }

    const gateId = deps.generateGateId();

    await deps.openGate({
      id: gateId,
      runId: ctx.runId,
      taskId: ctx.taskId,
      toolName,
      proposedInput: input,
    });

    await deps.appendTaskEventAuto({
      runId: ctx.runId,
      taskId: ctx.taskId,
      type: 'approval_request',
      payload: {
        subtype: 'opened',
        gate_id: gateId,
        tool_name: toolName,
        proposed_input: input as Record<string, unknown>,
        reason: hint.reason,
      },
    });

    await deps.markTaskAwaitingApproval(ctx.taskId);

    const decision = await ctx.step.waitForEvent(`approval-${gateId}`, {
      event: 'auto-ride/approval.decided',
      timeout: '24h',
      if: `async.data.gateId == "${gateId}"`,
    });

    if (signal.aborted) {
      return {
        behavior: 'deny',
        message: 'Run aborted while waiting for approval.',
      } satisfies PermissionResult;
    }

    if (decision === null) {
      await deps.expireGate(gateId);
      return {
        behavior: 'deny',
        message: 'Approval timed out after 24h.',
      } satisfies PermissionResult;
    }

    // The Server Action already wrote the gate row + 'resolved' task_event
    // before sending the Inngest event, so by the time we land here the DB
    // is consistent. We only need to flip the task back to in_progress and
    // translate the decision into a PermissionResult.
    const data = decision.data as ApprovalDecidedPayload;
    await deps.markTaskResumed(ctx.taskId);

    if (!data.approved) {
      return {
        behavior: 'deny',
        message: data.reason?.trim() || 'Denied by reviewer.',
      } satisfies PermissionResult;
    }

    if (data.modifiedInput && typeof data.modifiedInput === 'object') {
      return {
        behavior: 'allow',
        updatedInput: data.modifiedInput,
      } satisfies PermissionResult;
    }

    return { behavior: 'allow' } satisfies PermissionResult;
  };
}

/**
 * Phase-07 streaming-input migration: `canUseTool` only fires when the SDK
 * is in streaming-input mode, which requires the `prompt` argument to
 * `query()` to be an AsyncIterable<SDKUserMessage>. The orchestrator passes
 * a single user message and lets the SDK's internal turn-loop handle the
 * rest, so this generator yields exactly once and completes.
 *
 * Exported so unit tests can assert on the yielded shape.
 */
export async function* userPromptStream(
  text: string,
): AsyncGenerator<UserPromptYield> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  };
}

export type UserPromptYield = {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
};
