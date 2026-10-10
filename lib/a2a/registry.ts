import type { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { createA2ARequestHandler } from '@/lib/a2a/http';
import { runWorkerWithSdk } from '@/lib/a2a/run-worker';
import type { A2AExposedAgent } from '@/lib/a2a/exposed';

/**
 * Phase 13 — one A2A request handler per exposed worker, kept for the life of
 * the server process so `GetTask`, `CancelTask` and `SubscribeToTask` see the
 * tasks that earlier `SendMessage` calls created. The task store is in-memory
 * (A2A tasks are short Q&A runs); a restart forgets them, which the protocol
 * reports as TaskNotFound.
 */
const handlers = new Map<string, DefaultRequestHandler>();

export function getA2ARequestHandler(agent: A2AExposedAgent, baseUrl: string): DefaultRequestHandler {
  const key = `${agent}@${baseUrl}`;
  let handler = handlers.get(key);
  if (!handler) {
    handler = createA2ARequestHandler(agent, baseUrl, runWorkerWithSdk);
    handlers.set(key, handler);
  }
  return handler;
}
