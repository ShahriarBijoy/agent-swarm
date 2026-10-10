import { describe, expect, it, vi } from 'vitest';
import { AgentCard } from '@a2a-js/sdk';
import { agentRegistry } from '@/lib/agent/agents';
import { WRITE_TOOL_FQN, FORGET_TOOL_FQN, REINFORCE_TOOL_FQN, RECALL_TOOL_FQN } from '@/lib/mcp/memory';
import { WRITE_DOMAIN_TOOL_FQNS, QUERY_VEHICLES_FQN } from '@/lib/mcp/domain';
import { A2A_EXPOSED_AGENTS, isA2AExposedAgent, readOnlyToolsFor } from '@/lib/a2a/exposed';
import { agentCardJson, buildAgentCard } from '@/lib/a2a/card';
import { agentCardResponse, authenticateA2A, createA2ARequestHandler, handleA2AJsonRpc } from '@/lib/a2a/http';
import { callA2AAgent } from '@/lib/a2a/client';
import type { RunWorker } from '@/lib/a2a/executor';
import { buildWorkerOptions } from '@/lib/a2a/run-worker';

// Phase 13 — A2A server + client, end to end over the real @a2a-js/sdk
// JSON-RPC transport. The network is replaced by a fetch function that hands
// each Request straight to our route logic, and the Claude worker is replaced
// by a stub, so the protocol path (card discovery → SendMessage → task
// lifecycle → artifact) runs for real without an LLM.

const BASE = 'http://auto-ride.test';
const KEY = 'test-a2a-key';

