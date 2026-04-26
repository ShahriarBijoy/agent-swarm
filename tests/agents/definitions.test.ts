import { describe, it, expect } from 'vitest';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  FORGET_TOOL_FQN,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

import { fleetAnalyst, FLEET_ANALYST_NAME, FLEET_ANALYST_TOOLS } from '@/lib/agent/agents/fleet-analyst';
import { maintenancePlanner, MAINTENANCE_PLANNER_NAME, MAINTENANCE_PLANNER_TOOLS } from '@/lib/agent/agents/maintenance-planner';
import { billing, BILLING_NAME, BILLING_TOOLS } from '@/lib/agent/agents/billing';
import { support, SUPPORT_NAME, SUPPORT_TOOLS } from '@/lib/agent/agents/support';
import { reflector, REFLECTOR_NAME, REFLECTOR_TOOLS } from '@/lib/agent/agents/reflector';
import { routeOptimizer, ROUTE_OPTIMIZER_NAME, ROUTE_OPTIMIZER_TOOLS } from '@/lib/agent/agents/route-optimizer';
import { incidentResponder, INCIDENT_RESPONDER_NAME, INCIDENT_RESPONDER_TOOLS } from '@/lib/agent/agents/incident-responder';
import { driverCoach, DRIVER_COACH_NAME, DRIVER_COACH_TOOLS } from '@/lib/agent/agents/driver-coach';
import { complianceAuditor, COMPLIANCE_AUDITOR_NAME, COMPLIANCE_AUDITOR_TOOLS } from '@/lib/agent/agents/compliance-auditor';
import { analyticsReporter, ANALYTICS_REPORTER_NAME, ANALYTICS_REPORTER_TOOLS } from '@/lib/agent/agents/analytics-reporter';

type AgentFixture = {
  name: string;
  agent: AgentDefinition;
  expectedTools: readonly string[];
  expectedModel: 'haiku' | 'sonnet';
  expectedMaxTurns: number;
  allowsForget: boolean;
};

// Spec §2 — keep this table 1:1 with the registry. Order matches the
// dispatcher's prompt prefix, which subtly biases routing toward earlier rows.
const AGENT_FIXTURES: readonly AgentFixture[] = [
  { name: FLEET_ANALYST_NAME,        agent: fleetAnalyst,        expectedTools: FLEET_ANALYST_TOOLS,        expectedModel: 'haiku',  expectedMaxTurns: 6, allowsForget: false },
  { name: MAINTENANCE_PLANNER_NAME,  agent: maintenancePlanner,  expectedTools: MAINTENANCE_PLANNER_TOOLS,  expectedModel: 'sonnet', expectedMaxTurns: 8, allowsForget: false },
  { name: BILLING_NAME,              agent: billing,             expectedTools: BILLING_TOOLS,              expectedModel: 'sonnet', expectedMaxTurns: 6, allowsForget: false },
  { name: SUPPORT_NAME,              agent: support,             expectedTools: SUPPORT_TOOLS,              expectedModel: 'sonnet', expectedMaxTurns: 8, allowsForget: false },
  { name: REFLECTOR_NAME,            agent: reflector,           expectedTools: REFLECTOR_TOOLS,            expectedModel: 'sonnet', expectedMaxTurns: 6, allowsForget: true  },
  { name: ROUTE_OPTIMIZER_NAME,      agent: routeOptimizer,      expectedTools: ROUTE_OPTIMIZER_TOOLS,      expectedModel: 'haiku',  expectedMaxTurns: 6, allowsForget: false },
  { name: INCIDENT_RESPONDER_NAME,   agent: incidentResponder,   expectedTools: INCIDENT_RESPONDER_TOOLS,   expectedModel: 'sonnet', expectedMaxTurns: 8, allowsForget: false },
  { name: DRIVER_COACH_NAME,         agent: driverCoach,         expectedTools: DRIVER_COACH_TOOLS,         expectedModel: 'haiku',  expectedMaxTurns: 6, allowsForget: false },
  { name: COMPLIANCE_AUDITOR_NAME,   agent: complianceAuditor,   expectedTools: COMPLIANCE_AUDITOR_TOOLS,   expectedModel: 'haiku',  expectedMaxTurns: 6, allowsForget: false },
  { name: ANALYTICS_REPORTER_NAME,   agent: analyticsReporter,   expectedTools: ANALYTICS_REPORTER_TOOLS,   expectedModel: 'haiku',  expectedMaxTurns: 6, allowsForget: false },
];

describe('per-agent definitions', () => {
  it('asserts ten fixtures (1 dispatcher + 10 workers = 11; spec §2)', () => {
    expect(AGENT_FIXTURES).toHaveLength(10);
  });

  describe.each(AGENT_FIXTURES)('$name', ({ name, agent, expectedTools, expectedModel, expectedMaxTurns, allowsForget }) => {
    it('uses the short model alias (full IDs silently fall back to "inherit"; spec footgun #2)', () => {
      expect(agent.model).toBe(expectedModel);
      expect(agent.model).not.toMatch(/^claude-/);
    });

    it('declares an explicit tools array (registry-wide contract — never inherit from parent)', () => {
      expect(agent.tools).toBeDefined();
      expect(Array.isArray(agent.tools)).toBe(true);
    });

    it('exposes exactly the declared tool surface', () => {
      expect(agent.tools).toEqual([...expectedTools]);
    });

    it('has the expected maxTurns from the agent table', () => {
      expect(agent.maxTurns).toBe(expectedMaxTurns);
    });

    it('has a non-trivial system prompt and a routing-quality description', () => {
      expect(agent.prompt.length).toBeGreaterThan(100);
      expect(agent.description.length).toBeGreaterThan(20);
    });

    it('mentions the memory recall tool in its prompt (spec §2 — recall is non-optional)', () => {
      expect(agent.prompt).toContain('mcp__memory__recall');
    });

    it(`${allowsForget ? 'includes' : 'omits'} mcp__memory__forget per the destructive-only-on-reflector rule`, () => {
      if (allowsForget) {
        expect(agent.tools).toContain(FORGET_TOOL_FQN);
      } else {
        expect(agent.tools).not.toContain(FORGET_TOOL_FQN);
      }
    });

    it('includes recall, write, and reinforce memory tools (every worker needs the basics)', () => {
      expect(agent.tools).toContain(RECALL_TOOL_FQN);
      expect(agent.tools).toContain(WRITE_TOOL_FQN);
      expect(agent.tools).toContain(REINFORCE_TOOL_FQN);
    });

    it('exports a non-empty *_NAME literal', () => {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  it('mcp__memory__forget appears in exactly one worker (reflector)', () => {
    const withForget = AGENT_FIXTURES.filter((f) => f.agent.tools?.includes(FORGET_TOOL_FQN));
    expect(withForget.map((f) => f.name)).toEqual([REFLECTOR_NAME]);
  });
});
