import { describe, expect, it } from 'vitest';
import { EventSchemas } from '@ag-ui/core/schemas';
import type { TaskEventRow } from '@/db/queries/task-api';
import { streamTaskAsAgui } from '@/lib/agui/stream';
import { lastUserText } from '@/lib/agui/input';

// Phase 13 — the AG-UI SSE stream, driven by an in-memory task_events table.

function row(id: number, type: string, payload: Record<string, unknown>): TaskEventRow {
  return { id: BigInt(id), seq: id, type, payload, createdAt: new Date(0) };
}

async function readSse(stream: ReadableStream<Uint8Array>): Promise<{ events: Record<string, unknown>[]; raw: string }> {
  const raw = await new Response(stream).text();
  const events = raw
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>);
  return { events, raw };
}

function fakeDeps(batches: TaskEventRow[][], statuses: string[]) {
  let poll = 0;
  return {
    getEventsSince: async ({ afterId }: { afterId: bigint }) => {
      const batch = batches[Math.min(poll, batches.length - 1)] ?? [];
      return batch.filter((r) => r.id > afterId);
    },
    getTaskById: async () => {
      const status = statuses[Math.min(poll, statuses.length - 1)] ?? 'done';
      poll += 1;
      return { status };
    },
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
  };
}

describe('streamTaskAsAgui', () => {
  it('streams a run as valid AG-UI SSE events and closes after RUN_FINISHED', async () => {
    const rows = [
      row(1, 'assistant_turn', { uuid: 'a', parent_tool_use_id: null, agent_name: 'dispatcher', message: { content: [{ type: 'text', text: 'On it.' }] } }),
      row(2, 'run_result', { subtype: 'success', result: 'Done.', total_cost_usd: 0.01, num_turns: 1 }),
    ];
    const { events } = await readSse(
      streamTaskAsAgui({
        taskId: 't-1',
        threadId: 'thread-9',
        runId: 'run-9',
        signal: new AbortController().signal,
        deps: fakeDeps([rows], ['in_progress']),
      }),
    );
    for (const ev of events) expect(EventSchemas.safeParse(ev).success).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    expect(events[0]).toMatchObject({ threadId: 'thread-9', runId: 'run-9' });
  });

  it('signals an approval gate once, then finishes when the task is cancelled', async () => {
    const { events } = await readSse(
      streamTaskAsAgui({
        taskId: 't-2',
        signal: new AbortController().signal,
        deps: fakeDeps([[], [], [], []], ['awaiting_approval', 'awaiting_approval', 'cancelled']),
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'CUSTOM', 'RUN_ERROR']);
    expect(events[1]).toMatchObject({ name: 'auto-ride.approval_required' });
    expect(events[2]).toMatchObject({ code: 'cancelled' });
  });

  it('closes with RUN_ERROR when the task does not exist', async () => {
    const { events } = await readSse(
      streamTaskAsAgui({
        taskId: 'missing',
        signal: new AbortController().signal,
        deps: { ...fakeDeps([[]], []), getTaskById: async () => null },
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
  });

  it('stops polling when the client disconnects', async () => {
    const ac = new AbortController();
    let polls = 0;
    const stream = streamTaskAsAgui({
      taskId: 't-3',
      signal: ac.signal,
      deps: {
        ...fakeDeps([[]], ['in_progress']),
        getTaskById: async () => {
          polls += 1;
          if (polls === 3) ac.abort();
          return { status: 'in_progress' };
        },
      },
    });
    const { events } = await readSse(stream);
    expect(polls).toBe(3);
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED']);
  });
});

describe('lastUserText', () => {
  it('returns the latest user text, joining text parts and skipping other roles', () => {
    expect(
      lastUserText([
        { id: '1', role: 'user', content: 'first' },
        { id: '2', role: 'assistant', content: 'reply' },
        {
          id: '3',
          role: 'user',
          content: [
            { type: 'text', text: 'Which EVs are free' },
            { type: 'text', text: 'in Bremen?' },
          ],
        },
      ] as never),
    ).toBe('Which EVs are free\nin Bremen?');
  });

  it('returns null when no user message carries text', () => {
    expect(lastUserText([{ id: '1', role: 'assistant', content: 'hi' }] as never)).toBeNull();
    expect(lastUserText([{ id: '1', role: 'user', content: '   ' }] as never)).toBeNull();
  });
});
