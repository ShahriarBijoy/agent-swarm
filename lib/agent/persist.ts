import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Row shape written to `task_events`. The `type` field is constrained by the
 * phase-02 check constraint (`task_events_type_check`) — keep this union in
 * sync with it.
 *
 * `approval_request` is in the check constraint but not emitted by phase 05;
 * phase 07 adds it when the `canUseTool` gate lands.
 */
export type TaskEventType =
  | 'assistant_turn'
  | 'tool_call'
  | 'tool_result'
  | 'compact_boundary'
  | 'run_result'
  | 'user_message';

export type TaskEventInput = {
  type: TaskEventType;
  payload: Record<string, unknown>;
};

/**
 * Pure SDK-message → task_events mapper. Returns zero or more events per
 * input message — callers advance `seq` per emitted event, not per SDK
 * message, so the unique `(run_id, seq)` index stays contiguous.
 *
 * Messages that don't map (init, stream_event, tool_progress, rate_limit,
 * hook_*, task_*, etc.) return an empty array so the SDK's evolving message
 * zoo never throws here.
 */
export function mapMessageToEvents(msg: SDKMessage): TaskEventInput[] {
  if (msg.type === 'assistant') {
    return mapAssistantMessage(msg);
  }

  if (msg.type === 'user') {
    return mapUserMessage(msg);
  }

  if (msg.type === 'result') {
    return [
      {
        type: 'run_result',
        payload: runResultPayload(msg),
      },
    ];
  }

  if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
    return [
      {
        type: 'compact_boundary',
        payload: {
          uuid: msg.uuid,
          session_id: msg.session_id,
          compact_metadata: msg.compact_metadata,
        },
      },
    ];
  }

  return [];
}

type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>;
type UserMessage = Extract<SDKMessage, { type: 'user' }>;
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

function mapAssistantMessage(msg: AssistantMessage): TaskEventInput[] {
  const events: TaskEventInput[] = [
    {
      type: 'assistant_turn',
      payload: {
        uuid: msg.uuid,
        session_id: msg.session_id,
        parent_tool_use_id: msg.parent_tool_use_id,
        message: msg.message,
      },
    },
  ];

  const content = msg.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isToolUseBlock(block)) {
        events.push({
          type: 'tool_call',
          payload: {
            tool_use_id: block.id,
            tool_name: block.name,
            input: block.input,
            parent_tool_use_id: msg.parent_tool_use_id,
            session_id: msg.session_id,
          },
        });
      }
    }
  }

  return events;
}

function mapUserMessage(msg: UserMessage): TaskEventInput[] {
  const content = msg.message.content;

  if (Array.isArray(content)) {
    const toolResults = content.filter(isToolResultBlock);
    if (toolResults.length > 0) {
      return toolResults.map((block) => ({
        type: 'tool_result',
        payload: {
          tool_use_id: block.tool_use_id,
          is_error: block.is_error ?? false,
          content: block.content,
        },
      }));
    }
  }

  return [
    {
      type: 'user_message',
      payload: {
        uuid: msg.uuid,
        session_id: msg.session_id,
        message: msg.message,
      },
    },
  ];
}

function runResultPayload(msg: ResultMessage): Record<string, unknown> {
  const base = {
    subtype: msg.subtype,
    total_cost_usd: msg.total_cost_usd,
    duration_ms: msg.duration_ms,
    duration_api_ms: msg.duration_api_ms,
    num_turns: msg.num_turns,
    usage: msg.usage,
    modelUsage: msg.modelUsage,
    uuid: msg.uuid,
    session_id: msg.session_id,
  };

  if (msg.subtype === 'success') {
    return { ...base, result: msg.result };
  }

  return { ...base, errors: msg.errors };
}

function isToolUseBlock(
  block: unknown,
): block is { type: 'tool_use'; id: string; name: string; input: unknown } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { id?: unknown }).id === 'string' &&
    typeof (block as { name?: unknown }).name === 'string'
  );
}

function isToolResultBlock(block: unknown): block is {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: boolean;
  content: unknown;
} {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_result' &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
  );
}
