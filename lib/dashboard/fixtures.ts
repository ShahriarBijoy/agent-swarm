// lib/dashboard/fixtures.ts
import type { GreetingSnapshot, AllAgentsSnapshot, ActiveWorkersSnapshot } from './queries';

export const FIXTURE_GREETING: GreetingSnapshot = {
  months: [
    { label: 'may', count: 8 },
    { label: 'jun', count: 14 },
    { label: 'jul', count: 22 },
    { label: 'aug', count: 31 },
    { label: 'sep', count: 47 },
    { label: 'oct', count: 84 },
  ],
  totalThisMonth: 247,
  totalLastMonth: 163,
  monthCostUsd: 14.62,
};

export const FIXTURE_ALL_AGENTS: AllAgentsSnapshot = {
  avgCostPerTask: 0.34,
  perAgentCost: [
    { agent: 'dispatcher', cost: 4.2 },
    { agent: 'fleet-analyst', cost: 1.8 },
    { agent: 'billing', cost: 2.1 },
    { agent: 'support', cost: 0.6 },
  ],
  avgP95LatencyMs: 2400,
  perAgentP95: [
    { agent: 'billing', ms: 4200 },
    { agent: 'fleet-analyst', ms: 1900 },
  ],
};

export const FIXTURE_ACTIVE_WORKERS: ActiveWorkersSnapshot = {
  activeAgentNames: ['fleet-analyst', 'billing', 'reflector'],
  totalAgents: 11,
};