function inProcessFetch(runWorker: RunWorker): typeof fetch {
  const handler = createA2ARequestHandler('fleet-analyst', BASE, runWorker);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/api/a2a/fleet-analyst/.well-known/agent-card.json') {
      return agentCardResponse(handler);
    }
    if (req.method === 'POST' && path === '/api/a2a/fleet-analyst') {
      const auth = authenticateA2A(req, KEY);
      if (!auth.ok) return auth.response;
      return handleA2AJsonRpc(req, handler, auth.user);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('exposed workers', () => {
  it('exposes only analysis workers that exist in the registry', () => {
    for (const name of A2A_EXPOSED_AGENTS) expect(agentRegistry).toHaveProperty(name);
    expect(isA2AExposedAgent('billing')).toBe(false);
    expect(isA2AExposedAgent('support')).toBe(false);
  });

  it('strips every write-side tool from an exposed worker', () => {
    for (const name of A2A_EXPOSED_AGENTS) {
      const tools = readOnlyToolsFor(agentRegistry[name]);
      for (const banned of ['Write', 'Bash', WRITE_TOOL_FQN, FORGET_TOOL_FQN, REINFORCE_TOOL_FQN, ...WRITE_DOMAIN_TOOL_FQNS]) {
        expect(tools).not.toContain(banned);
      }
      expect(tools).toContain(RECALL_TOOL_FQN);
    }
    expect(readOnlyToolsFor(agentRegistry['fleet-analyst'])).toContain(QUERY_VEHICLES_FQN);
  });

  it('builds SDK options that deny anything outside the read-only allowlist', async () => {
    const opts = buildWorkerOptions('fleet-analyst', new AbortController());
    expect(opts.allowedTools).toEqual(readOnlyToolsFor(agentRegistry['fleet-analyst']));
    expect(opts.maxBudgetUsd).toBeLessThanOrEqual(0.25);
    const ctx = { signal: new AbortController().signal, suggestions: [], toolUseID: 't' } as never;
    await expect(opts.canUseTool!('Write', { file_path: 'x' }, ctx)).resolves.toMatchObject({ behavior: 'deny' });
    await expect(opts.canUseTool!(WRITE_TOOL_FQN, {}, ctx)).resolves.toMatchObject({ behavior: 'deny' });
    await expect(opts.canUseTool!(QUERY_VEHICLES_FQN, { status: 'available' }, ctx)).resolves.toMatchObject({
      behavior: 'allow',
    });
  });
});

describe('agent card', () => {
  it('round-trips through the SDK and advertises JSON-RPC v1.0 with bearer auth', () => {
    const json = agentCardJson('fleet-analyst', `${BASE}/`);
    const card = buildAgentCard('fleet-analyst', BASE);
    expect(AgentCard.toJSON(card)).toMatchObject({
      name: json.name,
      supportedInterfaces: [{ url: `${BASE}/api/a2a/fleet-analyst`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      capabilities: { streaming: true },
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
    });
    expect(card.skills[0]?.examples.length).toBeGreaterThan(0);
  });
});

describe('bearer auth', () => {
  const req = (auth?: string) =>
    new Request(`${BASE}/api/a2a/fleet-analyst`, { method: 'POST', headers: auth ? { authorization: auth } : {} });

  it('is closed when A2A_API_KEY is not configured', () => {
    const res = authenticateA2A(req(`Bearer ${KEY}`), '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(503);
  });

  it('rejects missing and wrong tokens, accepts the right one', () => {
    for (const bad of [undefined, 'Bearer nope', `Basic ${KEY}`, KEY]) {
      const res = authenticateA2A(req(bad), KEY);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.response.status).toBe(401);
    }
    expect(authenticateA2A(req(`Bearer ${KEY}`), KEY).ok).toBe(true);
  });
});

describe('A2A end to end (SDK client → our JSON-RPC route → executor)', () => {
  it('answers a question as a completed task with the worker output as artifact', async () => {
    const runWorker = vi.fn<RunWorker>(async ({ prompt }) => ({ text: `2 EVs free (asked: ${prompt})`, costUsd: 0.01 }));
    const result = await callA2AAgent({
      url: `${BASE}/api/a2a/fleet-analyst`,
      text: 'Which EVs are free?',
      token: KEY,
      caller: 'test-suite',
      fetchImpl: inProcessFetch(runWorker),
    });
    expect(result).toMatchObject({ state: 'completed', agentName: 'Auto-Ride Fleet analysis' });
    expect(result.text).toBe('2 EVs free (asked: Which EVs are free?)');
    expect(runWorker).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'fleet-analyst', prompt: 'Which EVs are free?', caller: 'test-suite' }),
    );
  });

  it('reports a failing worker as a failed task without leaking the error', async () => {
    const result = await callA2AAgent({
      url: `${BASE}/api/a2a/fleet-analyst`,
      text: 'Which EVs are free?',
      token: KEY,
      fetchImpl: inProcessFetch(async () => {
        throw new Error('DATABASE_URL=postgres://secret');
      }),
    });
    expect(result.state).toBe('failed');
    expect(result.text).not.toContain('secret');
  });

  it('refuses a caller without the bearer token', async () => {
    await expect(
      callA2AAgent({
        url: `${BASE}/api/a2a/fleet-analyst`,
        text: 'hi',
        fetchImpl: inProcessFetch(async () => ({ text: 'never' })),
      }),
    ).rejects.toThrow();
  });

  it('streams the task lifecycle over SSE for SendStreamingMessage', async () => {
    const fetchImpl = inProcessFetch(async () => ({ text: 'streamed answer' }));
    const res = await fetchImpl(`${BASE}/api/a2a/fleet-analyst`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'A2A-Version': '1.0' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'SendStreamingMessage',
        params: { message: { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'stream please' }] } },
      }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    const frames = raw
      .split('\n\n')
      .filter((f) => f.startsWith('data: '))
      .map((f) => JSON.parse(f.slice(6)) as { id: number; result?: Record<string, unknown> });
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames.every((f) => f.id === 7 && f.result)).toBe(true);
    const kinds = frames.map((f) => Object.keys(f.result ?? {})[0]);
    expect(kinds[0]).toBe('task');
    expect(kinds).toContain('artifactUpdate');
    expect(raw).toContain('streamed answer');
    expect(raw).toContain('TASK_STATE_COMPLETED');
  });
});
