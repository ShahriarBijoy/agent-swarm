import { describe, expect, it, vi } from 'vitest';
import { buildOrchestratorOptions, ORCHESTRATOR_ALLOWED_TOOLS } from '@/lib/agent/options';
import { shouldRequireApproval } from '@/lib/agent/approval-policy';
import {
  A2A_SERVER_NAME,
  DELEGATE_TO_A2A_FQN,
  createA2AMcpServer,
  createDelegateTool,
  parseRemoteAgents,
} from '@/lib/mcp/a2a';
import { agentCardResponse, authenticateA2A, createA2ARequestHandler, handleA2AJsonRpc } from '@/lib/a2a/http';
import { callA2AAgent } from '@/lib/a2a/client';

// Phase 13 — the dispatcher's outbound A2A tool.

const REMOTE = JSON.stringify({
  'fleet-twin': { url: 'http://remote.test/api/a2a/fleet-analyst', token: 'k', description: 'Partner fleet data' },
});

type ToolText = { content: { type: string; text: string }[]; isError?: boolean };

describe('A2A_REMOTE_AGENTS parsing', () => {
  it('is empty when unset and rejects malformed config loudly', () => {
    expect(parseRemoteAgents(undefined)).toEqual({});
    expect(parseRemoteAgents('  ')).toEqual({});
    expect(() => parseRemoteAgents('{not json')).toThrow(/not valid JSON/);
    expect(() => parseRemoteAgents(JSON.stringify({ 'Bad Name': { url: 'http://x' } }))).toThrow(/invalid/);
    expect(() => parseRemoteAgents(JSON.stringify({ ok: { url: 'not-a-url' } }))).toThrow(/invalid/);
    expect(parseRemoteAgents(REMOTE)['fleet-twin']?.url).toBe('http://remote.test/api/a2a/fleet-analyst');
  });
});

describe('orchestrator wiring', () => {
  it('adds no a2a server when no remote agents are configured', () => {
    const opts = buildOrchestratorOptions({ remoteA2AAgents: '' });
    expect(opts.mcpServers).not.toHaveProperty(A2A_SERVER_NAME);
    expect(createA2AMcpServer({})).toBeNull();
  });

  it('registers the a2a server when configured, but never auto-allows it', () => {
    const opts = buildOrchestratorOptions({ remoteA2AAgents: REMOTE });
    expect(opts.mcpServers).toHaveProperty(A2A_SERVER_NAME);
    expect(opts.allowedTools).not.toContain(DELEGATE_TO_A2A_FQN);
    expect(ORCHESTRATOR_ALLOWED_TOOLS).not.toContain(DELEGATE_TO_A2A_FQN);
  });

  it('gates every external A2A call behind human approval', () => {
    const decision = shouldRequireApproval(DELEGATE_TO_A2A_FQN, { agent: 'fleet-twin', task: 'x' });
    expect(decision.require).toBe(true);
    if (decision.require) expect(decision.reason).toMatch(/A2A/);
  });
});

describe('delegate_to_remote_agent', () => {
  it('passes the configured url and token, never model-chosen ones', async () => {
    const call = vi.fn(async () => ({ text: '3 vans free', state: 'completed' as const, agentName: 'Partner' }));
    const delegate = createDelegateTool(parseRemoteAgents(REMOTE), call);
    const res = (await delegate.handler({ agent: 'fleet-twin', task: 'How many vans?' }, {})) as ToolText;
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain('3 vans free');
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://remote.test/api/a2a/fleet-analyst', token: 'k', text: 'How many vans?' }),
    );
  });

  it('turns failed tasks and transport errors into tool errors', async () => {
    const failed = createDelegateTool(
      parseRemoteAgents(REMOTE),
      async () => ({ text: 'no data', state: 'failed', agentName: 'Partner' }),
    );
    expect(((await failed.handler({ agent: 'fleet-twin', task: 'q' }, {})) as ToolText).isError).toBe(true);

    const broken = createDelegateTool(parseRemoteAgents(REMOTE), async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = (await broken.handler({ agent: 'fleet-twin', task: 'q' }, {})) as ToolText;
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('ECONNREFUSED');
  });

  it('works end to end against an Auto-Ride A2A server (swarm → A2A → worker)', async () => {
    const handler = createA2ARequestHandler('fleet-analyst', 'http://remote.test', async ({ prompt }) => ({
      text: `remote fleet-analyst says: ${prompt.length} chars received`,
    }));
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const path = new URL(req.url).pathname;
      if (path.endsWith('/.well-known/agent-card.json')) return agentCardResponse(handler);
      const auth = authenticateA2A(req, 'k');
      if (!auth.ok) return auth.response;
      return handleA2AJsonRpc(req, handler, auth.user);
    }) as typeof fetch;

    const delegate = createDelegateTool(parseRemoteAgents(REMOTE), (args) => callA2AAgent({ ...args, fetchImpl }));
    const res = (await delegate.handler({ agent: 'fleet-twin', task: 'Which EVs are free?' }, {})) as ToolText;
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toBe('Auto-Ride Fleet analysis answered:\nremote fleet-analyst says: 19 chars received');
  });
});
