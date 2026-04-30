// scripts/fix-fleet.ts
//
// One-shot recovery for "the swarm thinks the fleet is in Boston" after
// phase 10.5 was iterated from US to Germany. Two steps:
//
//   1. Tombstone any memory rows that explicitly mention Boston / Fleet-East /
//      US-only / "no German depots" — these were written by previous runs
//      under the old fixture set and will keep poisoning recall otherwise.
//      We tombstone (set `tombstoned_at = NOW()`) instead of DELETE so the
//      14-day rollback window from phase 04 still applies if the regex
//      catches a false positive.
//   2. Re-run the domain seed (vehicles / customers / trips / invoices)
//      against the current German depot fixtures.
//
// Usage:
//   pnpm fix:fleet           # tombstone + re-seed
//   pnpm fix:fleet --dry-run # show what would be tombstoned, don't write

import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import { sql, ilike, or, and, isNull } from 'drizzle-orm';
import { seed } from '@/db/seed/domain';

const POISON_PATTERNS = [
  '%Boston%',
  '%Fleet-East%',
  '%fleet-east%',
  '%US-only%',
  '%no German%',
  '%no EU%',
  '%no European%',
  '%42.36%', // Boston latitude — catches the homeLat literal in any memory
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(
    `=== Auto-ride fleet recovery${dryRun ? ' (DRY RUN — no writes)' : ''} ===\n`,
  );

  // ------------------------------------------------------------------
  // Step 1: tombstone poisoned memories
  // ------------------------------------------------------------------
  const matchClause = or(
    ...POISON_PATTERNS.map((pattern) => ilike(memories.content, pattern)),
  );

  // Show what we'll touch first.
  const candidates = await db
    .select({
      id: memories.id,
      bucket: memories.bucket,
      segment: memories.segment,
      contentPreview: sql<string>`substring(${memories.content} for 120)`,
    })
    .from(memories)
    .where(and(matchClause, isNull(memories.tombstonedAt)));

  console.log(
    `Step 1 — found ${candidates.length} live memories matching poison patterns:`,
  );
  for (const c of candidates) {
    const preview = c.contentPreview.replace(/\s+/g, ' ').slice(0, 110);
    console.log(`  - [${c.bucket}/${c.segment}] ${c.id} ${preview}…`);
  }

  if (dryRun) {
    console.log('\n(dry-run) skipping tombstone + seed. Re-run without --dry-run to apply.');
    process.exit(0);
  }

  if (candidates.length > 0) {
    const result = await db
      .update(memories)
      .set({ tombstonedAt: new Date() })
      .where(and(matchClause, isNull(memories.tombstonedAt)));
    console.log(`  tombstoned. result=${JSON.stringify(result)}\n`);
  } else {
    console.log('  nothing to tombstone, skipping.\n');
  }

  // ------------------------------------------------------------------
  // Step 2: re-seed the domain (wipes vehicles/customers/trips/invoices,
  // then inserts the current German fleet from db/seed/domain.ts)
  // ------------------------------------------------------------------
  console.log('Step 2 — running pnpm seed:domain logic inline...\n');
  await seed();

  console.log('\nFleet recovery complete.');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('\nfix-fleet failed:', err);
  process.exit(1);
});
