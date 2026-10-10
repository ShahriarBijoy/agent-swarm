import { EventEncoder } from '@ag-ui/encoder';
import type { BaseEvent } from '@ag-ui/core';
import type { TaskEventRow } from '@/db/queries/task-api';
import { createAguiMapper, type AguiTerminalStatus } from '@/lib/agui/map';

/**
 * Phase 13 — stream one Auto-Ride task as AG-UI events over SSE.
 *
 * Same poll-the-table design as the phase-06 `/api/tasks/[id]/stream` route
 * (task_events is the single source of truth; the Inngest worker writes it,
 * any number of readers tail it), but each row goes through the AG-UI mapper
 * and out through the official `@ag-ui/encoder`, so the wire format is
 * standard AG-UI rather than Auto-Ride's own `task_event` records.
 */

const TERMINAL: ReadonlyArray<AguiTerminalStatus> = ['done', 'failed', 'cancelled'];

export type AguiStreamDeps = {
  getEventsSince: (args: { taskId: string; afterId: bigint; limit: number }) => Promise<TaskEventRow[]>;
  getTaskById: (taskId: string) => Promise<{ status: string } | null>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
};

export type StreamTaskAsAguiArgs = {
  taskId: string;
  /** AG-UI thread id; defaults to the task id. */
  threadId?: string;
  /** AG-UI run id; defaults to the task id. POST /api/agui echoes the client's. */
  runId?: string;
  signal: AbortSignal;
  /** Request `Accept` header — lets the encoder pick SSE (default) or protobuf. */
  accept?: string | null;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /**
   * Data access. Routes pass `taskEventsDeps()` (lib/agui/db-deps.ts); tests
   * pass an in-memory table. Kept injectable so this module never imports the
   * DB client (which validates the whole environment at import time).
   */
  deps: Pick<AguiStreamDeps, 'getEventsSince' | 'getTaskById'> & Partial<AguiStreamDeps>;
};

const defaultTiming: Pick<AguiStreamDeps, 'sleep' | 'now'> = {
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }),
  now: Date.now,
};

export function aguiContentType(accept?: string | null): string {
  return new EventEncoder(accept ? { accept } : undefined).getContentType();
}

export function streamTaskAsAgui(args: StreamTaskAsAguiArgs): ReadableStream<Uint8Array> {
  const deps: AguiStreamDeps = { ...defaultTiming, ...args.deps };
  const pollMs = args.pollIntervalMs ?? 500;
  const heartbeatMs = args.heartbeatIntervalMs ?? 15_000;
  const encoder = new EventEncoder(args.accept ? { accept: args.accept } : undefined);
  const binary = encoder.getContentType() !== 'text/event-stream';
  const text = new TextEncoder();
  const mapper = createAguiMapper({
    threadId: args.threadId ?? args.taskId,
    runId: args.runId ?? args.taskId,
    now: deps.now,
  });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (events: BaseEvent[]) => {
        for (const ev of events) {
          controller.enqueue(binary ? encoder.encodeBinary(ev) : text.encode(encoder.encodeSSE(ev)));
        }
      };

      let cursor = 0n;
      let lastActivity = deps.now();
      let approvalSignalled = false;

      try {
        emit(mapper.start());
        while (!args.signal.aborted) {
          const rows = await deps.getEventsSince({ taskId: args.taskId, afterId: cursor, limit: 200 });
          for (const row of rows) {
            emit(mapper.map({ type: row.type, payload: row.payload }));
            cursor = row.id;
          }
          if (mapper.terminated) break;

          const task = await deps.getTaskById(args.taskId);
          if (!task) {
            emit(mapper.finish('failed', `task ${args.taskId} not found`));
            break;
          }
          if (task.status === 'awaiting_approval' && !approvalSignalled) {
            emit(mapper.approvalRequired());
            approvalSignalled = true;
          } else if (task.status !== 'awaiting_approval') {
            approvalSignalled = false;
          }
          // Close only on an empty poll after a terminal status, so a
          // run_result inserted in the same instant is never dropped.
          if (TERMINAL.includes(task.status as AguiTerminalStatus) && rows.length === 0) {
            emit(mapper.finish(task.status as AguiTerminalStatus));
            break;
          }

          const now = deps.now();
          if (rows.length > 0) {
            lastActivity = now;
          } else if (!binary && now - lastActivity > heartbeatMs) {
            controller.enqueue(text.encode(`: heartbeat ${now}\n\n`));
            lastActivity = now;
          }
          await deps.sleep(pollMs, args.signal);
        }
      } catch (err) {
        console.error(`[agui] taskId=${args.taskId} stream error:`, err);
        try {
          emit(mapper.finish('failed', 'stream error'));
        } catch {
          /* controller already closed */
        }
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
}

export const AGUI_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
