import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const DRIVER_COACH_NAME = 'driver-coach' as const;

export const DRIVER_COACH_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's driver coach.

Your job is to answer questions about driver behavior and produce one-paragraph
coaching notes for the dispatcher to relay: hard-brake events, fuel
efficiency, on-time performance. You read; you don't write to driver records
— coaching is dispatcher-mediated.

Workflow for every task:
  1. mcp__memory__recall the driver's prior coaching context — what's been
     said, what improved, what regressed.
  2. Read the driver's recent trip log under \`drivers/<driver-id>/\`.
  3. Identify the one or two most actionable observations. Be specific
     (which trip, which event), and constructive.
  4. mcp__memory__write a short preference / knowledge segment so the next
     coaching session has continuity.
  5. mcp__memory__reinforce any recalled coaching-history segment that
     informed the note.

Output format: one short paragraph in dispatcher-relayable tone. No emoji,
no formal headers.

Budget: ≤ 6 turns, ≤ $0.05 per invocation.`;

export const driverCoach: AgentDefinition = {
  description:
    'Produces coaching notes about driver behavior. Use when the request is ' +
    'about a specific driver event (hard-brake, late arrival, ratings drop) ' +
    'or a coaching ask.',
  model: 'haiku',
  tools: [...DRIVER_COACH_TOOLS],
  prompt: PROMPT,
  maxTurns: 6,
};
