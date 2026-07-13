import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { MEMORY_SERVER_NAME } from '@/lib/mcp/memory';
import {
  DOMAIN_SERVER_NAME,
  DOMAIN_TOOLS,
  READ_DOMAIN_TOOL_FQNS,
  WRITE_DOMAIN_TOOL_FQNS,
} from '@/lib/mcp/domain';
import { queryVehicles } from '@/db/queries/domain';

export const PREFLIGHT_ERROR_PREFIX = 'Domain preflight failed';

/**
 * Pure structural check: does this run's Options actually wire the MCP servers
 * and the domain tools the swarm depends on? Returns a list of human-readable
 * problems (empty array = healthy). Split from the live probe so it is
 * unit-testable without a database.
 *
 * Why this exists — the phase-11.5 demo failure: a subagent got a hard SDK
 * "No such tool available: mcp__auto-ride-domain__query_vehicles", then
 * *hallucinated* that the domain MCP server was unreachable, and the dispatcher
 * repeated that to the user as fact. A genuinely missing server or tool should
 * fail loudly at the starting line — not surface as an invented infra excuse
 * three agents deep into the swarm.
 */
export function checkDomainWiring(options: Options): string[] {
  const problems: string[] = [];
  const servers: Record<string, unknown> = options.mcpServers ?? {};

  for (const name of [MEMORY_SERVER_NAME, DOMAIN_SERVER_NAME]) {
    if (servers[name] == null) {
      problems.push(`MCP server "${name}" is not registered in options.mcpServers`);
    }
  }

  // Every domain FQN the workers are allowed to call must resolve to a real
  // tool exposed by the domain server. Guards against a tool rename/removal in
  // lib/mcp/domain.ts silently orphaning a worker's allowlist entry.
  const exposed = new Set(
    DOMAIN_TOOLS.map((t) => `mcp__${DOMAIN_SERVER_NAME}__${t.name}`),
  );
  for (const fqn of [...READ_DOMAIN_TOOL_FQNS, ...WRITE_DOMAIN_TOOL_FQNS]) {
    if (!exposed.has(fqn)) {
      problems.push(`domain tool "${fqn}" is not exposed by the domain MCP server`);
    }
  }

  return problems;
}

/**
 * Fail-fast run-start assertion. Verifies (1) the MCP servers + domain tools
 * are wired into this run's Options, and (2) the domain read path actually
 * reaches Postgres. Throws a single explicit error — naming the affected tools
 * — so a broken run dies at the starting line with an honest message instead
 * of limping into the swarm and being narrated as "server unreachable".
 *
 * Cheap: one read-only `SELECT` (~100ms). Runs once per run, before `query()`.
 */
export async function assertDomainPreflight(options: Options): Promise<void> {
  const problems = checkDomainWiring(options);
  if (problems.length > 0) {
    throw new Error(
      `${PREFLIGHT_ERROR_PREFIX}: ${problems.join('; ')}. ` +
        'This is a wiring bug in lib/agent/options.ts, not a live outage.',
    );
  }

  // Live probe: every domain tool ultimately hits Postgres via
  // @/db/queries/domain, so a single read proves the whole path. An empty
  // filter is read-only and cheap.
  let vehicleCount: number;
  try {
    const rows = await queryVehicles({});
    vehicleCount = rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${PREFLIGHT_ERROR_PREFIX}: the domain database is unreachable — ` +
        `query_vehicles threw "${msg}". The domain tools ` +
        '(query_vehicles, quote_rental, propose_rental, charge_invoice) would ' +
        'all fail. Check DATABASE_URL / Neon status.',
    );
  }

  if (vehicleCount === 0) {
    // Reachable but unseeded: not fatal (a run may not touch vehicles), but the
    // rental demo would find nothing. Warn loudly rather than abort the run.
    console.error(
      '[preflight] domain DB reachable but the vehicles table is empty — ' +
        'run `pnpm seed:domain` before a rental demo.',
    );
  }
}
