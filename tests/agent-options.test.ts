import { describe, it, expect } from 'vitest';
import {
  buildOrchestratorOptions,
  ORCHESTRATOR_ALLOWED_TOOLS,
  ORCHESTRATOR_MODEL,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_THINKING_TOKENS,
} from '@/lib/agent/options';
import { AGENT_NAMES, agentRegistry } from '@/lib/agent/agents';
import {
  FORGET_TOOL_FQN,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

describe('buildOrchestratorOptions — phase 08', () => {
  it('uses Opus 4.7 (full ID OK on the orchestrator; only short aliases on subagents)', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.model).toBe('claude-opus-4-7');
    expect(ORCHESTRATOR_MODEL).toBe('claude-opus-4-7');
  });

  it('sources `agents` from the full registry — exactly the ten workers, by reference', () => {
    const opts = buildOrchestratorOptions();
    expect(Object.keys(opts.agents ?? {})).toHaveLength(10);
    for (const name of AGENT_NAMES) {
      expect(opts.agents?.[name]).toBe(agentRegistry[name]);
    }
  });

  it('keeps the phase-07 allowedTools list — Bash + Write still excluded so canUseTool gates them', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.allowedTools).toEqual([
      'Agent',
      'Read',
      RECALL_TOOL_FQN,
      WRITE_TOOL_FQN,
      REINFORCE_TOOL_FQN,
      FORGET_TOOL_FQN,
    ]);
    expect([...ORCHESTRATOR_ALLOWED_TOOLS]).toEqual(opts.allowedTools);
    expect(opts.allowedTools).not.toContain('Bash');
    expect(opts.allowedTools).not.toContain('Write');
  });

  it('promotes default caps: $1.5 budget, 25 turns, 8192 thinking tokens', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.maxBudgetUsd).toBe(1.5);
    expect(opts.maxTurns).toBe(25);
    expect(opts.maxThinkingTokens).toBe(8192);
    expect(DEFAULT_MAX_BUDGET_USD).toBe(1.5);
    expect(DEFAULT_MAX_TURNS).toBe(25);
    expect(DEFAULT_MAX_THINKING_TOKENS).toBe(8192);
  });

  it('honors override values over the new defaults', () => {
    const opts = buildOrchestratorOptions({
      maxBudgetUsd: 0.1,
      maxTurns: 3,
      maxThinkingTokens: 1024,
      cwd: '/tmp/override',
    });
    expect(opts.maxBudgetUsd).toBe(0.1);
    expect(opts.maxTurns).toBe(3);
    expect(opts.maxThinkingTokens).toBe(1024);
    expect(opts.cwd).toBe('/tmp/override');
  });

  it('omits canUseTool by default and threads it when supplied', () => {
    const noOverride = buildOrchestratorOptions();
    expect(noOverride.canUseTool).toBeUndefined();

    const stub = async () => ({ behavior: 'allow' as const, updatedInput: {} });
    const withOverride = buildOrchestratorOptions({ canUseTool: stub });
    expect(withOverride.canUseTool).toBe(stub);
  });

  it('registers the memory MCP server under MEMORY_SERVER_NAME', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers?.[MEMORY_SERVER_NAME]).toBeDefined();
  });

  it('wires auditPreToolUse as a PreToolUse hook with a catch-all matcher', () => {
    const opts = buildOrchestratorOptions();
    const preMatchers = opts.hooks?.PreToolUse ?? [];
    expect(preMatchers).toHaveLength(1);
    expect(preMatchers[0]?.matcher).toBe('.*');
    expect(preMatchers[0]?.hooks).toHaveLength(1);
  });

  it('keeps permissionMode=default and settingSources=[project]', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.permissionMode).toBe('default');
    expect(opts.settingSources).toEqual(['project']);
  });
});
