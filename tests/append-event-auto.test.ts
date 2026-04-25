import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-07 appendTaskEventAuto', () => {
  const rawSql = postgres(url!, { max: 4, idle_timeout: 2 });
  const TEST_MARK = 'phase-07-auto-event-test';

  async function deleteTestRows() {
    const rows = await rawSql<Array<{ id: string }>>`
      SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}
    `;
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    await rawSql`DELETE FROM task_events WHERE task_id = ANY(${ids})`;
    await rawSql`DELETE FROM tasks WHERE id = ANY(${ids})`;
  }

  beforeEach(deleteTestRows);
  afterAll(async () => {
    await deleteTestRows();
    await rawSql.end();
  });

  async function seedRun(): Promise<{ taskId: string; runId: string }> {
    const [task] = await rawSql<Array<{ id: string }>>`
      INSERT INTO tasks (prompt, status, metadata)
      VALUES ('auto', 'in_progress', ${rawSql.json({ test_id: TEST_MARK })})
      RETURNING id
    `;
    const [run] = await rawSql<Array<{ id: string }>>`
      INSERT INTO task_runs (task_id, attempt, status)
      VALUES (${task!.id}, 1, 'in_progress')
      RETURNING id
    `;
    return { taskId: task!.id, runId: run!.id };
  }

  it('hands out monotonically increasing seq starting at 0', async () => {
    const { appendTaskEventAuto } = await import('@/db/queries/task-runtime');
    const { taskId, runId } = await seedRun();
    const r1 = await appendTaskEventAuto({
      runId,
      taskId,
      type: 'assistant_turn',
      payload: { i: 1 },
    });
    const r2 = await appendTaskEventAuto({
      runId,
      taskId,
      type: 'tool_call',
      payload: { i: 2 },
    });
    const r3 = await appendTaskEventAuto({
      runId,
      taskId,
      type: 'tool_result',
      payload: { i: 3 },
    });
    expect(r1.seq).toBe(0);
    expect(r2.seq).toBe(1);
    expect(r3.seq).toBe(2);
    expect(r3.id).toBeGreaterThan(r1.id);
  });

  it('coexists with manual appendTaskEvent (auto picks up next slot)', async () => {
    const { appendTaskEvent, appendTaskEventAuto } = await import(
      '@/db/queries/task-runtime'
    );
    const { taskId, runId } = await seedRun();
    await appendTaskEvent({
      runId,
      taskId,
      seq: 0,
      type: 'assistant_turn',
      payload: {},
    });
    await appendTaskEvent({
      runId,
      taskId,
      seq: 1,
      type: 'tool_call',
      payload: {},
    });
    const auto = await appendTaskEventAuto({
      runId,
      taskId,
      type: 'approval_request',
      payload: { subtype: 'opened' },
    });
    expect(auto.seq).toBe(2);
  });

  it('preserves uniqueness under parallel writers', async () => {
    const { appendTaskEventAuto } = await import('@/db/queries/task-runtime');
    const { taskId, runId } = await seedRun();
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendTaskEventAuto({
          runId,
          taskId,
          type: 'assistant_turn',
          payload: { i },
        }),
      ),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    // Every seq from 0..N-1 appears exactly once.
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i));

    const dbRows = await rawSql<Array<{ seq: number }>>`
      SELECT seq FROM task_events WHERE run_id = ${runId} ORDER BY seq ASC
    `;
    expect(dbRows.map((r) => r.seq)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
  });

  it('isolates seq per run (two runs of the same task)', async () => {
    const { appendTaskEventAuto } = await import('@/db/queries/task-runtime');
    const { taskId, runId: runA } = await seedRun();
    // Make a second run for the same task.
    const [run] = await rawSql<Array<{ id: string }>>`
      INSERT INTO task_runs (task_id, attempt, status)
      VALUES (${taskId}, 2, 'in_progress')
      RETURNING id
    `;
    const runB = run!.id;

    const a1 = await appendTaskEventAuto({
      runId: runA,
      taskId,
      type: 'assistant_turn',
      payload: {},
    });
    const b1 = await appendTaskEventAuto({
      runId: runB,
      taskId,
      type: 'assistant_turn',
      payload: {},
    });
    const a2 = await appendTaskEventAuto({
      runId: runA,
      taskId,
      type: 'tool_call',
      payload: {},
    });
    expect(a1.seq).toBe(0);
    expect(b1.seq).toBe(0); // different run = independent seq counter
    expect(a2.seq).toBe(1);
  });
});
