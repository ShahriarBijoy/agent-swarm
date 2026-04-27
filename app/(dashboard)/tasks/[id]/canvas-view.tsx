// app/(dashboard)/tasks/[id]/canvas-view.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { InferSelectModel } from 'drizzle-orm';
import { taskEvents } from '@/db/schema';
import { AgentCanvas } from '@/components/dashboard/canvas/agent-canvas';
import { CanvasScrubber } from '@/components/dashboard/canvas/canvas-scrubber';
import type { TimelineEvent } from '@/components/timeline/types';

// `@/db/schema` doesn't export named row types — derive `TaskEvent` from the
// table the same way `agent-canvas.tsx` and `canvas-layout.ts` do.
type TaskEvent = InferSelectModel<typeof taskEvents>;

/**
 * The page passes already-serialized `TimelineEvent[]` (createdAt is an ISO
 * string after Server → Client prop crossing, even if the row started as a
 * Date). Live SSE pushes the same shape. We coerce both to the canonical
 * `TaskEvent` shape — with a real `Date` createdAt — before handing off to
 * `AgentCanvas`/`layoutCanvas`, which call `e.createdAt.getTime()`.
 *
 * `runId`/`taskId` aren't read by `layoutCanvas` (it groups by
 * `payload.agent_name`); we still satisfy the type with placeholders so we
 * don't need to widen `AgentCanvas.events`'s contract.
 */
export type CanvasViewProps = {
  initialEvents: TimelineEvent[];
  startedAt: string;
  endedAt: string | null;
  taskId: string;
};

function toTaskEvent(ev: TimelineEvent, taskId: string): TaskEvent {
  return {
    id: BigInt(ev.id),
    runId: '',
    taskId,
    seq: ev.seq,
    type: ev.type,
    payload: ev.payload,
    createdAt: new Date(ev.createdAt),
  };
}

export function CanvasView({
  initialEvents,
  startedAt,
  endedAt,
  taskId,
}: CanvasViewProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    if (cursor != null) return;
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    const onTaskEvent = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as TimelineEvent;
        setEvents((prev) =>
          prev.some((p) => p.id === ev.id) ? prev : [...prev, ev],
        );
      } catch (err) {
        console.error('[canvas-view] failed to parse task_event:', err);
      }
    };
    es.addEventListener('task_event', onTaskEvent);
    return () => {
      es.removeEventListener('task_event', onTaskEvent);
      es.close();
    };
  }, [cursor, taskId]);

  const taskEventsForCanvas = useMemo(
    () => events.map((e) => toTaskEvent(e, taskId)),
    [events, taskId],
  );

  const ticks = useMemo(
    () =>
      events
        .filter((e) => e.type === 'tool_call' || e.type === 'approval_request')
        .map((e) => ({
          kind: (e.type === 'approval_request' ? 'gate' : 'tool') as
            | 'gate'
            | 'tool',
          t: new Date(e.createdAt),
        })),
    [events],
  );

  return (
    <div className="flex flex-col">
      <AgentCanvas
        events={taskEventsForCanvas}
        mode="full"
        asOf={cursor ?? undefined}
      />
      <CanvasScrubber
        startedAt={new Date(startedAt)}
        endedAt={endedAt ? new Date(endedAt) : null}
        events={ticks}
        cursor={cursor}
        onCursorChange={setCursor}
      />
    </div>
  );
}
