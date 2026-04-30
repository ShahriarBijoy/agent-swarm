import { describe, it, expect } from 'vitest';
import { agentRegistry } from '@/lib/agent/agents';

const REQUIRED: Record<string, string[]> = {
  'fleet-analyst': ['query_vehicles', 'check_vehicle_health'],
  'route-optimizer': ['compute_route'],
  'maintenance-planner': ['check_vehicle_health'],
  'billing': ['quote_rental', 'propose_rental', 'charge_invoice'],
  'support': ['get_trip_status', 'query_customer_history'],
  'analytics-reporter': ['query_vehicles', 'query_customer_history'],
};

describe('rental prompt coverage', () => {
  for (const [name, mustMention] of Object.entries(REQUIRED)) {
    it(`${name} prompt mentions ${mustMention.join(', ')}`, () => {
      const agent = agentRegistry[name as keyof typeof agentRegistry];
      for (const tool of mustMention) {
        expect(agent.prompt).toContain(tool);
      }
    });
  }
});
