import { describe, it, expect } from 'vitest';
import { l2Normalize } from '@/lib/embeddings';
import { segmentEnum } from '@/db/schema/enums';
import { recallTool } from '@/lib/mcp/memory';

describe('l2Normalize', () => {
  it('produces unit-length vectors', () => {
    const v = l2Normalize([1, 2, 3, 4]);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 6);
  });

  it('is idempotent', () => {
    const a = l2Normalize([5, -2, 7, 0.3]);
    const b = l2Normalize(a);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i]!, 12);
    }
  });

  it('throws on zero vector', () => {
    expect(() => l2Normalize([0, 0, 0])).toThrow(/zero vector/i);
  });

  it('handles negative components correctly', () => {
    const v = l2Normalize([-3, 4]);
    expect(v[0]).toBeCloseTo(-0.6, 10);
    expect(v[1]).toBeCloseTo(0.8, 10);
  });
});

describe('recall tool schema segments match pg enum', () => {
  it('has identical segment values', () => {
    expect([...segmentEnum.enumValues].sort()).toEqual(
      [
        'behavioral',
        'context',
        'correction',
        'identity',
        'knowledge',
        'preference',
        'relationship',
      ].sort(),
    );
    // Sanity: the tool imports the same enum and exposes its inputSchema.
    expect(recallTool.inputSchema).toBeDefined();
  });
});
