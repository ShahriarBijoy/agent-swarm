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

vi.mock('@/db/queries/memory-write', () => ({
  writeMemory: vi.fn(),
}));

vi.mock('@/db/queries/memory-forget', () => ({
  forgetMemory: vi.fn(),
}));

vi.mock('@/db/queries/memory-lifecycle', () => ({
  reinforceMemories: vi.fn(),
  evaluatePromotions: vi.fn(),
  applyPromotions: vi.fn(),
  expireTombstones: vi.fn(),
  PROMOTE_LONG_STREAK_DAYS: 7,
  PROMOTE_PERMANENT_STREAK_DAYS: 30,
  FAST_TRACK_STREAK_DAYS: 3,
  TOMBSTONE_EXPIRY_DAYS: 14,
}));

import { embedForQuery } from '@/lib/embeddings';
import { recallMemories } from '@/db/queries/memory-recall';
import { writeMemory } from '@/db/queries/memory-write';
import { forgetMemory } from '@/db/queries/memory-forget';
import { reinforceMemories } from '@/db/queries/memory-lifecycle';
import {
  memoryMcpServer,
  recallTool,
  writeTool,
  reinforceTool,
  forgetTool,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
} from '@/lib/mcp/memory';

describe('memoryMcpServer', () => {
  it('exposes four tools under name "memory"', () => {
    expect(MEMORY_SERVER_NAME).toBe('memory');
    expect(RECALL_TOOL_FQN).toBe('mcp__memory__recall');
    expect(WRITE_TOOL_FQN).toBe('mcp__memory__write');
    expect(REINFORCE_TOOL_FQN).toBe('mcp__memory__reinforce');
    expect(FORGET_TOOL_FQN).toBe('mcp__memory__forget');
    expect(memoryMcpServer).toBeDefined();
    expect(recallTool.name).toBe('recall');
    expect(writeTool.name).toBe('write');
    expect(reinforceTool.name).toBe('reinforce');
    expect(forgetTool.name).toBe('forget');
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

describe('writeTool', () => {
  it('returns JSON body on success', async () => {
    (writeMemory as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'uuid-1',
      bucket: 'short',
      importance: 0.6,
    });
    const result = await writeTool.handler(
      { content: 'c', segment: 'knowledge', metadata: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(JSON.parse(first.text)).toEqual({
      id: 'uuid-1',
      bucket: 'short',
      importance: 0.6,
    });
  });

  it('returns isError on embed/db failure (does not throw)', async () => {
    (writeMemory as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('embed failed'),
    );
    const result = await writeTool.handler(
      { content: 'x', segment: 'knowledge', metadata: undefined },
      undefined,
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toMatch(/write failed.*embed failed/i);
  });
});

describe('reinforceTool', () => {
  it('returns before/after importance as JSON', async () => {
    (reinforceMemories as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'uuid-1', importanceBefore: 0.5, importance: 0.525 },
    ]);
    const result = await reinforceTool.handler(
      { memory_id: '00000000-0000-0000-0000-000000000001' },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text);
    expect(body).toEqual({
      id: 'uuid-1',
      importanceBefore: 0.5,
      importance: 0.525,
    });
  });

  it('returns isError on missing / tombstoned id (empty results)', async () => {
    (reinforceMemories as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await reinforceTool.handler(
      { memory_id: '00000000-0000-0000-0000-000000000002' },
      undefined,
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toMatch(/not found or already tombstoned/);
  });
});

describe('forgetTool', () => {
  it('returns JSON on success', async () => {
    const now = new Date();
    (forgetMemory as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'uuid-1',
      tombstonedAt: now,
    });
    const result = await forgetTool.handler(
      {
        memory_id: '00000000-0000-0000-0000-000000000001',
        reason: 'bye',
      },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text);
    expect(body.id).toBe('uuid-1');
  });

  it('returns isError when row is missing or already tombstoned', async () => {
    (forgetMemory as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await forgetTool.handler(
      { memory_id: '00000000-0000-0000-0000-000000000002', reason: undefined },
      undefined,
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toMatch(/not found or already tombstoned/);
  });
});

describe('tool annotations', () => {
  function annotations(t: unknown): Record<string, unknown> {
    // The SDK stores annotations on an `annotations` or `_annotations` property.
    // Treat the tool as opaque and grab whichever is present.
    const maybe = t as { annotations?: Record<string, unknown>; _annotations?: Record<string, unknown> };
    return maybe.annotations ?? maybe._annotations ?? {};
  }

  it('recallTool is readOnlyHint:true', () => {
    expect(annotations(recallTool).readOnlyHint).toBe(true);
  });

  it('writeTool is readOnlyHint:false', () => {
    expect(annotations(writeTool).readOnlyHint).toBe(false);
  });

  it('reinforceTool is idempotentHint:false', () => {
    expect(annotations(reinforceTool).idempotentHint).toBe(false);
  });

  it('forgetTool is destructiveHint:true', () => {
    expect(annotations(forgetTool).destructiveHint).toBe(true);
  });
});
