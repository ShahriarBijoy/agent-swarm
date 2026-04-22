import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import type { SegmentValue } from '@/db/queries/memory-recall';
import { embedForDocument } from '@/lib/embeddings';

export interface WriteArgs {
  content: string;
  segment: SegmentValue;
  metadata?: Record<string, unknown>;
}

export interface WriteResult {
  id: string;
  bucket: 'short';
  importance: number;
}

/**
 * Create a new memory. Server owns bucket ('short') and importance
 * (memory_segment_config.default_importance for the segment). Embedding
 * is computed via Gemini embedForDocument.
 */
export async function writeMemory(args: WriteArgs): Promise<WriteResult> {
  const embedding = await embedForDocument(args.content);

  const [row] = await db
    .insert(memories)
    .values({
      segment: args.segment,
      // bucket omitted — column defaults to 'short'.
      content: args.content,
      embedding,
      importance: sql`(SELECT default_importance FROM memory_segment_config WHERE segment = ${args.segment})`,
      metadata: args.metadata ?? {},
    })
    .returning({
      id: memories.id,
      bucket: memories.bucket,
      importance: memories.importance,
    });

  if (!row) {
    throw new Error(`writeMemory: INSERT returned no rows`);
  }

  return {
    id: row.id,
    bucket: 'short',
    importance: Number(row.importance),
  };
}
