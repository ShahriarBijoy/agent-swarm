import type { InferSelectModel } from 'drizzle-orm';
import { taskEvents } from '@/db/schema';

type TaskEvent = InferSelectModel<typeof taskEvents>;

export type AgentState = 'idle' | 'active' | 'hitl' | 'queued' | 'done' | 'failed';

export type AgentNodeData = {
  agentName: string;
  state: AgentState;
  /** Most recent tool the worker invoked (for the chip strip). */
  toolNames: string[];
  /** Inline HITL gate, present iff state === 'hitl'. */
  gate?: {
    gateId: string;
    toolName: string;
    proposedInput: unknown;
  };
  /** Dispatcher's routing reason for this worker (renders on the edge pill). */
  routingReason?: string;
  /** First time this worker was delegated to (for ordering). */
  firstDelegatedAt?: Date;
  /** Last time this worker emitted any event (for the most-recent-active marker). */
  lastEventAt?: Date;
};

export type CanvasNode = {
  id: string;        // 'dispatcher' or worker name
  position: { x: number; y: number };
  data: AgentNodeData;
};

export type CanvasEdge = {
  id: string;        // `${source}->${target}`
  source: string;
  target: string;
  data: { reason?: string };
};

export type CanvasLayout = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

const DISPATCHER = 'dispatcher';

/**
 * Pure function: derive the canvas layout from an events list.
 * Always-deterministic given the same input — used by both live and replay.
 *
 * The structure (which workers exist, their order, edges) comes from the
 * **full** events list so the node set is stable across cursor changes —
 * scrubbing/replaying changes only state, not topology. State (active /
 * hitl / done / chips) is computed from events `<= asOfMs`.
 *
 * Without this split, every cursor advance during replay added/removed
 * worker nodes, which made React Flow drop the edge between dispatcher
 * and worker until live mode resumed (it can't draw edges while a node's
 * lifecycle is racing the next render).
 *
 * @param events     ordered task_events (ASC by id)
 * @param asOfMs     optional epoch ms cutoff; events.created_at > asOfMs are ignored for STATE only
 */
export function layoutCanvas(events: TaskEvent[], asOfMs?: number): CanvasLayout {
  // RSC serialization can turn createdAt into an ISO string before this fn
  // sees it. Normalize once so every .getTime() call downstream is safe.
  const normalized = events.map((e) =>
    e.createdAt instanceof Date
      ? e
      : ({ ...e, createdAt: new Date(e.createdAt as unknown as string) } as TaskEvent),
  );
  events = normalized;

  // ---- Pass 1: discover workers from the full events list (stable structure) ----
  const workers = new Map<string, AgentNodeData>();

  function ensureWorker(name: string, at: Date) {
    const existing = workers.get(name);
    if (existing) {
      if (!existing.firstDelegatedAt || at < existing.firstDelegatedAt) {
        existing.firstDelegatedAt = at;
      }
      return existing;
    }
    const fresh: AgentNodeData = {
      agentName: name,
      state: 'queued',
      toolNames: [],
      firstDelegatedAt: at,
    };
    workers.set(name, fresh);
    return fresh;
  }

  for (const e of events) {
    const name = (e.payload as { agent_name?: string })?.agent_name;
    if (name && name !== DISPATCHER) {
      ensureWorker(name, e.createdAt);
    }
    if (
      name === DISPATCHER &&
      e.type === 'tool_call' &&
      (e.payload as { tool_name?: string }).tool_name === 'Agent'
    ) {
      const targetName = (e.payload as { tool_input?: { subagent_type?: string } })
        .tool_input?.subagent_type;
      if (targetName) ensureWorker(targetName, e.createdAt);
    }
  }

  // ---- Pass 2: apply state changes from events visible at the cursor ----
  const filtered = asOfMs == null ? events : events.filter((e) => e.createdAt.getTime() <= asOfMs);

  let dispatcherLastEventAt: Date | undefined;
  for (const e of filtered) {
    const name = (e.payload as { agent_name?: string })?.agent_name;
    if (!name) continue;

    if (name === DISPATCHER) {
      dispatcherLastEventAt = e.createdAt;
      continue;
    }

    const data = workers.get(name);
    if (!data) continue;
    data.lastEventAt = e.createdAt;

    if (e.type === 'tool_call') {
      const toolName = (e.payload as { tool_name?: string }).tool_name;
      if (toolName && !data.toolNames.includes(toolName)) data.toolNames.push(toolName);
      data.state = 'active';
    } else if (e.type === 'approval_request') {
      data.state = 'hitl';
      data.gate = {
        gateId: String((e.payload as { gate_id?: string }).gate_id ?? ''),
        toolName: String((e.payload as { tool_name?: string }).tool_name ?? ''),
        proposedInput: (e.payload as { proposed_input?: unknown }).proposed_input,
      };
    } else if (e.type === 'run_result') {
      data.state = (e.payload as { status?: string }).status === 'failed' ? 'failed' : 'done';
    }
  }

  // ---- Pass 3: most-recently-active gets `active`; older actives drop to `queued` ----
  const sorted = [...workers.values()].sort((a, b) =>
    (a.firstDelegatedAt?.getTime() ?? 0) - (b.firstDelegatedAt?.getTime() ?? 0));
  let mostRecent: AgentNodeData | undefined;
  for (const w of sorted) {
    if (w.state !== 'hitl' && w.state !== 'failed' && w.state !== 'done') {
      if (!mostRecent || (w.lastEventAt?.getTime() ?? 0) > (mostRecent.lastEventAt?.getTime() ?? 0)) {
        mostRecent = w;
      }
    }
  }
  for (const w of sorted) {
    if (w.state === 'active' && w !== mostRecent) w.state = 'queued';
  }

  // ---- Pass 4: build node layout — dispatcher top center, workers in a row below ----
  const nodes: CanvasNode[] = [];
  nodes.push({
    id: DISPATCHER,
    position: { x: 350, y: 0 },
    data: {
      agentName: DISPATCHER,
      state: 'active',
      toolNames: [],
      lastEventAt: dispatcherLastEventAt,
    },
  });

  const workerCount = sorted.length;
  const stride = 220;
  const totalWidth = (workerCount - 1) * stride;
  const startX = 350 - totalWidth / 2;
  sorted.forEach((w, i) => {
    nodes.push({
      id: w.agentName,
      position: { x: startX + i * stride, y: 220 },
      data: w,
    });
  });

  // ---- Pass 5: edges — dispatcher → worker for each known worker ----
  const edges: CanvasEdge[] = sorted.map((w) => ({
    id: `${DISPATCHER}->${w.agentName}`,
    source: DISPATCHER,
    target: w.agentName,
    data: { reason: w.routingReason },
  }));

  return { nodes, edges };
}
