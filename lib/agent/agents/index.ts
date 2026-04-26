import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

import { fleetAnalyst, FLEET_ANALYST_NAME } from './fleet-analyst';
import { maintenancePlanner, MAINTENANCE_PLANNER_NAME } from './maintenance-planner';
import { billing, BILLING_NAME } from './billing';
import { support, SUPPORT_NAME } from './support';
import { reflector, REFLECTOR_NAME } from './reflector';
import { routeOptimizer, ROUTE_OPTIMIZER_NAME } from './route-optimizer';
import { incidentResponder, INCIDENT_RESPONDER_NAME } from './incident-responder';
import { driverCoach, DRIVER_COACH_NAME } from './driver-coach';
import { complianceAuditor, COMPLIANCE_AUDITOR_NAME } from './compliance-auditor';
import { analyticsReporter, ANALYTICS_REPORTER_NAME } from './analytics-reporter';

/**
 * The full phase-08 swarm. Order matters: this is the order the dispatcher's
 * system prompt prefix lists workers in, which subtly biases routing toward
 * the earlier ones. Re-ordering changes demo behavior — be deliberate.
 *
 * The `as const satisfies Record<string, AgentDefinition>` pattern gives us
 *   1. a literal-string `AgentName` union (typo in registry access = type error), and
 *   2. structural validation that every entry is a valid AgentDefinition.
 *
 * Phase 08 design: 1 dispatcher (Opus 4.7) + 10 workers = 11 agents, matching
 * the project name. Adding an 11th worker breaks the headcount math; do NOT
 * extend without revisiting the design spec.
 */
export const agentRegistry = {
  [FLEET_ANALYST_NAME]: fleetAnalyst,
  [MAINTENANCE_PLANNER_NAME]: maintenancePlanner,
  [BILLING_NAME]: billing,
  [SUPPORT_NAME]: support,
  [REFLECTOR_NAME]: reflector,
  [ROUTE_OPTIMIZER_NAME]: routeOptimizer,
  [INCIDENT_RESPONDER_NAME]: incidentResponder,
  [DRIVER_COACH_NAME]: driverCoach,
  [COMPLIANCE_AUDITOR_NAME]: complianceAuditor,
  [ANALYTICS_REPORTER_NAME]: analyticsReporter,
} as const satisfies Record<string, AgentDefinition>;

export type AgentName = keyof typeof agentRegistry;

export const AGENT_NAMES: readonly AgentName[] = Object.keys(agentRegistry) as AgentName[];

/**
 * Soft per-invocation $ budget per worker. Spec §6.2 — observability-only in
 * phase 08; runtime tags `tool_call` (Agent) events with this value so phase
 * 10's per-agent dashboard can show actual-vs-budget. Phase 12's cost
 * aggregator turns this into an enforceable cap.
 */
export const AGENT_SOFT_BUDGET_USD: Readonly<Record<AgentName, number>> = {
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
};
