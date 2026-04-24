import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock before importing the subject. `vi.mock` is hoisted — the factory
// runs before any import in this file.
vi.mock('@/lib/agent/runtime', () => ({
  runOrchestrator: vi.fn(),
}));
vi.mock('@/db/queries/task-runtime', () => ({
  finalizeTask: vi.fn(),
}));

describe('phase-06 startTask', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  async function flushMicrotasks(): Promise<void> {
    // Two passes to let both the runner promise and the catch-handler promise
    // resolve. 0ms setImmediate-style await.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('returns void synchronously without awaiting the runner', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    vi.mocked(runOrchestrator).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { startTask } = await import('@/lib/runner/start-task');
    const ret = startTask({ taskId: 't1', prompt: 'hi' });
    expect(ret).toBeUndefined();
  });

  it('happy path: runner resolves -> finalizeTask is NOT called', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    const { finalizeTask } = await import('@/db/queries/task-runtime');
    vi.mocked(runOrchestrator).mockResolvedValue({
      taskId: 't1',
      runId: 'r1',
      sessionId: 's1',
      status: 'done',
      totalCostUsd: 0.01,
      numTurns: 2,
      finalText: 'ok',
      errorText: null,
      auth: 'api_key',
    });

    const { startTask } = await import('@/lib/runner/start-task');
    startTask({ taskId: 't1', prompt: 'hi' });
    await flushMicrotasks();

    expect(vi.mocked(runOrchestrator)).toHaveBeenCalledOnce();
    expect(vi.mocked(finalizeTask)).not.toHaveBeenCalled();
  });

  it('rejection path: runner throws -> finalizeTask(status=failed) called with taskId', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    const { finalizeTask } = await import('@/db/queries/task-runtime');
    vi.mocked(runOrchestrator).mockRejectedValue(new Error('boom'));
    vi.mocked(finalizeTask).mockResolvedValue(undefined);

    const { startTask } = await import('@/lib/runner/start-task');
    startTask({ taskId: 't2', prompt: 'hi' });
    await flushMicrotasks();

    expect(vi.mocked(finalizeTask)).toHaveBeenCalledWith({
      taskId: 't2',
      status: 'failed',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('forwards taskId, prompt, maxBudgetUsd, maxTurns to runOrchestrator', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    vi.mocked(runOrchestrator).mockResolvedValue({
      taskId: 'x',
      runId: 'r',
      sessionId: null,
      status: 'done',
      totalCostUsd: 0,
      numTurns: 0,
      finalText: null,
      errorText: null,
      auth: 'api_key',
    });

    const { startTask } = await import('@/lib/runner/start-task');
    startTask({
      taskId: 'x',
      prompt: 'check fleet',
      maxBudgetUsd: 0.25,
      maxTurns: 8,
    });
    await flushMicrotasks();

    expect(vi.mocked(runOrchestrator)).toHaveBeenCalledWith({
      taskId: 'x',
      prompt: 'check fleet',
      maxBudgetUsd: 0.25,
      maxTurns: 8,
      createdBy: 'http',
    });
  });

  it('double-fail path: runner rejects AND finalizeTask rejects -> both logged, no uncaught', async () => {
    const { runOrchestrator } = await import('@/lib/agent/runtime');
    const { finalizeTask } = await import('@/db/queries/task-runtime');
    vi.mocked(runOrchestrator).mockRejectedValue(new Error('runner-boom'));
    vi.mocked(finalizeTask).mockRejectedValue(new Error('finalize-boom'));

    const { startTask } = await import('@/lib/runner/start-task');
    startTask({ taskId: 't3', prompt: 'hi' });
    await flushMicrotasks();

    // Expect both log lines: the runner rejection + the finalize-also-failed.
    const calls: string[] = consoleErrorSpy.mock.calls.map(
      (c: unknown[]) => String(c[0] ?? ''),
    );
    expect(calls.some((c: string) => c.includes('runner rejected'))).toBe(true);
    expect(
      calls.some((c: string) => c.includes('finalize-to-failed also failed')),
    ).toBe(true);
  });
});
