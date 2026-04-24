import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

// These tests exercise runOrchestrator's *validation* of the new `taskId`
// argument (phase 06). They deliberately stop before query() is called, so
// they don't need Anthropic credentials — only DB access for getTaskById.

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-06 runOrchestrator taskId validation', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-06-taskid-test';

  async function deleteTestTasks() {
    await rawSql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }

  beforeEach(deleteTestTasks);
  afterAll(async () => {
    await deleteTestTasks();
    await rawSql.end();
  });

  it('throws when taskId does not exist', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    await expect(
      runOrchestrator({
        taskId: '00000000-0000-4000-8000-000000000000',
        prompt: 'ignored',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('throws when task is in a terminal state (done)', async () => {
    const { createQueuedTask } = await import('@/db/queries/task-api');
    const { id } = await createQueuedTask({
      prompt: 'already done',
      metadata: { test_id: TEST_MARK },
    });
    await rawSql`UPDATE tasks SET status = 'done' WHERE id = ${id}`;

    const { runOrchestrator } = await import('@/lib/agent/runtime');
    await expect(
      runOrchestrator({ taskId: id, prompt: 'ignored' }),
    ).rejects.toThrow(/is done, cannot run/);
  });

  it('throws when task is in a terminal state (failed)', async () => {
    const { createQueuedTask } = await import('@/db/queries/task-api');
    const { id } = await createQueuedTask({
      prompt: 'already failed',
      metadata: { test_id: TEST_MARK },
    });
    await rawSql`UPDATE tasks SET status = 'failed' WHERE id = ${id}`;

    const { runOrchestrator } = await import('@/lib/agent/runtime');
    await expect(
      runOrchestrator({ taskId: id, prompt: 'ignored' }),
    ).rejects.toThrow(/is failed, cannot run/);
  });

  it('throws when task is cancelled', async () => {
    const { createQueuedTask } = await import('@/db/queries/task-api');
    const { id } = await createQueuedTask({
      prompt: 'cancelled',
      metadata: { test_id: TEST_MARK },
    });
    await rawSql`UPDATE tasks SET status = 'cancelled' WHERE id = ${id}`;

    const { runOrchestrator } = await import('@/lib/agent/runtime');
    await expect(
      runOrchestrator({ taskId: id, prompt: 'ignored' }),
    ).rejects.toThrow(/is cancelled, cannot run/);
  });
});
