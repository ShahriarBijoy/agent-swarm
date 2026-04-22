import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

// Stub embeddings to avoid hitting Gemini in CI; deterministic unit vector.
vi.mock('@/lib/embeddings', () => ({
  embedForDocument: vi.fn(async () => {
    const v = new Array<number>(1536).fill(0);
    v[0] = 1;
    return v;
  }),
  embedForQuery: vi.fn(),
  l2Normalize: (v: number[]) => v,
  EMBEDDING_DIMS: 1536,
  EMBEDDING_MODEL: 'stub',
}));

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-04 memory-write integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-04-write';

  beforeEach(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('defaults bucket to short and importance to segment default (knowledge = 0.60)', async () => {
    const { writeMemory } = await import('@/db/queries/memory-write');
    const result = await writeMemory({
      content: 'oil change interval is 5000 miles',
      segment: 'knowledge',
      metadata: { test_id: TEST_ID },
    });
    expect(result.bucket).toBe('short');
    expect(result.importance).toBeCloseTo(0.60, 5);

    const [row] = await rawSql<
      Array<{
        bucket: string;
        importance: string;
        importance_streak: number;
        tombstoned_at: Date | null;
        content_tsv: string | null;
        embedding_len: number;
      }>
    >`
      SELECT bucket, importance, importance_streak, tombstoned_at,
             content_tsv::text AS content_tsv,
             array_length(embedding::real[], 1) AS embedding_len
      FROM memories WHERE id = ${result.id}
    `;
    expect(row!.bucket).toBe('short');
    expect(row!.importance).toBe('0.60');
    expect(row!.importance_streak).toBe(0);
    expect(row!.tombstoned_at).toBeNull();
    expect(row!.content_tsv).not.toBeNull();
    expect(row!.embedding_len).toBe(1536);
  });

  it('uses identity default importance 0.90', async () => {
    const { writeMemory } = await import('@/db/queries/memory-write');
    const result = await writeMemory({
      content: 'user name is alice',
      segment: 'identity',
      metadata: { test_id: TEST_ID },
    });
    expect(result.importance).toBeCloseTo(0.90, 5);
  });

  it('uses context default importance 0.40', async () => {
    const { writeMemory } = await import('@/db/queries/memory-write');
    const result = await writeMemory({
      content: 'session started at 09:00',
      segment: 'context',
      metadata: { test_id: TEST_ID },
    });
    expect(result.importance).toBeCloseTo(0.40, 5);
  });

  it('round-trips arbitrary metadata', async () => {
    const { writeMemory } = await import('@/db/queries/memory-write');
    const md = { test_id: TEST_ID, vehicle_id: 'L-42', tags: ['a', 'b'] };
    const result = await writeMemory({
      content: 'lease vehicle L-42',
      segment: 'knowledge',
      metadata: md,
    });
    const [row] = await rawSql<Array<{ metadata: unknown }>>`
      SELECT metadata FROM memories WHERE id = ${result.id}
    `;
    expect(row!.metadata).toEqual(md);
  });

  it('undefined metadata defaults to empty jsonb', async () => {
    const { writeMemory } = await import('@/db/queries/memory-write');
    const result = await writeMemory({
      content: 'no metadata row',
      segment: 'knowledge',
    });
    const [row] = await rawSql<Array<{ metadata: unknown }>>`
      SELECT metadata FROM memories WHERE id = ${result.id}
    `;
    expect(row!.metadata).toEqual({});
    // Direct cleanup since no test_id tag.
    await rawSql`DELETE FROM memories WHERE id = ${result.id}`;
  });
});

describe.skip('[live] Gemini write round-trip', () => {
  it('embeds a real document and inserts', async () => {
    vi.doUnmock('@/lib/embeddings');
    const { writeMemory } = await import('@/db/queries/memory-write');
    const result = await writeMemory({
      content: 'live gemini round-trip memory',
      segment: 'knowledge',
      metadata: { test_id: 'phase-04-write-live' },
    });
    expect(result.bucket).toBe('short');
    expect(result.importance).toBeGreaterThan(0);
    // cleanup
    const rawSql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 });
    await rawSql`DELETE FROM memories WHERE id = ${result.id}`;
    await rawSql.end();
  });
});
