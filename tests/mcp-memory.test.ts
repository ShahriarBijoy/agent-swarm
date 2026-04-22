import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedForQuery: vi.fn(),
  embedForDocument: vi.fn(),
  l2Normalize: (v: number[]) => v,
  EMBEDDING_DIMS: 1536,
  EMBEDDING_MODEL: 'stub',
}));

vi.mock('@/db/queries/memory-recall', () => ({
  recallMemories: vi.fn(),
}));

import { embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';
import {
  memoryMcpServer,
  recallTool,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
} from '@/lib/mcp/memory';

describe('memoryMcpServer', () => {
  it('exposes one recall tool under name "memory"', () => {
    expect(MEMORY_SERVER_NAME).toBe('memory');
    expect(RECALL_TOOL_FQN).toBe('mcp__memory__recall');
    expect(memoryMcpServer).toBeDefined();
    expect(recallTool.name).toBe('recall');
  });

  it('handler returns JSON-stringified rows on success', async () => {
    const rows = [{ id: 'a', score: 0.9 }];
    (embedForQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
    );
    (recallMemories as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    const result = await recallTool.handler(
      { query: 'hello', segment: undefined, top_k: 5 },
      undefined,
    );

    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    expect(first?.type).toBe('text');
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(JSON.parse(first.text)).toEqual(rows);
  });

  it('handler returns isError on embedding failure (does not throw)', async () => {
    (embedForQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('gemini down'),
    );
    const result = await recallTool.handler(
      { query: 'hi', segment: undefined, top_k: 3 },
      undefined,
    );

    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toMatch(/recall failed.*gemini down/i);
  });
});
