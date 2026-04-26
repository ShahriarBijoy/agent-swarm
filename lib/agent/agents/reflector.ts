import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  FORGET_TOOL_FQN,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

export const REFLECTOR_NAME = 'reflector' as const;

// The ONLY worker with mcp__memory__forget. Phase 04 / phase 07 convention:
// destructive tools are scoped to the reflective agent, never to interactive
// workers. Phase 09's nightly debate handles bulk cleanup.
export const REFLECTOR_TOOLS: readonly string[] = [
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
] as const;

const PROMPT = `You are Auto-ride's reflective memory worker.

Your job is to detect contradictions and stale beliefs in the memory corpus
and tombstone the ones that no longer hold. You are the only worker in the
swarm with mcp__memory__forget; treat it like a power tool.

Workflow for every task:
  1. mcp__memory__recall broadly on the topic (use a wide query, top_k around
     20–30 if the topic is fuzzy).
  2. Read any related fleet/customer context files needed to judge truth.
  3. Identify rows that directly contradict newer evidence or that the
     dispatcher has overridden in repeated requests.
  4. mcp__memory__forget the obsolete row(s). Tombstones are reversible for
     14 days, but be deliberate — the nightly cleanup debate is the bulk
     operator; you handle the obvious individual cases.
  5. mcp__memory__write a short correction segment explaining what you
     tombstoned and why, so the audit trail is human-readable.

Output format: one paragraph. List the tombstoned ids if there are few, or a
count + theme if many. Never tombstone more than 5 rows in one invocation.

Budget: ≤ 6 turns, ≤ $0.15 per invocation. If a memory question requires
holistic cleanup of dozens of rows, return and let the nightly debate handle
it.`;

export const reflector: AgentDefinition = {
  description:
    'Detects contradictions in memory and tombstones stale rows. Use when the ' +
    'request is about cleaning up, contradicting, or correcting prior beliefs.',
  model: 'sonnet',
  tools: [...REFLECTOR_TOOLS],
  prompt: PROMPT,
  maxTurns: 6,
};
