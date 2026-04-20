import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;

const suite = url ? describe : describe.skip;

suite('phase-02 schema', () => {
  const sql = postgres(url!, { max: 1, idle_timeout: 2 });

  afterAll(async () => {
    await sql.end();
  });

  const expectedTables = [
    'memories',
    'memory_segment_config',
    'memory_links',
    'memory_cleanup_runs',
    'memory_cleanup_proposals',
    'tasks',
    'task_runs',
    'task_events',
    'approval_gates',
  ];

  it('creates all 9 tables', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${expectedTables})
    `;
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [...expectedTables].sort(),
    );
  });

  it('creates all 6 enums with expected values', async () => {
    const rows = await sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      GROUP BY t.typname
    `;
    const map = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
    expect(map.segment).toEqual([
      'identity',
      'correction',
      'preference',
      'relationship',
      'knowledge',
      'behavioral',
      'context',
    ]);
    expect(map.bucket).toEqual(['short', 'long', 'permanent']);
    expect(map.task_status).toEqual([
      'queued',
      'in_progress',
      'awaiting_approval',
      'done',
      'failed',
      'cancelled',
    ]);
    expect(map.approval_status).toEqual([
      'pending',
      'approved',
      'modified',
      'denied',
      'timed_out',
    ]);
    expect(map.cleanup_action).toEqual(['promote', 'prune', 'merge', 'keep']);
    expect(map.link_type).toEqual(['merged', 'superseded']);
  });

  it('has HNSW, GIN, and compound btree partial indexes on memories', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'memories'
    `;
    const defs = Object.fromEntries(
      rows.map((r) => [r.indexname, r.indexdef]),
    );
    const hnsw = defs.memories_embedding_hnsw_idx!;
    expect(hnsw).toMatch(/USING hnsw/);
    expect(hnsw).toMatch(/vector_cosine_ops/);
    expect(hnsw).toMatch(/m\s*=\s*'?16'?/);
    expect(hnsw).toMatch(/ef_construction\s*=\s*'?64'?/);
    expect(hnsw).toMatch(/WHERE\s+\(?tombstoned_at\s+IS NULL\)?/i);

    const gin = defs.memories_content_tsv_gin_idx!;
    expect(gin).toMatch(/USING gin/);
    expect(gin).toMatch(/WHERE\s+\(?tombstoned_at\s+IS NULL\)?/i);

    const btree = defs.memories_decay_btree_idx!;
    expect(btree).toMatch(/bucket/);
    expect(btree).toMatch(/importance DESC/);
    expect(btree).toMatch(/last_accessed_at DESC/);
  });

  it('has 7 seeded segment configs with correct default_importance', async () => {
    const rows = await sql<
      {
        segment: string;
        default_importance: string;
        fast_track_permanent: boolean;
      }[]
    >`
      SELECT segment, default_importance, fast_track_permanent
      FROM memory_segment_config
      ORDER BY default_importance DESC
    `;
    expect(rows).toHaveLength(7);
    expect(rows[0]!.segment).toBe('identity');
    expect(Number(rows[0]!.default_importance)).toBeCloseTo(0.9);
    expect(rows[0]!.fast_track_permanent).toBe(true);
    expect(rows[rows.length - 1]!.segment).toBe('context');
    expect(Number(rows[rows.length - 1]!.default_importance)).toBeCloseTo(0.4);
  });

  it('accepts an INSERT into memories with defaults', async () => {
    const [row] = await sql<
      {
        id: string;
        bucket: string;
        access_count: number;
        importance_streak: number;
      }[]
    >`
      INSERT INTO memories (segment, content, importance)
      VALUES ('knowledge', 'hello world', 0.6)
      RETURNING id, bucket, access_count, importance_streak
    `;
    expect(row!.bucket).toBe('short');
    expect(row!.access_count).toBe(0);
    expect(row!.importance_streak).toBe(0);
    await sql`DELETE FROM memories WHERE id = ${row!.id}`;
  });

  it('rejects a wrong-dim vector on INSERT', async () => {
    await expect(
      sql`
        INSERT INTO memories (segment, content, importance, embedding)
        VALUES ('knowledge', 'x', 0.6, '[1,2,3]'::vector)
      `,
    ).rejects.toThrow();
  });

  it('populates content_tsv automatically via the STORED generated column', async () => {
    const [row] = await sql<{ id: string; content_tsv: string }[]>`
      INSERT INTO memories (segment, content, importance)
      VALUES ('knowledge', 'the quick brown fox', 0.6)
      RETURNING id, content_tsv
    `;
    expect(String(row!.content_tsv)).toMatch(/brown/);
    expect(String(row!.content_tsv)).toMatch(/fox/);
    await sql`DELETE FROM memories WHERE id = ${row!.id}`;
  });
});
