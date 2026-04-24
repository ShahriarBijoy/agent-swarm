export type TimelineEventType =
  | 'assistant_turn'
  | 'tool_call'
  | 'tool_result'
  | 'compact_boundary'
  | 'run_result'
  | 'user_message';

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
