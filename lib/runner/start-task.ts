import { runOrchestrator } from '@/lib/agent/runtime';
import { finalizeTask } from '@/db/queries/task-runtime';

export type StartTaskArgs = {
  taskId: string;
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
};

/**
 * Kick off the orchestrator for an existing queued task. Fire-and-forget:
 * the caller (POST /api/tasks) returns immediately. The underlying promise
 * runs to completion in the same Node process.
 *
 * On rejection we best-effort finalize the task to `failed` so the UI's SSE
 * stream gets a terminal signal instead of polling forever.
 *
 * PHASE-06 LIMITATION: in Turbopack dev, hot-reload during an in-flight run
 * will kill the process — the task row will be left `in_progress` with no
 * terminal event. Phase 07's Inngest integration fixes this by moving the
 * run into a durable workflow.
 */
export function startTask(args: StartTaskArgs): void {
  void Promise.resolve()
    .then(() =>
      runOrchestrator({
        taskId: args.taskId,
        prompt: args.prompt,
        maxBudgetUsd: args.maxBudgetUsd,
        maxTurns: args.maxTurns,
        createdBy: 'http',
      }),
    )
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[start-task] taskId=${args.taskId} runner rejected: ${message}`,
      );
      try {
        await finalizeTask({ taskId: args.taskId, status: 'failed' });
      } catch (finalizeErr) {
        const fmsg =
          finalizeErr instanceof Error
            ? finalizeErr.message
            : String(finalizeErr);
        console.error(
          `[start-task] taskId=${args.taskId} finalize-to-failed also failed: ${fmsg}`,
        );
      }
    });
}
