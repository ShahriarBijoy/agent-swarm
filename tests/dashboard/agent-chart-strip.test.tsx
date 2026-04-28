// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AgentChartStrip } from '@/app/(dashboard)/agents/[name]/charts';
import type { AgentMetrics } from '@/lib/dashboard/queries';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as unknown as { ResizeObserver?: unknown };
g.ResizeObserver ??= ResizeObserverStub;

afterEach(() => cleanup());

const FX: AgentMetrics = {
  p50LatencyMs: 1240,
  p95LatencyMs: 4320,
  dailyTokens: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(2026, 3, 15 + i),
    tokens: 1000 + i * 100,
  })),
  successRate: 0.93,
  recentRuns: [],
  topMemories: [],
};

describe('<AgentChartStrip />', () => {
  it('renders the latency, tokens, and success-rate cards', () => {
    const { getByText } = render(<AgentChartStrip metrics={FX} />);
    expect(getByText(/p50 \/ p95 latency/i)).toBeTruthy();
    expect(getByText(/daily tokens/i)).toBeTruthy();
    expect(getByText(/success rate/i)).toBeTruthy();
    expect(getByText('93%')).toBeTruthy();
    expect(getByText(/1\.24s/)).toBeTruthy();
  });
});
