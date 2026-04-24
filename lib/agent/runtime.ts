import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadAgentAuthEnv, type AgentAuthEnv } from '@/lib/env';
import {
  appendTaskEvent,
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
  mapMessageToEvents,
  type TaskEventInput,
} from '@/lib/agent/persist';

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
  // Validate taskId first (cheap DB read) before touching auth, so a bad
  // taskId throws the actionable "not found" / "terminal state" error
  // regardless of whether Anthropic creds are configured.
  let taskId: string;
  if (args.taskId) {
    const existing = await getTaskById(args.taskId);
    if (!existing) {
      throw new Error(`runOrchestrator: task ${args.taskId} not found`);
    }
    if (existing.status !== 'queued' && existing.status !== 'in_progress') {
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
  };
  const options = buildOrchestratorOptions(overrides);

  let seq = 0;
  let sessionId: string | null = null;
  let sawResult = false;
  let resultSuccess = false;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let numTurns = 0;
  let finalText: string | null = null;
  let errorText: string | null = null;

  try {
    for await (const msg of query({ prompt: args.prompt, options })) {
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
      for (const ev of events) {
        await appendTaskEvent({ runId, taskId, seq, type: ev.type, payload: ev.payload });
        const persisted: PersistedEvent = { ...ev, seq };
        safeCallback(() => args.onEvent?.(persisted));
        seq += 1;
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
