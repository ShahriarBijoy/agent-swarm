import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { recallMemories } from '@/db/queries/memory-recall';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-04 memory-forget integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-04-forget';

  function basis(primary: number, eps = 0.01): number[] {
    const v = new Array<number>(1536).fill(0);
    v[primary] = 1;
    v[primary + 1] = eps;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / norm);
  }

  async function seed(content: string, metadata: Record<string, unknown>): Promise<string> {
    const [row] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', ${content}, '0.50',
        ${JSON.stringify(basis(10))}::vector,
        ${rawSql.json({ test_id: TEST_ID, ...metadata })})
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

  it('sets tombstoned_at and stores tombstone_reason, preserves other metadata keys', async () => {
    const { forgetMemory } = await import('@/db/queries/memory-forget');
    const id = await seed('to-forget', { vehicle_id: 'L-42' });
    const result = await forgetMemory({ id, reason: 'superseded' });
    expect(result?.id).toBe(id);
    expect(result?.tombstonedAt).toBeInstanceOf(Date);

    const [row] = await rawSql<Array<{ tombstoned_at: Date; metadata: Record<string, unknown> }>>`
      SELECT tombstoned_at, metadata FROM memories WHERE id = ${id}
    `;
    expect(row!.tombstoned_at).not.toBeNull();
    expect(row!.metadata).toMatchObject({
      test_id: TEST_ID,
      vehicle_id: 'L-42',
      tombstone_reason: 'superseded',
    });
  });

  it('recall excludes forgotten rows even on near-perfect cosine match', async () => {
    const { forgetMemory } = await import('@/db/queries/memory-forget');
    const id = await seed('vehicle maintenance log', {});
    await forgetMemory({ id, reason: 'duplicate' });
    const rows = await recallMemories({
      queryVector: basis(10, 0.001),
      queryText: 'vehicle maintenance',
      topK: 5,
    });
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it('returns null on an already-tombstoned row', async () => {
    const { forgetMemory } = await import('@/db/queries/memory-forget');
    const id = await seed('already-gone', {});
    await forgetMemory({ id });
    const second = await forgetMemory({ id, reason: 'should not apply' });
    expect(second).toBeNull();
  });

  it('returns null on a missing id', async () => {
    const { forgetMemory } = await import('@/db/queries/memory-forget');
    const result = await forgetMemory({
      id: '00000000-0000-0000-0000-000000000000',
      reason: 'ghost',
    });
    expect(result).toBeNull();
  });

  it('omits tombstone_reason when no reason supplied', async () => {
    const { forgetMemory } = await import('@/db/queries/memory-forget');
    const id = await seed('no-reason', { vehicle_id: 'L-99' });
    await forgetMemory({ id });
    const [row] = await rawSql<Array<{ metadata: Record<string, unknown> }>>`
      SELECT metadata FROM memories WHERE id = ${id}
    `;
    expect(row!.metadata).not.toHaveProperty('tombstone_reason');
    expect(row!.metadata).toMatchObject({ test_id: TEST_ID, vehicle_id: 'L-99' });
  });
});
