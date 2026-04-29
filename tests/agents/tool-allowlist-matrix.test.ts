import { describe, it, expect } from 'vitest';
import { agentRegistry } from '@/lib/agent/agents';
import {
  QUERY_VEHICLES_FQN,
  COMPUTE_ROUTE_FQN,
  QUOTE_RENTAL_FQN,
  CHECK_VEHICLE_HEALTH_FQN,
  GET_TRIP_STATUS_FQN,
  QUERY_CUSTOMER_HISTORY_FQN,
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
} from '@/lib/mcp/domain';

const MATRIX: Record<string, string[]> = {
  'fleet-analyst': [QUERY_VEHICLES_FQN, CHECK_VEHICLE_HEALTH_FQN],
  'route-optimizer': [COMPUTE_ROUTE_FQN],
  'maintenance-planner': [CHECK_VEHICLE_HEALTH_FQN],
  'billing': [QUOTE_RENTAL_FQN, PROPOSE_RENTAL_FQN, CHARGE_INVOICE_FQN],
  'support': [GET_TRIP_STATUS_FQN, QUERY_CUSTOMER_HISTORY_FQN],
  'analytics-reporter': [QUERY_VEHICLES_FQN, QUERY_CUSTOMER_HISTORY_FQN],
};

describe('domain tool allowlist matrix', () => {
  for (const [name, expected] of Object.entries(MATRIX)) {
    it(`${name} allows exactly ${expected.length} domain tools`, () => {
      const agent = agentRegistry[name as keyof typeof agentRegistry];
      const domainTools = (agent.tools ?? []).filter((t: string) =>
        t.startsWith('mcp__auto-ride-domain__'),
      );
      expect(domainTools.sort()).toEqual(expected.sort());
    });
  }

  it('reflector + driver-coach + incident-responder + compliance-auditor have no new domain tools', () => {
    for (const name of ['reflector', 'driver-coach', 'incident-responder', 'compliance-auditor']) {
      const agent = agentRegistry[name as keyof typeof agentRegistry];
      const domainTools = (agent.tools ?? []).filter((t: string) =>
        t.startsWith('mcp__auto-ride-domain__'),
      );
      expect(domainTools).toEqual([]);
    }
  });
});
