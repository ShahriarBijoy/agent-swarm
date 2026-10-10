import { query, type CanUseTool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { loadAgentAuthEnv } from '@/lib/env';
import { MEMORY_SERVER_NAME, memoryMcpServer } from '@/lib/mcp/memory';
import { DOMAIN_SERVER_NAME, domainMcpServer } from '@/lib/mcp/domain';
import { exposedAgentDefinition, readOnlyToolsFor, type A2AExposedAgent } from '@/lib/a2a/exposed';
import type { RunWorker, RunWorkerArgs, RunWorkerResult } from '@/lib/a2a/executor';

/**
 * Phase 13 — run one exposed worker for an A2A caller with the Claude Agent SDK.
 *
 * The worker keeps its own system prompt, model tier and turn cap from the
 * phase-08 registry, but runs as a top-level query with a read-only tool set:
 * `allowedTools` is the read-only allowlist and `canUseTool` denies anything
 * else, so a prompt-injected request still cannot reach a write tool. Each
 * call has its own small dollar cap on top of the worker's turn cap.
 */

export const A2A_WORKER_MAX_BUDGET_USD = 0.25;

export function buildWorkerOptions(agent: A2AExposedAgent, abortController: AbortController): Options {
  const definition = exposedAgentDefinition(agent);
  const allowed = readOnlyToolsFor(definition);
  const allowedSet = new Set(allowed);

  const canUseTool: CanUseTool = async (toolName, input) =>
    allowedSet.has(toolName)
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: `${toolName} is not available to A2A callers (read-only worker).` };

  return {
    ...(definition.model ? { model: definition.model } : {}),
    systemPrompt: definition.prompt,
    allowedTools: allowed,
    canUseTool,
    mcpServers: {
      [MEMORY_SERVER_NAME]: memoryMcpServer,
      [DOMAIN_SERVER_NAME]: domainMcpServer,
    },
    permissionMode: 'default',
    maxTurns: definition.maxTurns ?? 6,
    maxBudgetUsd: A2A_WORKER_MAX_BUDGET_USD,
    settingSources: [],
    abortController,
    cwd: process.cwd(),
  };
}

async function* singlePrompt(text: string) {
  yield {
    type: 'user' as const,
    message: { role: 'user' as const, content: text },
    parent_tool_use_id: null,
    session_id: '',
  };
}

export const runWorkerWithSdk: RunWorker = async (args: RunWorkerArgs): Promise<RunWorkerResult> => {
  loadAgentAuthEnv(); // fail fast with the usual auth error message
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  args.signal.addEventListener('abort', onAbort, { once: true });

  try {
    let text: string | null = null;
    let costUsd: number | undefined;
    let error: string | null = null;
    const prompt =
      `[a2a] caller=${args.caller}\n` +
      'You are answering a request from an external agent over the A2A protocol. ' +
      'You are read-only: answer from the tools you have, and say plainly when you cannot.\n\n' +
      args.prompt;

    for await (const msg of query({
      prompt: singlePrompt(prompt),
      options: buildWorkerOptions(args.agent, abortController),
    })) {
      if (msg.type === 'result') {
        costUsd = msg.total_cost_usd;
        if (msg.subtype === 'success') text = msg.result;
        else error = (msg.errors ?? [msg.subtype]).join('; ');
      }
    }
    if (text === null) throw new Error(error ?? 'worker ended without a result');
    return { text, ...(costUsd !== undefined ? { costUsd } : {}) };
  } finally {
    args.signal.removeEventListener('abort', onAbort);
  }
};
