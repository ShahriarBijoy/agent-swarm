import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';
import { segmentEnum } from '@/db/schema/enums';

/** Zod enum of segments, built once from the pg enum's literal values. */
const segmentSchema = z.enum(segmentEnum.enumValues);

export const MEMORY_SERVER_NAME = 'memory' as const;
export const RECALL_TOOL_FQN = 'mcp__memory__recall' as const;

export const recallTool = tool(
  'recall',
  'Retrieve memories relevant to a query. Returns top-K results ranked by hybrid score ' +
    '(cosine similarity + full-text rank + importance decay). Segment filter optional.',
  {
    query: z
      .string()
      .min(1)
      .describe('Natural-language query to search memories for'),
    segment: segmentSchema
      .optional()
      .describe('Restrict to one segment; omit to search all segments.'),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(8)
      .describe('Max rows to return (default 8, cap 50)'),
  },
  async (args) => {
    try {
      const queryVector = await embedForQuery(args.query);
      const rows = await recallMemories({
        queryVector,
        queryText: args.query,
        segment: args.segment,
        topK: args.top_k,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `recall failed: ${msg}` }],
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

export const memoryMcpServer = createSdkMcpServer({
  name: MEMORY_SERVER_NAME,
  version: '1.0.0',
  tools: [recallTool],
});
