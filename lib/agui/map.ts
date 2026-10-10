import { EventType, type BaseEvent } from '@ag-ui/core';

/**
 * Phase 13 — task_events → AG-UI (Agent-User Interaction protocol) mapper.
 *
 * Auto-Ride already persists every Claude Agent SDK message as a row in
 * `task_events` (see lib/agent/persist.ts). This module turns those rows into
 * the standard AG-UI event stream, so any AG-UI client (CopilotKit, the
 * `@ag-ui/client` HttpAgent, or a hand-rolled EventSource) can render a swarm
 * run without knowing Auto-Ride's internal event shapes.
 *
 * Mapping (one task_events row → zero or more AG-UI events):
 *
 *   assistant_turn (text blocks)  → TEXT_MESSAGE_START / CONTENT / END
 *   tool_call                     → TOOL_CALL_START / ARGS / END
 *   tool_call where tool = Agent  → SUBAGENT_STARTED, then the tool-call triple
 *   tool_result                   → TOOL_CALL_RESULT
 *   tool_result of an Agent call  → TOOL_CALL_RESULT, then SUBAGENT_FINISHED
 *                                   (or SUBAGENT_ERROR when is_error)
 *   user_message (text)           → TEXT_MESSAGE_* with role "user"
 *   compact_boundary              → CUSTOM "auto-ride.compact_boundary"
 *   run_result success            → RUN_FINISHED with the final text + cost
 *   run_result error              → RUN_ERROR
 *
 * Events emitted by a worker carry `subagentRunId` = the dispatcher's `Agent`
 * tool_use_id, which is exactly the SDK's `parent_tool_use_id` chain the
 * runtime already records. That lets an AG-UI client nest worker output under
 * the worker that produced it.
 *
 * The mapper is pure apart from its own bookkeeping (which subagents are
 * open, whether the run has terminated), so it is table-testable and the
 * streaming route stays a thin poll loop.
 */

export type AguiSourceEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type AguiTerminalStatus = 'done' | 'failed' | 'cancelled';

export type AguiMapperOptions = {
  /** AG-UI thread id. Auto-Ride uses the task id (or the conversation id). */
  threadId: string;
  /** AG-UI run id. Auto-Ride uses the task id. */
  runId: string;
  /** Clock injection for deterministic tests. */
  now?: () => number;
};

export type AguiMapper = {
  /** RUN_STARTED. Call once before any `map` call. */
  start(): BaseEvent[];
  /** Map one persisted task event. Returns [] for rows with no AG-UI meaning. */
  map(event: AguiSourceEvent): BaseEvent[];
  /**
   * Close the run when the task reached a terminal status without a
   * `run_result` row (cancelled, crashed before the SDK reported). No-op when
   * a run_result already ended the run.
   */
  finish(status: AguiTerminalStatus, reason?: string): BaseEvent[];
  /** Approval gate opened (task moved to awaiting_approval). */
  approvalRequired(): BaseEvent[];
  /** True once RUN_FINISHED or RUN_ERROR has been emitted. */
  readonly terminated: boolean;
};

export const AUTO_RIDE_CUSTOM_PREFIX = 'auto-ride.' as const;

