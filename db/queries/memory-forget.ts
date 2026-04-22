import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';

export interface ForgetArgs {
  id: string;
  reason?: string;
}

export interface ForgetResult {
  id: string;
  tombstonedAt: Date;
}

/**
 * Soft-delete a memory by setting tombstoned_at. Merges an optional
 * `tombstone_reason` into the existing metadata (jsonb `||` concat).
 * Returns null if the row is missing or already tombstoned — the caller
 * surfaces that as an isError at the MCP layer so the agent gets a loud
 * "already forgotten" signal instead of a silent no-op.
 */
export async function forgetMemory(args: ForgetArgs): Promise<ForgetResult | null> {
  const setClause: {
    tombstonedAt: Date;
    metadata?: ReturnType<typeof sql>;
  } = { tombstonedAt: new Date() };

  if (args.reason !== undefined) {
    setClause.metadata = sql`${memories.metadata} || jsonb_build_object('tombstone_reason', ${args.reason}::text)`;
  }

  const [row] = await db
    .update(memories)
    .set(setClause)
    .where(and(eq(memories.id, args.id), isNull(memories.tombstonedAt)))
    .returning({
      id: memories.id,
      tombstonedAt: memories.tombstonedAt,
    });

  if (!row || row.tombstonedAt === null) return null;
  return { id: row.id, tombstonedAt: row.tombstonedAt };
}
