// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CostLine12Mo } from '@/components/dashboard/widgets/cost-line-12mo';
import { CostLine12MoFooter } from '@/components/dashboard/widgets/cost-line-12mo-view';

// jsdom doesn't ship `ResizeObserver`, but Recharts' `ResponsiveContainer`
// references it the moment its module finishes loading via `next/dynamic`.
// The plan's assertions only need the placeholder + headline to render, so a
// no-op stub is enough to keep the unhandled error from failing the run.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as unknown as { ResizeObserver?: unknown };
g.ResizeObserver ??= ResizeObserverStub;

afterEach(() => cleanup());

const FX = {
  days: Array.from({ length: 365 }, (_, i) => ({
    date: new Date(Date.now() - i * 24 * 3600 * 1000),
    total: Math.sin(i / 30) * 5 + 8,
    opusOnly: Math.cos(i / 40) * 2 + 3,
  })).reverse(),
};

describe('<CostLine12Mo />', () => {
  it('renders the daily-spend headline number', () => {
    // The "Avg daily spend" headline lives in the widget's Footer slot, not
    // in <CostLine12Mo /> itself. Render both so the assertion mirrors what
    // the dashboard actually composes via WidgetDef.{Component, Footer}.
    const { getByText } = render(
      <>
        <CostLine12Mo data={FX} />
        <CostLine12MoFooter data={FX} />
      </>,
    );
    expect(getByText(/Avg daily spend/i)).toBeTruthy();
  });
  it('renders a placeholder div before the chart hydrates', () => {
    const { container } = render(<CostLine12Mo data={FX} />);
    expect(container.querySelector('[data-chart-host]')).toBeTruthy();
  });
});
