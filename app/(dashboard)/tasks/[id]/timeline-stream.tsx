'use client';

import { Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Message, MessageContent } from '@/components/ai-elements/message';
import { Badge } from '@/components/reui/badge';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@/components/reui/timeline';
import { TimelineEventRenderer } from '@/components/timeline/TimelineEventRenderer';
import type {
  TerminalSummary,
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type TimelineStreamProps = {
  taskId: string;
  initialEvents: TimelineEvent[];
  initialTerminal: TerminalSummary | null;
};

/**
 * Pull plain text out of a `user_message` payload. Mirrors the helper in
 * components/timeline/UserMessage.tsx so we can render the prompt as a
 * clean chat bubble instead of nesting the existing UserMessage card
 * inside the bubble.
 */
function extractUserText(payload: Record<string, unknown>): string {
  const message = payload.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text',
      )
      .map((b) => b.text);
    if (texts.length > 0) return texts.join('\n');
  }
  return JSON.stringify(message ?? payload, null, 2);
}

const DEFAULT_TITLE: Record<TimelineEventType, string> = {
  user_message: 'You',
  assistant_turn: 'Assistant',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  approval_request: 'Approval',
  compact_boundary: 'Context compacted',
  run_result: 'Run result',
};

const TONE: Record<
  TimelineEventType,
  'success-light' | 'info-light' | 'primary-light' | 'warning-light' | 'destructive-light' | 'secondary'
> = {
  user_message:    'primary-light',
  assistant_turn:  'info-light',
  tool_call:       'success-light',
  tool_result:     'success-light',
  approval_request:'warning-light',
  compact_boundary:'secondary',
  run_result:      'success-light',
};

function eventTitle(ev: TimelineEvent): string {
  const p = ev.payload;
  switch (ev.type) {
    case 'tool_call': {
      const name = (p.tool_name as string) || (p.name as string);
      return name ? `Tool · ${name}` : DEFAULT_TITLE.tool_call;
    }
    case 'assistant_turn': {
      const agent = (p.agent_name as string) || '';
      return agent || DEFAULT_TITLE.assistant_turn;
    }
    case 'approval_request': {
      const sub = (p.subtype as string) || '';
      return sub ? `Approval · ${sub}` : DEFAULT_TITLE.approval_request;
    }
    case 'run_result': {
      const status = (p.status as string) || '';
      return status ? `Run · ${status}` : DEFAULT_TITLE.run_result;
    }
    default:
      return DEFAULT_TITLE[ev.type];
  }
}

function formatClock(iso: string): string {
  try {
    // hour12:false forces a 24h format on both server and client. Without it
    // the platform default locale picks differently across the SSR boundary
    // (server: 24h, client: 12h with AM/PM), and React reports a hydration
    // mismatch on the rendered string.
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

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

  // Mark every received event as completed when the task is terminal; while
  // streaming, keep the most recent event "active" (spinner) so the live
  // edge is visible. Timeline reads `data-completed` from `step <= activeStep`.
  const isStreaming = !terminal;
  const activeStep = isStreaming
    ? Math.max(events.length - 1, 0)
    : events.length;

  return (
    <div className="h-[60vh] min-h-[420px] rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-warm)]">
      <ScrollArea className="h-full" type="hover">
        <div className="flex flex-col gap-6 p-4">
          {events.length === 0 && !terminal && (
            <p className="text-sm text-muted-foreground italic">
              waiting for the first event…
            </p>
          )}

          {events.length > 0 && (
            <Timeline
              value={activeStep}
              orientation="vertical"
              // Repaint the timeline with the lime accent: TimelineIndicator
              // uses bg-primary / text-primary-foreground for completed steps,
              // and TimelineItem styles the connecting separator with bg-primary
              // when the next item is completed. Overriding these CSS vars on
              // the Timeline scope is the cleanest way to swap the colour
              // without forking the primitive.
              style={
                {
                  '--primary': 'var(--color-lime)',
                  '--primary-foreground': 'var(--color-ink)',
                  '--color-primary': 'var(--color-lime)',
                  '--color-primary-foreground': 'var(--color-ink)',
                } as CSSProperties
              }
            >
              {events.map((ev, i) => {
                const step = i + 1;
                const isLastWhileStreaming = isStreaming && i === events.length - 1;
                const isUser = ev.type === 'user_message';
                return (
                  <TimelineItem
                    key={ev.id}
                    step={step}
                    className="ms-10 pb-8 last:pb-0"
                  >
                    <TimelineHeader>
                      <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
                      <div className="flex items-center gap-2">
                        <TimelineTitle className="text-sm font-medium">
                          {eventTitle(ev)}
                        </TimelineTitle>
                        <Badge variant={TONE[ev.type]} size="sm">
                          {`seq ${ev.seq}`}
                        </Badge>
                        <span
                          className="font-mono text-[10px] text-muted-foreground"
                          suppressHydrationWarning
                        >
                          {formatClock(ev.createdAt)}
                        </span>
                      </div>
                      <TimelineIndicator
                        className={cn(
                          'flex size-6 items-center justify-center border-none bg-muted text-muted-foreground group-data-[orientation=vertical]/timeline:-left-7',
                          'group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground',
                          isLastWhileStreaming && 'ring-2 ring-primary/20',
                        )}
                      >
                        {isLastWhileStreaming ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        )}
                      </TimelineIndicator>
                    </TimelineHeader>
                    <TimelineContent className="mt-2">
                      <Message from={isUser ? 'user' : 'assistant'}>
                        <MessageContent>
                          {isUser ? (
                            <p className="whitespace-pre-wrap text-sm">
                              {extractUserText(ev.payload)}
                            </p>
                          ) : (
                            <TimelineEventRenderer event={ev} />
                          )}
                        </MessageContent>
                      </Message>
                    </TimelineContent>
                  </TimelineItem>
                );
              })}
            </Timeline>
          )}

          {!terminal && events.length > 0 && (
            <p className="ms-10 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              streaming · connected
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
