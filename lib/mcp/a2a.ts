import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { callA2AAgent, type CallA2AAgentArgs, type CallA2AAgentResult } from '@/lib/a2a/client';

/**
 * Phase 13 — let the dispatcher delegate to *external* agents over A2A.
 *
 * Remote agents are configured by the operator, never chosen by the model:
 *
 *   A2A_REMOTE_AGENTS='{"weather":{"url":"https://agents.example.com/weather","token":"..."}}'
 *
 * The dispatcher only sees the agent names. The tool is NOT in the
 * orchestrator's allowedTools and the approval policy gates every
 * `mcp__a2a__*` call, so sending swarm data to another organisation's agent
 * always waits for one human approval first.
 */

export const A2A_SERVER_NAME = 'a2a' as const;
export const DELEGATE_TO_A2A_FQN = `mcp__${A2A_SERVER_NAME}__delegate_to_remote_agent` as const;

const remoteAgentSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1).optional(),
  description: z.string().max(300).optional(),
});
const remoteAgentsSchema = z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), remoteAgentSchema);

export type RemoteA2AAgents = z.infer<typeof remoteAgentsSchema>;

/** Parses A2A_REMOTE_AGENTS. Returns {} when unset; throws on malformed config. */
export function parseRemoteAgents(raw: string | undefined): RemoteA2AAgents {
  if (!raw || raw.trim() === '') return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('A2A_REMOTE_AGENTS is not valid JSON');
  }
  const parsed = remoteAgentsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`A2A_REMOTE_AGENTS is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

type CallFn = (args: CallA2AAgentArgs) => Promise<CallA2AAgentResult>;

export function createDelegateTool(agents: RemoteA2AAgents, call: CallFn = callA2AAgent) {
  const names = Object.keys(agents);
  if (names.length === 0) throw new Error('createDelegateTool needs at least one remote agent');

  const catalog = names
    .map((n) => `- ${n}${agents[n]?.description ? `: ${agents[n]?.description}` : ''}`)
    .join('\n');

  const delegate = tool(
    'delegate_to_remote_agent',
    'Send one self-contained question to an external agent over the A2A protocol and return its answer. ' +
      'Needs operator approval. Include only the data the remote agent needs; never send customer emails, ' +
      'payment details or internal IDs. Available agents:\n' +
      catalog,
    {
      agent: z.enum(names as [string, ...string[]]),
      task: z.string().min(1).max(4000),
    },
    async ({ agent, task }) => {
      const target = agents[agent];
      if (!target) {
        return { content: [{ type: 'text', text: `Unknown remote agent: ${agent}` }], isError: true };
      }
      try {
        const result = await call({
          url: target.url,
          text: task,
          ...(target.token ? { token: target.token } : {}),
          caller: 'auto-ride-dispatcher',
          signal: AbortSignal.timeout(120_000),
        });
        const ok = result.state === 'completed' || result.state === 'message';
        return {
          content: [
            {
              type: 'text',
              text: ok
                ? `${result.agentName} answered:\n${result.text}`
                : `${result.agentName} did not complete the task (state: ${result.state}). ${result.text}`.trim(),
            },
          ],
          ...(ok ? {} : { isError: true }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `A2A call to ${agent} failed: ${message}` }], isError: true };
      }
    },
  );

  return delegate;
}

/** The `a2a` MCP server, or null when no remote agents are configured. */
export function createA2AMcpServer(
  agents: RemoteA2AAgents,
  call: CallFn = callA2AAgent,
): McpSdkServerConfigWithInstance | null {
  if (Object.keys(agents).length === 0) return null;
  return createSdkMcpServer({ name: A2A_SERVER_NAME, version: '1.0.0', tools: [createDelegateTool(agents, call)] });
}
