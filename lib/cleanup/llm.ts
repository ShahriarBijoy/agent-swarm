import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AnthropicUsage, RoleModel } from './cost-tracker';

/**
 * Single-shot LLM call abstraction used by the three cleanup roles.
 * Decouples role files from the underlying SDK so tests can pass a fake
 * and the production implementation can swap (Agent SDK today, anything
 * speaking the same shape later).
 */
export interface LlmCallArgs {
  model: RoleModel;
  system: string;
  userPrompt: string;
}

export interface LlmCallResult {
  text: string;
  usage: AnthropicUsage;
}

export type LlmCall = (args: LlmCallArgs) => Promise<LlmCallResult>;

/**
 * Production LlmCall — runs the Agent SDK's `query()` once with no tools,
 * one turn, and pulls `result` + `usage` from the SDK's terminal `result`
 * message. Auth flows through whatever the agent SDK already honours
 * (`CLAUDE_CODE_OAUTH_TOKEN` for Max, gateway, or `ANTHROPIC_API_KEY`).
 */
export const runAgentSdkCall: LlmCall = async ({ model, system, userPrompt }) => {
  let text = '';
  let usage: AnthropicUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let sawResult = false;

  for await (const msg of query({
    prompt: userPrompt,
    options: {
      model,
      systemPrompt: system,
      tools: [],
      maxTurns: 1,
    },
  })) {
    if (msg.type !== 'result') continue;
    sawResult = true;
    if (msg.subtype !== 'success') {
      throw new Error(
        `Agent SDK call failed (${msg.subtype}): ${(msg.errors ?? []).join('; ') || 'no detail'}`,
      );
    }
    text = msg.result;
    usage = {
      input_tokens: msg.usage.input_tokens ?? 0,
      output_tokens: msg.usage.output_tokens ?? 0,
      cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    };
  }

  if (!sawResult) {
    throw new Error('Agent SDK call ended without a result message');
  }
  return { text, usage };
};
