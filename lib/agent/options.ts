import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk';
import {
  FORGET_TOOL_FQN,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
  memoryMcpServer,
} from '@/lib/mcp/memory';
import {
  DOMAIN_SERVER_NAME,
  READ_DOMAIN_TOOL_FQNS,
  domainMcpServer,
} from '@/lib/mcp/domain';
import { agentRegistry } from '@/lib/agent/agents';
import { A2A_SERVER_NAME, createA2AMcpServer, parseRemoteAgents } from '@/lib/mcp/a2a';
import { auditPreToolUse } from '@/lib/agent/hooks';

// Opus 4.7 full ID — full IDs ARE accepted on the orchestrator (only short
// aliases are accepted on subagents per plan §3 footgun #2). Phase 08
// promotes the dispatcher because routing under uncertainty is exactly
// Opus's wheelhouse.
export const ORCHESTRATOR_MODEL = 'claude-opus-4-7' as const;

// Phase 08 raises the per-run cap to absorb a worst-case Opus dispatcher +
// 7-worker fan-out + one approved gate. Phase-05 demo at $0.5 / 20 turns is
// too tight for any swarm topology — even two haiku workers + one approval
// round-trip pushes past it once Opus is dispatching. The SDK still aborts
// the run mid-turn when the cap is crossed.
export const DEFAULT_MAX_BUDGET_USD = 1.5;
export const DEFAULT_MAX_TURNS = 25;
export const DEFAULT_MAX_THINKING_TOKENS = 8192;

// `allowedTools` is the SDK's auto-allow fast-path: tools listed here skip
// the canUseTool callback entirely (per @anthropic-ai/claude-agent-sdk
// JSDoc: "auto-allowed without prompting for permission"). Bash and Write
// are deliberately omitted so phase-07's canUseTool gate fires for them.
// Phase 10.5 also omits the two write-side domain tools (propose_rental,
// charge_invoice) so they go through the canUseTool gate as rental-confirm
// and payment-charge respectively. The 6 read-side domain tools auto-allow.
export const ORCHESTRATOR_ALLOWED_TOOLS: readonly string[] = [
  'Agent',
  'Read',
  RECALL_TOOL_FQN,
  WRITE_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  FORGET_TOOL_FQN,
  ...READ_DOMAIN_TOOL_FQNS,
] as const;

export type BuildOrchestratorOptionsOverrides = {
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  cwd?: string;
  /**
   * Phase-07 HITL gate. When set, the SDK pauses on each tool call and
   * routes the decision through this callback. Undefined = allow-all
   * within `allowedTools` (phase-05 CLI path).
   */
  canUseTool?: CanUseTool;
  /**
   * Phase 13 — raw A2A_REMOTE_AGENTS JSON. Defaults to the env var; tests
   * pass it explicitly. Unset/empty = no `a2a` MCP server at all.
   */
  remoteA2AAgents?: string;
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
  const a2aServer = createA2AMcpServer(
    parseRemoteAgents(overrides.remoteA2AAgents ?? process.env.A2A_REMOTE_AGENTS),
  );
  return {
    model: ORCHESTRATOR_MODEL,
    agents: agentRegistry,
    allowedTools: [...ORCHESTRATOR_ALLOWED_TOOLS],
    mcpServers: {
      [MEMORY_SERVER_NAME]: memoryMcpServer,
      [DOMAIN_SERVER_NAME]: domainMcpServer,
      // Phase 13 — external A2A agents, only when the operator configured
      // some. Deliberately NOT in allowedTools: every call goes through the
      // canUseTool approval gate (see approval-policy.ts).
      ...(a2aServer ? { [A2A_SERVER_NAME]: a2aServer } : {}),
    },
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [auditPreToolUse] }],
    },
    permissionMode: 'default',
    maxBudgetUsd: overrides.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    maxTurns: overrides.maxTurns ?? DEFAULT_MAX_TURNS,
    maxThinkingTokens: overrides.maxThinkingTokens ?? DEFAULT_MAX_THINKING_TOKENS,
    settingSources: ['project'],
    cwd: overrides.cwd ?? process.cwd(),
    ...(overrides.canUseTool ? { canUseTool: overrides.canUseTool } : {}),
  };
}
