import type { Options } from '@anthropic-ai/claude-agent-sdk';
import {
  FORGET_TOOL_FQN,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
  memoryMcpServer,
} from '@/lib/mcp/memory';
import { FLEET_ANALYST_NAME, fleetAnalyst } from '@/lib/agent/fleet-analyst';
import { auditPreToolUse } from '@/lib/agent/hooks';

export const ORCHESTRATOR_MODEL = 'claude-sonnet-4-6' as const;

// Defensive defaults. Every phase-05 `query()` is hard-capped; the demo sets
// tighter bounds as a second line of defense.
export const DEFAULT_MAX_BUDGET_USD = 0.5;
export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_THINKING_TOKENS = 8192;

export const ORCHESTRATOR_ALLOWED_TOOLS: readonly string[] = [
  'Agent',
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
] as const;

export type BuildOrchestratorOptionsOverrides = {
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  cwd?: string;
};

/**
 * Constructs the Claude Agent SDK Options for the phase-05 orchestrator run.
 *
 * Exported (instead of inlined in runtime.ts) so the definition test suite
 * can assert on allowedTools / model / agents / hooks without touching the
 * DB or starting an SDK session.
 */
export function buildOrchestratorOptions(
  overrides: BuildOrchestratorOptionsOverrides = {},
): Options {
  return {
    model: ORCHESTRATOR_MODEL,
    agents: { [FLEET_ANALYST_NAME]: fleetAnalyst },
    allowedTools: [...ORCHESTRATOR_ALLOWED_TOOLS],
    mcpServers: { [MEMORY_SERVER_NAME]: memoryMcpServer },
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [auditPreToolUse] }],
    },
    permissionMode: 'default',
    maxBudgetUsd: overrides.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    maxTurns: overrides.maxTurns ?? DEFAULT_MAX_TURNS,
    maxThinkingTokens: overrides.maxThinkingTokens ?? DEFAULT_MAX_THINKING_TOKENS,
    settingSources: ['project'],
    cwd: overrides.cwd ?? process.cwd(),
  };
}
