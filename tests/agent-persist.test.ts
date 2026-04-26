import { describe, it, expect } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mapMessageToEvents } from '@/lib/agent/persist';

// Fixtures — we don't import from the SDK because its concrete shapes are a
// moving target in alpha. We construct minimal inputs that satisfy the
// discriminated-union narrowing the mapper does. Any shape drift that breaks
// the mapper will fail typecheck here first.

function initMsg(sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    agents: ['fleet-analyst'],
    apiKeySource: 'user',
    claude_code_version: '0.0.0',
    cwd: '/tmp',
    tools: ['Read', 'Agent'],
    mcp_servers: [{ name: 'memory', status: 'connected' }],
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: 'u-init',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function assistantText(text: string, sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_a',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    uuid: 'u-a',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function assistantWithToolUse(
  blocks: { id: string; name: string; input: unknown }[],
  sessionId = 'sess-1',
): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_b',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: 'thinking about this…' },
        ...blocks.map((b) => ({
          type: 'tool_use',
          id: b.id,
          name: b.name,
          input: b.input,
        })),
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 20,
        output_tokens: 15,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    uuid: 'u-b',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function userPrompt(content: string, sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid: 'u-u',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function userToolResults(
  results: { tool_use_id: string; content: unknown; is_error?: boolean }[],
  sessionId = 'sess-1',
): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
        ...(r.is_error !== undefined ? { is_error: r.is_error } : {}),
      })),
    },
    parent_tool_use_id: null,
    uuid: 'u-ur',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function compactBoundary(sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'auto', pre_tokens: 120000 },
    uuid: 'u-c',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function resultSuccess(sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1234,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 3,
    result: 'Fleet looks healthy.',
    stop_reason: 'end_turn',
    total_cost_usd: 0.0123,
    usage: {
      input_tokens: 1000,
      output_tokens: 250,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 500,
      server_tool_use: { web_search_requests: 0 },
    },
    modelUsage: {
      'claude-sonnet-4-6': {
        inputTokens: 1000,
        outputTokens: 250,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.0123,
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    },
    permission_denials: [],
    uuid: 'u-r',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function resultError(sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'result',
    subtype: 'error_max_budget_usd',
    duration_ms: 500,
    duration_api_ms: 400,
    is_error: true,
    num_turns: 2,
    stop_reason: null,
    total_cost_usd: 0.51,
    usage: {
      input_tokens: 200,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0 },
    },
    modelUsage: {},
    permission_denials: [],
    errors: ['maxBudgetUsd exceeded'],
    uuid: 'u-re',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

describe('mapMessageToEvents', () => {
  it('maps SDKSystemMessage (init) to zero events', () => {
    expect(mapMessageToEvents(initMsg())).toEqual([]);
  });

  it('maps an assistant text message to one assistant_turn', () => {
    const events = mapMessageToEvents(assistantText('hello'));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('assistant_turn');
    expect(events[0]?.payload).toMatchObject({
      session_id: 'sess-1',
      uuid: 'u-a',
      parent_tool_use_id: null,
    });
  });

  it('maps an assistant message with one tool_use to assistant_turn + tool_call (in order)', () => {
    const events = mapMessageToEvents(
      assistantWithToolUse([
        { id: 'toolu_1', name: 'mcp__memory__recall', input: { query: 'q' } },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['assistant_turn', 'tool_call']);
    expect(events[1]?.payload).toMatchObject({
      tool_use_id: 'toolu_1',
      tool_name: 'mcp__memory__recall',
      input: { query: 'q' },
      session_id: 'sess-1',
    });
  });

  it('maps an assistant message with two tool_use blocks to two tool_calls', () => {
    const events = mapMessageToEvents(
      assistantWithToolUse([
        { id: 'toolu_a', name: 'Read', input: { file_path: '/a' } },
        { id: 'toolu_b', name: 'Read', input: { file_path: '/b' } },
      ]),
    );
    expect(events).toHaveLength(3);
    const callEvents = events.filter((e) => e.type === 'tool_call');
    expect(callEvents.map((e) => e.payload.tool_use_id)).toEqual([
      'toolu_a',
      'toolu_b',
    ]);
  });

  it('maps a plain string user message to user_message', () => {
    const events = mapMessageToEvents(userPrompt('hi there'));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('user_message');
    expect(events[0]?.payload).toMatchObject({ uuid: 'u-u', session_id: 'sess-1' });
  });

  it('maps user tool_result content to one tool_result event per block', () => {
    const events = mapMessageToEvents(
      userToolResults([
        { tool_use_id: 'toolu_1', content: 'ok', is_error: false },
        { tool_use_id: 'toolu_2', content: 'boom', is_error: true },
      ]),
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === 'tool_result')).toBe(true);
    expect(events[0]?.payload).toMatchObject({
      tool_use_id: 'toolu_1',
      is_error: false,
      content: 'ok',
    });
    expect(events[1]?.payload).toMatchObject({
      tool_use_id: 'toolu_2',
      is_error: true,
      content: 'boom',
    });
  });

  it('defaults is_error to false when the tool_result block omits it', () => {
    const events = mapMessageToEvents(
      userToolResults([{ tool_use_id: 'toolu_x', content: 'ok' }]),
    );
    expect(events[0]?.payload.is_error).toBe(false);
  });

  it('maps a compact_boundary system message', () => {
    const events = mapMessageToEvents(compactBoundary());
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('compact_boundary');
    expect(events[0]?.payload.compact_metadata).toMatchObject({
      trigger: 'auto',
    });
  });

  it('maps a successful run_result', () => {
    const events = mapMessageToEvents(resultSuccess());
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('run_result');
    expect(events[0]?.payload).toMatchObject({
      subtype: 'success',
      total_cost_usd: 0.0123,
      num_turns: 3,
      result: 'Fleet looks healthy.',
    });
    expect(events[0]?.payload).not.toHaveProperty('errors');
  });

  it('maps an error run_result, preserving the errors array', () => {
    const events = mapMessageToEvents(resultError());
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      subtype: 'error_max_budget_usd',
      errors: ['maxBudgetUsd exceeded'],
    });
    expect(events[0]?.payload).not.toHaveProperty('result');
  });

  it('returns an empty array for unrecognized SDK message types', () => {
    const unknownMsg = {
      type: 'tool_progress',
      tool_use_id: 'toolu_1',
      tool_name: 'Read',
      parent_tool_use_id: null,
      elapsed_time_seconds: 1,
      uuid: 'u-tp',
      session_id: 'sess-1',
    } as unknown as SDKMessage;
    expect(mapMessageToEvents(unknownMsg)).toEqual([]);

    const streamEvent = {
      type: 'stream_event',
      event: { type: 'content_block_start' },
      parent_tool_use_id: null,
      uuid: 'u-se',
      session_id: 'sess-1',
    } as unknown as SDKMessage;
    expect(mapMessageToEvents(streamEvent)).toEqual([]);
  });
});

import {
  extractAgentToolUseMapping,
  getMessageParentToolUseId,
  injectSoftBudget,
  tagAgentName,
  type TaskEventInput,
} from '@/lib/agent/persist';

describe('tagAgentName', () => {
  const event: TaskEventInput = {
    type: 'assistant_turn',
    payload: { uuid: 'u-a', session_id: 's-1' },
  };

  it('tags dispatcher when parent_tool_use_id is null', () => {
    const tagged = tagAgentName(event, null, new Map());
    expect(tagged.payload.agent_name).toBe('dispatcher');
  });

  it('tags the worker name when parent_tool_use_id resolves in the map', () => {
    const map = new Map([['toolu_billing_1', 'billing']]);
    const tagged = tagAgentName(event, 'toolu_billing_1', map);
    expect(tagged.payload.agent_name).toBe('billing');
  });

  it('tags "unknown" when parent_tool_use_id is unmapped (defensive — should not happen with flat fan-out)', () => {
    const tagged = tagAgentName(event, 'toolu_unmapped', new Map());
    expect(tagged.payload.agent_name).toBe('unknown');
  });

  it('preserves all existing payload fields', () => {
    const tagged = tagAgentName(event, null, new Map());
    expect(tagged.payload.uuid).toBe('u-a');
    expect(tagged.payload.session_id).toBe('s-1');
    expect(tagged.type).toBe('assistant_turn');
  });

  it('does not mutate the input event', () => {
    const original = { ...event, payload: { ...event.payload } };
    tagAgentName(event, null, new Map());
    expect(event).toEqual(original);
  });
});

describe('extractAgentToolUseMapping', () => {
  it('returns the mapping when event is a tool_call for the Agent tool with agent_name in input', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_use_id: 'toolu_x',
        tool_name: 'Agent',
        input: { agent_name: 'billing', prompt: 'invoice T-1' },
      },
    };
    expect(extractAgentToolUseMapping(event)).toEqual({
      toolUseId: 'toolu_x',
      agentName: 'billing',
    });
  });

  it('returns null for non-tool_call events', () => {
    const event: TaskEventInput = {
      type: 'assistant_turn',
      payload: { tool_name: 'Agent', input: { agent_name: 'billing' } },
    };
    expect(extractAgentToolUseMapping(event)).toBeNull();
  });

  it('returns null when tool_name is not "Agent"', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_use_id: 'toolu_x',
        tool_name: 'Read',
        input: { file_path: '/tmp/x' },
      },
    };
    expect(extractAgentToolUseMapping(event)).toBeNull();
  });

  it('returns null when input.agent_name is missing or non-string (SDK shape drift)', () => {
    const noAgent: TaskEventInput = {
      type: 'tool_call',
      payload: { tool_use_id: 'toolu_x', tool_name: 'Agent', input: { prompt: 'x' } },
    };
    expect(extractAgentToolUseMapping(noAgent)).toBeNull();

    const numericAgent: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_use_id: 'toolu_x',
        tool_name: 'Agent',
        input: { agent_name: 42, prompt: 'x' },
      },
    };
    expect(extractAgentToolUseMapping(numericAgent)).toBeNull();
  });

  it('returns null when tool_use_id is missing or non-string', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_name: 'Agent',
        input: { agent_name: 'billing' },
      },
    };
    expect(extractAgentToolUseMapping(event)).toBeNull();
  });
});

