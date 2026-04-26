import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { selectCleanupCandidates } from '@/db/queries/cleanup-candidates';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

function basisVec(primary: number, secondary = primary, eps = 0.001): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  if (secondary !== primary) v[secondary] = eps;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

skipSuite('phase-09 cleanup candidate selection', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-09-candidates';

  beforeAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    // Stale low-importance preference (eff_imp < 0.15 after decay)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('preference', 'short', 'stale prune candidate', 0.10,
                         ${JSON.stringify(basisVec(0))}::vector,
                         now() - interval '60 days',
                         ${rawSql.json({ test_id: TEST_ID, role: 'prune-cand' })})`;
    // Permanent row (must NOT be a prune candidate even with low importance)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('preference', 'permanent', 'permanent low-imp', 0.10,
                         ${JSON.stringify(basisVec(1))}::vector,
                         now() - interval '60 days',
                         ${rawSql.json({ test_id: TEST_ID, role: 'permanent' })})`;
    // Tombstoned row (must NOT appear in either query)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, tombstoned_at, metadata)
                 VALUES ('preference', 'short', 'tombstoned', 0.10,
                         ${JSON.stringify(basisVec(2))}::vector,
                         now() - interval '60 days',
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'tombstoned' })})`;
    // Near-duplicate merge pair (cosine distance ~0)
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('knowledge', 'short', 'merge pair A', 0.60,
                         ${JSON.stringify(basisVec(3))}::vector,
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'merge-a' })})`;
    await rawSql`INSERT INTO memories (segment, bucket, content, importance, embedding, last_accessed_at, metadata)
                 VALUES ('knowledge', 'short', 'merge pair B', 0.45,
                         ${JSON.stringify(basisVec(3, 4, 0.001))}::vector,
                         now(),
                         ${rawSql.json({ test_id: TEST_ID, role: 'merge-b' })})`;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('returns the stale low-importance row as a prune candidate', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const prunes = candidates.filter((c) => c.candidateKind === 'prune');
    expect(prunes.some((c) => c.content === 'stale prune candidate')).toBe(true);
  });

  it('excludes permanent bucket from prune candidates', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const prunes = candidates.filter((c) => c.candidateKind === 'prune');
    expect(prunes.some((c) => c.content === 'permanent low-imp')).toBe(false);
  });

  it('excludes tombstoned rows from both queries', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    expect(candidates.some((c) => c.content === 'tombstoned')).toBe(false);
  });

  it('returns the near-duplicate pair as exactly one merge candidate (a < b)', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 50, mergeLimit: 50 });
    const merges = candidates.filter(
      (c) =>
        c.candidateKind === 'merge' &&
        (c.content === 'merge pair A' || c.content === 'merge pair B'),
    );
    expect(merges).toHaveLength(1);
    // The asymmetric `b.id > a.id` ordering means content of memoryId is older row.
    // We can't predict UUID order, but we can assert the pair is collapsed:
    expect(merges[0]!.targetMemoryId).not.toBeNull();
  });

  it('honors pruneLimit and mergeLimit caps', async () => {
    const candidates = await selectCleanupCandidates({ pruneLimit: 0, mergeLimit: 0 });
    expect(candidates).toHaveLength(0);
  });
});
