import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';
import { writeMemory } from '@/db/queries/memory-write';
import { forgetMemory } from '@/db/queries/memory-forget';
import { reinforceMemories } from '@/db/queries/memory-lifecycle';
import { segmentEnum } from '@/db/schema/enums';

/** Zod enum of segments, built once from the pg enum's literal values. */
const segmentSchema = z.enum(segmentEnum.enumValues);

export const MEMORY_SERVER_NAME = 'memory' as const;
export const RECALL_TOOL_FQN = 'mcp__memory__recall' as const;
export const WRITE_TOOL_FQN = 'mcp__memory__write' as const;
export const REINFORCE_TOOL_FQN = 'mcp__memory__reinforce' as const;
export const FORGET_TOOL_FQN = 'mcp__memory__forget' as const;

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
        reinforceHits: true,
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

export const writeTool = tool(
  'write',
  'Store a new memory. Supply content and a segment; importance and bucket are assigned from segment defaults. Returns the new memory id.',
  {
    content: z
      .string()
      .min(1)
      .describe('The memory content. Will be embedded via Gemini for retrieval.'),
    segment: segmentSchema.describe(
      'Which of the seven segments this memory belongs to.',
    ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional structured tags (e.g., vehicle_id, customer_id).'),
  },
  async (args) => {
    try {
      const result = await writeMemory({
        content: args.content,
        segment: args.segment,
        metadata: args.metadata,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `write failed: ${msg}` }],
      };
    }
  },
  { annotations: { readOnlyHint: false } },
);

export const reinforceTool = tool(
  'reinforce',
  'Boost importance of a specific memory (diminishing-returns formula: I ← min(1, I + 0.05·(1 − I))). Use when the agent acts on a recalled memory and wants to mark it as useful without re-querying.',
  {
    memory_id: z.string().uuid().describe('UUID of the memory to reinforce.'),
  },
  async (args) => {
    try {
      const results = await reinforceMemories([args.memory_id]);
      if (results.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `reinforce failed: memory ${args.memory_id} not found or already tombstoned`,
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(results[0], null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `reinforce failed: ${msg}` }],
      };
    }
  },
  { annotations: { readOnlyHint: false, idempotentHint: false } },
);

export const forgetTool = tool(
  'forget',
  'Mark a memory as forgotten (soft-delete via tombstone). Tombstoned memories do not appear in recall and are hard-deleted after 14 days. Provide a reason for auditability.',
  {
    memory_id: z.string().uuid().describe('UUID of the memory to forget.'),
    reason: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Why this memory is being forgotten (stored in metadata.tombstone_reason).',
      ),
  },
  async (args) => {
    try {
      const result = await forgetMemory({
        id: args.memory_id,
        reason: args.reason,
      });
      if (!result) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `forget failed: memory ${args.memory_id} not found or already tombstoned`,
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `forget failed: ${msg}` }],
      };
    }
  },
  { annotations: { readOnlyHint: false, destructiveHint: true } },
);

export const memoryMcpServer = createSdkMcpServer({
  name: MEMORY_SERVER_NAME,
  version: '1.0.0',
  tools: [recallTool, writeTool, reinforceTool, forgetTool],
});