export function createAguiMapper(opts: AguiMapperOptions): AguiMapper {
  const now = opts.now ?? Date.now;
  const openSubagents = new Map<string, string>(); // tool_use_id → agent name
  let terminated = false;
  let messageCounter = 0;

  const stamp = <T extends BaseEvent>(event: T): T => ({ ...event, timestamp: now() });

  function nextMessageId(base: unknown): string {
    messageCounter += 1;
    return typeof base === 'string' && base.length > 0
      ? `${base}:${messageCounter}`
      : `msg-${opts.runId}-${messageCounter}`;
  }

  function subagentScope(payload: Record<string, unknown>): { subagentRunId?: string } {
    const parent = payload.parent_tool_use_id;
    return typeof parent === 'string' && parent.length > 0
      ? { subagentRunId: parent }
      : {};
  }

  function textMessage(
    text: string,
    role: 'assistant' | 'user',
    messageIdBase: unknown,
    payload: Record<string, unknown>,
  ): BaseEvent[] {
    const messageId = nextMessageId(messageIdBase);
    const scope = subagentScope(payload);
    const agentName = typeof payload.agent_name === 'string' ? payload.agent_name : undefined;
    return [
      stamp({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role,
        ...(agentName ? { name: agentName } : {}),
        ...scope,
      } as BaseEvent),
      stamp({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text, ...scope } as BaseEvent),
      stamp({ type: EventType.TEXT_MESSAGE_END, messageId, ...scope } as BaseEvent),
    ];
  }

  function mapAssistantTurn(payload: Record<string, unknown>): BaseEvent[] {
    const message = payload.message as { content?: unknown } | undefined;
    const content = message?.content;
    const out: BaseEvent[] = [];
    if (typeof content === 'string') {
      if (content.trim().length > 0) out.push(...textMessage(content, 'assistant', payload.uuid, payload));
      return out;
    }
    if (!Array.isArray(content)) return out;
    for (const block of content) {
      if (isTextBlock(block) && block.text.trim().length > 0) {
        out.push(...textMessage(block.text, 'assistant', payload.uuid, payload));
      }
      // tool_use blocks arrive as their own `tool_call` rows; thinking
      // blocks are deliberately not exposed to the UI.
    }
    return out;
  }

  function mapUserMessage(payload: Record<string, unknown>): BaseEvent[] {
    const message = payload.message as { content?: unknown } | undefined;
    const content = message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter(isTextBlock)
              .map((b) => b.text)
              .join('\n')
          : '';
    if (text.trim().length === 0) return [];
    return textMessage(text, 'user', payload.uuid, payload);
  }

  function mapToolCall(payload: Record<string, unknown>): BaseEvent[] {
    const toolCallId = payload.tool_use_id;
    const toolName = payload.tool_name;
    if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return [];
    const scope = subagentScope(payload);
    const out: BaseEvent[] = [];

    if (toolName === 'Agent') {
      const input = (payload.input ?? {}) as { subagent_type?: unknown; description?: unknown };
      const name = typeof input.subagent_type === 'string' ? input.subagent_type : 'worker';
      openSubagents.set(toolCallId, name);
      out.push(
        stamp({
          type: EventType.SUBAGENT_STARTED,
          subagentRunId: toolCallId,
          name,
          ...(typeof input.description === 'string' ? { description: input.description } : {}),
          parentToolCallId: toolCallId,
          ...(scope.subagentRunId ? { parentSubagentRunId: scope.subagentRunId } : {}),
        } as BaseEvent),
      );
    }

    out.push(
      stamp({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: toolName, ...scope } as BaseEvent),
      stamp({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: safeStringify(payload.input ?? {}),
        ...scope,
      } as BaseEvent),
      stamp({ type: EventType.TOOL_CALL_END, toolCallId, ...scope } as BaseEvent),
    );
    return out;
  }

  function mapToolResult(payload: Record<string, unknown>): BaseEvent[] {
    const toolCallId = payload.tool_use_id;
    if (typeof toolCallId !== 'string') return [];
    const isError = payload.is_error === true;
    const out: BaseEvent[] = [
      stamp({
        type: EventType.TOOL_CALL_RESULT,
        messageId: `${toolCallId}:result`,
        toolCallId,
        content: toolResultText(payload.content),
        role: 'tool',
      } as BaseEvent),
    ];

    if (openSubagents.has(toolCallId)) {
      openSubagents.delete(toolCallId);
      out.push(
        isError
          ? stamp({
              type: EventType.SUBAGENT_ERROR,
              subagentRunId: toolCallId,
              message: truncate(toolResultText(payload.content), 500) || 'worker failed',
            } as BaseEvent)
          : stamp({ type: EventType.SUBAGENT_FINISHED, subagentRunId: toolCallId } as BaseEvent),
      );
    }
    return out;
  }

  function mapRunResult(payload: Record<string, unknown>): BaseEvent[] {
    terminated = true;
    if (payload.subtype === 'success') {
      return [
        stamp({
          type: EventType.RUN_FINISHED,
          threadId: opts.threadId,
          runId: opts.runId,
          result: {
            text: typeof payload.result === 'string' ? payload.result : null,
            totalCostUsd: typeof payload.total_cost_usd === 'number' ? payload.total_cost_usd : null,
            numTurns: typeof payload.num_turns === 'number' ? payload.num_turns : null,
          },
        } as BaseEvent),
      ];
    }
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
    return [
      stamp({
        type: EventType.RUN_ERROR,
        message: errors.join('; ') || 'run failed',
        ...(typeof payload.subtype === 'string' ? { code: payload.subtype } : {}),
      } as BaseEvent),
    ];
  }

  return {
    get terminated() {
      return terminated;
    },

    start() {
      return [
        stamp({ type: EventType.RUN_STARTED, threadId: opts.threadId, runId: opts.runId } as BaseEvent),
      ];
    },

    map(event) {
      if (terminated) return [];
      switch (event.type) {
        case 'assistant_turn':
          return mapAssistantTurn(event.payload);
        case 'user_message':
          return mapUserMessage(event.payload);
        case 'tool_call':
          return mapToolCall(event.payload);
        case 'tool_result':
          return mapToolResult(event.payload);
        case 'compact_boundary':
          return [
            stamp({
              type: EventType.CUSTOM,
              name: `${AUTO_RIDE_CUSTOM_PREFIX}compact_boundary`,
              value: event.payload.compact_metadata ?? null,
            } as BaseEvent),
          ];
        case 'run_result':
          return mapRunResult(event.payload);
        default:
          return [];
      }
    },

    approvalRequired() {
      if (terminated) return [];
      return [
        stamp({
          type: EventType.CUSTOM,
          name: `${AUTO_RIDE_CUSTOM_PREFIX}approval_required`,
          value: { runId: opts.runId },
        } as BaseEvent),
      ];
    },

    finish(status, reason) {
      if (terminated) return [];
      terminated = true;
      if (status === 'done') {
        return [
          stamp({ type: EventType.RUN_FINISHED, threadId: opts.threadId, runId: opts.runId } as BaseEvent),
        ];
      }
      return [
        stamp({
          type: EventType.RUN_ERROR,
          message: reason ?? (status === 'cancelled' ? 'run cancelled' : 'run failed'),
          code: status,
        } as BaseEvent),
      ];
    },
  };
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.filter(isTextBlock).map((b) => b.text);
    if (texts.length > 0) return texts.join('\n');
  }
  if (content === undefined || content === null) return '';
  return safeStringify(content);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
