import { describe, expect, it } from 'vitest';
import {
  computeCallCostUsd,
  ROLE_MODEL,
  PRICING,
} from '@/lib/cleanup/cost-tracker';

describe('cost-tracker', () => {
  it('computes Sonnet 4.6 cost from input + output tokens', () => {
    // Sonnet pricing: $3 / Mtok input, $15 / Mtok output
    const cost = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it('computes Haiku 4.5 cost cheaper than Sonnet', () => {
    const sonnet = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    const haiku = computeCallCostUsd(ROLE_MODEL.adversary, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(haiku).toBeLessThan(sonnet);
  });

  it('applies cache-read discount (10% of input rate)', () => {
    const noCache = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    const fullCache = computeCallCostUsd(ROLE_MODEL.consolidator, {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    expect(fullCache).toBeCloseTo(noCache * 0.1, 6);
  });

  it('zero-token call costs zero', () => {
    expect(
      computeCallCostUsd(ROLE_MODEL.judge, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ).toBe(0);
  });

  it('PRICING table has entries for all three role models', () => {
    expect(PRICING[ROLE_MODEL.consolidator]).toBeDefined();
    expect(PRICING[ROLE_MODEL.adversary]).toBeDefined();
    expect(PRICING[ROLE_MODEL.judge]).toBeDefined();
  });
});
