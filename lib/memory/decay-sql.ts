import { sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';

/** Any SQL reference — a raw column, a subquery column, or a pre-built sql`` fragment. */
type SqlRef = SQL | AnyColumn | SQL.Aliased;

/**
 * Builds a SQL fragment that evaluates effective importance for a single row.
 *
 * effective(row, asOf) =
 *   CASE row.bucket
 *     WHEN 'permanent' THEN row.importance
 *     WHEN 'short'     THEN row.importance * exp(-config.lambda_short * days_since(row.last_accessed_at, asOf))
 *     WHEN 'long'      THEN row.importance * exp(-config.lambda_long_factor * (1 - 0.8*row.importance) * days_since(…))
 *   END
 *
 * The caller owns the JOIN between `memories` and `memory_segment_config`; this helper
 * only composes the math. `asOf` defaults to `now()`; override it with a `sql`timestamp`
 * fragment for deterministic time-travel in tests or promotion-evaluation.
 *
 * NOTE: This formula is also inlined in `db/queries/cleanup-candidates.ts` because the
 * UNION-ALL alias machinery there is awkward when reusing this helper. If you change
 * the formula here, mirror the change in `cleanup-candidates.ts`.
 */
export function effectiveImportanceSql(refs: {
  bucket: SqlRef;
  importance: SqlRef;
  lastAccessed: SqlRef;
  decayLambdaShort: SqlRef;
  decayLambdaLongFactor: SqlRef;
  asOf?: SqlRef;
}): SQL<number> {
  const asOf = refs.asOf ?? sql`now()`;
  const ageDays = sql<number>`(extract(epoch from (${asOf} - ${refs.lastAccessed})) / 86400.0)`;
  const lambda = sql<number>`(
    CASE ${refs.bucket}
      WHEN 'permanent' THEN 0
      WHEN 'short'     THEN ${refs.decayLambdaShort}
      WHEN 'long'      THEN ${refs.decayLambdaLongFactor} * (1 - 0.8 * ${refs.importance}::float8)
    END
  )`;
  return sql<number>`(${refs.importance}::float8 * exp(-${lambda} * ${ageDays}))`;
}
