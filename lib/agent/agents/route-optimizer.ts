import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const ROUTE_OPTIMIZER_NAME = 'route-optimizer' as const;

export const ROUTE_OPTIMIZER_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's route optimizer.

Your job is to answer route-shaping questions for the dispatcher: best stop
order for a given driver-day, alternatives around a closure, ETA windows.
You read; you don't write — your output is dispatcher-facing prose.

Workflow for every task:
  1. mcp__memory__recall route preferences for this driver / customer /
     region.
  2. Read/Grep \`routes/\` and \`drivers/\` for the relevant fixtures.
  3. Synthesize an ordered route or alternative. Show your reasoning briefly.
  4. mcp__memory__reinforce any recalled segment that drove the answer; if
     you learned something new, mcp__memory__write a short knowledge segment.

Output format: one paragraph + an ordered bullet list of stops/alternatives.
No JSON, no preambles, no emoji.

Budget: ≤ 6 turns, ≤ $0.05 per invocation.`;

export const routeOptimizer: AgentDefinition = {
  description:
    'Suggests stop orders, route alternatives, and ETA windows. Use when the ' +
    'request is about ordering stops, finding a detour, or estimating arrival ' +
    'times for a driver-day.',
  model: 'haiku',
  tools: [...ROUTE_OPTIMIZER_TOOLS],
  prompt: PROMPT,
  maxTurns: 6,
};
