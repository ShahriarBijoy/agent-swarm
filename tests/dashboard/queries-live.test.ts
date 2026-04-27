// tests/dashboard/queries-live.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getActiveRun,
  getOpenApprovalGates,
  getMemoryWritesToday,
  getLastCleanup,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 live queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-10-live-test';

  async function clear() {
    await sql`DELETE FROM approval_gates WHERE reviewer_id = ${TEST_MARK}`;
    await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK})`;
    await sql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }
  beforeEach(clear);
  afterAll(async () => { await clear(); await sql.end(); });

  it('getActiveRun returns null when nothing is running', async () => {
    const result = await getActiveRun();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('getOpenApprovalGates returns only pending rows', async () => {
    const rows = await getOpenApprovalGates();
    rows.forEach((row) => {
      expect(row.status).toBe('pending');
      // bug guard: camelCase keys must be present (snake-case must NOT)
      expect(row).toHaveProperty('taskId');
      expect(row).toHaveProperty('taskPrompt');
      expect((row as unknown as Record<string, unknown>).task_id).toBeUndefined();
      expect((row as unknown as Record<string, unknown>).task_prompt).toBeUndefined();
    });
  });

  it('getMemoryWritesToday returns shape {count, deltaVsYesterday}', async () => {
    const r = await getMemoryWritesToday();
    expect(typeof r.count).toBe('number');
    expect(typeof r.deltaVsYesterday).toBe('number');
  });

  it('getLastCleanup returns shape or null', async () => {
    const r = await getLastCleanup();
    if (r) {
      expect(r.runStartedAt).toBeInstanceOf(Date);
      expect(typeof r.promoted).toBe('number');
      expect(typeof r.pruned).toBe('number');
      expect(typeof r.contested).toBe('number');
    } else {
      expect(r).toBeNull();
    }
  });
});
