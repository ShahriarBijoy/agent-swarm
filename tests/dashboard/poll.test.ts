// @vitest-environment jsdom
// tests/dashboard/poll.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDashboardPoll } from '@/lib/dashboard/poll';

describe('useDashboardPoll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls loader on mount and returns its data', async () => {
    const loader = vi.fn().mockResolvedValue({ count: 42 });
    const { result } = renderHook(() => useDashboardPoll(loader, 1000));
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refreshes at refreshMs cadence', async () => {
    let n = 0;
    const loader = vi.fn(async () => ({ n: ++n }));
    const { result } = renderHook(() => useDashboardPoll(loader, 1000));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it('dedupes overlapping calls (no second call while first is pending)', async () => {
    let resolveFirst!: (v: unknown) => void;
    const loader = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({});
    renderHook(() => useDashboardPoll(loader, 100));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(loader).toHaveBeenCalledTimes(1);
    resolveFirst({});
  });
});
