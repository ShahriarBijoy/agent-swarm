'use client';

// Phase 11 — Browser-side helper that opens an EventSource against the
// task SSE route with a 60-second `?token=` HMAC, and transparently
// refreshes that token when it expires (server returns 401 → onerror →
// readyState=CLOSED → fetch /stream-token → re-open).
//
// Browsers' built-in EventSource auto-reconnect uses the *original* URL,
// so once a token expires the auto-reconnect loop spins fruitlessly.
// This helper sidesteps that by closing the dead instance and constructing
// a fresh one with a fresh token.

export type SseListeners = {
  /** Called for each named SSE event in `events`. */
  events: Record<string, (e: MessageEvent) => void>;
  /** Called when the helper gives up (refresh failed, no session, etc.) */
  onFatal?: (err: unknown) => void;
};

export type SseHandle = {
  close: () => void;
};

function buildUrl(taskId: string, token: string): string {
  return `/api/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`;
}

async function refreshToken(taskId: string): Promise<string> {
  const res = await fetch(`/api/tasks/${taskId}/stream-token`, {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`stream-token refresh failed: ${res.status}`);
  }
  const body = (await res.json()) as { token: string };
  if (!body.token) throw new Error('stream-token response missing token');
  return body.token;
}

/**
 * Open a managed EventSource. Returns a handle whose `close()` tears down
 * the current instance and prevents any in-flight refresh from re-opening.
 */
export function openTaskEventSource(
  taskId: string,
  initialToken: string,
  listeners: SseListeners,
): SseHandle {
  let es: EventSource | null = null;
  let cancelled = false;
  let refreshing = false;

  const attach = (instance: EventSource) => {
    for (const [name, handler] of Object.entries(listeners.events)) {
      instance.addEventListener(name, handler);
    }
    instance.onerror = async () => {
      // Browsers fire `onerror` for both transient blips (we want them to
      // auto-reconnect) and terminal failures (we need a new token).
      // CLOSED is the terminal state — that's our refresh trigger.
      if (cancelled) return;
      if (instance.readyState !== EventSource.CLOSED) return;
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await refreshToken(taskId);
        if (cancelled) return;
        const replacement = new EventSource(buildUrl(taskId, next));
        es = replacement;
        attach(replacement);
      } catch (err) {
        listeners.onFatal?.(err);
      } finally {
        refreshing = false;
      }
    };
  };

  es = new EventSource(buildUrl(taskId, initialToken));
  attach(es);

  return {
    close() {
      cancelled = true;
      es?.close();
      es = null;
    },
  };
}
