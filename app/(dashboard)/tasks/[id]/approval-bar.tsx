'use client';

import { useEffect, useState } from 'react';
import type { GateSummary } from '@/db/queries/approval-gates';
import type { ApprovalRequestPayload } from '@/components/timeline/types';
import { ApprovalCard } from './approval-card';
import { openTaskEventSource } from '@/lib/auth/sse-client';

/**
 * Floating bar above the timeline that surfaces every pending gate for
 * the task. Initial gates are server-rendered for first-paint parity;
 * subsequent gate-opened / gate-resolved events arrive via the same SSE
 * stream the timeline subscribes to (one extra EventSource per page;
 * fine for localhost dev).
 *
 * Disappears when there are no pending gates.
 */
export function ApprovalBar({
  taskId,
  sseToken,
  initialGates,
}: {
  taskId: string;
  sseToken: string;
  initialGates: GateSummary[];
}) {
  const [gates, setGates] = useState<GateSummary[]>(initialGates);

  useEffect(() => {
    let closed = false;
    const handle = openTaskEventSource(taskId, sseToken, {
      events: {
        task_event: (e: MessageEvent) => {
          const ev = safeParse(e.data);
          if (!ev || ev.type !== 'approval_request') return;
          const payload = ev.payload as unknown as ApprovalRequestPayload;
          if (!payload || typeof payload !== 'object') return;
          if (payload.subtype === 'opened') {
            setGates((prev) => {
              if (prev.some((g) => g.id === payload.gate_id)) return prev;
              const summary: GateSummary = {
                id: payload.gate_id,
                runId: '',
                taskId,
                toolName: payload.tool_name,
                proposedInput: payload.proposed_input,
                status: 'pending',
                createdAt: new Date(),
              };
              return [...prev, summary];
            });
          } else if (payload.subtype === 'resolved') {
            setGates((prev) =>
              prev.filter((g) => g.id !== payload.gate_id),
            );
          }
        },
        done: () => {
          if (!closed) {
            closed = true;
            handle.close();
          }
        },
      },
      onFatal: (err) =>
        console.error('[approval-bar] sse refresh failed:', err),
    });
    return () => {
      closed = true;
      handle.close();
    };
  }, [taskId, sseToken]);

  if (gates.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Pending approvals"
      className="flex flex-col gap-3"
    >
      {gates.map((g) => (
        <ApprovalCard key={g.id} gate={g} />
      ))}
    </section>
  );
}

function safeParse(s: string): { type: string; payload: unknown } | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
