import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories, memoryLinks } from '@/db/schema/memories';
import { memoryCleanupProposals } from '@/db/schema/cleanup';
import type { Action } from '@/lib/cleanup/schemas';

export interface Verdict {
  proposalId: string;
  memoryId: string;
  targetMemoryId: string | null; // set for merge verdicts only
  finalAction: Action;
}

export interface ApplyResult {
  applied: number;
  tombstones: number;
  merges: number;
  skipped: number;
}

/**
 * Translate Judge/Consolidator verdicts into memory mutations. Prune verdicts
 * are applied first (tombstone), then merge verdicts (survivor + tombstone +
 * link). `keep` verdicts are no-op but still bump the proposals' applied_at
 * column so the audit row records "reviewed".
 *
 * Survivor heuristic for merge: higher importance wins; tie → memoryId
 * (which is the older `a` from the merge candidate query's `b.id > a.id`).
 */
export async function applyVerdicts(verdicts: Verdict[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, tombstones: 0, merges: 0, skipped: 0 };

  // §4 ordering: prune before merge.
  const prunes = verdicts.filter((v) => v.finalAction === 'prune');
  const merges = verdicts.filter((v) => v.finalAction === 'merge');
  const keeps = verdicts.filter((v) => v.finalAction === 'keep');

  for (const v of prunes) {
    const updated = await db
      .update(memories)
      .set({
        tombstonedAt: new Date(),
        metadata: sql`${memories.metadata} || jsonb_build_object(
          'tombstone_reason', 'cleanup-proposal',
          'proposal_id', ${v.proposalId}::text
        )`,
      })
      .where(and(eq(memories.id, v.memoryId), isNull(memories.tombstonedAt)))
      .returning({ id: memories.id });

    if (updated.length > 0) {
      result.applied += 1;
      result.tombstones += 1;
      await db
        .update(memoryCleanupProposals)
        .set({ appliedAt: new Date() })
        .where(eq(memoryCleanupProposals.id, v.proposalId));
    } else {
      result.skipped += 1;
    }
  }

  for (const v of merges) {
    if (v.targetMemoryId === null) {
      result.skipped += 1;
      continue;
    }
    // Re-fetch live state — survivor may have shifted since selection
    const rows = await db
      .select({
        id: memories.id,
        importance: memories.importance,
        tombstonedAt: memories.tombstonedAt,
      })
      .from(memories)
      .where(inArray(memories.id, [v.memoryId, v.targetMemoryId]));

    if (rows.length !== 2 || rows.some((r) => r.tombstonedAt !== null)) {
      result.skipped += 1;
      continue;
    }

    const a = rows.find((r) => r.id === v.memoryId)!;
    const b = rows.find((r) => r.id === v.targetMemoryId)!;
    const aImp = Number(a.importance);
    const bImp = Number(b.importance);
    const survivor = aImp >= bImp ? a : b; // tie → a (memoryId)
    const loser = survivor === a ? b : a;

    await db.insert(memoryLinks).values({
      parentId: survivor.id,
      childId: loser.id,
      linkType: 'merged',
      proposalId: v.proposalId,
    });

    await db
      .update(memories)
      .set({
        tombstonedAt: new Date(),
        metadata: sql`${memories.metadata} || jsonb_build_object(
          'tombstone_reason', 'merged-into',
          'merged_into', ${survivor.id}::text,
          'proposal_id', ${v.proposalId}::text
        )`,
      })
      .where(and(eq(memories.id, loser.id), isNull(memories.tombstonedAt)));

    result.applied += 1;
    result.merges += 1;
    await db
      .update(memoryCleanupProposals)
      .set({ appliedAt: new Date() })
      .where(eq(memoryCleanupProposals.id, v.proposalId));
  }

  for (const v of keeps) {
    // No mutation; record review timestamp on the proposal row.
    await db
      .update(memoryCleanupProposals)
      .set({ appliedAt: new Date() })
      .where(eq(memoryCleanupProposals.id, v.proposalId));
  }

  return result;
}
