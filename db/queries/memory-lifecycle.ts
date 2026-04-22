import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
import { db } from '@/db/client';
import { memories, memorySegmentConfig } from '@/db/schema/memories';
import { effectiveImportanceSql } from '@/lib/memory/decay-sql';

/** Reinforcement result row — importance values already float-casted in SQL. */
export interface ReinforceResult {
  id: string;
  importanceBefore: number;
  importance: number;
}

/**
 * Boost importance on hit using the diminishing-returns formula:
 *   I ← min(1.0, I + 0.05 * (1 − I))
 *
 * Applied in a single UPDATE so concurrent reinforces against the same
 * row serialize correctly. Tombstoned rows are silently excluded.
 * Also increments access_count and bumps last_accessed_at.
 *
 * Returns one row per successfully-updated id. An empty input array
 * returns an empty result (no SQL round-trip).
 */
export async function reinforceMemories(ids: string[]): Promise<ReinforceResult[]> {
  if (ids.length === 0) return [];

  // drizzle 0.45 expands `${string[]}` as `($1, $2, …)` (record) which can't be
  // cast to `uuid[]`. Build the cast IN list explicitly via sql.join.
  const uuidList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const result = (await db.execute(sql`
    WITH before AS (
      SELECT id, importance::float8 AS importance_before
      FROM memories
      WHERE id IN (${uuidList}) AND tombstoned_at IS NULL
    ),
    updated AS (
      UPDATE memories
      SET importance = LEAST(1.0, importance::float8 + 0.05 * (1 - importance::float8))::numeric(3,2),
          access_count = access_count + 1,
          last_accessed_at = now()
      WHERE id IN (${uuidList}) AND tombstoned_at IS NULL
      RETURNING id, importance::float8 AS importance_after
    )
    SELECT b.id::text AS id, b.importance_before, u.importance_after AS importance
    FROM before b JOIN updated u USING (id)
  `)) as unknown as {
    rows: Array<{
      id: string;
      importance_before: number;
      importance: number;
    }>;
  };

  return result.rows.map((r) => ({
    id: r.id,
    importanceBefore: Number(r.importance_before),
    importance: Number(r.importance),
  }));
}

export const PROMOTE_LONG_STREAK_DAYS = 7;
export const PROMOTE_PERMANENT_STREAK_DAYS = 30;
export const FAST_TRACK_STREAK_DAYS = 3;
export const TOMBSTONE_EXPIRY_DAYS = 14;

export type Proposal =
  | { id: string; action: 'advance-streak'; newStreak: number }
  | { id: string; action: 'reset-streak' }
  | { id: string; action: 'promote-to-long' }
  | { id: string; action: 'promote-to-permanent' };

export interface ApplyPromotionsResult {
  advanced: number;
  reset: number;
  promotedToLong: number;
  promotedToPermanent: number;
}

/**
 * Pure read: compute proposed lifecycle transitions for every
 * non-tombstoned, non-permanent memory at time `asOf` (default now()).
 * Does not mutate. Caller applies via applyPromotions().
 *
 * Idempotency note: calling twice in the same 24h would double-advance
 * streaks IF both proposals are applied. Phase 04's runner calls this
 * at most once; phase 09's cron enforces once-per-day.
 */
export async function evaluatePromotions(args?: { asOf?: Date }): Promise<Proposal[]> {
  const asOfSql = args?.asOf
    ? sql`${args.asOf}::timestamptz`
    : sql`now()`;

  const rows = await db
    .select({
      id: memories.id,
      segment: memories.segment,
      bucket: memories.bucket,
      importanceStreak: memories.importanceStreak,
      promotionThresholdLong: memorySegmentConfig.promotionThresholdLong,
      promotionThresholdPermanent: memorySegmentConfig.promotionThresholdPermanent,
      fastTrackPermanent: memorySegmentConfig.fastTrackPermanent,
      effectiveImportance: effectiveImportanceSql({
        bucket: memories.bucket,
        importance: memories.importance,
        lastAccessed: memories.lastAccessedAt,
        decayLambdaShort: memorySegmentConfig.decayLambdaShort,
        decayLambdaLongFactor: memorySegmentConfig.decayLambdaLongFactor,
        asOf: asOfSql,
      }),
    })
    .from(memories)
    .innerJoin(memorySegmentConfig, eq(memorySegmentConfig.segment, memories.segment))
    .where(and(isNull(memories.tombstonedAt), ne(memories.bucket, 'permanent')));

  const proposals: Proposal[] = [];
  for (const row of rows) {
    const effective = Number(row.effectiveImportance);
    const thresholdLong = Number(row.promotionThresholdLong);
    const thresholdPerm = Number(row.promotionThresholdPermanent);
    const currentStreak = row.importanceStreak;

    let advanceThreshold: number;
    let streakMax: number;
    if (row.bucket === 'short') {
      advanceThreshold = thresholdLong;
      streakMax = PROMOTE_LONG_STREAK_DAYS;
    } else {
      // bucket = 'long'
      advanceThreshold = thresholdPerm;
      streakMax = PROMOTE_PERMANENT_STREAK_DAYS;
    }

    const meetsThreshold = effective >= advanceThreshold;
    const newStreak = meetsThreshold ? currentStreak + 1 : 0;

    // Fast-track takes precedence when eligible.
    const fastTrackEligible =
      row.fastTrackPermanent &&
      effective >= thresholdPerm &&
      newStreak >= FAST_TRACK_STREAK_DAYS;
    if (fastTrackEligible) {
      proposals.push({ id: row.id, action: 'promote-to-permanent' });
      continue;
    }

    if (!meetsThreshold) {
      if (currentStreak > 0) {
        proposals.push({ id: row.id, action: 'reset-streak' });
      }
      // else: no-op proposal; skip.
      continue;
    }

    if (newStreak >= streakMax) {
      proposals.push({
        id: row.id,
        action: row.bucket === 'short' ? 'promote-to-long' : 'promote-to-permanent',
      });
      continue;
    }

    proposals.push({ id: row.id, action: 'advance-streak', newStreak });
  }
  return proposals;
}

