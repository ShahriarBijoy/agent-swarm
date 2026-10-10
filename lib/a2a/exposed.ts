import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { agentRegistry, type AgentName } from '@/lib/agent/agents';
import { FORGET_TOOL_FQN, REINFORCE_TOOL_FQN, WRITE_TOOL_FQN } from '@/lib/mcp/memory';
import { WRITE_DOMAIN_TOOL_FQNS } from '@/lib/mcp/domain';

/**
 * Phase 13 — which Auto-Ride workers are reachable over A2A, and with what.
 *
 * Only analysis workers are exposed. Workers that move money or send things
 * (billing, support, incident-responder, ...) depend on the operator's HITL
 * approval loop, which has no counterpart for an external A2A caller, so they
 * stay internal. Exposed workers also lose every write-side tool: an external
 * agent can ask questions about the fleet, never change it, and never write
 * to or reshape the swarm's long-term memory.
 */
export const A2A_EXPOSED_AGENTS = ['fleet-analyst', 'route-optimizer', 'analytics-reporter'] as const satisfies
  readonly AgentName[];

export type A2AExposedAgent = (typeof A2A_EXPOSED_AGENTS)[number];

/** The worker the host-level `/.well-known/agent-card.json` describes. */
export const A2A_PRIMARY_AGENT: A2AExposedAgent = 'fleet-analyst';

const WRITE_SIDE_TOOLS: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'Agent',
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
  ...WRITE_DOMAIN_TOOL_FQNS,
]);

export function isA2AExposedAgent(name: string): name is A2AExposedAgent {
  return (A2A_EXPOSED_AGENTS as readonly string[]).includes(name);
}

export function exposedAgentDefinition(name: A2AExposedAgent): AgentDefinition {
  return agentRegistry[name];
}

/** The worker's tool allowlist with every write-side tool removed. */
export function readOnlyToolsFor(definition: AgentDefinition): string[] {
  return (definition.tools ?? []).filter((t) => !WRITE_SIDE_TOOLS.has(t));
}
