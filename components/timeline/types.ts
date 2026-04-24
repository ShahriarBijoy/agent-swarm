export type TimelineEventType =
  | 'assistant_turn'
  | 'tool_call'
  | 'tool_result'
  | 'compact_boundary'
  | 'run_result'
  | 'user_message'
  | 'approval_request';

/**
 * Phase-07 reuses the `approval_request` event type for both gate-opened
 * and gate-resolved events to avoid a check-constraint migration on
 * task_events. The `subtype` discriminator carries the lifecycle stage.
 */
export type ApprovalRequestPayload =
  | {
      subtype: 'opened';
      gate_id: string;
      tool_name: string;
      proposed_input: Record<string, unknown>;
      reason?: string;
    }
  | {
      subtype: 'resolved';
      gate_id: string;
      decision: 'approved' | 'modified' | 'denied';
      reason?: string | null;
      modified_input?: Record<string, unknown> | null;
    };

/**
 * Wire shape for one entry on the task timeline. Mirrors the SSE payload
 * emitted by lib/sse/encode.ts#formatTaskEvent — server-render seeds the
 * page with initial rows, and the EventSource appends more.
 */
export type TimelineEvent = {
  id: number;
  seq: number;
  type: TimelineEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TerminalSummary = {
  status: 'done' | 'failed' | 'cancelled';
  totalCostUsd?: number;
  numTurns?: number;
};
