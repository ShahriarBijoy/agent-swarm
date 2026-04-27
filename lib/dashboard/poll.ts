// lib/dashboard/poll.ts
'use client';
import { useEffect, useRef, useState } from 'react';

export type PollState<T> = {
  data: T | null;
  error: Error | null;
  /** Truthy until the first load resolves. */
  loading: boolean;
};

/**
 * SWR-style polling hook with three nothing-design constraints:
 * 1. Pause when the tab is hidden (visibilitychange).
 * 2. One in-flight request at a time (dedup).
 * 3. No external dep (no SWR, no React Query).
 */
export function useDashboardPoll<T>(
  loader: () => Promise<T>,
  refreshMs: number,
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });
  const inFlight = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (inFlight.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      inFlight.current = true;
      try {
        const data = await loaderRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e as Error, loading: false }));
      } finally {
        inFlight.current = false;
      }
    }

    tick(); // initial load
    const interval = setInterval(tick, refreshMs);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMs]);

  return state;
}
