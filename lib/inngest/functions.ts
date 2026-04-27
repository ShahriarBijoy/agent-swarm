import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memoryCleanupRuns, memoryCleanupProposals } from '@/db/schema/cleanup';
import { selectCleanupCandidates } from '@/db/queries/cleanup-candidates';
import { applyVerdicts, type Verdict } from '@/db/queries/cleanup-apply';
import { expireTombstones } from '@/db/queries/memory-lifecycle';
import { runDebate } from '@/lib/cleanup/debate';
import { CostCapExceededError } from '@/lib/cleanup/errors';
import { MAX_RUN_USD } from '@/lib/cleanup/cost-tracker';
import { runAgentSdkCall } from '@/lib/cleanup/llm';
import type { Action } from '@/lib/cleanup/schemas';
import { inngest } from './client';
import { CLEANUP_REQUESTED, TASK_STARTED } from './events';
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

const STALE_RUN_HOURS = 1;

/**
 * Phase-09 nightly cleanup. Two triggers fan into one body:
 *   - cron `0 3 * * *` (UTC) — production schedule (dormant pre-phase-12)
 *   - event auto-ride/cleanup.requested — manual / CLI trigger
 *
 * 8 step.run boundaries; each model call's cost is returned in the step
 * output so Inngest replay reconstructs the running total deterministically.
 *
 * Cron trigger skips silently if a successful run already exists today.
 * Manual trigger always proceeds.
 */
export const memoryCleanupFn = inngest.createFunction(
  {
    id: 'memory-cleanup',
    name: 'Memory cleanup — nightly debate',
    concurrency: { limit: 1 },
  },
  [
    { cron: '0 3 * * *' },
    { event: CLEANUP_REQUESTED },
  ],
  async ({ event, step, logger }) => {
    const triggeredByCron = event === undefined || event.name !== CLEANUP_REQUESTED;

    // Step 0: cron kill switch (outside step.run — pure check, idempotent).
    // Manual triggers via auto-ride/cleanup.requested bypass the flag so
    // ad-hoc demos can run while the production cron is disabled.
    if (triggeredByCron && process.env.MEMORY_CLEANUP_CRON_ENABLED === 'false') {
      logger.info('[cleanup] cron disabled by MEMORY_CLEANUP_CRON_ENABLED=false');
      return { skipped: true, reason: 'env-flag' as const };
    }

    // Same-day idempotency: cron skips on duplicate; manual proceeds.
    if (triggeredByCron) {
      const dupe = await step.run('check-same-day-completed', async () => {
        const result = (await db.execute(sql`
          SELECT 1 AS hit FROM memory_cleanup_runs
          WHERE started_at >= date_trunc('day', now())
            AND status = 'completed'
          LIMIT 1
        `)) as unknown as { rows: Array<{ hit: number }> };
        return result.rows.length > 0;
      });
      if (dupe) {
        logger.info('[cleanup] cron skipped — already completed today');
        return { skipped: true, reason: 'already-ran-today' as const };
      }
    }

    // Stale-run finalizer: flip stuck rows so dashboards stay sane.
    await step.run('stale-finalizer', async () => {
      await db.execute(sql`
        UPDATE memory_cleanup_runs
        SET status = 'failed',
            completed_at = now(),
            error = 'stale (no closeRun within ' || ${STALE_RUN_HOURS} || 'h)'
        WHERE status = 'running'
          AND started_at < now() - (${STALE_RUN_HOURS} * interval '1 hour')
      `);
    });

    // Step 1: open run row
    const runId = await step.run('open-run', async () => {
      const [row] = await db
        .insert(memoryCleanupRuns)
        .values({ status: 'running' })
        .returning({ id: memoryCleanupRuns.id });
      return row!.id;
    });

    // Step 2: candidate selection
    const candidates = await step.run('select-candidates', async () => {
      return selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    });

    if (candidates.length === 0) {
      await step.run('close-run-empty', async () => {
        await db
          .update(memoryCleanupRuns)
          .set({
            status: 'completed',
            completedAt: new Date(),
            candidatesConsidered: 0,
          })
          .where(eqCleanupRunId(runId));
      });
      await step.run('expire-tombstones', async () => expireTombstones());
      return { runId, candidates: 0, applied: 0 };
    }

    // Steps 3–5: debate (Consolidator → Adversary → Judge)
    let debateResult;
    try {
      debateResult = await step.run('debate', async () => {
        return runDebate({ candidates, llm: runAgentSdkCall, maxRunUsd: MAX_RUN_USD });
      });
    } catch (err) {
      const message = err instanceof CostCapExceededError ? err.message : String(err);
      await step.run('close-run-failed', async () => {
        await db
          .update(memoryCleanupRuns)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: message,
            candidatesConsidered: candidates.length,
          })
          .where(eqCleanupRunId(runId));
      });
      throw err;
    }

    // Persist proposals before apply (so audit trail exists even if apply crashes)
    await step.run('persist-proposals', async () => {
      if (debateResult.proposals.length === 0) return;
      await db.insert(memoryCleanupProposals).values(
        debateResult.proposals.map((p) => ({
          runId,
          memoryId: p.memoryId,
          targetMemoryId: p.targetMemoryId,
          action: p.consolidator.action,
          finalAction: p.finalAction,
          consolidator: p.consolidator,
          adversary: p.adversary,
          judge: p.judge,
        })),
      );
    });

    // Step 6: apply verdicts (re-fetch proposalIds from DB so we have the row UUIDs)
    const applyResult = await step.run('apply-verdicts', async () => {
      const inserted = await db
        .select({
          id: memoryCleanupProposals.id,
          memoryId: memoryCleanupProposals.memoryId,
          targetMemoryId: memoryCleanupProposals.targetMemoryId,
          finalAction: memoryCleanupProposals.finalAction,
        })
        .from(memoryCleanupProposals)
        .where(sql`${memoryCleanupProposals.runId} = ${runId}::uuid`);

      // 'promote' lives in cleanupActionEnum for phase-04's deterministic
      // streak path; the debate pipeline never emits it, so exclude it here
      // (and keep the Action type narrow as 'prune'|'merge'|'keep').
      const verdicts: Verdict[] = inserted
        .filter(
          (r): r is typeof r & { finalAction: Action } =>
            r.finalAction !== null && r.finalAction !== 'promote',
        )
        .map((r) => ({
          proposalId: r.id,
          memoryId: r.memoryId,
          targetMemoryId: r.targetMemoryId,
          finalAction: r.finalAction,
        }));
      return applyVerdicts(verdicts);
    });

    // Step 7: expire tombstones older than 14 days (reuse phase 04 helper)
    await step.run('expire-tombstones', async () => expireTombstones());

    // Step 8: close run
    await step.run('close-run', async () => {
      await db
        .update(memoryCleanupRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          candidatesConsidered: candidates.length,
          proposalsGenerated: debateResult.proposalsGenerated,
          proposalsContested: debateResult.proposalsContested,
          proposalsJudged: debateResult.proposalsJudged,
          costUsd: String(debateResult.costUsd.toFixed(4)),
        })
        .where(eqCleanupRunId(runId));
    });

    return {
      runId,
      candidates: candidates.length,
      proposalsGenerated: debateResult.proposalsGenerated,
      applied: applyResult.applied,
      costUsd: debateResult.costUsd,
    };
  },
);

function eqCleanupRunId(id: string) {
  return sql`${memoryCleanupRuns.id} = ${id}::uuid`;
}
