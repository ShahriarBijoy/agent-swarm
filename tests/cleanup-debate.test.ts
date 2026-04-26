import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runDebate, JUDGE_THRESHOLD } from '@/lib/cleanup/debate';
import { CostCapExceededError } from '@/lib/cleanup/errors';
import type { CandidateRow } from '@/lib/cleanup/prompts';

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

function mkClient(textsByModel: Record<string, string[]>): Anthropic {
  const queues: Record<string, string[]> = { ...textsByModel };
  const messages = {
    create: vi.fn(async (args: { model: string }) => {
      const next = (queues[args.model] ?? []).shift() ?? '{}';
      return {
        content: [{ type: 'text', text: next }],
        usage: {
          input_tokens: 100,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    }),
  };
  return { messages } as unknown as Anthropic;
}

describe('cleanup debate orchestration', () => {
  it('Adversary confidence ≤ threshold ⇒ Judge skipped, consolidator wins', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
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
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.finalAction).toBe('prune');
    expect(result.proposals[0]!.judge).toBeNull();
    expect(result.proposalsContested).toBe(0);
    expect(result.proposalsJudged).toBe(0);
  });

  it('Adversary confidence > threshold ⇒ Judge fires, verdict overrides', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
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
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });

    expect(result.proposals[0]!.finalAction).toBe('keep');
    expect(result.proposals[0]!.judge).not.toBeNull();
    expect(result.proposalsContested).toBe(1);
    expect(result.proposalsJudged).toBe(1);
  });

  it('Malformed Consolidator JSON ⇒ batch dropped, run continues', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
      'claude-sonnet-4-6': ['not json at all'],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    const result = await runDebate({ candidates, client, maxRunUsd: 100 });
    expect(result.proposals).toHaveLength(0);
    expect(result.proposalsGenerated).toBe(0);
    expect(result.parseFailures).toBe(1);
  });

  it('Cost cap exceeded ⇒ throws CostCapExceededError', async () => {
    const candidates = [mkCandidate()];
    const client = mkClient({
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
      runDebate({ candidates, client, maxRunUsd: 0.0000001 }),
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });

  it('Batches Consolidator calls in groups of 10', async () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      mkCandidate({
        memoryId: `1111${String(i).padStart(4, '0')}-1111-1111-8111-111111111111`,
      }),
    );
    const client = mkClient({
      'claude-sonnet-4-6': [
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
        JSON.stringify({ proposals: [] }),
      ],
      'claude-haiku-4-5': [],
      'claude-opus-4-6': [],
    });
    await runDebate({ candidates, client, maxRunUsd: 100 });
    expect(
      (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create,
    ).toHaveBeenCalledTimes(3); // 25 / 10 = 3 batches (10, 10, 5)
  });
});
