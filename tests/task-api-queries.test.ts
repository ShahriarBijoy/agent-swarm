import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-06 task-api queries', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-06-api-test';

  async function deleteTestTasks() {
    // task_events.task_id FK has no ON DELETE CASCADE (only run_id does),
    // so we clear task_events first, then let the tasks → task_runs cascade
    // handle the rest.
    await rawSql`
      DELETE FROM task_events
      WHERE task_id IN (
        SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}
      )
    `;
    await rawSql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }

  beforeEach(deleteTestTasks);
  afterAll(async () => {
    await deleteTestTasks();
    await rawSql.end();
  });

  describe('createQueuedTask', () => {
    it('inserts with status=queued and returns {id, createdAt}', async () => {
      const { createQueuedTask } = await import('@/db/queries/task-api');
      const { id, createdAt } = await createQueuedTask({
        prompt: 'hello',
        createdBy: 'test',
        metadata: { test_id: TEST_MARK },
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(createdAt).toBeInstanceOf(Date);

      const [row] = await rawSql<
        Array<{ status: string; created_by: string; prompt: string }>
      >`
        SELECT status, created_by, prompt FROM tasks WHERE id = ${id}
      `;
      expect(row!.status).toBe('queued');
      expect(row!.created_by).toBe('test');
      expect(row!.prompt).toBe('hello');
    });

    it('persists maxBudgetUsd and maxTurns when provided', async () => {
      const { createQueuedTask } = await import('@/db/queries/task-api');
      const { id } = await createQueuedTask({
        prompt: 'caps',
        maxBudgetUsd: 0.25,
        maxTurns: 10,
        metadata: { test_id: TEST_MARK },
      });
      const [row] = await rawSql<
        Array<{ max_budget_usd: string; max_turns: number }>
      >`SELECT max_budget_usd, max_turns FROM tasks WHERE id = ${id}`;
      expect(row!.max_budget_usd).toBe('0.2500');
      expect(row!.max_turns).toBe(10);
    });

    it('defaults createdBy to "http"', async () => {
      const { createQueuedTask } = await import('@/db/queries/task-api');
      const { id } = await createQueuedTask({
        prompt: 'default',
        metadata: { test_id: TEST_MARK },
      });
      const [row] = await rawSql<Array<{ created_by: string }>>`
        SELECT created_by FROM tasks WHERE id = ${id}
      `;
      expect(row!.created_by).toBe('http');
    });
  });

  describe('markTaskInProgress', () => {
    it('transitions queued → in_progress', async () => {
      const { createQueuedTask, markTaskInProgress } = await import(
        '@/db/queries/task-api'
      );
      const { id } = await createQueuedTask({
        prompt: 'x',
        metadata: { test_id: TEST_MARK },
      });
      await markTaskInProgress(id);
      const [row] = await rawSql<Array<{ status: string }>>`
        SELECT status FROM tasks WHERE id = ${id}
      `;
      expect(row!.status).toBe('in_progress');
    });

    it('is idempotent on already in_progress', async () => {
      const { createQueuedTask, markTaskInProgress } = await import(
        '@/db/queries/task-api'
      );
      const { id } = await createQueuedTask({
        prompt: 'x',
        metadata: { test_id: TEST_MARK },
      });
      await markTaskInProgress(id);
      // second call should be a no-op — matcher filters on status=queued
      await markTaskInProgress(id);
      const [row] = await rawSql<Array<{ status: string }>>`
        SELECT status FROM tasks WHERE id = ${id}
      `;
      expect(row!.status).toBe('in_progress');
    });

    it('is a no-op on terminal states (done / failed)', async () => {
      const { createQueuedTask, markTaskInProgress } = await import(
        '@/db/queries/task-api'
      );
      const { id } = await createQueuedTask({
        prompt: 'x',
        metadata: { test_id: TEST_MARK },
      });
      // Force to 'done' via raw SQL.
      await rawSql`UPDATE tasks SET status = 'done' WHERE id = ${id}`;
      await markTaskInProgress(id);
      const [row] = await rawSql<Array<{ status: string }>>`
        SELECT status FROM tasks WHERE id = ${id}
      `;
      expect(row!.status).toBe('done'); // unchanged
    });
  });

  describe('getTaskById', () => {
    it('returns null for a missing task', async () => {
      const { getTaskById } = await import('@/db/queries/task-api');
      // UUID v4 format, random — astronomically unlikely to collide.
      const row = await getTaskById('00000000-0000-4000-8000-000000000000');
      expect(row).toBeNull();
    });

    it('returns the task row for an existing task', async () => {
      const { createQueuedTask, getTaskById } = await import(
        '@/db/queries/task-api'
      );
      const { id } = await createQueuedTask({
        prompt: 'fetch me',
        metadata: { test_id: TEST_MARK, nested: { deep: 'ok' } },
      });
      const row = await getTaskById(id);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(id);
      expect(row!.status).toBe('queued');
      expect(row!.prompt).toBe('fetch me');
      expect(row!.metadata).toMatchObject({
        test_id: TEST_MARK,
        nested: { deep: 'ok' },
      });
    });
  });

  describe('getEventsSince', () => {
    async function seedTaskWithEvents(
      count: number,
    ): Promise<{ taskId: string; runId: string; eventIds: bigint[] }> {
      const { createQueuedTask } = await import('@/db/queries/task-api');
      const { id: taskId } = await createQueuedTask({
        prompt: 'events',
        metadata: { test_id: TEST_MARK },
      });
      // Make a run.
      const [runRow] = await rawSql<Array<{ id: string }>>`
        INSERT INTO task_runs (task_id, attempt, status)
        VALUES (${taskId}, 1, 'in_progress')
        RETURNING id
      `;
      const runId = runRow!.id;
      const eventIds: bigint[] = [];
      for (let i = 0; i < count; i++) {
        const [ev] = await rawSql<Array<{ id: string }>>`
          INSERT INTO task_events (run_id, task_id, seq, type, payload)
          VALUES (${runId}, ${taskId}, ${i}, 'assistant_turn', ${rawSql.json({
          idx: i,
        })})
          RETURNING id
        `;
        eventIds.push(BigInt(ev!.id));
      }
      return { taskId, runId, eventIds };
    }

    it('returns all events for the task when afterId=0', async () => {
      const { getEventsSince } = await import('@/db/queries/task-api');
      const { taskId, eventIds } = await seedTaskWithEvents(3);
      const rows = await getEventsSince({ taskId, afterId: 0n });
      expect(rows.length).toBe(3);
      expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
      expect(rows.map((r) => r.id)).toEqual(eventIds);
    });

    it('returns only events with id > afterId', async () => {
      const { getEventsSince } = await import('@/db/queries/task-api');
      const { taskId, eventIds } = await seedTaskWithEvents(5);
      const after = eventIds[2]!;
      const rows = await getEventsSince({ taskId, afterId: after });
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.id > after)).toBe(true);
    });

    it('respects limit', async () => {
      const { getEventsSince } = await import('@/db/queries/task-api');
      const { taskId } = await seedTaskWithEvents(10);
      const rows = await getEventsSince({ taskId, afterId: 0n, limit: 4 });
      expect(rows.length).toBe(4);
    });

    it('returns [] for a task with no events', async () => {
      const { createQueuedTask, getEventsSince } = await import(
        '@/db/queries/task-api'
      );
      const { id: taskId } = await createQueuedTask({
        prompt: 'lonely',
        metadata: { test_id: TEST_MARK },
      });
      const rows = await getEventsSince({ taskId, afterId: 0n });
      expect(rows).toEqual([]);
    });
  });

  describe('listRecentTasks', () => {
    it('returns the most recent tasks ordered createdAt DESC', async () => {
      const { createQueuedTask, listRecentTasks } = await import(
        '@/db/queries/task-api'
      );
      const first = await createQueuedTask({
        prompt: 'first',
        metadata: { test_id: TEST_MARK },
      });
      await new Promise((r) => setTimeout(r, 15)); // spacing for distinct createdAt
      const second = await createQueuedTask({
        prompt: 'second',
        metadata: { test_id: TEST_MARK },
      });
      const rows = await listRecentTasks(50);
      const mine = rows.filter(
        (r) => r.prompt === 'first' || r.prompt === 'second',
      );
      expect(mine.length).toBe(2);
      // second is more recent -> comes first
      expect(mine[0]!.id).toBe(second.id);
      expect(mine[1]!.id).toBe(first.id);
    });

    it('respects the limit argument', async () => {
      const { createQueuedTask, listRecentTasks } = await import(
        '@/db/queries/task-api'
      );
      for (let i = 0; i < 4; i++) {
        await createQueuedTask({
          prompt: `p${i}`,
          metadata: { test_id: TEST_MARK },
        });
      }
      const rows = await listRecentTasks(2);
      expect(rows.length).toBe(2);
    });
  });
});
