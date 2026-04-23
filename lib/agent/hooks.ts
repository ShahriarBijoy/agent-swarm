import type {
  HookCallback,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';

const INPUT_PREVIEW_LIMIT = 200;

/**
 * PreToolUse audit hook. Logs every tool invocation (orchestrator + subagents)
 * to stderr and returns a `permissionDecision: 'allow'` pass-through.
 *
 * Policy gating (deny / ask for destructive MCP tools) is phase 07's
 * `canUseTool` gate; this hook is pure observability.
 */
export const auditPreToolUse: HookCallback = async (input, toolUseId) => {
  if (!isPreToolUseInput(input)) {
    return { hookSpecificOutput: passThroughOutput() };
  }

  const isSubagent = Boolean(input.agent_id);
  const label = isSubagent
    ? `subagent ${input.agent_type ?? '?'}`
    : 'orchestrator';

  console.error(
    `[audit] ${label} tool=${input.tool_name} id=${toolUseId ?? '?'} ` +
      `session=${input.session_id} input=${safeShort(input.tool_input)}`,
  );

  return { hookSpecificOutput: passThroughOutput() };
};

/**
 * Serializes `value` to JSON and truncates to `limit` chars. Never throws —
 * on JSON errors falls back to `String(value)`. Used for stderr-safe preview
 * of arbitrary tool inputs (embedding vectors, large objects).
 */
export function safeShort(value: unknown, limit = INPUT_PREVIEW_LIMIT): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `…(+${s.length - limit})`;
}

function passThroughOutput(): PreToolUseHookSpecificOutput {
  return {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
  };
}

function isPreToolUseInput(input: unknown): input is PreToolUseHookInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { hook_event_name?: unknown }).hook_event_name === 'PreToolUse'
  );
}