/**
 * Apply a list of proposals, grouped by action so each group is one bulk UPDATE.
 *
 * Neon's HTTP driver does not support interactive transactions, so the four
 * bulk-UPDATEs run sequentially. That is acceptable because (a) each UPDATE is
 * independently well-formed; (b) phase 09 runs this at most once per day via
 * cron, so partial-failure recovery is a simple re-run on the next trigger.
 */
export async function applyPromotions(proposals: Proposal[]): Promise<ApplyPromotionsResult> {
  const advances = proposals.filter((p): p is Extract<Proposal, { action: 'advance-streak' }> => p.action === 'advance-streak');
  const resets = proposals.filter((p) => p.action === 'reset-streak').map((p) => p.id);
  const toLong = proposals.filter((p) => p.action === 'promote-to-long').map((p) => p.id);
  const toPerm = proposals.filter((p) => p.action === 'promote-to-permanent').map((p) => p.id);

  if (advances.length > 0) {
    const valuesClause = sql.join(
      advances.map((a) => sql`(${a.id}::uuid, ${a.newStreak}::int)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE memories AS m
      SET importance_streak = data.streak
      FROM (VALUES ${valuesClause}) AS data(id, streak)
      WHERE m.id = data.id
    `);
  }
  if (resets.length > 0) {
    await db
      .update(memories)
      .set({ importanceStreak: 0 })
      .where(inArray(memories.id, resets));
  }
  if (toLong.length > 0) {
    await db
      .update(memories)
      .set({ bucket: 'long', importanceStreak: 0 })
      .where(inArray(memories.id, toLong));
  }
  if (toPerm.length > 0) {
    await db
      .update(memories)
      .set({ bucket: 'permanent', importanceStreak: 0 })
      .where(inArray(memories.id, toPerm));
  }

  return {
    advanced: advances.length,
    reset: resets.length,
    promotedToLong: toLong.length,
    promotedToPermanent: toPerm.length,
  };
}

export interface ExpireTombstonesArgs {
  asOf?: Date;
  dryRun?: boolean;
}

export interface ExpireRow {
  id: string;
  tombstonedAt: Date;
}

/**
 * Find (dryRun) or hard-delete memories whose tombstoned_at is older
 * than TOMBSTONE_EXPIRY_DAYS (14) from asOf (default now()).
 */
export async function expireTombstones(args?: ExpireTombstonesArgs): Promise<ExpireRow[]> {
  const asOf = args?.asOf ?? new Date();
  const cutoff = new Date(asOf.getTime() - TOMBSTONE_EXPIRY_DAYS * 86400 * 1000);

  if (args?.dryRun) {
    const rows = await db
      .select({ id: memories.id, tombstonedAt: memories.tombstonedAt })
      .from(memories)
      .where(and(isNotNull(memories.tombstonedAt), lte(memories.tombstonedAt, cutoff)));
    return rows.map((r) => ({
      id: r.id,
      tombstonedAt: r.tombstonedAt!, // isNotNull filter guarantees this is non-null
    }));
  }

  const deleted = await db
    .delete(memories)
    .where(and(isNotNull(memories.tombstonedAt), lte(memories.tombstonedAt, cutoff)))
    .returning({ id: memories.id, tombstonedAt: memories.tombstonedAt });

  return deleted.map((r) => ({
    id: r.id,
    tombstonedAt: r.tombstonedAt!,
  }));
}
