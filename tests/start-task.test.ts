import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 07: startTask now publishes an Inngest event. Mock the client at
// hoist time so we can assert what it was called with.
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn() },
}));

describe('phase-07 startTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes auto-ride/task.started with the validated payload', async () => {
    const { inngest } = await import('@/lib/inngest/client');
    vi.mocked(inngest.send).mockResolvedValue({ ids: ['ev1'] } as never);

    const { startTask } = await import('@/lib/runner/start-task');
    await startTask({
      taskId: '11111111-1111-4111-8111-111111111111',
      prompt: 'check fleet',
      maxBudgetUsd: 0.25,
      maxTurns: 8,
    });

    expect(vi.mocked(inngest.send)).toHaveBeenCalledOnce();
    expect(vi.mocked(inngest.send).mock.calls[0]![0]).toEqual({
      name: 'auto-ride/task.started',
      data: {
        taskId: '11111111-1111-4111-8111-111111111111',
        prompt: 'check fleet',
        maxBudgetUsd: 0.25,
        maxTurns: 8,
      },
    });
  });

  it('omits optional fields when not supplied', async () => {
    const { inngest } = await import('@/lib/inngest/client');
    vi.mocked(inngest.send).mockResolvedValue({ ids: ['ev1'] } as never);

    const { startTask } = await import('@/lib/runner/start-task');
    await startTask({
      taskId: '22222222-2222-4222-8222-222222222222',
      prompt: 'minimal',
    });

    const sent = vi.mocked(inngest.send).mock.calls[0]![0];
    expect(sent).toEqual({
      name: 'auto-ride/task.started',
      data: {
        taskId: '22222222-2222-4222-8222-222222222222',
        prompt: 'minimal',
      },
    });
  });

  it('rejects an invalid taskId before sending the event', async () => {
    const { inngest } = await import('@/lib/inngest/client');
    const { startTask } = await import('@/lib/runner/start-task');
    await expect(
      startTask({ taskId: 'not-a-uuid', prompt: 'x' }),
    ).rejects.toThrow();
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('propagates inngest.send rejection so the caller can finalize the task', async () => {
    const { inngest } = await import('@/lib/inngest/client');
    vi.mocked(inngest.send).mockRejectedValue(new Error('broker-down'));

    const { startTask } = await import('@/lib/runner/start-task');
    await expect(
      startTask({
        taskId: '33333333-3333-4333-8333-333333333333',
        prompt: 'x',
      }),
    ).rejects.toThrow(/broker-down/);
  });
});
