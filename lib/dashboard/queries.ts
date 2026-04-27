// lib/dashboard/queries.ts
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { tasks, taskRuns, taskEvents, approvalGates } from '@/db/schema';

type Task = InferSelectModel<typeof tasks>;
type TaskRun = InferSelectModel<typeof taskRuns>;
type TaskEvent = InferSelectModel<typeof taskEvents>;
type ApprovalGate = InferSelectModel<typeof approvalGates>;

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

export type ActiveRunSnapshot = {
  task: Pick<Task, 'id' | 'prompt' | 'createdAt'>;
  run: Pick<TaskRun, 'id' | 'startedAt' | 'totalCostUsd' | 'totalInputTokens' | 'totalOutputTokens'>;
  events: Pick<TaskEvent, 'id' | 'seq' | 'type' | 'payload' | 'createdAt'>[];
};

export async function getActiveRun(): Promise<ActiveRunSnapshot | null> {
  const runs = await db.execute(sql`
    SELECT r.id AS run_id, r.task_id, r.started_at, r.total_cost_usd, r.total_input_tokens, r.total_output_tokens,
           t.prompt, t.created_at AS task_created_at
    FROM task_runs r
    JOIN tasks t ON t.id = r.task_id
    WHERE r.status = 'in_progress'
    ORDER BY r.started_at DESC
    LIMIT 1
  `);
  type Row = {
    run_id: string; task_id: string; started_at: Date; total_cost_usd: string;
    total_input_tokens: number; total_output_tokens: number; prompt: string; task_created_at: Date;
  };
  const r = toRows<Row>(runs)[0];
  if (!r) return null;

  const events = await db.execute(sql`
    SELECT
      id          AS "id",
      seq         AS "seq",
      type        AS "type",
      payload     AS "payload",
      created_at  AS "createdAt"
    FROM task_events
    WHERE run_id = ${r.run_id}
    ORDER BY id ASC
    LIMIT 200
  `);
  return {
    task: { id: r.task_id, prompt: r.prompt, createdAt: r.task_created_at },
    run: {
      id: r.run_id,
      startedAt: r.started_at,
      totalCostUsd: r.total_cost_usd as unknown as TaskRun['totalCostUsd'],
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    },
    events: toRows<Pick<TaskEvent, 'id' | 'seq' | 'type' | 'payload' | 'createdAt'>>(events),
  };
}

export type OpenGate = ApprovalGate & { taskPrompt: string };

export async function getOpenApprovalGates(): Promise<OpenGate[]> {
  const rows = await db.execute(sql`
    SELECT
      g.id                AS "id",
      g.run_id            AS "runId",
      g.task_id           AS "taskId",
      g.tool_name         AS "toolName",
      g.proposed_input    AS "proposedInput",
      g.status            AS "status",
      g.resolution_input  AS "resolutionInput",
      g.reviewer_note     AS "reviewerNote",
      g.reviewer_id       AS "reviewerId",
      g.inngest_event_key AS "inngestEventKey",
      g.created_at        AS "createdAt",
      g.resolved_at       AS "resolvedAt",
      g.timed_out_at      AS "timedOutAt",
      t.prompt            AS "taskPrompt"
    FROM approval_gates g
    JOIN tasks t ON t.id = g.task_id
    WHERE g.status = 'pending'
    ORDER BY g.created_at ASC
    LIMIT 20
  `);
  return toRows<OpenGate>(rows);
}

export type MemoryWritesTodaySnapshot = {
  count: number;
  deltaVsYesterday: number;
};

export async function getMemoryWritesToday(): Promise<MemoryWritesTodaySnapshot> {
  const r = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM memories
        WHERE created_at >= date_trunc('day', now())) AS today,
      (SELECT count(*)::int FROM memories
        WHERE created_at >= date_trunc('day', now()) - interval '1 day'
          AND created_at <  date_trunc('day', now())) AS yesterday
  `);
  const row = toRows<{ today: number; yesterday: number }>(r)[0];
  return {
    count: Number(row?.today ?? 0),
    deltaVsYesterday: Number(row?.today ?? 0) - Number(row?.yesterday ?? 0),
  };
}

export type LastCleanupSnapshot = {
  runStartedAt: Date;
  promoted: number;
  pruned: number;
  contested: number;
} | null;

export async function getLastCleanup(): Promise<LastCleanupSnapshot> {
  const rows = await db.execute(sql`
    SELECT r.id, r.started_at,
      coalesce(sum(case when p.action = 'promote' then 1 else 0 end), 0)::int AS promoted,
      coalesce(sum(case when p.action = 'prune'   then 1 else 0 end), 0)::int AS pruned,
      r.proposals_contested AS contested
    FROM memory_cleanup_runs r
    LEFT JOIN memory_cleanup_proposals p ON p.run_id = r.id
    WHERE r.status = 'completed'
    GROUP BY r.id
    ORDER BY r.started_at DESC
    LIMIT 1
  `);
  type Row = { id: string; started_at: Date | string; promoted: number; pruned: number; contested: number };
  const r = toRows<Row>(rows)[0];
  if (!r) return null;
  return {
    runStartedAt: r.started_at instanceof Date ? r.started_at : new Date(r.started_at),
    promoted: Number(r.promoted),
    pruned: Number(r.pruned),
    contested: Number(r.contested),
  };
}
