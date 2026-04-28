// tests/dashboard/queries-agents.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getAgentMetrics } from '@/lib/dashboard/queries';

const url = process.env.DATABASE_URL_UNPOOLED;
const suite = url ? describe : describe.skip;

suite('getAgentMetrics', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });
  afterAll(async () => { await sql.end(); });

  it('returns the documented shape for a known agent name', async () => {
    const m = await getAgentMetrics('fleet-analyst');
    expect(typeof m.p50LatencyMs).toBe('number');
    expect(typeof m.p95LatencyMs).toBe('number');
    expect(Array.isArray(m.dailyTokens)).toBe(true);
    expect(typeof m.successRate).toBe('number');
    expect(Array.isArray(m.recentRuns)).toBe(true);
    expect(Array.isArray(m.topMemories)).toBe(true);
  });
});
