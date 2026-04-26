import { describe, it, expect } from 'vitest';
import {
  fleetAnalyst,
  FLEET_ANALYST_NAME,
  FLEET_ANALYST_TOOLS,
} from '@/lib/agent/agents/fleet-analyst';
import {
  buildOrchestratorOptions,
  ORCHESTRATOR_ALLOWED_TOOLS,
  ORCHESTRATOR_MODEL,
} from '@/lib/agent/options';
import {
  FORGET_TOOL_FQN,
  MEMORY_SERVER_NAME,
  RECALL_TOOL_FQN,
  REINFORCE_TOOL_FQN,
  WRITE_TOOL_FQN,
} from '@/lib/mcp/memory';

describe('fleetAnalyst', () => {
  it('uses the short model alias "haiku" (not the full ID)', () => {
    // Critical: AgentDefinition.model only accepts short aliases; a full ID
    // like "claude-haiku-4-5" silently falls back to "inherit". Plan §3.
    expect(fleetAnalyst.model).toBe('haiku');
    expect(fleetAnalyst.model).not.toMatch(/^claude-/);
  });

  it('exposes exactly the expected four tools (Read + recall/write/reinforce)', () => {
    expect(fleetAnalyst.tools).toEqual([
      'Read',
      RECALL_TOOL_FQN,
      WRITE_TOOL_FQN,
      REINFORCE_TOOL_FQN,
    ]);
  });

  it('deliberately does NOT include the destructive forget tool (phase 07 adds it back)', () => {
    expect(fleetAnalyst.tools).not.toContain(FORGET_TOOL_FQN);
  });

  it('has a non-trivial system prompt and a 6-turn cap', () => {
    expect(fleetAnalyst.maxTurns).toBe(6);
    expect(fleetAnalyst.description.length).toBeGreaterThan(20);
    expect(fleetAnalyst.prompt.length).toBeGreaterThan(100);
  });

  it('exports FLEET_ANALYST_NAME as the literal string "fleet-analyst"', () => {
    expect(FLEET_ANALYST_NAME).toBe('fleet-analyst');
  });

  it('FLEET_ANALYST_TOOLS stays in sync with fleetAnalyst.tools', () => {
    expect([...FLEET_ANALYST_TOOLS]).toEqual(fleetAnalyst.tools);
  });
});

describe('buildOrchestratorOptions', () => {
  it('uses the full Sonnet 4.6 model ID on the orchestrator (where full IDs are accepted)', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.model).toBe('claude-sonnet-4-6');
    expect(ORCHESTRATOR_MODEL).toBe('claude-sonnet-4-6');
  });

  it('includes Agent + Read + all four memory FQNs in allowedTools, omits Bash + Write so canUseTool gates them', () => {
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

  it('omits canUseTool by default and threads it when supplied', () => {
    const noOverride = buildOrchestratorOptions();
    expect(noOverride.canUseTool).toBeUndefined();

    const stub = async () => ({ behavior: 'allow' as const });
    const withOverride = buildOrchestratorOptions({ canUseTool: stub });
    expect(withOverride.canUseTool).toBe(stub);
  });

  it('registers the memory MCP server under MEMORY_SERVER_NAME', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers?.[MEMORY_SERVER_NAME]).toBeDefined();
  });

  it('registers fleetAnalyst under FLEET_ANALYST_NAME in the agents record', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.agents?.[FLEET_ANALYST_NAME]).toBe(fleetAnalyst);
  });

  it('wires auditPreToolUse as a PreToolUse hook with a catch-all matcher', () => {
    const opts = buildOrchestratorOptions();
    const preMatchers = opts.hooks?.PreToolUse ?? [];
    expect(preMatchers).toHaveLength(1);
    expect(preMatchers[0]?.matcher).toBe('.*');
    expect(preMatchers[0]?.hooks).toHaveLength(1);
  });

  it('applies the declared defaults when no overrides are passed', () => {
    const opts = buildOrchestratorOptions();
    expect(opts.maxBudgetUsd).toBe(0.5);
    expect(opts.maxTurns).toBe(20);
    expect(opts.maxThinkingTokens).toBe(8192);
    expect(opts.permissionMode).toBe('default');
    expect(opts.settingSources).toEqual(['project']);
  });

  it('honors override values over the declared defaults', () => {
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
});
