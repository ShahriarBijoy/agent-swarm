import { describe, expect, it } from 'vitest';
import { createTaskBodySchema } from '@/lib/validation/task-body';

describe('phase-06 createTaskBodySchema', () => {
  describe('valid bodies', () => {
    it('accepts a minimal {prompt} body', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'Check the fleet.' });
      expect(r.success).toBe(true);
    });

    it('accepts a full body with maxBudgetUsd + maxTurns', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxBudgetUsd: 0.5,
        maxTurns: 10,
      });
      expect(r.success).toBe(true);
    });

    it('accepts a 4000-char prompt (upper bound)', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'a'.repeat(4000) });
      expect(r.success).toBe(true);
    });

    it('accepts maxBudgetUsd=0 (edge lower)', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxBudgetUsd: 0,
      });
      expect(r.success).toBe(true);
    });

    it('accepts maxBudgetUsd=5.0 (edge upper)', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxBudgetUsd: 5.0,
      });
      expect(r.success).toBe(true);
    });

    it('accepts maxTurns=100 (edge upper)', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxTurns: 100,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('invalid bodies', () => {
    it('rejects missing prompt', () => {
      const r = createTaskBodySchema.safeParse({});
      expect(r.success).toBe(false);
    });

    it('rejects empty prompt', () => {
      const r = createTaskBodySchema.safeParse({ prompt: '' });
      expect(r.success).toBe(false);
    });

    it('rejects prompt > 4000 chars', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'a'.repeat(4001) });
      expect(r.success).toBe(false);
    });

    it('rejects non-string prompt', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 123 });
      expect(r.success).toBe(false);
    });

    it('rejects negative maxBudgetUsd', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxBudgetUsd: -0.1,
      });
      expect(r.success).toBe(false);
    });

    it('rejects maxBudgetUsd > 5.0', () => {
      const r = createTaskBodySchema.safeParse({
        prompt: 'p',
        maxBudgetUsd: 5.01,
      });
      expect(r.success).toBe(false);
    });

    it('rejects maxTurns = 0', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'p', maxTurns: 0 });
      expect(r.success).toBe(false);
    });

    it('rejects maxTurns > 100', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'p', maxTurns: 101 });
      expect(r.success).toBe(false);
    });

    it('rejects non-integer maxTurns', () => {
      const r = createTaskBodySchema.safeParse({ prompt: 'p', maxTurns: 3.5 });
      expect(r.success).toBe(false);
    });

    it('rejects null body', () => {
      const r = createTaskBodySchema.safeParse(null);
      expect(r.success).toBe(false);
    });
  });
});
