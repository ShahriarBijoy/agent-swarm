import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { taskEvents, taskRuns, tasks } from '@/db/schema';
import { runOrchestrator } from '@/lib/agent/runtime';

// UN-SKIP LOCALLY BEFORE MERGING PHASE 05.
//
// Required env:
//   DATABASE_URL, DATABASE_URL_UNPOOLED, GEMINI_API_KEY (from .env.local)
//   + one of: CLAUDE_CODE_OAUTH_TOKEN | ANTHROPIC_API_KEY | (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)
//
// Cost: ≤ $0.10 per invocation via maxBudgetUsd; typical $0.01–0.03.
// This test runs exactly one short Haiku round-trip with tight caps.

describe.skip('[live] Haiku round-trip', () => {
  it(
    'runs one query() end-to-end, writes contiguous task_events, cleans up',
    async () => {
      const result = await runOrchestrator({
        prompt: 'Say the single word "ok" and nothing else.',
        maxBudgetUsd: 0.1,
        maxTurns: 3,
        maxThinkingTokens: 1024,
        createdBy: 'test-live',
      });

      try {
        expect(result.status).toBe('done');
        expect(result.sessionId).toBeTruthy();
        expect(result.totalCostUsd).toBeGreaterThan(0);

        const runRow = await db
          .select()
          .from(taskRuns)
          .where(eq(taskRuns.id, result.runId))
          .limit(1);
        expect(runRow[0]?.sessionId).toBe(result.sessionId);
        expect(Number(runRow[0]?.totalCostUsd ?? '0')).toBeCloseTo(result.totalCostUsd, 3);
        expect(runRow[0]?.endedAt).toBeInstanceOf(Date);

        const events = await db
          .select({ seq: taskEvents.seq, type: taskEvents.type })
          .from(taskEvents)
          .where(eq(taskEvents.runId, result.runId))
          .orderBy(taskEvents.seq);

        expect(events.length).toBeGreaterThanOrEqual(3);

        const types = events.map((e) => e.type);
        expect(types).toContain('user_message');
        expect(types).toContain('assistant_turn');
        expect(types.filter((t) => t === 'run_result')).toHaveLength(1);

        // Contiguous seq from 0.
        events.forEach((e, i) => {
          expect(e.seq).toBe(i);
        });
      } finally {
        await db.delete(taskEvents).where(eq(taskEvents.runId, result.runId));
        await db.delete(taskRuns).where(eq(taskRuns.id, result.runId));
        await db.delete(tasks).where(eq(tasks.id, result.taskId));
      }
    },
    120_000,
  );
});
