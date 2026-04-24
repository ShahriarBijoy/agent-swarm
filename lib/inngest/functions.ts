import { inngest } from './client';
import { TASK_STARTED } from './events';
import { runOrchestrator } from '@/lib/agent/runtime';
import { createCanUseTool, type DurableStep } from '@/lib/agent/approvals';

/**
 * Phase-07 task runner. Triggered by `auto-ride/task.started`, which the
 * `POST /api/tasks` route emits via `inngest.send`. Calls runOrchestrator
 * with a canUseTool factory that closes over Inngest's `step` so the SDK
 * can wait durably on `auto-ride/approval.decided`.
 *
 * Concurrency note: limited to 1-per-taskId so a duplicate event (retry
 * storm, manual replay) can't spawn parallel runs on the same row.
 *
 * Replay note: if the worker dies and Inngest retries the function, the
 * SDK call restarts from the top. The gate row, the SSE timeline events,
 * and the durable wait survive — see design §12 risk 6 for the trade-off.
 */
export const taskStartedFn = inngest.createFunction(
  {
    id: 'task-started',
    name: 'Task started — run orchestrator',
    concurrency: { limit: 1, key: 'event.data.taskId' },
  },
  { event: TASK_STARTED },
  async ({ event, step }) => {
    const { taskId, prompt, maxBudgetUsd, maxTurns } = event.data;

    const result = await runOrchestrator({
      taskId,
      prompt,
      ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      createdBy: 'inngest',
      canUseToolFactory: (runId) =>
        createCanUseTool({
          taskId,
          runId,
          step: step as unknown as DurableStep,
        }),
    });

    return {
      taskId: result.taskId,
      runId: result.runId,
      status: result.status,
      totalCostUsd: result.totalCostUsd,
      finalText: result.finalText,
    };
  },
);
