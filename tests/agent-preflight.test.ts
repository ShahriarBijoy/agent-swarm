import { describe, it, expect } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import {
  checkDomainWiring,
  assertDomainPreflight,
  PREFLIGHT_ERROR_PREFIX,
} from '@/lib/agent/preflight';
import { buildOrchestratorOptions } from '@/lib/agent/options';
import { DOMAIN_SERVER_NAME } from '@/lib/mcp/domain';
import { MEMORY_SERVER_NAME } from '@/lib/mcp/memory';

describe('checkDomainWiring', () => {
  it('passes (no problems) for the real orchestrator options', () => {
    expect(checkDomainWiring(buildOrchestratorOptions())).toEqual([]);
  });

  it('flags a missing domain MCP server but not the memory one', () => {
    const opts = buildOrchestratorOptions();
    const servers = { ...opts.mcpServers };
    delete servers[DOMAIN_SERVER_NAME];
    const broken: Options = { ...opts, mcpServers: servers };
    const problems = checkDomainWiring(broken);
    expect(problems.some((p) => p.includes(DOMAIN_SERVER_NAME))).toBe(true);
    expect(problems.some((p) => p.includes(MEMORY_SERVER_NAME))).toBe(false);
  });

  it('flags both servers when mcpServers is empty', () => {
    const opts = buildOrchestratorOptions();
    const problems = checkDomainWiring({ ...opts, mcpServers: {} });
    expect(problems.some((p) => p.includes(DOMAIN_SERVER_NAME))).toBe(true);
    expect(problems.some((p) => p.includes(MEMORY_SERVER_NAME))).toBe(true);
  });
});

describe('assertDomainPreflight', () => {
  it('throws a wiring error (before any DB probe) when a server is missing', async () => {
    const opts = buildOrchestratorOptions();
    const broken: Options = { ...opts, mcpServers: {} };
    await expect(assertDomainPreflight(broken)).rejects.toThrow(PREFLIGHT_ERROR_PREFIX);
  });
});

// Live probe hits Postgres — gated on DB availability like the other suites.
const liveSuite = process.env.DATABASE_URL_UNPOOLED ? describe : describe.skip;

liveSuite('assertDomainPreflight (live DB)', () => {
  it('resolves against the wired domain DB', async () => {
    await expect(
      assertDomainPreflight(buildOrchestratorOptions()),
    ).resolves.toBeUndefined();
  });
});
