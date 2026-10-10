import { describe, expect, it } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { createAguiMapper, type AguiSourceEvent } from '@/lib/agui/map';

// Phase 13 — every event the mapper emits must be a valid AG-UI 1.0 event.
// We parse each one through the official zod schemas from @ag-ui/core, so a
// shape drift (wrong field name, missing id) fails here, not in a client.

const opts = { threadId: 'task-1', runId: 'task-1', now: () => 1_700_000_000_000 };

function assertValid(events: BaseEvent[]): void {
  for (const ev of events) {
    const parsed = EventSchemas.safeParse(ev);
    if (!parsed.success) {
      throw new Error(`invalid AG-UI event ${JSON.stringify(ev)}: ${parsed.error.message}`);
    }
  }
}

function types(events: BaseEvent[]): string[] {
  return events.map((e) => e.type);
}

const dispatcherText: AguiSourceEvent = {
  type: 'assistant_turn',
  payload: {
    uuid: 'u-1',
    parent_tool_use_id: null,
    agent_name: 'dispatcher',
    message: {
      content: [
        { type: 'thinking', thinking: 'private' },
        { type: 'text', text: 'Routing to fleet-analyst.' },
      ],
    },
  },
};

const agentCall: AguiSourceEvent = {
  type: 'tool_call',
  payload: {
    tool_use_id: 'toolu_agent',
    tool_name: 'Agent',
    input: { subagent_type: 'fleet-analyst', description: 'Check EV range', prompt: '...' },
    parent_tool_use_id: null,
    agent_name: 'dispatcher',
  },
};

const workerToolCall: AguiSourceEvent = {
  type: 'tool_call',
  payload: {
    tool_use_id: 'toolu_query',
    tool_name: 'mcp__auto-ride-domain__query_vehicles',
    input: { status: 'available' },
    parent_tool_use_id: 'toolu_agent',
    agent_name: 'fleet-analyst',
  },
};

const workerToolResult: AguiSourceEvent = {
  type: 'tool_result',
  payload: {
    tool_use_id: 'toolu_query',
    is_error: false,
    content: [{ type: 'text', text: '[{"plate":"AR-X-2402"}]' }],
  },
};

const agentResult: AguiSourceEvent = {
  type: 'tool_result',
  payload: { tool_use_id: 'toolu_agent', is_error: false, content: 'Two EVs available.' },
};

const runSuccess: AguiSourceEvent = {
  type: 'run_result',
  payload: { subtype: 'success', result: 'Two EVs are available.', total_cost_usd: 0.12, num_turns: 4 },
};

describe('createAguiMapper', () => {
  it('maps a full dispatcher → worker run to a valid AG-UI event sequence', () => {
    const m = createAguiMapper(opts);
    const events = [
      ...m.start(),
      ...m.map(dispatcherText),
      ...m.map(agentCall),
      ...m.map(workerToolCall),
      ...m.map(workerToolResult),
      ...m.map(agentResult),
      ...m.map(runSuccess),
    ];
    assertValid(events);
    expect(types(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.SUBAGENT_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.TOOL_CALL_RESULT,
      EventType.SUBAGENT_FINISHED,
      EventType.RUN_FINISHED,
    ]);
    expect(m.terminated).toBe(true);
  });

  it('never exposes thinking blocks', () => {
    const m = createAguiMapper(opts);
    const json = JSON.stringify(m.map(dispatcherText));
    expect(json).not.toContain('private');
  });

  it('scopes worker events to the worker via subagentRunId', () => {
    const m = createAguiMapper(opts);
    m.map(agentCall);
    const workerEvents = m.map(workerToolCall);
    for (const ev of workerEvents) {
      expect((ev as { subagentRunId?: string }).subagentRunId).toBe('toolu_agent');
    }
    const started = m.map({ ...agentCall, payload: { ...agentCall.payload, tool_use_id: 'toolu_2' } })[0] as {
      name: string;
      description?: string;
    };
    expect(started.name).toBe('fleet-analyst');
    expect(started.description).toBe('Check EV range');
  });

  it('carries the agent name on assistant text messages', () => {
    const m = createAguiMapper(opts);
    const start = m.map(dispatcherText)[0] as { name?: string; role?: string };
    expect(start.name).toBe('dispatcher');
    expect(start.role).toBe('assistant');
  });

  it('reports a failed worker as SUBAGENT_ERROR', () => {
    const m = createAguiMapper(opts);
    m.map(agentCall);
    const out = m.map({
      type: 'tool_result',
      payload: { tool_use_id: 'toolu_agent', is_error: true, content: 'domain server down' },
    });
    assertValid(out);
    expect(types(out)).toEqual([EventType.TOOL_CALL_RESULT, EventType.SUBAGENT_ERROR]);
  });

  it('turns an error run_result into RUN_ERROR with the SDK subtype as code', () => {
    const m = createAguiMapper(opts);
    const out = m.map({
      type: 'run_result',
      payload: { subtype: 'error_max_budget_usd', errors: ['budget exceeded'] },
    });
    assertValid(out);
    expect(out[0]).toMatchObject({ type: EventType.RUN_ERROR, message: 'budget exceeded', code: 'error_max_budget_usd' });
  });

  it('emits nothing after the run terminated, and finish() is idempotent', () => {
    const m = createAguiMapper(opts);
    m.map(runSuccess);
    expect(m.map(dispatcherText)).toEqual([]);
    expect(m.finish('failed')).toEqual([]);
    expect(m.approvalRequired()).toEqual([]);
  });

  it('closes a run that ended without a run_result row', () => {
    const cancelled = createAguiMapper(opts).finish('cancelled');
    assertValid(cancelled);
    expect(cancelled[0]).toMatchObject({ type: EventType.RUN_ERROR, code: 'cancelled' });

    const done = createAguiMapper(opts).finish('done');
    assertValid(done);
    expect(done[0]).toMatchObject({ type: EventType.RUN_FINISHED, runId: 'task-1' });
  });

  it('signals an open approval gate as a CUSTOM event', () => {
    const out = createAguiMapper(opts).approvalRequired();
    assertValid(out);
    expect(out[0]).toMatchObject({ type: EventType.CUSTOM, name: 'auto-ride.approval_required' });
  });

  it('maps user prompts and compact boundaries, ignores unknown rows', () => {
    const m = createAguiMapper(opts);
    const user = m.map({ type: 'user_message', payload: { uuid: 'u-9', message: { content: 'Rent me an EV' } } });
    assertValid(user);
    expect((user[0] as { role?: string }).role).toBe('user');
    const compact = m.map({ type: 'compact_boundary', payload: { compact_metadata: { trigger: 'auto' } } });
    assertValid(compact);
    expect(m.map({ type: 'something_new', payload: {} })).toEqual([]);
  });
});
