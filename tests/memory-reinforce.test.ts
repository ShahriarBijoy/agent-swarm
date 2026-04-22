import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-04 memory-reinforce integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-04-reinforce';

  function zeroEmbedding(): number[] {
    const v = new Array<number>(1536).fill(0);
    v[0] = 1; // unit-norm
    return v;
  }

  async function seedRow(importance: string, opts?: { tombstoned?: boolean }): Promise<string> {
    const [row] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
      VALUES ('knowledge', 'short', 'seed', ${importance}, ${JSON.stringify(zeroEmbedding())}::vector,
        ${opts?.tombstoned ? rawSql`now()` : null},
        ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id
    `;
    return row!.id;
  }

  beforeEach(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('boost from 0.50 → 0.525 matches I + 0.05*(1-I)', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const id = await seedRow('0.50');
    const [result] = await reinforceMemories([id]);
    expect(result?.importanceBefore).toBeCloseTo(0.50, 5);
    // numeric(3,2) stores 0.525 as 0.53 (rounds half-up) — verify what actually landed.
    expect(result?.importance).toBeCloseTo(0.53, 5);
  });

  it('boost near saturation: 0.99 → stored 0.99 (numeric(3,2) rounds 0.9905 → 0.99)', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const id = await seedRow('0.99');
    const [result] = await reinforceMemories([id]);
    expect(result?.importanceBefore).toBeCloseTo(0.99, 5);
    expect(result?.importance).toBeCloseTo(0.99, 5);
  });

  it('saturation at 1.00 stays at 1.00', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const id = await seedRow('1.00');
    const [result] = await reinforceMemories([id]);
    expect(result?.importance).toBeCloseTo(1.00, 5);
  });

  it('increments access_count by 1 and bumps last_accessed_at', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const id = await seedRow('0.50');
    // Pin last_accessed_at to a known past value so we can assert the bump.
    await rawSql`UPDATE memories SET last_accessed_at = now() - interval '2 days', access_count = 3 WHERE id = ${id}`;
    await reinforceMemories([id]);
    const [row] = await rawSql<Array<{ access_count: number; last_accessed_at: Date }>>`
      SELECT access_count, last_accessed_at FROM memories WHERE id = ${id}
    `;
    expect(row!.access_count).toBe(4);
    // bumped — last_accessed_at is within the last 5 seconds
    const ageMs = Date.now() - new Date(row!.last_accessed_at).getTime();
    expect(ageMs).toBeLessThan(5_000);
  });

  it('is a no-op on a tombstoned row (empty result)', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const id = await seedRow('0.50', { tombstoned: true });
    const results = await reinforceMemories([id]);
    expect(results).toHaveLength(0);
  });

  it('bulk-reinforces 3 ids in one call', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const ids = [
      await seedRow('0.50'),
      await seedRow('0.60'),
      await seedRow('0.70'),
    ];
    const results = await reinforceMemories(ids);
    expect(results).toHaveLength(3);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get(ids[0]!)?.importanceBefore).toBeCloseTo(0.50, 5);
    expect(byId.get(ids[1]!)?.importanceBefore).toBeCloseTo(0.60, 5);
    expect(byId.get(ids[2]!)?.importanceBefore).toBeCloseTo(0.70, 5);
  });

  it('returns empty array on empty id list', async () => {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const results = await reinforceMemories([]);
    expect(results).toEqual([]);
  });
});
