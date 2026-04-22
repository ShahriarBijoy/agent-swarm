import { and, cosineDistance, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories, memorySegmentConfig } from '@/db/schema/memories';
import { segmentEnum } from '@/db/schema/enums';
import { effectiveImportanceSql } from '@/lib/memory/decay-sql';

export type SegmentValue = (typeof segmentEnum.enumValues)[number];

export interface RecallArgs {
  /** L2-normalized 1536-dim query vector (use lib/embeddings.embedForQuery). */
  queryVector: number[];
  /** Raw query text for Postgres FTS ts_rank_cd. */
  queryText: string;
  /** Optional segment filter. */
  segment?: SegmentValue;
  /** Max rows to return (1-50). */
  topK: number;
  /** When true, hit rows are reinforced (importance boost + access_count + last_accessed_at) in one bulk UPDATE and post-boost values are merged into the returned rows. Default false. */
  reinforceHits?: boolean;
}

export interface RecallRow {
  id: string;
  segment: SegmentValue;
  bucket: 'short' | 'long' | 'permanent';
  content: string;
  importance: string; // drizzle numeric → string
  lastAccessedAt: Date;
  cosineSim: number;
  tsRank: number;
  effectiveImportance: number;
  score: number;
}

const HNSW_CANDIDATE_MULTIPLIER = 3;

export async function recallMemories(args: RecallArgs): Promise<RecallRow[]> {
  const { queryVector, queryText, segment, topK } = args;

  // ORDER BY cosineDistance(...) ASC uses the HNSW index directly.
  // DO NOT wrap in `1 - cosineDistance(...)` DESC — that bypasses HNSW and seq-scans.
  const distance = cosineDistance(memories.embedding, queryVector);

  // 1) index-bounded candidate window via HNSW
  const candidateWindow = db
    .select({
      id: memories.id,
      segment: memories.segment,
      bucket: memories.bucket,
      content: memories.content,
      importance: memories.importance,
      lastAccessedAt: memories.lastAccessedAt,
      distance: distance.as('distance'),
    })
    .from(memories)
    .where(
      and(
        isNull(memories.tombstonedAt),
        segment ? eq(memories.segment, segment) : undefined,
      ),
    )
    .orderBy(distance)
    .limit(topK * HNSW_CANDIDATE_MULTIPLIER)
    .as('cand');

  // 2) rerank via hybrid score in SQL (no JS arithmetic).
  // Each fragment is parenthesized so precedence holds when composed into `score`.
  const cosineSim = sql<number>`(1 - ${candidateWindow.distance})`;
  const tsRank = sql<number>`(ts_rank_cd(
    to_tsvector('english', ${candidateWindow.content}),
    plainto_tsquery('english', ${queryText})
  ))`;
  const effImp = effectiveImportanceSql({
    bucket: candidateWindow.bucket,
    importance: candidateWindow.importance,
    lastAccessed: candidateWindow.lastAccessedAt,
    decayLambdaShort: memorySegmentConfig.decayLambdaShort,
    decayLambdaLongFactor: memorySegmentConfig.decayLambdaLongFactor,
    // asOf: defaults to now()
  });
  const score = sql<number>`(0.55 * ${cosineSim} + 0.25 * ${tsRank} + 0.20 * ${effImp})`;

  const rows = await db
    .select({
      id: candidateWindow.id,
      segment: candidateWindow.segment,
      bucket: candidateWindow.bucket,
      content: candidateWindow.content,
      importance: candidateWindow.importance,
      lastAccessedAt: candidateWindow.lastAccessedAt,
      cosineSim,
      tsRank,
      effectiveImportance: effImp,
      score,
    })
    .from(candidateWindow)
    .innerJoin(
      memorySegmentConfig,
      eq(memorySegmentConfig.segment, candidateWindow.segment),
    )
    .orderBy(desc(score))
    .limit(topK);

  if (args.reinforceHits && rows.length > 0) {
    const { reinforceMemories } = await import('@/db/queries/memory-lifecycle');
    const boosted = await reinforceMemories(rows.map((r) => r.id));
    const byId = new Map(boosted.map((b) => [b.id, b.importance]));
    for (const row of rows) {
      const newImp = byId.get(row.id);
      if (newImp !== undefined) {
        // Mutate the returned row to reflect post-boost importance.
        (row as { importance: string }).importance = newImp.toFixed(2);
      }
    }
  }

  return rows as RecallRow[];
}

/** For the integration test's EXPLAIN assertion — returns the raw SQL explain output. */
export async function explainRecall(args: RecallArgs): Promise<string> {
  // Reuse the candidate-window half only; the rerank doesn't need the HNSW guarantee,
  // the window-selection step does.
  const distance = cosineDistance(memories.embedding, args.queryVector);
  const result = await db.execute(sql`
    EXPLAIN (FORMAT JSON)
    SELECT id FROM ${memories}
    WHERE ${isNull(memories.tombstonedAt)}
      ${args.segment ? sql`AND segment = ${args.segment}` : sql``}
    ORDER BY ${distance}
    LIMIT ${args.topK * HNSW_CANDIDATE_MULTIPLIER}
  `);
  return JSON.stringify(result);
}
