import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadAgentAuthEnv, type AgentAuthEnv } from '@/lib/env';
import {
  appendTaskEventAuto,
  createTask,
  createTaskRun,
  finalizeRun,
  finalizeTask,
  updateTaskRunSession,
} from '@/db/queries/task-runtime';
import { getTaskById, markTaskInProgress } from '@/db/queries/task-api';
import {
  buildOrchestratorOptions,
  type BuildOrchestratorOptionsOverrides,
} from '@/lib/agent/options';
import {
  extractAgentToolUseMapping,
  getMessageParentToolUseId,
  injectSoftBudget,
  mapMessageToEvents,
  tagAgentName,
  type TaskEventInput,
} from '@/lib/agent/persist';
import { userPromptStream } from '@/lib/agent/approvals';
import { buildDispatcherPrompt } from '@/lib/agent/dispatcher-prompt';
import { AGENT_SOFT_BUDGET_USD } from '@/lib/agent/agents';

export type RunOrchestratorArgs = {
  prompt: string;
  /**
   * Phase-06 HTTP path: pass an existing `queued` task's id and the runner
   * will transition it to `in_progress` and reuse the row. If omitted
   * (phase-05 CLI path), a fresh `tasks` row is created with status
   * `in_progress`. Non-breaking: existing callers keep working.
   */
  taskId?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  createdBy?: string;
  cwd?: string;
  /** Fires once per persisted event. Errors are swallowed so stdout issues can't abort the run. */
  onEvent?: (event: PersistedEvent) => void;
  /** Fires once when the SDKSystemMessage init arrives. */
  onSessionStart?: (sessionId: string) => void;
  /**
   * Phase-07 HITL. Factory takes the freshly-minted runId so the canUseTool
   * callback can persist gates keyed to it. Undefined = allow-all (phase-05
   * CLI path), so the existing `pnpm query:demo` script keeps working.
   */
  canUseToolFactory?: (runId: string) => CanUseTool;
};

export type PersistedEvent = TaskEventInput & { seq: number };

export type RunOrchestratorResult = {
  taskId: string;
  runId: string;
  sessionId: string | null;
  status: 'done' | 'failed';
  totalCostUsd: number;
  numTurns: number;
  finalText: string | null;
  errorText: string | null;
  auth: AgentAuthEnv['kind'];
};

