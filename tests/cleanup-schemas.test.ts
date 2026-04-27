import { describe, expect, it } from 'vitest';
import {
  ConsolidatorBatchSchema,
  AdversaryResponseSchema,
  JudgeVerdictSchema,
  parseAdversarySafe,
  parseJudgeSafe,
} from '@/lib/cleanup/schemas';

describe('cleanup schemas', () => {
  it('parses a valid Consolidator batch', () => {
    const batch = ConsolidatorBatchSchema.parse({
      proposals: [
        {
          memoryId: '11111111-1111-1111-8111-111111111111',
          action: 'prune',
          reasoning: 'low importance',
          confidence: 0.8,
        },
      ],
    });
    expect(batch.proposals[0]!.action).toBe('prune');
  });

  it('rejects Consolidator output with confidence > 1', () => {
    expect(() =>
      ConsolidatorBatchSchema.parse({
        proposals: [
          {
            memoryId: '11111111-1111-1111-8111-111111111111',
            action: 'merge',
            reasoning: 'x',
            confidence: 1.5,
          },
        ],
      }),
    ).toThrow();
  });

  it('parseAdversarySafe falls back to confidence 0.0 on garbage', () => {
    const result = parseAdversarySafe('not even json');
    expect(result.adversaryConfidence).toBe(0.0);
    expect(result.objection).toBe('');
  });

  it('parseAdversarySafe falls back when memoryId is missing', () => {
    const result = parseAdversarySafe(JSON.stringify({ adversaryConfidence: 0.5 }));
    expect(result.adversaryConfidence).toBe(0.0);
  });

  it('parseAdversarySafe accepts valid JSON', () => {
    const result = parseAdversarySafe(
      JSON.stringify({
        memoryId: '11111111-1111-1111-8111-111111111111',
        adversaryConfidence: 0.85,
        objection: 'might be needed',
      }),
    );
    expect(result.adversaryConfidence).toBe(0.85);
    expect(result.objection).toBe('might be needed');
  });

  it('parseJudgeSafe falls back to finalAction "keep" on garbage', () => {
    const result = parseJudgeSafe('garbage');
    expect(result.finalAction).toBe('keep');
  });

  it('parseJudgeSafe accepts valid JSON', () => {
    const result = parseJudgeSafe(
      JSON.stringify({
        memoryId: '11111111-1111-1111-8111-111111111111',
        finalAction: 'prune',
        reasoning: 'low value confirmed',
      }),
    );
    expect(result.finalAction).toBe('prune');
  });

  it('parseAdversarySafe handles ```json fence wrapping', () => {
    const fenced =
      '```json\n{"memoryId":"11111111-1111-1111-8111-111111111111","adversaryConfidence":0.9,"objection":"test"}\n```';
    const result = parseAdversarySafe(fenced);
    expect(result.adversaryConfidence).toBe(0.9);
  });
});
