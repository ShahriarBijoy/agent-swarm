import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

/**
 * Phase-07 runOrchestrator validation regressions:
 * - awaiting_approval is now a resumable state (Inngest function replay).
 * - Each entry creates a fresh task_runs row with a bumped attempt number.
 *
 * Tests stop before query() is invoked by mocking the SDK, so no Anthropic
 * credentials are required — only DB access.
 */

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-07 runOrchestrator resumability', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-07-resume-test';

  async function deleteTestTasks() {
    await rawSql`
      DELETE FROM task_events
      WHERE task_id IN (SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK})
    `;
    await rawSql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }

  beforeEach(deleteTestTasks);
  afterAll(async () => {
    await deleteTestTasks();
    await rawSql.end();
  });

  // Mock the SDK at module-level so query() resolves instantly with a single
  // result message. This keeps the test focused on the resume validation
  // path, not the SDK integration.
  vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
    return {
      query: ({ options: _options }: { options: unknown }) => {
        async function* mockStream() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'mock-session',
          } as never;
          yield {
            type: 'result',
            subtype: 'success',
            result: 'mock-final-text',
            total_cost_usd: 0,
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
            modelUsage: {},
            uuid: 'mock-uuid',
            session_id: 'mock-session',
          } as never;
        }
        return mockStream();
      },
    };
  });

  it('admits awaiting_approval as a resumable state', async () => {
    const { createQueuedTask } = await import('@/db/queries/task-api');
    const { id } = await createQueuedTask({
      prompt: 'paused at gate',
      metadata: { test_id: TEST_MARK },
    });
    await rawSql`UPDATE tasks SET status = 'awaiting_approval' WHERE id = ${id}`;

    const { runOrchestrator } = await import('@/lib/agent/runtime');
    const result = await runOrchestrator({ taskId: id, prompt: 'resume' });

    expect(result.status).toBe('done');
    const [task] = await rawSql<Array<{ status: string }>>`
      SELECT status FROM tasks WHERE id = ${id}
    `;
    expect(task!.status).toBe('done');
  });

  it('bumps task_runs.attempt on a re-entry into the same task', async () => {
    const { createQueuedTask } = await import('@/db/queries/task-api');
    const { id } = await createQueuedTask({
      prompt: 'replay me',
      metadata: { test_id: TEST_MARK },
    });

    const { runOrchestrator } = await import('@/lib/agent/runtime');
    // First entry — creates attempt=1.
    await runOrchestrator({ taskId: id, prompt: 'first' });
    // Force back to a resumable state for the second entry.
    await rawSql`UPDATE tasks SET status = 'awaiting_approval', completed_at = NULL WHERE id = ${id}`;
    // Second entry — must pick attempt=2.
    await runOrchestrator({ taskId: id, prompt: 'second' });

    const rows = await rawSql<
      Array<{ attempt: number }>
    >`SELECT attempt FROM task_runs WHERE task_id = ${id} ORDER BY attempt ASC`;
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);
  });
});
