import { describe, expect, it, vi } from 'vitest';
import {
  createCanUseTool,
  userPromptStream,
  type DurableStep,
} from '@/lib/agent/approvals';

/**
 * Pure unit tests for createCanUseTool — no DB, no Inngest. We inject fakes
 * for every side-effect via the `deps` seam and a hand-rolled DurableStep.
 */

function makeStep(
  result: { name: string; data: Record<string, unknown> } | null,
): DurableStep & { calls: number } {
  let calls = 0;
  return {
    waitForEvent: async () => {
      calls += 1;
      return result as never;
    },
    get calls() {
      return calls;
    },
  } as DurableStep & { calls: number };
}

type OpenGateArgs = {
  id: string;
  runId: string;
  taskId: string;
  toolName: string;
  proposedInput: unknown;
};
type AppendArgs = {
  runId: string;
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
};

function makeDeps() {
  const openGate = vi.fn(async (_args: OpenGateArgs) => {});
  const expireGate = vi.fn(async (_id: string) => ({ ok: true as const }));
  const markTaskAwaitingApproval = vi.fn(async (_taskId: string) => {});
  const markTaskResumed = vi.fn(async (_taskId: string) => {});
  const appendTaskEventAuto = vi.fn(async (_args: AppendArgs) => ({
    id: 1n,
    seq: 0,
  }));
  const generateGateId = vi.fn(() => 'gate-aaaa-1111');
  return {
    openGate,
    expireGate,
    markTaskAwaitingApproval,
    markTaskResumed,
    appendTaskEventAuto,
    generateGateId,
  };
}

const noAbort = { aborted: false } as AbortSignal;

