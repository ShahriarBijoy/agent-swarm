import { describe, it, expect } from 'vitest';
import {
  AGENT_NAMES,
  AGENT_SOFT_BUDGET_USD,
  agentRegistry,
  type AgentName,
} from '@/lib/agent/agents';
import { fleetAnalyst, FLEET_ANALYST_NAME } from '@/lib/agent/agents/fleet-analyst';
import { maintenancePlanner, MAINTENANCE_PLANNER_NAME } from '@/lib/agent/agents/maintenance-planner';
import { billing, BILLING_NAME } from '@/lib/agent/agents/billing';
import { support, SUPPORT_NAME } from '@/lib/agent/agents/support';
import { reflector, REFLECTOR_NAME } from '@/lib/agent/agents/reflector';
import { routeOptimizer, ROUTE_OPTIMIZER_NAME } from '@/lib/agent/agents/route-optimizer';
import { incidentResponder, INCIDENT_RESPONDER_NAME } from '@/lib/agent/agents/incident-responder';
import { driverCoach, DRIVER_COACH_NAME } from '@/lib/agent/agents/driver-coach';
import { complianceAuditor, COMPLIANCE_AUDITOR_NAME } from '@/lib/agent/agents/compliance-auditor';
import { analyticsReporter, ANALYTICS_REPORTER_NAME } from '@/lib/agent/agents/analytics-reporter';

describe('agentRegistry', () => {
  it('contains exactly ten workers (1 dispatcher + 10 = 11 agents; spec §1)', () => {
    expect(Object.keys(agentRegistry)).toHaveLength(10);
  });

  it('exposes every worker under its declared name', () => {
    expect(agentRegistry[FLEET_ANALYST_NAME]).toBe(fleetAnalyst);
    expect(agentRegistry[MAINTENANCE_PLANNER_NAME]).toBe(maintenancePlanner);
    expect(agentRegistry[BILLING_NAME]).toBe(billing);
    expect(agentRegistry[SUPPORT_NAME]).toBe(support);
    expect(agentRegistry[REFLECTOR_NAME]).toBe(reflector);
    expect(agentRegistry[ROUTE_OPTIMIZER_NAME]).toBe(routeOptimizer);
    expect(agentRegistry[INCIDENT_RESPONDER_NAME]).toBe(incidentResponder);
    expect(agentRegistry[DRIVER_COACH_NAME]).toBe(driverCoach);
    expect(agentRegistry[COMPLIANCE_AUDITOR_NAME]).toBe(complianceAuditor);
    expect(agentRegistry[ANALYTICS_REPORTER_NAME]).toBe(analyticsReporter);
  });

  it('AGENT_NAMES enumerates the registry keys in the dispatcher prompt order', () => {
    expect(AGENT_NAMES).toEqual([
      FLEET_ANALYST_NAME,
      MAINTENANCE_PLANNER_NAME,
      BILLING_NAME,
      SUPPORT_NAME,
      REFLECTOR_NAME,
      ROUTE_OPTIMIZER_NAME,
      INCIDENT_RESPONDER_NAME,
      DRIVER_COACH_NAME,
      COMPLIANCE_AUDITOR_NAME,
      ANALYTICS_REPORTER_NAME,
    ]);
  });

  it('AGENT_NAMES is a valid AgentName[] (compile-time check via assignment)', () => {
    const names: readonly AgentName[] = AGENT_NAMES;
    expect(names.length).toBe(10);
  });

  it('all keys are unique (Object.keys would lose duplicates so length == set size)', () => {
    const keys = Object.keys(agentRegistry);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('AGENT_SOFT_BUDGET_USD', () => {
  it('has an entry for every agent in the registry (no orphan budgets, no missing budgets)', () => {
    const budgetKeys = new Set(Object.keys(AGENT_SOFT_BUDGET_USD));
    const registryKeys = new Set(Object.keys(agentRegistry));
    expect(budgetKeys).toEqual(registryKeys);
  });

  it('matches spec §2 column 4 values', () => {
    expect(AGENT_SOFT_BUDGET_USD).toEqual({
      'fleet-analyst': 0.05,
      'maintenance-planner': 0.20,
      billing: 0.20,
      support: 0.25,
      reflector: 0.15,
      'route-optimizer': 0.05,
      'incident-responder': 0.25,
      'driver-coach': 0.05,
      'compliance-auditor': 0.05,
      'analytics-reporter': 0.05,
    });
  });

  it('every budget is positive and at or below $0.30 (sanity bound; no worker should exceed dispatcher cap)', () => {
    for (const [name, budget] of Object.entries(AGENT_SOFT_BUDGET_USD)) {
      expect(budget, name).toBeGreaterThan(0);
      expect(budget, name).toBeLessThanOrEqual(0.30);
    }
  });
});
