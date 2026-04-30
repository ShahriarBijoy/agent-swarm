import { describe, it, expect } from 'vitest';
import { invoices } from '@/db/schema/domain';

describe('GET /api/invoices schema shape', () => {
  it('invoices table has status + amount columns', () => {
    expect(invoices.status).toBeDefined();
    expect(invoices.totalUsd).toBeDefined();
    expect(invoices.amountUsd).toBeDefined();
    expect(invoices.taxUsd).toBeDefined();
    expect(invoices.dueAt).toBeDefined();
    expect(invoices.paidAt).toBeDefined();
  });

  it('invoices references trips and customers', () => {
    expect(invoices.tripId).toBeDefined();
    expect(invoices.customerId).toBeDefined();
  });
});
