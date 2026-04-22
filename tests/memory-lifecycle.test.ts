import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-04 memory-lifecycle integration', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-04-lifecycle';

  function zeroEmbedding(): number[] {
    const v = new Array<number>(1536).fill(0);
    v[0] = 1;
    return v;
  }

  type SeedRow = {
    segment: 'identity' | 'correction' | 'knowledge';
    bucket: 'short' | 'long' | 'permanent';
    importance: string;
    importanceStreak: number;
    tombstonedAt?: 'expired' | 'fresh' | null;
  };

  async function seed(r: SeedRow): Promise<string> {
    const tomb =
      r.tombstonedAt === 'expired'
        ? rawSql`now() - interval '15 days'`
        : r.tombstonedAt === 'fresh'
        ? rawSql`now()`
        : null;
    const [row] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, importance_streak, embedding, tombstoned_at, last_accessed_at, metadata)
      VALUES (${r.segment}, ${r.bucket}, 'lifecycle-seed',
        ${r.importance}, ${r.importanceStreak},
        ${JSON.stringify(zeroEmbedding())}::vector,
        ${tomb},
        now(),
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

  it('proposes promote-to-long when short streak crosses 7', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 6 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    expect(p?.action).toBe('promote-to-long');
  });

  it('proposes reset-streak when short effective importance falls below threshold (and streak > 0)', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 3 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    expect(p?.action).toBe('reset-streak');
  });

  it('emits no proposal when streak is already 0 and importance is below threshold', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 0 });
    const proposals = await evaluatePromotions();
    expect(proposals.find((x) => x.id === id)).toBeUndefined();
  });

  it('proposes promote-to-permanent when long streak crosses 30', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'knowledge', bucket: 'long', importance: '0.85', importanceStreak: 29 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    expect(p?.action).toBe('promote-to-permanent');
  });

  it('fast-tracks identity short to permanent at streak=2 with one call (newStreak=3)', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'identity', bucket: 'short', importance: '0.85', importanceStreak: 2 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    expect(p?.action).toBe('promote-to-permanent');
  });

  it('does NOT fast-track at streak=1 (newStreak=2 < FAST_TRACK_STREAK_DAYS)', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'identity', bucket: 'short', importance: '0.85', importanceStreak: 1 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    expect(p?.action).toBe('advance-streak');
    if (p?.action === 'advance-streak') expect(p.newStreak).toBe(2);
  });

  it('does NOT fast-track correction segment (fast_track_permanent=false)', async () => {
    const { evaluatePromotions } = await import('@/db/queries/memory-lifecycle');
    const id = await seed({ segment: 'correction', bucket: 'short', importance: '0.85', importanceStreak: 2 });
    const proposals = await evaluatePromotions();
    const p = proposals.find((x) => x.id === id);
    // correction advances the normal short→long streak, still below 7.
    expect(p?.action).toBe('advance-streak');
  });

  it('applyPromotions bulk-updates all four action types in one transaction', async () => {
    const { evaluatePromotions, applyPromotions } = await import('@/db/queries/memory-lifecycle');
    const advanceId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 2 });
    const resetId   = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.40', importanceStreak: 3 });
    const longId    = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.60', importanceStreak: 6 });
    const permId    = await seed({ segment: 'knowledge', bucket: 'long',  importance: '0.85', importanceStreak: 29 });

    const proposals = await evaluatePromotions();
    const result = await applyPromotions(proposals);
    expect(result.advanced).toBeGreaterThanOrEqual(1);
    expect(result.reset).toBeGreaterThanOrEqual(1);
    expect(result.promotedToLong).toBeGreaterThanOrEqual(1);
    expect(result.promotedToPermanent).toBeGreaterThanOrEqual(1);

    const [advRow] = await rawSql<Array<{ importance_streak: number }>>`SELECT importance_streak FROM memories WHERE id = ${advanceId}`;
    const [resetRow] = await rawSql<Array<{ importance_streak: number }>>`SELECT importance_streak FROM memories WHERE id = ${resetId}`;
    const [longRow] = await rawSql<Array<{ bucket: string; importance_streak: number }>>`SELECT bucket, importance_streak FROM memories WHERE id = ${longId}`;
    const [permRow] = await rawSql<Array<{ bucket: string; importance_streak: number }>>`SELECT bucket, importance_streak FROM memories WHERE id = ${permId}`;
    expect(advRow!.importance_streak).toBe(3);
    expect(resetRow!.importance_streak).toBe(0);
    expect(longRow!.bucket).toBe('long');
    expect(longRow!.importance_streak).toBe(0);
    expect(permRow!.bucket).toBe('permanent');
    expect(permRow!.importance_streak).toBe(0);
  });

  it('expireTombstones dryRun returns expired rows without deleting', async () => {
    const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
    const expiredId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'expired' });
    const freshId   = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'fresh' });
    const candidates = await expireTombstones({ dryRun: true });
    const ids = candidates.map((r) => r.id);
    expect(ids).toContain(expiredId);
    expect(ids).not.toContain(freshId);
    // Row still exists.
    const [row] = await rawSql<Array<{ id: string }>>`SELECT id FROM memories WHERE id = ${expiredId}`;
    expect(row).toBeDefined();
  });

  it('expireTombstones (not dryRun) hard-deletes rows older than 14 days', async () => {
    const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
    const expiredId = await seed({ segment: 'knowledge', bucket: 'short', importance: '0.50', importanceStreak: 0, tombstonedAt: 'expired' });
    const deleted = await expireTombstones();
    expect(deleted.find((r) => r.id === expiredId)).toBeDefined();
    const rows = await rawSql`SELECT id FROM memories WHERE id = ${expiredId}`;
    expect(rows).toHaveLength(0);
  });

  it('14-day boundary: tombstoned ~13d23h is NOT expired; ~14d1s IS expired', async () => {
    const { expireTombstones } = await import('@/db/queries/memory-lifecycle');
    // Seed two rows with explicit tombstoned_at timestamps straddling the boundary.
    const asOf = new Date();
    const beforeBoundary = new Date(asOf.getTime() - (14 * 86400 - 60) * 1000); // ~13d23h59m ago
    const afterBoundary  = new Date(asOf.getTime() - (14 * 86400 + 1)  * 1000); // ~14d1s ago
    const [notExpired] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
      VALUES ('knowledge', 'short', 'boundary-near', '0.50', ${JSON.stringify(zeroEmbedding())}::vector,
        ${beforeBoundary}, ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id
    `;
    const [expired] = await rawSql<Array<{ id: string }>>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, tombstoned_at, metadata)
      VALUES ('knowledge', 'short', 'boundary-past', '0.50', ${JSON.stringify(zeroEmbedding())}::vector,
        ${afterBoundary}, ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id
    `;
    const candidates = await expireTombstones({ asOf, dryRun: true });
    const ids = candidates.map((r) => r.id);
    expect(ids).toContain(expired!.id);
    expect(ids).not.toContain(notExpired!.id);
  });
});
