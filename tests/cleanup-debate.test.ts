import { describe, expect, it, vi } from 'vitest';
import { runDebate, JUDGE_THRESHOLD } from '@/lib/cleanup/debate';
import { CostCapExceededError } from '@/lib/cleanup/errors';
import type { CandidateRow } from '@/lib/cleanup/prompts';
import type { LlmCall } from '@/lib/cleanup/llm';

function mkCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    candidateKind: 'prune',
    memoryId: '11111111-1111-1111-8111-111111111111',
    targetMemoryId: null,
    segment: 'preference',
    bucket: 'short',
    content: 'test',
    importance: '0.10',
    effImp: 0.05,
    cosineDistance: null,
    targetContent: null,
    ...overrides,
  };
}

function mkLlm(textsByModel: Record<string, string[]>): {
  llm: LlmCall;
  spy: ReturnType<typeof vi.fn>;
} {
  const queues: Record<string, string[]> = { ...textsByModel };
  const spy = vi.fn(async (args: { model: string }) => {
    const next = (queues[args.model] ?? []).shift() ?? '{}';
    return {
      text: next,
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  });
  return { llm: spy as unknown as LlmCall, spy };
}

describe('cleanup debate orchestration', () => {
  it('Adversary confidence ≤ threshold ⇒ Judge skipped, consolidator wins', async () => {
    const candidates = [mkCandidate()];
    const { llm } = mkLlm({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          adversaryConfidence: JUDGE_THRESHOLD - 0.1,
          objection: 'maybe',
        }),
      ],
      'claude-opus-4-6': [], // never called
    });
    const result = await runDebate({ candidates, llm, maxRunUsd: 100 });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.finalAction).toBe('prune');
    expect(result.proposals[0]!.judge).toBeNull();
    expect(result.proposalsContested).toBe(0);
    expect(result.proposalsJudged).toBe(0);
  });

  it('Adversary confidence > threshold ⇒ Judge fires, verdict overrides', async () => {
    const candidates = [mkCandidate()];
    const { llm } = mkLlm({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          adversaryConfidence: JUDGE_THRESHOLD + 0.1,
          objection: 'might be needed',
        }),
      ],
      'claude-opus-4-6': [
        JSON.stringify({
          memoryId: candidates[0]!.memoryId,
          finalAction: 'keep',
          reasoning: 'asymmetric loss',
        }),
      ],
    });
    const result = await runDebate({ candidates, llm, maxRunUsd: 100 });

    expect(result.proposals[0]!.finalAction).toBe('keep');
    expect(result.proposals[0]!.judge).not.toBeNull();
    expect(result.proposalsContested).toBe(1);
    expect(result.proposalsJudged).toBe(1);
  });

  it('Malformed Consolidator JSON ⇒ batch dropped, run continues', async () => {
    const candidates = [mkCandidate()];
    const { llm } = mkLlm({
      'claude-sonnet-4-6': ['not json at all'],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    const result = await runDebate({ candidates, llm, maxRunUsd: 100 });
    expect(result.proposals).toHaveLength(0);
    expect(result.proposalsGenerated).toBe(0);
    expect(result.parseFailures).toBe(1);
  });

  it('Cost cap exceeded ⇒ throws CostCapExceededError', async () => {
    const candidates = [mkCandidate()];
    const { llm } = mkLlm({
      'claude-sonnet-4-6': [
        JSON.stringify({
          proposals: [
            {
              memoryId: candidates[0]!.memoryId,
              action: 'prune',
              reasoning: 'low',
              confidence: 0.9,
            },
          ],
        }),
      ],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    await expect(
      runDebate({ candidates, llm, maxRunUsd: 0.0000001 }),
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });

  it('Batches Consolidator calls in groups of 10', async () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      mkCandidate({
        memoryId: `1111${String(i).padStart(4, '0')}-1111-1111-8111-111111111111`,
      }),
    );
    const { llm, spy } = mkLlm({
      'claude-sonnet-4-6': [
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
      ],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    await runDebate({ candidates, llm, maxRunUsd: 100 });
    expect(spy).toHaveBeenCalledTimes(3); // 25 / 10 = 3 batches (10, 10, 5)
  });
});
