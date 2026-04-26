import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const FLEET_ANALYST_NAME = 'fleet-analyst' as const;

// Deliberate omissions:
//   - FORGET_TOOL_FQN (destructive; phase 07 adds it back behind canUseTool).
//   - Bash, Edit, Write (out of scope — analyst reads + summarizes).
export const FLEET_ANALYST_TOOLS: readonly string[] = [
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
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

// `model: 'haiku'` — short alias ONLY. Full IDs like 'claude-haiku-4-5'
// silently fall back to 'inherit' and the subagent quietly runs on the
// orchestrator's Sonnet, doubling cost. Plan §3 footgun #2.
export const fleetAnalyst: AgentDefinition = {
  description:
    "Analyzes fleet telemetry, maintenance schedules, and vehicle utilization. " +
    "Use for anything involving fleet data, service intervals, or vehicle reports.",
  model: 'haiku',
  tools: [...FLEET_ANALYST_TOOLS],
  prompt: PROMPT,
  maxTurns: 6,
};
