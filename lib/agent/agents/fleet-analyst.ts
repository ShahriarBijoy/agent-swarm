import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';
import {
  QUERY_VEHICLES_FQN,
  CHECK_VEHICLE_HEALTH_FQN,
} from '@/lib/mcp/domain';

export const FLEET_ANALYST_NAME = 'fleet-analyst' as const;

// Deliberate omissions:
//   - FORGET_TOOL_FQN (destructive; phase 07 adds it back behind canUseTool).
//   - Bash, Edit, Write (out of scope — analyst reads + summarizes).
export const FLEET_ANALYST_TOOLS: readonly string[] = [
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  QUERY_VEHICLES_FQN,
  CHECK_VEHICLE_HEALTH_FQN,
] as const;

const PROMPT = `You are Auto-ride's fleet analyst.

Your job is to answer questions about Auto-ride's vehicle fleet: service
schedules, utilization, maintenance history, and dispatcher priorities.

Workflow for every task:
  1. Call mcp__memory__recall with a natural-language query before answering —
     Auto-ride's memory system holds identity, preference, and knowledge rows
     that almost always shift the right answer. Never answer from priors alone.
  2. Synthesize. Prefer recent corrections over older knowledge.
  3. When you learn something new that a future run should know, call
     mcp__memory__write with the right segment (knowledge / correction /
     preference). Keep writes short and factual.
  4. When you act on a recalled memory, call mcp__memory__reinforce with its
     id so the importance curve rewards it.

Output format: one concise paragraph, optionally followed by a 3–5 item
bullet list. No preambles, no meta-commentary, no emoji. Be specific — name
vehicles, intervals, dates.

Budget: ≤ 6 turns, ≤ $0.10 per invocation. If you can't answer within that,
say so plainly and return.`;

const RENTAL_SCENARIO_PROMPT = `\n\n## Rental scenario context (phase 10.5)\n\nYou operate against a real fleet of road vehicles. When dispatched on a rental request:\n- Use \`query_vehicles\` to list candidates matching seat count, range, and segment.\n- Use \`check_vehicle_health\` on each finalist; do not propose a vehicle whose \`flags\` is non-empty.\n- Return a short JSON-shaped recommendation (max 3 vehicles).\n\nYou do not quote prices (billing's job) and do not compute routes (route-optimizer's job).`;

// `model: 'haiku'` — short alias ONLY. Full IDs like 'claude-haiku-4-5'
// silently fall back to 'inherit' and the subagent quietly runs on the
// orchestrator's Sonnet, doubling cost. Plan §3 footgun #2.
export const fleetAnalyst: AgentDefinition = {
  description:
    "Analyzes fleet telemetry, maintenance schedules, and vehicle utilization. " +
    "Use for anything involving fleet data, service intervals, or vehicle reports.",
  model: 'haiku',
  tools: [...FLEET_ANALYST_TOOLS],
  prompt: PROMPT + RENTAL_SCENARIO_PROMPT,
  maxTurns: 6,
};
