'use client';

import { useEffect, useState } from 'react';
import type { GateSummary } from '@/db/queries/approval-gates';
import type { ApprovalRequestPayload } from '@/components/timeline/types';
import { ApprovalCard } from './approval-card';

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
  initialGates,
}: {
  taskId: string;
  initialGates: GateSummary[];
}) {
  const [gates, setGates] = useState<GateSummary[]>(initialGates);

  useEffect(() => {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    const handle = (e: MessageEvent) => {
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
        setGates((prev) => prev.filter((g) => g.id !== payload.gate_id));
      }
    };
    es.addEventListener('task_event', handle as EventListener);
    es.addEventListener('done', () => es.close());
    return () => es.close();
  }, [taskId]);

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