export async function runOrchestrator(
  args: RunOrchestratorArgs,
): Promise<RunOrchestratorResult> {
  // Validate taskId first (cheap DB read) before touching auth.
  let taskId: string;
  if (args.taskId) {
    const existing = await getTaskById(args.taskId);
    if (!existing) {
      throw new Error(`runOrchestrator: task ${args.taskId} not found`);
    }
    // Phase 07 admits `awaiting_approval` for the Inngest-replay path: if the
    // worker dies between step boundaries, Inngest re-invokes the function;
    // the function re-enters runOrchestrator on a task whose canUseTool
    // callback put it into awaiting_approval. We pull it back to in_progress
    // and let the SDK rebuild the conversation. Phase 12's sandbox process
    // is what makes this seamless; for now it's documented in the design
    // spec as a dev-only wrinkle.
    const isResumable =
      existing.status === 'queued' ||
      existing.status === 'in_progress' ||
      existing.status === 'awaiting_approval';
    if (!isResumable) {
      throw new Error(
        `runOrchestrator: task ${args.taskId} is ${existing.status}, cannot run`,
      );
    }
    await markTaskInProgress(args.taskId);
    taskId = args.taskId;
  } else {
    const { id } = await createTask({
      prompt: args.prompt,
      maxBudgetUsd: args.maxBudgetUsd,
      maxTurns: args.maxTurns,
      createdBy: args.createdBy ?? 'cli',
    });
    taskId = id;
  }

  const auth = loadAgentAuthEnv();

  const { id: runId } = await createTaskRun({ taskId });

  const overrides: BuildOrchestratorOptionsOverrides = {
    ...(args.maxBudgetUsd !== undefined ? { maxBudgetUsd: args.maxBudgetUsd } : {}),
    ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
    ...(args.maxThinkingTokens !== undefined
      ? { maxThinkingTokens: args.maxThinkingTokens }
      : {}),
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    ...(args.canUseToolFactory
      ? { canUseTool: args.canUseToolFactory(runId) }
      : {}),
  };
  const options = buildOrchestratorOptions(overrides);

  let sessionId: string | null = null;
  let sawResult = false;
  let resultSuccess = false;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let numTurns = 0;
  let finalText: string | null = null;
  let errorText: string | null = null;

  // Phase-08 §6.1 — derive `payload.agent_name` from the SDK's
  // `parent_tool_use_id` chain. Map populated when we see an `Agent`
  // tool_call event; consumed when tagging downstream events whose
  // parent_tool_use_id matches.
  const agentByToolUseId = new Map<string, string>();

  try {
    // Phase 07: streaming-input mode. The SDK requires an AsyncIterable<
    // SDKUserMessage> as `prompt` whenever `canUseTool` is set; we pass the
    // single-message generator unconditionally so the contract is uniform.
    for await (const msg of query({
      prompt: userPromptStream(buildDispatcherPrompt(args.prompt)),
      options,
    })) {
      if (isInitMessage(msg)) {
        sessionId = msg.session_id;
        await updateTaskRunSession({ runId, sessionId });
        safeCallback(() => args.onSessionStart?.(sessionId as string));
        continue;
      }

      if (msg.type === 'result') {
        sawResult = true;
        resultSuccess = msg.subtype === 'success';
        totalCostUsd = msg.total_cost_usd;
        totalInputTokens = msg.usage.input_tokens ?? 0;
        totalOutputTokens = msg.usage.output_tokens ?? 0;
        numTurns = msg.num_turns;
        if (msg.subtype === 'success') {
          finalText = msg.result;
        } else {
          errorText = (msg.errors ?? ['unknown error']).join('; ');
        }
      }

      const events = mapMessageToEvents(msg);
      const parentToolUseId = getMessageParentToolUseId(msg);
      for (const ev of events) {
        // Step 1: capture the dispatcher → worker mapping the moment we
        // see the Agent tool_call (before we tag downstream events that
        // will reference its tool_use_id).
        const mapping = extractAgentToolUseMapping(ev);
        if (mapping) {
          agentByToolUseId.set(mapping.toolUseId, mapping.agentName);
        }

        // Step 2: tag with `agent_name`, then attach `soft_budget_usd`
        // when the event is the dispatcher's Agent tool_call (no-op for
        // every other event).
        const tagged = tagAgentName(ev, parentToolUseId, agentByToolUseId);
        const augmented = injectSoftBudget(tagged, AGENT_SOFT_BUDGET_USD);

        // Phase 07: appendTaskEventAuto computes seq atomically so the
        // canUseTool callback (separate writer) and the Server Action that
        // resolves a gate (third writer) never collide on (run_id, seq).
        const written = await appendTaskEventAuto({
          runId,
          taskId,
          type: augmented.type,
          payload: augmented.payload,
        });
        const persisted: PersistedEvent = { ...augmented, seq: written.seq };
        safeCallback(() => args.onEvent?.(persisted));
      }
    }

    if (!sawResult) {
      resultSuccess = false;
      errorText ??= 'query ended without SDKResultMessage';
    }

    const status: 'done' | 'failed' = resultSuccess ? 'done' : 'failed';
    await finalizeRun({
      runId,
      status,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      error: errorText,
    });
    await finalizeTask({ taskId, status });

    return {
      taskId,
      runId,
      sessionId,
      status,
      totalCostUsd,
      numTurns,
      finalText,
      errorText,
      auth: auth.kind,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bestEffortFinalize(runId, taskId, message, totalCostUsd, totalInputTokens, totalOutputTokens);
    throw err;
  }
}

function isInitMessage(
  msg: SDKMessage,
): msg is Extract<SDKMessage, { type: 'system'; subtype: 'init' }> {
  return msg.type === 'system' && msg.subtype === 'init';
}

function safeCallback(fn: () => void): void {
  try {
    fn();
  } catch {
    // Callback errors (e.g. stdout EPIPE) must not abort the run.
  }
}

async function bestEffortFinalize(
  runId: string,
  taskId: string,
  error: string,
  cost: number,
  inTokens: number,
  outTokens: number,
): Promise<void> {
  try {
    await finalizeRun({
      runId,
      status: 'failed',
      totalCostUsd: cost,
      totalInputTokens: inTokens,
      totalOutputTokens: outTokens,
      error,
    });
    await finalizeTask({ taskId, status: 'failed' });
  } catch {
    // Swallow — the caller will see the original throw.
  }
}
