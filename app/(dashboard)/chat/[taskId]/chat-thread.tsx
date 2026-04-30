'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Wrench, AlertTriangle } from 'lucide-react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { openTaskEventSource } from '@/lib/auth/sse-client';
import type {
  TerminalSummary,
  TimelineEvent,
} from '@/components/timeline/types';

import { FollowUpForm } from './follow-up-form';

export type ChatThreadProps = {
  taskId: string;
  sseToken: string;
  initialEvents: TimelineEvent[];
  initialTerminal: TerminalSummary | null;
  initialPrompt: string;
};

type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

function extractAssistantText(payload: Record<string, unknown>): string {
  const message = payload.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return (content as AssistantBlock[])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();
  }
  return '';
}

function extractToolName(payload: Record<string, unknown>): string {
  const direct = (payload.tool_name as string) || (payload.name as string);
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return 'tool';
}

function extractAgentName(payload: Record<string, unknown>): string | null {
  const v = payload.agent_name;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Pull the latest tool_call seen on the wire so we can surface "currently
 * using …" while the swarm is still running. The list is short — full detail
 * lives in the operator view.
 */
function recentToolCalls(events: TimelineEvent[]): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < 5; i--) {
    const ev = events[i]!;
    if (ev.type === 'tool_call') {
      const name = extractToolName(ev.payload);
      if (!out.includes(name)) out.unshift(name);
    }
  }
  return out;
}

export function ChatThread({
  taskId,
  sseToken,
  initialEvents,
  initialTerminal,
  initialPrompt,
}: ChatThreadProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [terminal, setTerminal] = useState<TerminalSummary | null>(
    initialTerminal,
  );
  const lastIdRef = useRef<number>(
    initialEvents.length > 0 ? initialEvents[initialEvents.length - 1]!.id : 0,
  );

  useEffect(() => {
    if (terminal) return;

    let closed = false;
    const handle = openTaskEventSource(taskId, sseToken, {
      events: {
        task_event: (e: MessageEvent) => {
          try {
            const ev = JSON.parse(e.data) as TimelineEvent;
            if (ev.id <= lastIdRef.current) return;
            lastIdRef.current = ev.id;
            setEvents((prev) => [...prev, ev]);
          } catch (err) {
            console.error('[chat-thread] parse error:', err);
          }
        },
        done: (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data) as TerminalSummary;
            setTerminal(payload);
          } catch {
            setTerminal({ status: 'done' });
          }
          if (!closed) {
            closed = true;
            handle.close();
          }
        },
      },
      onFatal: (err) => console.error('[chat-thread] sse fatal:', err),
    });

    return () => {
      closed = true;
      handle.close();
    };
  }, [taskId, sseToken, terminal]);

  // Group the timeline into customer-facing chat turns. We collapse
  // tool_call/tool_result events into the assistant turn that follows them
  // so the conversation reads "user → assistant" with a small "what I did"
  // accordion in between.
  const assistantTurns = useMemo(
    () =>
      events.filter(
        (ev) => ev.type === 'assistant_turn' && extractAssistantText(ev.payload),
      ),
    [events],
  );

  const isStreaming = !terminal;
  const tools = useMemo(() => recentToolCalls(events), [events]);
  const lastAssistant = assistantTurns[assistantTurns.length - 1] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-warm)]">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-6 px-4 py-6">
          <Message from="user">
            <MessageContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {initialPrompt}
              </p>
            </MessageContent>
          </Message>

          {assistantTurns.map((ev) => {
            const text = extractAssistantText(ev.payload);
            const agent = extractAgentName(ev.payload);
            return (
              <Message key={ev.id} from="assistant">
                <MessageContent>
                  {agent && (
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {agent}
                    </span>
                  )}
                  <MessageResponse>{text}</MessageResponse>
                </MessageContent>
              </Message>
            );
          })}

          {isStreaming && (
            <WorkingIndicator
              tools={tools}
              hasReply={lastAssistant !== null}
            />
          )}

          {terminal && terminal.status !== 'done' && (
            <TerminalNotice status={terminal.status} />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-[var(--color-line)] px-4 py-3">
        <FollowUpForm disabled={isStreaming} />
        {isStreaming ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            agents working · streaming
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Sending starts a new conversation thread.
          </p>
        )}
      </div>
    </div>
  );
}

function WorkingIndicator({
  tools,
  hasReply,
}: {
  tools: string[];
  hasReply: boolean;
}) {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--color-line)] bg-background/60 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {hasReply ? 'thinking…' : 'agents are working on this'}
          </div>
          {tools.length > 0 && (
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="size-3.5" />
                  recent activity
                </span>
                <span className="text-[10px] tracking-wide">
                  {tools.length}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 flex flex-wrap gap-1.5">
                {tools.map((name) => (
                  <Badge
                    key={name}
                    variant="secondary"
                    className="font-mono text-[10px]"
                  >
                    {name}
                  </Badge>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </MessageContent>
    </Message>
  );
}

function TerminalNotice({
  status,
}: {
  status: 'failed' | 'cancelled';
}) {
  const failed = status === 'failed';
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        failed
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-[var(--color-line)] bg-background/40 text-muted-foreground',
      )}
    >
      {failed ? (
        <AlertTriangle className="size-3.5" />
      ) : (
        <CheckCircle2 className="size-3.5" />
      )}
      {failed
        ? 'The run failed before producing a reply. Try again or rephrase.'
        : 'The run was cancelled.'}
    </div>
  );
}
