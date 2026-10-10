import { AgentCard } from '@a2a-js/sdk';
import { exposedAgentDefinition, type A2AExposedAgent } from '@/lib/a2a/exposed';

/**
 * Phase 13 — A2A Agent Cards for the exposed workers (A2A protocol v1.0).
 *
 * The card is written in the protocol's JSON wire shape and parsed with the
 * SDK's `AgentCard.fromJSON`, so what we serve and what the request handler
 * uses internally can never drift apart.
 */

const SKILLS: Record<A2AExposedAgent, { id: string; name: string; tags: string[]; examples: string[] }> = {
  'fleet-analyst': {
    id: 'fleet-analysis',
    name: 'Fleet analysis',
    tags: ['fleet', 'vehicles', 'maintenance', 'availability'],
    examples: [
      'Which electric vehicles are available right now with at least 300 km range?',
      'Which vehicles are due for service this week?',
    ],
  },
  'route-optimizer': {
    id: 'route-optimization',
    name: 'Route optimization',
    tags: ['routing', 'eta', 'distance'],
    examples: ['What is the driving distance and ETA from Bremen depot to Hamburg Hbf?'],
  },
  'analytics-reporter': {
    id: 'fleet-analytics',
    name: 'Fleet analytics',
    tags: ['analytics', 'utilization', 'trends'],
    examples: ['Summarize vehicle utilization by segment over the seeded trips.'],
  },
};

export const A2A_SECURITY_SCHEME = 'bearer' as const;

export function agentCardJson(agent: A2AExposedAgent, baseUrl: string): Record<string, unknown> {
  const definition = exposedAgentDefinition(agent);
  const skill = SKILLS[agent];
  const origin = baseUrl.replace(/\/+$/, '');
  return {
    name: `Auto-Ride ${skill.name}`,
    description:
      `${definition.description} Exposed over A2A by the Auto-Ride agent swarm. ` +
      'Read-only: answers questions about the fleet, never books, charges or writes memory.',
    version: '0.13.0',
    supportedInterfaces: [
      { url: `${origin}/api/a2a/${agent}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    ],
    provider: { organization: 'Auto-Ride', url: 'https://github.com/ShahriarBijoy/agent-swarm' },
    capabilities: { streaming: true, pushNotifications: false },
    securitySchemes: {
      [A2A_SECURITY_SCHEME]: {
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
          description: 'Shared A2A_API_KEY issued by the Auto-Ride operator.',
        },
      },
    },
    securityRequirements: [{ schemes: { [A2A_SECURITY_SCHEME]: { list: [] } } }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: skill.id,
        name: skill.name,
        description: definition.description,
        tags: skill.tags,
        examples: skill.examples,
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  };
}

export function buildAgentCard(agent: A2AExposedAgent, baseUrl: string): AgentCard {
  return AgentCard.fromJSON(agentCardJson(agent, baseUrl));
}
