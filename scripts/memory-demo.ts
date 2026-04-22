// Env is loaded by `tsx --env-file=.env.local` in package.json's `memory:demo` script.
// Running this file directly without that flag will fail env validation in lib/env.ts.
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import { eq, sql } from 'drizzle-orm';
import { writeMemory } from '@/db/queries/memory-write';
import { recallMemories } from '@/db/queries/memory-recall';
import { forgetMemory } from '@/db/queries/memory-forget';
import {
  reinforceMemories,
  evaluatePromotions,
  expireTombstones,
} from '@/db/queries/memory-lifecycle';
import { embedForQuery } from '@/lib/embeddings';

const TEST_ID = 'phase-04-demo';

interface SeedResult {
  id: string;
  segment: string;
  importance: number;
  content: string;
}

async function stage1_write(): Promise<SeedResult[]> {
  console.log('\n=== stage 1: write six memories ===');
  const fixtures = [
    { segment: 'identity' as const,    content: 'user name is Alice; operates a fleet of lease sedans' },
    { segment: 'identity' as const,    content: 'dispatcher is based in Bremen, DE' },
    { segment: 'preference' as const,  content: 'dispatcher prefers morning service appointments' },
    { segment: 'preference' as const,  content: 'user prefers email notifications over SMS' },
    { segment: 'knowledge' as const,   content: 'oil change interval for lease sedan fleet: 5000 miles' },
    { segment: 'correction' as const,  content: 'the service interval was updated to 7500 miles in 2025' },
  ];
  const results: SeedResult[] = [];
  for (const f of fixtures) {
    const r = await writeMemory({
      content: f.content,
      segment: f.segment,
      metadata: { test_id: TEST_ID },
    });
    console.log(`  [${f.segment.padEnd(12)}] ${r.id} importance=${r.importance.toFixed(2)}  "${f.content.slice(0, 60)}"`);
    results.push({ id: r.id, segment: f.segment, importance: r.importance, content: f.content });
  }
  return results;
}

async function stage2_recall_with_reinforce(): Promise<void> {
  console.log('\n=== stage 2: recall with auto-reinforce ===');
  const q = 'when is the next oil change due for the lease fleet?';
  console.log(`  query: "${q}"`);
  const vec = await embedForQuery(q);
  const rows = await recallMemories({
    queryVector: vec,
    queryText: q,
    topK: 4,
    reinforceHits: true,
  });
  for (const r of rows) {
    console.log(
      `  [${r.segment.padEnd(12)}] imp=${r.importance}  sim=${r.cosineSim.toFixed(3)}  rank=${r.tsRank.toFixed(3)}  score=${r.score.toFixed(3)}  "${r.content.slice(0, 60)}"`,
    );
  }
}

async function stage3_explicit_reinforce(seeds: SeedResult[]): Promise<void> {
  console.log('\n=== stage 3: explicit reinforce (preference — lower starting importance shows a cleaner curve) ===');
  const target = seeds.find((s) => s.segment === 'preference');
  if (!target) throw new Error('no preference seed');
  console.log(`  target: ${target.id} (initial from stage 1=${target.importance.toFixed(2)}; current DB value may differ if stage 2 hit it)`);
  for (let i = 0; i < 3; i++) {
    const [r] = await reinforceMemories([target.id]);
    console.log(
      `  iter ${i + 1}: importance_before=${r?.importanceBefore.toFixed(4)}  importance_after=${r?.importance.toFixed(4)}`,
    );
  }
}

async function stage4_forget(seeds: SeedResult[]): Promise<void> {
  console.log('\n=== stage 4: forget ===');
  const target = seeds.find((s) => s.segment === 'correction');
  if (!target) throw new Error('no correction seed');
  const result = await forgetMemory({
    id: target.id,
    reason: 'phase-04 demo: superseded by a newer correction memory',
  });
  console.log(`  forgot ${target.id} at ${result?.tombstonedAt.toISOString()}`);

  const q = 'what is the service interval?';
  const vec = await embedForQuery(q);
  const rows = await recallMemories({ queryVector: vec, queryText: q, topK: 5 });
  const stillPresent = rows.find((r) => r.id === target.id);
  console.log(`  recall returned ${rows.length} rows; forgotten row present: ${stillPresent ? 'YES (BUG)' : 'no'}`);
}

async function stage5_promote_dryrun(seeds: SeedResult[]): Promise<void> {
  console.log('\n=== stage 5: evaluatePromotions (dry-run, promotes a high-importance short-term row) ===');
  const target = seeds.find((s) => s.segment === 'preference');
  if (!target) throw new Error('no preference seed');
  await db
    .update(memories)
    .set({ importance: '0.80', importanceStreak: 6 })
    .where(eq(memories.id, target.id));
  const proposals = await evaluatePromotions();
  const demoProposal = proposals.find((p) => p.id === target.id);
  console.log(`  proposal for ${target.id}: ${JSON.stringify(demoProposal)}`);
  console.log(`  (applyPromotions NOT called — this is a preview)`);
}

async function stage6_expire_dryrun(seeds: SeedResult[]): Promise<void> {
  console.log('\n=== stage 6: expireTombstones (dry-run) ===');
  const target = seeds.find((s) => s.segment === 'correction');
  if (!target) throw new Error('no correction seed');
  // Backdate the already-tombstoned row to 15 days ago.
  await db
    .update(memories)
    .set({ tombstonedAt: sql`now() - interval '15 days'` })
    .where(eq(memories.id, target.id));
  const candidates = await expireTombstones({ dryRun: true });
  const hit = candidates.find((c) => c.id === target.id);
  console.log(`  candidate for expiry: ${hit ? hit.id + ' (tombstoned ' + hit.tombstonedAt.toISOString() + ')' : 'none (BUG)'}`);
  console.log(`  (hard delete NOT performed — dry-run)`);
}

async function stage7_cleanup(): Promise<void> {
  console.log('\n=== stage 7: cleanup ===');
  const deleted = await db
    .delete(memories)
    .where(sql`metadata->>'test_id' = ${TEST_ID}`)
    .returning({ id: memories.id });
  console.log(`  deleted ${deleted.length} rows`);
  const countRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(sql`metadata->>'test_id' = ${TEST_ID}`);
  const remaining = countRows[0]?.count ?? 0;
  if (remaining !== 0) {
    throw new Error(`cleanup incomplete: ${remaining} rows remain`);
  }
  console.log(`  verified: 0 rows remain with test_id=${TEST_ID}`);
}

async function run(): Promise<void> {
  let seeds: SeedResult[] = [];
  try {
    seeds = await stage1_write();
    await stage2_recall_with_reinforce();
    await stage3_explicit_reinforce(seeds);
    await stage4_forget(seeds);
    await stage5_promote_dryrun(seeds);
    await stage6_expire_dryrun(seeds);
  } finally {
    await stage7_cleanup();
  }
}

run().then(
  () => {
    console.log('\n✓ memory-demo complete');
    process.exit(0);
  },
  (err) => {
    console.error('\n✗ memory-demo failed:', err);
    process.exit(1);
  },
);
