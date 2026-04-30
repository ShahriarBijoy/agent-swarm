'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { TimelineEventRenderer } from '@/components/timeline/TimelineEventRenderer';
import type {
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { openTaskEventSource } from '@/lib/auth/sse-client';

export type TurnInput = {
  taskId: string;
  status:
    | 'queued'
    | 'in_progress'
    | 'awaiting_approval'
    | 'done'
    | 'failed'
    | 'cancelled';
  createdAt: string;
  /** Stored `tasks.prompt` — used as a fallback before the SDK echoes its first user_message event. */
  storedPrompt: string;
  initialEvents: TimelineEvent[];
};

const HIDDEN_TYPES = new Set<TimelineEventType>([
  'compact_boundary',
]);

/**
 * Pull plain text out of a `user_message` payload — duplicated from
 * timeline-stream.tsx (and intentionally kept inline so this file is
 * self-contained for future moves).
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

/**
 * Strip the `[scenario] customer_email=…` and `[conversation_id=…]` prefixes
 * and any prior-context block off a user prompt before rendering. Those are
 * dispatcher steering metadata, not chat content.
 */
function stripPromptScaffolding(prompt: string): string {
  let out = prompt.replace(/^\[scenario\][^\n]*\n+/u, '');
  out = out.replace(/^\[conversation_id=[^\]]+\]\n+/u, '');
  // The buildConversationContext block ends with a "## New customer message"
  // section header; if present, only keep what comes after.
  const marker = out.indexOf('## New customer message');
  if (marker !== -1) {
    const tail = out.slice(marker);
    const lines = tail.split('\n');
    // Drop the header line + the blank line below it.
    out = lines.slice(2).join('\n');
  }
  return out.trim();
}

/**
 * Pull the dispatcher's final reply text from the latest successful
 * run_result on a turn. Returns null while the turn is still running.
 */
function findFinalText(events: TimelineEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== 'run_result') continue;
    const p = ev.payload as { subtype?: unknown; result?: unknown };
    if (p.subtype === 'success' && typeof p.result === 'string') {
      return p.result;
    }
  }
  return null;
}

