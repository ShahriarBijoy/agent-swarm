import {
  getEventsSince,
  getTaskById,
  type TaskEventRow,
} from '@/db/queries/task-api';
import {
  formatHeartbeat,
  formatTaskEvent,
  formatTerminal,
  type TerminalStatus,
} from '@/lib/sse/encode';
import { verifySseToken } from '@/lib/auth/sse-token';

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15_000;
const TERMINAL_STATUSES: ReadonlyArray<TerminalStatus> = [
  'done',
  'failed',
  'cancelled',
];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function parseLastEventId(header: string | null): bigint {
  if (!header) return 0n;
  try {
    const n = BigInt(header);
    return n >= 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: taskId } = await params;

  // Phase 11 — gate the stream behind the HMAC token in `?token=`.
  // Cookies aren't sent reliably by EventSource (no custom headers, varies
  // across browsers cross-origin), so the page server-mints a 60s token via
  // signSseToken, the client appends it to the URL, and we check it here
  // before opening the stream. Fresh tokens come from /stream-token
  // (session-cookie-gated) on EventSource onerror reconnects.
  const url = new URL(req.url);
  const verified = verifySseToken(url.searchParams.get('token'), { taskId });
  if (!verified) {
    return new Response('unauthorized', { status: 401 });
  }

  const startCursor = parseLastEventId(req.headers.get('Last-Event-ID'));

  const enc = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = startCursor;
      let lastHeartbeatAt = Date.now();

      try {
        while (!signal.aborted) {
          const events: TaskEventRow[] = await getEventsSince({
            taskId,
            afterId: cursor,
            limit: 200,
          });

          for (const ev of events) {
            controller.enqueue(enc.encode(formatTaskEvent(ev)));
            cursor = ev.id;
          }

          const task = await getTaskById(taskId);
          const isTerminal =
            task && TERMINAL_STATUSES.includes(task.status as TerminalStatus);

          // Close only when there's nothing new *and* status is terminal.
          // The extra empty-poll guard catches the race where the run_result
          // event is inserted in the same instant as the status transition.
          if (isTerminal && events.length === 0) {
            controller.enqueue(
              enc.encode(
                formatTerminal({ status: task.status as TerminalStatus }),
              ),
            );
            controller.close();
            return;
          }

          // Heartbeat if no events have flowed for a while.
          const now = Date.now();
          if (events.length === 0 && now - lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
            controller.enqueue(enc.encode(formatHeartbeat()));
            lastHeartbeatAt = now;
          } else if (events.length > 0) {
            lastHeartbeatAt = now;
          }

          await sleep(POLL_INTERVAL_MS, signal);
        }
      } catch (err) {
        // Log and signal the client via controller.error so EventSource's
        // onerror fires and the browser reconnects with Last-Event-ID.
        console.error(
          `[api/tasks/stream] taskId=${taskId} poll loop error:`,
          err,
        );
        try {
          controller.error(err);
        } catch {
          // Already closed by cancel() — swallow.
        }
        return;
      }

      // Client aborted — close quietly.
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },

    cancel() {
      // No-op; the loop exits on the next `signal.aborted` check.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Prevent Nginx / Vercel edge from buffering SSE chunks.
      'X-Accel-Buffering': 'no',
    },
  });
}
