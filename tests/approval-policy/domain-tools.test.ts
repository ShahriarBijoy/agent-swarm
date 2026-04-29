import { describe, it, expect } from 'vitest';
import { shouldRequireApproval } from '@/lib/agent/approval-policy';
import {
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
  QUERY_VEHICLES_FQN,
  QUOTE_RENTAL_FQN,
} from '@/lib/mcp/domain';

describe('shouldRequireApproval — domain tools', () => {
  it('gates propose_rental', () => {
    expect(shouldRequireApproval(PROPOSE_RENTAL_FQN, {}))
      .toEqual({ require: true, reason: expect.stringContaining('rental') });
  });

  it('gates charge_invoice', () => {
    expect(shouldRequireApproval(CHARGE_INVOICE_FQN, {}))
      .toEqual({ require: true, reason: expect.stringContaining('payment') });
  });

  it('does not gate query_vehicles', () => {
    expect(shouldRequireApproval(QUERY_VEHICLES_FQN, {}))
      .toEqual({ require: false });
  });

  it('does not gate quote_rental', () => {
    expect(shouldRequireApproval(QUOTE_RENTAL_FQN, {}))
      .toEqual({ require: false });
  });

  // FQN matching is case-sensitive; a differently-cased name must not trigger the gate.
  it('gate is case-sensitive (uppercase variant does not gate)', () => {
    expect(shouldRequireApproval('MCP__AUTO-RIDE-DOMAIN__PROPOSE_RENTAL', {}))
      .toEqual({ require: false });
    expect(shouldRequireApproval('MCP__AUTO-RIDE-DOMAIN__CHARGE_INVOICE', {}))
      .toEqual({ require: false });
  });

  // Unknown domain read tools fall through to the default pass-through.
  it('unknown domain tool defaults to no gate', () => {
    expect(shouldRequireApproval('mcp__auto-ride-domain__some_future_tool', {}))
      .toEqual({ require: false });
  });
});
