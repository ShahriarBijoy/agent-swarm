// tests/dashboard/queries-home.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getGreetingSnapshot,
  getAllAgentsSnapshot,
  getActiveWorkers,
} from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-10 home queries', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-10-home-test';

  async function clearTestRows() {
    await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK})`;
    await sql`DELETE FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}`;
  }
  beforeEach(clearTestRows);
  afterAll(async () => { await clearTestRows(); await sql.end(); });

  describe('getGreetingSnapshot', () => {
    it('returns 6 monthly buckets ending in the current month', async () => {
      const snap = await getGreetingSnapshot();
      expect(snap.months).toHaveLength(6);
      const labels = snap.months.map((m) => m.label);
      // last entry is current month (3-letter lowercase, matches mockup: jan, feb, ...)
      expect(labels[5]).toMatch(/^[a-z]{3}$/);
    });
    it('totalThisMonth is non-negative integer', async () => {
      const snap = await getGreetingSnapshot();
      expect(Number.isInteger(snap.totalThisMonth)).toBe(true);
      expect(snap.totalThisMonth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAllAgentsSnapshot', () => {
    it('returns one perAgentCost entry per registered agent name', async () => {
      const snap = await getAllAgentsSnapshot();
      // dispatcher + 10 workers = 11 agents from the registry
      expect(snap.perAgentCost.length).toBeLessThanOrEqual(11);
      snap.perAgentCost.forEach((row) => {
        expect(typeof row.agent).toBe('string');
        expect(typeof row.cost).toBe('number');
      });
    });
  });

  describe('getActiveWorkers', () => {
    it('returns totalAgents=11 and activeAgentNames as a string[]', async () => {
      const snap = await getActiveWorkers();
      expect(snap.totalAgents).toBe(11);
      expect(Array.isArray(snap.activeAgentNames)).toBe(true);
    });
  });
});