describe('injectSoftBudget', () => {
  const budgetTable = { billing: 0.20, support: 0.25 } as const;

  it('attaches soft_budget_usd to an Agent tool_call when the agent has a budget', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_use_id: 'toolu_x',
        tool_name: 'Agent',
        input: { agent_name: 'billing' },
      },
    };
    const out = injectSoftBudget(event, budgetTable);
    expect(out.payload.soft_budget_usd).toBe(0.20);
  });

  it('returns the event unchanged for non-tool_call events', () => {
    const event: TaskEventInput = {
      type: 'assistant_turn',
      payload: { input: { agent_name: 'billing' } },
    };
    const out = injectSoftBudget(event, budgetTable);
    expect(out).toBe(event);
  });

  it('returns the event unchanged for non-Agent tool_calls', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: { tool_use_id: 't', tool_name: 'Read', input: { file_path: '/x' } },
    };
    const out = injectSoftBudget(event, budgetTable);
    expect(out).toBe(event);
  });

  it('returns the event unchanged when the agent name is not in the budget table', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: { tool_use_id: 't', tool_name: 'Agent', input: { agent_name: 'unknown' } },
    };
    const out = injectSoftBudget(event, budgetTable);
    expect(out).toBe(event);
  });

  it('preserves other payload fields when injecting', () => {
    const event: TaskEventInput = {
      type: 'tool_call',
      payload: {
        tool_use_id: 'toolu_x',
        tool_name: 'Agent',
        input: { agent_name: 'support', prompt: 'reply' },
        parent_tool_use_id: null,
      },
    };
    const out = injectSoftBudget(event, budgetTable);
    expect(out.payload).toMatchObject({
      tool_use_id: 'toolu_x',
      tool_name: 'Agent',
      parent_tool_use_id: null,
      soft_budget_usd: 0.25,
    });
  });
});

describe('getMessageParentToolUseId', () => {
  it('returns the string parent_tool_use_id when set', () => {
    const msg = { type: 'assistant', parent_tool_use_id: 'toolu_x' } as unknown as Parameters<typeof getMessageParentToolUseId>[0];
    expect(getMessageParentToolUseId(msg)).toBe('toolu_x');
  });

  it('returns null when parent_tool_use_id is null', () => {
    const msg = { type: 'assistant', parent_tool_use_id: null } as unknown as Parameters<typeof getMessageParentToolUseId>[0];
    expect(getMessageParentToolUseId(msg)).toBeNull();
  });

  it('returns null when parent_tool_use_id is missing entirely', () => {
    const msg = { type: 'assistant' } as unknown as Parameters<typeof getMessageParentToolUseId>[0];
    expect(getMessageParentToolUseId(msg)).toBeNull();
  });

  it('returns null for non-string parent_tool_use_id (defensive)', () => {
    const msg = { type: 'assistant', parent_tool_use_id: 42 } as unknown as Parameters<typeof getMessageParentToolUseId>[0];
    expect(getMessageParentToolUseId(msg)).toBeNull();
  });
});
