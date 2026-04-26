import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { applyVerdicts, type Verdict } from '@/db/queries/cleanup-apply';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

function basisVec(primary: number): number[] {
  const v = new Array<number>(1536).fill(0);
  v[primary] = 1;
  return v;
}

skipSuite('phase-09 cleanup apply', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_ID = 'phase-09-apply';

  // Re-seeded fresh for each test
  let pruneId = '';
  let mergeAId = ''; // higher importance, expected survivor
  let mergeBId = ''; // lower importance, expected loser
  let runId = '';
  let proposalPruneId = '';
  let proposalMergeId = '';

  beforeAll(async () => {
    await rawSql`DELETE FROM memory_links WHERE proposal_id IN (
                   SELECT id FROM memory_cleanup_proposals WHERE memory_id IN (
                     SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID}))`;
    await rawSql`DELETE FROM memory_cleanup_proposals WHERE memory_id IN (
                   SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID})`;
    await rawSql`DELETE FROM memory_cleanup_runs WHERE id IN (
                   SELECT run_id FROM memory_cleanup_proposals WHERE memory_id IN (
                     SELECT id FROM memories WHERE metadata->>'test_id' = ${TEST_ID}))`;
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;

    const [p] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('preference', 'short', 'apply prune target', 0.10,
              ${JSON.stringify(basisVec(0))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    pruneId = p!.id;

    const [a] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'merge survivor (higher imp)', 0.80,
              ${JSON.stringify(basisVec(1))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    mergeAId = a!.id;
    const [b] = await rawSql<{ id: string }[]>`
      INSERT INTO memories (segment, bucket, content, importance, embedding, metadata)
      VALUES ('knowledge', 'short', 'merge loser (lower imp)', 0.40,
              ${JSON.stringify(basisVec(1))}::vector,
              ${rawSql.json({ test_id: TEST_ID })})
      RETURNING id`;
    mergeBId = b!.id;

    const [r] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_runs (status) VALUES ('running') RETURNING id`;
    runId = r!.id;
    const [pp] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_proposals
        (run_id, memory_id, action, final_action, consolidator)
      VALUES (${runId}::uuid, ${pruneId}::uuid, 'prune', 'prune',
              ${rawSql.json({ reasoning: 'test', confidence: 0.9 })})
      RETURNING id`;
    proposalPruneId = pp!.id;
    const [pm] = await rawSql<{ id: string }[]>`
      INSERT INTO memory_cleanup_proposals
        (run_id, memory_id, target_memory_id, action, final_action, consolidator)
      VALUES (${runId}::uuid, ${mergeAId}::uuid, ${mergeBId}::uuid,
              'merge', 'merge', ${rawSql.json({ reasoning: 'test', confidence: 0.9 })})
      RETURNING id`;
    proposalMergeId = pm!.id;
  });

  afterAll(async () => {
    await rawSql`DELETE FROM memory_links WHERE proposal_id IN (${proposalPruneId}, ${proposalMergeId})`;
    await rawSql`DELETE FROM memory_cleanup_proposals WHERE id IN (${proposalPruneId}, ${proposalMergeId})`;
    await rawSql`DELETE FROM memory_cleanup_runs WHERE id = ${runId}`;
    await rawSql`DELETE FROM memories WHERE metadata->>'test_id' = ${TEST_ID}`;
    await rawSql.end();
  });

  it('prune verdict tombstones the memory and tags metadata', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: proposalPruneId,
        memoryId: pruneId,
        targetMemoryId: null,
        finalAction: 'prune',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(1);

    const [row] = await rawSql<
      { tombstoned_at: Date | null; metadata: Record<string, unknown> }[]
    >`SELECT tombstoned_at, metadata FROM memories WHERE id = ${pruneId}`;
    expect(row!.tombstoned_at).not.toBeNull();
    expect(row!.metadata.tombstone_reason).toBe('cleanup-proposal');
    expect(row!.metadata.proposal_id).toBe(proposalPruneId);
  });

  it('merge verdict tombstones loser, leaves survivor live, writes link', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: proposalMergeId,
        memoryId: mergeAId,
        targetMemoryId: mergeBId,
        finalAction: 'merge',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(1);

    const [survivor] = await rawSql<
      { tombstoned_at: Date | null }[]
    >`SELECT tombstoned_at FROM memories WHERE id = ${mergeAId}`;
    expect(survivor!.tombstoned_at).toBeNull();

    const [loser] = await rawSql<
      { tombstoned_at: Date | null; metadata: Record<string, unknown> }[]
    >`SELECT tombstoned_at, metadata FROM memories WHERE id = ${mergeBId}`;
    expect(loser!.tombstoned_at).not.toBeNull();
    expect(loser!.metadata.merged_into).toBe(mergeAId);

    const [link] = await rawSql<
      { parent_id: string; child_id: string; link_type: string }[]
    >`SELECT parent_id, child_id, link_type FROM memory_links
        WHERE proposal_id = ${proposalMergeId}`;
    expect(link!.parent_id).toBe(mergeAId);
    expect(link!.child_id).toBe(mergeBId);
    expect(link!.link_type).toBe('merged');
  });

  it('keep verdict is a no-op (no tombstone, applied count 0)', async () => {
    const verdicts: Verdict[] = [
      {
        proposalId: '00000000-0000-0000-0000-000000000099',
        memoryId: mergeAId,
        targetMemoryId: null,
        finalAction: 'keep',
      },
    ];
    const result = await applyVerdicts(verdicts);
    expect(result.applied).toBe(0);
    const [row] = await rawSql<
      { tombstoned_at: Date | null }[]
    >`SELECT tombstoned_at FROM memories WHERE id = ${mergeAId}`;
    expect(row!.tombstoned_at).toBeNull();
  });
});
