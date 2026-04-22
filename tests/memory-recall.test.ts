import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { recallMemories } from '@/db/queries/memory-recall';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

/** Deterministic unit vector generator: e_primary + eps * e_secondary, L2-normalized. */
function basisPerturbed(primary: number, secondary: number, eps = 0.1): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  if (secondary !== primary) v[secondary] = eps;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

skipSuite('phase-03 memory-recall integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });

  const TEST_ID = 'phase-03-recall';
  type Seed = {
    content: string;
    segment: 'knowledge' | 'preference';
    importance: string;
    embedding: number[];
    bucket: 'short' | 'long' | 'permanent';
    ageDays: number;
    tombstoned?: boolean;
  };

  const seeds: Seed[] = [
    { content: 'oil change at 5000 miles — sedan',  segment: 'knowledge',  importance: '0.80', embedding: basisPerturbed(0, 1), bucket: 'short', ageDays: 0 },
    { content: 'oil change at 7500 miles — suv',    segment: 'knowledge',  importance: '0.50', embedding: basisPerturbed(0, 2), bucket: 'short', ageDays: 0 },
    { content: 'user prefers email notifications',  segment: 'preference', importance: '0.80', embedding: basisPerturbed(0, 3), bucket: 'short', ageDays: 0 },
    { content: 'tire rotation every 10k miles',     segment: 'knowledge',  importance: '0.50', embedding: basisPerturbed(1, 0), bucket: 'short', ageDays: 0 },
    { content: 'default brake inspection interval', segment: 'knowledge',  importance: '0.30', embedding: basisPerturbed(1, 2), bucket: 'short', ageDays: 0 },
    // decay-test pair: same embedding, different ages
    { content: 'recent knowledge',                  segment: 'knowledge',  importance: '0.60', embedding: basisPerturbed(2, 0), bucket: 'short', ageDays: 0 },
    { content: 'stale knowledge',                   segment: 'knowledge',  importance: '0.60', embedding: basisPerturbed(2, 0), bucket: 'short', ageDays: 14 },
    // tombstoned near-perfect match
    { content: 'tombstoned — should not appear',    segment: 'knowledge',  importance: '0.90', embedding: basisPerturbed(0, 0, 0.01), bucket: 'short', ageDays: 0, tombstoned: true },
  ];

  beforeAll(async () => {
    // Clean any residue first in case a prior run crashed.
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    for (const s of seeds) {
      await rawSql`
        INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, tombstoned_at, metadata)
        VALUES (
          ${s.segment},
          ${s.bucket},
          ${s.content},
          ${s.importance},
          ${JSON.stringify(s.embedding)}::vector,
          now() - (${s.ageDays} * interval '1 day'),
          ${s.tombstoned ? rawSql`now()` : null},
          ${rawSql.json({ test_id: TEST_ID })}
        )
      `;
    }
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('ranks cosine-aligned memories at the top', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001), // aligned with e_0
      queryText: 'oil change interval',
      topK: 5,
    });
    expect(rows.length).toBeGreaterThan(0);
    // tombstoned near-perfect match must never surface
    expect(rows.every((r) => !r.content.includes('tombstoned'))).toBe(true);
    // top row should be an e_0-aligned seed (one of the three: sedan oil, suv oil, email prefs)
    const top = rows[0]!.content;
    expect(top).toMatch(/sedan|suv|email/);
  });

  it('segment filter excludes other segments', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001),
      queryText: 'notification preference email',
      segment: 'knowledge',
      topK: 5,
    });
    for (const r of rows) expect(r.segment).toBe('knowledge');
  });

  it('decay ranks a recent memory above a stale identical one', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(2, 0, 0.001), // aligned with e_2
      queryText: 'recent stale knowledge',
      topK: 5,
    });
    const recentIdx = rows.findIndex((r) => r.content === 'recent knowledge');
    const staleIdx = rows.findIndex((r) => r.content === 'stale knowledge');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(staleIdx).toBeGreaterThan(recentIdx);
  });

  it('importance ranks higher-importance above lower for near-equal cosine', async () => {
    // e_1-aligned query: `tire rotation` (0.50) vs `brake inspection` (0.30)
    const rows = await recallMemories({
      queryVector: basisPerturbed(1, 0, 0.001),
      queryText: 'vehicle maintenance interval',
      topK: 5,
    });
    const tire = rows.findIndex((r) => r.content.includes('tire rotation'));
    const brake = rows.findIndex((r) =>
      r.content.includes('brake inspection'),
    );
    expect(tire).toBeGreaterThanOrEqual(0);
    expect(brake).toBeGreaterThan(tire);
  });

  it('top_k caps the result length', async () => {
    const rows = await recallMemories({
      queryVector: basisPerturbed(0, 0, 0.001),
      queryText: 'anything',
      topK: 3,
    });
    expect(rows.length).toBe(3);
  });

  it('EXPLAIN shows the HNSW index in use', async () => {
    // With tiny test data the planner prefers a bitmap scan on the smaller btree;
    // disable seq + bitmap scans in a transaction so the HNSW index is chosen.
    const planJson = await rawSql.begin(async (sql) => {
      await sql`SET LOCAL enable_seqscan = OFF`;
      await sql`SET LOCAL enable_bitmapscan = OFF`;
      const qv = basisPerturbed(0, 0, 0.001);
      const rows = await sql<{ 'QUERY PLAN': unknown }[]>`
        EXPLAIN (FORMAT JSON)
        SELECT id FROM memories
        WHERE tombstoned_at IS NULL
        ORDER BY embedding <=> ${JSON.stringify(qv)}::vector
        LIMIT 15
      `;
      return JSON.stringify(rows);
    });
    expect(planJson).toMatch(/memories_embedding_hnsw_idx/);
  });

  it('does not reinforce rows when reinforceHits is false (default)', async () => {
    // Seed a fresh row with a known importance; recall twice without reinforce; ensure no mutation.
    const [seed] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'no-reinforce probe', '0.50',
        ${JSON.stringify(basisPerturbed(5, 0))}::vector,
        ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id
    `;
    await recallMemories({
      queryVector: basisPerturbed(5, 0, 0.001),
      queryText: 'probe',
      topK: 3,
    });
    const [after] = await rawSql<Array<{ importance: string }>>`
      SELECT importance FROM memories WHERE id = ${seed!.id}
    `;
    expect(after!.importance).toBe('0.50');
  });

  it('reinforces every returned row when reinforceHits is true', async () => {
    const [seed] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'reinforce probe', '0.60',
        ${JSON.stringify(basisPerturbed(6, 0))}::vector,
        ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id
    `;
    const rows = await recallMemories({
      queryVector: basisPerturbed(6, 0, 0.001),
      queryText: 'probe',
      topK: 3,
      reinforceHits: true,
    });
    // returned row reflects post-boost importance: 0.60 + 0.05*0.40 = 0.62
    const hit = rows.find((r) => r.id === seed!.id);
    expect(hit?.importance).toBe('0.62');
    // DB also updated
    const [after] = await rawSql<Array<{ importance: string; access_count: number }>>`
      SELECT importance, access_count FROM memories WHERE id = ${seed!.id}
    `;
    expect(after!.importance).toBe('0.62');
    expect(after!.access_count).toBe(1);
  });
});

describe.skip('[live] Gemini recall round-trip', () => {
  it('embeds a real query and returns 1536 unit-norm dims', async () => {
    const { embedForQuery, EMBEDDING_DIMS } = await import('@/lib/embeddings');
    const v = await embedForQuery('hello world');
    expect(v.length).toBe(EMBEDDING_DIMS);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });
});
