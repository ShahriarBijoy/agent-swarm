'use client';

import { useEffect, useRef, useState } from 'react';
import type { TimelineEvent, TerminalSummary } from '@/components/timeline/types';
import { TimelineEventRenderer } from '@/components/timeline/TimelineEventRenderer';

export type TimelineStreamProps = {
  taskId: string;
  initialEvents: TimelineEvent[];
  initialTerminal: TerminalSummary | null;
};

export function TimelineStream({
  taskId,
  initialEvents,
  initialTerminal,
}: TimelineStreamProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [terminal, setTerminal] = useState<TerminalSummary | null>(
    initialTerminal,
  );
  const lastIdRef = useRef<number>(
    initialEvents.length > 0 ? initialEvents[initialEvents.length - 1]!.id : 0,
  );

  useEffect(() => {
    if (terminal) return; // task already finished; no stream needed

    const es = new EventSource(`/api/tasks/${taskId}/stream`);

    const onTaskEvent = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as TimelineEvent;
        // Dedup: if we've already seen this id, skip it.
        if (ev.id <= lastIdRef.current) return;
        lastIdRef.current = ev.id;
        setEvents((prev) => [...prev, ev]);
      } catch (err) {
        console.error('[timeline-stream] failed to parse task_event:', err);
      }
    };

    const onDone = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as TerminalSummary;
        setTerminal(payload);
      } catch {
        setTerminal({ status: 'done' });
      }
      es.close();
    };

    es.addEventListener('task_event', onTaskEvent);
    es.addEventListener('done', onDone);
    es.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID; no action needed.
    };

    return () => {
      es.removeEventListener('task_event', onTaskEvent);
      es.removeEventListener('done', onDone);
      es.close();
    };
  }, [taskId, terminal]);

  return (
    <section
      data-task-id={taskId}
      className="flex flex-col gap-3"
      aria-live="polite"
    >
      {events.map((ev) => (
        <TimelineEventRenderer key={ev.id} event={ev} />
      ))}
      {!terminal && events.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          waiting for the first event…
        </p>
      )}
      {!terminal && events.length > 0 && (
        <p className="text-xs text-muted-foreground italic">
          streaming · connected
        </p>
      )}
    </section>
  );
}