describe('phase-07 createCanUseTool', () => {
  it('allows pass-through tools without opening a gate', async () => {
    const step = makeStep({ name: 'should-not-fire', data: {} });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'mcp__memory__recall',
      { query: 'fleet' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({ behavior: 'allow' });
    expect(deps.openGate).not.toHaveBeenCalled();
    expect(deps.appendTaskEventAuto).not.toHaveBeenCalled();
    expect(deps.markTaskAwaitingApproval).not.toHaveBeenCalled();
    expect(step.calls).toBe(0);
  });

  it('approves: opens gate, waits, returns allow on decision', async () => {
    const step = makeStep({
      name: 'auto-ride/approval.decided',
      data: { gateId: 'gate-aaaa-1111', approved: true },
    });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm -rf /tmp/x' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({ behavior: 'allow' });
    expect(deps.openGate).toHaveBeenCalledOnce();
    expect(deps.openGate).toHaveBeenCalledWith({
      id: 'gate-aaaa-1111',
      runId: 'r',
      taskId: 't',
      toolName: 'Bash',
      proposedInput: { command: 'rm -rf /tmp/x' },
    });
    expect(deps.appendTaskEventAuto).toHaveBeenCalledOnce();
    expect(deps.appendTaskEventAuto.mock.calls[0]![0]).toMatchObject({
      runId: 'r',
      taskId: 't',
      type: 'approval_request',
      payload: expect.objectContaining({
        subtype: 'opened',
        gate_id: 'gate-aaaa-1111',
        tool_name: 'Bash',
      }),
    });
    expect(deps.markTaskAwaitingApproval).toHaveBeenCalledWith('t');
    expect(deps.markTaskResumed).toHaveBeenCalledWith('t');
    expect(deps.expireGate).not.toHaveBeenCalled();
    expect(step.calls).toBe(1);
  });

  it('approves with modified input: returns allow + updatedInput', async () => {
    const step = makeStep({
      name: 'auto-ride/approval.decided',
      data: {
        gateId: 'gate-aaaa-1111',
        approved: true,
        modifiedInput: { command: 'rm -rf /tmp/x_safe' },
      },
    });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm -rf /tmp/x' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'rm -rf /tmp/x_safe' },
    });
    expect(deps.markTaskResumed).toHaveBeenCalledWith('t');
  });

  it('denies: returns deny with the reviewer reason', async () => {
    const step = makeStep({
      name: 'auto-ride/approval.decided',
      data: {
        gateId: 'gate-aaaa-1111',
        approved: false,
        reason: 'too risky',
      },
    });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm -rf /' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({ behavior: 'deny', message: 'too risky' });
    expect(deps.markTaskResumed).toHaveBeenCalledWith('t');
    expect(deps.expireGate).not.toHaveBeenCalled();
  });

  it('denies with a default message if reviewer reason is empty', async () => {
    const step = makeStep({
      name: 'auto-ride/approval.decided',
      data: { gateId: 'gate-aaaa-1111', approved: false, reason: '   ' },
    });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm -rf /' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Denied by reviewer.',
    });
  });

  it('times out: returns deny + flips gate to timed_out', async () => {
    const step = makeStep(null); // 24h elapsed
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm -rf /' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Approval timed out after 24h.',
    });
    expect(deps.expireGate).toHaveBeenCalledWith('gate-aaaa-1111');
    expect(deps.markTaskResumed).not.toHaveBeenCalled();
  });

  it('aborts before opening gate when signal is already aborted', async () => {
    const step = makeStep({ name: 'noop', data: {} });
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const aborted = { aborted: true } as AbortSignal;
    const result = await canUseTool(
      'Bash',
      { command: 'rm' },
      { signal: aborted, toolUseID: 'tu1' },
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Run aborted before approval gate opened.',
    });
    expect(deps.openGate).not.toHaveBeenCalled();
    expect(step.calls).toBe(0);
  });

  it('aborts mid-wait: returns deny even after a real decision', async () => {
    // Simulate the decision arriving but the abort signal flipping during
    // the wait. We toggle the signal between the openGate insert and the
    // post-wait check by using a getter.
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
    } as AbortSignal;

    const step: DurableStep = {
      waitForEvent: async () => {
        aborted = true;
        return {
          name: 'auto-ride/approval.decided',
          data: { gateId: 'gate-aaaa-1111', approved: true },
        };
      },
    };
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    const result = await canUseTool(
      'Bash',
      { command: 'rm' },
      { signal, toolUseID: 'tu1' },
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Run aborted while waiting for approval.',
    });
  });

  it('passes the gateId predicate to step.waitForEvent', async () => {
    const captured: Array<{
      id: string;
      opts: { event: string; timeout: string; if?: string };
    }> = [];
    const step: DurableStep = {
      waitForEvent: async (id, opts) => {
        captured.push({ id, opts });
        return {
          name: 'auto-ride/approval.decided',
          data: { gateId: 'gate-aaaa-1111', approved: true },
        };
      },
    };
    const deps = makeDeps();
    const canUseTool = createCanUseTool({
      taskId: 't',
      runId: 'r',
      step,
      deps,
    });

    await canUseTool(
      'Bash',
      { command: 'rm' },
      { signal: noAbort, toolUseID: 'tu1' },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      id: 'approval-gate-aaaa-1111',
      opts: {
        event: 'auto-ride/approval.decided',
        timeout: '24h',
        if: 'async.data.gateId == "gate-aaaa-1111"',
      },
    });
  });
});

describe('phase-07 userPromptStream', () => {
  it('yields exactly one SDKUserMessage and completes', async () => {
    const generated: unknown[] = [];
    for await (const msg of userPromptStream('hello')) {
      generated.push(msg);
    }
    expect(generated).toHaveLength(1);
    expect(generated[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      session_id: '',
    });
  });

  it('preserves multi-line content verbatim', async () => {
    const text = 'line one\nline two\n  line three';
    const messages: Array<{ message: { content: string } }> = [];
    for await (const msg of userPromptStream(text)) {
      messages.push(msg);
    }
    expect(messages[0]!.message.content).toBe(text);
  });
});
