import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

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
