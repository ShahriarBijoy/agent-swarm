// lib/dashboard/queries.ts
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

// drizzle-orm/neon-http's db.execute() returns `{ rows: [...] }` (FullQueryResults),
// not a bare array. Other queries in this repo (see db/queries/task-runtime.ts)
// guard with `Array.isArray(result) ? result : (result.rows ?? [])`. Mirror that
// here so the plan's `(... as unknown as Foo[]).map(...)` pattern still works.
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

export type GreetingSnapshot = {
  months: { label: string; count: number }[];
  totalThisMonth: number;
  totalLastMonth: number;
  monthCostUsd: number;
};

export async function getGreetingSnapshot(): Promise<GreetingSnapshot> {
  const rows = toRows<{ label: string; count: number }>(
    await db.execute(sql`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', now()) - interval '5 months',
          date_trunc('month', now()),
          interval '1 month'
        ) AS m
      )
      SELECT
        to_char(m, 'mon') AS label,
        (SELECT count(*)::int FROM tasks
          WHERE created_at >= m AND created_at < m + interval '1 month') AS count
      FROM months
      ORDER BY m ASC
    `),
  );
  const months = rows.map((r) => ({
    label: r.label.toLowerCase(),
    count: Number(r.count ?? 0),
  }));
  const totalThisMonth = months[5]?.count ?? 0;
  const totalLastMonth = months[4]?.count ?? 0;

  const cost = toRows<{ c: number }>(
    await db.execute(sql`
      SELECT coalesce(sum(total_cost_usd), 0)::float AS c
      FROM task_runs
      WHERE started_at >= date_trunc('month', now())
    `),
  );
  const monthCostUsd = Number(cost[0]?.c ?? 0);

  return { months, totalThisMonth, totalLastMonth, monthCostUsd };
}

export type AllAgentsSnapshot = {
  avgCostPerTask: number;
  perAgentCost: { agent: string; cost: number }[];
  avgP95LatencyMs: number;
  perAgentP95: { agent: string; ms: number }[];
};

export async function getAllAgentsSnapshot(): Promise<AllAgentsSnapshot> {
  const costRows = toRows<{ agent: string; cost: number }>(
    await db.execute(sql`
      SELECT
        payload->>'agent_name' AS agent,
        coalesce(sum((payload->'usage'->>'total_cost_usd')::float), 0) AS cost
      FROM task_events
      WHERE created_at >= now() - interval '30 days'
        AND payload->>'agent_name' IS NOT NULL
      GROUP BY agent
      ORDER BY cost DESC
    `),
  );
  const perAgentCost = costRows.map((r) => ({
    agent: r.agent,
    cost: Number(r.cost),
  }));

  const totalCost = toRows<{ c: number }>(
    await db.execute(sql`
      SELECT coalesce(avg(total_cost_usd), 0)::float AS c
      FROM task_runs
      WHERE started_at >= now() - interval '30 days'
    `),
  );
  const avgCostPerTask = Number(totalCost[0]?.c ?? 0);

  // p95 latency per agent — derived from consecutive task_events deltas inside a run
  const latencyRows = toRows<{ agent: string; p95_ms: number }>(
    await db.execute(sql`
      WITH ev AS (
        SELECT
          run_id,
          payload->>'agent_name' AS agent,
          created_at,
          lag(created_at) OVER (PARTITION BY run_id ORDER BY id) AS prev_at
        FROM task_events
        WHERE payload->>'agent_name' IS NOT NULL
          AND created_at >= now() - interval '30 days'
      )
      SELECT
        agent,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000
        ) AS p95_ms
      FROM ev
      WHERE prev_at IS NOT NULL
      GROUP BY agent
      ORDER BY p95_ms DESC NULLS LAST
    `),
  );
  const perAgentP95 = latencyRows.map((r) => ({ agent: r.agent, ms: Number(r.p95_ms ?? 0) }));

  const avgP95LatencyMs = perAgentP95.length
    ? perAgentP95.reduce((s, r) => s + r.ms, 0) / perAgentP95.length
    : 0;

  return { avgCostPerTask, perAgentCost, avgP95LatencyMs, perAgentP95 };
}

export type ActiveWorkersSnapshot = {
  activeAgentNames: string[];
  totalAgents: number;
};

export async function getActiveWorkers(): Promise<ActiveWorkersSnapshot> {
  const rows = toRows<{ agent: string }>(
    await db.execute(sql`
      SELECT DISTINCT payload->>'agent_name' AS agent
      FROM task_events e
      JOIN task_runs r ON r.id = e.run_id
      WHERE r.status = 'in_progress'
        AND payload->>'agent_name' IS NOT NULL
    `),
  );
  const activeAgentNames = rows.map((r) => r.agent).filter(Boolean);

  return { activeAgentNames, totalAgents: 11 };
}
