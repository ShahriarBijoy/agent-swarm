import { inngest } from '@/lib/inngest/client';
import { TASK_STARTED, taskStartedSchema } from '@/lib/inngest/events';

export type StartTaskArgs = {
  taskId: string;
  prompt: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
};

/**
 * Phase-07: dispatch the orchestrator via an Inngest event. The event broker
 * keeps the work durable across server restarts — Turbopack hot-reload, pod
 * recycle, deploy — so the runner that the phase-06 fire-and-forget Promise
 * could lose to a process kill is now resumable from Inngest's store.
 *
 * Returns once the event is accepted by Inngest. The actual orchestrator
 * execution happens inside the registered `taskStartedFn` which is hosted
 * by `app/api/inngest/route.ts`.
 *
 * The caller (`POST /api/tasks`) wraps this in try/catch + finalizeTask so
 * a broker outage still terminates the SSE stream cleanly.
 */
export async function startTask(args: StartTaskArgs): Promise<void> {
  const data = taskStartedSchema.parse({
    taskId: args.taskId,
    prompt: args.prompt,
    ...(args.maxBudgetUsd !== undefined
      ? { maxBudgetUsd: args.maxBudgetUsd }
      : {}),
    ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
  });

  await inngest.send({ name: TASK_STARTED, data });
}
