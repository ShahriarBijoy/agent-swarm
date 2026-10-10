import { timingSafeEqual } from 'node:crypto';
import { A2A_VERSION_HEADER, AgentCard, Extensions, HTTP_EXTENSION_HEADER } from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  defaultServerCallContextBuilder,
  validateVersion,
  type A2ARequestHandler,
  type User,
} from '@a2a-js/sdk/server';
import { buildAgentCard } from '@/lib/a2a/card';
import { WorkerAgentExecutor, type RunWorker } from '@/lib/a2a/executor';
import type { A2AExposedAgent } from '@/lib/a2a/exposed';

/**
 * Phase 13 — the A2A JSON-RPC transport on Web-standard Request/Response,
 * so it runs in a Next.js route handler without Express. Mirrors what
 * `@a2a-js/sdk/server/express`'s `jsonRpcHandler` does: build a
 * ServerCallContext, check the requested protocol version against the card,
 * hand the body to the SDK's `JsonRpcTransportHandler`, and answer either a
 * single JSON-RPC response or an SSE stream for `SendStreamingMessage`.
 */

class BearerUser implements User {
  constructor(private readonly name: string) {}
  get isAuthenticated() {
    return true;
  }
  get userName() {
    return this.name;
  }
}

export type A2AAuthResult = { ok: true; user: User } | { ok: false; response: Response };

/**
 * Shared-secret bearer auth (the scheme the agent card advertises). Closed
 * when `A2A_API_KEY` is unset, so a deploy without the secret exposes nothing.
 */
export function authenticateA2A(req: Request, apiKey = process.env.A2A_API_KEY): A2AAuthResult {
  const expected = apiKey?.trim();
  if (!expected) {
    return { ok: false, response: Response.json({ error: 'a2a_disabled' }, { status: 503 }) };
  }
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const given = match?.[1]?.trim() ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      response: Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="auto-ride-a2a"' } },
      ),
    };
  }
  const caller = req.headers.get('x-a2a-caller')?.slice(0, 80) || 'a2a-client';
  return { ok: true, user: new BearerUser(caller) };
}

export function createA2ARequestHandler(
  agent: A2AExposedAgent,
  baseUrl: string,
  runWorker: RunWorker,
): DefaultRequestHandler {
  return new DefaultRequestHandler(
    buildAgentCard(agent, baseUrl),
    new InMemoryTaskStore(),
    new WorkerAgentExecutor(agent, runWorker),
  );
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function sse(data: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function rpcError(id: unknown, err: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: JsonRpcTransportHandler.mapToJSONRPCError(err) };
}

export async function handleA2AJsonRpc(
  req: Request,
  requestHandler: A2ARequestHandler,
  user: User,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  try {
    const context = defaultServerCallContextBuilder({
      extensions: Extensions.parseServiceParameter(req.headers.get(HTTP_EXTENSION_HEADER) ?? undefined),
      user,
      headers: Object.fromEntries(req.headers.entries()),
      requestedVersion: req.headers.get(A2A_VERSION_HEADER) ?? undefined,
    });
    validateVersion(context.requestedVersion, await requestHandler.getAgentCard(), 'JSONRPC');

    const result = await new JsonRpcTransportHandler(requestHandler).handle(body, context);
    if (typeof (result as AsyncGenerator)?.[Symbol.asyncIterator] !== 'function') {
      return Response.json(result);
    }

    const iterator = (result as AsyncGenerator<unknown>)[Symbol.asyncIterator]();
    let first: IteratorResult<unknown>;
    try {
      first = await iterator.next();
    } catch (err) {
      return Response.json(rpcError(body.id, err));
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(enc.encode(sse(first.value)));
          for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            controller.enqueue(enc.encode(sse(next.value)));
          }
        } catch (err) {
          controller.enqueue(enc.encode(sse(rpcError(body.id, err), 'error')));
        } finally {
          controller.close();
        }
      },
      async cancel() {
        await iterator.return?.(undefined);
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    return Response.json(rpcError(body.id, err));
  }
}

/** The card in protocol JSON, for `GET .../agent-card.json`. */
export async function agentCardResponse(requestHandler: A2ARequestHandler): Promise<Response> {
  const card = await requestHandler.getAgentCard();
  return Response.json(AgentCard.toJSON(card), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}

/** Public origin for card URLs: A2A_PUBLIC_URL, else the request's own origin. */
export function publicBaseUrl(req: Request): string {
  const configured = process.env.A2A_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return `${proto}://${host}`;
}
