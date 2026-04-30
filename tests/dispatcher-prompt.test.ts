import { describe, it, expect } from 'vitest';
import { buildDispatcherPrompt, DISPATCHER_PREFIX } from '@/lib/agent/dispatcher-prompt';
import { AGENT_NAMES, agentRegistry } from '@/lib/agent/agents';

describe('buildDispatcherPrompt', () => {
  it('prepends the dispatcher prefix to the user prompt', () => {
    const out = buildDispatcherPrompt('Generate invoice for trip T-1.');
    expect(out.startsWith(DISPATCHER_PREFIX)).toBe(true);
    expect(out.endsWith('Generate invoice for trip T-1.')).toBe(true);
  });

  it('the prefix names every registered worker', () => {
    for (const name of AGENT_NAMES) {
      expect(DISPATCHER_PREFIX).toContain(name);
    }
  });

  it('the prefix includes every worker description so the model can route on intent', () => {
    for (const name of AGENT_NAMES) {
      const desc = agentRegistry[name].description;
      expect(DISPATCHER_PREFIX).toContain(desc);
    }
  });

  it("the prefix forbids the dispatcher from doing the workers' jobs (Bash/Write blocked)", () => {
    expect(DISPATCHER_PREFIX).toMatch(/may not write/i);
    expect(DISPATCHER_PREFIX).toMatch(/may not run Bash/i);
  });

  it('the prefix instructs the dispatcher to recall before routing', () => {
    expect(DISPATCHER_PREFIX).toContain('mcp__memory__recall');
  });

  it('the prefix lists workers in the canonical AGENT_NAMES order', () => {
    // First worker name must appear before the second, etc. — order-bias is
    // a feature, not a bug (spec §2). Drift here changes demo behavior.
    let lastIndex = -1;
    for (const name of AGENT_NAMES) {
      const idx = DISPATCHER_PREFIX.indexOf(`- ${name}:`);
      expect(idx, `${name} not found as a worker entry`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('preserves an empty user prompt (defensive — should not crash)', () => {
    const out = buildDispatcherPrompt('');
    expect(out).toBe(DISPATCHER_PREFIX);
  });

  it('the prefix includes the rental routing section (phase 10.5)', () => {
    expect(DISPATCHER_PREFIX).toContain('rental');
    expect(DISPATCHER_PREFIX).toContain('fleet-analyst');
    expect(DISPATCHER_PREFIX).toContain('propose_rental');
  });
});