export function ConversationView({
  turns,
  liveTaskId,
  sseToken,
}: {
  turns: TurnInput[];
  liveTaskId: string | null;
  sseToken: string | null;
}) {
  const router = useRouter();
  // Track the live turn's events client-side. Older turns are static and
  // come straight from the server props; only the tail can grow.
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>(() => {
    if (!liveTaskId) return [];
    const live = turns.find((t) => t.taskId === liveTaskId);
    return live?.initialEvents ?? [];
  });
  const lastIdRef = useRef<number>(
    liveEvents.length > 0 ? liveEvents[liveEvents.length - 1]!.id : 0,
  );

  // When the page is server-rendered with a different live task (e.g. user
  // sent a follow-up and Next refreshed), reset the local stream state so
  // the new turn streams from its own events.
  useEffect(() => {
    if (!liveTaskId) {
      setLiveEvents([]);
      lastIdRef.current = 0;
      return;
    }
    const live = turns.find((t) => t.taskId === liveTaskId);
    setLiveEvents(live?.initialEvents ?? []);
    lastIdRef.current =
      (live?.initialEvents?.length ?? 0) > 0
        ? live!.initialEvents[live!.initialEvents.length - 1]!.id
        : 0;
  }, [liveTaskId, turns]);

  useEffect(() => {
    if (!liveTaskId || !sseToken) return;
    let closed = false;
    const handle = openTaskEventSource(liveTaskId, sseToken, {
      events: {
        task_event: (e: MessageEvent) => {
          try {
            const ev = JSON.parse(e.data) as TimelineEvent;
            if (ev.id <= lastIdRef.current) return;
            lastIdRef.current = ev.id;
            setLiveEvents((prev) => [...prev, ev]);
          } catch (err) {
            console.error('[chat] failed to parse task_event:', err);
          }
        },
        done: () => {
          if (!closed) {
            closed = true;
            handle.close();
            // Refresh server-rendered state so the composer unlocks and
            // sidebar re-orders. router.refresh re-fetches RSC payload.
            router.refresh();
          }
        },
      },
      onFatal: (err) => console.error('[chat] sse refresh failed:', err),
    });

    return () => {
      closed = true;
      handle.close();
    };
  }, [liveTaskId, sseToken, router]);

  // Build a flat render list of bubbles. Each turn contributes one user
  // bubble (its prompt) and one assistant bubble (the final text or a live
  // tail of streamed events).
  const renderTurns = useMemo(() => {
    return turns.map((t) => {
      const events =
        t.taskId === liveTaskId ? liveEvents : t.initialEvents;
      return { turn: t, events };
    });
  }, [turns, liveTaskId, liveEvents]);

  return (
    <div className="flex-1 min-h-0 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-warm)]/80">
      <ScrollArea className="h-full" type="hover">
        <div className="flex flex-col gap-6 p-5">
          {renderTurns.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              waiting for the first event…
            </p>
          )}

          {renderTurns.map(({ turn, events }, idx) => {
            const userText = extractUserPromptText(turn, events);
            const isLive = turn.taskId === liveTaskId;
            const isFailed = turn.status === 'failed' || turn.status === 'cancelled';
            const finalText = findFinalText(events);
            const hasFinal = finalText !== null;
            const traceEvents = events.filter(
              (e) => !HIDDEN_TYPES.has(e.type) && e.type !== 'user_message' && e.type !== 'run_result',
            );

            return (
              <div key={turn.taskId} className="flex flex-col gap-4">
                {idx > 0 && (
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="h-px flex-1 bg-[var(--color-line)]" />
                    <span className="font-mono">turn {idx + 1}</span>
                    <span className="h-px flex-1 bg-[var(--color-line)]" />
                  </div>
                )}

                {userText && (
                  <Message from="user">
                    <MessageContent>
                      <p className="whitespace-pre-wrap text-sm">{userText}</p>
                    </MessageContent>
                  </Message>
                )}

                <Message from="assistant">
                  <MessageContent>
                    {hasFinal ? (
                      <MessageResponse className="text-sm">
                        {finalText}
                      </MessageResponse>
                    ) : isFailed ? (
                      <p className="text-sm text-destructive">
                        Turn failed before producing a reply. Open the ops
                        view for details.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="size-4" />
                        <span>thinking…</span>
                      </div>
                    )}
                  </MessageContent>
                </Message>

                {(isLive || isFailed || traceEvents.length > 0) && (
                  <details
                    className={cn(
                      'group rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/40 px-3 py-2 text-[12px]',
                    )}
                  >
                    <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <span className="group-open:hidden">show trace</span>
                      <span className="hidden group-open:inline">hide trace</span>
                      <span className="ms-2 normal-case tracking-normal text-[10px] text-muted-foreground">
                        ({traceEvents.length} events
                        {isLive ? ' · live' : ''})
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      {traceEvents.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          {isLive
                            ? 'waiting for first dispatch…'
                            : 'no tool activity recorded for this turn.'}
                        </p>
                      ) : (
                        traceEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/80 p-3"
                          >
                            <TimelineEventRenderer event={ev} />
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * The user's text for a turn comes from one of two places:
 *   1. The first `user_message` SDK event on the timeline (preferred — the
 *      SDK echoes our streamed user prompt back as an event).
 *   2. The task's stored `prompt` column (after stripping the dispatcher
 *      scaffolding) — a fallback for the moment a turn is queued but the
 *      first SDK message hasn't landed yet.
 *
 * The task page passes the raw prompt via the first `user_message`
 * payload's `message.content` once the SDK emits it; until then we still
 * want the user's bubble visible.
 */
function extractUserPromptText(
  turn: TurnInput,
  events: TimelineEvent[],
): string {
  const um = events.find((e) => e.type === 'user_message');
  if (um) {
    const text = extractUserText(um.payload);
    if (text.trim().length > 0) return stripPromptScaffolding(text);
  }
  // Fallback: the SDK hasn't echoed the user message yet (queued / very
  // first poll). Render the stored prompt with the dispatcher scaffolding
  // stripped so the bubble shows immediately on submit.
  return stripPromptScaffolding(turn.storedPrompt);
}
