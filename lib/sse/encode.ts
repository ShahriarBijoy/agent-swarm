import type { TaskEventRow } from '@/db/queries/task-api';

export type TerminalStatus = 'done' | 'failed' | 'cancelled';

/**
 * SSE record for one task_events row. `id:` enables native EventSource
 * reconnect semantics — on disconnect, browsers auto-send the last received
 * id in a `Last-Event-ID` header, which the stream route uses as the cursor.
 *
 * The event's bigserial id is Number()-cast for the JSON payload so clients
 * don't have to deal with BigInt. Safe up to 2^53 events (far past budget).
 */
export function formatTaskEvent(row: TaskEventRow): string {
  const data = {
    id: Number(row.id),
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
  return `id: ${Number(row.id)}\nevent: task_event\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Terminal signal emitted right before the SSE stream closes. Tells the
 * client to stop listening (vs EventSource's default behavior of
 * auto-reconnecting on server-close).
 */
export function formatTerminal(payload: {
  status: TerminalStatus;
  totalCostUsd?: number;
  numTurns?: number;
}): string {
  return `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Comment-only heartbeat to keep proxies from closing idle connections.
 * Browsers silently ignore SSE records that start with `:`.
 */
export function formatHeartbeat(): string {
  return `: heartbeat ${Date.now()}\n\n`;
}
