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
 * @param events     ordered task_events (ASC by id)
 * @param asOfMs     optional epoch ms cutoff; events.created_at > asOfMs are ignored
 */
export function layoutCanvas(events: TaskEvent[], asOfMs?: number): CanvasLayout {
  const filtered = asOfMs == null ? events : events.filter((e) => e.createdAt.getTime() <= asOfMs);

  const workers = new Map<string, AgentNodeData>();
  const dispatcherTools = new Set<string>();

  // 1) Pass: collect agent activity
  let dispatcherLastEventAt: Date | undefined;
  for (const e of filtered) {
    const name = (e.payload as { agent_name?: string })?.agent_name;
    if (!name) continue;

    if (name === DISPATCHER) {
      dispatcherLastEventAt = e.createdAt;
      // Agent tool calls = delegations
      if (
        e.type === 'tool_call' &&
        (e.payload as { tool_name?: string }).tool_name === 'Agent'
      ) {
        const targetName =
          (e.payload as { tool_input?: { subagent_type?: string } }).tool_input?.subagent_type;
        if (!targetName) continue;
        const existing = workers.get(targetName);
        if (!existing) {
          workers.set(targetName, {
            agentName: targetName,
            state: 'queued',
            toolNames: [],
            firstDelegatedAt: e.createdAt,
            lastEventAt: e.createdAt,
          });
        }
      }
      continue;
    }

    // Worker activity
    const data: AgentNodeData = workers.get(name) ?? {
      agentName: name,
      state: 'queued',
      toolNames: [],
      firstDelegatedAt: e.createdAt,
      lastEventAt: e.createdAt,
    };
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

    workers.set(name, data);
  }

  // 2) The most-recently-active worker (and not hitl) gets state='active';
  //    others previously in active drop back to 'queued' (their tools are done for now).
  const sorted = [...workers.values()].sort((a, b) =>
    (a.firstDelegatedAt?.getTime() ?? 0) - (b.firstDelegatedAt?.getTime() ?? 0));
  let mostRecent: AgentNodeData | undefined;
  for (const w of sorted) {
    if (w.state !== 'hitl' && w.state !== 'failed' && w.state !== 'done') {
      if (!mostRecent || (w.lastEventAt!.getTime() > mostRecent.lastEventAt!.getTime())) {
        mostRecent = w;
      }
    }
  }
  for (const w of sorted) {
    if (w.state === 'active' && w !== mostRecent) w.state = 'queued';
  }

  // 3) Build node layout — dispatcher top center, workers in a row below
  const nodes: CanvasNode[] = [];
  nodes.push({
    id: DISPATCHER,
    position: { x: 350, y: 0 },
    data: {
      agentName: DISPATCHER,
      state: 'active',
      toolNames: [...dispatcherTools],
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

  // 4) Edges — dispatcher → worker for each worker, reason is unused for now
  const edges: CanvasEdge[] = sorted.map((w) => ({
    id: `${DISPATCHER}->${w.agentName}`,
    source: DISPATCHER,
    target: w.agentName,
    data: { reason: w.routingReason },
  }));

  return { nodes, edges };
}
