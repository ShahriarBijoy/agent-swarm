import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface CleanupCandidate {
  candidateKind: 'prune' | 'merge';
  memoryId: string;
  targetMemoryId: string | null;
  segment: string;
  bucket: string;
  content: string;
  importance: string;
  /** Set on prune candidates only. */
  effImp: number | null;
  /** Set on merge candidates only. */
  cosineDistance: number | null;
  /** Set on merge candidates only — the target row's content for prompt context. */
  targetContent: string | null;
}

export interface SelectCandidatesArgs {
  pruneLimit: number; // default 50
  mergeLimit: number; // default 50
}

/**
 * Deterministic SQL — no LLMs, no agent. Returns up to (pruneLimit +
 * mergeLimit) candidates ordered by severity within each kind.
 *
 * Pruning rule:    eff_imp < 0.15, bucket != 'permanent', not tombstoned.
 * Merging rule:    same segment, b.id > a.id (no dupes), embedding present
 *                  on both, cosine distance < 0.15.
 *
 * The effective-importance expression matches lib/memory/decay-sql.ts.
 * We re-implement it inline (rather than calling effectiveImportanceSql)
 * because the SELECT alias machinery is awkward across the UNION here;
 * if you change the formula, change both places. Phase 04's
 * `tests/memory-lifecycle.test.ts` exercises the canonical shape.
 */
export async function selectCleanupCandidates(
  args: SelectCandidatesArgs,
): Promise<CleanupCandidate[]> {
  const { pruneLimit, mergeLimit } = args;

  const result = (await db.execute(sql`
    WITH prune_cands AS (
      SELECT
        'prune'::text AS candidate_kind,
        m.id AS memory_id,
        NULL::uuid AS target_memory_id,
        m.segment::text AS segment,
        m.bucket::text  AS bucket,
        m.content,
        m.importance::text AS importance,
        (m.importance::float8 * exp(
          -(CASE m.bucket
              WHEN 'permanent' THEN 0
              WHEN 'short'     THEN c.decay_lambda_short
              WHEN 'long'      THEN c.decay_lambda_long_factor * (1 - 0.8 * m.importance::float8)
            END)
          * (extract(epoch from (now() - m.last_accessed_at)) / 86400.0)
        )) AS eff_imp,
        NULL::float8 AS cosine_distance,
        NULL::text   AS target_content
      FROM memories m
      JOIN memory_segment_config c ON c.segment = m.segment
      WHERE m.tombstoned_at IS NULL AND m.bucket <> 'permanent'
    ),
    prune_picks AS (
      SELECT * FROM prune_cands
      WHERE eff_imp < 0.15
      ORDER BY eff_imp ASC
      LIMIT ${pruneLimit}
    ),
    merge_picks AS (
      SELECT
        'merge'::text AS candidate_kind,
        a.id AS memory_id,
        b.id AS target_memory_id,
        a.segment::text AS segment,
        a.bucket::text  AS bucket,
        a.content,
        a.importance::text AS importance,
        NULL::float8 AS eff_imp,
        (a.embedding <=> b.embedding) AS cosine_distance,
        b.content    AS target_content
      FROM memories a
      JOIN memories b
        ON b.segment = a.segment
       AND b.id > a.id
       AND b.tombstoned_at IS NULL
       AND b.embedding IS NOT NULL
      WHERE a.tombstoned_at IS NULL
        AND a.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < 0.15
      ORDER BY (a.embedding <=> b.embedding) ASC
      LIMIT ${mergeLimit}
    )
    SELECT * FROM prune_picks
    UNION ALL
    SELECT * FROM merge_picks
  `)) as unknown as {
    rows: Array<{
      candidate_kind: 'prune' | 'merge';
      memory_id: string;
      target_memory_id: string | null;
      segment: string;
      bucket: string;
      content: string;
      importance: string;
      eff_imp: number | null;
      cosine_distance: number | null;
      target_content: string | null;
    }>;
  };

  return result.rows.map((r) => ({
    candidateKind: r.candidate_kind,
    memoryId: r.memory_id,
    targetMemoryId: r.target_memory_id,
    segment: r.segment,
    bucket: r.bucket,
    content: r.content,
    importance: r.importance,
    effImp: r.eff_imp === null ? null : Number(r.eff_imp),
    cosineDistance:
      r.cosine_distance === null ? null : Number(r.cosine_distance),
    targetContent: r.target_content,
  }));
}
