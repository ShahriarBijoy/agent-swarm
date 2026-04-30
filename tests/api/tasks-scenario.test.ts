import { describe, it, expect } from 'vitest';
import { createTaskBodySchema } from '@/lib/validation/task-body';

describe('createTaskBodySchema — scenario extension', () => {
  it('accepts kind=scenario with customer_email', () => {
    const r = createTaskBodySchema.safeParse({
      prompt: 'Rent me a sedan for the weekend',
      kind: 'scenario',
      customer_email: 'ana.khan@example.com',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kind).toBe('scenario');
      expect(r.data.customer_email).toBe('ana.khan@example.com');
    }
  });

  it('defaults kind to "default" when omitted', () => {
    const r = createTaskBodySchema.safeParse({ prompt: 'Check fleet' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kind).toBe('default');
    }
  });

  it('accepts kind=scenario without customer_email', () => {
    const r = createTaskBodySchema.safeParse({
      prompt: 'Rent a vehicle',
      kind: 'scenario',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.customer_email).toBeUndefined();
    }
  });

  it('rejects invalid kind', () => {
    const r = createTaskBodySchema.safeParse({
      prompt: 'p',
      kind: 'magic',
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid customer_email', () => {
    const r = createTaskBodySchema.safeParse({
      prompt: 'p',
      kind: 'scenario',
      customer_email: 'not-an-email',
    });
    expect(r.success).toBe(false);
  });
});
