import { describe, expect, it } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { taskEvents } from '@/db/schema';
import { layoutCanvas } from '@/components/dashboard/canvas/canvas-layout';

type TaskEvent = InferSelectModel<typeof taskEvents>;

const ev = (i: number, type: string, payload: Record<string, unknown>): TaskEvent =>
  ({
    id: BigInt(i),
    runId: 'r',
    taskId: 't',
    seq: i,
    type,
    payload,
    createdAt: new Date(2026, 3, 27, 12, 0, i),
  } as unknown as TaskEvent);

describe('layoutCanvas', () => {
  it('returns a single dispatcher node and zero edges when only assistant turns exist', () => {
    const out = layoutCanvas([
      ev(1, 'assistant_turn', { agent_name: 'dispatcher', text: 'hi' }),
    ]);
    expect(out.nodes.length).toBe(1);
    expect(out.nodes[0]?.id).toBe('dispatcher');
    expect(out.edges).toEqual([]);
  });

  it('adds one worker node + one dispatcher→worker edge per Agent tool_call', () => {
    const out = layoutCanvas([
      ev(1, 'assistant_turn', { agent_name: 'dispatcher', text: '...' }),
      ev(2, 'tool_call', {
        agent_name: 'dispatcher',
        tool_name: 'Agent',
        tool_input: { subagent_type: 'fleet-analyst' },
      }),
      ev(3, 'tool_call', {
        agent_name: 'fleet-analyst',
        tool_name: 'mcp__memory__recall',
        tool_input: { query: 'vehicles' },
      }),
    ]);
    const ids = out.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['dispatcher', 'fleet-analyst']);
    expect(out.edges.length).toBe(1);
    expect(out.edges[0]?.source).toBe('dispatcher');
    expect(out.edges[0]?.target).toBe('fleet-analyst');
  });

  it('orders worker nodes by first-delegation timestamp', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'fleet-analyst' } }),
      ev(3, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'reflector' } }),
    ]);
    const workers = out.nodes
      .filter((n) => n.id !== 'dispatcher')
      .map((n) => n.id);
    expect(workers).toEqual(['billing', 'fleet-analyst', 'reflector']);
  });

  it('marks the worker with the latest tool_call as active', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'billing', tool_name: 'Read', tool_input: {} }),
    ]);
    const billing = out.nodes.find((n) => n.id === 'billing');
    expect(billing?.data.state).toBe('active');
  });

  it('marks a worker with an open approval_request event as hitl', () => {
    const out = layoutCanvas([
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'approval_request', { agent_name: 'billing', tool_name: 'Write', proposed_input: { file_path: 'invoices/X.json' }, gate_id: 'g-1' }),
    ]);
    const billing = out.nodes.find((n) => n.id === 'billing');
    expect(billing?.data.state).toBe('hitl');
    expect(billing?.data.gate?.gateId).toBe('g-1');
  });

  it('keeps node topology stable across the asOf cursor (state-only filter)', () => {
    // canvas-layout.ts:52-59 documents the intentional split: topology comes
    // from the FULL events list so React Flow doesn't re-mount worker nodes
    // mid-replay (which would drop edges between dispatcher and the worker).
    // The cursor only gates STATE — i.e. whether a node is queued/active/done.
    const events: TaskEvent[] = [
      ev(1, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'billing' } }),
      ev(2, 'tool_call', { agent_name: 'dispatcher', tool_name: 'Agent', tool_input: { subagent_type: 'fleet-analyst' } }),
    ];
    const cursor = events[0]!.createdAt.getTime();
    const out = layoutCanvas(events, cursor);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['billing', 'dispatcher', 'fleet-analyst']);
  });
});
