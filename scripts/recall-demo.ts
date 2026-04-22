// Env is loaded by `tsx --env-file=.env.local` in package.json's `recall:demo` script.
// Running this file directly without that flag will fail env validation in lib/env.ts.
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import { embedForDocument, embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';

const TEST_ID = 'phase-03-demo';

const fixtures = [
  {
    segment: 'knowledge' as const,
    importance: '0.80',
    content: 'Lease vehicle oil change is due every 5000 miles or 6 months.',
  },
  {
    segment: 'knowledge' as const,
    importance: '0.60',
    content: 'Tire rotation interval is 10000 miles for standard fleet trucks.',
  },
  {
    segment: 'preference' as const,
    importance: '0.70',
    content:
      'Dispatcher prefers morning maintenance windows between 07:00 and 10:00.',
  },
  {
    segment: 'knowledge' as const,
    importance: '0.50',
    content: 'Brake inspection at 20000 miles; replace pads if under 4 mm.',
  },
  {
    segment: 'knowledge' as const,
    importance: '0.65',
    content:
      'The next scheduled oil change for unit L-42 (lease) is in 300 miles.',
  },
];

async function run(): Promise<void> {
  try {
    console.log(`seeding ${fixtures.length} memories…`);
    for (const f of fixtures) {
      const embedding = await embedForDocument(f.content);
      await db.insert(memories).values({
        segment: f.segment,
        content: f.content,
        importance: f.importance,
        embedding,
        metadata: { test_id: TEST_ID },
      });
    }

    const question = 'when is the next oil change due for my lease vehicle?';
    console.log(`querying: ${question}`);
    const queryVector = await embedForQuery(question);
    const rows = await recallMemories({
      queryVector,
      queryText: question,
      topK: 5,
    });

    console.log('\ntop results:');
    for (const r of rows) {
      console.log(
        [
          `  [${r.segment}]`,
          `sim=${Number(r.cosineSim).toFixed(3)}`,
          `rank=${Number(r.tsRank).toFixed(3)}`,
          `eff=${Number(r.effectiveImportance).toFixed(3)}`,
          `score=${Number(r.score).toFixed(3)}`,
          `| ${r.content}`,
        ].join(' '),
      );
    }
  } finally {
    console.log('\ncleaning up demo seeds…');
    await db.delete(memories).where(sql`metadata->>'test_id' = ${TEST_ID}`);
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error('demo failed:', err);
    process.exit(1);
  },
);
